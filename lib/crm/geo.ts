// Map coordinates for organizations: stated location, then Wikidata HQ, then country.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { organizations, type FieldSources } from "@/db/schema";
import { backfillTriggerCoordinates } from "@/lib/triggers/engine";
import { geocode } from "@/lib/sources/geocode";
import { wikidataOrg } from "@/lib/sources/identity";

export async function geocodeOrganization(db: Db, orgId: string): Promise<"done" | "none" | "retry"> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org || (org.lat != null && org.lng != null)) return "done";
  let point: { lat: number; lng: number; source: string } | null = null;

  // 1. An explicit location (entered, from Apollo, or from the dossier) is the most specific.
  if (org.location) {
    const g = await geocode(db, org.location);
    if (g === "busy") return "retry";
    if (g) point = { lat: g.lat, lng: g.lng, source: "nominatim" };
  }
  // 2. Wikidata headquarters city, then the item's own coordinates (often coarse).
  if (!point && org.wikidataId) {
    const wd = await wikidataOrg(db, org.wikidataId);
    const hq = wd?.hqQid ? await wikidataOrg(db, wd.hqQid) : null;
    const c = hq?.coordinates ?? wd?.coordinates;
    if (c) point = { ...c, source: "wikidata" };
  }
  // 3. Country as a last resort.
  if (!point && org.country) {
    const g = await geocode(db, org.country);
    if (g === "busy") return "retry";
    if (g) point = { lat: g.lat, lng: g.lng, source: "nominatim" };
  }
  if (!point) return "none";
  const sources: FieldSources = { ...org.fieldSources, lat: { source: point.source, at: new Date().toISOString() } };
  await db.update(organizations).set({ lat: point.lat, lng: point.lng, geoSource: point.source, fieldSources: sources }).where(eq(organizations.id, org.id));
  await backfillTriggerCoordinates(db, org.id, point.lat, point.lng);
  return "done";
}
