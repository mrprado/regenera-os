// Points for the small Command map (phase 15 §4): projects by stage (blocked flagged), qualified prospects and active
// opportunities' organizations, and capital / delivery / referral partners. Location quality comes from how the point
// was recorded: project geometry or a recorded point, a geocoded headquarters, or country-level only. Records without a
// location are counted so Command can offer a missing-location review instead of silently dropping them.
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { accountQualifications, organizations, partners, projects } from "@/db/schema";
import type { MiniPoint, MiniQuality } from "@/components/mini-map";
import { stageLabel } from "@/lib/projects/labels";
import { QUALIFICATION_LABELS } from "@/lib/scan/qualification";

const orgQuality = (geoSource: string | null): MiniQuality => (geoSource === "manual" ? "recorded" : geoSource === "country" || geoSource === "centroid" ? "country" : "approximate");

export async function commandMapPoints(db: Db, mandateIds: string[], flaggedProjects: Set<string>) {
  const ids = mandateIds.length ? mandateIds : ["-"];
  const [proj, [{ projMissing }], prospects, partnerOrgs] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, lat: projects.lat, lng: projects.lng, stage: projects.stage, country: projects.country, geometry: projects.geometry }).from(projects)
      .where(and(inArray(projects.mandateId, ids), isNull(projects.archivedAt), ne(projects.status, "dropped"), isNotNull(projects.lat), isNotNull(projects.lng))).limit(500),
    db.select({ projMissing: sql<number>`count(*)` }).from(projects).where(and(inArray(projects.mandateId, ids), isNull(projects.archivedAt), ne(projects.status, "dropped"), or(isNull(projects.lat), isNull(projects.lng)))),
    db.select({ id: organizations.id, name: organizations.name, lat: organizations.lat, lng: organizations.lng, geoSource: organizations.geoSource, country: organizations.country, status: accountQualifications.status, next: accountQualifications.nextAction })
      .from(accountQualifications).innerJoin(organizations, eq(organizations.id, accountQualifications.orgId))
      .where(and(inArray(accountQualifications.mandateId, ids), eq(organizations.testRecord, false), isNull(organizations.archivedAt), inArray(accountQualifications.status, ["human_reviewed", "ready_for_outreach", "engaged", "qualified_opportunity"]))).limit(500),
    db.select({ id: organizations.id, name: organizations.name, lat: organizations.lat, lng: organizations.lng, geoSource: organizations.geoSource, country: organizations.country, roles: organizations.roles, partnerType: partners.type })
      .from(organizations).leftJoin(partners, eq(partners.orgId, organizations.id))
      .where(and(inArray(organizations.mandateId, ids), eq(organizations.testRecord, false), isNull(organizations.archivedAt),
        or(isNotNull(partners.id), sql`${organizations.roles} like '%partner%'`, sql`${organizations.roles} like '%capital_provider%'`))).limit(500),
  ]);
  const points: MiniPoint[] = [];
  for (const p of proj) points.push({ id: p.id, kind: "project", name: p.name, lat: p.lat!, lng: p.lng!, stage: stageLabel(p.stage as never) ?? p.stage, sub: p.country ?? undefined, alert: flaggedProjects.has(p.id), quality: p.geometry ? "exact" : "recorded", href: `/projects/${p.id}`, atlasHref: `/map?project=${p.id}` });
  const seen = new Set<string>();
  let orgMissing = 0;
  for (const o of prospects) {
    if (o.lat == null || o.lng == null) { orgMissing++; continue; }
    seen.add(o.id);
    points.push({ id: o.id, kind: "prospect", name: o.name, lat: o.lat, lng: o.lng, stage: QUALIFICATION_LABELS[o.status], sub: o.country ?? undefined, next: o.next || undefined, quality: orgQuality(o.geoSource), href: `/companies/${o.id}?tab=qualification`, atlasHref: `/map?lat=${o.lat}&lng=${o.lng}&z=8` });
  }
  for (const o of partnerOrgs) {
    if (seen.has(o.id)) continue;
    if (o.lat == null || o.lng == null) { orgMissing++; continue; }
    seen.add(o.id);
    const role = (o.roles ?? []).includes("capital_provider") ? "Capital provider" : o.partnerType ? `Partner (${o.partnerType.replace(/_/g, " ")})` : "Partner";
    points.push({ id: o.id, kind: "partner", name: o.name, lat: o.lat, lng: o.lng, stage: role, sub: o.country ?? undefined, quality: orgQuality(o.geoSource), href: `/companies/${o.id}`, atlasHref: `/map?lat=${o.lat}&lng=${o.lng}&z=8` });
  }
  return { points, missing: projMissing + orgMissing };
}
