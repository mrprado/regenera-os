// Read models for the Projects screens. Every query is mandate-scoped.
import { and, asc, desc, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import {
  activities, capitalOpportunities, capitalRequirements, constraints, contacts, contracts, deals, fundingMatches, fundingOpportunities, organizations,
  projectParties, projectReadiness, projects, projectStageHistory, tasks, triggers,
} from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { capitalSummary } from "./engine";

export type ProjectFilters = { q?: string; stage?: string; sector?: string; country?: string; blocked?: string; capital?: string };

export async function listProjects(scope: Scope, f: ProjectFilters) {
  const db = appDb();
  const conds: (SQL | undefined)[] = [
    mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt),
    f.q ? or(like(sql`lower(${projects.name})`, `%${f.q.toLowerCase()}%`), like(sql`lower(${projects.description})`, `%${f.q.toLowerCase()}%`)) : undefined,
    f.stage ? eq(projects.stage, f.stage as never) : undefined,
    f.sector ? eq(projects.sector, f.sector) : undefined,
    f.country ? like(sql`lower(coalesce(${projects.country}, ''))`, `%${f.country.toLowerCase()}%`) : undefined,
  ];
  const rows = await db.select().from(projects).where(and(...conds)).orderBy(desc(projects.updatedAt)).limit(300);
  const ids = rows.map(r => r.id).slice(0, 90);
  if (!ids.length) return [];
  const openCons = await db.select({ projectId: constraints.projectId, n: sql<number>`count(*)`, worst: sql<string>`max(case ${constraints.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end)` })
    .from(constraints).where(and(inArray(constraints.projectId, ids), inArray(constraints.status, ["open", "in_progress"]))).groupBy(constraints.projectId);
  const blockedDims = await db.select({ projectId: projectReadiness.projectId, n: sql<number>`count(*)` }).from(projectReadiness)
    .where(and(inArray(projectReadiness.projectId, ids), eq(projectReadiness.status, "blocked"))).groupBy(projectReadiness.projectId);
  const capital = await db.select({ projectId: capitalRequirements.projectId, currency: capitalRequirements.currency, target: sql<number>`coalesce(sum(${capitalRequirements.target}), 0)`, secured: sql<number>`coalesce(sum(${capitalRequirements.secured}), 0)` })
    .from(capitalRequirements).where(and(inArray(capitalRequirements.projectId, ids), sql`${capitalRequirements.status} != 'cancelled'`)).groupBy(capitalRequirements.projectId, capitalRequirements.currency);
  const sponsors = await db.select({ projectId: projectParties.projectId, name: organizations.name }).from(projectParties)
    .innerJoin(organizations, eq(organizations.id, projectParties.orgId)).where(and(inArray(projectParties.projectId, ids), eq(projectParties.role, "sponsor")));
  const out = rows.map(p => ({
    p,
    openConstraints: openCons.find(c => c.projectId === p.id)?.n ?? 0,
    worstSeverity: Number(openCons.find(c => c.projectId === p.id)?.worst ?? 0),
    blocked: blockedDims.find(b => b.projectId === p.id)?.n ?? 0,
    capital: capital.filter(c => c.projectId === p.id),
    sponsor: sponsors.find(s => s.projectId === p.id)?.name ?? null,
  }));
  return out.filter(x => (f.blocked ? x.blocked > 0 || x.worstSeverity >= 3 : true) && (f.capital ? x.capital.some(c => c.target > c.secured) : true));
}

export async function getProject(scope: Scope, id: string) {
  const db = appDb();
  const [p] = await db.select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) return null;
  const [parties, readiness, cons, history, capital, linkedDeals, linkedContracts, linkedTasks, linkedTriggers, fundMatches] = await Promise.all([
    db.select({ party: projectParties, orgName: organizations.name, contactName: contacts.fullName }).from(projectParties)
      .leftJoin(organizations, eq(organizations.id, projectParties.orgId)).leftJoin(contacts, eq(contacts.id, projectParties.contactId))
      .where(eq(projectParties.projectId, id)).orderBy(asc(projectParties.role)),
    db.select().from(projectReadiness).where(eq(projectReadiness.projectId, id)),
    db.select().from(constraints).where(eq(constraints.projectId, id)).orderBy(asc(constraints.status), desc(constraints.severity)),
    db.select().from(projectStageHistory).where(eq(projectStageHistory.projectId, id)).orderBy(desc(projectStageHistory.at)).limit(30),
    capitalSummary(db, id),
    db.select({ id: deals.id, name: deals.name, stage: deals.stage, engagement: deals.engagement }).from(deals).where(eq(deals.projectId, id)),
    db.select({ id: contracts.id, title: contracts.title, status: contracts.status, kind: contracts.kind, lifecycle: contracts.lifecycle, category: contracts.category, contractType: contracts.contractType }).from(contracts).where(eq(contracts.projectId, id)),
    db.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(asc(tasks.dueAt)).limit(30),
    db.select({ id: triggers.id, summary: triggers.summary, eventDate: triggers.eventDate }).from(triggers).where(eq(triggers.projectId, id)).orderBy(desc(triggers.eventDate)).limit(20),
    db.select({ m: fundingMatches, title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, opportunityId: fundingOpportunities.id }).from(fundingMatches)
      .innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingMatches.opportunityId)).where(eq(fundingMatches.projectId, id)),
  ]);
  const capitalOpps = await db.select().from(capitalOpportunities).where(eq(capitalOpportunities.projectId, id));
  const dealIds = linkedDeals.map(d => d.id);
  const acts = dealIds.length ? await db.select().from(activities).where(inArray(activities.dealId, dealIds)).orderBy(desc(activities.occurredAt)).limit(40) : [];
  return { p, parties, readiness, constraints: cons, history, capital, deals: linkedDeals, contracts: linkedContracts, tasks: linkedTasks, triggers: linkedTriggers, funding: fundMatches, activities: acts, capitalOpportunities: capitalOpps };
}

/** Choices for forms: organizations and people in scope, deals without a project. */
export async function projectPickers(scope: Scope) {
  const db = appDb();
  const [orgs, people, openDeals] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000),
    db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(mandateCondition(scope, contacts.mandateId)).orderBy(asc(contacts.fullName)).limit(1000),
    db.select({ id: deals.id, name: deals.name }).from(deals).where(and(mandateCondition(scope, deals.mandateId), isNull(deals.projectId), isNull(deals.archivedAt))).orderBy(asc(deals.name)),
  ]);
  return { orgs, people, openDeals };
}

/** Open funding opportunities that fit a project by country and sector, for the Funding tab. */
export async function fundingForProject(scope: Scope, p: { country: string | null; sector: string | null }) {
  const db = appDb();
  return db.select({ id: fundingOpportunities.id, title: fundingOpportunities.title, funder: fundingOpportunities.funder, deadline: fundingOpportunities.deadline, fit: fundingOpportunities.fit, countries: fundingOpportunities.countries, type: fundingOpportunities.type, kind: fundingOpportunities.kind, amountMax: fundingOpportunities.amountMax, currency: fundingOpportunities.currency })
    .from(fundingOpportunities)
    .where(and(mandateCondition(scope, fundingOpportunities.mandateId), sql`${fundingOpportunities.status} != 'closed'`, sql`${fundingOpportunities.decision} != 'dismissed'`,
      p.sector ? like(sql`coalesce(${fundingOpportunities.sectors}, '')`, `%${p.sector}%`) : undefined,
      p.country ? or(like(sql`lower(coalesce(${fundingOpportunities.countries}, ''))`, `%${p.country.toLowerCase()}%`), sql`${fundingOpportunities.countries} = '[]'`) : undefined))
    .orderBy(asc(sql`coalesce(${fundingOpportunities.deadline}, '9999')`)).limit(25);
}
