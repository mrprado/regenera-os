// Funding discovery → project matching (phase 21 §4). Hard gates first: the record is open or forthcoming, its deadline
// has not passed, its listed geography includes the project's country (or is explicitly global), and when both sides
// state a sector they agree. Then reasons: what is met and what is still unknown (eligibility, amount, applicant type).
// Public-pipeline (Market) projects are excluded: matches are for Regenera's own projects.
import { and, eq, inArray, isNull, ne, notLike, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { events, fundingOpportunities, fundingProjectMatches, projects } from "@/db/schema";
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
  const projs = await db.select({ id: projects.id, country: projects.country, technology: projects.technology, assetClass: projects.assetClass, name: projects.name, sector: projects.sector })
    .from(projects).where(and(eq(projects.mandateId, mandateId), isNull(projects.archivedAt), or(isNull(projects.originationSource), notLike(projects.originationSource, "Public pipeline:%"))));
  if (!projs.length) return { checked: 0, created: 0 };
  const opps = await db.select({ id: fundingOpportunities.id, status: fundingOpportunities.status, deadline: fundingOpportunities.deadline, countries: fundingOpportunities.countries, sectors: fundingOpportunities.sectors, amountMax: fundingOpportunities.amountMax, applicantTypes: fundingOpportunities.applicantTypes, type: fundingOpportunities.type, read: fundingOpportunities.read, title: fundingOpportunities.title })
    .from(fundingOpportunities).where(and(eq(fundingOpportunities.mandateId, mandateId), ne(fundingOpportunities.status, "closed"))).limit(3000);
  let created = 0;
  for (const o of opps) for (const p of projs) {
    const m = matchFunding(o, p, today);
    if (!m) continue;
    const r = await db.insert(fundingProjectMatches).values({ mandateId, opportunityId: o.id, projectId: p.id, geography: m.geography, reasons: m.reasons }).onConflictDoNothing().returning({ id: fundingProjectMatches.id });
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
  return db.select({ id: fundingProjectMatches.id, status: fundingProjectMatches.status, geography: fundingProjectMatches.geography, reasons: fundingProjectMatches.reasons, title: fundingOpportunities.title, funder: fundingOpportunities.funder, source: fundingOpportunities.source, url: fundingOpportunities.url, deadline: fundingOpportunities.deadline, oppId: fundingOpportunities.id })
    .from(fundingProjectMatches).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProjectMatches.opportunityId))
    .where(and(eq(fundingProjectMatches.projectId, projectId), ne(fundingProjectMatches.status, "dismissed")))
    .orderBy(sql`case ${fundingProjectMatches.geography} when 'listed' then 0 else 1 end`, sql`coalesce(${fundingOpportunities.deadline}, '9999')`).limit(25);
}
