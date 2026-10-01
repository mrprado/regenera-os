// Phase 5 part A (docs/plans/phase-5.md): funding opportunities (grants, calls, tenders), applicant matches, bid library.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const FUNDING_SOURCES = ["grants_gov", "eu_funding", "ted", "worldbank", "uk_contracts"] as const;
export const FUNDING_TYPES = ["grant", "tender", "call", "prize", "concessional"] as const;
export const FUNDING_ROUTES = ["regenera_bid", "client_support", "consortium", "signal"] as const;
export const FUNDING_DECISIONS = ["new", "watching", "bidding", "matched", "dismissed"] as const;

/** Structured call data (§4). Every field is optional: unknown stays unknown. */
export type FundingDetails = {
  eligibility?: { orgTypes?: string[]; geography?: string; sectors?: string[]; maturity?: string; registrations?: string[]; certifications?: string[]; notes?: string };
  objectives?: { priorities?: string[]; scoring?: string[]; outcomes?: string[]; kpis?: string[]; targetPopulation?: string; esObjectives?: string };
  application?: { format?: string; pageLimits?: string; attachments?: string[]; forms?: string[]; budget?: string; partnerDocs?: string[]; letters?: string[]; compliance?: string[] };
  requiredPartners?: string[];
};
/** §6 Ideal applicant profile. `basis` says whether it was read from the call text or inferred from metadata. */
export type ApplicantProfile = {
  entityClasses: string[]; geography: string; sectors: string[]; capabilities: string[]; projectTypes: string[]; minCapacity: string; maturity: string;
  requiredPartners: string[]; evidence: string[]; matchCapacity: string; compliance: string[]; decisionMakerTitles: string[];
  basis: "call_text" | "inferred"; generatedBy: string; generatedAt: string; reviewedBy?: string | null;
};

export const fundingOpportunities = sqliteTable("funding_opportunities", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  source: text("source", { enum: FUNDING_SOURCES }).notNull(),
  externalId: text("external_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),          // normalized title + deadline: the same call listed by two sources
  title: text("title").notNull(),
  funder: text("funder"),
  programme: text("programme"),
  type: text("type", { enum: FUNDING_TYPES }).notNull(),
  amountMin: real("amount_min"),
  amountMax: real("amount_max"),
  currency: text("currency"),
  cofinancingPct: integer("cofinancing_pct"),
  openDate: text("open_date"),
  deadline: text("deadline"),                        // YYYY-MM-DD, next deadline
  countries: text("countries", { mode: "json" }).$type<string[]>(),
  applicantTypes: text("applicant_types", { mode: "json" }).$type<string[]>(),
  sectors: text("sectors", { mode: "json" }).$type<string[]>(),
  url: text("url").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["forthcoming", "open", "closed"] }).notNull().default("open"),
  fit: integer("fit"),                               // Claude's 0-100 fit to Regenera's services
  route: text("route", { enum: FUNDING_ROUTES }),
  read: text("read", { mode: "json" }).$type<{ summary?: string; caveats?: string[]; consortium?: boolean; why?: string;
    proposal?: { sections: { heading: string; body: string; basis?: string }[]; gaps: string[]; draftedAt: string; styleFlags: string[] } }>(),
  readAt: text("read_at"),
  decision: text("decision", { enum: FUNDING_DECISIONS }).notNull().default("new"),
  dismissReason: text("dismiss_reason"),
  dealId: text("deal_id"),
  funderOrgId: text("funder_org_id"),
  lat: real("lat"),
  lng: real("lng"),
  queryKey: text("query_key"),
  // Phase 11: classification, structured call data, provenance and Regenera ownership.
  kind: text("kind"),                                  // FUNDING_KINDS; null = derived from type until classified
  opportunityCode: text("opportunity_code"),
  rolling: integer("rolling", { mode: "boolean" }).notNull().default(false),
  awardPeriod: text("award_period"),
  programSize: real("program_size"),
  expectedAward: real("expected_award"),
  numberAwards: integer("number_awards"),
  matchRequirement: text("match_requirement"),
  reimbursement: text("reimbursement"),
  eligibleCosts: text("eligible_costs"),
  prohibitedCosts: text("prohibited_costs"),
  details: text("details", { mode: "json" }).$type<FundingDetails>().notNull().default(sql`'{}'`),
  applicantProfile: text("applicant_profile", { mode: "json" }).$type<ApplicantProfile | null>(),
  owner: text("owner"),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  projectId: text("project_id"),
  territory: text("territory"),
  retrievedAt: text("retrieved_at"),
  verifiedBy: text("verified_by"),
  verifiedAt: text("verified_at"),
  extractionConfidence: text("extraction_confidence"),  // high | medium | low: how well parsed fields match the call text
  ...timestamps,
}, t => [
  uniqueIndex("funding_source_external").on(t.mandateId, t.source, t.externalId),
  index("funding_dedupe").on(t.mandateId, t.dedupeKey),
  index("funding_deadline").on(t.mandateId, t.status, t.deadline),
]);

/** Organizations in the CRM that look eligible to apply (for "Find applicants"). */
export const fundingMatches = sqliteTable("funding_matches", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id"),            // physical project this row is about (phase 6)
  reason: text("reason").notNull(),
  status: text("status", { enum: ["suggested", "contacted", "dismissed"] }).notNull().default("suggested"),
  ...timestamps,
}, t => [uniqueIndex("funding_matches_pair").on(t.opportunityId, t.orgId)]);

/** Reusable proposal blocks. Past performance links to a case record whose disclosure is authorized. */
export const bidLibrary = sqliteTable("bid_library", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind", { enum: ["profile", "methodology", "cv", "past_performance", "other", "narrative", "boilerplate", "project", "impact", "mande", "risk", "budgeting", "prior_response", "study"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  caseRecordId: text("case_record_id"),
  // §23 tags and approval: only approved blocks are offered to drafting.
  sectors: text("sectors", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  funder: text("funder"),
  program: text("program"),
  geography: text("geography"),
  clientOrgId: text("client_org_id"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(true),
  approvedBy: text("approved_by"),
  owner: text("owner"),
  ...timestamps,
});
