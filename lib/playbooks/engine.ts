// Playbook engine (master build instruction §22–23, §44). Runs follow the approved version; tools run only where the
// step's governance allows; "done" is decided by the proof checks; approval steps need a person; corrections become
// draft versions that must be approved to take effect, and a correction seen twice suggests a permanent rule.
import { emitEvent } from "@/lib/events/engine";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalOpportunities, deals, documents, organizations, playbookCorrections, playbookRuns, playbooks, playbookVersions, projects } from "@/db/schema";
import type { StepState } from "@/db/playbooks";
import { audit } from "@/lib/audit";
import { evaluateProof } from "./checks";
import { PLAYBOOK_LIBRARY } from "./library";
import { TOOLS } from "./tools";
import type { PlaybookDefinition } from "./types";

type Scope = "one_time" | "process_rule" | "toolbox_update" | "proof_check";
const STOP = new Set(["the", "and", "for", "with", "was", "were", "that", "this", "from", "not", "but", "are", "has", "had", "have", "its", "into", "our", "you", "they"]);
/** Order- and filler-insensitive signature of a correction, so the same mistake described twice is recognised. */
export const fingerprint = (s: string) => [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)))].sort().join(" ");

/** Seeds the library for an entity once; existing playbooks are never overwritten. */
export async function ensurePlaybooks(db: Db, mandateId: string) {
  let added = 0;
  for (const s of PLAYBOOK_LIBRARY) {
    const [exists] = await db.select({ id: playbooks.id }).from(playbooks).where(and(eq(playbooks.mandateId, mandateId), eq(playbooks.key, s.key)));
    if (exists) continue;
    const [p] = await db.insert(playbooks).values({ mandateId, key: s.key, name: s.name, entityType: s.entityType, isSystem: true }).returning();
    await db.insert(playbookVersions).values({ playbookId: p.id, version: 1, definition: s.def, status: "approved", changeNote: "Initial library version", proposedBy: "system", approvedBy: "system", approvedAt: new Date().toISOString() });
    added++;
  }
  return added;
}

export async function playbookWithDefinition(db: Db, playbookId: string, version?: number) {
  const [p] = await db.select().from(playbooks).where(eq(playbooks.id, playbookId));
  if (!p) throw new Error("Playbook not found");
  const [v] = await db.select().from(playbookVersions).where(and(eq(playbookVersions.playbookId, p.id), eq(playbookVersions.version, version ?? p.currentVersion)));
  if (!v) throw new Error("Version not found");
  return { p, v, def: v.definition };
}

/** The entity's display label; it must belong to the playbook's entity (mandate). */
async function entityLabel(db: Db, entityType: string, entityId: string | null, mandateId: string) {
  if (!entityId) return "";
  const q = entityType === "project" ? db.select({ l: projects.name, m: projects.mandateId }).from(projects).where(eq(projects.id, entityId))
    : entityType === "organization" ? db.select({ l: organizations.name, m: organizations.mandateId }).from(organizations).where(eq(organizations.id, entityId))
    : entityType === "capital_opportunity" ? db.select({ l: capitalOpportunities.title, m: capitalOpportunities.mandateId }).from(capitalOpportunities).where(eq(capitalOpportunities.id, entityId))
    : entityType === "deal" ? db.select({ l: deals.name, m: deals.mandateId }).from(deals).where(eq(deals.id, entityId))
    : entityType === "document" ? db.select({ l: documents.title, m: documents.mandateId }).from(documents).where(eq(documents.id, entityId)) : null;
  const [r] = q ? await q : [];
  if (!r || r.m !== mandateId) throw new Error(`${entityType} not found`);
  return r.l;
}

export async function startRun(db: Db, playbookId: string, entityId: string | null, actor: string) {
  const { p, def } = await playbookWithDefinition(db, playbookId);
  if (p.entityType !== "none" && !entityId) throw new Error(`This playbook runs on a ${p.entityType}`);
  const label = p.entityType === "none" ? "" : await entityLabel(db, p.entityType, entityId, p.mandateId);
  const steps: StepState[] = def.steps.map(s => ({ key: s.key, status: "todo", note: "", by: null, at: null }));
  const [r] = await db.insert(playbookRuns).values({ mandateId: p.mandateId, playbookId: p.id, version: p.currentVersion, entityType: p.entityType, entityId, entityLabel: label, steps, startedBy: actor }).returning();
  await audit(db, { actor, action: "playbook_run_started", entity: "playbook_runs", entityId: r.id, after: { playbook: p.key, entityId } });
  return r;
}

async function loadRun(db: Db, runId: string) {
  const [run] = await db.select().from(playbookRuns).where(eq(playbookRuns.id, runId));
  if (!run) throw new Error("Run not found");
  const { p, def } = await playbookWithDefinition(db, run.playbookId, run.version);
  return { run, p, def };
}

function patchStep(steps: StepState[], key: string, patch: Partial<StepState>) {
  return steps.map(s => (s.key === key ? { ...s, ...patch } : s));
}

/** Runs the step's tool. Only autonomous steps are completed by a tool; others keep the output and wait for a person. */
export async function runStepTool(db: Db, runId: string, stepKey: string, actor: string, now = new Date()) {
  const { run, def } = await loadRun(db, runId);
  const s = def.steps.find(x => x.key === stepKey);
  if (!s?.tool) throw new Error("This step has no tool");
  const tool = TOOLS[s.tool];
  if (!tool) throw new Error(`Tool ${s.tool} is not available`);
  if (!run.entityId || tool.entity !== run.entityType) throw new Error("Tool does not apply to this entity");
  const r = await tool.run(db, run.entityId, now);
  const done = r.ok && s.governance === "autonomous";
  if (!r.ok) await emitEvent(db, { mandateId: run.mandateId, type: "PLAYBOOK_FAILED", entityType: "playbook_run", entityId: run.id, payload: { name: `${s.title} (${run.entityLabel})`, summary: r.note }, actor });
  await db.update(playbookRuns).set({ steps: patchStep(run.steps, stepKey, { status: done ? "done" : r.ok ? "todo" : "failed", note: r.note, by: done ? `tool:${s.tool}` : null, at: now.toISOString() }), updatedAt: now.toISOString() }).where(eq(playbookRuns.id, run.id));
  return { ...r, done };
}

/** A person completes, skips or reopens a step. Approval steps are only completed through approveRun. */
export async function setStep(db: Db, runId: string, stepKey: string, status: StepState["status"], note: string, actor: string, now = new Date()) {
  const { run, def } = await loadRun(db, runId);
  const s = def.steps.find(x => x.key === stepKey);
  if (!s) throw new Error("Unknown step");
  if (s.governance === "approval" && status === "done") throw new Error("Approval steps are completed by approving the run");
  await db.update(playbookRuns).set({ steps: patchStep(run.steps, stepKey, { status, note: note || run.steps.find(x => x.key === stepKey)?.note || "", by: actor, at: now.toISOString() }), updatedAt: now.toISOString() }).where(eq(playbookRuns.id, run.id));
}

/** Evaluates the definition of done. All pass → awaiting approval (if the playbook has approval steps) or completed. */
export async function verifyRun(db: Db, runId: string, confirmedManual: string[], actor: string, now = new Date()) {
  const { run, def } = await loadRun(db, runId);
  const checks = await evaluateProof(db, def.proof, run.entityType, run.entityId, new Set(confirmedManual));
  const allPass = checks.every(c => c.pass === true);
  const needsApproval = def.steps.some(s => s.governance === "approval");
  const openSteps = run.steps.filter(s => s.status === "todo" && def.steps.find(d => d.key === s.key)?.governance !== "approval");
  const status = !allPass || openSteps.length ? "needs_review" : needsApproval ? "awaiting_approval" : "completed";
  await db.update(playbookRuns).set({ checks, status, reviewedBy: actor, completedAt: status === "completed" ? now.toISOString() : null, updatedAt: now.toISOString() }).where(eq(playbookRuns.id, run.id));
  if (status === "completed") await emitEvent(db, { mandateId: run.mandateId, type: "PLAYBOOK_COMPLETED", entityType: "playbook_run", entityId: run.id, payload: { name: def.purpose.slice(0, 80), entity: run.entityLabel }, actor });
  return { status, checks, openSteps: openSteps.map(s => s.key) };
}

export async function approveRun(db: Db, runId: string, actor: string, now = new Date()) {
  const { run, def } = await loadRun(db, runId);
  if (run.status !== "awaiting_approval") throw new Error("Only a verified run awaiting approval can be approved");
  const steps = run.steps.map(s => (def.steps.find(d => d.key === s.key)?.governance === "approval" ? { ...s, status: "done" as const, by: actor, at: now.toISOString() } : s));
  await db.update(playbookRuns).set({ steps, status: "completed", approvedBy: actor, completedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(playbookRuns.id, run.id));
  await audit(db, { actor, action: "playbook_run_approved", entity: "playbook_runs", entityId: run.id });
}

/** Records a correction. Anything beyond one-time becomes a draft version for approval; the live version is untouched. */
export async function recordCorrection(db: Db, input: { playbookId: string; runId?: string | null; layer: "process" | "toolbox" | "proof"; scope: Scope; description: string; change: string }, actor: string) {
  const { p, def } = await playbookWithDefinition(db, input.playbookId);
  const fp = fingerprint(input.description);
  let proposedVersion: number | null = null;
  if (input.scope !== "one_time") {
    if (!input.change.trim()) throw new Error("Describe the change to the playbook");
    const next: PlaybookDefinition = structuredClone(def);
    if (input.scope === "process_rule") next.rules.push({ id: `r${next.rules.length + 1}`, text: input.change.trim(), origin: `correction: ${input.description.slice(0, 120)}` });
    if (input.scope === "toolbox_update") next.toolbox.push({ kind: "reference", name: input.change.trim() });
    if (input.scope === "proof_check") next.proof.push({ id: `p${next.proof.length + 1}`, text: input.change.trim(), check: { type: "manual" } });
    const [{ max }] = await db.select({ max: sql<number>`max(${playbookVersions.version})` }).from(playbookVersions).where(eq(playbookVersions.playbookId, p.id));
    proposedVersion = Number(max) + 1;
    await db.insert(playbookVersions).values({ playbookId: p.id, version: proposedVersion, definition: next, status: "draft", changeNote: `${input.scope.replace("_", " ")}: ${input.change.trim()}`, proposedBy: actor });
  }
  const [c] = await db.insert(playbookCorrections).values({ mandateId: p.mandateId, playbookId: p.id, runId: input.runId ?? null, failureLayer: input.layer, scope: input.scope, description: input.description, change: input.change, fingerprint: fp, proposedVersion, createdBy: actor }).returning();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(playbookCorrections).where(and(eq(playbookCorrections.playbookId, p.id), eq(playbookCorrections.fingerprint, fp)));
  await audit(db, { actor, action: "playbook_correction", entity: "playbook_corrections", entityId: c.id, after: { scope: input.scope, layer: input.layer, proposedVersion } });
  return { correction: c, proposedVersion, repeated: Number(n) >= 2 };
}

/** Promotes a draft version: it becomes current and the previous one is superseded. */
export async function promoteVersion(db: Db, playbookId: string, version: number, actor: string, now = new Date()) {
  const [v] = await db.select().from(playbookVersions).where(and(eq(playbookVersions.playbookId, playbookId), eq(playbookVersions.version, version)));
  if (!v || v.status !== "draft") throw new Error("Only a draft version can be promoted");
  await db.update(playbookVersions).set({ status: "superseded" }).where(and(eq(playbookVersions.playbookId, playbookId), eq(playbookVersions.status, "approved")));
  await db.update(playbookVersions).set({ status: "approved", approvedBy: actor, approvedAt: now.toISOString() }).where(eq(playbookVersions.id, v.id));
  await db.update(playbooks).set({ currentVersion: version, updatedAt: now.toISOString() }).where(eq(playbooks.id, playbookId));
  await audit(db, { actor, action: "playbook_version_promoted", entity: "playbooks", entityId: playbookId, after: { version } });
}

export async function rejectVersion(db: Db, playbookId: string, version: number, actor: string) {
  await db.update(playbookVersions).set({ status: "rejected" }).where(and(eq(playbookVersions.playbookId, playbookId), eq(playbookVersions.version, version), eq(playbookVersions.status, "draft")));
  await audit(db, { actor, action: "playbook_version_rejected", entity: "playbooks", entityId: playbookId, after: { version } });
}

/** One-time corrections that recur (same fingerprint twice or more): candidates for a permanent rule. */
export async function repeatedCorrections(db: Db, playbookId: string) {
  return db.select({ fingerprint: playbookCorrections.fingerprint, n: sql<number>`count(*)`, example: sql<string>`max(${playbookCorrections.description})` }).from(playbookCorrections)
    .where(and(eq(playbookCorrections.playbookId, playbookId), eq(playbookCorrections.scope, "one_time"))).groupBy(playbookCorrections.fingerprint).having(sql`count(*) >= 2`);
}

export async function recentRuns(db: Db, mandateIds: string[], limit = 50) {
  return db.select({ r: playbookRuns, name: playbooks.name }).from(playbookRuns).innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId))
    .where(sql`${playbookRuns.mandateId} in ${mandateIds.length ? mandateIds : ["-"]}`).orderBy(desc(playbookRuns.updatedAt)).limit(limit);
}
