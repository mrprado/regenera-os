// GeoJSON for the Map screen: projects, organizations, deals, triggers and open procurement,
// all mandate-scoped. Hazards come from the regenera.bio intelligence API on the client.
import { and, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, fundingOpportunities, organizations, projects, triggers } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { freshnessSince } from "@/lib/freshness";
import { validCoordinates, type MapPoint } from "./discovery";

type Point = MapPoint;
const point = (lng: number, lat: number, properties: Point["properties"]): Point => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties });
const fc = (features: Point[]) => ({ type: "FeatureCollection" as const, features: features.filter(f => validCoordinates(...f.geometry.coordinates)) });

export async function mapFeatures(scope: Scope, now = new Date(), db: Db = appDb()) {
  const allOrgRows = await db.select({
    id: organizations.id, name: organizations.name, lat: organizations.lat, lng: organizations.lng, sector: organizations.sector,
    country: organizations.country, location: organizations.location, source: organizations.source, domain: organizations.domain,
    description: organizations.description, industry: organizations.industry, website: organizations.website,
    geoSource: organizations.geoSource, updatedAt: organizations.updatedAt,
  }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt)));
  const orgRows = allOrgRows.filter(o => validCoordinates(o.lng, o.lat));
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
    return o?.lat != null && o.lng != null ? [point(o.lng, o.lat, { id: d.id, name: d.name, stage: d.stage, engagement: d.engagement, path: d.path, value: d.valueEstimate, orgId: o.id, orgName: o.name, country: o.country, location: o.location, sector: o.sector, locationBasis: "Organization location; not a confirmed project site" })] : [];
  });

  const triggerPoints = currentTriggers.flatMap(t => {
    const o = orgById.get(t.orgId);
    const ownLocation = validCoordinates(t.lng, t.lat);
    const lat = ownLocation ? t.lat : o?.lat, lng = ownLocation ? t.lng : o?.lng;
    return lat != null && lng != null ? [point(lng, lat, {
      id: t.id, kind: t.type === "procurement" ? "procurement" : "trigger", type: t.type, summary: t.summary, eventDate: t.eventDate,
      urgency: t.urgency, relevance: t.relevance, source: t.source, url: t.sourceUrl, orgId: t.orgId, orgName: o?.name ?? null,
      status: t.status, decisionRead: t.decisionRead, sector: o?.sector ?? null,
      country: ownLocation ? null : o?.country ?? null, location: ownLocation ? null : o?.location ?? null,
      locationBasis: ownLocation ? "Signal coordinates" : "Organization location; approximate for this signal",
    })] : [];
  });

  // Funding opportunities placed by eligible country (0,0 marks "not placeable": EU-wide or global calls).
  const fundingRows = await db.select({ id: fundingOpportunities.id, title: fundingOpportunities.title, funder: fundingOpportunities.funder, deadline: fundingOpportunities.deadline,
    fit: fundingOpportunities.fit, type: fundingOpportunities.type, url: fundingOpportunities.url, lat: fundingOpportunities.lat, lng: fundingOpportunities.lng, summary: fundingOpportunities.read })
    .from(fundingOpportunities).where(and(mandateCondition(scope, fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"), ne(fundingOpportunities.decision, "dismissed")));
  const fundingPoints = fundingRows.filter(f => validCoordinates(f.lng, f.lat) && (f.lat !== 0 || f.lng !== 0)).map(f => point(f.lng!, f.lat!, {
    id: f.id, kind: "procurement", type: f.type, summary: f.title, eventDate: f.deadline, urgency: null, relevance: f.fit, source: "funding", url: f.url,
    orgId: null, orgName: f.funder, status: null, decisionRead: f.summary?.summary ?? null, href: `/funding/${f.id}`, locationBasis: "Eligible-country reference point; not a project site",
  }));

  // Projects: their own coordinates (the physical site), not the sponsor's office.
  const projectRows = await db.select({ id: projects.id, name: projects.name, stage: projects.stage, assetClass: projects.assetClass, country: projects.country, capacity: projects.capacity, capacityUnit: projects.capacityUnit, lat: projects.lat, lng: projects.lng,
    description: projects.description, sector: projects.sector, municipality: projects.municipality, subdivision: projects.subdivision, systems: projects.systems, updatedAt: projects.updatedAt })
    .from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt)));
  const projectPoints = projectRows.filter(p => validCoordinates(p.lng, p.lat)).map(p => point(p.lng!, p.lat!, { id: p.id, name: p.name, stage: p.stage, assetClass: p.assetClass, country: p.country, capacity: p.capacity, capacityUnit: p.capacityUnit,
    description: p.description, sector: p.sector, location: [p.municipality, p.subdivision].filter(Boolean).join(", "), topics: p.systems.join("|"), updatedAt: p.updatedAt, locationBasis: "Recorded project coordinates; see Place for evidence" }));

  return {
    generatedAt: now.toISOString(),
    projects: fc(projectPoints),
    since,
    organizations: fc(orgRows.map(o => point(o.lng!, o.lat!, { id: o.id, name: o.name, sector: o.sector, country: o.country, location: o.location, source: o.source, domain: o.domain,
      description: o.description, topics: o.industry, website: o.website, updatedAt: o.updatedAt, locationBasis: o.geoSource ? `Organization location from ${o.geoSource}` : "Organization location; method not recorded" }))),
    deals: fc(dealPoints),
    triggers: fc(triggerPoints.filter(p => p.properties.kind === "trigger")),
    procurement: fc([...triggerPoints.filter(p => p.properties.kind === "procurement"), ...fundingPoints]),
    counts: {
      organizations: orgRows.length,
      unmapped: allOrgRows.length - orgRows.length,
      unmappedProjects: projectRows.length - projectPoints.length,
      deals: dealPoints.length,
      triggers: triggerPoints.length,
    },
  };
}

export type MapPayload = Awaited<ReturnType<typeof mapFeatures>>;
