// Command as the founder's daily decision desk (phase 15 §3). Answers: who to pursue, which conversations need me, what
// could close, what blocks delivery, what changed, and whether the system can do what is asked. Every item links to the
// exact record. Money is never added across kinds: Regenera fee pipeline, weighted forecast, signed / invoiced /
// collected revenue, project capital and grant values stay separate, each with its currency and definition.
// Test records (test_record = 1) never reach these queues or metrics.
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { accountQualifications, contacts, contracts, deals, meetingBriefs, organizations, projects, replies, tasks } from "@/db/schema";
import { DEAL_STAGES } from "@/lib/vocab";
import type { AttentionItem } from "./attention";

export const COMMAND_TZ = "America/Merida";
/** Calendar date (YYYY-MM-DD) in the workspace time zone; "today" means this date, not a UTC slice. */
export const localDate = (d: Date, tz = COMMAND_TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export type Bucket = "overdue" | "today" | "upcoming" | "blocked" | "later";
export type Priority = {
  key: string; type: string; record: string; href: string; reason: string; severity: "critical" | "high" | "medium" | "low"; basis: string;
  owner: string | null; due: string | null; action: string; workstream: string | null; workstreamLabel: string | null; taskId?: string;
};
export type PriorityGroup = { key: string; label: string; href: string; bucket: Bucket; items: Priority[]; due: string | null; overdueDays: number | null; severity: Priority["severity"] };

const SEV = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function bucketOf(due: string | null, today: string, blocked = false): Bucket {
  if (blocked && !due) return "blocked";
  if (!due) return "later";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return daysBetween(today, due) <= 7 ? "upcoming" : "later";
}

/** Groups items of one workstream (one bid, one deal, one project) into a single expandable entry, bucketed by the
 *  earliest due date; the group keeps its worst severity. Items without a workstream stay on their own. */
export function groupPriorities(items: Priority[], today: string): Record<Bucket, PriorityGroup[]> {
  const groups = new Map<string, PriorityGroup>();
  for (const it of items) {
    const key = it.workstream ?? `single:${it.key}`;
    let g = groups.get(key);
    if (!g) { g = { key, label: it.workstream ? (it.workstreamLabel ?? it.record) : it.record, href: it.href, bucket: "later", items: [], due: null, overdueDays: null, severity: it.severity }; groups.set(key, g); }
    g.items.push(it);
    if (it.due && (!g.due || it.due < g.due)) g.due = it.due;
    if (SEV[it.severity] < SEV[g.severity]) g.severity = it.severity;
  }
  const out: Record<Bucket, PriorityGroup[]> = { overdue: [], today: [], upcoming: [], blocked: [], later: [] };
  for (const g of groups.values()) {
    g.items.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || SEV[a.severity] - SEV[b.severity]);
    g.bucket = bucketOf(g.due, today, g.items.some(i => i.type === "Blocker"));
    g.overdueDays = g.bucket === "overdue" && g.due ? daysBetween(g.due, today) : null;
    out[g.bucket].push(g);
  }
  for (const b of Object.keys(out) as Bucket[]) out[b].sort((x, y) => SEV[x.severity] - SEV[y.severity] || (x.due ?? "9999").localeCompare(y.due ?? "9999"));
  return out;
}

const OPEN_DEAL = ["lead", "contacted", "engaged", "call_booked", "proposal", "nurture"] as const;
/** Stages that mean a person qualified the opportunity (beyond first contact). */
export const QUALIFIED_STAGES = ["engaged", "call_booked", "proposal"] as const;

export async function commandDesk(db: Db, mandateIds: string[], now: Date, attention: AttentionItem[]) {
  const ids = mandateIds.length ? mandateIds : ["-"];
  const today = localDate(now);
  const week = localDate(new Date(now.getTime() + 7 * 86_400_000));
  const [taskRows, dealRows, replyRows, meetingRows, contractRows, [{ projectCount }], prospectRows] = await Promise.all([
    db.select({ t: tasks, dealName: deals.name, projectName: projects.name, orgName: organizations.name, contactName: contacts.fullName }).from(tasks)
      .leftJoin(deals, eq(deals.id, tasks.dealId)).leftJoin(projects, eq(projects.id, tasks.projectId)).leftJoin(organizations, eq(organizations.id, tasks.orgId)).leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .where(and(inArray(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false), lte(tasks.dueAt, `${week}T23:59:59Z`))).orderBy(asc(tasks.dueAt)).limit(200),
    db.select({ d: deals, orgName: organizations.name }).from(deals).leftJoin(organizations, eq(organizations.id, deals.orgId))
      .where(and(inArray(deals.mandateId, ids), isNull(deals.archivedAt), eq(deals.testRecord, false), inArray(deals.stage, [...OPEN_DEAL]))).limit(500),
    db.select({ r: replies, contactName: contacts.fullName, orgName: organizations.name, orgId: organizations.id }).from(replies)
      .leftJoin(contacts, eq(contacts.id, replies.contactId)).leftJoin(organizations, eq(organizations.id, replies.orgId))
      .where(and(inArray(replies.mandateId, ids), eq(replies.handled, false), eq(replies.testRecord, false), or(isNull(contacts.testRecord), eq(contacts.testRecord, false)),
        or(isNull(replies.classification), notInArray(replies.classification, ["out_of_office", "bounce", "unsubscribe"])))).orderBy(desc(replies.receivedAt)).limit(30),
    db.select({ b: meetingBriefs, contactName: contacts.fullName, orgName: organizations.name }).from(meetingBriefs)
      .leftJoin(contacts, eq(contacts.id, meetingBriefs.contactId)).leftJoin(organizations, eq(organizations.id, meetingBriefs.orgId))
      .where(and(inArray(meetingBriefs.mandateId, ids), gte(meetingBriefs.startsAt, now.toISOString()), lte(meetingBriefs.startsAt, new Date(now.getTime() + 7 * 86_400_000).toISOString()))).orderBy(asc(meetingBriefs.startsAt)).limit(10),
    db.select({ id: contracts.id, title: contracts.title, status: contracts.status, updatedAt: contracts.updatedAt, dealId: contracts.dealId }).from(contracts)
      .where(and(inArray(contracts.mandateId, ids), eq(contracts.status, "sent"))).orderBy(asc(contracts.updatedAt)).limit(20),
    db.select({ projectCount: sql<number>`count(*)` }).from(projects).where(and(inArray(projects.mandateId, ids), isNull(projects.archivedAt), ne(projects.status, "dropped"))),
    db.select({ q: accountQualifications, name: organizations.name }).from(accountQualifications).innerJoin(organizations, eq(organizations.id, accountQualifications.orgId))
      .where(and(inArray(accountQualifications.mandateId, ids), eq(organizations.testRecord, false), inArray(accountQualifications.status, ["criteria_matched", "human_reviewed", "ready_for_outreach"]))).orderBy(desc(accountQualifications.updatedAt)).limit(200),
  ]);

  // Priorities: tasks (grouped by workstream), deals with overdue or missing next actions, ranked attention items.
  const items: Priority[] = [];
  for (const { t, dealName, projectName, orgName, contactName } of taskRows) {
    const ws = t.workstream ? `ws:${t.workstream}` : t.dealId ? `deal:${t.dealId}` : t.projectId ? `project:${t.projectId}` : null;
    const wsLabel = t.workstream ?? (dealName ? `Opportunity: ${dealName}` : projectName ? `Project: ${projectName}` : null);
    const href = t.dealId ? `/deals/${t.dealId}` : t.projectId ? `/projects/${t.projectId}?tab=plan` : t.contactId ? `/people/${t.contactId}` : t.orgId ? `/companies/${t.orgId}` : `/tasks?focus=${t.id}#task-${t.id}`;
    items.push({ key: `task:${t.id}`, type: "Task", record: dealName ?? projectName ?? contactName ?? orgName ?? "Task", href, reason: t.title, severity: "medium",
      basis: t.dueAt.slice(0, 10) < today ? "Past its due date" : "Due within 7 days", owner: t.owner, due: t.dueAt.slice(0, 10), action: t.title, workstream: ws, workstreamLabel: wsLabel, taskId: t.id });
  }
  for (const { d, orgName } of dealRows) {
    const stage = DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES];
    if (!d.nextAction?.trim()) items.push({ key: `deal-next:${d.id}`, type: "Opportunity", record: d.name, href: `/deals/${d.id}`, reason: `${stage} with no next action recorded${orgName ? ` · ${orgName}` : ""}`, severity: d.stage === "proposal" ? "high" : "medium", basis: "Open opportunity without a next action", owner: null, due: null, action: "Set the next action and date", workstream: `deal:${d.id}`, workstreamLabel: `Opportunity: ${d.name}` });
    else if (d.nextActionDate && d.nextActionDate <= week) items.push({ key: `deal-due:${d.id}`, type: "Opportunity", record: d.name, href: `/deals/${d.id}`, reason: `${stage}${orgName ? ` · ${orgName}` : ""}`, severity: d.stage === "proposal" ? "high" : "medium", basis: d.nextActionDate < today ? "Next action past due" : "Next action due this week", owner: null, due: d.nextActionDate, action: d.nextAction, workstream: `deal:${d.id}`, workstreamLabel: `Opportunity: ${d.name}` });
  }
  for (const a of attention.filter(x => x.severity === "critical" || x.severity === "high")) {
    if (a.key.startsWith("tsk:")) continue; // tasks come from the task list above, grouped
    const blocked = a.key.startsWith("blk:") || a.key.startsWith("lt:") || a.key.startsWith("es:");
    items.push({ key: `att:${a.key}`, type: blocked ? "Blocker" : a.category, record: a.entity, href: a.href, reason: a.issue, severity: a.severity, basis: `${a.why} (${a.source})`, owner: a.owner, due: a.due, action: a.issue, workstream: a.href.match(/^\/projects\/([^/?]+)/) ? `project:${a.href.match(/^\/projects\/([^/?]+)/)![1]}` : null, workstreamLabel: a.href.startsWith("/projects/") ? `Project: ${a.entity}` : null });
  }
  const priorities = groupPriorities(items, today);

  // Conversations and revenue.
  const interested = replyRows.filter(r => r.r.classification === "interested" || r.r.classification === "question");
  const introductions = replyRows.filter(r => r.r.classification === "referral");
  const unclassified = replyRows.filter(r => !r.r.classification);
  const proposals = dealRows.filter(x => x.d.stage === "proposal");
  const needsPrep = meetingRows.filter(m => !m.b.brief);
  const qualified = dealRows.filter(x => (QUALIFIED_STAGES as readonly string[]).includes(x.d.stage));
  const fee = (rows: typeof dealRows) => ({ value: rows.reduce((s, x) => s + (x.d.valueEstimate ?? 0), 0), valued: rows.filter(x => x.d.valueEstimate != null).length, count: rows.length });
  const withProb = qualified.filter(x => x.d.probability != null && x.d.valueEstimate != null);
  const pipeline = (Object.keys(DEAL_STAGES) as (keyof typeof DEAL_STAGES)[]).filter(s => (OPEN_DEAL as readonly string[]).includes(s)).map(s => {
    const rows = dealRows.filter(x => x.d.stage === s);
    return { stage: s, label: DEAL_STAGES[s], count: rows.length, value: rows.reduce((a, x) => a + (x.d.valueEstimate ?? 0), 0), unvalued: rows.filter(x => x.d.valueEstimate == null).length };
  });

  return {
    today, priorities, projectCount,
    summary: {
      qualifiedPipeline: { ...fee(qualified), currency: "USD", definition: "Sum of estimated Regenera fees on open opportunities a person moved to Engaged, Call booked or Proposal. Excludes project capital, grant values and test records." },
      weighted: withProb.length >= 3 ? { value: withProb.reduce((s, x) => s + (x.d.valueEstimate ?? 0) * (x.d.probability ?? 0) / 100, 0), basis: withProb.length, of: qualified.length } : null,
      interestedReplies: interested.length + introductions.length,
      proposals: { ...fee(proposals), contractsAwaiting: contractRows.length },
    },
    conversations: { interested, introductions, unclassified, needsPrep, meetings: meetingRows, contractsAwaiting: contractRows },
    revenue: {
      proposals: proposals.map(x => ({ id: x.d.id, name: x.d.name, org: x.orgName, value: x.d.valueEstimate, next: x.d.nextAction, nextDate: x.d.nextActionDate, close: x.d.expectedClose })),
      stalled: dealRows.filter(x => !x.d.nextAction?.trim() || (x.d.nextActionDate != null && x.d.nextActionDate < today)).map(x => ({ id: x.d.id, name: x.d.name, org: x.orgName, stage: x.d.stage, next: x.d.nextAction, nextDate: x.d.nextActionDate })),
    },
    pipeline,
    prospects: prospectRows.map(p => ({ orgId: p.q.orgId, name: p.name, status: p.q.status, next: p.q.nextAction })),
  };
}
