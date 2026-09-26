// Spatial helpers for Atlas (master build instruction §18–19). Pure functions: parsing (GeoJSON, KML, CSV points),
// bounds, bbox filtering (so large layers are never shipped whole to the browser) and geodesic area/length.
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

export type BBox = [number, number, number, number]; // west, south, east, north
const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export const MAX_FEATURES = 20_000;
export const MAX_BYTES = 5_000_000;

/** Area of a lon/lat ring in km² (spherical excess approximation, same as turf/area). */
export function ringAreaKm2(ring: Position[]) {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i], [l2, p2] = ring[i + 1];
    total += rad(l2 - l1) * (2 + Math.sin(rad(p1)) + Math.sin(rad(p2)));
  }
  return Math.abs((total * R * R) / 2) / 1e6;
}

export function geometryAreaKm2(g: Geometry): number {
  if (g.type === "Polygon") return Math.max(0, ringAreaKm2(g.coordinates[0]) - g.coordinates.slice(1).reduce((s, h) => s + ringAreaKm2(h), 0));
  if (g.type === "MultiPolygon") return g.coordinates.reduce((s, p) => s + geometryAreaKm2({ type: "Polygon", coordinates: p }), 0);
  return 0;
}

export function haversineM(a: Position, b: Position) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const lineLengthKm = (coords: Position[]) => coords.slice(1).reduce((s, c, i) => s + haversineM(coords[i], c), 0) / 1000;

function eachPosition(g: Geometry, fn: (p: Position) => void) {
  switch (g.type) {
    case "Point": fn(g.coordinates); break;
    case "MultiPoint": case "LineString": g.coordinates.forEach(fn); break;
    case "MultiLineString": case "Polygon": g.coordinates.forEach(r => r.forEach(fn)); break;
    case "MultiPolygon": g.coordinates.forEach(p => p.forEach(r => r.forEach(fn))); break;
    case "GeometryCollection": g.geometries.forEach(x => eachPosition(x, fn)); break;
  }
}

export function bboxOf(g: Geometry | FeatureCollection): BBox | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (geom: Geometry) => eachPosition(geom, ([x, y]) => { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; });
  if (g.type === "FeatureCollection") g.features.forEach(f => f.geometry && visit(f.geometry)); else visit(g);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Features of a collection that touch a bounding box (server-side viewport filter). */
export function clipToBBox(fc: FeatureCollection, box: BBox, limit = 5000): FeatureCollection {
  const out: Feature[] = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const b = bboxOf(f.geometry);
    if (b && bboxIntersects(b, box)) out.push(f);
    if (out.length >= limit) break;
  }
  return { type: "FeatureCollection", features: out };
}

const validPos = (p: unknown): p is Position => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

function validGeometry(g: unknown): g is Geometry {
  if (!g || typeof g !== "object") return false;
  const x = g as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  const all = (v: unknown, depth: number): boolean => depth === 0 ? validPos(v) : Array.isArray(v) && v.length > 0 && v.every(y => all(y, depth - 1));
  switch (x.type) {
    case "Point": return validPos(x.coordinates);
    case "MultiPoint": case "LineString": return all(x.coordinates, 1);
    case "MultiLineString": case "Polygon": return all(x.coordinates, 2);
    case "MultiPolygon": return all(x.coordinates, 3);
    case "GeometryCollection": return Array.isArray(x.geometries) && x.geometries.every(validGeometry);
    default: return false;
  }
}

/** Parses and validates GeoJSON (FeatureCollection, Feature or bare geometry) into a FeatureCollection. */
export function parseGeoJSON(text: string): FeatureCollection {
  const j = JSON.parse(text) as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };
  const features: Feature[] = j.type === "FeatureCollection" && Array.isArray(j.features) ? j.features as Feature[] : j.type === "Feature" ? [j as Feature] : [{ type: "Feature", geometry: j as Geometry, properties: {} }];
  const ok = features.filter(f => f && validGeometry(f.geometry)).slice(0, MAX_FEATURES).map(f => ({ type: "Feature" as const, geometry: f.geometry, properties: f.properties ?? {} }));
  if (!ok.length) throw new Error("No valid features (coordinates must be longitude, latitude in WGS84)");
  return { type: "FeatureCollection", features: ok };
}

/** Minimal KML: Placemarks with Point, LineString or Polygon (outer boundary). Names and descriptions kept. */
export function parseKml(text: string): FeatureCollection {
  const coords = (s: string) => s.trim().split(/\s+/).map(t => t.split(",").map(Number)).filter(c => c.length >= 2 && c.every(Number.isFinite)).map(c => [c[0], c[1]] as Position);
  const tag = (s: string, t: string) => s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1]?.trim() ?? "";
  const features: Feature[] = [];
  for (const pm of text.match(/<Placemark[\s\S]*?<\/Placemark>/gi) ?? []) {
    const name = tag(pm, "name").replace(/<!\[CDATA\[|\]\]>/g, "");
    const description = tag(pm, "description").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").slice(0, 500);
    let geometry: Geometry | null = null;
    const poly = pm.match(/<Polygon[\s\S]*?<\/Polygon>/i)?.[0];
    const line = pm.match(/<LineString[\s\S]*?<\/LineString>/i)?.[0];
    const pt = pm.match(/<Point[\s\S]*?<\/Point>/i)?.[0];
    if (poly) { const outer = tag(tag(poly, "outerBoundaryIs"), "coordinates"); const ring = coords(outer); if (ring.length >= 4) geometry = { type: "Polygon", coordinates: [ring] }; }
    else if (line) { const c = coords(tag(line, "coordinates")); if (c.length >= 2) geometry = { type: "LineString", coordinates: c }; }
    else if (pt) { const c = coords(tag(pt, "coordinates")); if (c[0]) geometry = { type: "Point", coordinates: c[0] }; }
    if (geometry && validGeometry(geometry)) features.push({ type: "Feature", geometry, properties: { name, description } });
    if (features.length >= MAX_FEATURES) break;
  }
  if (!features.length) throw new Error("No Placemarks with Point, LineString or Polygon found (KMZ: unzip and upload the .kml)");
  return { type: "FeatureCollection", features };
}

/** CSV with latitude/longitude columns (lat, latitude, y / lng, lon, longitude, x); other columns become properties. */
export function parseCsvPoints(text: string): FeatureCollection {
  const rows = text.trim().split(/\r?\n/).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  const head = rows[0].map(h => h.toLowerCase());
  const iLat = head.findIndex(h => ["lat", "latitude", "y"].includes(h)), iLng = head.findIndex(h => ["lng", "lon", "long", "longitude", "x"].includes(h));
  if (iLat < 0 || iLng < 0) throw new Error("CSV needs latitude and longitude columns");
  const features: Feature[] = [];
  for (const r of rows.slice(1, MAX_FEATURES + 1)) {
    const p: Position = [Number(r[iLng]), Number(r[iLat])];
    if (!validPos(p)) continue;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: Object.fromEntries(rows[0].map((h, i) => [h, r[i]]).filter((_, i) => i !== iLat && i !== iLng)) });
  }
  if (!features.length) throw new Error("No valid coordinates in the CSV");
  return { type: "FeatureCollection", features };
}

export function parseSpatial(filename: string, text: string): FeatureCollection {
  if (text.length > MAX_BYTES) throw new Error(`File too large (max ${MAX_BYTES / 1e6} MB); simplify or clip it first`);
  const f = filename.toLowerCase();
  if (f.endsWith(".kml")) return parseKml(text);
  if (f.endsWith(".csv")) return parseCsvPoints(text);
  if (f.endsWith(".geojson") || f.endsWith(".json") || text.trim().startsWith("{")) return parseGeoJSON(text);
  if (f.endsWith(".kmz") || f.endsWith(".zip") || f.endsWith(".tif") || f.endsWith(".tiff")) throw new Error("KMZ, zipped shapefiles and GeoTIFF: convert to GeoJSON first (e.g. ogr2ogr -f GeoJSON out.geojson in.shp); direct import is pending");
  throw new Error("Unsupported format: use GeoJSON, KML or CSV");
}
