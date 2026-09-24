// Geocoding for the map (SPEC section 11): OpenStreetMap Nominatim, per its usage policy
// (max 1 request per second, identifying User-Agent, results cached). Low volume only.
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { sourceCache } from "@/db/schema";
import { acquireSlot, fetchJson } from "./http";

const zResult = z.array(z.object({
  lat: z.string(), lon: z.string(), display_name: z.string(),
  address: z.object({ country_code: z.string().nullish() }).passthrough().nullish(),
}));

export type GeoPoint = { lat: number; lng: number; label: string; countryCode: string | null };

/** Returns the point, null when nothing matched, or "busy" when the 1 req/s slot was taken (try later). */
export async function geocode(db: Db, query: string, fetchImpl?: typeof fetch): Promise<GeoPoint | null | "busy"> {
  const clean = query.trim();
  if (clean.length < 2) return null;
  const cached = await peekCache(db, clean);
  if (cached !== undefined) return cached;
  if (!(await acquireSlot(db, "nominatim", 1100))) return "busy";
  const q = new URLSearchParams({ q: clean, format: "jsonv2", limit: "1", addressdetails: "1" });
  const res = await fetchJson(db, {
    provider: "nominatim", endpoint: "search", url: `https://nominatim.openstreetmap.org/search?${q}`,
    schema: zResult, cacheKey: `q:${clean.toLowerCase()}`, cacheTtlMs: 90 * 86_400_000, fetchImpl, retries: 0,
  });
  const r = res[0];
  return r ? { lat: Number(r.lat), lng: Number(r.lon), label: r.display_name, countryCode: r.address?.country_code?.toUpperCase() ?? null } : null;
}

async function peekCache(db: Db, clean: string): Promise<GeoPoint | null | undefined> {
  const [row] = await db.select().from(sourceCache).where(eq(sourceCache.key, `nominatim:q:${clean.toLowerCase()}`));
  if (!row || row.expiresAt < new Date().toISOString()) return undefined;
  const r = zResult.parse(JSON.parse(row.value))[0];
  return r ? { lat: Number(r.lat), lng: Number(r.lon), label: r.display_name, countryCode: r.address?.country_code?.toUpperCase() ?? null } : null;
}
