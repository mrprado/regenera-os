// GeoJSON for the Map screen (SPEC section 11): organizations, deals, triggers and open procurement,
// all mandate-scoped. Hazards come from the regenera.bio intelligence API on the client.
import { and, isNotNull, isNull, ne } from "drizzle-orm";
import { deals, organizations, triggers } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { freshnessSince } from "@/lib/freshness";

type Point = { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: Record<string, string | number | null> };
const point = (lng: number, lat: number, properties: Point["properties"]): Point => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties });
const fc = (features: Point[]) => ({ type: "FeatureCollection" as const, features });

export async function mapFeatures(scope: Scope, now = new Date()) {
  const db = appDb();
  const orgRows = await db.select({
    id: organizations.id, name: organizations.name, lat: organizations.lat, lng: organizations.lng, sector: organizations.sector,
    country: organizations.country, location: organizations.location, source: organizations.source, domain: organizations.domain,
  }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt), isNotNull(organizations.lat), isNotNull(organizations.lng)));
  const orgById = new Map(orgRows.map(o => [o.id, o]));

  const dealRows = await db.select({ id: deals.id, name: deals.name, stage: deals.stage, orgId: deals.orgId, engagement: deals.engagement, valueEstimate: deals.valueEstimate, path: deals.path })
    .from(deals).where(and(mandateCondition(scope, deals.mandateId), isNull(deals.archivedAt), ne(deals.stage, "lost")));

  const triggerRows = await db.select({
    id: triggers.id, orgId: triggers.orgId, type: triggers.type, summary: triggers.summary, eventDate: triggers.eventDate,
    urgency: triggers.urgency, relevance: triggers.relevance, source: triggers.source, sourceUrl: triggers.sourceUrl, lat: triggers.lat, lng: triggers.lng,
    status: triggers.status, decisionRead: triggers.decisionRead,
  }).from(triggers).where(and(mandateCondition(scope, triggers.mandateId), ne(triggers.status, "dismissed")));

  const since = freshnessSince(now).toISOString().slice(0, 10);
  const currentTriggers = triggerRows.filter(t => (t.eventDate ?? "") >= since);

  const dealPoints = dealRows.flatMap(d => {
    const o = d.orgId ? orgById.get(d.orgId) : undefined;
    return o?.lat != null && o.lng != null ? [point(o.lng, o.lat, { id: d.id, name: d.name, stage: d.stage, engagement: d.engagement, path: d.path, value: d.valueEstimate, orgId: o.id, orgName: o.name })] : [];
  });

  const triggerPoints = currentTriggers.flatMap(t => {
    const o = orgById.get(t.orgId);
    const lat = t.lat ?? o?.lat, lng = t.lng ?? o?.lng;
    return lat != null && lng != null ? [point(lng, lat, {
      id: t.id, kind: t.type === "procurement" ? "procurement" : "trigger", type: t.type, summary: t.summary, eventDate: t.eventDate,
      urgency: t.urgency, relevance: t.relevance, source: t.source, url: t.sourceUrl, orgId: t.orgId, orgName: o?.name ?? null,
      status: t.status, decisionRead: t.decisionRead,
    })] : [];
  });

  return {
    generatedAt: now.toISOString(),
    since,
    organizations: fc(orgRows.map(o => point(o.lng!, o.lat!, { id: o.id, name: o.name, sector: o.sector, country: o.country, location: o.location, source: o.source, domain: o.domain }))),
    deals: fc(dealPoints),
    triggers: fc(triggerPoints.filter(p => p.properties.kind === "trigger")),
    procurement: fc(triggerPoints.filter(p => p.properties.kind === "procurement")),
    counts: {
      organizations: orgRows.length,
      unmapped: (await db.select({ id: organizations.id }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.lat)))).length,
      deals: dealPoints.length,
      triggers: triggerPoints.length,
    },
  };
}

export type MapPayload = Awaited<ReturnType<typeof mapFeatures>>;
