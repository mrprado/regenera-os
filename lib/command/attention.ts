// Command → Needs attention (master build instruction §07): one ranked list across modules. Each item says what,
// why it matters, who owns it, when, where the evidence is, and what to do. Ranked by severity, then due date.
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { pathwayAlerts } from "@/lib/capital/pathways";
import { authSessions, capitalProfiles, capitalRequirements, deals, documentRequests, events, playbookRuns, playbooks, projects, risks, tasks } from "@/db/schema";
import { obligationAlerts } from "@/lib/contracts/register";
import { deliveryAlerts } from "@/lib/delivery/engine";
import { openNotifications } from "@/lib/events/engine";
import { procurementAlerts } from "@/lib/procurement/engine";
import { projectAlerts } from "@/lib/projects/engine";
import { regulatoryAlerts } from "@/lib/regulatory/engine";

export type AttentionItem = {
  key: string; entity: string; issue: string; severity: "critical" | "high" | "medium" | "low"; why: string;
  owner: string | null; due: string | null; source: string; href: string; category: string;
};
const RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

type Precomputed = {
  pa: Awaited<ReturnType<typeof projectAlerts>>; del: Awaited<ReturnType<typeof deliveryAlerts>>; proc: Awaited<ReturnType<typeof procurementAlerts>>;
  reg: Awaited<ReturnType<typeof regulatoryAlerts>>; obl: Awaited<ReturnType<typeof obligationAlerts>>;
};

/** Pass the alerts a page already computed (Today does) to avoid running the same queries twice. */
export async function needsAttention(db: Db, mandateIds: string[], email: string, now = new Date(), pre?: Precomputed): Promise<AttentionItem[]> {
  const today = now.toISOString().slice(0, 10);
  const scope = (col: Parameters<typeof inArray>[0]) => inArray(col, mandateIds.length ? mandateIds : ["-"]);
  const [pa, del, proc, reg, obl, notes] = await Promise.all([
    pre?.pa ?? projectAlerts(db, mandateIds, now), pre?.del ?? deliveryAlerts(db, mandateIds, now), pre?.proc ?? procurementAlerts(db, mandateIds, now),
    pre?.reg ?? regulatoryAlerts(db, mandateIds, now), pre?.obl ?? obligationAlerts(db, mandateIds, now), openNotifications(db, mandateIds, email, now, 50),
  ]);
  const pathways = await pathwayAlerts(db, mandateIds, today);
  const [overdueTasks, failedRuns, openRequests] = await Promise.all([
    db.select({ t: tasks, project: projects.name }).from(tasks).leftJoin(projects, eq(projects.id, tasks.projectId)).where(and(scope(tasks.mandateId), eq(tasks.status, "open"), lte(tasks.dueAt, today))).orderBy(asc(tasks.dueAt)).limit(15),
    db.select({ r: playbookRuns, name: playbooks.name }).from(playbookRuns).innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId)).where(and(scope(playbookRuns.mandateId), inArray(playbookRuns.status, ["needs_review", "failed", "awaiting_approval"]))).orderBy(desc(playbookRuns.updatedAt)).limit(10),
    db.select({ q: documentRequests, project: projects.name }).from(documentRequests).leftJoin(projects, eq(projects.id, documentRequests.projectId)).where(and(scope(documentRequests.mandateId), inArray(documentRequests.status, ["open", "submitted"]))).orderBy(asc(documentRequests.dueDate)).limit(15),
  ]);

  const items: AttentionItem[] = [];
  for (const b of pa.blocked) items.push({ key: `blk:${b.projectId}:${b.why}`, entity: b.name, issue: b.why, severity: /critical/.test(b.why) ? "critical" : "high", why: "Blocks project progress", owner: null, due: null, source: "Constraints / readiness", href: `/projects/${b.projectId}?tab=constraints`, category: "Project" });
  for (const c of pa.capitalNow) items.push({ key: `cap:${c.projectId}:${c.purpose}`, entity: c.name, issue: `Capital gap: ${c.purpose}, ${c.currency} ${Math.round(c.gap).toLocaleString("en-US")}`, severity: c.targetClose < today ? "high" : "medium", why: `Target close ${c.targetClose}`, owner: null, due: c.targetClose, source: "Capital requirements", href: `/projects/${c.projectId}?tab=capital`, category: "Capital" });
  for (const m of del.milestones) items.push({ key: `ms:${m.id}`, entity: m.project, issue: `${m.why}: ${m.name}`, severity: m.red ? "high" : "medium", why: "Milestone on the plan", owner: null, due: m.dueDate, source: "Plan", href: `/projects/${m.projectId}?tab=plan`, category: "Project" });
  for (const x of del.decisions) items.push({ key: `dec:${x.id}`, entity: x.project, issue: `Decision needed: ${x.title}`, severity: x.overdue ? "high" : "medium", why: "Open decision", owner: null, due: x.dueDate, source: "Decision log", href: `/projects/${x.projectId}?tab=plan`, category: "Project" });
  for (const x of del.missingEngineering) items.push({ key: `eng:${x.projectId}`, entity: x.project, issue: `Missing studies: ${x.missing.join(", ").replace(/_/g, " ")}`, severity: "medium", why: "Engineering information expected at this stage", owner: null, due: null, source: "Engineering", href: `/projects/${x.projectId}?tab=engineering`, category: "Project" });
  for (const x of del.es) items.push({ key: `es:${x.id}`, entity: x.project, issue: `E&S: ${x.description}`, severity: x.severity === "critical" ? "critical" : "high", why: `${x.topic.replace(/_/g, " ")} issue open`, owner: null, due: null, source: "E&S register", href: `/projects/${x.projectId}?tab=risk`, category: "Compliance" });
  for (const x of del.insurance) items.push({ key: `ins:${x.id}`, entity: x.project, issue: `${x.why}: ${x.type.toUpperCase()}`, severity: x.why === "Expired" || x.why === "Lapsed" ? "high" : "medium", why: "Insurance cover", owner: null, due: x.date, source: "Insurance", href: `/projects/${x.projectId}?tab=risk`, category: "Contract" });
  for (const x of proc.bidsDue) items.push({ key: `bid:${x.id}`, entity: x.project, issue: `Bids due: ${x.name}`, severity: "medium", why: "Procurement deadline", owner: null, due: x.date, source: "Procurement", href: `/projects/${x.projectId}?tab=procurement&pkg=${x.id}`, category: "Project" });
  for (const x of proc.awardLate) items.push({ key: `awd:${x.id}`, entity: x.project, issue: `Award overdue: ${x.name}`, severity: "high", why: "Award target passed", owner: null, due: x.date, source: "Procurement", href: `/projects/${x.projectId}?tab=procurement&pkg=${x.id}`, category: "Project" });
  for (const x of proc.leadTime) items.push({ key: `lt:${x.id}`, entity: x.project, issue: `${x.name}: ${x.why}`, severity: "high", why: "Supply arrives after it is needed", owner: null, due: null, source: "Procurement", href: `/projects/${x.projectId}?tab=procurement&pkg=${x.id}`, category: "Project" });
  for (const x of reg.permitsExpiring) items.push({ key: `pmt:${x.id}`, entity: x.project, issue: `${x.expired ? "Permit expired" : "Permit expires"}: ${x.name}`, severity: x.expired ? "critical" : "high", why: "Permit validity", owner: null, due: x.expiresAt, source: "Permits", href: `/projects/${x.projectId}?tab=regulatory`, category: "Compliance" });
  for (const x of reg.verificationsDue) items.push({ key: `ver:${x.id}`, entity: x.project, issue: `Re-verify: ${x.title}`, severity: "medium", why: "Requirement due for re-verification", owner: null, due: x.nextVerification, source: "Regulatory requirements", href: `/projects/${x.projectId}?tab=regulatory`, category: "Compliance" });
  for (const x of reg.counselReview) items.push({ key: `cns:${x.id}`, entity: x.project, issue: `Waiting for counsel: ${x.title}`, severity: "medium", why: "Counsel review", owner: null, due: null, source: "Regulatory requirements", href: `/projects/${x.projectId}?tab=regulatory`, category: "Compliance" });
  for (const o of obl.due) items.push({ key: `obl:${o.id}`, entity: o.contractTitle, issue: `${o.overdue ? "Overdue obligation" : "Obligation due"}: ${o.obligation}`, severity: o.overdue ? "critical" : "high", why: o.riskIfMissed || "Contractual obligation", owner: o.responsibleParty, due: o.dueDate, source: "Agreement register", href: `/contracts/${o.contractId}`, category: "Contract" });
  for (const e of obl.expiring) items.push({ key: `exp:${e.id}`, entity: e.title, issue: "Agreement expiring", severity: "medium", why: "Renewal or replacement needed", owner: null, due: e.endDate, source: "Agreement register", href: `/contracts/${e.id}`, category: "Contract" });
  for (const t of overdueTasks) items.push({ key: `tsk:${t.t.id}`, entity: t.project ?? "Action", issue: `Overdue: ${t.t.title}`, severity: "medium", why: "Follow-up past due", owner: null, due: t.t.dueAt.slice(0, 10), source: "Actions", href: t.t.projectId ? `/projects/${t.t.projectId}` : "/tasks", category: "Relationship" });
  for (const r of failedRuns) items.push({ key: `run:${r.r.id}`, entity: r.r.entityLabel || r.name, issue: `${r.name}: ${r.r.status.replace(/_/g, " ")}`, severity: r.r.status === "failed" ? "high" : "medium", why: "Playbook definition of done not met or approval pending", owner: r.r.startedBy, due: null, source: "Playbooks", href: `/playbooks/runs/${r.r.id}`, category: "Playbook" });
  for (const q of openRequests) items.push({ key: `req:${q.q.id}`, entity: q.project ?? "Request", issue: `${q.q.status === "submitted" ? "Document submitted, review it" : "Missing document"}: ${q.q.title}`, severity: q.q.dueDate && q.q.dueDate < today ? "high" : "medium", why: q.q.status === "submitted" ? "Portal response waiting" : "Requested information not received", owner: null, due: q.q.dueDate, source: "Document requests", href: "/portals?tab=requests", category: "Document" });
  for (const x of pathways) items.push({ key: `fp:${x.id}`, entity: x.detail.split(":")[0].split(" · ").pop() ?? "Funding pathway", issue: x.title, severity: x.severity, why: x.detail, owner: x.owner, due: x.due, source: "Funding pathways", href: `/projects/${x.projectId}?tab=pathways`, category: "Capital" });
  for (const n of notes.filter(x => x.priority !== "information")) items.push({ key: `ntf:${n.id}`, entity: n.category, issue: n.title, severity: n.priority === "critical" ? "critical" : "medium", why: n.body || "Notification", owner: n.assignedTo, due: null, source: "Notifications", href: n.link ?? "/notifications", category: n.category });

  const seen = new Set<string>();
  return items.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

/** The operating strip (§07): projects, active opportunities, capital in pipeline, investor relationships, critical risks. */
export async function operatingStrip(db: Db, mandateIds: string[]) {
  const scope = (col: Parameters<typeof inArray>[0]) => inArray(col, mandateIds.length ? mandateIds : ["-"]);
  const [[p], [d], cap, [inv], [risk]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(projects).where(and(scope(projects.mandateId), isNull(projects.archivedAt), ne(projects.status, "dropped"))),
    db.select({ n: sql<number>`count(*)` }).from(deals).where(and(scope(deals.mandateId), isNull(deals.archivedAt), notInArray(deals.stage, ["lost", "signed"]))),
    db.select({ currency: capitalRequirements.currency, gap: sql<number>`sum(max(0, coalesce(${capitalRequirements.target}, 0) - ${capitalRequirements.secured}))` }).from(capitalRequirements)
      .where(and(scope(capitalRequirements.mandateId), notInArray(capitalRequirements.status, ["closed", "cancelled"]))).groupBy(capitalRequirements.currency),
    db.select({ n: sql<number>`count(*)` }).from(capitalProfiles).where(and(scope(capitalProfiles.mandateId), isNull(capitalProfiles.archivedAt))),
    db.select({ n: sql<number>`count(*)` }).from(risks).where(and(scope(risks.mandateId), ne(risks.status, "closed"), inArray(risks.impact, ["high", "severe"]), inArray(risks.likelihood, ["possible", "likely", "almost_certain"]))),
  ]);
  return { projects: p.n, deals: d.n, capital: cap.filter(c => c.gap > 0).sort((a, b) => b.gap - a.gap), investors: inv.n, criticalRisks: risk.n };
}

/** What changed since the previous session (§07 AI brief without AI): events since then, each with its source link. */
export async function changesSinceLastSession(db: Db, mandateIds: string[], email: string, now = new Date()) {
  const sessions = await db.select({ at: authSessions.createdAt }).from(authSessions).where(and(eq(authSessions.email, email), lte(authSessions.createdAt, now.toISOString()))).orderBy(desc(authSessions.createdAt)).limit(2);
  const since = sessions[1]?.at ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = await db.select().from(events).where(and(inArray(events.mandateId, mandateIds.length ? mandateIds : ["-"]), gt(events.at, since), or(isNull(events.actor), ne(events.actor, email)))).orderBy(desc(events.at)).limit(40);
  return { since, events: rows };
}
