// World Bank EnergyData.info (CKAN API, keyless): energy datasets published for a country (power plants, grid, planning
// models), shown on the project's integrity panel as sources to pull into diligence. Licence is per dataset.
import { z } from "zod";
import type { Db } from "@/db";
import { fetchJson } from "@/lib/sources/http";

const zSearch = z.object({ result: z.object({ count: z.number(), results: z.array(z.object({
  name: z.string(), title: z.string(), license_title: z.string().nullable().optional(), metadata_modified: z.string().optional(),
  organization: z.object({ title: z.string().optional() }).nullable().optional(), country_code: z.union([z.array(z.string()), z.string()]).nullable().optional(),
}).passthrough()) }) }).passthrough();

export type EnergyDataset = { title: string; url: string; publisher: string; licence: string; updated: string | null };

export async function energyDatasets(db: Db, countryName: string, fetchImpl?: typeof fetch): Promise<EnergyDataset[]> {
  const q = encodeURIComponent(`${countryName} (electricity OR power OR grid OR solar OR wind OR transmission)`);
  const r = await fetchJson(db, { provider: "energydata", endpoint: "package_search", url: `https://energydata.info/api/3/action/package_search?q=${q}&rows=12&sort=metadata_modified%20desc`, schema: zSearch, cacheKey: `ed:${countryName.toLowerCase()}`, cacheTtlMs: 7 * 86_400_000, fetchImpl, staleOnError: true });
  return r.result.results.map(d => ({ title: d.title, url: `https://energydata.info/dataset/${d.name}`, publisher: d.organization?.title ?? "", licence: d.license_title ?? "see dataset", updated: d.metadata_modified?.slice(0, 10) ?? null }));
}
