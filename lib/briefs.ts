// Site briefs (Atlas Site Diagram Studio, 2D): create from a project (its boundary or point, its sourced place facts as
// context layers) or from an opportunity's linked project; annotate with a content class and evidence; compare scenarios
// on the same boundary, scale and rings; review and version. Diagrams are inputs to analysis and decisions, never
// engineering, energy-yield, hydrological or legal findings: a water arrow is "conceptual" unless measured or modeled.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, placeFacts, projects, siteBriefs, type BriefAnnotation, type BriefLayer, type ContentClass } from "@/db/schema";

export const BRIEF_TEMPLATES = {
  diagnostic: { label: "Diagnostic brief", purpose: "Context, constraints, unknowns and the investigations needed before proceeding.", kinds: ["constraint", "opportunity", "access", "infrastructure", "investigation", "unknown"] },
  development_options: { label: "Development options", purpose: "Alternatives, assumptions, trade-offs and the next decision.", kinds: ["development_zone", "no_build_zone", "access", "phase", "constraint", "unknown"] },
  epc_briefing: { label: "EPC briefing", purpose: "Access, interfaces, work and staging zones, and the questions needed to scope or bid.", kinds: ["access_route", "staging_zone", "work_area", "grid_interface", "constraint", "scope_question"] },
  capital_readiness: { label: "Capital-readiness brief", purpose: "Asset context, unresolved constraints, evidence gaps and capital milestones.", kinds: ["asset", "constraint", "evidence_gap", "milestone", "risk", "unknown"] },
  territorial_plan: { label: "Territorial intervention plan", purpose: "Locations, beneficiaries, dependencies and phases of interventions.", kinds: ["intervention", "beneficiaries", "dependency", "phase", "stakeholder", "unknown"] },
} as const;
export type BriefTemplate = keyof typeof BRIEF_TEMPLATES;
export const KIND_LABEL = (k: string) => k.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());

type Brief = typeof siteBriefs.$inferSelect;

function centroid(geojson: string | null): [number, number] | null {
  if (!geojson) return null;
  try {
    const j = JSON.parse(geojson) as { type: string; geometry?: { type: string; coordinates: unknown }; coordinates?: unknown };
    const g = j.type === "Feature" ? j.geometry! : j;
    const pts: [number, number][] = [];
    const walk = (c: unknown) => { if (Array.isArray(c) && typeof c[0] === "number") pts.push(c as [number, number]); else if (Array.isArray(c)) c.forEach(walk); };
    walk(g.coordinates);
    if (!pts.length) return null;
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  } catch { return null; }
}

export async function createBrief(db: Db, mandateId: string, input: { projectId?: string | null; dealId?: string | null; template: BriefTemplate }, by: string) {
  let projectId = input.projectId ?? null;
  if (input.dealId) {
    const [d] = await db.select({ projectId: deals.projectId, mandateId: deals.mandateId }).from(deals).where(eq(deals.id, input.dealId));
    if (!d || d.mandateId !== mandateId) throw new Error("Opportunity not found");
    projectId = projectId ?? d.projectId;
  }
  if (!projectId) throw new Error("A site brief needs a project with a location. Create and link a project first.");
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.mandateId, mandateId)));
  if (!p) throw new Error("Project not found");
  const c = centroid(p.geometry) ?? (p.lng != null && p.lat != null ? [p.lng, p.lat] as [number, number] : null);
  if (!c) throw new Error("The project has no location yet. Add a point or boundary on the project first.");
  const facts = await db.select({ key: placeFacts.integrationKey, label: placeFacts.label, at: placeFacts.retrievedAt, tier: placeFacts.tier }).from(placeFacts).where(eq(placeFacts.projectId, p.id));
  const layers: BriefLayer[] = [...new Map(facts.map(f => [f.key, { key: f.key, label: f.key.replace(/_/g, " "), source: f.key, observedAt: f.at.slice(0, 10), tier: `tier ${f.tier}` }])).values()];
  const t = BRIEF_TEMPLATES[input.template];
  const [row] = await db.insert(siteBriefs).values({
    mandateId, projectId: p.id, dealId: input.dealId ?? null, title: `${t.label}: ${p.name}`, template: input.template, boundary: p.geometry,
    centerLat: c[1], centerLng: c[0], zoom: p.geometry ? 15 : 14, rings: [1, 5, 10], locationAccuracy: p.geometry ? "boundary" : "point", layers,
    scenarios: [{ id: "base", name: "Existing context", assumptions: "As recorded today" }], annotations: [], author: by,
  }).returning();
  return row;
}

export async function scopedBrief(db: Db, mandateIds: string[], id: string): Promise<Brief> {
  const [b] = await db.select().from(siteBriefs).where(eq(siteBriefs.id, id));
  if (!b || !mandateIds.includes(b.mandateId)) throw new Error("Site brief not found");
  return b;
}

const editable = (b: Brief) => { if (b.reviewStatus === "approved") throw new Error("This version is approved. Create a new version to change it."); };

export function validAnnotation(a: { lng: number; lat: number }[], kind: string, contentClass: string) {
  if (!a.length || a.some(p => !Number.isFinite(p.lng) || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) return "Pick a location on the map.";
  if (!kind) return "Choose what the annotation marks.";
  if (!["measured", "modeled", "conceptual", "observed", "unknown"].includes(contentClass)) return "Choose a content class.";
  return null;
}

export async function addAnnotation(db: Db, b: Brief, input: { points: { lng: number; lat: number }[]; kind: string; label: string; note: string; contentClass: ContentClass; evidence: string; source: string; scenarioId: string | null }, by: string) {
  editable(b);
  const bad = validAnnotation(input.points, input.kind, input.contentClass);
  if (bad) throw new Error(bad);
  if ((input.contentClass === "measured" || input.contentClass === "modeled" || input.contentClass === "observed") && !input.evidence.trim()) throw new Error("Measured, modeled or field-observed content needs its evidence (survey, model run, observation record).");
  const geometry: BriefAnnotation["geometry"] = input.points.length === 1 ? { type: "Point", coordinates: [input.points[0].lng, input.points[0].lat] } : { type: "LineString", coordinates: input.points.map(p => [p.lng, p.lat]) };
  const a: BriefAnnotation = { id: crypto.randomUUID(), scenarioId: input.scenarioId, kind: input.kind, label: input.label.trim() || KIND_LABEL(input.kind), note: input.note.trim(), contentClass: input.contentClass, geometry, evidence: input.evidence.trim(), source: input.source.trim(), by, at: new Date().toISOString() };
  await db.update(siteBriefs).set({ annotations: [...b.annotations, a], updatedAt: a.at }).where(eq(siteBriefs.id, b.id));
}

export async function removeAnnotation(db: Db, b: Brief, annotationId: string) {
  editable(b);
  await db.update(siteBriefs).set({ annotations: b.annotations.filter(a => a.id !== annotationId), updatedAt: new Date().toISOString() }).where(eq(siteBriefs.id, b.id));
}

export async function addScenario(db: Db, b: Brief, name: string, assumptions: string) {
  editable(b);
  if (name.trim().length < 2) throw new Error("Name the scenario.");
  await db.update(siteBriefs).set({ scenarios: [...b.scenarios, { id: crypto.randomUUID().slice(0, 8), name: name.trim(), assumptions: assumptions.trim() }], updatedAt: new Date().toISOString() }).where(eq(siteBriefs.id, b.id));
}

export async function saveBriefMeta(db: Db, b: Brief, input: { assumptions: string; rings: number[]; decisionId: string | null }) {
  editable(b);
  const rings = input.rings.filter(r => r > 0 && r <= 200).slice(0, 5);
  await db.update(siteBriefs).set({ assumptions: input.assumptions, rings, decisionId: input.decisionId, updatedAt: new Date().toISOString() }).where(eq(siteBriefs.id, b.id));
}

export async function setBriefReview(db: Db, b: Brief, to: "draft" | "in_review" | "approved", by: string, isOwner: boolean) {
  if (to === "approved" && !isOwner) throw new Error("An owner approves a brief.");
  if (to === "approved" && b.author === by && !isOwner) throw new Error("The author cannot approve their own brief.");
  await db.update(siteBriefs).set({ reviewStatus: to, reviewedBy: to === "draft" ? null : by, reviewedAt: to === "draft" ? null : new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(siteBriefs.id, b.id));
}

/** A new editable version; the previous one is kept unchanged. */
export async function newBriefVersion(db: Db, b: Brief, by: string) {
  const [row] = await db.insert(siteBriefs).values({
    mandateId: b.mandateId, projectId: b.projectId, dealId: b.dealId, title: b.title, template: b.template, boundary: b.boundary, crs: b.crs,
    centerLat: b.centerLat, centerLng: b.centerLng, zoom: b.zoom, rings: b.rings, locationAccuracy: b.locationAccuracy, layers: b.layers,
    scenarios: b.scenarios, annotations: b.annotations, assumptions: b.assumptions, decisionId: b.decisionId,
    version: b.version + 1, previousId: b.id, reviewStatus: "draft", author: by,
  }).returning();
  return row;
}

export async function briefsFor(db: Db, mandateIds: string[], projectId?: string) {
  const rows = await db.select().from(siteBriefs).orderBy(desc(siteBriefs.updatedAt)).limit(200);
  return rows.filter(r => mandateIds.includes(r.mandateId) && (!projectId || r.projectId === projectId));
}

/** Metres per pixel at a latitude and Web Mercator zoom (256-px tiles); used for the scale bar and rings. */
export const metresPerPixel = (lat: number, z: number) => (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
