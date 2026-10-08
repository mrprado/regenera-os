// Country risk (phase 20 §8): World Bank indicators that change the route to capital, with the curated country notes.
// Free and keyless through fetchJson (cache 30 days). Readings, not a rating: no composite score.
import { z } from "zod";
import type { Db } from "@/db";
import { COUNTRY_NOTES } from "@/lib/capital/programmes";
import { resolveIso3 } from "@/lib/place/adapters";
import { fetchJson } from "@/lib/sources/http";

export const RISK_INDICATORS = [
  { code: "FP.CPI.TOTL.ZG", label: "Inflation (consumer prices)", unit: "%", source: 2 },
  { code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth", unit: "%", source: 2 },
  { code: "EG.ELC.ACCS.ZS", label: "Access to electricity", unit: "% of population", source: 2 },
  { code: "GOV_WGI_RL.EST", label: "Rule of law (WGI, −2.5 weak to +2.5 strong)", unit: "", source: 3 },
  { code: "GOV_WGI_GE.EST", label: "Government effectiveness (WGI)", unit: "", source: 3 },
] as const;

const zWb = z.tuple([z.unknown(), z.array(z.object({ date: z.string(), value: z.number().nullable() })).nullable()]);
export type CountryReading = { code: string; label: string; value: number | null; year: string | null; unit: string };

export async function countryRisk(db: Db, country: string | null | undefined, fetchImpl?: typeof fetch) {
  if (!country) return null;
  const iso3 = await resolveIso3(db, country, fetchImpl).catch(() => null);
  if (!iso3) return null;
  const readings: CountryReading[] = [];
  for (const ind of RISK_INDICATORS) {
    try {
      const r = await fetchJson(db, { provider: "wb_indicators", endpoint: "indicator", url: `https://api.worldbank.org/v2/country/${iso3}/indicator/${ind.code}?format=json&mrnev=1&source=${ind.source}`, schema: zWb, cacheKey: `${iso3}:${ind.code}:s${ind.source}`, cacheTtlMs: 30 * 86_400_000, staleOnError: true, fetchImpl });
      const v = r[1]?.[0];
      readings.push({ code: ind.code, label: ind.label, value: v?.value ?? null, year: v?.date ?? null, unit: ind.unit });
    } catch { readings.push({ code: ind.code, label: ind.label, value: null, year: null, unit: ind.unit }); }
  }
  return { iso3, readings, note: COUNTRY_NOTES[iso3] ?? null, source: "World Bank WDI and Worldwide Governance Indicators" };
}

export const fmtReading = (r: CountryReading) => (r.value === null ? "—" : `${Math.round(r.value * 10) / 10}${r.unit === "%" || r.unit.startsWith("%") ? "%" : ""}${r.year ? ` (${r.year})` : ""}`);
