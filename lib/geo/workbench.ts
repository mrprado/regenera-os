// ATLAS workbench records: saved typed geometries, auditable analysis runs and field observations. Pure DB functions
// (db parameter) so they are testable; routes add the auth and mandate scoping.
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Geometry } from "geojson";
import type { Db } from "@/db";
import { fieldObservations, projects, risks, siteFeatures, spatialAnalyses, tasks } from "@/db/schema";
import type { DATA_GRADES, FEATURE_PURPOSES, OBSERVATION_CATEGORIES, VISIBILITY } from "@/db/spatial";
import { audit } from "@/lib/audit";
import { bboxOf } from "./geo";
import { measure } from "./ops";

type Purpose = (typeof FEATURE_PURPOSES)[number];
type Visibility = (typeof VISIBILITY)[number];
type Grade = (typeof DATA_GRADES)[number];

const MAX_GEOMETRY_CHARS = 1_500_000; // D1 values stay well under the 2 MB limit

export async function saveFeature(db: Db, input: { mandateId: string; projectId?: string | null; purpose: Purpose; name: string; geometry: Geometry; scenario?: string; notes?: string; visibility?: Visibility; grade?: Grade; assumptions?: Record<string, string | number>; sourceAnalysisId?: string | null }, actor: string) {
  const text = JSON.stringify(input.geometry);
  if (text.length > MAX_GEOMETRY_CHARS) throw new Error("Geometry too large to store; simplify it first");
  const b = bboxOf(input.geometry);
  const m = measure(input.geometry) as Record<string, number>;
  const measures = Object.fromEntries(Object.entries(m).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  const [row] = await db.insert(siteFeatures).values({
    mandateId: input.mandateId, projectId: input.projectId ?? null, purpose: input.purpose, name: input.name, geometry: text, measures, scenario: input.scenario ?? "",
    notes: input.notes ?? "", visibility: input.visibility ?? "team", grade: input.grade ?? "screening", assumptions: input.assumptions ?? {}, sourceAnalysisId: input.sourceAnalysisId ?? null,
    west: b?.[0] ?? null, south: b?.[1] ?? null, east: b?.[2] ?? null, north: b?.[3] ?? null, createdBy: actor,
  }).returning();
  await audit(db, { actor, action: "site_feature_save", entity: "site_features", entityId: row.id, after: { purpose: input.purpose, name: input.name, projectId: input.projectId, measures } });
  return row;
}

export async function recordAnalysis(db: Db, input: { mandateId: string; projectId?: string | null; kind: string; title: string; params: Record<string, unknown>; datasets: { source: string; resolution: string; date?: string; license?: string }[]; results: Record<string, unknown>; geometry?: unknown; grade?: Grade; limitation: string }, actor: string) {
  let geometry: string | null = input.geometry ? JSON.stringify(input.geometry) : null;
  if (geometry && geometry.length > MAX_GEOMETRY_CHARS) geometry = null; // results kept; the heavy geometry is re-derivable from params
  const [row] = await db.insert(spatialAnalyses).values({ mandateId: input.mandateId, projectId: input.projectId ?? null, kind: input.kind, title: input.title, params: input.params, datasets: input.datasets, results: input.results, geometry, grade: input.grade ?? "screening", limitation: input.limitation, createdBy: actor }).returning();
  return row;
}

export async function listAnalyses(db: Db, mandateIds: string[], projectId?: string | null, limit = 50) {
  if (!mandateIds.length) return [];
  return db.select({ id: spatialAnalyses.id, kind: spatialAnalyses.kind, title: spatialAnalyses.title, params: spatialAnalyses.params, datasets: spatialAnalyses.datasets, results: spatialAnalyses.results, grade: spatialAnalyses.grade, limitation: spatialAnalyses.limitation, modelVersion: spatialAnalyses.modelVersion, createdBy: spatialAnalyses.createdBy, createdAt: spatialAnalyses.createdAt, projectId: spatialAnalyses.projectId, hasGeometry: sql<number>`${spatialAnalyses.geometry} is not null` })
    .from(spatialAnalyses).where(and(sql`${spatialAnalyses.mandateId} in ${mandateIds}`, projectId ? eq(spatialAnalyses.projectId, projectId) : undefined)).orderBy(desc(spatialAnalyses.createdAt)).limit(limit);
}

/** Features in view (bbox) or for a project, within the user's entities. */
export async function listFeatures(db: Db, mandateIds: string[], opts: { projectId?: string; bbox?: [number, number, number, number] }) {
  if (!mandateIds.length) return [];
  const b = opts.bbox;
  return db.select().from(siteFeatures).where(and(
    sql`${siteFeatures.mandateId} in ${mandateIds}`,
    opts.projectId ? eq(siteFeatures.projectId, opts.projectId) : undefined,
    b ? and(lte(siteFeatures.west, b[2]), gte(siteFeatures.east, b[0]), lte(siteFeatures.south, b[3]), gte(siteFeatures.north, b[1])) : undefined,
  )).orderBy(desc(siteFeatures.createdAt)).limit(500);
}

export async function addObservation(db: Db, input: { mandateId: string; projectId?: string | null; lng: number; lat: number; category: (typeof OBSERVATION_CATEGORIES)[number]; note: string; mediaUrl?: string | null; accuracyM?: number | null; headingDeg?: number | null; confidence?: "high" | "medium" | "low"; visibility?: Visibility; observedAt?: string }, actor: string) {
  if (!Number.isFinite(input.lng) || !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) throw new Error("Invalid coordinates");
  const [row] = await db.insert(fieldObservations).values({ ...input, observer: actor, observedAt: input.observedAt ?? new Date().toISOString() }).returning();
  await audit(db, { actor, action: "field_observation_add", entity: "field_observations", entityId: row.id, after: { category: input.category, projectId: input.projectId } });
  return row;
}

/** Turns a map observation into a task or a risk on its project (the observation keeps the link). */
export async function convertObservation(db: Db, id: string, to: "task" | "risk", actor: string) {
  const [o] = await db.select().from(fieldObservations).where(eq(fieldObservations.id, id));
  if (!o) throw new Error("Observation not found");
  if (o.convertedTo) return o.convertedTo;
  const where = `${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}`;
  let ref: string;
  if (to === "task") {
    const [t] = await db.insert(tasks).values({ mandateId: o.mandateId, projectId: o.projectId, type: "other", title: `Site: ${o.note.slice(0, 120)} (${where})`, dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }).returning({ id: tasks.id });
    ref = `task:${t.id}`;
  } else {
    if (!o.projectId) throw new Error("A risk needs the observation to belong to a project");
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, o.projectId));
    if (!p) throw new Error("Project not found");
    const [r] = await db.insert(risks).values({ projectId: o.projectId, mandateId: o.mandateId, category: "environmental", description: `${o.note} (field observation at ${where})`, evidence: `Field observation ${o.id} by ${o.observer}, ${o.observedAt.slice(0, 10)}` }).returning({ id: risks.id });
    ref = `risk:${r.id}`;
  }
  await db.update(fieldObservations).set({ convertedTo: ref }).where(eq(fieldObservations.id, id));
  await audit(db, { actor, action: "field_observation_convert", entity: "field_observations", entityId: id, after: { to: ref } });
  return ref;
}
