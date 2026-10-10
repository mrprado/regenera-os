// Steward source adapters (phase 28B). Each takes a place geometry and returns normalised records with provenance.
// Responses are validated: HTML or login pages, errors returned with status 200, empty or malformed payloads and
// partial pages are reported, never stored as data. Bounded: fixed page sizes and page caps per place.
import * as turf from "@turf/turf";
import { z } from "zod";

export type SourceRecord = {
  recordId: string; title: string; value?: string | null; unit?: string;
  observedStart?: string | null; observedEnd?: string | null; publishedAt?: string | null;
  geometry?: Record<string, unknown> | null; precisionM?: number | null; resolution?: string; method?: string; qualityFlags?: string[];
  uncertainty?: string; license?: string; sourceUrl?: string; datasetVersion?: string; sensitive?: boolean; payload?: Record<string, unknown>;
};
export type AdapterResult = { records: SourceRecord[]; excluded: number; limitations: string[]; httpStatus: number; query: Record<string, unknown>; payloadText: string };
export type AdapterContext = { geometry: { type: string; coordinates: unknown }; fetchImpl: typeof fetch; env: Record<string, string | undefined>; now: Date };
export class SourceUnavailable extends Error { constructor(message: string, public httpStatus?: number) { super(message); } }

/** Reads a JSON response and refuses anything that is not the data asked for. */
async function readJson(res: Response, what: string): Promise<{ data: unknown; text: string }> {
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new SourceUnavailable(`${what} answered HTTP ${res.status}: ${text.slice(0, 160)}`, res.status);
  if (/<!doctype html|<html/i.test(text.slice(0, 200)) || /text\/html/.test(type)) throw new SourceUnavailable(`${what} returned a web page instead of data (login, challenge or error page).`, res.status);
  if (!text.trim()) throw new SourceUnavailable(`${what} returned an empty body.`, res.status);
  try { return { data: JSON.parse(text), text }; } catch { throw new SourceUnavailable(`${what} returned malformed JSON.`, res.status); }
}

/** The area to query: a polygon as given; a point as a 1 km box, with that stated as a limitation. */
function queryArea(g: AdapterContext["geometry"]) {
  if (g.type === "Point") {
    const [x, y] = g.coordinates as [number, number];
    const box = turf.bbox(turf.buffer(turf.point([x, y]), 1, { units: "kilometers" })!);
    return { bbox: box as [number, number, number, number], polygon: turf.bboxPolygon(box).geometry, pointOnly: true };
  }
  const f = turf.feature(g as never);
  return { bbox: turf.bbox(f) as [number, number, number, number], polygon: g, pointOnly: false };
}

// ---------------- GBIF occurrences ----------------
const zGbif = z.object({ offset: z.number(), limit: z.number(), endOfRecords: z.boolean(), count: z.number(), results: z.array(z.record(z.unknown())) });
const COMMERCIAL_OK = /creativecommons\.org\/(publicdomain\/zero|licenses\/by\/)/i;

/** Counter-clockwise WKT for GBIF; complex shapes are queried by their bounding box (stated). */
function toWkt(polygon: { type: string; coordinates: unknown }, bbox: [number, number, number, number]) {
  if (polygon.type === "Polygon") {
    const ring = [...(polygon.coordinates as number[][][])[0]];
    if (turf.booleanClockwise(turf.lineString(ring))) ring.reverse();
    if (ring.length <= 200) return { wkt: `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(",")}))`, simplified: false };
  }
  const [w, s, e, n] = bbox;
  return { wkt: `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`, simplified: true };
}

export async function gbifOccurrences(ctx: AdapterContext): Promise<AdapterResult> {
  const area = queryArea(ctx.geometry);
  const { wkt, simplified } = toWkt(area.polygon as never, area.bbox);
  const records: SourceRecord[] = []; let excluded = 0, total = 0, http = 0, text = "";
  const limitations = ["Occurrence records are not a survey: missing species are not absent, and records may be old, generalised or withheld."];
  if (area.pointOnly) limitations.push("Place is a point: queried a 1 km box around it, not a site boundary.");
  if (simplified) limitations.push("Boundary queried by its bounding box (complex or multi-part shape).");
  for (let page = 0; page < 3; page++) {
    const url = `https://api.gbif.org/v1/occurrence/search?geometry=${encodeURIComponent(wkt)}&limit=300&offset=${page * 300}&hasGeospatialIssue=false`;
    const res = await ctx.fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
    http = res.status;
    const { data, text: t } = await readJson(res, "GBIF");
    text += t.slice(0, 2000);
    const body = zGbif.safeParse(data);
    if (!body.success) throw new SourceUnavailable("GBIF response did not match the documented schema.", res.status);
    total = body.data.count;
    for (const r of body.data.results) {
      const license = String(r.license ?? "");
      if (!COMMERCIAL_OK.test(license)) { excluded++; continue; }
      const lat = Number(r.decimalLatitude), lon = Number(r.decimalLongitude);
      const withheld = !!r.informationWithheld || !!r.dataGeneralizations;
      records.push({
        recordId: String(r.key), title: String(r.scientificName ?? r.species ?? "Unidentified taxon"), observedStart: r.eventDate ? String(r.eventDate).slice(0, 10) : null,
        geometry: Number.isFinite(lat) && Number.isFinite(lon) ? { type: "Point", coordinates: [lon, lat] } : null,
        precisionM: r.coordinateUncertaintyInMeters != null ? Math.round(Number(r.coordinateUncertaintyInMeters)) : null,
        method: `GBIF basis of record: ${r.basisOfRecord ?? "unknown"}`, qualityFlags: Array.isArray(r.issues) ? (r.issues as string[]) : [],
        license, sourceUrl: `https://www.gbif.org/occurrence/${r.key}`, datasetVersion: `dataset ${r.datasetKey}`, sensitive: withheld,
        payload: { datasetKey: r.datasetKey, publishingOrgKey: r.publishingOrgKey, taxonKey: r.taxonKey, basisOfRecord: r.basisOfRecord, occurrenceStatus: r.occurrenceStatus, establishmentMeans: r.establishmentMeans ?? null, informationWithheld: r.informationWithheld ?? null },
      });
    }
    if (body.data.endOfRecords) break;
    if (page === 2) limitations.push(`Bounded to the first 900 of ${total.toLocaleString("en-US")} matching records; a full download is needed for a complete list.`);
  }
  if (excluded) limitations.push(`${excluded} records under non-commercial (CC BY-NC) licences were not stored, because Regenera's use is commercial.`);
  return { records, excluded, limitations, httpStatus: http, query: { wkt, pages: Math.min(3, Math.ceil(total / 300) || 1), matching: total }, payloadText: text };
}

// ---------------- SoilGrids ----------------
const zSoil = z.object({ properties: z.object({ layers: z.array(z.object({ name: z.string(), unit_measure: z.object({ d_factor: z.number(), target_units: z.string() }), depths: z.array(z.object({ label: z.string(), values: z.record(z.number().nullable()) })) })) }) });
// Three properties keep one request near 20 s (the beta service is slow); more would time out.
const SOIL_PROPS = ["soc", "phh2o", "clay"];
const SOIL_NAME: Record<string, string> = { soc: "Soil organic carbon", phh2o: "pH (water)", clay: "Clay", sand: "Sand", nitrogen: "Total nitrogen", bdod: "Bulk density" };

export async function soilgridsProperties(ctx: AdapterContext): Promise<AdapterResult> {
  const c = turf.centroid(turf.feature(ctx.geometry as never)).geometry.coordinates;
  const params = new URLSearchParams({ lon: c[0].toFixed(5), lat: c[1].toFixed(5) });
  for (const p of SOIL_PROPS) params.append("property", p);
  for (const d of ["0-5cm", "5-15cm", "15-30cm"]) params.append("depth", d);
  for (const v of ["mean", "Q0.05", "Q0.95"]) params.append("value", v);
  const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?${params}`;
  const res = await ctx.fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(90_000) });
  const { data, text } = await readJson(res, "SoilGrids");
  const body = zSoil.safeParse(data);
  if (!body.success) throw new SourceUnavailable("SoilGrids response did not match the documented schema.", res.status);
  const records: SourceRecord[] = [];
  for (const layer of body.data.properties.layers) for (const d of layer.depths) {
    const f = layer.unit_measure.d_factor || 1, mean = d.values.mean, lo = d.values["Q0.05"], hi = d.values["Q0.95"];
    if (mean == null) continue; // no-data pixel: not stored as zero
    records.push({
      recordId: `${layer.name}:${d.label}`, title: `${SOIL_NAME[layer.name] ?? layer.name}, ${d.label}`, value: String(Math.round((mean / f) * 100) / 100), unit: layer.unit_measure.target_units,
      geometry: { type: "Point", coordinates: [c[0], c[1]] }, resolution: "250 m", method: "SoilGrids 2.0 modelled value (mean of predictive distribution) at the place centroid",
      uncertainty: lo != null && hi != null ? `90% interval ${Math.round((lo / f) * 100) / 100}–${Math.round((hi / f) * 100) / 100} ${layer.unit_measure.target_units}` : "",
      license: "CC BY 4.0", sourceUrl: "https://soilgrids.org/", datasetVersion: "SoilGrids 2.0",
    });
  }
  return { records, excluded: 0, httpStatus: res.status, query: { lon: c[0], lat: c[1], properties: SOIL_PROPS }, payloadText: text.slice(0, 4000),
    limitations: ["Modelled 250 m values at the place centroid, not laboratory results; site sampling is needed for decisions.", ...(ctx.geometry.type !== "Point" ? ["One point (the centroid) represents the whole boundary."] : [])] };
}

// ---------------- Copernicus Data Space STAC (metadata only) ----------------
const zStac = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({ id: z.string(), properties: z.record(z.unknown()), assets: z.record(z.unknown()).optional() })) });

export async function cdseScenes(ctx: AdapterContext): Promise<AdapterResult> {
  const area = queryArea(ctx.geometry);
  const since = new Date(ctx.now.getTime() - 90 * 86_400_000).toISOString();
  const url = `https://stac.dataspace.copernicus.eu/v1/search?collections=sentinel-2-l2a&bbox=${area.bbox.map(n => n.toFixed(5)).join(",")}&datetime=${since}/..&limit=20&sortby=-properties.datetime`;
  const res = await ctx.fetchImpl(url, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(25_000) });
  const { data, text } = await readJson(res, "Copernicus STAC");
  const body = zStac.safeParse(data);
  if (!body.success) throw new SourceUnavailable("STAC response did not match the documented schema.", res.status);
  const records = body.data.features.map(f => ({
    recordId: f.id, title: `Sentinel-2 L2A scene ${String(f.properties.datetime ?? "").slice(0, 10)}`, value: f.properties["eo:cloud_cover"] != null ? String(f.properties["eo:cloud_cover"]) : null, unit: "% cloud cover",
    observedStart: String(f.properties.datetime ?? "").slice(0, 19) || null, resolution: "10–60 m", method: "STAC catalogue metadata; no image processed", license: "Copernicus free, full and open",
    sourceUrl: `https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(f.id)}`, datasetVersion: "sentinel-2-l2a",
    payload: { platform: f.properties.platform ?? null, cloudCover: f.properties["eo:cloud_cover"] ?? null, assets: Object.keys(f.assets ?? {}).length },
  }));
  return { records, excluded: 0, httpStatus: res.status, query: { bbox: area.bbox, since, collection: "sentinel-2-l2a" }, payloadText: text.slice(0, 4000),
    limitations: ["Scene metadata only: no imagery downloaded or processed, so no vegetation or water index is derived.", ...(area.pointOnly ? ["Point place: searched a 1 km box."] : [])] };
}

// ---------------- NASA FIRMS (needs MAP_KEY) ----------------
export async function firmsDetections(ctx: AdapterContext): Promise<AdapterResult> {
  const key = ctx.env.FIRMS_MAP_KEY;
  if (!key) throw new SourceUnavailable("FIRMS_MAP_KEY is not configured.");
  const area = queryArea(ctx.geometry);
  const [w, s, e, n] = area.bbox.map(x => x.toFixed(4));
  const res = await ctx.fetchImpl(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/${w},${s},${e},${n}/5`, { signal: AbortSignal.timeout(25_000) });
  const text = await res.text();
  if (!res.ok || /<html|invalid/i.test(text.slice(0, 200))) throw new SourceUnavailable(`FIRMS answered ${res.status}: ${text.replace(key, "[key]").slice(0, 160)}`, res.status);
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = (head ?? "").split(",");
  if (!cols.includes("latitude") || !cols.includes("acq_date")) throw new SourceUnavailable("FIRMS response did not have the documented CSV columns.", res.status);
  const records = rows.filter(Boolean).map(line => {
    const v = Object.fromEntries(line.split(",").map((x, i) => [cols[i], x]));
    const id = `${v.latitude},${v.longitude},${v.acq_date},${v.acq_time},${v.satellite}`;
    return { recordId: id, title: `Thermal anomaly ${v.acq_date} ${v.acq_time} UTC`, value: v.frp ?? null, unit: "MW (fire radiative power)", observedStart: `${v.acq_date}T${String(v.acq_time).padStart(4, "0").replace(/(\d\d)(\d\d)/, "$1:$2")}:00Z`,
      geometry: { type: "Point", coordinates: [Number(v.longitude), Number(v.latitude)] }, precisionM: 375, resolution: "375 m", method: `VIIRS ${v.satellite} NRT, confidence ${v.confidence}`, license: "NASA open data",
      sourceUrl: "https://firms.modaps.eosdis.nasa.gov/", datasetVersion: "VIIRS_SNPP_NRT", payload: v as Record<string, unknown> };
  });
  return { records, excluded: 0, httpStatus: res.status, query: { bbox: area.bbox, source: "VIIRS_SNPP_NRT", days: 5 }, payloadText: text.slice(0, 4000),
    limitations: ["Satellite thermal anomalies (active-fire detections), not confirmed wildfires, burned area or damage. Last 5 days only."] };
}

export const ADAPTERS: Partial<Record<string, (ctx: AdapterContext) => Promise<AdapterResult>>> = {
  gbif_occurrence: gbifOccurrences, soilgrids: soilgridsProperties, cdse_stac: cdseScenes, firms: firmsDetections,
};
