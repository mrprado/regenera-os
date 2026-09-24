// Geocoding for the map (SPEC section 11): OpenStreetMap Nominatim, per its usage policy
// (max 1 request per second, identifying User-Agent, results cached). Low volume only.
import { z } from "zod";
import type { Db } from "@/db";
import { acquireSlot, fetchJson } from "./http";

const zResult = z.array(z.object({
  lat: z.string(), lon: z.string(), display_name: z.string(),
  address: z.object({ country_code: z.string().nullish() }).passthrough().nullish(),
}));

export type GeoPoint = { lat: number; lng: number; label: string; countryCode: string | null };

export async function geocode(db: Db, query: string, fetchImpl?: typeof fetch): Promise<GeoPoint | null> {
  const clean = query.trim();
  if (clean.length < 2) return null;
  if (!(await acquireSlot(db, "nominatim", 1100))) return null; // try again on a later tick
  const q = new URLSearchParams({ q: clean, format: "jsonv2", limit: "1", addressdetails: "1" });
  const res = await fetchJson(db, {
    provider: "nominatim", endpoint: "search", url: `https://nominatim.openstreetmap.org/search?${q}`,
    schema: zResult, cacheKey: `q:${clean.toLowerCase()}`, cacheTtlMs: 90 * 86_400_000, fetchImpl, retries: 0,
  });
  const r = res[0];
  return r ? { lat: Number(r.lat), lng: Number(r.lon), label: r.display_name, countryCode: r.address?.country_code?.toUpperCase() ?? null } : null;
}
