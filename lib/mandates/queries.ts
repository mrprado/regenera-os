// Scoped reads for Mandates, Pursuits and Approvals (docs/plans/phase-14-mandates.md). Every query filters on the
// user's workspaces through mandateCondition. Economics and desk P&L are Regenera-internal (checked by callers).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { approvals, commercialMandates, constraints, documents, mandateCandidates, mandateSignals, organizations, permits, projectReadiness, projects, pursuits, queueProjects } from "@/db/schema";
import { mandateCondition, type UserScope } from "@/lib/db/scoped";
import { funnelLevels, probabilityOf } from "./fit";
import type { SimFacts } from "./simulation";
import { STAGE_ORDER, type CandidateStage, type ClientResponse, type PursuitType } from "./vocab";

export async function mandatesFor(db: Db, scope: UserScope, f: { type?: string; status?: string; desk?: string; q?: string } = {}) {
  const where = [mandateCondition(scope, commercialMandates.mandateId)];
  if (f.type) where.push(eq(commercialMandates.type, f.type));
  if (f.status) where.push(eq(commercialMandates.status, f.status));
  if (f.desk) where.push(eq(commercialMandates.desk, f.desk));
  if (f.q) where.push(sql`lower(${commercialMandates.name} || ' ' || ${commercialMandates.clientName}) like ${`%${f.q.toLowerCase()}%`}`);
  const ms = await db.select().from(commercialMandates).where(and(...where)).orderBy(asc(commercialMandates.status), desc(commercialMandates.updatedAt));
  if (!ms.length) return [];
  const counts = await db.select({ cm: mandateCandidates.commercialMandateId, stage: mandateCandidates.stage, n: sql<number>`count(*)` }).from(mandateCandidates)
    .where(inArray(mandateCandidates.commercialMandateId, ms.slice(0, 90).map(m => m.id))).groupBy(mandateCandidates.commercialMandateId, mandateCandidates.stage);
  const purs = await db.select({ cm: pursuits.commercialMandateId, outcome: pursuits.outcome, n: sql<number>`count(*)` }).from(pursuits).where(inArray(pursuits.commercialMandateId, ms.slice(0, 90).map(m => m.id))).groupBy(pursuits.commercialMandateId, pursuits.outcome);
  return ms.map(m => {
    const c = counts.filter(x => x.cm === m.id);
    const at = (s: CandidateStage) => c.filter(x => STAGE_ORDER.indexOf(x.stage as CandidateStage) >= STAGE_ORDER.indexOf(s)).reduce((a, x) => a + x.n, 0);
    return { m, universe: c.reduce((a, x) => a + x.n, 0), matched: at("matched"), preQualified: at("pre_qualified"), qualified: at("qualified"), approved: at("approved"), pursuitsOpen: purs.filter(p => p.cm === m.id && p.outcome === "open").reduce((a, x) => a + x.n, 0), won: purs.filter(p => p.cm === m.id && p.outcome === "won").reduce((a, x) => a + x.n, 0) };
  });
}

export async function mandateById(db: Db, scope: UserScope, id: string) {
  const [m] = await db.select().from(commercialMandates).where(and(eq(commercialMandates.id, id), mandateCondition(scope, commercialMandates.mandateId)));
  return m ?? null;
}

type CandFilter = { stage?: string; priority?: string; q?: string; state?: string; tech?: string; response?: string; limit?: number; offset?: number };
function candidateWhere(scope: UserScope, cmId: string, f: CandFilter) {
  const where = [eq(mandateCandidates.commercialMandateId, cmId), mandateCondition(scope, mandateCandidates.mandateId)];
  if (f.stage) where.push(f.stage === "open" ? sql`${mandateCandidates.stage} not in ('rejected','excluded')` : eq(mandateCandidates.stage, f.stage));
  if (f.priority) where.push(eq(mandateCandidates.priority, f.priority));
  if (f.response) where.push(f.response === "none" ? sql`${mandateCandidates.clientResponse} is null` : eq(mandateCandidates.clientResponse, f.response as ClientResponse));
  if (f.q) where.push(sql`lower(${mandateCandidates.name}) like ${`%${f.q.toLowerCase()}%`}`);
  if (f.state) where.push(sql`json_extract(${mandateCandidates.data}, '$.state') = ${f.state.toUpperCase()}`);
  if (f.tech) where.push(sql`lower(${mandateCandidates.name}) like ${`%${f.tech.replace("_", " + ")}%`}`);
  return and(...where);
}

export async function candidatesFor(db: Db, scope: UserScope, cmId: string, f: CandFilter = {}) {
  const order = sql`case ${mandateCandidates.stage} when 'transaction_qualified' then 0 when 'active_pursuit' then 1 when 'engagement_qualified' then 2 when 'approved' then 3 when 'qualified' then 4 when 'pre_qualified' then 5 when 'matched' then 6 when 'watch' then 7 when 'screened' then 8 else 9 end`;
  return db.select().from(mandateCandidates).where(candidateWhere(scope, cmId, f)).orderBy(order, sql`case ${mandateCandidates.priority} when 'high' then 0 when 'medium' then 1 else 2 end`, asc(mandateCandidates.windowStart), desc(mandateCandidates.estValue)).limit(f.limit ?? 300).offset(f.offset ?? 0);
}

/** One page of the universe plus its filtered total and the states present (for the filter), read in parallel. */
export async function candidatePage(db: Db, scope: UserScope, cmId: string, f: CandFilter & { limit: number; offset: number }) {
  const [rows, [count], states] = await Promise.all([
    candidatesFor(db, scope, cmId, f),
    db.select({ n: sql<number>`count(*)` }).from(mandateCandidates).where(candidateWhere(scope, cmId, f)),
    db.selectDistinct({ s: sql<string>`json_extract(${mandateCandidates.data}, '$.state')` }).from(mandateCandidates).where(and(eq(mandateCandidates.commercialMandateId, cmId), mandateCondition(scope, mandateCandidates.mandateId))),
  ]);
  return { rows, total: count?.n ?? 0, states: states.map(x => x.s).filter(Boolean).sort() };
}

export async function funnelFor(db: Db, scope: UserScope, cmId: string) {
  const rows = await db.select({ stage: mandateCandidates.stage, clientResponse: mandateCandidates.clientResponse }).from(mandateCandidates).where(and(eq(mandateCandidates.commercialMandateId, cmId), mandateCondition(scope, mandateCandidates.mandateId)));
  const purs = await db.select({ stage: pursuits.stage, outcome: pursuits.outcome }).from(pursuits).where(and(eq(pursuits.commercialMandateId, cmId), mandateCondition(scope, pursuits.mandateId)));
  const byStage = Object.fromEntries([...STAGE_ORDER, "watch", "rejected", "excluded"].map(s => [s, rows.filter(r => r.stage === s).length]));
  const cumulative = STAGE_ORDER.map(s => ({ stage: s, n: rows.filter(r => STAGE_ORDER.indexOf(r.stage as CandidateStage) >= STAGE_ORDER.indexOf(s)).length }));
  return { byStage, cumulative, levels: funnelLevels(rows, purs), total: rows.length };
}

export async function candidateDetail(db: Db, scope: UserScope, id: string) {
  const [c] = await db.select().from(mandateCandidates).where(and(eq(mandateCandidates.id, id), mandateCondition(scope, mandateCandidates.mandateId)));
  if (!c) return null;
  const [m] = await db.select().from(commercialMandates).where(eq(commercialMandates.id, c.commercialMandateId));
  const signals = await db.select().from(mandateSignals).where(eq(mandateSignals.candidateId, id)).orderBy(desc(mandateSignals.observedAt)).limit(30);
  const queue = c.entityType === "queue_project" ? (await db.select().from(queueProjects).where(eq(queueProjects.key, c.entityId)))[0] ?? null : null;
  const account = c.accountOrgId ? (await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, c.accountOrgId)))[0] ?? null : null;
  const pursuit = c.pursuitId ? (await db.select().from(pursuits).where(eq(pursuits.id, c.pursuitId)))[0] ?? null : null;
  const facts = await simFacts(db, c.projectId, { stage: (c.data.status as string) ?? null, sponsorKnown: !!c.accountOrgId, epcAwarded: c.checks.epc_open?.met === "no" ? true : null, country: (c.data.country as string) ?? (c.entityType === "queue_project" ? "US" : null) });
  return { c, m, signals, queue, account, pursuit, facts };
}

/** Facts for counterparty simulation from the project record when one exists. */
export async function simFacts(db: Db, projectId: string | null, base: Partial<SimFacts>): Promise<SimFacts> {
  if (!projectId) return { readiness: {}, ...base };
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  const rd = await db.select({ dimension: projectReadiness.dimension, status: projectReadiness.status }).from(projectReadiness).where(eq(projectReadiness.projectId, projectId));
  const cs = await db.select({ category: constraints.category, severity: constraints.severity, status: constraints.status, title: constraints.description }).from(constraints).where(eq(constraints.projectId, projectId));
  const pm = await db.select({ name: permits.name, status: permits.status }).from(permits).where(eq(permits.projectId, projectId));
  return { readiness: Object.fromEntries(rd.map(r => [r.dimension, r.status])), constraints: cs, permits: pm, capex: p?.capex ?? null, country: p?.country ?? base.country ?? null, sponsorKnown: true, ...base };
}

export async function pursuitsFor(db: Db, scope: UserScope, f: { outcome?: string; type?: string; cm?: string } = {}) {
  const where = [mandateCondition(scope, pursuits.mandateId)];
  if (f.outcome) where.push(eq(pursuits.outcome, f.outcome));
  if (f.type) where.push(eq(pursuits.type, f.type));
  if (f.cm) where.push(eq(pursuits.commercialMandateId, f.cm));
  const rows = await db.select({ p: pursuits, mandate: commercialMandates.name, client: commercialMandates.clientName }).from(pursuits).leftJoin(commercialMandates, eq(commercialMandates.id, pursuits.commercialMandateId)).where(and(...where)).orderBy(desc(pursuits.updatedAt)).limit(300);
  return rows.map(r => ({ ...r, prob: probabilityOf(r.p.type as PursuitType, r.p.stage, r.p.probabilityOverride) }));
}

export async function pursuitDetail(db: Db, scope: UserScope, id: string) {
  const [p] = await db.select().from(pursuits).where(and(eq(pursuits.id, id), mandateCondition(scope, pursuits.mandateId)));
  if (!p) return null;
  const m = p.commercialMandateId ? (await db.select().from(commercialMandates).where(eq(commercialMandates.id, p.commercialMandateId)))[0] ?? null : null;
  const c = p.candidateId ? (await db.select().from(mandateCandidates).where(eq(mandateCandidates.id, p.candidateId)))[0] ?? null : null;
  const appr = await db.select().from(approvals).where(and(eq(approvals.entityType, "pursuits"), eq(approvals.entityId, id))).orderBy(desc(approvals.createdAt));
  const docs = p.projectId ? await db.select({ id: documents.id, name: documents.title, category: documents.category }).from(documents).where(eq(documents.projectId, p.projectId)).limit(30) : [];
  return { p, m, c, approvals: appr, docs, prob: probabilityOf(p.type as PursuitType, p.stage, p.probabilityOverride) };
}

export async function approvalsFor(db: Db, scope: UserScope, status = "pending") {
  return db.select().from(approvals).where(and(mandateCondition(scope, approvals.mandateId), status === "all" ? sql`1 = 1` : eq(approvals.status, status))).orderBy(desc(approvals.createdAt)).limit(200);
}

export async function signalsFor(db: Db, scope: UserScope, cmId?: string, status = "new") {
  return db.select().from(mandateSignals).where(and(mandateCondition(scope, mandateSignals.mandateId), cmId ? eq(mandateSignals.commercialMandateId, cmId) : sql`1 = 1`, status === "all" ? sql`1 = 1` : eq(mandateSignals.status, status))).orderBy(desc(mandateSignals.observedAt)).limit(200);
}

/** Command / Today: mandates, pursuits, approvals, signals in one read. */
export async function mandateCommand(db: Db, scope: UserScope) {
  const [ms, purs, pending, sig, [awaiting]] = await Promise.all([
    db.select().from(commercialMandates).where(mandateCondition(scope, commercialMandates.mandateId)),
    db.select().from(pursuits).where(and(mandateCondition(scope, pursuits.mandateId), eq(pursuits.outcome, "open"))),
    db.select().from(approvals).where(and(mandateCondition(scope, approvals.mandateId), eq(approvals.status, "pending"))).orderBy(desc(approvals.createdAt)).limit(10),
    db.select().from(mandateSignals).where(and(mandateCondition(scope, mandateSignals.mandateId), eq(mandateSignals.status, "new"))).orderBy(desc(mandateSignals.observedAt)).limit(10),
    db.select({ n: sql<number>`count(*)` }).from(mandateCandidates).where(and(mandateCondition(scope, mandateCandidates.mandateId), sql`${mandateCandidates.stage} in ('pre_qualified','qualified')`, sql`${mandateCandidates.clientResponse} is null`)),
  ]);
  const weighted = purs.reduce((s, p) => s + (p.value ?? 0) * probabilityOf(p.type as PursuitType, p.stage, p.probabilityOverride).effective / 100, 0);
  const stale = purs.filter(p => (p.lastActionAt ?? p.createdAt) < new Date(Date.now() - 14 * 864e5).toISOString());
  return { mandates: ms, active: ms.filter(m => ["active", "pilot"].includes(m.status)), mrr: ms.filter(m => ["active", "pilot"].includes(m.status)).reduce((s, m) => s + m.retainer, 0), pursuits: purs, pipeline: purs.reduce((s, p) => s + (p.value ?? 0), 0), weighted, stale, pending, signals: sig, awaitingClient: awaiting?.n ?? 0, atRisk: ms.filter(m => m.health === "at_risk" || m.health === "off_track") };
}

/** §51–52 Anonymized public metrics: counts only, from records, never names; publication needs approval per mandate. */
export async function publicMetrics(db: Db, scope: UserScope) {
  const ms = await db.select().from(commercialMandates).where(mandateCondition(scope, commercialMandates.mandateId));
  const [cand] = await db.select({ n: sql<number>`count(*)`, q: sql<number>`sum(case when stage in ('qualified','approved','engagement_qualified','active_pursuit','transaction_qualified') then 1 else 0 end)` }).from(mandateCandidates).where(mandateCondition(scope, mandateCandidates.mandateId));
  const [qp] = await db.select({ n: sql<number>`count(*)`, mw: sql<number>`coalesce(sum(mw),0)` }).from(queueProjects).where(sql`withdrawn_date is null`);
  return {
    activeMandates: ms.filter(m => ["active", "pilot"].includes(m.status)).length,
    projectsMonitored: qp?.n ?? 0, capacityMonitoredMw: Math.round(qp?.mw ?? 0), candidates: cand?.n ?? 0, qualified: cand?.q ?? 0,
    publishable: ms.filter(m => m.publishApproved && m.publicLabel).map(m => m.publicLabel),
  };
}
