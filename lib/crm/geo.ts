// Map coordinates for organizations: Wikidata (when linked) first, then OpenStreetMap Nominatim.
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

  if (org.wikidataId) {
    const wd = await wikidataOrg(db, org.wikidataId);
    if (wd?.coordinates) point = { ...wd.coordinates, source: "wikidata" };
    else if (wd?.hqQid) {
      const hq = await wikidataOrg(db, wd.hqQid);
      if (hq?.coordinates) point = { ...hq.coordinates, source: "wikidata" };
    }
  }
  if (!point) {
    const query = org.location || org.country;
    if (!query) return "none";
    const g = await geocode(db, query);
    if (g === null) {
      // null can mean "rate slot busy" or "no result"; a second attempt distinguishes them.
      return "retry";
    }
    point = { lat: g.lat, lng: g.lng, source: "nominatim" };
  }
  const sources: FieldSources = { ...org.fieldSources, lat: { source: point.source, at: new Date().toISOString() } };
  await db.update(organizations).set({ lat: point.lat, lng: point.lng, geoSource: point.source, fieldSources: sources }).where(eq(organizations.id, org.id));
  await backfillTriggerCoordinates(db, org.id, point.lat, point.lng);
  return "done";
}
