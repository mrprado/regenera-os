// Vector geoprocessing for the ATLAS workbench (Turf.js; runs in the browser and in the Worker): buffers, boolean
// operations, measurement, constraint subtraction and the development envelope. Geodesic measures, WGS84.
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry, LineString, MultiPolygon, Polygon, Position } from "geojson";

export type Poly = Feature<Polygon | MultiPolygon>;
const HA = 10_000;

export function measure(g: Geometry) {
  const f = turf.feature(g);
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    const areaM2 = turf.area(f);
    return { areaM2, areaHa: areaM2 / HA, areaKm2: areaM2 / 1e6, areaAcres: areaM2 / 4046.8564224, areaMi2: areaM2 / 2_589_988.11, perimeterM: turf.length(turf.polygonToLine(f as Poly) as Feature<LineString>, { units: "kilometers" }) * 1000 };
  }
  if (g.type === "LineString" || g.type === "MultiLineString") {
    const lengthM = turf.length(f as Feature<LineString>, { units: "kilometers" }) * 1000;
    return { lengthM, lengthKm: lengthM / 1000, lengthMi: lengthM / 1609.344, lengthFt: lengthM * 3.28084 };
  }
  return {};
}

/** Bearing (degrees from north) and distance (m) between two points. */
export function bearingDistance(a: Position, b: Position) {
  return { bearing: (turf.bearing(turf.point(a), turf.point(b)) + 360) % 360, distanceM: turf.distance(turf.point(a), turf.point(b), { units: "kilometers" }) * 1000 };
}
/** Point at a bearing and distance from an origin (bearing + distance entry). */
export function destination(origin: Position, bearingDeg: number, distanceM: number): Position {
  return turf.destination(turf.point(origin), distanceM / 1000, bearingDeg, { units: "kilometers" }).geometry.coordinates;
}

export function buffer(g: Geometry, distanceM: number, steps = 16): Poly | null {
  if (!(distanceM > 0)) return null;
  return (turf.buffer(turf.feature(g), distanceM / 1000, { units: "kilometers", steps }) as Poly | undefined) ?? null;
}
export function circle(center: Position, radiusM: number, steps = 64): Poly {
  return turf.circle(center, radiusM / 1000, { units: "kilometers", steps }) as Poly;
}
export function rectangle(a: Position, b: Position): Poly {
  return turf.bboxPolygon([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]) as Poly;
}
/** A corridor: a line buffered by half its width. */
export function corridor(line: Position[], widthM: number) { return buffer({ type: "LineString", coordinates: line }, widthM / 2); }

export function union(polys: Poly[]): Poly | null {
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0];
  return (turf.union(turf.featureCollection(polys)) as Poly | null) ?? null;
}
export function intersect(a: Poly, b: Poly): Poly | null { return (turf.intersect(turf.featureCollection([a, b])) as Poly | null) ?? null; }
export function difference(a: Poly, b: Poly): Poly | null { return (turf.difference(turf.featureCollection([a, b])) as Poly | null) ?? null; }
export function simplify(g: Geometry, toleranceM = 5) { return turf.simplify(turf.feature(g), { tolerance: toleranceM / 111_320, highQuality: true }); }

/** Splits a polygon with a line crossing it (screening: returns the two sides as polygons via a thin cut). */
export function splitPolygon(poly: Poly, line: Position[]): Poly[] {
  const cut = buffer({ type: "LineString", coordinates: line }, 0.05, 4);
  if (!cut) return [poly];
  const rest = difference(poly, cut);
  if (!rest) return [];
  return turf.flatten(rest).features as Poly[];
}

export type Constraint = { id: string; label: string; kind: "hard" | "soft" | "opportunity"; features: Feature[]; bufferM?: number; source: string };
export type EnvelopeResult = {
  siteHa: number; hardExcludedHa: number; softHa: number; netHa: number;
  envelope: Poly | null; soft: Poly | null;
  byConstraint: { id: string; label: string; kind: string; overlapHa: number; source: string }[];
};

/** Development envelope: site minus hard constraints (with buffers); soft constraints reported separately. */
export function developmentEnvelope(site: Poly, constraints: Constraint[]): EnvelopeResult {
  const siteHa = turf.area(site) / HA;
  let envelope: Poly | null = site;
  const hardParts: Poly[] = [], softParts: Poly[] = [];
  const byConstraint: EnvelopeResult["byConstraint"] = [];
  for (const c of constraints) {
    const shapes = c.features.flatMap(f => {
      const g = f.geometry; if (!g) return [];
      if (c.bufferM && c.bufferM > 0) { const b = buffer(g, c.bufferM); return b ? [b] : []; }
      return g.type === "Polygon" || g.type === "MultiPolygon" ? [f as Poly] : [];
    });
    const u = union(shapes);
    const overlap = u ? intersect(site, u) : null;
    byConstraint.push({ id: c.id, label: c.label, kind: c.kind, overlapHa: overlap ? turf.area(overlap) / HA : 0, source: c.source });
    if (!overlap) continue;
    if (c.kind === "hard") { hardParts.push(overlap); if (envelope) envelope = difference(envelope, overlap); }
    else if (c.kind === "soft") softParts.push(overlap);
  }
  const hardU = union(hardParts), softU = union(softParts);
  const softInEnvelope = softU && envelope ? intersect(envelope, softU) : null;
  return {
    siteHa, hardExcludedHa: hardU ? turf.area(hardU) / HA : 0, softHa: softInEnvelope ? turf.area(softInEnvelope) / HA : 0,
    netHa: envelope ? turf.area(envelope) / HA : 0, envelope, soft: softInEnvelope, byConstraint,
  };
}

/** Nearest feature of a set to a point: distance (m) and the feature's properties. */
export function nearest(point: Position, fc: FeatureCollection) {
  let best: { distanceM: number; props: Record<string, unknown>; at: Position } | null = null;
  for (const f of fc.features) {
    const g = f.geometry; if (!g) continue;
    let d = Infinity, at: Position = point;
    if (g.type === "Point") { d = turf.distance(point, g.coordinates, { units: "kilometers" }) * 1000; at = g.coordinates; }
    else if (g.type === "LineString" || g.type === "MultiLineString") {
      const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
      for (const l of lines) { if (l.length < 2) continue; const p = turf.nearestPointOnLine(turf.lineString(l), point, { units: "kilometers" }); const dd = (p.properties.dist ?? Infinity) * 1000; if (dd < d) { d = dd; at = p.geometry.coordinates; } }
    } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
      if (turf.booleanPointInPolygon(point, g)) { d = 0; at = point; }
      else { const lines = turf.polygonToLine(turf.feature(g) as Poly); for (const lf of (lines.type === "FeatureCollection" ? lines.features : [lines])) { const p = turf.nearestPointOnLine(lf as Feature<LineString>, point, { units: "kilometers" }); const dd = (p.properties.dist ?? Infinity) * 1000; if (dd < d) { d = dd; at = p.geometry.coordinates; } } }
    }
    if (d < (best?.distanceM ?? Infinity)) best = { distanceM: d, props: (f.properties ?? {}) as Record<string, unknown>, at };
  }
  return best;
}

/** Spatial predicate filter over features: within / outside / intersects a region, or within a distance of a point. */
export function spatialFilter(features: Feature[], op: "within" | "outside" | "intersects", region: Poly) {
  return features.filter(f => {
    if (!f.geometry) return false;
    const hit = op === "within" ? turf.booleanWithin(f, region) : turf.booleanIntersects(f, region);
    return op === "outside" ? !hit : hit;
  });
}

/** Screening quantities from sketched design objects (m, ha). */
export function quantities(objects: { kind: string; geometry: Geometry }[]) {
  const q: Record<string, { count: number; areaHa: number; lengthM: number; perimeterM: number }> = {};
  for (const o of objects) {
    const m = measure(o.geometry) as { areaHa?: number; lengthM?: number; perimeterM?: number };
    const e = (q[o.kind] ??= { count: 0, areaHa: 0, lengthM: 0, perimeterM: 0 });
    e.count++; e.areaHa += m.areaHa ?? 0; e.lengthM += m.lengthM ?? 0; e.perimeterM += m.perimeterM ?? 0;
  }
  return q;
}
