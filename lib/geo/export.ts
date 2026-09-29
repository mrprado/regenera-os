// Spatial exports for the workbench: GeoJSON, KML, CSV (points/centroids) and DXF (R12 ASCII; lines and polygons in
// WGS84 degrees, or UTM metres when a zone is given). Metadata (source, grade, CRS) travels with every export.
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { toUtm } from "./crs";

export type ExportMeta = { title: string; source: string; grade: string; crs: string; generatedAt: string };

const esc = (s: unknown) => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const kmlCoords = (c: Position[]) => c.map(p => `${p[0]},${p[1]}${p[2] !== undefined ? `,${p[2]}` : ""}`).join(" ");

function kmlGeometry(g: Geometry): string {
  switch (g.type) {
    case "Point": return `<Point><coordinates>${g.coordinates.join(",")}</coordinates></Point>`;
    case "LineString": return `<LineString><tessellate>1</tessellate><coordinates>${kmlCoords(g.coordinates)}</coordinates></LineString>`;
    case "Polygon": return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map(r => `<innerBoundaryIs><LinearRing><coordinates>${kmlCoords(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
    case "MultiPoint": return `<MultiGeometry>${g.coordinates.map(c => kmlGeometry({ type: "Point", coordinates: c })).join("")}</MultiGeometry>`;
    case "MultiLineString": return `<MultiGeometry>${g.coordinates.map(c => kmlGeometry({ type: "LineString", coordinates: c })).join("")}</MultiGeometry>`;
    case "MultiPolygon": return `<MultiGeometry>${g.coordinates.map(c => kmlGeometry({ type: "Polygon", coordinates: c })).join("")}</MultiGeometry>`;
    case "GeometryCollection": return `<MultiGeometry>${g.geometries.map(kmlGeometry).join("")}</MultiGeometry>`;
  }
}

export function toKml(fc: FeatureCollection, meta: ExportMeta) {
  const placemarks = fc.features.filter(f => f.geometry).map((f, i) => {
    const p = f.properties ?? {};
    const data = Object.entries(p).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join("");
    return `<Placemark><name>${esc(p.name ?? p.elevation ?? `Feature ${i + 1}`)}</name><ExtendedData>${data}</ExtendedData>${kmlGeometry(f.geometry!)}</Placemark>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(meta.title)}</name><description>${esc(`${meta.source} · ${meta.grade} · ${meta.crs} · ${meta.generatedAt}`)}</description>\n${placemarks}\n</Document></kml>`;
}

export function toGeoJson(fc: FeatureCollection, meta: ExportMeta) {
  return JSON.stringify({ ...fc, metadata: meta });
}

function centroid(g: Geometry): Position | null {
  const all: Position[] = [];
  const walk = (x: unknown): void => { if (Array.isArray(x) && typeof x[0] === "number") all.push(x as Position); else if (Array.isArray(x)) x.forEach(walk); };
  if (g.type === "GeometryCollection") g.geometries.forEach(gg => walk((gg as { coordinates: unknown }).coordinates)); else walk(g.coordinates);
  if (!all.length) return null;
  return [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
}

export function toCsv(fc: FeatureCollection, meta: ExportMeta) {
  const keys = [...new Set(fc.features.flatMap(f => Object.keys(f.properties ?? {}).filter(k => typeof (f.properties as Record<string, unknown>)[k] !== "object")))];
  const cell = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const rows = fc.features.map(f => { const c = f.geometry ? centroid(f.geometry) : null; return [f.geometry?.type ?? "", c?.[1] ?? "", c?.[0] ?? "", ...keys.map(k => (f.properties as Record<string, unknown>)?.[k])].map(cell).join(","); });
  return [`# ${meta.title}; ${meta.source}; ${meta.grade}; lat/lng are WGS84 (centroid for lines and areas)`, ["geometry", "lat", "lng", ...keys].join(","), ...rows].join("\n");
}

/** DXF R12: POLYLINE entities on layers named by `layerOf`; in UTM metres when utm is true (zone from the first vertex). */
export function toDxf(fc: FeatureCollection, meta: ExportMeta, opts: { utm?: boolean; layerOf?: (f: Feature) => string } = {}) {
  const first = fc.features.map(f => f.geometry && centroid(f.geometry)).find(Boolean) as Position | undefined;
  const zone = opts.utm && first ? toUtm(first[0], first[1]) : null;
  const xy = (p: Position): [number, number] => {
    if (!zone) return [p[0], p[1]];
    const u = toUtm(p[0], p[1]);
    return [u.easting, u.northing];
  };
  const out: string[] = ["0", "SECTION", "2", "HEADER", "999", `${meta.title}; ${meta.source}; ${meta.grade}; ${zone ? `UTM ${zone.zone}${zone.hemisphere} (EPSG:${zone.epsg}) metres` : "WGS84 degrees"}`, "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  const poly = (coords: Position[], layer: string, closedRing: boolean, elevation?: number) => {
    out.push("0", "POLYLINE", "8", layer, "66", "1", "70", closedRing ? "1" : "0");
    if (elevation !== undefined) out.push("38", String(elevation));
    for (const p of coords) { const [x, y] = xy(p); out.push("0", "VERTEX", "8", layer, "10", x.toFixed(zone ? 3 : 8), "20", y.toFixed(zone ? 3 : 8), "30", String(elevation ?? p[2] ?? 0)); }
    out.push("0", "SEQEND");
  };
  for (const f of fc.features) {
    const g = f.geometry; if (!g) continue;
    const layer = (opts.layerOf?.(f) ?? "REGENERA").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 31);
    const elev = typeof f.properties?.elevation === "number" ? (f.properties.elevation as number) : undefined;
    if (g.type === "LineString") poly(g.coordinates, layer, false, elev);
    else if (g.type === "MultiLineString") g.coordinates.forEach(c => poly(c, layer, false, elev));
    else if (g.type === "Polygon") g.coordinates.forEach(r => poly(r, layer, true, elev));
    else if (g.type === "MultiPolygon") g.coordinates.forEach(p => p.forEach(r => poly(r, layer, true, elev)));
    else if (g.type === "Point") { const [x, y] = xy(g.coordinates); out.push("0", "POINT", "8", layer, "10", String(x), "20", String(y), "30", String(elev ?? 0)); }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}
