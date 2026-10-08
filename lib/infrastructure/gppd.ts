// WRI Global Power Plant Database v1.3 (CC BY 4.0): ~35,000 generation assets with capacity, fuel, owner and the
// registry's own source. Ingested in slices (one job per slice) into registry_assets as evidence class
// "registry-listed". Vintage 2021: newer plants are missing and some have since retired, which Atlas states.
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { registryAssets } from "@/db/schema";
import { assertIntegrationAllowed } from "@/lib/integrations/engine";
import { CsvStream } from "@/lib/sanctions/parse";
import { country as countryOf } from "@/lib/scan/countries";
import { logCall, USER_AGENT } from "@/lib/sources/http";

export const GPPD_URL = "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv";
export const GPPD_SOURCE = "wri_gppd";
const VINTAGE = "WRI GPPD 1.3 (2021)";

type Row = typeof registryAssets.$inferInsert;

/** Pure: one CSV row (by header index) → an asset, or null when coordinates are missing or invalid. */
export function gppdRow(h: Map<string, number>, r: string[]): Row | null {
  const v = (k: string) => (r[h.get(k) ?? -1] ?? "").trim();
  const lat = Number(v("latitude")), lng = Number(v("longitude"));
  if (!v("gppd_idnr") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const cap = Number(v("capacity_mw")), year = Math.round(Number(v("commissioning_year")));
  return {
    source: GPPD_SOURCE, sourceId: v("gppd_idnr"), kind: v("primary_fuel") === "Storage" ? "storage" : "generation", name: v("name").slice(0, 200) || v("gppd_idnr"),
    country: countryOf(v("country"))?.iso3 ?? (v("country") || null), fuel: v("primary_fuel") || null, capacityMw: Number.isFinite(cap) ? cap : null,
    commissioningYear: Number.isFinite(year) && year > 1800 ? year : null, owner: v("owner").slice(0, 200) || null, lat, lng,
    url: v("url").slice(0, 500) || null, sourceOfRecord: v("source").slice(0, 200) || null, vintage: VINTAGE,
  };
}

/** Ingests rows [offset, offset+limit). Returns how many were written and whether the file ended. */
export async function ingestGppd(db: Db, offset = 0, limit = 4000, fetchImpl: typeof fetch = fetch) {
  await assertIntegrationAllowed(db, GPPD_SOURCE);
  const res = await fetchImpl(GPPD_URL, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) { await logCall(db, { provider: GPPD_SOURCE, endpoint: "csv", ok: false, httpStatus: res.status }); throw new Error(`wri_gppd: HTTP ${res.status}`); }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const csv = new CsvStream(",");
  let header: Map<string, number> | null = null, index = 0, ended = true;
  const batch: Row[] = [];
  outer: for (;;) {
    const { done, value } = await reader.read();
    const rows = done ? csv.end() : csv.push(value);
    for (const r of rows) {
      if (!header) { header = new Map(r.map((k, i) => [k.trim(), i])); continue; }
      if (index >= offset + limit) { ended = false; break outer; }
      if (index++ < offset) continue;
      const a = gppdRow(header, r);
      if (a) batch.push(a);
    }
    if (done) break;
  }
  if (!ended) await reader.cancel().catch(() => undefined);
  // 15 columns per row: 6 rows per statement stays under D1's 100 bound parameters.
  for (let i = 0; i < batch.length; i += 6) {
    await db.insert(registryAssets).values(batch.slice(i, i + 6)).onConflictDoUpdate({
      target: [registryAssets.source, registryAssets.sourceId],
      set: { name: sql`excluded.name`, capacityMw: sql`excluded.capacity_mw`, fuel: sql`excluded.fuel`, owner: sql`excluded.owner`, lat: sql`excluded.lat`, lng: sql`excluded.lng`, retrievedAt: sql`excluded.retrieved_at` },
    });
  }
  await logCall(db, { provider: GPPD_SOURCE, endpoint: "csv", ok: true, httpStatus: 200, detail: `rows ${offset}-${index}: ${batch.length} written` });
  return { written: batch.length, next: index, done: ended };
}
