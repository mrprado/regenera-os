// Provider adapters (master build instruction §49–57). Each has a pure `normalize` (tested with fixtures, used in CI
// without keys) and a fetcher that goes through fetchJson: registry gate (disabled / licence-required never called),
// cache, retries with backoff, rate-limit handling, ledger (health), stale fallback. Credentials come from the Worker
// environment and are never sent to the browser. Nothing here fabricates data: no key → "credential required".
import { z } from "zod";
import type { Db } from "@/db";
import { fetchJson, SourceError } from "@/lib/sources/http";
import type { PlaceFact } from "@/lib/place/adapters";

const DAY = 86_400_000;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export class CredentialRequired extends Error {
  constructor(public provider: string, public envVar: string) { super(`${provider}: integration ready, credential required (${envVar})`); }
}
export class LicenseRequired extends Error {
  constructor(public provider: string, detail: string) { super(`${provider}: licence required (${detail})`); }
}

// ---------- PVGIS (EU JRC): PV potential for a site, server-side only ----------
export const zPvgis = z.object({
  inputs: z.object({ location: z.object({ latitude: z.number(), longitude: z.number() }).passthrough(), mounting_system: z.unknown().optional() }).passthrough(),
  outputs: z.object({ totals: z.object({ fixed: z.object({ E_y: z.number(), "H(i)_y": z.number().optional(), SD_y: z.number().optional() }).passthrough() }).passthrough(), monthly: z.unknown().optional() }).passthrough(),
});
export function normalizePvgis(r: z.infer<typeof zPvgis>): PlaceFact[] {
  const t = r.outputs.totals.fixed;
  const base = { integrationKey: "pvgis", sourceUrl: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en", tier: 1, license: "PVGIS (EU JRC), free reuse with attribution", observedFor: "PVGIS reference years" };
  const out: PlaceFact[] = [{ ...base, dimension: "climate", key: "pv_specific_yield", label: "PV specific yield (1 kWp, optimal fixed, 14% losses)", value: `${Math.round(t.E_y).toLocaleString("en-US")} kWh/kWp/year`, numeric: t.E_y, unit: "kWh/kWp/year" }];
  if (t["H(i)_y"] !== undefined) out.push({ ...base, dimension: "climate", key: "pv_plane_irradiation", label: "In-plane irradiation", value: `${Math.round(t["H(i)_y"]).toLocaleString("en-US")} kWh/m²/year`, numeric: t["H(i)_y"], unit: "kWh/m²/year" });
  if (t.SD_y !== undefined) out.push({ ...base, dimension: "climate", key: "pv_interannual_sd", label: "Year-to-year variability of PV output", value: `±${Math.round(t.SD_y).toLocaleString("en-US")} kWh/kWp`, numeric: t.SD_y, unit: "kWh/kWp" });
  return out;
}
export async function pvgis(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch) {
  const url = `https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=${round(lat, 4)}&lon=${round(lng, 4)}&peakpower=1&loss=14&optimalangles=1&outputformat=json`;
  return normalizePvgis(await fetchJson(db, { provider: "pvgis", endpoint: "PVcalc", url, schema: zPvgis, cacheKey: `pvcalc:${round(lat, 3)},${round(lng, 3)}`, cacheTtlMs: 365 * DAY, staleOnError: true, fetchImpl, timeoutMs: 30_000 }));
}

// ---------- Copernicus Data Space STAC: scene discovery (metadata only; no raster downloads) ----------
export const zStac = z.object({ features: z.array(z.object({ id: z.string(), collection: z.string().optional(), properties: z.record(z.unknown()), assets: z.record(z.object({ href: z.string() }).passthrough()).optional() }).passthrough()) }).passthrough();
export type Scene = { id: string; collection: string; datetime: string | null; cloudCover: number | null; platform: string | null };
export function normalizeStac(r: z.infer<typeof zStac>, maxCloud = 100): Scene[] {
  return r.features.map(f => ({
    id: f.id, collection: f.collection ?? "", datetime: typeof f.properties.datetime === "string" ? f.properties.datetime : null,
    cloudCover: typeof f.properties["eo:cloud_cover"] === "number" ? (f.properties["eo:cloud_cover"] as number) : null,
    platform: typeof f.properties.platform === "string" ? (f.properties.platform as string) : null,
  })).filter(s => s.cloudCover === null || s.cloudCover <= maxCloud).sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""));
}
export async function copernicusScenes(db: Db, bbox: [number, number, number, number], from: string, to: string, maxCloud = 30, baseUrl = "https://stac.dataspace.copernicus.eu/v1", fetchImpl?: typeof fetch) {
  const body = { collections: ["sentinel-2-l2a"], bbox, datetime: `${from}T00:00:00Z/${to}T23:59:59Z`, limit: 50 };
  const r = await fetchJson(db, { provider: "copernicus_stac", endpoint: "search", url: `${baseUrl}/search`, schema: zStac, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, cacheKey: `s2:${bbox.join(",")}:${from}:${to}`, cacheTtlMs: DAY, fetchImpl, timeoutMs: 30_000 });
  return normalizeStac(r, maxCloud);
}

// ---------- EIA API v2 ----------
export const zEia = z.object({ response: z.object({ data: z.array(z.record(z.unknown())), total: z.union([z.number(), z.string()]).optional() }).passthrough() }).passthrough();
export type EiaRow = { period: string; value: number | null; unit: string | null; series: string };
export function normalizeEia(r: z.infer<typeof zEia>, valueField: string): EiaRow[] {
  return r.response.data.map(d => ({ period: String(d.period ?? ""), value: d[valueField] === null || d[valueField] === undefined ? null : Number(d[valueField]), unit: typeof d[`${valueField}-units`] === "string" ? (d[`${valueField}-units`] as string) : null, series: String(d.seriesDescription ?? d.stateDescription ?? d.sectorName ?? "") }));
}
export async function eiaSeries(db: Db, apiKey: string | undefined, route: string, params: Record<string, string>, valueField: string, fetchImpl?: typeof fetch) {
  if (!apiKey) throw new CredentialRequired("eia", "EIA_API_KEY");
  const q = new URLSearchParams({ ...params, api_key: apiKey });
  const r = await fetchJson(db, { provider: "eia", endpoint: route, url: `https://api.eia.gov/v2/${route.replace(/^\/|\/$/g, "")}/data/?${q}`, schema: zEia, cacheKey: `${route}:${new URLSearchParams(params)}`, cacheTtlMs: DAY, staleOnError: true, fetchImpl });
  return normalizeEia(r, valueField);
}

// ---------- NOAA NCEI Climate Data Online (token) ----------
export const zNoaa = z.object({ results: z.array(z.object({ date: z.string(), datatype: z.string(), station: z.string(), value: z.number() }).passthrough()).optional() }).passthrough();
export function normalizeNoaa(r: z.infer<typeof zNoaa>) {
  return (r.results ?? []).map(x => ({ date: x.date.slice(0, 10), datatype: x.datatype, station: x.station, value: x.value }));
}
export async function noaaData(db: Db, token: string | undefined, params: { datasetid: string; locationid?: string; stationid?: string; datatypeid?: string; startdate: string; enddate: string }, fetchImpl?: typeof fetch) {
  if (!token) throw new CredentialRequired("noaa_cdo", "NOAA_CDO_TOKEN");
  const q = new URLSearchParams(Object.entries({ ...params, limit: "1000", units: "metric" }).filter(([, v]) => v) as [string, string][]);
  return normalizeNoaa(await fetchJson(db, { provider: "noaa_cdo", endpoint: "data", url: `https://www.ncei.noaa.gov/cdo-web/api/v2/data?${q}`, schema: zNoaa, init: { headers: { token } }, cacheKey: q.toString(), cacheTtlMs: 7 * DAY, staleOnError: true, fetchImpl }));
}

// ---------- NASA FIRMS active fires (MAP_KEY; CSV) ----------
export function normalizeFirmsCsv(csv: string) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { count: 0, highConfidence: 0, latest: null as string | null };
  const head = lines[0].split(",");
  const iConf = head.indexOf("confidence"), iDate = head.indexOf("acq_date");
  const rows = lines.slice(1).map(l => l.split(","));
  const high = rows.filter(r => ["h", "high"].includes((r[iConf] ?? "").toLowerCase()) || Number(r[iConf]) >= 80).length;
  const latest = iDate >= 0 ? rows.map(r => r[iDate]).sort().at(-1) ?? null : null;
  return { count: rows.length, highConfidence: high, latest };
}
export async function firmsFires(db: Db, mapKey: string | undefined, lat: number, lng: number, radiusKm = 25, days = 7, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  if (!mapKey) throw new CredentialRequired("nasa_firms", "NASA_FIRMS_MAP_KEY");
  const d = radiusKm / 111;
  const box = [lng - d, lat - d, lng + d, lat + d].map(n => round(n, 3)).join(",");
  const csv = await fetchJson(db, { provider: "nasa_firms", endpoint: "area_csv", url: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/${box}/${Math.min(10, days)}`, schema: z.string(), as: "text", cacheKey: `${box}:${days}`, cacheTtlMs: 6 * 3_600_000, fetchImpl });
  const n = normalizeFirmsCsv(csv);
  return [{ dimension: "ecology", key: "active_fires", label: `Active fire detections within ${radiusKm} km (last ${days} days, VIIRS)`, value: `${n.count} (${n.highConfidence} high confidence)${n.latest ? `, latest ${n.latest}` : ""}`, numeric: n.count, unit: "detections", integrationKey: "nasa_firms", sourceUrl: "https://firms.modaps.eosdis.nasa.gov", tier: 2, license: "NASA FIRMS (open; cite NASA FIRMS)", observedFor: `Last ${days} days` }];
}

// ---------- ENTSO-E Transparency (token; XML) ----------
export function normalizeEntsoePrices(xml: string) {
  const prices = [...xml.matchAll(/<price\.amount>([-\d.]+)<\/price\.amount>/g)].map(m => Number(m[1]));
  const currency = xml.match(/<currency_Unit\.name>(\w+)<\/currency_Unit\.name>/)?.[1] ?? null;
  const unit = xml.match(/<price_Measure_Unit\.name>(\w+)<\/price_Measure_Unit\.name>/)?.[1] ?? null;
  if (!prices.length) return null;
  return { points: prices.length, mean: round(prices.reduce((a, b) => a + b, 0) / prices.length, 2), min: Math.min(...prices), max: Math.max(...prices), currency, unit };
}
export async function entsoeDayAhead(db: Db, token: string | undefined, biddingZone: string, dayStartUtc: string, fetchImpl?: typeof fetch) {
  if (!token) throw new CredentialRequired("entsoe", "ENTSOE_TOKEN");
  const start = dayStartUtc.replace(/[-:T]/g, "").slice(0, 8) + "0000";
  const end = new Date(Date.parse(dayStartUtc) + DAY).toISOString().replace(/[-:T]/g, "").slice(0, 8) + "0000";
  const q = new URLSearchParams({ securityToken: token, documentType: "A44", in_Domain: biddingZone, out_Domain: biddingZone, periodStart: start, periodEnd: end });
  const xml = await fetchJson(db, { provider: "entsoe", endpoint: "A44", url: `https://web-api.tp.entsoe.eu/api?${q}`, schema: z.string(), as: "text", cacheKey: `${biddingZone}:${start}`, cacheTtlMs: DAY, fetchImpl });
  return normalizeEntsoePrices(xml);
}

// ---------- FRED (key) ----------
export const zFred = z.object({ observations: z.array(z.object({ date: z.string(), value: z.string() })) });
export const normalizeFred = (r: z.infer<typeof zFred>) => r.observations.map(o => ({ date: o.date, value: o.value === "." ? null : Number(o.value) }));
export async function fredSeries(db: Db, apiKey: string | undefined, seriesId: string, fetchImpl?: typeof fetch) {
  if (!apiKey) throw new CredentialRequired("fred", "FRED_API_KEY");
  const q = new URLSearchParams({ series_id: seriesId, api_key: apiKey, file_type: "json", sort_order: "desc", limit: "120" });
  return normalizeFred(await fetchJson(db, { provider: "fred", endpoint: "observations", url: `https://api.stlouisfed.org/fred/series/observations?${q}`, schema: zFred, cacheKey: seriesId, cacheTtlMs: DAY, staleOnError: true, fetchImpl }));
}

// ---------- IMF SDMX (no key; endpoint configurable because the IMF is migrating its API) ----------
export const zImfCompact = z.object({ CompactData: z.object({ DataSet: z.object({ Series: z.union([z.object({ Obs: z.union([z.array(z.record(z.string())), z.record(z.string())]).optional() }).passthrough(), z.array(z.unknown())]).optional() }).passthrough() }).passthrough() }).passthrough();
export function normalizeImf(r: z.infer<typeof zImfCompact>) {
  const series = r.CompactData.DataSet.Series;
  if (!series || Array.isArray(series)) return [];
  const obs = Array.isArray(series.Obs) ? series.Obs : series.Obs ? [series.Obs] : [];
  return obs.map(o => ({ period: o["@TIME_PERIOD"] ?? "", value: o["@OBS_VALUE"] !== undefined ? Number(o["@OBS_VALUE"]) : null }));
}
export async function imfSeries(db: Db, database: string, key: string, baseUrl = "https://dataservices.imf.org/REST/SDMX_JSON.svc", fetchImpl?: typeof fetch) {
  return normalizeImf(await fetchJson(db, { provider: "imf", endpoint: database, url: `${baseUrl}/CompactData/${database}/${key}`, schema: zImfCompact, cacheKey: `${database}:${key}`, cacheTtlMs: 7 * DAY, staleOnError: true, fetchImpl }));
}

// ---------- Protected Planet (token AND a commercial licence flag) ----------
export async function protectedAreasNear(db: Db, token: string | undefined, commercialLicense: string | undefined, iso3: string, fetchImpl?: typeof fetch) {
  if (commercialLicense !== "true") throw new LicenseRequired("wdpa", "set PROTECTED_PLANET_COMMERCIAL_LICENSE=true only once a commercial licence or approved data route exists; meanwhile import a licensed GeoJSON/shapefile into Atlas");
  if (!token) throw new CredentialRequired("wdpa", "PROTECTED_PLANET_TOKEN");
  const r = await fetchJson(db, { provider: "wdpa", endpoint: "countries", url: `https://api.protectedplanet.net/v3/countries/${iso3}?token=${encodeURIComponent(token)}`, schema: z.object({ country: z.object({ pas_count: z.number().optional() }).passthrough() }).passthrough(), cacheKey: iso3, cacheTtlMs: 30 * DAY, fetchImpl });
  return { protectedAreas: r.country.pas_count ?? null };
}

/** Health probe: a cheap, real call per adapter, or the reason it cannot run. Never uses fixtures. */
export async function probe(db: Db, key: string, env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<{ ok: boolean; detail: string }> {
  try {
    switch (key) {
      case "pvgis": { const f = await pvgis(db, 20.97, -89.62, fetchImpl); return { ok: true, detail: f[0]?.value ?? "no data" }; }
      case "copernicus_stac": { const s = await copernicusScenes(db, [-89.7, 20.9, -89.5, 21.1], new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10), 100, env.COPERNICUS_STAC_URL, fetchImpl); return { ok: true, detail: `${s.length} Sentinel-2 scenes in 30 days` }; }
      case "eia": { const r = await eiaSeries(db, env.EIA_API_KEY, "electricity/retail-sales", { frequency: "annual", "data[0]": "price", "facets[stateid][]": "TX", "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1" }, "price", fetchImpl); return { ok: true, detail: r[0] ? `${r[0].period}: ${r[0].value} ${r[0].unit ?? ""}` : "no rows" }; }
      case "noaa_cdo": { const r = await noaaData(db, env.NOAA_CDO_TOKEN, { datasetid: "GSOM", stationid: "GHCND:USW00094728", startdate: "2025-01-01", enddate: "2025-03-01" }, fetchImpl); return { ok: true, detail: `${r.length} observations` }; }
      case "nasa_firms": { const f = await firmsFires(db, env.NASA_FIRMS_MAP_KEY, 20.97, -89.62, 25, 3, fetchImpl); return { ok: true, detail: f[0].value }; }
      case "entsoe": { const p = await entsoeDayAhead(db, env.ENTSOE_TOKEN, "10YES-REE------0", new Date(Date.now() - DAY).toISOString().slice(0, 10) + "T00:00:00Z", fetchImpl); return { ok: true, detail: p ? `mean ${p.mean} ${p.currency}/${p.unit}` : "no prices" }; }
      case "fred": { const r = await fredSeries(db, env.FRED_API_KEY, "DGS10", fetchImpl); return { ok: true, detail: r[0] ? `${r[0].date}: ${r[0].value}` : "no data" }; }
      case "imf": { const r = await imfSeries(db, "IFS", "A.MX.PCPI_IX", env.IMF_SDMX_URL, fetchImpl); return { ok: r.length > 0, detail: r.length ? `${r.length} observations` : "empty response" }; }
      case "wdpa": { const r = await protectedAreasNear(db, env.PROTECTED_PLANET_TOKEN, env.PROTECTED_PLANET_COMMERCIAL_LICENSE, "MEX", fetchImpl); return { ok: true, detail: `${r.protectedAreas} protected areas (MEX)` }; }
      default: return { ok: false, detail: "No probe for this provider yet" };
    }
  } catch (e) {
    const msg = e instanceof CredentialRequired || e instanceof LicenseRequired ? e.message : e instanceof SourceError ? e.message : (e as Error).message;
    return { ok: false, detail: msg };
  }
}
export const PROBES = ["pvgis", "copernicus_stac", "eia", "noaa_cdo", "nasa_firms", "entsoe", "fred", "imf", "wdpa"];
