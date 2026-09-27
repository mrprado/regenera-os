// Atlas live feeds (lib/map/catalog.ts): pure normalizers (tested with fixtures) and fetchers through fetchJson, so
// every call is registry-gated, cached, retried and logged in the provider ledger. Responses are compact GeoJSON the
// globe renders directly. Nothing is interpolated or invented: stale or failed feeds say so.
import { z } from "zod";
import type { Feature, FeatureCollection } from "geojson";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";

const MIN = 60_000;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const fc = (features: Feature[], meta: Record<string, unknown> = {}): FeatureCollection & { meta: Record<string, unknown> } => ({ type: "FeatureCollection", features, meta });
const pt = (lng: number, lat: number, properties: Record<string, unknown>): Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [round(lng, 4), round(lat, 4)] }, properties });
const valid = (lng: unknown, lat: unknown): lng is number => typeof lng === "number" && typeof lat === "number" && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export type Bbox = [number, number, number, number];
export function parseBbox(s: string | null): Bbox | null {
  const b = s?.split(",").map(Number);
  if (!b || b.length !== 4 || !b.every(Number.isFinite)) return null;
  const [w, so, e, n] = b;
  if (so < -90 || n > 90 || so >= n || w < -180 || e > 180) return null;
  return [w, so, e, n];
}
const inBox = (lng: number, lat: number, b: Bbox | null) => !b || (lat >= b[1] && lat <= b[3] && (b[0] <= b[2] ? lng >= b[0] && lng <= b[2] : lng >= b[0] || lng <= b[2]));

// ---------- USGS earthquakes (GeoJSON summary feed) ----------
export const zQuakes = z.object({ features: z.array(z.object({ id: z.string(), geometry: z.object({ coordinates: z.array(z.number()) }).nullable(), properties: z.object({ mag: z.number().nullable(), place: z.string().nullable(), time: z.number(), url: z.string().nullable().optional(), tsunami: z.number().nullable().optional(), alert: z.string().nullable().optional(), sig: z.number().nullable().optional() }).passthrough() }).passthrough()) }).passthrough();
export type QuakeRow = [string, number, number, number, number | null, string, number, string | null, number];
export function compactQuakes(r: z.infer<typeof zQuakes>): QuakeRow[] {
  return r.features.filter(f => f.geometry && valid(f.geometry.coordinates[0], f.geometry.coordinates[1]))
    .map(f => [f.id, round(f.geometry!.coordinates[0], 4), round(f.geometry!.coordinates[1], 4), round(f.geometry!.coordinates[2] ?? 0, 1), f.properties.mag, f.properties.place ?? "", f.properties.time, f.properties.alert ?? null, f.properties.tsunami ?? 0]);
}
export function quakeFeatures(rows: QuakeRow[], now = Date.now()) {
  return fc(rows.map(([id, lng, lat, depth, mag, place, time, alert, tsunami]) => pt(lng, lat, {
    id, mag, place, depthKm: depth, time: new Date(time).toISOString(), ageH: Math.max(0, Math.round((now - time) / 3_600_000)),
    alert, tsunami: tsunami === 1, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
  })), { count: rows.length, source: "USGS", window: "7 days, M2.5+" });
}
const zQuakesCached = z.union([zQuakes.transform(compactQuakes), z.array(z.tuple([z.string(), z.number(), z.number(), z.number(), z.number().nullable(), z.string(), z.number(), z.string().nullable(), z.number()]))]);
export async function quakes(db: Db, fetchImpl?: typeof fetch) {
  const rows = await fetchJson(db, { provider: "usgs_quakes", endpoint: "feed_2.5_week", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson", schema: zQuakesCached, cacheKey: "atlas:2.5_week", cacheTtlMs: 5 * MIN, staleOnError: true, fetchImpl });
  return quakeFeatures(rows);
}

// ---------- NASA EONET natural events ----------
export const zEonet = z.object({ events: z.array(z.object({ id: z.string(), title: z.string(), link: z.string().optional(), categories: z.array(z.object({ id: z.string(), title: z.string() })), sources: z.array(z.object({ id: z.string(), url: z.string() })).optional(), geometry: z.array(z.object({ date: z.string(), type: z.string(), coordinates: z.unknown(), magnitudeValue: z.number().nullable().optional(), magnitudeUnit: z.string().nullable().optional() })) }).passthrough()) }).passthrough();
function centroid(type: string, coords: unknown): [number, number] | null {
  if (type === "Point" && Array.isArray(coords)) return valid(coords[0], coords[1]) ? [coords[0] as number, coords[1] as number] : null;
  if (type === "Polygon" && Array.isArray(coords) && Array.isArray(coords[0])) {
    const ring = coords[0] as number[][];
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const c: [number, number] = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
    return valid(c[0], c[1]) ? c : null;
  }
  return null;
}
export function eonetFeatures(r: z.infer<typeof zEonet>) {
  const out: Feature[] = [];
  for (const e of r.events) {
    const geo = [...e.geometry].sort((a, b) => a.date.localeCompare(b.date));
    const pts = geo.map(g => centroid(g.type, g.coordinates)).filter((p): p is [number, number] => !!p);
    const last = geo.at(-1);
    const at = pts.at(-1);
    if (!last || !at) continue;
    const cat = e.categories[0];
    if (pts.length > 1) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts.map(([x, y]) => [round(x, 3), round(y, 3)]) }, properties: { id: `${e.id}:track`, category: cat?.id ?? "other", track: true } });
    out.push(pt(at[0], at[1], { id: e.id, title: e.title, category: cat?.id ?? "other", categoryLabel: cat?.title ?? "Event", date: last.date, magnitude: last.magnitudeValue ?? null, magnitudeUnit: last.magnitudeUnit ?? null, url: e.sources?.[0]?.url ?? e.link ?? null, source: e.sources?.[0]?.id ?? "EONET" }));
  }
  return fc(out, { count: out.filter(f => f.geometry.type === "Point").length, source: "NASA EONET", window: "open events, 30 days" });
}
export async function eonet(db: Db, fetchImpl?: typeof fetch) {
  const r = await fetchJson(db, { provider: "nasa_eonet", endpoint: "events_open", url: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30", schema: zEonet, cacheKey: "atlas:open30", cacheTtlMs: 30 * MIN, staleOnError: true, timeoutMs: 30_000, fetchImpl });
  return eonetFeatures(r);
}

// ---------- NOAA NHC active cyclones ----------
export const zNhc = z.object({ activeStorms: z.array(z.object({ id: z.string(), name: z.string(), classification: z.string(), intensity: z.union([z.string(), z.number()]).nullable().optional(), pressure: z.union([z.string(), z.number()]).nullable().optional(), latitudeNumeric: z.number(), longitudeNumeric: z.number(), movementDir: z.number().nullable().optional(), movementSpeed: z.number().nullable().optional(), lastUpdate: z.string().optional(), publicAdvisory: z.object({ url: z.string() }).partial().nullable().optional() }).passthrough()) }).passthrough();
const CYCLONE_CLASS: Record<string, string> = { TD: "Tropical depression", TS: "Tropical storm", HU: "Hurricane", MH: "Major hurricane", STD: "Subtropical depression", STS: "Subtropical storm", PTC: "Post-tropical cyclone", PC: "Potential tropical cyclone", TY: "Typhoon" };
export function nhcFeatures(r: z.infer<typeof zNhc>) {
  const f = r.activeStorms.filter(s => valid(s.longitudeNumeric, s.latitudeNumeric)).map(s => pt(s.longitudeNumeric, s.latitudeNumeric, {
    id: s.id, name: s.name, classification: s.classification, classLabel: CYCLONE_CLASS[s.classification] ?? s.classification,
    windKt: s.intensity != null ? Number(s.intensity) : null, pressureMb: s.pressure != null ? Number(s.pressure) : null,
    movementDir: s.movementDir ?? null, movementKt: s.movementSpeed ?? null, updated: s.lastUpdate ?? null, url: s.publicAdvisory?.url ?? "https://www.nhc.noaa.gov",
  }));
  return fc(f, { count: f.length, source: "NOAA NHC" });
}
export async function cyclones(db: Db, fetchImpl?: typeof fetch) {
  const r = await fetchJson(db, { provider: "noaa_nhc", endpoint: "current_storms", url: "https://www.nhc.noaa.gov/CurrentStorms.json", schema: zNhc, cacheKey: "atlas:current", cacheTtlMs: 20 * MIN, staleOnError: true, fetchImpl });
  return nhcFeatures(r);
}

// ---------- NASA FIRMS active fires ----------
export type FireRow = [number, number, number, number, string];
/** CSV (MODIS or VIIRS) → [lng, lat, frp MW, confidence 0–100, "YYYY-MM-DD HHMM"]. Low-confidence detections dropped. */
export function compactFires(csv: string): FireRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const h = lines[0].split(",");
  const iLat = h.indexOf("latitude"), iLng = h.indexOf("longitude"), iFrp = h.indexOf("frp"), iConf = h.indexOf("confidence"), iDate = h.indexOf("acq_date"), iTime = h.indexOf("acq_time");
  const out: FireRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split(",");
    const c = r[iConf] ?? "";
    const conf = c === "h" || c === "high" ? 90 : c === "n" || c === "nominal" ? 60 : c === "l" || c === "low" ? 20 : Number(c);
    if (!(conf >= 40)) continue;
    const lat = Number(r[iLat]), lng = Number(r[iLng]);
    if (!valid(lng, lat)) continue;
    out.push([round(lng, 3), round(lat, 3), round(Number(r[iFrp]) || 0, 1), conf, `${r[iDate]} ${r[iTime]}`]);
  }
  return out;
}
export function fireFeatures(rows: FireRow[], bbox: Bbox | null, product: string, cap = 6000) {
  const inView = rows.filter(r => inBox(r[0], r[1], bbox));
  const top = inView.length > cap ? [...inView].sort((a, b) => b[2] - a[2]).slice(0, cap) : inView;
  return fc(top.map(([lng, lat, frp, conf, at]) => pt(lng, lat, { frp, confidence: conf, at })), { count: inView.length, shown: top.length, source: `NASA FIRMS ${product}`, window: "24 h" });
}
const zFiresCached = z.union([z.string().transform(compactFires), z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.string()]))]);
export async function fires(db: Db, mapKey: string | undefined, bbox: Bbox | null, fetchImpl?: typeof fetch) {
  if (mapKey && bbox) {
    const box = bbox.map(n => round(n, 1)).join(",");
    const rows = await fetchJson(db, { provider: "nasa_firms", endpoint: "area_csv_atlas", url: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_NOAA20_NRT/${box}/1`, schema: zFiresCached, as: "text", cacheKey: `atlas:${box}`, cacheTtlMs: 30 * MIN, staleOnError: true, fetchImpl });
    return fireFeatures(rows, bbox, "VIIRS 375 m");
  }
  const rows = await fetchJson(db, { provider: "nasa_firms_public", endpoint: "modis_global_24h", url: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv", schema: zFiresCached, as: "text", cacheKey: "atlas:modis24h", cacheTtlMs: 3 * 60 * MIN, staleOnError: true, timeoutMs: 45_000, fetchImpl });
  return fireFeatures(rows, bbox, "MODIS 1 km");
}

// ---------- adsb.lol live aircraft ----------
export const zAdsb = z.object({ ac: z.array(z.object({ hex: z.string(), flight: z.string().optional(), r: z.string().optional(), t: z.string().optional(), desc: z.string().optional(), alt_baro: z.union([z.number(), z.string()]).optional(), gs: z.number().optional(), track: z.number().optional(), true_heading: z.number().optional(), lat: z.number().optional(), lon: z.number().optional(), squawk: z.string().optional(), emergency: z.string().optional(), category: z.string().optional(), dbFlags: z.number().optional(), seen_pos: z.number().optional(), ownOp: z.string().optional() }).passthrough()).default([]), now: z.number().optional() }).passthrough();
export function aircraftFeatures(r: z.infer<typeof zAdsb>, military = false) {
  const f = r.ac.filter(a => valid(a.lon, a.lat) && (a.seen_pos ?? 0) < 120).map(a => pt(a.lon!, a.lat!, {
    id: a.hex, callsign: (a.flight ?? "").trim() || null, reg: a.r ?? null, type: a.t ?? null, desc: a.desc ?? null, operator: a.ownOp ?? null,
    altFt: typeof a.alt_baro === "number" ? a.alt_baro : null, ground: a.alt_baro === "ground", speedKt: a.gs != null ? Math.round(a.gs) : null,
    heading: Math.round(a.track ?? a.true_heading ?? 0), squawk: a.squawk ?? null, emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
    military: military || ((a.dbFlags ?? 0) & 1) === 1, category: a.category ?? null,
  }));
  return fc(f, { count: f.length, source: "adsb.lol" });
}
export async function flights(db: Db, lat: number, lng: number, distNm: number, fetchImpl?: typeof fetch) {
  const la = round(lat, 1), lo = round(lng, 1), d = Math.max(10, Math.min(250, Math.round(distNm)));
  const r = await fetchJson(db, { provider: "adsb_lol", endpoint: "point", url: `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/${d}`, schema: zAdsb, cacheKey: `atlas:${la},${lo},${d}`, cacheTtlMs: 12_000, retries: 1, timeoutMs: 15_000, fetchImpl });
  return aircraftFeatures(r);
}
export async function militaryFlights(db: Db, fetchImpl?: typeof fetch) {
  const r = await fetchJson(db, { provider: "adsb_lol", endpoint: "mil", url: "https://api.adsb.lol/v2/mil", schema: zAdsb, cacheKey: "atlas:mil", cacheTtlMs: 25_000, retries: 1, timeoutMs: 15_000, fetchImpl });
  return aircraftFeatures(r, true);
}

// ---------- CelesTrak orbital elements (OMM JSON), propagated in the browser ----------
export const SAT_GROUPS = ["resource", "weather", "stations", "gnss"] as const;
export type SatGroup = (typeof SAT_GROUPS)[number];
const zOmm = z.object({ OBJECT_NAME: z.string(), OBJECT_ID: z.string(), EPOCH: z.string(), MEAN_MOTION: z.number(), ECCENTRICITY: z.number(), INCLINATION: z.number(), RA_OF_ASC_NODE: z.number(), ARG_OF_PERICENTER: z.number(), MEAN_ANOMALY: z.number(), EPHEMERIS_TYPE: z.number(), CLASSIFICATION_TYPE: z.string(), NORAD_CAT_ID: z.number(), ELEMENT_SET_NO: z.number(), REV_AT_EPOCH: z.number(), BSTAR: z.number(), MEAN_MOTION_DOT: z.number(), MEAN_MOTION_DDOT: z.number() });
export const zOmmList = z.array(zOmm.passthrough()).transform(list => list.slice(0, 600).map(o => zOmm.parse(o)));
export type Omm = z.infer<typeof zOmm>;
export async function satellites(db: Db, group: SatGroup, fetchImpl?: typeof fetch) {
  const elements = await fetchJson(db, { provider: "celestrak", endpoint: `gp_${group}`, url: `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, schema: zOmmList, cacheKey: `atlas:${group}`, cacheTtlMs: 6 * 60 * MIN, staleOnError: true, timeoutMs: 30_000, fetchImpl });
  return { group, elements, meta: { count: elements.length, source: "CelesTrak", epochNote: "Positions are SGP4 propagations from the latest elements." } };
}
