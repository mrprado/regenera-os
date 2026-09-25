// Project delivery engine (docs/plans/phase-6.md M7): plan (milestones + critical path), decisions, missing engineering
// information, E&S issues and insurance, and what of it belongs on Today. Functions over a Db so they are testable.
import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { decisions, esIssues, insurancePolicies, projectMilestones, projects, studies } from "@/db/schema";
import { audit } from "@/lib/audit";
import { STAGE_ORDER, type ProjectStage } from "@/lib/projects/vocab";
import { criticalPath, type CpmResult } from "./cpm";
import { CORE_STUDIES, ESIA_FROM_STAGE, STUDY_HAVE, type StudyType } from "./vocab";

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => day(new Date(d.getTime() + n * 86_400_000));
type Milestone = typeof projectMilestones.$inferSelect;

export async function projectPlan(db: Db, projectId: string, today: string): Promise<{ milestones: Milestone[]; cpm: CpmResult }> {
  const milestones = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, projectId)).orderBy(asc(projectMilestones.dueDate), asc(projectMilestones.createdAt));
  return { milestones, cpm: criticalPath(milestones, today) };
}

/** Adds a milestone; dependencies must belong to the same project and may not create a cycle. */
export async function addMilestone(db: Db, input: Omit<typeof projectMilestones.$inferInsert, "id" | "mandateId">, actor: string) {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, input.projectId));
  if (!p) throw new Error("Project not found");
  const existing = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, input.projectId));
  const deps = (input.dependsOn ?? []).filter(d => existing.some(m => m.id === d));
  const [m] = await db.insert(projectMilestones).values({ ...input, dependsOn: deps, mandateId: p.mandateId }).returning();
  await audit(db, { actor, action: "milestone_added", entity: "project_milestones", entityId: m.id, after: { name: m.name, dueDate: m.dueDate } });
  return m;
}

/** Replaces a milestone's dependencies. Refuses (returns false) when the new set would create a cycle. */
export async function setDependencies(db: Db, milestoneId: string, dependsOn: string[], today: string) {
  const [m] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, milestoneId));
  if (!m) throw new Error("Milestone not found");
  const all = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, m.projectId));
  const deps = dependsOn.filter(d => d !== m.id && all.some(x => x.id === d));
  const trial = criticalPath(all.map(x => (x.id === m.id ? { ...x, dependsOn: deps } : x)), today);
  if (trial.cycles.length) return false;
  await db.update(projectMilestones).set({ dependsOn: deps, updatedAt: new Date().toISOString() }).where(eq(projectMilestones.id, m.id));
  return true;
}

export async function setMilestoneStatus(db: Db, milestoneId: string, status: Milestone["status"], actor: string, now = new Date()) {
  const [m] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, milestoneId));
  if (!m) throw new Error("Milestone not found");
  await db.update(projectMilestones).set({ status, completedAt: status === "done" ? (m.completedAt ?? day(now)) : null, updatedAt: now.toISOString() }).where(eq(projectMilestones.id, milestoneId));
  await audit(db, { actor, action: "milestone_status", entity: "project_milestones", entityId: m.id, before: { status: m.status }, after: { status } });
  return m;
}

/** Studies a project should have by now (by asset class; ESIA from Development). Missing = no study received. */
export function studyGaps(p: { assetClass: string | null; stage: string }, rows: { type: string; status: string }[]) {
  const stageAt = STAGE_ORDER.indexOf(p.stage as ProjectStage);
  const expected = new Set<StudyType>(CORE_STUDIES[p.assetClass ?? "other"] ?? CORE_STUDIES.other);
  if (stageAt >= STAGE_ORDER.indexOf(ESIA_FROM_STAGE)) expected.add("esia");
  const missing: StudyType[] = [], pending: StudyType[] = [];
  for (const t of expected) {
    const have = rows.filter(r => r.type === t && r.status !== "superseded");
    if (have.some(r => STUDY_HAVE.has(r.status))) continue;
    (have.length ? pending : missing).push(t);
  }
  return { expected: [...expected], missing, pending, due: stageAt >= STAGE_ORDER.indexOf("development") };
}

export type DeliveryAlerts = {
  milestones: { id: string; projectId: string; project: string; name: string; dueDate: string | null; why: string; red: boolean }[];
  decisions: { id: string; projectId: string; project: string; title: string; dueDate: string | null; overdue: boolean }[];
  missingEngineering: { projectId: string; project: string; missing: string[] }[];
  es: { id: string; projectId: string; project: string; topic: string; severity: string; description: string }[];
  insurance: { id: string; projectId: string; project: string; type: string; why: string; date: string | null }[];
};

/** For Today: milestones due in 14 days, overdue or forecast late on the critical path; decisions due; missing core
 * studies for projects at Development or later; open high/critical E&S issues; insurance expiring in 60 days or
 * required but not bound for projects in construction. */
export async function deliveryAlerts(db: Db, mandateIds: string[] | null, now = new Date()): Promise<DeliveryAlerts> {
  const scope = (col: typeof projects.mandateId) => (mandateIds ? inArray(col, mandateIds.length ? mandateIds : ["-"]) : sql`1 = 1`);
  const live = and(scope(projects.mandateId), isNull(projects.archivedAt), notInArray(projects.status, ["dropped"]));
  const today = day(now), in14 = addDays(now, 14), in60 = addDays(now, 60);

  const ms = await db.select({ m: projectMilestones, project: projects.name }).from(projectMilestones).innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(and(live)).limit(500);
  const byProject = new Map<string, typeof ms>();
  for (const x of ms) byProject.set(x.m.projectId, [...(byProject.get(x.m.projectId) ?? []), x]);
  const milestones: DeliveryAlerts["milestones"] = [];
  for (const rows of byProject.values()) {
    const cpm = criticalPath(rows.map(r => r.m), today);
    for (const { m, project } of rows) {
      if (m.status === "done" || m.status === "cancelled") continue;
      const n = cpm.nodes.get(m.id);
      const why = n?.overdue ? "Overdue" : n && n.critical && n.lateDays > 0 ? `Critical path: forecast ${n.finish}, ${n.lateDays} days after due` : m.dueDate && m.dueDate <= in14 ? "Due" : n && n.lateDays > 0 ? `Forecast ${n.lateDays} days late` : null;
      if (why) milestones.push({ id: m.id, projectId: m.projectId, project, name: m.name, dueDate: m.dueDate, why, red: !!n && (n.overdue || n.critical) });
    }
  }
  milestones.sort((a, b) => Number(b.red) - Number(a.red) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));

  const ds = await db.select({ d: decisions, project: projects.name }).from(decisions).innerJoin(projects, eq(projects.id, decisions.projectId))
    .where(and(live, eq(decisions.status, "open"), lte(decisions.dueDate, addDays(now, 7)))).orderBy(asc(decisions.dueDate)).limit(20);

  const ps = await db.select({ id: projects.id, name: projects.name, assetClass: projects.assetClass, stage: projects.stage }).from(projects).where(live).limit(300);
  const st = ps.length ? await db.select({ projectId: studies.projectId, type: studies.type, status: studies.status }).from(studies).where(inArray(studies.projectId, ps.map(p => p.id))) : [];
  const missingEngineering = ps.map(p => ({ p, g: studyGaps(p, st.filter(s => s.projectId === p.id)) }))
    .filter(x => x.g.due && x.g.missing.length).map(x => ({ projectId: x.p.id, project: x.p.name, missing: x.g.missing }));

  const es = await db.select({ e: esIssues, project: projects.name }).from(esIssues).innerJoin(projects, eq(projects.id, esIssues.projectId))
    .where(and(live, notInArray(esIssues.status, ["managed", "closed"]), inArray(esIssues.severity, ["high", "critical"]))).limit(20);

  const ins = await db.select({ i: insurancePolicies, project: projects.name, stage: projects.stage }).from(insurancePolicies).innerJoin(projects, eq(projects.id, insurancePolicies.projectId))
    .where(and(live, inArray(insurancePolicies.status, ["required", "quoting", "bound", "lapsed"]))).limit(200);
  const inConstruction = (s: string) => STAGE_ORDER.indexOf(s as ProjectStage) >= STAGE_ORDER.indexOf("construction") && STAGE_ORDER.indexOf(s as ProjectStage) < STAGE_ORDER.indexOf("operations");
  const insurance: DeliveryAlerts["insurance"] = [];
  for (const { i, project, stage } of ins) {
    if (i.status === "bound" && i.expiresAt && i.expiresAt <= in60) insurance.push({ id: i.id, projectId: i.projectId, project, type: i.type, why: i.expiresAt < today ? "Expired" : "Expires", date: i.expiresAt });
    else if (i.status === "lapsed") insurance.push({ id: i.id, projectId: i.projectId, project, type: i.type, why: "Lapsed", date: i.expiresAt });
    else if ((i.status === "required" || i.status === "quoting") && i.phase !== "operations" && inConstruction(stage)) insurance.push({ id: i.id, projectId: i.projectId, project, type: i.type, why: "Required in construction, not bound", date: null });
  }

  return {
    milestones: milestones.slice(0, 30),
    decisions: ds.map(x => ({ id: x.d.id, projectId: x.d.projectId, project: x.project, title: x.d.title, dueDate: x.d.dueDate, overdue: !!x.d.dueDate && x.d.dueDate < today })),
    missingEngineering,
    es: es.map(x => ({ id: x.e.id, projectId: x.e.projectId, project: x.project, topic: x.e.topic, severity: x.e.severity, description: x.e.description })),
    insurance,
  };
}
