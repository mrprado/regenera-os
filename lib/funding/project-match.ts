// Funding discovery → project matching (phase 21 §4). Hard gates first: the record is open or forthcoming, its deadline
// has not passed, its listed geography includes the project's country (or is explicitly global), and when both sides
// state a sector they agree. Then reasons: what is met and what is still unknown (eligibility, amount, applicant type).
// Public-pipeline (Market) projects are excluded: matches are for Regenera's own projects.
import { and, eq, gte, inArray, isNull, ne, notLike, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalRequirements, events, fundingOpportunities, fundingProjectMatches, organizations, projectParties, projects, segments } from "@/db/schema";
import { assessEligibility } from "@/lib/origination/eligibility";
import { fundingCovers, projectSector } from "@/lib/site-intel/opportunity";
import { SECTORS } from "@/lib/vocab";

type Opp = Pick<typeof fundingOpportunities.$inferSelect, "id" | "status" | "deadline" | "countries" | "sectors" | "amountMax" | "applicantTypes" | "type" | "read">;
type Proj = Pick<typeof projects.$inferSelect, "id" | "country" | "technology" | "assetClass" | "name" | "sector">;

/** Pure: the match decision for one pair, or null when a hard gate fails. */
export function matchFunding(o: Opp, p: Proj, today: string) {
  if (o.status === "closed" || (o.deadline && o.deadline < today)) return null;
  if (!p.country) return null;
  const geo = fundingCovers(o.countries, p.country);
  if (geo !== "listed" && geo !== "global") return null;
  const ps = (p.sector as keyof typeof SECTORS | null) ?? projectSector(p);
  const os = o.sectors ?? [];
  if (ps && os.length && !os.includes(ps)) return null;
  const met = [geo === "listed" ? `Lists the project's country (${p.country})` : "States global / developing-country eligibility", ...(ps && os.includes(ps) ? [`Sector: ${SECTORS[ps]}`] : []), o.deadline ? `Deadline ${o.deadline} not passed` : "Open (no deadline stated)"];
  const unknown = [
    ...(o.deadline ? [] : ["Deadline not stated by the source (unverified)"]),
    ...(!ps || !os.length ? ["Sector not stated on one side"] : []),
    ...(o.applicantTypes?.length ? [`Applicant types listed: ${o.applicantTypes.slice(0, 3).join(", ")}: confirm Regenera or the sponsor qualifies`] : ["Applicant eligibility not stated"]),
    ...(o.amountMax ? [] : ["Amount not stated"]),
    ...(o.read?.rules ? ["Read by rules only (AI read pending)"] : []),
  ];
  return { geography: geo as "listed" | "global", reasons: { met, unknown } };
}

export async function matchFundingToProjects(db: Db, mandateId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const projs = await db.select({ id: projects.id, country: projects.country, technology: projects.technology, assetClass: projects.assetClass, name: projects.name, sector: projects.sector, stage: projects.stage, capex: projects.capex, currency: projects.currency })
    .from(projects).where(and(eq(projects.mandateId, mandateId), isNull(projects.archivedAt), or(isNull(projects.originationSource), notLike(projects.originationSource, "Public pipeline:%"))));
  if (!projs.length) return { checked: 0, created: 0 };
  // Facts for eligibility: sponsor / operator / developer organization types and recorded capital need (USD).
  const ids = projs.map(p => p.id);
  const groups = new Map<string, string[]>();
  const need = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    for (const r of await db.select({ projectId: projectParties.projectId, group: segments.group }).from(projectParties).innerJoin(organizations, eq(organizations.id, projectParties.orgId)).innerJoin(segments, eq(segments.id, organizations.segmentId)).where(and(inArray(projectParties.projectId, slice), inArray(projectParties.role, ["sponsor", "operator", "developer"]))))
      groups.set(r.projectId, [...new Set([...(groups.get(r.projectId) ?? []), r.group])]);
    for (const r of await db.select({ projectId: capitalRequirements.projectId, target: capitalRequirements.target, currency: capitalRequirements.currency }).from(capitalRequirements).where(inArray(capitalRequirements.projectId, slice)))
      if (r.target && r.currency === "USD") need.set(r.projectId, (need.get(r.projectId) ?? 0) + r.target);
  }
  const opps = await db.select({ id: fundingOpportunities.id, status: fundingOpportunities.status, deadline: fundingOpportunities.deadline, countries: fundingOpportunities.countries, sectors: fundingOpportunities.sectors, amountMax: fundingOpportunities.amountMax, amountMin: fundingOpportunities.amountMin, currency: fundingOpportunities.currency, source: fundingOpportunities.source, applicantTypes: fundingOpportunities.applicantTypes, type: fundingOpportunities.type, read: fundingOpportunities.read, title: fundingOpportunities.title })
    .from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, mandateId), ne(fundingOpportunities.status, "closed"))).limit(3000);
  let created = 0;
  for (const o of opps) for (const p of projs) {
    const m = matchFunding(o, p, today);
    if (!m) continue;
    const e = assessEligibility(o, { country: p.country, sector: (p.sector as string | null) ?? projectSector(p), stage: p.stage, capexUsd: p.currency === "USD" ? p.capex : null, capitalNeedUsd: need.get(p.id) ?? null, sponsorGroups: groups.get(p.id) ?? [] }, today);
    if (e.eligibility === "ineligible" || e.eligibility === "expired_or_closed") continue;
    const values = { eligibility: e.eligibility, checks: e.checks, soft: e.soft, questions: e.questions, capitalStage: e.capitalStage };
    const r = await db.insert(fundingProjectMatches).values({ mandateId, opportunityId: o.id, projectId: p.id, geography: m.geography, reasons: m.reasons, ...values }).onConflictDoNothing().returning({ id: fundingProjectMatches.id });
    if (!r.length) await db.update(fundingProjectMatches).set({ ...values, updatedAt: now.toISOString() }).where(and(eq(fundingProjectMatches.opportunityId, o.id), eq(fundingProjectMatches.projectId, p.id)));
    if (r.length) {
      created++;
      await db.insert(events).values({ mandateId, type: "MATCH_CREATED", entityType: "project", entityId: p.id, payload: { summary: `Funding match: ${o.title.slice(0, 120)}`, opportunityId: o.id, kind: "funding" }, actor: "system:funding-match" });
    }
  }
  // Matches whose opportunity has since closed are dismissed automatically (kept for history).
  const closed = (await db.select({ id: fundingOpportunities.id }).from(fundingOpportunities).where(eq(fundingOpportunities.status, "closed"))).map(x => x.id);
  for (let i = 0; i < closed.length; i += 90) await db.update(fundingProjectMatches).set({ status: "dismissed", decidedBy: "system: opportunity closed", updatedAt: now.toISOString() }).where(and(eq(fundingProjectMatches.status, "proposed"), inArray(fundingProjectMatches.opportunityId, closed.slice(i, i + 90))));
  return { checked: opps.length * projs.length, created };
}

export async function projectFundingMatches(db: Db, projectId: string) {
  return db.select({ id: fundingProjectMatches.id, status: fundingProjectMatches.status, geography: fundingProjectMatches.geography, reasons: fundingProjectMatches.reasons, eligibility: fundingProjectMatches.eligibility, checks: fundingProjectMatches.checks, questions: fundingProjectMatches.questions, capitalStage: fundingProjectMatches.capitalStage, title: fundingOpportunities.title, funder: fundingOpportunities.funder, source: fundingOpportunities.source, url: fundingOpportunities.url, deadline: fundingOpportunities.deadline, oppId: fundingOpportunities.id })
    .from(fundingProjectMatches).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProjectMatches.opportunityId))
    // A call whose deadline has passed is not current financing, even before the nightly job closes it.
    .where(and(eq(fundingProjectMatches.projectId, projectId), ne(fundingProjectMatches.status, "dismissed"), ne(fundingOpportunities.status, "closed"), or(isNull(fundingOpportunities.deadline), gte(fundingOpportunities.deadline, new Date().toISOString().slice(0, 10)))))
    .orderBy(sql`case ${fundingProjectMatches.geography} when 'listed' then 0 else 1 end`, sql`coalesce(${fundingOpportunities.deadline}, '9999')`).limit(25);
}
