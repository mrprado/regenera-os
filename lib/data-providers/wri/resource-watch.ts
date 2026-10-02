// Resource Watch API adapter (WRI). Public, no key: https://resource-watch.github.io/doc-api/
// Used as an upstream catalogue: find a dataset by name, keep its id and metadata, and run a point / polygon query
// against it when its connector supports SQL. The dataset id is resolved by a sync, never hard-coded, and a failed
// query degrades to "source link only". Registry key: resource_watch.
import { z } from "zod";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";

const DAY = 86_400_000;
export const RW_BASE = "https://api.resourcewatch.org/v1";

export const zRwDatasets = z.object({
  data: z.array(z.object({
    id: z.string(),
    attributes: z.object({
      name: z.string(), slug: z.string().optional(), provider: z.string().optional(), connectorType: z.string().optional(), tableName: z.string().nullable().optional(),
      updatedAt: z.string().optional(), dataLastUpdated: z.string().nullable().optional(), published: z.boolean().optional(), geoInfo: z.boolean().optional(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();
export type RwDataset = { id: string; name: string; provider: string | null; connector: string | null; tableName: string | null; updatedAt: string | null; geo: boolean };

export function normalizeRwDatasets(r: z.infer<typeof zRwDatasets>): RwDataset[] {
  return r.data.map(d => ({ id: d.id, name: d.attributes.name, provider: d.attributes.provider ?? null, connector: d.attributes.connectorType ?? null, tableName: d.attributes.tableName ?? null, updatedAt: d.attributes.dataLastUpdated ?? d.attributes.updatedAt ?? null, geo: d.attributes.geoInfo ?? false }));
}

/** Catalogue search (metadata only). */
export async function rwSearch(db: Db, search: string, fetchImpl?: typeof fetch): Promise<RwDataset[]> {
  const url = `${RW_BASE}/dataset?application=rw&published=true&search=${encodeURIComponent(search)}&page[size]=10`;
  return normalizeRwDatasets(await fetchJson(db, { provider: "resource_watch", endpoint: "dataset_search", url, schema: zRwDatasets, cacheKey: `search:${search}`, cacheTtlMs: 7 * DAY, staleOnError: true, fetchImpl }));
}

/** Best match for a catalogue name: every word of the search appears in the dataset name. */
export function pickDataset(list: RwDataset[], search: string): RwDataset | null {
  const words = search.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return list.find(d => words.every(w => d.name.toLowerCase().includes(w)) && d.tableName) ?? list.find(d => words.every(w => d.name.toLowerCase().includes(w))) ?? null;
}

export const zRwQuery = z.object({ data: z.array(z.record(z.unknown())) }).passthrough();

/** Point query against a SQL-capable dataset (Carto / BigQuery connectors). Returns the first row or null. */
export async function rwPointQuery(db: Db, ds: Pick<RwDataset, "id" | "tableName" | "connector">, lat: number, lng: number, fetchImpl?: typeof fetch): Promise<Record<string, unknown> | null> {
  if (!ds.tableName) throw new Error("Dataset has no queryable table");
  const sql = `SELECT * FROM ${ds.tableName} WHERE ST_Intersects(the_geom, ST_SetSRID(ST_MakePoint(${lng.toFixed(5)}, ${lat.toFixed(5)}), 4326)) LIMIT 1`;
  const url = `${RW_BASE}/query/${ds.id}?sql=${encodeURIComponent(sql)}`;
  const r = await fetchJson(db, { provider: "resource_watch", endpoint: "query", url, schema: zRwQuery, cacheKey: `q:${ds.id}:${lat.toFixed(3)},${lng.toFixed(3)}`, cacheTtlMs: 30 * DAY, staleOnError: true, fetchImpl });
  const row = r.data[0] ?? null;
  if (row) delete (row as Record<string, unknown>).the_geom;
  return row;
}
