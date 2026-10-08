// Registry-listed assets for Atlas: viewport query with a capacity floor at low zoom so the globe stays readable.
import { and, desc, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { registryAssets } from "@/db/schema";

export type Bbox = [number, number, number, number];

/** Pure: the minimum capacity shown at a zoom level (whole world → ≥ 500 MW; regional → all). */
export const capacityFloor = (zoom: number) => (zoom < 3 ? 500 : zoom < 4.5 ? 150 : zoom < 6 ? 30 : 0);

export async function plantsInView(db: Db, bbox: Bbox | null, zoom: number, limit = 3000) {
  const floor = capacityFloor(zoom);
  const where = and(
    bbox ? and(gte(registryAssets.lng, bbox[0]), gte(registryAssets.lat, bbox[1]), lte(registryAssets.lng, bbox[2]), lte(registryAssets.lat, bbox[3])) : undefined,
    floor ? gte(registryAssets.capacityMw, floor) : undefined,
  );
  const rows = await db.select().from(registryAssets).where(where).orderBy(desc(registryAssets.capacityMw)).limit(limit);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(registryAssets).where(bbox ? and(gte(registryAssets.lng, bbox[0]), gte(registryAssets.lat, bbox[1]), lte(registryAssets.lng, bbox[2]), lte(registryAssets.lat, bbox[3])) : undefined);
  return {
    type: "FeatureCollection" as const,
    features: rows.map(r => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] }, properties: {
      id: r.id, name: r.name, fuel: r.fuel, capacityMw: r.capacityMw, commissioningYear: r.commissioningYear, owner: r.owner, country: r.country,
      url: r.url, sourceOfRecord: r.sourceOfRecord, vintage: r.vintage, registry: r.source, retrievedAt: r.retrievedAt, evidence: "registry-listed",
    } })),
    meta: { count: n, shown: rows.length, source: "WRI Global Power Plant Database v1.3", floorMw: floor },
  };
}
