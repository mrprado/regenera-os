// Fabric connectors added in phase 19 (free / keyless). Each goes through fetchJson (registry gate, cache, call ledger,
// stale fallback) and returns PlaceFact rows with source, licence and evidence tier, like lib/place/adapters.
import { z } from "zod";
import type { Db } from "@/db";
import { acquireSlot, fetchJson } from "@/lib/sources/http";
import { haversineKm, type PlaceFact } from "@/lib/place/adapters";

const DAY = 86_400_000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- ISRIC SoilGrids (250 m, CC BY 4.0; beta REST service, 5 req/min) ----------
const zSoil = z.object({ properties: z.object({ layers: z.array(z.object({ name: z.string(), unit_measure: z.object({ d_factor: z.number(), target_units: z.string() }).passthrough(), depths: z.array(z.object({ label: z.string(), values: z.object({ mean: z.number().nullable() }).passthrough() })) })) }) });
const SOIL: Record<string, { label: string; unit: string }> = {
  soc: { label: "Soil organic carbon (0–5 cm)", unit: "g/kg" }, phh2o: { label: "Soil pH in water (0–5 cm)", unit: "pH" },
  clay: { label: "Clay content (0–5 cm)", unit: "%" }, sand: { label: "Sand content (0–5 cm)", unit: "%" },
  nitrogen: { label: "Total nitrogen (0–5 cm)", unit: "g/kg" }, bdod: { label: "Bulk density (0–5 cm)", unit: "kg/dm³" },
};
export function normalizeSoil(r: z.infer<typeof zSoil>): PlaceFact[] {
  const out: PlaceFact[] = [];
  for (const l of r.properties.layers) {
    const meta = SOIL[l.name]; const v = l.depths[0]?.values.mean;
    if (!meta || v === null || v === undefined) continue;
    const value = Math.round((v / l.unit_measure.d_factor) * 100) / 100;
    out.push({ dimension: "land", key: `soil_${l.name}`, label: meta.label, value: `${value} ${meta.unit}`, numeric: value, unit: meta.unit, integrationKey: "soilgrids", sourceUrl: "https://soilgrids.org", tier: 2, license: "CC BY 4.0, ISRIC SoilGrids 2.0", observedFor: "SoilGrids 2.0 model (250 m)" });
  }
  return out;
}
export async function soilgridsAt(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  const props = Object.keys(SOIL).map(p => `property=${p}`).join("&");
  const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${r3(lng)}&lat=${r3(lat)}&${props}&depth=0-5cm&value=mean`;
  return normalizeSoil(await fetchJson(db, { provider: "soilgrids", endpoint: "properties_query", url, schema: zSoil, cacheKey: `soil:${lat.toFixed(3)},${lng.toFixed(3)}`, cacheTtlMs: 365 * DAY, staleOnError: true, timeoutMs: 45_000, retries: 1, fetchImpl }));
}

// ---------- Climate TRACE (CC BY 4.0): emitting assets near the site ----------
const zTrace = z.object({ assets: z.array(z.object({ Id: z.number(), Name: z.string(), Sector: z.string().nullish(), AssetType: z.string().nullish(), Centroid: z.object({ Geometry: z.tuple([z.number(), z.number()]) }).nullish(),
  EmissionsSummary: z.array(z.object({ Gas: z.string(), EmissionsQuantity: z.number().nullish(), Capacity: z.number().nullish(), CapacityUnits: z.string().nullish() }).passthrough()).nullish(),
  Owners: z.array(z.object({ CompanyName: z.string().nullish() }).passthrough()).nullish() }).passthrough()).nullish() }).passthrough();
export type TraceAsset = { id: number; name: string; sector: string; km: number; co2eTonnes: number | null; capacity: string | null; owners: string[] };
export function nearbyAssets(r: z.infer<typeof zTrace>, lat: number, lng: number, radiusKm: number): TraceAsset[] {
  const out: TraceAsset[] = [];
  for (const a of r.assets ?? []) {
    const g = a.Centroid?.Geometry; if (!g) continue;
    const km = haversineKm([lat, lng], [g[1], g[0]]); if (km > radiusKm) continue;
    const co2 = a.EmissionsSummary?.find(e => e.Gas === "co2e_100yr");
    const cap = co2?.Capacity && co2.CapacityUnits && !/restricted/i.test(co2.CapacityUnits) ? `${Math.round(co2.Capacity).toLocaleString("en-US")} ${co2.CapacityUnits}` : null;
    out.push({ id: a.Id, name: a.Name, sector: a.Sector ?? "", km: Math.round(km * 10) / 10, co2eTonnes: co2?.EmissionsQuantity ?? null, capacity: cap, owners: [...new Set((a.Owners ?? []).map(o => o.CompanyName ?? "").filter(Boolean))] });
  }
  return out.sort((a, b) => a.km - b.km);
}
/** Climate TRACE has no point search: the country's assets are read once (cached 30 days) and filtered by distance. */
export async function climateTraceNear(db: Db, iso3: string, lat: number, lng: number, radiusKm = 50, fetchImpl?: typeof fetch) {
  const url = `https://api.climatetrace.org/v6/assets?countries=${encodeURIComponent(iso3.toUpperCase())}&limit=1000`;
  const r = await fetchJson(db, { provider: "climate_trace", endpoint: "assets_country", url, schema: zTrace, cacheKey: `assets:${iso3.toUpperCase()}`, cacheTtlMs: 30 * DAY, staleOnError: true, timeoutMs: 60_000, retries: 1, fetchImpl });
  return { assets: nearbyAssets(r, lat, lng, radiusKm), sampled: r.assets?.length ?? 0 };
}

// ---------- Administrative chain (OpenStreetMap Nominatim reverse, 1 req/s) ----------
const zReverse = z.object({ address: z.record(z.string()).optional(), display_name: z.string().optional() }).passthrough();
export type AdminChain = { municipality: string | null; county: string | null; state: string | null; stateCode: string | null; country: string | null; countryCode: string | null };
export function normalizeReverse(r: z.infer<typeof zReverse>): AdminChain {
  const a = r.address ?? {};
  return { municipality: a.city ?? a.town ?? a.village ?? a.municipality ?? null, county: a.county ?? a.district ?? null, state: a.state ?? a.region ?? a.province ?? null, stateCode: a["ISO3166-2-lvl4"] ?? null, country: a.country ?? null, countryCode: a.country_code ? a.country_code.toUpperCase() : null };
}
export async function adminChain(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<AdminChain | null> {
  const cacheKey = `rev:${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (!fetchImpl && !(await acquireSlot(db, "nominatim", 1100))) return null;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${r3(lat)}&lon=${r3(lng)}&zoom=10&addressdetails=1`;
  return normalizeReverse(await fetchJson(db, { provider: "nominatim", endpoint: "reverse", url, schema: zReverse, cacheKey, cacheTtlMs: 180 * DAY, staleOnError: true, fetchImpl }));
}
