// Read models for the Contracts screens. Every query is mandate-scoped.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { contractMilestones, contracts, contractVersions, deals, organizations, partners } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";

export async function listContracts(scope: Scope, f: { status?: string; kind?: string; registered?: boolean }) {
  return appDb().select({ c: contracts, orgName: organizations.name, dealName: deals.name }).from(contracts)
    .leftJoin(organizations, eq(organizations.id, contracts.orgId)).leftJoin(deals, eq(deals.id, contracts.dealId))
    .where(and(mandateCondition(scope, contracts.mandateId), f.status ? eq(contracts.status, f.status as never) : undefined, f.kind ? eq(contracts.kind, f.kind as never) : undefined,
      f.registered === undefined ? undefined : f.registered ? eq(contracts.kind, "registered") : ne(contracts.kind, "registered")))
    .orderBy(desc(contracts.updatedAt)).limit(300);
}

export async function getContract(scope: Scope, id: string) {
  const [row] = await appDb().select({ c: contracts, orgName: organizations.name, dealName: deals.name, dealStage: deals.stage }).from(contracts)
    .leftJoin(organizations, eq(organizations.id, contracts.orgId)).leftJoin(deals, eq(deals.id, contracts.dealId))
    .where(and(eq(contracts.id, id), mandateCondition(scope, contracts.mandateId)));
  if (!row) return null;
  const versions = await appDb().select({ version: contractVersions.version, note: contractVersions.note, createdBy: contractVersions.createdBy, createdAt: contractVersions.createdAt })
    .from(contractVersions).where(eq(contractVersions.contractId, id)).orderBy(desc(contractVersions.version));
  const milestones = await appDb().select().from(contractMilestones).where(eq(contractMilestones.contractId, id)).orderBy(asc(contractMilestones.dueDate));
  return { ...row, versions, milestones };
}

/** Deals and partners a new contract can be drafted from. */
export async function contractSources(scope: Scope) {
  const dealRows = await appDb().select({ id: deals.id, name: deals.name, stage: deals.stage }).from(deals)
    .where(and(mandateCondition(scope, deals.mandateId), isNull(deals.archivedAt), sql`${deals.stage} not in ('lost', 'churned')`)).orderBy(asc(deals.name));
  const partnerRows = await appDb().select({ id: partners.id, name: partners.name, tier: partners.tier }).from(partners)
    .where(mandateCondition(scope, partners.mandateId)).orderBy(asc(partners.name));
  return { deals: dealRows, partners: partnerRows };
}

/** Contract count per deal, for the Deals table. */
export async function contractsByDeal(scope: Scope, dealIds: string[]) {
  if (!dealIds.length) return new Map<string, { id: string; status: string }>();
  const rows = await appDb().select({ id: contracts.id, dealId: contracts.dealId, status: contracts.status }).from(contracts)
    .where(and(mandateCondition(scope, contracts.mandateId), inArray(contracts.dealId, dealIds.slice(0, 90)))).orderBy(desc(contracts.updatedAt));
  const map = new Map<string, { id: string; status: string }>();
  for (const r of rows) if (r.dealId && !map.has(r.dealId)) map.set(r.dealId, { id: r.id, status: r.status });
  return map;
}

/** Signed value by engagement, and paid vs outstanding milestones, for Reports and Home. */
export async function contractTotals(scope: Scope) {
  const byEngagement = await appDb().select({
    engagement: contracts.engagement, signed: sql<number>`count(*)`, value: sql<number>`coalesce(sum(${contracts.value}), 0)`,
  }).from(contracts).where(and(mandateCondition(scope, contracts.mandateId), inArray(contracts.status, ["signed", "completed"]))).groupBy(contracts.engagement);
  const [money] = await appDb().select({
    paid: sql<number>`coalesce(sum(case when ${contractMilestones.status} = 'paid' then ${contractMilestones.amount} end), 0)`,
    outstanding: sql<number>`coalesce(sum(case when ${contractMilestones.status} in ('pending', 'invoiced') then ${contractMilestones.amount} end), 0)`,
  }).from(contractMilestones).where(mandateCondition(scope, contractMilestones.mandateId));
  const [counts] = await appDb().select({
    drafts: sql<number>`sum(case when ${contracts.status} = 'draft' then 1 else 0 end)`,
    sent: sql<number>`sum(case when ${contracts.status} = 'sent' then 1 else 0 end)`,
    signed: sql<number>`sum(case when ${contracts.status} = 'signed' then 1 else 0 end)`,
  }).from(contracts).where(mandateCondition(scope, contracts.mandateId));
  return { byEngagement, paid: money?.paid ?? 0, outstanding: money?.outstanding ?? 0, drafts: counts?.drafts ?? 0, sent: counts?.sent ?? 0, signed: counts?.signed ?? 0 };
}
