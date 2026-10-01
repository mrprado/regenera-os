// Global Forest Watch Data API (WRI). Zonal statistics over a project polygon: POST
// /dataset/{slug}/latest/query/json with a GeoJSON geometry and SQL over "results". A free API key is required
// (GFW_API_KEY, server-side only; https://data-api.globalforestwatch.org/#tag/Authentication). Without it the
// adapter throws CredentialRequired and the UI shows "API available · key needed". Registry key: gfw.
// Land & Carbon Lab datasets published on the same Data API use this adapter too.
import { z } from "zod";
import type { Db } from "@/db";
import { CredentialRequired } from "@/lib/integrations/adapters";
import { fetchJson } from "@/lib/sources/http";

const DAY = 86_400_000;
export const GFW_BASE = "https://data-api.globalforestwatch.org";
export const zGfwQuery = z.object({ status: z.string().optional(), data: z.array(z.record(z.unknown())) }).passthrough();

type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };

export async function gfwQuery(db: Db, apiKey: string | undefined, slug: string, sql: string, geometry: Geometry, fetchImpl?: typeof fetch) {
  if (!apiKey) throw new CredentialRequired("gfw", "GFW_API_KEY");
  const hash = JSON.stringify(geometry).length + ":" + sql.length;
  const r = await fetchJson(db, {
    provider: "gfw", endpoint: `query:${slug}`, url: `${GFW_BASE}/dataset/${slug}/latest/query/json`,
    init: { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey }, body: JSON.stringify({ sql, geometry }) },
    schema: zGfwQuery, cacheKey: `${slug}:${hash}:${JSON.stringify(geometry).slice(0, 200)}`, cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl,
  });
  return r.data;
}

export type LossSummary = { byYear: { year: number; ha: number }[]; totalHa: number; recentHa: number; recentFrom: number; lastYear: number | null };

/** Tree cover loss by year within the geometry at ≥30% canopy (GFW default threshold). */
export function summarizeLoss(rows: Record<string, unknown>[], recentYears = 5): LossSummary {
  const byYear = rows.map(r => ({ year: Number(r.umd_tree_cover_loss__year), ha: Number(r.area__ha ?? r["SUM(area__ha)"] ?? r.sum ?? 0) }))
    .filter(r => Number.isFinite(r.year) && Number.isFinite(r.ha)).sort((a, b) => a.year - b.year);
  const lastYear = byYear.length ? byYear[byYear.length - 1].year : null;
  const recentFrom = (lastYear ?? new Date().getUTCFullYear()) - recentYears + 1;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { byYear: byYear.map(b => ({ ...b, ha: r1(b.ha) })), totalHa: r1(byYear.reduce((a, b) => a + b.ha, 0)), recentHa: r1(byYear.filter(b => b.year >= recentFrom).reduce((a, b) => a + b.ha, 0)), recentFrom, lastYear };
}

export async function treeCoverLoss(db: Db, apiKey: string | undefined, geometry: Geometry, fetchImpl?: typeof fetch) {
  const rows = await gfwQuery(db, apiKey, "umd_tree_cover_loss",
    "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha FROM results WHERE umd_tree_cover_density_2000__threshold >= 30 GROUP BY umd_tree_cover_loss__year", geometry, fetchImpl);
  return summarizeLoss(rows);
}

/** Cheap health probe: dataset metadata (no key needed for metadata). */
export const zGfwDataset = z.object({ data: z.object({ dataset: z.string().optional(), metadata: z.record(z.unknown()).optional() }).passthrough() }).passthrough();
export async function gfwDatasetMeta(db: Db, slug: string, fetchImpl?: typeof fetch) {
  return fetchJson(db, { provider: "gfw", endpoint: "dataset_meta", url: `${GFW_BASE}/dataset/${slug}`, schema: zGfwDataset, cacheKey: `meta:${slug}`, cacheTtlMs: 7 * DAY, staleOnError: true, fetchImpl });
}
