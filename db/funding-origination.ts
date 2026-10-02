// Funding origination (docs/plans/phase-11-funding-origination.md): applicant prospects, funding readiness,
// bid / no-bid reviews, applications with consortium and workplan, awards, funders, calendar dates, the delivery team
// (people, cost rates, allocations), the specialist bench, practice scenarios and expansion opportunities.
// Organizations, contacts, engagements, projects and capital structures are not duplicated: rows link to them.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const arr = <T = string>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const obj = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'{}'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type Cell = { status: string; note: string; source: string };

/** An organization considered as an applicant (or partner) for one opportunity. Links to the CRM; never a copy. */
export const fundingProspects = sqliteTable("funding_prospects", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  orgId: text("org_id").notNull(),
  origin: text("origin", { enum: ["crm", "external"] }).notNull().default("crm"),
  mode: text("mode", { enum: ["funding_first", "client_first", "stack_first"] }).notNull().default("funding_first"),
  stage: text("stage").notNull().default("target"),                         // PROSPECT_STAGES
  eligibility: text("eligibility").notNull().default("uncertain"),          // APPLICANT_ELIGIBILITY
  eligibilityBasis: text("eligibility_basis").notNull().default(""),        // the evidence (call clause, funder answer)
  sectorFit: text("sector_fit").notNull().default(""),
  rationale: text("rationale").notNull().default(""),
  missing: arr("missing"),
  source: text("source").notNull().default(""),                             // where the prospect was found
  sourceUrl: text("source_url"),
  decisionMakerId: text("decision_maker_id"),                               // contact
  owner: text("owner"),
  projectId: text("project_id"),
  engagementId: text("engagement_id"),
  researchBrief: text("research_brief").notNull().default(""),
  followUpDate: text("follow_up_date"),
  lostReason: text("lost_reason"),
  ...timestamps,
}, t => [uniqueIndex("funding_prospects_pair").on(t.opportunityId, t.orgId), index("funding_prospects_stage").on(t.mandateId, t.stage)]);

/** §11 Funding readiness: one categorical cell per dimension, each with its note and source. */
export const fundingReadiness = sqliteTable("funding_readiness", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  orgId: text("org_id"),
  projectId: text("project_id"),
  prospectId: text("prospect_id"),
  cells: obj<Record<string, Cell>>("cells"),
  assessedBy: text("assessed_by"),
  ...timestamps,
}, t => [index("funding_readiness_opp").on(t.opportunityId)]);

/** §12, §69 Bid / no-bid with the economics made explicit before effort is committed. */
export const bidReviews = sqliteTable("bid_reviews", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  prospectId: text("prospect_id"),
  applicantOrgId: text("applicant_org_id"),
  strategicFit: text("strategic_fit").notNull().default(""),
  eligibility: text("eligibility").notNull().default("uncertain"),
  readinessSummary: text("readiness_summary").notNull().default(""),
  deadline: text("deadline"),
  hours: real("hours").notNull().default(0),
  specialists: arr("specialists"),
  currency: text("currency").notNull().default("USD"),
  fee: real("fee").notNull().default(0),
  feeBasis: text("fee_basis").notNull().default("fixed"),                  // FEE_BASES
  deliveryCost: real("delivery_cost").notNull().default(0),
  costLines: arr<{ role: string; person?: string; hours: number; rate: number }>("cost_lines"),
  relationshipValue: text("relationship_value").notNull().default(""),
  crossSell: text("cross_sell").notNull().default(""),
  risks: text("risks").notNull().default(""),
  opportunityCost: text("opportunity_cost").notNull().default(""),
  decision: text("decision"),                                              // BID_DECISIONS; null = pending
  conditions: text("conditions").notNull().default(""),
  decidedBy: text("decided_by"),
  decidedAt: text("decided_at"),
  seniorApprovalRequired: integer("senior_approval_required", { mode: "boolean" }).notNull().default(false),
  approvedBy: text("approved_by"),
  ...timestamps,
}, t => [index("bid_reviews_opp").on(t.opportunityId)]);

export type Submission = { at?: string; portal?: string; confirmationId?: string; submittedBy?: string; finalVersion?: string; attachments?: string[]; acknowledgment?: string; expectedAwardDate?: string };
export type TeamSlot = { role: string; person: string };

/** §20 An application (bid) workspace. The lead applicant may be a client or Regenera itself. */
export const fundingApplications = sqliteTable("funding_applications", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  name: text("name").notNull(),
  leadOrgId: text("lead_org_id"),
  projectId: text("project_id"),
  engagementId: text("engagement_id"),
  dealId: text("deal_id"),
  bidReviewId: text("bid_review_id"),
  state: text("state").notNull().default("first_draft"),                    // APPLICATION_STATES
  owner: text("owner"),
  team: arr<TeamSlot>("team"),
  requestedAmount: real("requested_amount"),
  currency: text("currency").notNull().default("USD"),
  matchAmount: real("match_amount"),
  scoring: arr<{ criterion: string; weight: string; response: string; evidence: string }>("scoring"),
  compliance: arr<{ item: string; status: string; note: string }>("compliance"),
  narrative: arr<{ heading: string; body: string; basis: string }>("narrative"),
  budgetLines: arr<{ label: string; amount: number; category: string; match: boolean }>("budget_lines"),
  reviewLog: arr<{ state: string; by: string; at: string; note: string }>("review_log"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  submission: obj<Submission>("submission"),
  internalDeadline: text("internal_deadline"),
  ...timestamps,
}, t => [index("funding_applications_opp").on(t.opportunityId), index("funding_applications_state").on(t.mandateId, t.state)]);

/** §18 Consortium members. */
export const consortiumMembers = sqliteTable("consortium_members", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  applicationId: text("application_id").notNull(),
  orgId: text("org_id"),
  name: text("name").notNull(),
  role: text("role").notNull().default("partner"),                         // CONSORTIUM_ROLES
  eligibility: text("eligibility").notNull().default("uncertain"),
  capability: text("capability").notNull().default(""),
  contribution: text("contribution").notNull().default(""),
  budget: real("budget"),
  documents: arr("documents"),
  status: text("status").notNull().default("prospective"),                  // CONSORTIUM_STATUSES
  contactId: text("contact_id"),
  owner: text("owner"),
  ...timestamps,
}, t => [index("consortium_members_app").on(t.applicationId)]);

/** §21 Workplan items with owners, dependencies and hours. */
export const applicationTasks = sqliteTable("application_tasks", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  applicationId: text("application_id").notNull(),
  tab: text("tab").notNull().default("overview"),
  title: text("title").notNull(),
  role: text("role"),
  owner: text("owner"),
  reviewer: text("reviewer"),
  due: text("due"),
  dependsOn: text("depends_on"),
  status: text("status").notNull().default("todo"),
  hoursBudget: real("hours_budget").notNull().default(0),
  hoursActual: real("hours_actual").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, t => [index("application_tasks_app").on(t.applicationId)]);

/** §26–27 Award, then post-award program management in a linked engagement / workstream. */
export const fundingAwards = sqliteTable("funding_awards", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  applicationId: text("application_id").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  agreementRef: text("agreement_ref").notNull().default(""),
  periodStart: text("period_start"), periodEnd: text("period_end"),
  reporting: arr<{ label: string; due: string | null; done: boolean }>("reporting"),
  milestones: arr<{ label: string; due: string | null; done: boolean }>("milestones"),
  kpis: arr<{ label: string; target: string; actual: string }>("kpis"),
  payments: arr<{ label: string; amount: number; due: string | null; received: boolean }>("payments"),
  conditions: text("conditions").notNull().default(""),
  cofinance: text("cofinance").notNull().default(""),
  compliance: text("compliance").notNull().default(""),
  postAwardEngagementId: text("post_award_engagement_id"),
  pathwayId: text("pathway_id"),                                              // capital-stack link (funding_pathways)
  ...timestamps,
}, t => [uniqueIndex("funding_awards_app").on(t.applicationId)]);

/** §59 Funder entities (a funder may also be a CRM organization). */
export const funders = sqliteTable("funders", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("other"),                             // FUNDER_TYPES
  orgId: text("org_id"),
  programs: arr("programs"), sectors: arr("sectors"), geography: arr("geography"), applicantTypes: arr("applicant_types"),
  typicalAward: text("typical_award").notNull().default(""),
  history: text("history").notNull().default(""),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [uniqueIndex("funders_name").on(t.mandateId, t.name)]);

/** §60 Dates beyond the deadline, funder or internal. */
export const fundingDates = sqliteTable("funding_dates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id"),
  applicationId: text("application_id"),
  awardId: text("award_id"),
  kind: text("kind").notNull(),                                                // CALENDAR_KINDS
  date: text("date").notNull(),
  label: text("label").notNull().default(""),
  internal: integer("internal", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [index("funding_dates_date").on(t.mandateId, t.date)]);

/** §17 An organization's registrations and compliance items. */
export const orgRegistrations = sqliteTable("org_registrations", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),                                                // REGISTRATIONS
  status: text("status", { enum: ["unknown", "missing", "in_progress", "active", "expired"] }).notNull().default("unknown"),
  reference: text("reference").notNull().default(""),                          // e.g. UEI (never a secret)
  expires: text("expires"),
  evidence: text("evidence").notNull().default(""),
  ...timestamps,
}, t => [uniqueIndex("org_registrations_kind").on(t.orgId, t.kind)]);

/** §37, §40 Delivery people: cost rates and capacity. Internal; never shown in portals. */
export const teamMembers = sqliteTable("team_members", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull().default("analyst"),                             // TEAM_ROLES
  employment: text("employment").notNull().default("contractor"),              // EMPLOYMENT
  costRate: real("cost_rate"),                                                  // per hour, loaded
  currency: text("currency").notNull().default("USD"),
  salary: real("salary"),                                                       // annual, for the staffing model
  weeklyHours: real("weekly_hours").notNull().default(40),
  utilizationTarget: real("utilization_target").notNull().default(75),         // %
  leave: arr<{ from: string; to: string; note: string }>("leave"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, t => [index("team_members_mandate").on(t.mandateId)]);

/** Planned hours for one person in one week (ISO Monday). */
export const allocations = sqliteTable("allocations", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  memberId: text("member_id").notNull(),
  weekStart: text("week_start").notNull(),
  hours: real("hours").notNull(),
  kind: text("kind", { enum: ["client", "internal", "leave"] }).notNull().default("client"),
  engagementId: text("engagement_id"),
  applicationId: text("application_id"),
  note: text("note").notNull().default(""),
  ...timestamps,
}, t => [index("allocations_week").on(t.mandateId, t.weekStart), index("allocations_member").on(t.memberId)]);

/** §38 The specialist bench. Ratings and notes are internal only. */
export const specialists = sqliteTable("specialists", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  expertise: arr("expertise"),                                                 // SPECIALIST_BENCH keys
  sectors: arr("sectors"), subSectors: arr("sub_sectors"), geographies: arr("geographies"), countries: arr("countries"), languages: arr("languages"),
  credentials: text("credentials").notNull().default(""),
  hourlyRate: real("hourly_rate"), dayRate: real("day_rate"),
  currency: text("currency").notNull().default("USD"),
  availability: text("availability").notNull().default(""),
  ndaStatus: text("nda_status").notNull().default("none"),
  conflictStatus: text("conflict_status").notNull().default("unchecked"),
  priorEngagements: arr("prior_engagements"),
  performanceNotes: text("performance_notes").notNull().default(""),         // INTERNAL
  rating: integer("rating"),                                                    // INTERNAL, 1–5
  engagementModel: text("engagement_model").notNull().default(""),
  source: text("source").notNull().default("other"),                          // SPECIALIST_SOURCES
  sourceNote: text("source_note").notNull().default(""),
  ...timestamps,
}, t => [index("specialists_mandate").on(t.mandateId)]);

/** §36, §49–51 Practice scenario planner. Illustrative unless a person designates it a forecast. */
export const practiceScenarios = sqliteTable("practice_scenarios", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  tier: text("tier", { enum: ["lean", "base", "scale", "custom"] }).notNull().default("custom"),
  inputs: obj<Record<string, number>>("inputs"),
  illustrative: integer("illustrative", { mode: "boolean" }).notNull().default(true),
  designatedBy: text("designated_by"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
});

/** §29 Relevant further needs of a client, validated before anything is pitched. */
export const expansionOpportunities = sqliteTable("expansion_opportunities", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  engagementId: text("engagement_id"),
  applicationId: text("application_id"),
  kind: text("kind").notNull(),                                                // EXPANSION_KINDS
  relevance: text("relevance").notNull(),                                      // why it is relevant (required)
  estimatedValue: real("estimated_value"),
  status: text("status").notNull().default("identified"),
  owner: text("owner"),
  ...timestamps,
}, t => [index("expansion_org").on(t.orgId)]);
