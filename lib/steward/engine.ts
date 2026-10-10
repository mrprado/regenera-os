// Steward engine (phase 28A). Every function takes a Db so it is testable against local D1. Records come only from
// what people enter or sources return; nothing is generated from examples, and a missing value is never a zero.
import * as turf from "@turf/turf";
import { and, asc, desc, eq, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  careActions, carePlans, communities, communityCommitments, communityGrievances, consentRecords, fundingAllocations, knowledgeRecords, projects,
  stewardAssessments, stewardIndicators, stewardMeasurements, stewardPlaceGeometries, stewardPlaceLinks, stewardPlaces, stewardshipBudgets, stewardshipObligations,
} from "@/db/schema";
import { checkPermission } from "@/lib/community/engine";
import type { Activity } from "@/lib/community/vocab";
import { mandateCondition, type Scope } from "@/lib/db/scoped";
import { ASSESSMENT_DIMENSIONS, type AssessmentDimension, type AssessmentStatus } from "./vocab";

type Geometry = { type: string; coordinates: unknown };

// ---------------- geometry ----------------

/** Validates a GeoJSON geometry (or Feature) and returns the geometry, or throws with a plain reason. */
export function parseGeometry(input: unknown): Geometry {
  const g = (input && typeof input === "object" && (input as { type?: string }).type === "Feature" ? (input as { geometry: unknown }).geometry : input) as Geometry | null;
  if (!g || typeof g !== "object" || !["Point", "Polygon", "MultiPolygon"].includes(g.type)) throw new Error("Geometry must be a GeoJSON Point, Polygon or MultiPolygon.");
  const feature = turf.feature(g as never);
  if (g.type !== "Point") {
    const kinks = turf.kinks(feature as never);
    if (kinks.features.length) throw new Error("The boundary crosses itself. Correct the polygon before saving.");
  }
  const [minX, minY, maxX, maxY] = turf.bbox(feature);
  if (minX < -180 || maxX > 180 || minY < -90 || maxY > 90) throw new Error("Coordinates must be longitude, latitude in degrees (WGS84).");
  return g;
}

/** Geodesic area in hectares for polygons; null for points (a point cannot support an area conclusion). */
export function areaHa(g: Geometry | null): number | null {
  if (!g || g.type === "Point") return null;
  return Math.round((turf.area(turf.feature(g as never)) / 10_000) * 100) / 100;
}

// ---------------- places ----------------

export async function createPlace(db: Db, input: { mandateId: string; name: string; description?: string; country?: string | null; region?: string; geometry?: unknown; accuracy?: keyof typeof import("./vocab").GEOMETRY_ACCURACY; geometrySource?: string; responsible?: string | null; sensitive?: boolean; projectIds?: string[] }, actor: string) {
  const geometry = input.geometry ? parseGeometry(input.geometry) : null;
  const accuracy = geometry ? input.accuracy ?? "unknown" : "unknown";
  const area = areaHa(geometry);
  const [place] = await db.insert(stewardPlaces).values({
    mandateId: input.mandateId, name: input.name.trim(), description: input.description ?? "", country: input.country ?? null, region: input.region ?? "",
    geometry: geometry as Record<string, unknown> | null, geometryAccuracy: accuracy, areaHa: area, responsible: input.responsible ?? null, sensitive: !!input.sensitive, createdBy: actor,
  }).returning();
  if (geometry) await db.insert(stewardPlaceGeometries).values({ mandateId: input.mandateId, placeId: place.id, geometry: geometry as Record<string, unknown>, accuracy, source: input.geometrySource ?? "", areaHa: area, recordedBy: actor });
  for (const projectId of input.projectIds ?? []) await linkPlace(db, place.id, input.mandateId, "project", projectId, "project_site", actor);
  return place;
}

/** A place from a project: its recorded boundary if any, otherwise its point, labelled as such. Never an invented boundary. */
export async function placeFromProject(db: Db, scope: Scope, projectId: string, actor: string) {
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  let geometry: unknown = null, accuracy: "digitised" | "project_point" | "unknown" = "unknown";
  if (p.geometry) { try { const g = JSON.parse(p.geometry); if (["Polygon", "MultiPolygon"].includes(g?.type ?? g?.geometry?.type)) { geometry = g; accuracy = "digitised"; } } catch { /* not usable */ } }
  if (!geometry && p.lat != null && p.lng != null) { geometry = { type: "Point", coordinates: [p.lng, p.lat] }; accuracy = "project_point"; }
  return createPlace(db, { mandateId: p.mandateId, name: p.name, country: p.country, geometry, accuracy, geometrySource: geometry ? `Project record ${p.name}` : "", projectIds: [p.id] }, actor);
}

export async function linkPlace(db: Db, placeId: string, mandateId: string, entityType: "project" | "community", entityId: string, relation: keyof typeof import("./vocab").PLACE_LINK_RELATIONS, actor: string, note = "") {
  await db.insert(stewardPlaceLinks).values({ mandateId, placeId, entityType, entityId, relation, note, createdBy: actor }).onConflictDoNothing();
}

/** New boundary version; the previous one stays in history. */
export async function setPlaceGeometry(db: Db, placeId: string, input: { geometry: unknown; accuracy: keyof typeof import("./vocab").GEOMETRY_ACCURACY; source: string; note?: string }, actor: string) {
  const [place] = await db.select().from(stewardPlaces).where(eq(stewardPlaces.id, placeId));
  if (!place) throw new Error("Place not found");
  const g = parseGeometry(input.geometry);
  const area = areaHa(g);
  await db.insert(stewardPlaceGeometries).values({ mandateId: place.mandateId, placeId, geometry: g as Record<string, unknown>, accuracy: input.accuracy, source: input.source, areaHa: area, note: input.note ?? "", recordedBy: actor });
  await db.update(stewardPlaces).set({ geometry: g as Record<string, unknown>, geometryAccuracy: input.accuracy, areaHa: area, updatedAt: new Date().toISOString() }).where(eq(stewardPlaces.id, placeId));
}

/** Non-owners see a sensitive place only as a generalised point (rounded to ~10 km). */
export function visibleGeometry(place: { geometry: Record<string, unknown> | null; sensitive: boolean }, isOwner: boolean): Record<string, unknown> | null {
  if (!place.geometry || isOwner || !place.sensitive) return place.geometry;
  const c = turf.centroid(turf.feature(place.geometry as never)).geometry.coordinates;
  return { type: "Point", coordinates: [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10], generalised: true };
}

// ---------------- care ----------------

export async function createCarePlan(db: Db, input: typeof carePlans.$inferInsert) {
  const [row] = await db.insert(carePlans).values(input).returning();
  return row;
}

export async function addCareAction(db: Db, input: typeof careActions.$inferInsert) {
  if (input.dependsOn) {
    const [dep] = await db.select({ planId: careActions.planId }).from(careActions).where(eq(careActions.id, input.dependsOn));
    if (!dep || dep.planId !== input.planId) throw new Error("A dependency must be an action in the same plan.");
  }
  const [row] = await db.insert(careActions).values(input).returning();
  return row;
}

export type StartCheck = { ok: boolean; reasons: string[] };
/** Whether an action may start: its dependency is done and any knowledge permission it needs is granted. */
export async function canStartAction(db: Db, actionId: string, now = new Date()): Promise<StartCheck> {
  const [a] = await db.select().from(careActions).where(eq(careActions.id, actionId));
  if (!a) return { ok: false, reasons: ["Action not found"] };
  const reasons: string[] = [];
  if (a.dependsOn) { const [d] = await db.select({ status: careActions.status, title: careActions.title }).from(careActions).where(eq(careActions.id, a.dependsOn)); if (d && d.status !== "done") reasons.push(`Waits for "${d.title}" to be done.`); }
  if (a.requiresKnowledgeId && a.requiresActivity) {
    const p = await checkPermission(db, a.requiresKnowledgeId, a.requiresActivity as Activity, now);
    if (!p.allowed) reasons.push(`Knowledge permission needed: ${p.reason}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export async function setActionStatus(db: Db, actionId: string, status: "planned" | "in_progress" | "blocked" | "done" | "cancelled", actor: string, evidence = "") {
  if (status === "in_progress") { const c = await canStartAction(db, actionId); if (!c.ok) throw new Error(c.reasons.join(" ")); }
  if (status === "done" && !evidence.trim()) throw new Error("Completing an action needs evidence (a document, photo reference, measurement or note of what was done).");
  const nowIso = new Date().toISOString();
  await db.update(careActions).set({ status, updatedAt: nowIso, ...(status === "done" ? { completionEvidence: evidence.trim(), completedAt: nowIso, completedBy: actor } : {}) }).where(eq(careActions.id, actionId));
}

// ---------------- budgets ----------------

export type BudgetSummary = { budgetId: string; currency: string; required: number; byStage: Record<"projected" | "committed" | "funded" | "paid", number>; secured: number; gap: number; otherCurrency: { currency: string; amount: number; stage: string }[] };
/** Per budget, amounts by stage in the budget's currency. Allocations in another currency are listed, never summed. */
export function summariseBudget(b: typeof stewardshipBudgets.$inferSelect, allocations: (typeof fundingAllocations.$inferSelect)[]): BudgetSummary {
  const byStage = { projected: 0, committed: 0, funded: 0, paid: 0 };
  const otherCurrency: BudgetSummary["otherCurrency"] = [];
  for (const a of allocations.filter(x => x.budgetId === b.id)) {
    if (a.currency !== b.currency) { otherCurrency.push({ currency: a.currency, amount: a.amount, stage: a.stage }); continue; }
    byStage[a.stage] += a.amount;
  }
  const secured = byStage.funded + byStage.paid;
  return { budgetId: b.id, currency: b.currency, required: b.required, byStage, secured, gap: Math.max(0, b.required - secured), otherCurrency };
}

// ---------------- outcomes ----------------

export async function addMeasurement(db: Db, input: typeof stewardMeasurements.$inferInsert) {
  if (!input.evidence?.trim()) throw new Error("A measurement needs its evidence (source, document or field record).");
  if (!Number.isFinite(input.value)) throw new Error("A measurement needs a number. Leave it out rather than recording a zero.");
  const [row] = await db.insert(stewardMeasurements).values(input).returning();
  return row;
}

export type IndicatorView = typeof stewardIndicators.$inferSelect & { baseline: typeof stewardMeasurements.$inferSelect | null; latest: typeof stewardMeasurements.$inferSelect | null; count: number };
export async function indicatorsFor(db: Db, placeId: string): Promise<IndicatorView[]> {
  const inds = await db.select().from(stewardIndicators).where(eq(stewardIndicators.placeId, placeId)).orderBy(asc(stewardIndicators.dimension), asc(stewardIndicators.name));
  if (!inds.length) return [];
  const ms = await db.select().from(stewardMeasurements).where(inArray(stewardMeasurements.indicatorId, inds.map(i => i.id))).orderBy(asc(stewardMeasurements.periodStart));
  return inds.map(i => {
    const mine = ms.filter(m => m.indicatorId === i.id);
    return { ...i, baseline: mine.find(m => m.kind === "baseline") ?? null, latest: [...mine].reverse().find(m => m.kind === "measurement") ?? null, count: mine.length };
  });
}

// ---------------- assessments ----------------

export async function setAssessment(db: Db, input: { mandateId: string; placeId: string; dimension: AssessmentDimension; status: AssessmentStatus; basis: string; evidenceRef?: string; scope?: string }, actor: string) {
  if (!input.basis.trim()) throw new Error("An assessment needs its basis.");
  if (input.status === "verified_in_scope" && !input.scope?.trim()) throw new Error("Verified within stated scope needs the scope it was verified for.");
  await db.insert(stewardAssessments).values({ ...input, evidenceRef: input.evidenceRef ?? "", scope: input.scope ?? "", assessedBy: actor });
}

/** Current status per dimension; a dimension with no assessment is "not_assessed", never assumed fine. */
export async function currentAssessments(db: Db, placeId: string) {
  const rows = await db.select().from(stewardAssessments).where(eq(stewardAssessments.placeId, placeId)).orderBy(desc(stewardAssessments.assessedAt));
  return (Object.keys(ASSESSMENT_DIMENSIONS) as AssessmentDimension[]).map(d => {
    const r = rows.find(x => x.dimension === d);
    return { dimension: d, status: (r?.status ?? "not_assessed") as AssessmentStatus, basis: r?.basis ?? "", scope: r?.scope ?? "", assessedBy: r?.assessedBy ?? null, assessedAt: r?.assessedAt ?? null, evidenceRef: r?.evidenceRef ?? "" };
  });
}

// ---------------- knowledge visibility ----------------

const HIDDEN_FROM_MEMBERS = ["sacred", "secret", "ceremonial", "gender_restricted", "age_restricted", "lineage_restricted", "practitioner_restricted", "non_digitizable", "confidential", "community_only"];
/**
 * Whether this user may know a knowledge record exists. Owners of the workspace see existence of every record (their
 * content still follows publicView and permissions); other members see only public or team-authorised records, or
 * ones naming them as permitted users. Counts use the same rule so restricted records are not revealed by numbers.
 */
export function canSeeKnowledge(scope: Scope, r: Pick<typeof knowledgeRecords.$inferSelect, "mandateId" | "accessStatus" | "permittedUsers" | "withdrawn">) {
  if (scope.kind === "system") return false; // never to automated readers (Ask, MCP, search, AI)
  if (!scope.mandateIds.includes(r.mandateId)) return false;
  if (scope.ownerOf.includes(r.mandateId)) return true;
  if (r.withdrawn) return false;
  if ((r.permittedUsers ?? []).map(e => e.toLowerCase()).includes(scope.email.toLowerCase())) return true;
  return !HIDDEN_FROM_MEMBERS.includes(r.accessStatus);
}

// ---------------- overview ----------------

/** The Steward overview: actual records needing attention, filtered to what the user may see. */
export async function stewardOverview(db: Db, scope: Scope, today: string) {
  const ws = scope.kind === "user" ? scope.mandateIds : [];
  const inWs = <T>(col: T) => inArray(col as never, ws.length ? ws : ["-"]);
  const soon = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
  const owner = scope.kind === "user" && ws.some(m => scope.ownerOf.includes(m));
  const [places, overdueActions, upcomingActions, commitments, obligations, consentReviews, grievances, knowledge, budgets, allocations] = await Promise.all([
    db.select().from(stewardPlaces).where(inWs(stewardPlaces.mandateId)).orderBy(asc(stewardPlaces.name)),
    db.select({ a: careActions, plan: carePlans.title, placeId: carePlans.placeId }).from(careActions).innerJoin(carePlans, eq(carePlans.id, careActions.planId))
      .where(and(inWs(careActions.mandateId), notInArray(careActions.status, ["done", "cancelled"]), lte(careActions.dueDate, today))).orderBy(asc(careActions.dueDate)).limit(20),
    db.select({ a: careActions, plan: carePlans.title, placeId: carePlans.placeId }).from(careActions).innerJoin(carePlans, eq(carePlans.id, careActions.planId))
      .where(and(inWs(careActions.mandateId), notInArray(careActions.status, ["done", "cancelled"]), sql`${careActions.dueDate} > ${today}`, lte(careActions.dueDate, soon))).orderBy(asc(careActions.dueDate)).limit(20),
    db.select().from(communityCommitments).where(and(inWs(communityCommitments.mandateId), notInArray(communityCommitments.status, ["fulfilled", "terminated", "amended"]), lte(communityCommitments.dueDate, soon))).orderBy(asc(communityCommitments.dueDate)).limit(20),
    db.select().from(stewardshipObligations).where(and(inWs(stewardshipObligations.mandateId), inArray(stewardshipObligations.status, ["open", "overdue"]), lte(stewardshipObligations.dueAt, `${soon}T23:59:59Z`))).orderBy(asc(stewardshipObligations.dueAt)).limit(20),
    db.select().from(consentRecords).where(and(inWs(consentRecords.mandateId), lte(consentRecords.reviewDate, soon))).orderBy(asc(consentRecords.reviewDate)).limit(20),
    owner ? db.select().from(communityGrievances).where(and(inWs(communityGrievances.mandateId), notInArray(communityGrievances.status, ["resolved", "closed"]), isNull(communityGrievances.resolvedAt))).limit(20) : Promise.resolve([]),
    db.select().from(knowledgeRecords).where(and(inWs(knowledgeRecords.mandateId), lte(knowledgeRecords.reviewDate, soon))).limit(50),
    db.select().from(stewardshipBudgets).where(inWs(stewardshipBudgets.mandateId)),
    db.select().from(fundingAllocations).where(inWs(fundingAllocations.mandateId)),
  ]);
  const measured = places.length ? new Set((await db.select({ placeId: stewardIndicators.placeId }).from(stewardMeasurements).innerJoin(stewardIndicators, eq(stewardIndicators.id, stewardMeasurements.indicatorId))
    .where(and(inArray(stewardIndicators.placeId, places.map(p => p.id)), eq(stewardMeasurements.kind, "baseline")))).map(r => r.placeId)) : new Set<string>();
  const gaps = budgets.map(b => ({ b, s: summariseBudget(b, allocations) })).filter(x => x.s.gap > 0);
  return {
    places, needsBaseline: places.filter(p => !measured.has(p.id)), overdueActions, upcomingActions, commitments, obligations, consentReviews,
    grievances, knowledgeReviews: knowledge.filter(k => canSeeKnowledge(scope, k)), budgetGaps: gaps, canSeeGrievances: owner,
  };
}

/** Communities in the user's workspaces with counts for governance, consent and grievances (grievances owners only). */
export async function communityRegister(db: Db, scope: Scope) {
  const ws = scope.kind === "user" ? scope.mandateIds : [];
  const rows = await db.select().from(communities).where(and(inArray(communities.mandateId, ws.length ? ws : ["-"]), isNull(communities.deletedAt))).orderBy(asc(communities.name));
  return rows;
}

/** Places a project belongs to (for the project page and Capital readiness). */
export async function placesForProject(db: Db, projectId: string) {
  return db.select({ place: stewardPlaces, relation: stewardPlaceLinks.relation }).from(stewardPlaceLinks).innerJoin(stewardPlaces, eq(stewardPlaces.id, stewardPlaceLinks.placeId))
    .where(and(eq(stewardPlaceLinks.entityType, "project"), eq(stewardPlaceLinks.entityId, projectId), ne(stewardPlaces.status, "closed")));
}
