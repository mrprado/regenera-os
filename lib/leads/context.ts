// Phase 27: the record a lead search is made for, read within the user's scope, and the searches attached to it.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalOpportunities, debtSecurities, fundingApplications, organizations, originationItems, projectParties, projects, savedSearches, searchResults } from "@/db/schema";
import { mandateCondition, type Scope } from "@/lib/db/scoped";
import { countryName } from "@/lib/scan/countries";
import { buildLeadQuery, leadSectorFor, WORKFLOWS_FOR, type LeadInstrument, type LeadQueryInput, type LeadSector, type LeadWorkflow } from "./matrix";

export const LEAD_ENTITY_TYPES = ["project", "capital_need", "bond", "funding_application", "queue_item", "general"] as const;
export type LeadEntityType = (typeof LEAD_ENTITY_TYPES)[number];

export type LeadContext = {
  type: LeadEntityType; id: string; mandateId: string; title: string; href: string;
  sector: LeadSector | null; country: string | null; instrument: LeadInstrument | null; organization: string | null;
  workflows: LeadWorkflow[];
};

async function projectBits(db: Db, projectId: string | null) {
  if (!projectId) return { sector: null, country: null, sponsor: null as string | null };
  const [p] = await db.select({ sector: projects.sector, country: projects.country }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const [s] = await db.select({ name: organizations.name }).from(projectParties).innerJoin(organizations, eq(organizations.id, projectParties.orgId))
    .where(and(eq(projectParties.projectId, projectId), eq(projectParties.role, "sponsor"))).limit(1);
  return { sector: leadSectorFor(p?.sector), country: p?.country ? countryName(p.country) : null, sponsor: s?.name ?? null };
}
const instrumentFor = (s: string | null | undefined): LeadInstrument | null => {
  const t = (s ?? "").toLowerCase();
  return /bond|note/.test(t) ? "bond" : /grant/.test(t) ? "grant" : /guarantee|concession|blended|first.?loss/.test(t) ? "blended" : /debt|loan|senior|mezz/.test(t) ? "debt" : /equity/.test(t) ? "equity" : null;
};

/** The record and what to search for it, or null when the user may not open it. */
export async function leadContext(db: Db, scope: Scope, type: LeadEntityType, id: string): Promise<LeadContext | null> {
  const base = { type, id, workflows: WORKFLOWS_FOR[type] };
  switch (type) {
    // Not tied to a record: any workflow, searched in the user's first workspace. id is the user's workspace.
    case "general": {
      if (scope.kind === "user" && !scope.mandateIds.includes(id)) return null;
      return { ...base, mandateId: id, title: "general search", href: "/prospecting", sector: null, country: null, instrument: null, organization: null };
    }
    case "project": {
      const [p] = await db.select({ name: projects.name, mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId))).limit(1);
      if (!p) return null;
      const b = await projectBits(db, id);
      return { ...base, mandateId: p.mandateId, title: p.name, href: `/projects/${id}?tab=stakeholders`, sector: b.sector, country: b.country, instrument: null, organization: b.sponsor };
    }
    case "capital_need": {
      const [c] = await db.select({ title: capitalOpportunities.title, mandateId: capitalOpportunities.mandateId, projectId: capitalOpportunities.projectId, instrument: capitalOpportunities.instrument }).from(capitalOpportunities).where(and(eq(capitalOpportunities.id, id), mandateCondition(scope, capitalOpportunities.mandateId))).limit(1);
      if (!c) return null;
      const b = await projectBits(db, c.projectId);
      return { ...base, mandateId: c.mandateId, title: c.title, href: `/capital/opportunities/${id}`, sector: b.sector, country: b.country, instrument: instrumentFor(c.instrument), organization: null };
    }
    case "bond": {
      const [d] = await db.select({ program: debtSecurities.program, mandateId: debtSecurities.mandateId, projectId: debtSecurities.projectId, instrument: debtSecurities.instrument }).from(debtSecurities).where(and(eq(debtSecurities.id, id), mandateCondition(scope, debtSecurities.mandateId))).limit(1);
      if (!d) return null;
      const b = await projectBits(db, d.projectId);
      return { ...base, mandateId: d.mandateId, title: d.program, href: "/capital?tab=bonds", sector: b.sector, country: b.country, instrument: "bond", organization: null };
    }
    case "funding_application": {
      const [a] = await db.select({ name: fundingApplications.name, mandateId: fundingApplications.mandateId, projectId: fundingApplications.projectId }).from(fundingApplications).where(and(eq(fundingApplications.id, id), mandateCondition(scope, fundingApplications.mandateId))).limit(1);
      if (!a) return null;
      const b = await projectBits(db, a.projectId);
      return { ...base, mandateId: a.mandateId, title: a.name, href: `/funding/applications/${id}`, sector: b.sector, country: b.country, instrument: "grant", organization: null };
    }
    case "queue_item": {
      const [q] = await db.select({ title: originationItems.title, mandateId: originationItems.mandateId, projectId: originationItems.projectId }).from(originationItems).where(and(eq(originationItems.id, id), mandateCondition(scope, originationItems.mandateId))).limit(1);
      if (!q) return null;
      const b = await projectBits(db, q.projectId);
      return { ...base, mandateId: q.mandateId, title: q.title, href: "/origination", sector: b.sector, country: b.country, instrument: null, organization: b.sponsor };
    }
  }
}

export const leadSearchKey = (ctx: LeadContext, i: LeadQueryInput) => `lead:${ctx.type}:${ctx.id}:${i.workflow}:${i.sector ?? "-"}:${i.instrument ?? "-"}:${i.country ?? "-"}:${i.organization ?? "-"}`.slice(0, 300);

/** Saves (or reuses) the Apollo people search for this record and need. It is manual: never on the weekly schedule. */
export async function saveLeadSearch(db: Db, ctx: LeadContext, input: LeadQueryInput, actor: string) {
  const query = buildLeadQuery(input);
  const key = leadSearchKey(ctx, input);
  const [row] = await db.insert(savedSearches).values({
    mandateId: ctx.mandateId, key, name: `${query.label}: ${ctx.title}`.slice(0, 200), kind: "apollo_people", params: query.apollo as Record<string, unknown>,
    query: query.peopleBoolean, region: input.country ?? null, enabled: false, createdBy: actor, cadence: "weekly:mon:06:00",
    entityType: ctx.type, entityId: ctx.id, workflow: input.workflow, sector: input.sector ?? null,
  }).onConflictDoUpdate({ target: [savedSearches.mandateId, savedSearches.key], set: { params: query.apollo as Record<string, unknown>, query: query.peopleBoolean, updatedAt: new Date().toISOString() } }).returning({ id: savedSearches.id });
  return row.id;
}

/** New suggestions for a record, newest search first. */
export async function leadSuggestions(db: Db, scope: Scope, type: LeadEntityType, id: string) {
  return db.select({ r: searchResults, search: savedSearches.name, workflow: savedSearches.workflow }).from(searchResults)
    .innerJoin(savedSearches, eq(savedSearches.id, searchResults.savedSearchId))
    .where(and(eq(savedSearches.entityType, type), eq(savedSearches.entityId, id), eq(searchResults.status, "new"), mandateCondition(scope, searchResults.mandateId)))
    .orderBy(desc(searchResults.foundAt)).limit(100);
}
