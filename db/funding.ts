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
    proposal?: { sections: { heading: string; body: string }[]; gaps: string[]; draftedAt: string; styleFlags: string[] } }>(),
  readAt: text("read_at"),
  decision: text("decision", { enum: FUNDING_DECISIONS }).notNull().default("new"),
  dismissReason: text("dismiss_reason"),
  dealId: text("deal_id"),
  funderOrgId: text("funder_org_id"),
  lat: real("lat"),
  lng: real("lng"),
  queryKey: text("query_key"),
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
  kind: text("kind", { enum: ["profile", "methodology", "cv", "past_performance", "other"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  caseRecordId: text("case_record_id"),
  ...timestamps,
});
