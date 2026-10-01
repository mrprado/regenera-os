// Connected commercial workflow (docs/plans/phase-15-command-scans.md, part B): PARTY PROFILE → OBJECTIVE → DISCOVERY →
// QUALIFICATION → MATCHING → DOCUMENT → APPROVAL → EXECUTION. Profiles extend organizations (one record, several roles);
// objectives drive scans; account coverage, commercial qualification, attribution, effort and relationship reviews
// connect discovery to revenue. Every value carries its basis (verified / stated / provider / inferred / unknown).
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const obj = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'{}'`);
const arr = <T>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const BASES = ["verified", "stated", "provider", "inferred", "unknown"] as const;
export type Basis = (typeof BASES)[number];
export type ProfileValue = { value: string; basis: Basis; source?: string; at: string; by: string };
export type Entry = { text: string; evidence: string; by: string; at: string };

/** Role-specific profile of an organization (EPC, developer, capital provider, landowner, public body, adviser…). */
export const partyProfiles = sqliteTable("party_profiles", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  role: text("role").notNull(),                                     // PROFILE_ROLES
  fields: obj<Record<string, ProfileValue>>("fields"),
  coverage: arr<string>("coverage"),                                // actual operating coverage (ISO3), never the HQ alone
  coverageBasis: text("coverage_basis").notNull().default("unknown"),
  owner: text("owner"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, t => [uniqueIndex("party_profiles_org_role").on(t.mandateId, t.orgId, t.role)]);

export const OBJECTIVE_KINDS = {
  find_contracts: "Find contracts / projects to deliver (EPC, specialist)",
  find_delivery_partners: "Find delivery partners for a project",
  find_projects: "Find projects that fit an investment mandate",
  find_capital: "Find capital for a project",
  find_clients: "Find paying clients (Regenera business development)",
  find_funding: "Find funding calls for an applicant",
  development_options: "Assess development options for land",
  referral: "Find referral or joint-delivery opportunities",
} as const;
export type ObjectiveKind = keyof typeof OBJECTIVE_KINDS;

/** A specific outcome a party (or Regenera) wants; the center of scans, matching and documents. */
export const objectives = sqliteTable("objectives", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),                                            // the party; null = Regenera's own objective
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  owner: text("owner"),
  beneficiary: text("beneficiary").notNull().default(""),
  desiredOutcome: text("desired_outcome").notNull().default(""),
  targetAudience: text("target_audience"),                          // AUDIENCES key for organization scans
  offerKey: text("offer_key"),                                      // OFFERS key (audience-to-offer catalogue)
  geography: arr<string>("geography"),
  sector: text("sector"),
  capabilities: arr<string>("capabilities"),                        // technical criteria (technologies, scope)
  commercial: arr<string>("commercial"),                            // commercial criteria and preferences
  sizeMin: real("size_min"), sizeMax: real("size_max"), sizeUnit: text("size_unit"),  // MW, USD, ha…
  stages: arr<string>("stages"),
  timing: text("timing").notNull().default(""),
  exclusions: arr<string>("exclusions"),
  requiredEvidence: text("required_evidence").notNull().default(""),
  deliverable: text("deliverable").notNull().default(""),
  successMeasure: text("success_measure").notNull().default(""),
  status: text("status", { enum: ["draft", "active", "paused", "done"] }).notNull().default("draft"),
  source: text("source").notNull().default(""),                     // where the criteria came from (meeting, email, document)
  reviewStatus: text("review_status", { enum: ["unreviewed", "reviewed"] }).notNull().default("unreviewed"),
  dealId: text("deal_id"), projectId: text("project_id"), commercialMandateId: text("commercial_mandate_id"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("objectives_mandate_org").on(t.mandateId, t.orgId), index("objectives_status").on(t.mandateId, t.status)]);

export const COVERAGE_ROLES = {
  economic_buyer: "Economic buyer", champion: "Internal champion", technical_reviewer: "Technical reviewer",
  procurement: "Procurement / legal reviewer", introducer: "Introducer",
} as const;

/** Who covers each buying role at an account. Unknown stays unknown (contactId null). */
export const accountCoverage = sqliteTable("account_coverage", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  role: text("role").notNull(),
  contactId: text("contact_id"),
  relationshipOwner: text("relationship_owner"),
  lastInteractionAt: text("last_interaction_at"),
  nextAction: text("next_action").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  ...timestamps,
}, t => [uniqueIndex("account_coverage_org_role").on(t.mandateId, t.orgId, t.role)]);

export const QUALIFICATION_FIELDS = {
  need: "Actual need", decision: "Decision or project", buyer: "Buyer", decisionProcess: "Decision process", budgetPath: "Budget or funding path",
  timing: "Timing", alternatives: "Alternatives / competition", offer: "Regenera's relevant offer", agreedNextStep: "Mutually agreed next step", feeBasis: "Expected fee basis",
} as const;
export type QualificationField = keyof typeof QUALIFICATION_FIELDS;

/** Commercial qualification of an opportunity: evidence per field, then a person's explicit decision. */
export const opportunityQualifications = sqliteTable("opportunity_qualifications", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  dealId: text("deal_id").notNull(),
  fields: obj<Partial<Record<QualificationField, Entry>>>("fields"),
  offerKey: text("offer_key"),
  decision: text("decision", { enum: ["open", "qualified", "not_qualified"] }).notNull().default("open"),
  decidedBy: text("decided_by"), decidedAt: text("decided_at"), reason: text("reason"),
  history: arr<{ at: string; by: string; change: string }>("history"),
  ...timestamps,
}, t => [uniqueIndex("opportunity_qualifications_deal").on(t.mandateId, t.dealId)]);

export const ATTRIBUTION_CHANNELS = { scan: "Scan", campaign: "Campaign / sequence", referral: "Referral / introducer", inbound: "Inbound (site or email)", event: "Event", signal: "Signal / trigger", import: "Import", manual: "Recorded by hand" } as const;

/** Source attribution: the first row per record is its original source; later rows are influence (kept separate). */
export const attributions = sqliteTable("attributions", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type", { enum: ["organization", "contact", "deal"] }).notNull(),
  entityId: text("entity_id").notNull(),
  kind: text("kind", { enum: ["original", "influence"] }).notNull(),
  channel: text("channel").notNull(),
  campaign: text("campaign"),                                      // preset / campaign key or name
  scanRunId: text("scan_run_id"),
  introducerOrgId: text("introducer_org_id"), introducerContactId: text("introducer_contact_id"),
  note: text("note").notNull().default(""),
  at: text("at").notNull().default(now),
  by: text("by").notNull(),
}, t => [index("attributions_entity").on(t.mandateId, t.entityType, t.entityId), index("attributions_campaign").on(t.mandateId, t.campaign)]);

/** Founder and team effort per campaign or opportunity (minutes), for campaign economics. */
export const effortEntries = sqliteTable("effort_entries", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  campaign: text("campaign"),
  dealId: text("deal_id"),
  minutes: integer("minutes").notNull(),
  on: text("on").notNull(),
  note: text("note").notNull().default(""),
  by: text("by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("effort_entries_campaign").on(t.mandateId, t.campaign)]);

export const REVIEW_KINDS = { competing_mandate: "Competing mandate", existing_client: "Existing client or engagement", referral_claim: "Referral or introducer claim", exclusion: "Exclusion / do-not-contact", ownership: "Relationship ownership", other: "Other" } as const;

/** Conflicts and relationship questions that need a person's decision; never a legal conclusion. */
export const relationshipReviews = sqliteTable("relationship_reviews", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
  status: text("status", { enum: ["open", "cleared", "blocked"] }).notNull().default("open"),
  origin: text("origin", { enum: ["auto", "manual"] }).notNull().default("manual"),
  raisedBy: text("raised_by").notNull(),
  decidedBy: text("decided_by"), decidedAt: text("decided_at"), reason: text("reason"),
  ...timestamps,
}, t => [index("relationship_reviews_org").on(t.mandateId, t.orgId, t.status)]);

/** Reviewed meeting notes; proposed changes go to the proposals table and apply only when a person confirms. */
export const meetingNotes = sqliteTable("meeting_notes", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"), dealId: text("deal_id"), briefId: text("brief_id"),
  title: text("title").notNull(),
  heldOn: text("held_on").notNull(),
  participants: text("participants").notNull().default(""),
  notes: text("notes").notNull(),
  status: text("status", { enum: ["draft", "reviewed"] }).notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("meeting_notes_org").on(t.mandateId, t.orgId), index("meeting_notes_deal").on(t.mandateId, t.dealId)]);
