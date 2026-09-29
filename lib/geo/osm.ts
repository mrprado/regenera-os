// OpenStreetMap (Overpass) features for the ATLAS workbench: nearest infrastructure (derived metrics) and constraint
// features inside a site's bbox. Through fetchJson: registry gate, 30-day cache, ledger. Community-mapped data:
// every result says "mapped in OSM" and distances are straight-line; absence in OSM is never reported as absence.
import { z } from "zod";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";
import { nearest } from "./ops";

const DAY = 86_400_000;
const zEl = z.object({
  type: z.string(), id: z.number(), lat: z.number().optional(), lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  geometry: z.array(z.object({ lat: z.number(), lon: z.number() }).nullable()).optional(),
  members: z.array(z.object({ type: z.string(), role: z.string().optional(), geometry: z.array(z.object({ lat: z.number(), lon: z.number() }).nullable()).optional() }).passthrough()).optional(),
  tags: z.record(z.string()).optional(),
}).passthrough();
const zOverpass = z.object({ elements: z.array(zEl) });
type El = z.infer<typeof zEl>;

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

// Public Overpass instances, tried in order (the main instance first; mirrors when it times out or rejects).
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
async function overpass(db: Db, endpoint: string, q: string, cacheKey: string, fetchImpl?: typeof fetch) {
  let last: unknown;
  for (const url of OVERPASS) {
    try {
      return await fetchJson(db, { provider: "overpass", endpoint, url, init: { method: "POST", body: new URLSearchParams({ data: q }), headers: { "content-type": "application/x-www-form-urlencoded" } }, schema: zOverpass, cacheKey, cacheTtlMs: 30 * DAY, staleOnError: true, timeoutMs: 90_000, retries: 0, fetchImpl });
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("Overpass unavailable");
}
const pts = (g?: ({ lat: number; lon: number } | null)[]) => (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map(p => [r4(p.lon), r4(p.lat)] as Position);
const closed = (c: Position[]) => c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];

/** Overpass element → GeoJSON feature (points, lines, closed areas; multipolygon relations from closed outer members). */
export function toFeature(e: El, category: string, areaLike = false): Feature | null {
  let geometry: Geometry | null = null;
  if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) geometry = { type: "Point", coordinates: [r4(e.lon), r4(e.lat)] };
  else if (e.geometry) { const c = pts(e.geometry); if (c.length >= 2) geometry = areaLike && closed(c) ? { type: "Polygon", coordinates: [c] } : { type: "LineString", coordinates: c }; }
  else if (e.members) {
    const outers = e.members.filter(m => m.role !== "inner").map(m => pts(m.geometry)).filter(c => c.length >= 2);
    const rings = outers.filter(closed);
    if (areaLike && rings.length) geometry = { type: "MultiPolygon", coordinates: rings.map(r => [r]) };
    else if (outers.length) geometry = { type: "MultiLineString", coordinates: outers };
  }
  if (!geometry && e.center) geometry = { type: "Point", coordinates: [r4(e.center.lon), r4(e.center.lat)] };
  if (!geometry) return null;
  const t = e.tags ?? {};
  return { type: "Feature", geometry, properties: { osmId: `${e.type}/${e.id}`, category, name: t["name:en"] ?? t.name ?? null, voltage: t.voltage ?? null, operator: t.operator ?? null, ref: t.ref ?? null, kind: t.highway ?? t.railway ?? t.aeroway ?? t.natural ?? t.waterway ?? t.landuse ?? t.boundary ?? t.leisure ?? t.place ?? t.power ?? null } };
}

const INFRA: { key: string; label: string; radiusM: number; query: string; out: string }[] = [
  { key: "substation", label: "Substation", radiusM: 50_000, query: 'nwr["power"="substation"]', out: "center 60" },
  { key: "transmission", label: "Transmission line", radiusM: 25_000, query: 'way["power"="line"]', out: "geom 40" },
  { key: "major_road", label: "Major road", radiusM: 15_000, query: 'way["highway"~"^(motorway|trunk|primary)$"]', out: "geom 40" },
  { key: "road", label: "Secondary or local road", radiusM: 3_000, query: 'way["highway"~"^(secondary|tertiary|unclassified)$"]', out: "geom 20" },
  { key: "rail", label: "Railway", radiusM: 40_000, query: 'way["railway"="rail"]', out: "geom 20" },
  { key: "airport", label: "Airport (IATA)", radiusM: 150_000, query: 'nwr["aeroway"="aerodrome"]["iata"]', out: "center 10" },
  { key: "port", label: "Port", radiusM: 150_000, query: 'nwr["landuse"="port"];nwr["industrial"="port"]', out: "center 10" },
  { key: "pipeline", label: "Pipeline", radiusM: 30_000, query: 'way["man_made"="pipeline"]', out: "geom 20" },
  { key: "industrial", label: "Industrial area (load)", radiusM: 15_000, query: 'way["landuse"="industrial"]', out: "center 30" },
  { key: "town", label: "Town or city", radiusM: 60_000, query: 'node["place"~"^(city|town)$"]', out: "40" },
  { key: "water_source", label: "River or named lake/reservoir", radiusM: 10_000, query: 'way["waterway"="river"];wr["natural"="water"]["name"]', out: "center 20" },
];

export type NearestInfra = { key: string; label: string; status: "known" | "unknown"; distanceM: number | null; name: string | null; detail: string | null; at: Position | null; searchedRadiusM: number };

/** Nearest mapped infrastructure around a point (one Overpass request, cached 30 days per ~1 km cell). */
export async function nearestInfrastructure(db: Db, lng: number, lat: number, fetchImpl?: typeof fetch): Promise<{ items: NearestInfra[]; source: string }> {
  const at = `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`;
  const parts = INFRA.map((k, i) => `(${k.query.split(";").map(q => `${q}(around:${k.radiusM},${lat},${lng});`).join("")})->.s${i};.s${i} out tags ${k.out};`);
  const q = `[out:json][timeout:80][maxsize:268435456];\n${parts.join("\n")}`;
  const r = await overpass(db, "workbench_nearest", q, `nearest:${at}`, fetchImpl);
  // Overpass returns sets in order but not labelled; classify by tags instead.
  const cat = (t: Record<string, string>): string | null =>
    t.power === "substation" ? "substation" : t.power === "line" ? "transmission" : /^(motorway|trunk|primary)$/.test(t.highway ?? "") ? "major_road" : t.highway ? "road"
      : t.railway === "rail" ? "rail" : t.aeroway === "aerodrome" ? "airport" : t.landuse === "port" || t.industrial === "port" ? "port"
      : t.man_made === "pipeline" ? "pipeline" : t.landuse === "industrial" ? "industrial" : /^(city|town)$/.test(t.place ?? "") ? "town" : t.waterway === "river" || t.natural === "water" ? "water_source" : null;
  const byCat = new Map<string, Feature[]>();
  for (const e of r.elements) { const c = cat(e.tags ?? {}); if (!c) continue; const f = toFeature(e, c); if (f) byCat.set(c, [...(byCat.get(c) ?? []), f]); }
  const items = INFRA.map(k => {
    const fs = byCat.get(k.key) ?? [];
    const n = fs.length ? nearest([lng, lat], { type: "FeatureCollection", features: fs }) : null;
    const p = n?.props as { name?: string | null; voltage?: string | null; operator?: string | null } | undefined;
    const detail = [p?.voltage ? `${Number(p.voltage.split(";")[0]) / 1000 || p.voltage} kV` : null, p?.operator].filter(Boolean).join(" · ") || null;
    return { key: k.key, label: k.label, status: n ? "known" as const : "unknown" as const, distanceM: n ? Math.round(n.distanceM) : null, name: p?.name ?? null, detail, at: n?.at ?? null, searchedRadiusM: k.radiusM };
  });
  return { items, source: "OpenStreetMap via Overpass (community-mapped; straight-line distance)" };
}

const CONSTRAINT_QUERIES: { key: string; label: string; query: string; area: boolean }[] = [
  { key: "protected", label: "Protected areas", query: 'wr["boundary"="protected_area"];wr["leisure"="nature_reserve"];wr["boundary"="national_park"]', area: true },
  { key: "wetland", label: "Wetlands", query: 'wr["natural"="wetland"]', area: true },
  { key: "water_body", label: "Water bodies", query: 'wr["natural"="water"]', area: true },
  { key: "watercourse", label: "Watercourses", query: 'way["waterway"~"^(river|stream|canal)$"]', area: false },
  { key: "settlement", label: "Settlements (residential land use)", query: 'wr["landuse"="residential"];wr["place"~"^(village|hamlet|town|city)$"]', area: true },
  { key: "road", label: "Roads", query: 'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"]', area: false },
  { key: "power_line", label: "Power lines", query: 'way["power"="line"]', area: false },
  { key: "forest", label: "Forest / woodland", query: 'wr["landuse"="forest"];wr["natural"="wood"]', area: true },
  { key: "farmland", label: "Farmland", query: 'wr["landuse"~"^(farmland|orchard|vineyard)$"]', area: true },
];

/** Constraint features inside a bbox (max ~0.25° a side), grouped by constraint key. */
export async function constraintFeatures(db: Db, bbox: [number, number, number, number], fetchImpl?: typeof fetch): Promise<{ layers: Record<string, FeatureCollection>; source: string }> {
  const [w, s, e, n] = bbox;
  if (e - w > 0.25 || n - s > 0.25) throw new Error("Area too large for constraint screening (max ~25 km a side). Draw a smaller site.");
  const b = `(${r4(s)},${r4(w)},${r4(n)},${r4(e)})`;
  const q = `[out:json][timeout:90][maxsize:67108864];\n(${CONSTRAINT_QUERIES.flatMap(c => c.query.split(";").map(x => `${x}${b};`)).join("")});out tags geom 3000;`;
  const r = await overpass(db, "workbench_constraints", q, `constraints:${bbox.map(r4).join(",")}`, fetchImpl);
  const key = (t: Record<string, string>) =>
    t.boundary === "protected_area" || t.leisure === "nature_reserve" || t.boundary === "national_park" ? "protected" : t.natural === "wetland" ? "wetland" : t.natural === "water" ? "water_body"
      : /^(river|stream|canal)$/.test(t.waterway ?? "") ? "watercourse" : t.landuse === "residential" || /^(village|hamlet|town|city)$/.test(t.place ?? "") ? "settlement" : t.power === "line" ? "power_line"
      : t.highway ? "road" : t.landuse === "forest" || t.natural === "wood" ? "forest" : /^(farmland|orchard|vineyard)$/.test(t.landuse ?? "") ? "farmland" : null;
  const layers: Record<string, FeatureCollection> = Object.fromEntries(CONSTRAINT_QUERIES.map(c => [c.key, { type: "FeatureCollection", features: [] }]));
  for (const el of r.elements) {
    const k = key(el.tags ?? {}); if (!k) continue;
    const f = toFeature(el, k, CONSTRAINT_QUERIES.find(c => c.key === k)!.area);
    if (f) layers[k].features.push(f);
  }
  return { layers, source: "OpenStreetMap via Overpass (community-mapped; completeness varies; not the legal boundary)" };
}

export const CONSTRAINT_LABELS = Object.fromEntries(CONSTRAINT_QUERIES.map(c => [c.key, c.label]));
