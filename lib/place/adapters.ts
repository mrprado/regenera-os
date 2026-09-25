// Place adapters (docs/plans/phase-6.md M5–M6). Each calls one official or open source through fetchJson (registry
// gate, cache, ledger, stale fallback) and returns facts with their source. No scraping; aggregate values only.
import { z } from "zod";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";

export type PlaceFact = {
  dimension: "land" | "water" | "climate" | "ecology" | "human" | "infrastructure";
  key: string; label: string; value: string; numeric: number | null; unit: string | null;
  integrationKey: string; sourceUrl: string; tier: number; license: string; observedFor: string | null;
};

const DAY = 86_400_000;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

// ---------- NASA POWER: solar resource and climate normals ----------
const zPower = z.object({ properties: z.object({ parameter: z.record(z.record(z.number())) }) });
export async function nasaPower(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,T2M,PRECTOTCORR,WS10M&community=RE&longitude=${round(lng, 3)}&latitude=${round(lat, 3)}&format=JSON`;
  const r = await fetchJson(db, { provider: "nasa_power", endpoint: "climatology_point", url, schema: zPower, cacheKey: `clim:${round(lat, 2)},${round(lng, 2)}`, cacheTtlMs: 180 * DAY, staleOnError: true, fetchImpl, timeoutMs: 30_000 });
  const p = r.properties.parameter;
  const ann = (k: string) => (p[k]?.ANN !== undefined && p[k].ANN > -900 ? p[k].ANN : null);
  const base = { integrationKey: "nasa_power", sourceUrl: "https://power.larc.nasa.gov", tier: 2, license: "NASA POWER (public; cite NASA POWER)", observedFor: "Long-term climatology" };
  const out: PlaceFact[] = [];
  const ghi = ann("ALLSKY_SFC_SW_DWN");
  if (ghi !== null) out.push({ ...base, dimension: "climate", key: "solar_ghi", label: "Solar resource (global horizontal)", value: `${round(ghi, 2)} kWh/m²/day (${fmt(ghi * 365)} kWh/m²/year)`, numeric: ghi, unit: "kWh/m²/day" });
  const t = ann("T2M");
  if (t !== null) out.push({ ...base, dimension: "climate", key: "temp_mean", label: "Mean air temperature", value: `${round(t)} °C`, numeric: t, unit: "°C" });
  const pr = ann("PRECTOTCORR");
  if (pr !== null) out.push({ ...base, dimension: "water", key: "precip", label: "Precipitation", value: `${fmt(pr * 365)} mm/year`, numeric: round(pr * 365), unit: "mm/year" });
  const ws = ann("WS10M");
  if (ws !== null) out.push({ ...base, dimension: "climate", key: "wind_10m", label: "Mean wind speed at 10 m", value: `${round(ws)} m/s`, numeric: ws, unit: "m/s" });
  return out;
}

// ---------- World Bank Indicators: country context ----------
const zWbCountries = z.tuple([z.unknown(), z.array(z.object({ id: z.string(), iso2Code: z.string(), name: z.string() }))]);
const zWbIndicator = z.tuple([z.unknown(), z.array(z.object({ date: z.string(), value: z.number().nullable() })).nullable()]);

/** Resolves a country name, ISO2 or ISO3 to the World Bank ISO3 code (list cached 30 days). */
export async function resolveIso3(db: Db, country: string, fetchImpl?: typeof fetch) {
  const c = country.trim().toLowerCase();
  if (/^[a-z]{3}$/.test(c)) return c.toUpperCase();
  const list = await fetchJson(db, { provider: "wb_indicators", endpoint: "countries", url: "https://api.worldbank.org/v2/country?format=json&per_page=400", schema: zWbCountries, cacheKey: "countries", cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl });
  const hit = list[1].find(x => x.iso2Code.toLowerCase() === c || x.name.toLowerCase() === c) ?? list[1].find(x => x.name.toLowerCase().startsWith(c));
  return hit?.id ?? null;
}

const WB: { code: string; key: string; label: string; dimension: PlaceFact["dimension"]; unit: string; format: (v: number) => string }[] = [
  { code: "SP.POP.TOTL", key: "country_population", label: "Country population", dimension: "human", unit: "people", format: v => fmt(v) },
  { code: "NY.GDP.PCAP.CD", key: "country_gdp_pc", label: "GDP per capita (current US$)", dimension: "human", unit: "USD", format: v => `US$ ${fmt(v)}` },
  { code: "EG.ELC.ACCS.ZS", key: "country_elec_access", label: "Access to electricity", dimension: "infrastructure", unit: "% of population", format: v => `${round(v)}%` },
  { code: "EG.FEC.RNEW.ZS", key: "country_renewable_share", label: "Renewable share of final energy consumption", dimension: "infrastructure", unit: "%", format: v => `${round(v)}%` },
  { code: "ER.H2O.FWST.ZS", key: "country_water_stress", label: "Water stress (freshwater withdrawal / available)", dimension: "water", unit: "%", format: v => `${round(v)}%` },
  { code: "AG.LND.FRST.ZS", key: "country_forest", label: "Forest area", dimension: "ecology", unit: "% of land", format: v => `${round(v)}%` },
];

export async function wbIndicators(db: Db, country: string, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  const iso3 = await resolveIso3(db, country, fetchImpl);
  if (!iso3) return [];
  const out: PlaceFact[] = [];
  for (const ind of WB) {
    const r = await fetchJson(db, { provider: "wb_indicators", endpoint: "indicator", url: `https://api.worldbank.org/v2/country/${iso3}/indicator/${ind.code}?format=json&mrnev=1`, schema: zWbIndicator, cacheKey: `${iso3}:${ind.code}`, cacheTtlMs: 90 * DAY, staleOnError: true, fetchImpl });
    const v = r[1]?.[0];
    if (v?.value === null || v?.value === undefined) continue;
    out.push({ dimension: ind.dimension, key: ind.key, label: `${ind.label} (${iso3})`, value: ind.format(v.value), numeric: v.value, unit: ind.unit, integrationKey: "wb_indicators", sourceUrl: `https://data.worldbank.org/indicator/${ind.code}?locations=${iso3}`, tier: 2, license: "CC BY 4.0, World Bank", observedFor: v.date });
  }
  return out;
}

// ---------- OpenStreetMap Overpass: infrastructure near the site ----------
const zOverpass = z.object({ elements: z.array(z.object({ type: z.string(), tags: z.record(z.string()).optional(), lat: z.number().optional(), lon: z.number().optional(), center: z.object({ lat: z.number(), lon: z.number() }).optional() })) });
export const haversineKm = (a: [number, number], b: [number, number]) => {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export async function overpassInfrastructure(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  const at = `${round(lat, 4)},${round(lng, 4)}`;
  // Kept light for the shared public instance: counts plus one nearest-substation search.
  const q = `[out:json][timeout:60];
nwr["power"="substation"](around:20000,${at});out count;
way["power"="line"](around:10000,${at});out count;
way["highway"~"^(motorway|trunk|primary)$"](around:5000,${at});out count;
way["waterway"~"^(river|canal)$"](around:5000,${at});out count;
nwr["power"="substation"](around:30000,${at});out center 40;`;
  const r = await fetchJson(db, { provider: "overpass", endpoint: "infrastructure", url: "https://overpass-api.de/api/interpreter", init: { method: "POST", body: new URLSearchParams({ data: q }), headers: { "content-type": "application/x-www-form-urlencoded" } }, schema: zOverpass, cacheKey: `infra:${at}`, cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl, timeoutMs: 75_000, retries: 1 });
  const counts = r.elements.filter(e => e.type === "count").map(e => Number(e.tags?.total ?? 0));
  const subs = r.elements.filter(e => e.type !== "count").map(e => (e.center ? [e.center.lat, e.center.lon] : e.lat !== undefined && e.lon !== undefined ? [e.lat, e.lon] : null)).filter(Boolean) as [number, number][];
  const nearest = subs.length ? Math.min(...subs.map(s => haversineKm([lat, lng], s))) : null;
  const base = { integrationKey: "overpass", sourceUrl: "https://www.openstreetmap.org", tier: 3, license: "ODbL, © OpenStreetMap contributors", observedFor: "Current OSM data (completeness varies by region)" };
  const rows: [string, string, PlaceFact["dimension"], number | undefined, string][] = [
    ["substations_20km", "Substations within 20 km", "infrastructure", counts[0], "features"],
    ["power_lines_10km", "Power line segments within 10 km", "infrastructure", counts[1], "ways"],
    ["major_roads_5km", "Major road segments within 5 km", "infrastructure", counts[2], "ways"],
    ["waterways_5km", "River and canal segments within 5 km", "water", counts[3], "ways"],
  ];
  const out: PlaceFact[] = rows.filter(([, , , n]) => n !== undefined).map(([key, label, dimension, n, unit]) => ({ ...base, dimension, key, label, value: fmt(n!), numeric: n!, unit }));
  out.push({ ...base, dimension: "infrastructure", key: "nearest_substation", label: "Nearest mapped substation", value: nearest === null ? "None mapped within 30 km" : `${round(nearest)} km (straight line)`, numeric: nearest === null ? null : round(nearest), unit: "km" });
  return out;
}

// ---------- USGS: seismic history ----------
const zCount = z.object({ count: z.number() });
const zQuakes = z.object({ features: z.array(z.object({ properties: z.object({ mag: z.number().nullable(), place: z.string().nullable(), time: z.number() }) })) });
export async function usgsSeismic(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  const q = `latitude=${round(lat, 3)}&longitude=${round(lng, 3)}&maxradiuskm=200&minmagnitude=5&starttime=1990-01-01`;
  const base = { integrationKey: "usgs_quakes", sourceUrl: "https://earthquake.usgs.gov", tier: 1, license: "Public domain, USGS", observedFor: "1990 to today" };
  const c = await fetchJson(db, { provider: "usgs_quakes", endpoint: "count", url: `https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson&${q}`, schema: zCount, cacheKey: `count:${q}`, cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl });
  const out: PlaceFact[] = [{ ...base, dimension: "land", key: "quakes_m5_200km", label: "Earthquakes M5+ within 200 km since 1990", value: fmt(c.count), numeric: c.count, unit: "events" }];
  if (c.count > 0) {
    const top = await fetchJson(db, { provider: "usgs_quakes", endpoint: "largest", url: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&${q}&orderby=magnitude&limit=1`, schema: zQuakes, cacheKey: `top:${q}`, cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl });
    const f = top.features[0]?.properties;
    if (f?.mag) out.push({ ...base, dimension: "land", key: "quake_max_200km", label: "Largest earthquake within 200 km since 1990", value: `M${f.mag}${f.place ? `, ${f.place}` : ""} (${new Date(f.time).toISOString().slice(0, 10)})`, numeric: f.mag, unit: "magnitude" });
  }
  return out;
}

// ---------- GBIF: recorded biodiversity near the site (aggregate counts only) ----------
const zGbif = z.object({ count: z.number(), facets: z.array(z.object({ counts: z.array(z.object({ name: z.string(), count: z.number() })) })).optional() });
export async function gbifBiodiversity(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<PlaceFact[]> {
  const d = 0.1; // about 11 km each way
  const box = `decimalLatitude=${round(lat - d, 3)},${round(lat + d, 3)}&decimalLongitude=${round(lng - d, 3)},${round(lng + d, 3)}`;
  const base = { integrationKey: "gbif", sourceUrl: `https://www.gbif.org/occurrence/search?${box}`, tier: 2, license: "Aggregate counts from GBIF-mediated data (per-record licences CC0 / CC BY / CC BY-NC not reproduced)", observedFor: "All recorded occurrences" };
  const all = await fetchJson(db, { provider: "gbif", endpoint: "occurrence_facet", url: `https://api.gbif.org/v1/occurrence/search?${box}&limit=0&facet=speciesKey&facetLimit=2000`, schema: zGbif, cacheKey: `all:${box}`, cacheTtlMs: 90 * DAY, staleOnError: true, fetchImpl });
  const threatened = await fetchJson(db, { provider: "gbif", endpoint: "occurrence_threatened", url: `https://api.gbif.org/v1/occurrence/search?${box}&limit=0&iucnRedListCategory=CR&iucnRedListCategory=EN&iucnRedListCategory=VU&facet=speciesKey&facetLimit=500`, schema: zGbif, cacheKey: `thr:${box}`, cacheTtlMs: 90 * DAY, staleOnError: true, fetchImpl });
  const species = all.facets?.[0]?.counts.length ?? 0;
  const thr = threatened.facets?.[0]?.counts.length ?? 0;
  return [
    { ...base, dimension: "ecology", key: "gbif_occurrences", label: "Recorded species occurrences (±11 km)", value: fmt(all.count), numeric: all.count, unit: "records" },
    { ...base, dimension: "ecology", key: "gbif_species", label: "Distinct species recorded (±11 km)", value: `${fmt(species)}${species >= 2000 ? "+" : ""}`, numeric: species, unit: "species" },
    { ...base, dimension: "ecology", key: "gbif_threatened", label: "IUCN threatened species recorded (CR, EN, VU)", value: fmt(thr), numeric: thr, unit: "species" },
  ];
}
