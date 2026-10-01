// Events, triggers, notifications and stage gates (master build instruction §09, §17, §62, §75).
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, events, notificationMutes, notifications, playbooks, projects, stageGates, tasks, triggerRules, type RuleAction, type RuleCondition } from "@/db/schema";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { evaluateProof } from "@/lib/playbooks/checks";
import { ensurePlaybooks, startRun } from "@/lib/playbooks/engine";
import type { CheckSpec } from "@/lib/playbooks/types";

export const EVENT_TYPES = [
  "PROJECT_CREATED", "PROJECT_STAGE_CHANGED", "DOCUMENT_UPLOADED", "DOCUMENT_APPROVED", "CAPITAL_MANDATE_CHANGED", "CAPITAL_MATCH_CREATED", "DEAL_STAGE_CHANGED",
  "RISK_CHANGED", "SIGNAL_CREATED", "PERMIT_DUE", "CONTRACT_OBLIGATION_DUE", "BROKER_REFERRAL_SUBMITTED", "BROKER_REFERRAL_APPROVED", "PARTNER_PROPOSAL_RECEIVED",
  "PLAYBOOK_FAILED", "PLAYBOOK_COMPLETED", "INTAKE_RECEIVED", "PORTAL_MESSAGE_RECEIVED",
  "MATCH_CREATED", "QUALIFICATION_COMPLETED", "PURSUIT_APPROVED", "RFP_RECEIVED", "MANDATE_AT_RISK", "SIGNAL_DETECTED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export async function emitEvent(db: Db, e: { mandateId: string; type: EventType; entityType?: string | null; entityId?: string | null; payload?: Record<string, unknown>; actor: string }) {
  const [row] = await db.insert(events).values({ mandateId: e.mandateId, type: e.type, entityType: e.entityType ?? null, entityId: e.entityId ?? null, payload: e.payload ?? {}, actor: e.actor }).returning({ id: events.id });
  return row.id;
}

/** Pure: does an event payload satisfy every condition? Missing fields never match. */
export function matches(conditions: RuleCondition[], payload: Record<string, unknown>) {
  return conditions.every(c => {
    const v = payload[c.field];
    if (v === undefined || v === null) return false;
    switch (c.op) {
      case "eq": return String(v) === String(c.value);
      case "neq": return String(v) !== String(c.value);
      case "in": return Array.isArray(c.value) && c.value.map(String).includes(String(v));
      case "gte": return Number(v) >= Number(c.value);
      case "lte": return Number(v) <= Number(c.value);
      case "contains": return String(v).toLowerCase().includes(String(c.value).toLowerCase());
    }
  });
}

const fill = (template: string, payload: Record<string, unknown>) => template.replace(/\{(\w+)\}/g, (_, k) => String(payload[k] ?? ""));
const LINK: Record<string, (id: string) => string> = { project: id => `/projects/${id}`, referral: () => "/portals?tab=referrals", playbook_run: id => `/playbooks/runs/${id}`, capital_opportunity: id => `/capital/opportunities/${id}`, intake: () => "/portals?tab=intake", portal_user: () => "/portals?tab=messages" };

async function runAction(db: Db, a: RuleAction, ev: typeof events.$inferSelect, ruleId: string, now: Date) {
  const p = { ...ev.payload, entityId: ev.entityId ?? "" };
  if (a.type === "notify") {
    const [muted] = a.to ? await db.select({ id: notificationMutes.id }).from(notificationMutes).where(and(eq(notificationMutes.email, a.to), eq(notificationMutes.category, a.category))) : [];
    if (muted) return "muted";
    await db.insert(notifications).values({ mandateId: ev.mandateId, recipient: a.to ?? null, category: a.category as never, priority: a.priority, title: fill(a.title, p), body: String(ev.payload.summary ?? ""), entityType: ev.entityType, entityId: ev.entityId, link: ev.entityType && ev.entityId && LINK[ev.entityType] ? LINK[ev.entityType](ev.entityId) : null, eventId: ev.id, ruleId });
    return "notified";
  }
  if (a.type === "task") {
    await db.insert(tasks).values({ mandateId: ev.mandateId, projectId: ev.entityType === "project" ? ev.entityId : null, type: "other", title: fill(a.title, p), body: `Created by a trigger rule from ${ev.type}.`, dueAt: new Date(now.getTime() + (a.dueDays ?? 2) * 86_400_000).toISOString().slice(0, 10) });
    return "task";
  }
  if (a.type === "playbook") {
    await ensurePlaybooks(db, ev.mandateId);
    const [pb] = await db.select().from(playbooks).where(and(eq(playbooks.mandateId, ev.mandateId), eq(playbooks.key, a.key)));
    if (!pb || (pb.entityType !== "none" && !ev.entityId)) return "playbook skipped";
    await startRun(db, pb.id, pb.entityType === "none" ? null : ev.entityId, `trigger:${ruleId}`);
    return `playbook ${a.key}`;
  }
  await enqueue(db, a.job, {}, { dedupeKey: `${a.job}:${now.toISOString().slice(0, 13)}`, now });
  return `job ${a.job}`;
}

/** Processes unprocessed events against enabled rules. Idempotent: each event is processed once. */
export async function dispatchEvents(db: Db, now = new Date(), limit = 100) {
  const pending = await db.select().from(events).where(isNull(events.processedAt)).orderBy(asc(events.at)).limit(limit);
  let actions = 0;
  for (const ev of pending) {
    const claimed = await db.update(events).set({ processedAt: now.toISOString() }).where(and(eq(events.id, ev.id), isNull(events.processedAt))).returning({ id: events.id });
    if (!claimed.length) continue;
    const rules = await db.select().from(triggerRules).where(and(eq(triggerRules.mandateId, ev.mandateId), eq(triggerRules.eventType, ev.type), eq(triggerRules.enabled, true)));
    for (const r of rules) {
      if (!matches(r.conditions, { ...ev.payload, entityType: ev.entityType ?? "" })) continue;
      const results: string[] = [];
      for (const a of r.actions) {
        try { results.push(await runAction(db, a, ev, r.id, now)); actions++; } catch (e) { results.push(`failed: ${(e as Error).message}`); }
      }
      await db.update(triggerRules).set({ lastRunAt: now.toISOString(), lastResult: results.join("; "), runs: sql`${triggerRules.runs} + 1` }).where(eq(triggerRules.id, r.id));
    }
  }
  return { events: pending.length, actions };
}

/** Default rules (§17 examples), created once per entity; editable and can be disabled. */
export const DEFAULT_RULES: Omit<typeof triggerRules.$inferInsert, "mandateId">[] = [
  { name: "Introducer registration → review", eventType: "BROKER_REFERRAL_SUBMITTED", isSystem: true, conditions: [], actions: [{ type: "notify", priority: "action", category: "broker", title: "Introducer registration to review: {name}" }, { type: "task", title: "Review introducer registration: {name}", dueDays: 2 }] },
  { name: "Conflict on a registration → critical", eventType: "BROKER_REFERRAL_SUBMITTED", isSystem: true, conditions: [{ field: "status", op: "eq", value: "conflict_review" }], actions: [{ type: "notify", priority: "critical", category: "broker", title: "Conflict check needed: {name}" }] },
  { name: "Capital alignment → capital pathway playbook", eventType: "PROJECT_STAGE_CHANGED", isSystem: true, conditions: [{ field: "to", op: "eq", value: "capital_alignment" }], actions: [{ type: "playbook", key: "capital-pathway-analysis" }, { type: "notify", priority: "action", category: "project", title: "{name} reached Capital alignment" }] },
  { name: "Investor mandate changed → rematch", eventType: "CAPITAL_MANDATE_CHANGED", isSystem: true, conditions: [], actions: [{ type: "job", job: "capital.rematch" }] },
  { name: "Playbook failed → notify", eventType: "PLAYBOOK_FAILED", isSystem: true, conditions: [], actions: [{ type: "notify", priority: "action", category: "playbook", title: "Playbook needs review: {name}" }] },
  { name: "Public intake → review", eventType: "INTAKE_RECEIVED", isSystem: true, conditions: [], actions: [{ type: "notify", priority: "information", category: "relationship", title: "New {kind} intake: {name}" }] },
  { name: "Portal message → reply", eventType: "PORTAL_MESSAGE_RECEIVED", isSystem: true, conditions: [], actions: [{ type: "notify", priority: "action", category: "relationship", title: "Portal message from {name}" }] },
];

export const DEFAULT_GATES: { toStage: string; conditions: { id: string; text: string; check: CheckSpec }[] }[] = [
  { toStage: "capital_alignment", conditions: [
    { id: "g1", text: "At least 8 readiness dimensions recorded with evidence", check: { type: "readiness_known", min: 8 } },
    { id: "g2", text: "At least one capital requirement", check: { type: "count_at_least", source: "capital_requirements", min: 1 } },
    { id: "g3", text: "Sponsor confirmed", check: { type: "party_role", role: "sponsor", confirmed: true } },
  ] },
  { toStage: "financial_close", conditions: [
    { id: "g1", text: "At least one executed agreement", check: { type: "count_at_least", source: "contracts", min: 1, where: { lifecycle: ["effective", "active"] } } },
    { id: "g2", text: "At least one approved permit", check: { type: "count_at_least", source: "permits", min: 1, where: { status: "approved" } } },
  ] },
  { toStage: "construction", conditions: [
    { id: "g1", text: "At least one approved permit", check: { type: "count_at_least", source: "permits", min: 1, where: { status: "approved" } } },
    { id: "g2", text: "EPC or construction agreement executed", check: { type: "count_at_least", source: "contracts", min: 1, where: { category: "procurement", lifecycle: ["effective", "active"] } } },
    { id: "g3", text: "Engineering readiness recorded", check: { type: "readiness_known", min: 12 } },
  ] },
];

/** Opportunity (tracker stage) gates, §12: advancing needs verifiable conditions. "project" conditions run on the
 * opportunity's linked project; "paths" limits a condition to capital mandates or project diagnostics. */
export const DEFAULT_DEAL_GATES: { toStage: string; conditions: { id: string; text: string; check: CheckSpec; scope?: "deal" | "project"; paths?: string[] }[] }[] = [
  { toStage: "engaged", conditions: [
    { id: "d1", text: "Organization linked", check: { type: "field_present", field: "orgId" } },
    { id: "d2", text: "Contact linked", check: { type: "field_present", field: "contactId" } },
  ] },
  { toStage: "proposal", conditions: [
    { id: "d1", text: "Organization linked", check: { type: "field_present", field: "orgId" } },
    { id: "d2", text: "Contact linked", check: { type: "field_present", field: "contactId" } },
    { id: "d3", text: "Value estimated", check: { type: "field_present", field: "valueEstimate" } },
    { id: "d4", text: "Project record linked (site and jurisdiction identified)", check: { type: "field_present", field: "projectId" }, paths: ["capital_mandate", "project_diagnostic"] },
    { id: "d5", text: "Sponsor recorded on the project", check: { type: "party_role", role: "sponsor" }, scope: "project", paths: ["capital_mandate"] },
    { id: "d6", text: "Capital ask known (at least one capital requirement)", check: { type: "count_at_least", source: "capital_requirements", min: 1 }, scope: "project", paths: ["capital_mandate"] },
    { id: "d7", text: "Jurisdiction identified", check: { type: "field_present", field: "country" }, scope: "project", paths: ["capital_mandate", "project_diagnostic"] },
  ] },
  { toStage: "signed", conditions: [
    { id: "d1", text: "Engagement agreement drafted", check: { type: "count_at_least", source: "deal_contracts", min: 1 } },
    { id: "d2", text: "Sponsor confirmed on the project", check: { type: "party_role", role: "sponsor", confirmed: true }, scope: "project", paths: ["capital_mandate"] },
    { id: "d3", text: "Basic compliance screen recorded (at least one regulatory requirement)", check: { type: "count_at_least", source: "requirements", min: 1 }, scope: "project", paths: ["capital_mandate"] },
  ] },
  { toStage: "active", conditions: [
    { id: "d1", text: "Engagement agreement executed", check: { type: "count_at_least", source: "deal_contracts", min: 1, where: { lifecycle: ["effective", "active"] } } },
  ] },
];

/** Forward order of tracker stages: moving forward must pass every gate on the way (no skipping Proposal). */
export const DEAL_FLOW = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion", "completed"];

/** Checks the gates for moving an opportunity to a tracker stage (conditions on the deal or its linked project). */
export async function checkDealGate(db: Db, dealId: string, toStage: string) {
  const [d] = await db.select({ mandateId: deals.mandateId, projectId: deals.projectId, path: deals.path, stage: deals.stage }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw new Error("Opportunity not found");
  const from = DEAL_FLOW.indexOf(d.stage), to = DEAL_FLOW.indexOf(toStage);
  const stages = from >= 0 && to > from ? DEAL_FLOW.slice(from + 1, to + 1) : [toStage];
  const gs = await db.select().from(stageGates).where(and(eq(stageGates.mandateId, d.mandateId), eq(stageGates.entityType, "deal"), inArray(stageGates.toStage, stages), eq(stageGates.enabled, true)));
  if (!gs.length) return { gated: false, enforce: "warn" as const, results: [] as Awaited<ReturnType<typeof evaluateProof>>, passed: true };
  const g = { enforce: gs.some(x => x.enforce === "block") ? "block" as const : "warn" as const };
  const seen = new Set<string>();
  const applicable = gs.sort((a, b) => stages.indexOf(a.toStage) - stages.indexOf(b.toStage)).flatMap(x => x.conditions.map(c => ({ ...c, id: `${x.toStage}:${c.id}` })))
    .filter(c => (!c.paths || c.paths.includes(d.path)) && !seen.has(c.text) && (seen.add(c.text), true));
  const results: Awaited<ReturnType<typeof evaluateProof>> = [];
  for (const c of applicable) {
    if (c.scope === "project" && !d.projectId) { results.push({ id: c.id, text: c.text, pass: false, detail: "No project linked to this opportunity" }); continue; }
    const [r] = await evaluateProof(db, [c], c.scope === "project" ? "project" : "deal", c.scope === "project" ? d.projectId : dealId);
    results.push(r);
  }
  return { gated: true, enforce: g.enforce, results, passed: results.every(r => r.pass === true) };
}

export async function ensureRulesAndGates(db: Db, mandateId: string) {
  const existing = await db.select({ name: triggerRules.name }).from(triggerRules).where(eq(triggerRules.mandateId, mandateId));
  for (const r of DEFAULT_RULES) if (!existing.some(e => e.name === r.name)) await db.insert(triggerRules).values({ ...r, mandateId });
  const gates = await db.select({ toStage: stageGates.toStage, entityType: stageGates.entityType }).from(stageGates).where(eq(stageGates.mandateId, mandateId));
  for (const g of DEFAULT_GATES) if (!gates.some(x => x.entityType === "project" && x.toStage === g.toStage)) await db.insert(stageGates).values({ mandateId, toStage: g.toStage, conditions: g.conditions });
  for (const g of DEFAULT_DEAL_GATES) if (!gates.some(x => x.entityType === "deal" && x.toStage === g.toStage)) await db.insert(stageGates).values({ mandateId, entityType: "deal", toStage: g.toStage, conditions: g.conditions });
}

/** Checks the gate for entering a stage. Returns failures; nothing blocks when no enabled gate exists. */
export async function checkStageGate(db: Db, projectId: string, toStage: string) {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const [g] = await db.select().from(stageGates).where(and(eq(stageGates.mandateId, p.mandateId), eq(stageGates.entityType, "project"), eq(stageGates.toStage, toStage), eq(stageGates.enabled, true)));
  if (!g) return { gated: false, enforce: "warn" as const, results: [] as Awaited<ReturnType<typeof evaluateProof>>, passed: true };
  const results = await evaluateProof(db, g.conditions, "project", projectId);
  return { gated: true, enforce: g.enforce, results, passed: results.every(r => r.pass === true) };
}

/** Notifications visible to a user: addressed to them or to everyone in their entities, not resolved, not snoozed. */
export async function openNotifications(db: Db, mandateIds: string[], email: string, now = new Date(), limit = 100) {
  return db.select().from(notifications).where(and(
    sql`${notifications.mandateId} in ${mandateIds.length ? mandateIds : ["-"]}`, isNull(notifications.resolvedAt),
    or(isNull(notifications.recipient), eq(notifications.recipient, email)), or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, now.toISOString())),
  )).orderBy(sql`case ${notifications.priority} when 'critical' then 0 when 'action' then 1 else 2 end`, sql`${notifications.createdAt} desc`).limit(limit);
}

export async function gateOverrideAudit(db: Db, projectId: string, toStage: string, actor: string, reason: string, failed: string[]) {
  await audit(db, { actor, action: "stage_gate_override", entity: "projects", entityId: projectId, after: { toStage, reason, failed } });
}
