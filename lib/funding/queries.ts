// Read models for the Funding screens. Every query is mandate-scoped.
import { and, asc, desc, eq, gte, like, ne, or, sql, type SQL } from "drizzle-orm";
import { bidLibrary, caseRecords, contacts, deals, fundingMatches, fundingOpportunities, organizations } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";

export type FundingFilters = { q?: string; route?: string; type?: string; source?: string; region?: string; minFit?: number; window?: string; decision?: string };

export async function listFunding(scope: Scope, f: FundingFilters, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const windowDays = f.window === "30" ? 30 : f.window === "90" ? 90 : f.window === "365" ? 365 : null;
  const conds: (SQL | undefined)[] = [
    mandateCondition(scope, fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"),
    f.decision === "dismissed" ? eq(fundingOpportunities.decision, "dismissed") : ne(fundingOpportunities.decision, "dismissed"),
    f.q ? or(like(sql`lower(${fundingOpportunities.title})`, `%${f.q.toLowerCase()}%`), like(sql`lower(coalesce(${fundingOpportunities.funder}, ''))`, `%${f.q.toLowerCase()}%`), like(sql`lower(${fundingOpportunities.description})`, `%${f.q.toLowerCase()}%`)) : undefined,
    f.route ? eq(fundingOpportunities.route, f.route as never) : undefined,
    f.type ? eq(fundingOpportunities.type, f.type as never) : undefined,
    f.source ? eq(fundingOpportunities.source, f.source as never) : undefined,
    f.region ? like(sql`lower(coalesce(${fundingOpportunities.countries}, ''))`, `%${f.region.toLowerCase()}%`) : undefined,
    f.minFit ? gte(sql`coalesce(${fundingOpportunities.fit}, 0)`, f.minFit) : undefined,
    f.decision && f.decision !== "dismissed" ? eq(fundingOpportunities.decision, f.decision as never) : undefined,
    windowDays ? sql`${fundingOpportunities.deadline} <= ${new Date(now.getTime() + windowDays * 86_400_000).toISOString().slice(0, 10)}` : undefined,
  ];
  const rows = await appDb().select().from(fundingOpportunities).where(and(...conds))
    .orderBy(desc(sql`coalesce(${fundingOpportunities.fit}, 0)`), asc(fundingOpportunities.deadline)).limit(200);
  const [{ total }] = await appDb().select({ total: sql<number>`count(*)` }).from(fundingOpportunities).where(and(...conds));
  const [{ closingSoon }] = await appDb().select({ closingSoon: sql<number>`count(*)` }).from(fundingOpportunities)
    .where(and(mandateCondition(scope, fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"), ne(fundingOpportunities.decision, "dismissed"),
      gte(fundingOpportunities.deadline, today), sql`${fundingOpportunities.deadline} <= ${new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10)}`));
  return { rows, total, closingSoon };
}

export async function getOpportunity(scope: Scope, id: string) {
  const [o] = await appDb().select().from(fundingOpportunities).where(and(eq(fundingOpportunities.id, id), mandateCondition(scope, fundingOpportunities.mandateId)));
  if (!o) return null;
  const matches = await appDb().select({ m: fundingMatches, orgName: organizations.name, country: organizations.country,
    contactId: sql<string | null>`(select c.id from ${contacts} c where c.org_id = ${organizations.id} and c.email_lower is not null and c.suppressed = 0 limit 1)` })
    .from(fundingMatches).innerJoin(organizations, eq(organizations.id, fundingMatches.orgId))
    .where(eq(fundingMatches.opportunityId, o.id)).orderBy(asc(organizations.name)).limit(50);
  const [deal] = o.dealId ? await appDb().select().from(deals).where(eq(deals.id, o.dealId)) : [];
  return { o, matches, deal: deal ?? null };
}

/** Funders aggregated from the opportunities seen: open calls, typical amounts, next deadline, bids made. */
export async function funderProfiles(scope: Scope) {
  return appDb().select({
    funder: fundingOpportunities.funder,
    open: sql<number>`sum(case when ${fundingOpportunities.status} <> 'closed' then 1 else 0 end)`,
    seen: sql<number>`count(*)`,
    bids: sql<number>`sum(case when ${fundingOpportunities.dealId} is not null then 1 else 0 end)`,
    maxAmount: sql<number | null>`max(${fundingOpportunities.amountMax})`,
    currency: sql<string | null>`max(${fundingOpportunities.currency})`,
    nextDeadline: sql<string | null>`min(case when ${fundingOpportunities.status} <> 'closed' then ${fundingOpportunities.deadline} end)`,
    sources: sql<string>`group_concat(distinct ${fundingOpportunities.source})`,
  }).from(fundingOpportunities).where(and(mandateCondition(scope, fundingOpportunities.mandateId), sql`${fundingOpportunities.funder} is not null`))
    .groupBy(fundingOpportunities.funder).orderBy(desc(sql`sum(case when ${fundingOpportunities.status} <> 'closed' then 1 else 0 end)`)).limit(150);
}

export async function bidDeals(scope: Scope) {
  return appDb().select({ d: deals, title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, funder: fundingOpportunities.funder, route: fundingOpportunities.route, oppId: fundingOpportunities.id })
    .from(deals).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, deals.opportunityId))
    .where(mandateCondition(scope, deals.mandateId)).orderBy(asc(fundingOpportunities.deadline)).limit(100);
}

export async function libraryBlocks(scope: Scope) {
  return appDb().select({ b: bidLibrary, authorized: caseRecords.disclosureAuthorized }).from(bidLibrary)
    .leftJoin(caseRecords, eq(caseRecords.id, bidLibrary.caseRecordId)).where(mandateCondition(scope, bidLibrary.mandateId)).orderBy(asc(bidLibrary.kind), asc(bidLibrary.title));
}

/** Opportunities matching a playbook's keywords (shown on the playbook page). */
export async function fundingForKeywords(scope: Scope, terms: string[], limit = 8) {
  const t = terms.filter(Boolean).slice(0, 6);
  if (!t.length) return [];
  return appDb().select({ id: fundingOpportunities.id, title: fundingOpportunities.title, funder: fundingOpportunities.funder, deadline: fundingOpportunities.deadline, fit: fundingOpportunities.fit, type: fundingOpportunities.type })
    .from(fundingOpportunities)
    .where(and(mandateCondition(scope, fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"), ne(fundingOpportunities.decision, "dismissed"),
      or(...t.map(x => like(sql`lower(${fundingOpportunities.title} || ' ' || ${fundingOpportunities.description})`, `%${x.toLowerCase()}%`)))))
    .orderBy(desc(sql`coalesce(${fundingOpportunities.fit}, 0)`), asc(fundingOpportunities.deadline)).limit(limit);
}

export async function fundingCounts(scope: Scope, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const [r] = await appDb().select({
    open: sql<number>`count(*)`,
    strong: sql<number>`sum(case when coalesce(${fundingOpportunities.fit}, 0) >= 70 then 1 else 0 end)`,
    closing: sql<number>`sum(case when ${fundingOpportunities.deadline} between ${today} and ${new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10)} then 1 else 0 end)`,
  }).from(fundingOpportunities).where(and(mandateCondition(scope, fundingOpportunities.mandateId), ne(fundingOpportunities.status, "closed"), ne(fundingOpportunities.decision, "dismissed")));
  return { open: r.open ?? 0, strong: r.strong ?? 0, closing: r.closing ?? 0 };
}

