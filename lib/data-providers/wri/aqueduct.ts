// Aqueduct 4.0 (WRI) through the Resource Watch API. Aqueduct indicator codes follow the 4.0 data dictionary:
// bws baseline water stress, bwd depletion, iav interannual variability, sev seasonal variability, gtd groundwater
// decline, rfr riverine flood, cfr coastal flood, drr drought risk. Each has _raw, _score (0–5), _cat (-1..4) and
// _label. Only columns actually returned are used. Screening grade: sub-basin averages, never project hydrology.
import type { Db } from "@/db";
import { pickDataset, rwPointQuery, rwSearch, type RwDataset } from "./resource-watch";

export const AQUEDUCT_INDICATORS = {
  bws: "Baseline water stress", bwd: "Baseline water depletion", iav: "Interannual variability", sev: "Seasonal variability", gtd: "Groundwater table decline",
  rfr: "Riverine flood risk", cfr: "Coastal flood risk", drr: "Drought risk",
} as const;
export type AqueductIndicator = keyof typeof AQUEDUCT_INDICATORS;

export type AqueductReading = { indicator: AqueductIndicator; label: string; category: number | null; categoryLabel: string | null; score: number | null; raw: number | null };

/** Maps a baseline row to readings. Unknown columns are ignored; missing indicators are absent (not zero). */
export function readAqueductRow(row: Record<string, unknown>): { basin: string | null; readings: AqueductReading[] } {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const readings: AqueductReading[] = [];
  for (const k of Object.keys(AQUEDUCT_INDICATORS) as AqueductIndicator[]) {
    const has = [`${k}_cat`, `${k}_label`, `${k}_score`, `${k}_raw`].some(c => c in row);
    if (!has) continue;
    readings.push({ indicator: k, label: AQUEDUCT_INDICATORS[k], category: num(row[`${k}_cat`]), categoryLabel: typeof row[`${k}_label`] === "string" ? (row[`${k}_label`] as string) : null, score: num(row[`${k}_score`]), raw: num(row[`${k}_raw`]) });
  }
  const basin = ["pfaf_id", "aq30_id", "string_id", "name_1"].map(c => row[c]).find(v => v != null);
  return { basin: basin != null ? String(basin) : null, readings };
}

/** Implications are inferences for the analyst, labelled as such; they follow the category, never replace diligence. */
export function waterImplications(r: AqueductReading[]) {
  const high = r.filter(x => (x.category ?? -1) >= 3).map(x => x.indicator);
  const out: string[] = [];
  if (high.includes("bws") || high.includes("bwd")) out.push("Cooling and process water", "Construction water", "Agricultural demand competition", "Community competition for water", "Environmental permitting and water rights", "Project resilience");
  if (high.includes("rfr") || high.includes("cfr")) out.push("Flood design standards", "Insurance exposure", "Access and logistics during events");
  if (high.includes("drr") || high.includes("iav") || high.includes("sev")) out.push("Supply reliability in dry seasons and years", "Storage requirements");
  return [...new Set(out)];
}

export async function resolveAqueduct(db: Db, search: string, fetchImpl?: typeof fetch): Promise<RwDataset | null> {
  return pickDataset(await rwSearch(db, search, fetchImpl), search);
}

export async function aqueductAt(db: Db, ds: RwDataset, lat: number, lng: number, fetchImpl?: typeof fetch) {
  const row = await rwPointQuery(db, ds, lat, lng, fetchImpl);
  return row ? readAqueductRow(row) : { basin: null, readings: [] };
}
