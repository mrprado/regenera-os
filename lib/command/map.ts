// Points for the Command map (phase 15 §4, phase 16 §8): projects by stage (blocked flagged), qualified prospects and active
// opportunities' organizations, and capital / delivery / referral partners. Location quality comes from how the point was
// recorded: project geometry or a recorded point, a geocoded headquarters, or country-level only. Three modes:
//   all    every mapped record;
//   new    records that arrived since the start of the workspace's local day (actual created timestamps, never seeded
//          examples), plus newly collected funding calls, which are coverage areas and are listed, never pinned;
//   today  the records behind today's and overdue work (the ids Command passes in).
// Records without a location are returned as a list, so missing coordinates never hide work.
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { accountQualifications, fundingOpportunities, organizations, partners, projects } from "@/db/schema";
import type { MiniPoint, MiniQuality } from "@/components/mini-map";
import { stageLabel } from "@/lib/projects/labels";
import { QUALIFICATION_LABELS } from "@/lib/scan/qualification";

export type MapMode = "new" | "today" | "all";
export type Unmapped = { key: string; name: string; href: string; what: string };
const orgQuality = (geoSource: string | null): MiniQuality => (geoSource === "manual" ? "recorded" : geoSource === "country" || geoSource === "centroid" ? "country" : "approximate");

export async function commandMapPoints(db: Db, mandateIds: string[], flaggedProjects: Set<string>, opts: { mode?: MapMode; since?: string; focus?: Set<string> } = {}) {
  const ids = mandateIds.length ? mandateIds : ["-"];
  const mode = opts.mode ?? "all";
  const since = opts.since ?? "9999";
  const [proj, prospects, partnerOrgs, newCalls] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, lat: projects.lat, lng: projects.lng, stage: projects.stage, country: projects.country, geometry: projects.geometry, createdAt: projects.createdAt }).from(projects)
      .where(and(inArray(projects.mandateId, ids), isNull(projects.archivedAt), ne(projects.status, "dropped"))).limit(1000),
    db.select({ id: organizations.id, name: organizations.name, lat: organizations.lat, lng: organizations.lng, geoSource: organizations.geoSource, country: organizations.country, status: accountQualifications.status, next: accountQualifications.nextAction, createdAt: accountQualifications.createdAt })
      .from(accountQualifications).innerJoin(organizations, eq(organizations.id, accountQualifications.orgId))
      .where(and(inArray(accountQualifications.mandateId, ids), eq(organizations.testRecord, false), isNull(organizations.archivedAt), inArray(accountQualifications.status, ["human_reviewed", "ready_for_outreach", "engaged", "qualified_opportunity"]))).limit(500),
    db.select({ id: organizations.id, name: organizations.name, lat: organizations.lat, lng: organizations.lng, geoSource: organizations.geoSource, country: organizations.country, roles: organizations.roles, partnerType: partners.type, createdAt: organizations.createdAt })
      .from(organizations).leftJoin(partners, eq(partners.orgId, organizations.id))
      .where(and(inArray(organizations.mandateId, ids), eq(organizations.testRecord, false), isNull(organizations.archivedAt),
        or(isNotNull(partners.id), sql`${organizations.roles} like '%partner%'`, sql`${organizations.roles} like '%capital_provider%'`))).limit(500),
    mode === "new" ? db.select({ id: fundingOpportunities.id, title: fundingOpportunities.title, countries: fundingOpportunities.countries, deadline: fundingOpportunities.deadline })
      .from(fundingOpportunities).where(and(inArray(fundingOpportunities.mandateId, ids), gte(fundingOpportunities.createdAt, since), eq(fundingOpportunities.status, "open"))).limit(20) : Promise.resolve([]),
  ]);
  const keep = (id: string, createdAt: string) => mode === "all" || (mode === "new" ? createdAt >= since : opts.focus?.has(id) ?? false);
  const points: MiniPoint[] = [];
  const unmapped: Unmapped[] = [];
  let missing = 0;
  for (const p of proj) {
    if (!keep(p.id, p.createdAt)) continue;
    if (p.lat == null || p.lng == null) { missing++; unmapped.push({ key: `p:${p.id}`, name: p.name, href: `/projects/${p.id}`, what: `Project · ${stageLabel(p.stage as never) ?? p.stage} · no recorded location` }); continue; }
    points.push({ id: p.id, kind: "project", name: p.name, lat: p.lat, lng: p.lng, stage: stageLabel(p.stage as never) ?? p.stage, sub: p.country ?? undefined, alert: flaggedProjects.has(p.id), quality: p.geometry ? "exact" : "recorded", href: `/projects/${p.id}`, atlasHref: `/map?project=${p.id}` });
  }
  const seen = new Set<string>();
  for (const o of prospects) {
    if (!keep(o.id, o.createdAt) || seen.has(o.id)) continue;
    seen.add(o.id);
    if (o.lat == null || o.lng == null) { missing++; unmapped.push({ key: `o:${o.id}`, name: o.name, href: `/companies/${o.id}?tab=qualification`, what: `Prospect · ${QUALIFICATION_LABELS[o.status]} · no location` }); continue; }
    points.push({ id: o.id, kind: "prospect", name: o.name, lat: o.lat, lng: o.lng, stage: QUALIFICATION_LABELS[o.status], sub: o.country ?? undefined, next: o.next || undefined, quality: orgQuality(o.geoSource), href: `/companies/${o.id}?tab=qualification`, atlasHref: `/map?lat=${o.lat}&lng=${o.lng}&z=8` });
  }
  for (const o of partnerOrgs) {
    if (!keep(o.id, o.createdAt) || seen.has(o.id)) continue;
    seen.add(o.id);
    const role = (o.roles ?? []).includes("capital_provider") ? "Capital provider (office location, not deployment area)" : o.partnerType ? `Partner (${o.partnerType.replace(/_/g, " ")})` : "Partner";
    if (o.lat == null || o.lng == null) { missing++; unmapped.push({ key: `o:${o.id}`, name: o.name, href: `/companies/${o.id}`, what: `${role} · no location` }); continue; }
    points.push({ id: o.id, kind: "partner", name: o.name, lat: o.lat, lng: o.lng, stage: role, sub: o.country ?? undefined, quality: orgQuality(o.geoSource), href: `/companies/${o.id}`, atlasHref: `/map?lat=${o.lat}&lng=${o.lng}&z=8` });
  }
  // A funding call covers countries; it has no site. Listed, never pinned.
  for (const c of newCalls) unmapped.push({ key: `f:${c.id}`, name: c.title, href: `/funding/${c.id}`, what: `New funding call · coverage ${(c.countries ?? []).slice(0, 4).join(", ") || "not stated"} · deadline ${c.deadline ?? "unknown"}` });
  return { points, missing, unmapped };
}
