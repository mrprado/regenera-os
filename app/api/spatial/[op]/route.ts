import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FeatureCollection, Geometry } from "geojson";
import { fieldObservations, projects, siteFeatures } from "@/db/schema";
import { DATA_GRADES, FEATURE_PURPOSES, OBSERVATION_CATEGORIES, VISIBILITY } from "@/db/spatial";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { toCsv, toDxf, toGeoJson, toKml, type ExportMeta } from "@/lib/geo/export";
import { buffer, difference, intersect, measure, union, type Poly } from "@/lib/geo/ops";
import { rasterEnvelope, type RasterConstraint } from "@/lib/geo/raster-envelope";
import { CONSTRAINT_LABELS, constraintFeatures, nearestInfrastructure } from "@/lib/geo/osm";
import { addObservation, convertObservation, listAnalyses, listFeatures, recordAnalysis, saveFeature } from "@/lib/geo/workbench";

// Guarded: ATLAS workbench services (§ advanced geospatial). Vector geoprocessing, OSM-derived metrics and constraint
// screening run here; raster terrain analysis runs in the browser on decoded terrain tiles (lib/geo/dem.ts) and its
// results are recorded through `analyses`. Every stored result carries datasets, parameters, grade and limitation.
const zGeom = z.object({ type: z.string() }).passthrough() as unknown as z.ZodType<Geometry>;
const zBbox = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ op: string }> }) {
  const user = await getOsApiUser();
  if (!user) return json({ error: "Not authorized" }, 401);
  const { op } = await params;
  const q = new URL(request.url).searchParams;
  const db = appDb();
  if (op === "features") {
    const bbox = q.get("bbox")?.split(",").map(Number);
    const rows = await listFeatures(db, user.scope.mandateIds, { projectId: q.get("projectId") ?? undefined, bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? (bbox as [number, number, number, number]) : undefined });
    return json({ type: "FeatureCollection", features: rows.map(r => ({ type: "Feature", id: r.id, geometry: JSON.parse(r.geometry), properties: { id: r.id, purpose: r.purpose, name: r.name, scenario: r.scenario, grade: r.grade, visibility: r.visibility, projectId: r.projectId, measures: r.measures, createdBy: r.createdBy, createdAt: r.createdAt } })) });
  }
  if (op === "analyses") return json(await listAnalyses(db, user.scope.mandateIds, q.get("projectId")));
  if (op === "observations") {
    const rows = await db.select().from(fieldObservations).where(and(mandateCondition(user.scope, fieldObservations.mandateId), q.get("projectId") ? eq(fieldObservations.projectId, q.get("projectId")!) : undefined)).limit(500);
    return json({ type: "FeatureCollection", features: rows.map(o => ({ type: "Feature", geometry: { type: "Point", coordinates: [o.lng, o.lat] }, properties: { ...o } })) });
  }
  return json({ error: "Unknown operation" }, 404);
}

export async function POST(request: Request, { params }: { params: Promise<{ op: string }> }) {
  const user = await getOsApiUser();
  if (!user) return json({ error: "Not authorized" }, 401);
  const { op } = await params;
  const db = appDb();
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "JSON body required" }, 400); }

  // Mandate for a write: the project's (checked against scope) or the user's first entity.
  const mandateFor = async (projectId: unknown) => {
    if (typeof projectId === "string" && projectId) {
      const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
      if (!p) throw new Error("Project not found");
      return { mandateId: p.mandateId, projectId };
    }
    const m = user.scope.mandateIds[0];
    if (!m) throw new Error("No entity");
    return { mandateId: m, projectId: null };
  };

  try {
    switch (op) {
      case "measure": return json(measure(zGeom.parse(body.geometry)));
      case "buffer": return json(buffer(zGeom.parse(body.geometry), z.number().positive().max(200_000).parse(body.distanceM)));
      case "intersect": case "difference": case "union": {
        const a = z.array(zGeom).min(2).max(50).parse(body.geometries).map(g => ({ type: "Feature", geometry: g, properties: {} }) as Poly);
        const r = op === "union" ? union(a) : op === "intersect" ? intersect(a[0], a[1]) : difference(a[0], a[1]);
        return json(r ? { geometry: r.geometry, measures: measure(r.geometry) } : { geometry: null, measures: null });
      }
      case "nearest": {
        const { lng, lat } = z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).parse(body);
        const res = await nearestInfrastructure(db, lng, lat);
        const where = await mandateFor(body.projectId);
        const run = await recordAnalysis(db, { ...where, kind: "nearest_infrastructure", title: `Nearest infrastructure at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, params: { lng, lat }, datasets: [{ source: res.source, resolution: "vector", license: "ODbL" }], results: { items: res.items }, limitation: "Community-mapped OSM data; straight-line distances; absence in OSM is not absence on the ground. Grid capacity is never inferred." }, user.email);
        return json({ ...res, analysisId: run.id });
      }
      case "constraints": {
        const bbox = zBbox.parse(body.bbox);
        return json(await constraintFeatures(db, bbox));
      }
      case "developable-area": {
        const site = { type: "Feature", geometry: zGeom.parse(body.site), properties: {} } as Poly;
        if (!/Polygon/.test(site.geometry.type)) return json({ error: "The site must be a polygon" }, 400);
        const spec = z.array(z.object({ key: z.string(), kind: z.enum(["hard", "soft", "opportunity"]), bufferM: z.number().min(0).max(20_000).optional() })).max(20).parse(body.constraints);
        const custom = z.array(z.object({ label: z.string().max(80), kind: z.enum(["hard", "soft", "opportunity"]), geometry: zGeom, bufferM: z.number().min(0).max(20_000).optional() })).max(20).optional().parse(body.custom) ?? [];
        const m = measure(site.geometry) as { areaHa?: number };
        const b = site.geometry.type === "Polygon" ? site.geometry.coordinates.flat() : (site.geometry as { coordinates: number[][][][] }).coordinates.flat(2);
        const pad = 0.01;
        const bbox: [number, number, number, number] = [Math.min(...b.map(p => p[0])) - pad, Math.min(...b.map(p => p[1])) - pad, Math.max(...b.map(p => p[0])) + pad, Math.max(...b.map(p => p[1])) + pad];
        const osm = spec.length ? await constraintFeatures(db, bbox) : { layers: {} as Record<string, FeatureCollection>, source: "" };
        const constraints: RasterConstraint[] = [
          ...spec.map(s => ({ id: s.key, label: CONSTRAINT_LABELS[s.key] ?? s.key, kind: s.kind, bufferM: s.bufferM, features: osm.layers[s.key]?.features ?? [], source: osm.source })),
          ...custom.map((c, i) => ({ id: `custom_${i}`, label: c.label, kind: c.kind, bufferM: c.bufferM, features: [{ type: "Feature" as const, geometry: c.geometry, properties: {} }], source: "User-drawn" })),
        ];
        const env = rasterEnvelope(site.geometry, constraints);
        const where = await mandateFor(body.projectId);
        const run = await recordAnalysis(db, { ...where, kind: "developable_area", title: `Development envelope (${Math.round(m.areaHa ?? 0)} ha site)`, params: { constraints: spec, custom: custom.map(c => ({ label: c.label, kind: c.kind, bufferM: c.bufferM })) }, datasets: [{ source: osm.source || "User-drawn only", resolution: "vector", license: "ODbL" }], results: { siteHa: env.siteHa, hardExcludedHa: env.hardExcludedHa, softHa: env.softHa, netHa: env.netHa, cellM: env.cellM, byConstraint: env.byConstraint }, geometry: env.envelope, limitation: `SCREENING at ${env.cellM.toFixed(1)} m cells: OSM constraints are community-mapped and are not legal boundaries; buffers are user assumptions. Confirm with survey, title and regulatory review.` }, user.email);
        return json({ ...env, envelope: env.envelope ? { type: "Feature", geometry: env.envelope, properties: {} } : null, soft: env.soft ? { type: "Feature", geometry: env.soft, properties: {} } : null, analysisId: run.id });
      }
      case "features": {
        const where = await mandateFor(body.projectId);
        const row = await saveFeature(db, {
          ...where, purpose: z.enum(FEATURE_PURPOSES).parse(body.purpose), name: z.string().trim().max(160).parse(body.name ?? ""), geometry: zGeom.parse(body.geometry),
          scenario: z.string().max(80).optional().parse(body.scenario), notes: z.string().max(2000).optional().parse(body.notes), visibility: z.enum(VISIBILITY).optional().parse(body.visibility),
          grade: z.enum(DATA_GRADES).optional().parse(body.grade), sourceAnalysisId: z.string().uuid().nullable().optional().parse(body.sourceAnalysisId),
        }, user.email);
        return json({ id: row.id, measures: row.measures });
      }
      case "features-delete": {
        const id = z.string().uuid().parse(body.id);
        const r = await db.delete(siteFeatures).where(and(eq(siteFeatures.id, id), mandateCondition(user.scope, siteFeatures.mandateId))).returning({ id: siteFeatures.id });
        return json({ deleted: r.length });
      }
      case "analyses": {
        const where = await mandateFor(body.projectId);
        const a = z.object({ kind: z.string().max(40), title: z.string().max(200), params: z.record(z.unknown()), datasets: z.array(z.object({ source: z.string().max(300), resolution: z.string().max(80), date: z.string().max(40).optional(), license: z.string().max(120).optional() })).max(10), results: z.record(z.unknown()), limitation: z.string().max(600), grade: z.enum(DATA_GRADES).optional() }).parse(body);
        const row = await recordAnalysis(db, { ...where, ...a, geometry: body.geometry }, user.email);
        return json({ id: row.id });
      }
      case "observations": {
        const where = await mandateFor(body.projectId);
        const o = z.object({ lng: z.number(), lat: z.number(), category: z.enum(OBSERVATION_CATEGORIES), note: z.string().trim().min(2).max(2000), mediaUrl: z.string().url().max(500).nullable().optional(), accuracyM: z.number().min(0).max(10_000).nullable().optional(), headingDeg: z.number().min(0).max(360).nullable().optional(), confidence: z.enum(["high", "medium", "low"]).optional(), visibility: z.enum(VISIBILITY).optional() }).parse(body);
        const row = await addObservation(db, { ...where, ...o }, user.email);
        return json({ id: row.id });
      }
      case "observations-convert": {
        const id = z.string().uuid().parse(body.id);
        const [o] = await db.select({ id: fieldObservations.id }).from(fieldObservations).where(and(eq(fieldObservations.id, id), mandateCondition(user.scope, fieldObservations.mandateId)));
        if (!o) return json({ error: "Not found" }, 404);
        return json({ ref: await convertObservation(db, id, z.enum(["task", "risk"]).parse(body.to), user.email) });
      }
      case "export": {
        const fc = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({ type: z.literal("Feature") }).passthrough()).max(20_000) }).parse(body.featureCollection) as unknown as FeatureCollection;
        const format = z.enum(["geojson", "kml", "csv", "dxf", "dxf-utm"]).parse(body.format);
        const meta: ExportMeta = { title: z.string().max(120).parse(body.title ?? "Regenera ATLAS export"), source: z.string().max(400).parse(body.source ?? "Regenera ATLAS"), grade: z.string().max(40).parse(body.grade ?? "SCREENING"), crs: format === "dxf-utm" ? "UTM (zone of first feature)" : "WGS84 (EPSG:4326)", generatedAt: new Date().toISOString() };
        const [text, type, ext] = format === "kml" ? [toKml(fc, meta), "application/vnd.google-earth.kml+xml", "kml"] : format === "csv" ? [toCsv(fc, meta), "text/csv", "csv"] : format.startsWith("dxf") ? [toDxf(fc, meta, { utm: format === "dxf-utm", layerOf: f => String(f.properties?.major === true ? "CONTOUR_MAJOR" : f.properties?.major === false ? "CONTOUR_MINOR" : f.properties?.purpose ?? f.properties?.category ?? "REGENERA") }), "application/dxf", "dxf"] : [toGeoJson(fc, meta), "application/geo+json", "geojson"];
        const name = meta.title.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "export";
        return new Response(text, { headers: { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="${name}.${ext}"`, "cache-control": "no-store" } });
      }
      default: return json({ error: "Unknown operation" }, 404);
    }
  } catch (error) {
    const msg = error instanceof z.ZodError ? `Invalid input: ${error.issues[0]?.path.join(".")} ${error.issues[0]?.message}` : (error as Error).message;
    return json({ error: msg.slice(0, 300) }, error instanceof z.ZodError ? 400 : 422);
  }
}
