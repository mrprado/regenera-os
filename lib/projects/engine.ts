// Project spine logic (docs/plans/phase-6.md M1). Pure functions over a Db so they are testable; pages and actions
// call them with appDb() after scoping.
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  activities, capitalRequirements, capitalTranches, constraints, deals, organizations, projectParties, projectReadiness,
  projects, projectStageHistory,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { READINESS_DIMENSIONS, STAGE_ORDER, type ProjectStage, type ReadinessDimension } from "./vocab";

type NewProject = typeof projects.$inferInsert;

/** Creates a project with one readiness row per dimension (all Unknown: no fake precision). */
export async function createProject(db: Db, input: Omit<NewProject, "id">, actor: string) {
  const [p] = await db.insert(projects).values(input).returning();
  await db.insert(projectReadiness).values((Object.keys(READINESS_DIMENSIONS) as ReadinessDimension[]).map(dimension => ({ projectId: p.id, mandateId: p.mandateId, dimension })));
  await db.insert(projectStageHistory).values({ projectId: p.id, mandateId: p.mandateId, toStage: p.stage, reason: "Created", actor });
  await audit(db, { actor, action: "project_created", entity: "projects", entityId: p.id, after: { name: p.name, stage: p.stage } });
  return p;
}

/** Creates a project from an opportunity (deal) and links them; the deal's organization becomes the sponsor (proposed). */
export async function createProjectFromDeal(db: Db, dealId: string, actor: string) {
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw new Error("Deal not found");
  if (d.projectId) return { id: d.projectId, created: false };
  const [org] = d.orgId ? await db.select({ country: organizations.country, lat: organizations.lat, lng: organizations.lng }).from(organizations).where(eq(organizations.id, d.orgId)) : [];
  const p = await createProject(db, {
    mandateId: d.mandateId, name: d.name.replace(/^[^:]+:\s*/, "") || d.name, sector: d.sector, originationSource: `Opportunity: ${d.name}`,
    stage: d.path === "capital_mandate" ? "capital_alignment" : "diagnostic", country: org?.country ?? null, ownerEmail: actor,
  }, actor);
  await db.update(deals).set({ projectId: p.id, updatedAt: new Date().toISOString() }).where(eq(deals.id, dealId));
  if (d.orgId) await db.insert(projectParties).values({ projectId: p.id, mandateId: p.mandateId, orgId: d.orgId, contactId: d.contactId, role: "sponsor", note: "From the opportunity; confirm the role." });
  return { id: p.id, created: true };
}

export async function setStage(db: Db, projectId: string, to: ProjectStage, actor: string, reason = "") {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  if (p.stage === to) return false;
  const at = new Date().toISOString();
  await db.update(projects).set({ stage: to, stageChangedAt: at, updatedAt: at }).where(eq(projects.id, projectId));
  await db.insert(projectStageHistory).values({ projectId, mandateId: p.mandateId, fromStage: p.stage, toStage: to, reason, actor, at });
  await audit(db, { actor, action: "project_stage", entity: "projects", entityId: projectId, before: { stage: p.stage }, after: { stage: to, reason } });
  return true;
}

export async function setReadiness(db: Db, projectId: string, dimension: ReadinessDimension, patch: { status: typeof projectReadiness.$inferSelect.status; evidence?: string; owner?: string | null }, actor: string) {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const at = new Date().toISOString();
  await db.insert(projectReadiness).values({ projectId, mandateId: p.mandateId, dimension, status: patch.status, evidence: patch.evidence ?? "", owner: patch.owner ?? null, updatedBy: actor })
    .onConflictDoUpdate({ target: [projectReadiness.projectId, projectReadiness.dimension], set: { status: patch.status, ...(patch.evidence !== undefined ? { evidence: patch.evidence } : {}), ...(patch.owner !== undefined ? { owner: patch.owner } : {}), updatedBy: actor, updatedAt: at } });
}

/** Capital totals: by status, without double counting (tranches sit under requirements and are not added again). */
export async function capitalSummary(db: Db, projectId: string, now = new Date()) {
  const reqs = await db.select().from(capitalRequirements).where(eq(capitalRequirements.projectId, projectId)).orderBy(asc(capitalRequirements.targetClose));
  const tranches = await db.select().from(capitalTranches).where(eq(capitalTranches.projectId, projectId));
  const live = reqs.filter(r => r.status !== "cancelled");
  const horizon = new Date(now.getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
  const byCurrency = new Map<string, { target: number; secured: number; neededNow: number }>();
  for (const r of live) {
    const c = byCurrency.get(r.currency) ?? { target: 0, secured: 0, neededNow: 0 };
    const target = r.target ?? 0;
    const gap = Math.max(0, target - (r.secured ?? 0));
    c.target += target;
    c.secured += Math.min(r.secured ?? 0, target || Infinity);
    if (r.status !== "closed" && r.targetClose && r.targetClose <= horizon) c.neededNow += gap;
    byCurrency.set(r.currency, c);
  }
  return { requirements: reqs, tranches, byCurrency: [...byCurrency.entries()].map(([currency, v]) => ({ currency, ...v })) };
}

export type ProjectAlerts = {
  blocked: { projectId: string; name: string; why: string }[];
  capitalNow: { projectId: string; name: string; purpose: string; gap: number; currency: string; targetClose: string }[];
  moved: { projectId: string; name: string; from: string | null; to: string; at: string }[];
};

/** For Today: blockers (critical/high open constraints, Blocked readiness, overdue constraints), capital needed within 180 days, stage moves in 7 days. */
export async function projectAlerts(db: Db, mandateIds: string[] | null, now = new Date()): Promise<ProjectAlerts> {
  const scope = <T extends typeof projects.mandateId>(col: T) => (mandateIds ? inArray(col, mandateIds.length ? mandateIds : ["-"]) : sql`1 = 1`);
  const today = now.toISOString().slice(0, 10);
  const live = and(scope(projects.mandateId), isNull(projects.archivedAt), notInArray(projects.status, ["dropped"]));
  const cons = await db.select({ projectId: projects.id, name: projects.name, c: constraints }).from(constraints).innerJoin(projects, eq(projects.id, constraints.projectId))
    .where(and(live, inArray(constraints.status, ["open", "in_progress"]), or(inArray(constraints.severity, ["critical", "high"]), lte(constraints.deadline, today))))
    .orderBy(desc(constraints.severity)).limit(40);
  const blockedReadiness = await db.select({ projectId: projects.id, name: projects.name, dimension: projectReadiness.dimension }).from(projectReadiness)
    .innerJoin(projects, eq(projects.id, projectReadiness.projectId)).where(and(live, eq(projectReadiness.status, "blocked"))).limit(40);
  const horizon = new Date(now.getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
  const reqs = await db.select({ projectId: projects.id, name: projects.name, r: capitalRequirements }).from(capitalRequirements).innerJoin(projects, eq(projects.id, capitalRequirements.projectId))
    .where(and(live, notInArray(capitalRequirements.status, ["closed", "cancelled"]), lte(capitalRequirements.targetClose, horizon))).orderBy(asc(capitalRequirements.targetClose)).limit(30);
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const moved = await db.select({ projectId: projects.id, name: projects.name, h: projectStageHistory }).from(projectStageHistory).innerJoin(projects, eq(projects.id, projectStageHistory.projectId))
    .where(and(live, gte(projectStageHistory.at, since), ne(projectStageHistory.reason, "Created"))).orderBy(desc(projectStageHistory.at)).limit(20);
  return {
    blocked: [
      ...cons.map(x => ({ projectId: x.projectId, name: x.name, why: `${x.c.severity} ${x.c.category}: ${x.c.description}${x.c.deadline && x.c.deadline < today ? ` (overdue ${x.c.deadline})` : ""}` })),
      ...blockedReadiness.map(x => ({ projectId: x.projectId, name: x.name, why: `Readiness blocked: ${READINESS_DIMENSIONS[x.dimension]}` })),
    ],
    capitalNow: reqs.map(x => ({ projectId: x.projectId, name: x.name, purpose: x.r.purpose, gap: Math.max(0, (x.r.target ?? 0) - x.r.secured), currency: x.r.currency, targetClose: x.r.targetClose! })).filter(x => x.gap > 0),
    moved: moved.map(x => ({ projectId: x.projectId, name: x.name, from: x.h.fromStage, to: x.h.toStage, at: x.h.at })),
  };
}

export const stageIndex = (s: string) => STAGE_ORDER.indexOf(s as ProjectStage);

/** Logs an activity against a project (notes, stage moves), reusing the activities timeline via the linked deal when present. */
export async function projectNote(db: Db, projectId: string, detail: string, actor: string) {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  const [d] = await db.select({ id: deals.id, orgId: deals.orgId }).from(deals).where(eq(deals.projectId, projectId)).limit(1);
  if (!p) return;
  await db.insert(activities).values({ mandateId: p.mandateId, dealId: d?.id ?? null, orgId: d?.orgId ?? null, type: "note", detail: `[Project] ${detail}`, source: "manual", actor });
}
