// Capital relationships (docs/plans/phase-6.md M2). Private investor data (private_capital_profiles,
// investor_qualifications) is owner-only in the app and never exposed to Ask the OS or MCP.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  APPETITE, CAPITAL_TYPES, COMMITMENT_STAGES, ELIGIBILITY, GATE_STATES, INTRO_STATUSES, INVESTOR_JOURNEY, MATCH_STATUSES,
  QUALIFICATION_STATUSES, RELATIONSHIP_STRENGTH,
} from "../lib/capital/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };
const list = (name: string) => text(name, { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`);

/** Criteria shared by capital profiles, investor mandates and private profiles. Empty list = not known (not "any"). */
const criteria = () => ({
  geographies: list("geographies"),      // country names/ISO3, regions, or "global"
  sectors: list("sectors"),              // lib/vocab SECTORS keys
  stages: list("stages"),                // project stage keys
  instruments: list("instruments"),      // lib/projects/vocab INSTRUMENTS keys
  ticketMin: real("ticket_min"),
  ticketMax: real("ticket_max"),
  currency: text("currency"),
});

export const capitalProfiles = sqliteTable("capital_profiles", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),
  contactId: text("contact_id"),
  name: text("name").notNull(),
  capitalType: text("capital_type", { enum: keys(CAPITAL_TYPES) }).notNull(),
  ...criteria(),
  technologies: list("technologies"),
  risk: text("risk").notNull().default(""),
  returnTarget: text("return_target").notNull().default(""),
  tenor: text("tenor").notNull().default(""),
  impact: text("impact").notNull().default(""),
  esRequirements: text("es_requirements").notNull().default(""),   // lender/investor standards (IFC PS, Equator …)
  localContent: text("local_content").notNull().default(""),
  relationshipOwner: text("relationship_owner"),
  relationshipStrength: text("relationship_strength", { enum: keys(RELATIONSHIP_STRENGTH) }).notNull().default("unknown"),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  source: text("source").notNull().default(""),
  lastVerifiedAt: text("last_verified_at"),
  notes: text("notes").notNull().default(""),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [index("capital_profiles_mandate").on(t.mandateId, t.capitalType), index("capital_profiles_org").on(t.orgId)]);

/** An investor's own mandate (what they invest in). Distinct from Regenera's entities (`mandates`). */
export const capitalMandates = sqliteTable("capital_mandates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  profileId: text("profile_id").notNull().references(() => capitalProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...criteria(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  source: text("source").notNull().default(""),
  lastVerifiedAt: text("last_verified_at"),
  ...timestamps,
}, t => [index("capital_mandates_profile").on(t.profileId)]);

export const privateCapitalProfiles = sqliteTable("private_capital_profiles", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  contactId: text("contact_id").notNull(),
  vehicleOrgId: text("vehicle_org_id"),
  familyOfficeOrgId: text("family_office_org_id"),
  relationshipOwner: text("relationship_owner"),
  relationshipSource: text("relationship_source").notNull().default(""),
  relationshipStrength: text("relationship_strength", { enum: keys(RELATIONSHIP_STRENGTH) }).notNull().default("unknown"),
  introducerContactId: text("introducer_contact_id"),
  primaryJurisdiction: text("primary_jurisdiction"),
  vehicleJurisdiction: text("vehicle_jurisdiction"),
  preferredChannel: text("preferred_channel"),
  ...criteria(),
  assetClasses: list("asset_classes"),
  horizon: text("horizon").notNull().default(""),
  incomePreference: text("income_preference", { enum: keys(APPETITE) }).notNull().default("unknown"),
  growthPreference: text("growth_preference", { enum: keys(APPETITE) }).notNull().default("unknown"),
  impactInterests: text("impact_interests").notNull().default(""),
  developmentAppetite: text("development_appetite", { enum: keys(APPETITE) }).notNull().default("unknown"),
  constructionAppetite: text("construction_appetite", { enum: keys(APPETITE) }).notNull().default("unknown"),
  operatingAppetite: text("operating_appetite", { enum: keys(APPETITE) }).notNull().default("unknown"),
  knownRiskAppetite: text("known_risk_appetite").notNull().default(""),   // only what the person has stated
  constraints: text("constraints").notNull().default(""),
  privateNotes: text("private_notes").notNull().default(""),
  journeyStage: text("journey_stage", { enum: keys(INVESTOR_JOURNEY) }).notNull().default("identified"),
  lastInteractionAt: text("last_interaction_at"),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  lastVerifiedAt: text("last_verified_at"),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [uniqueIndex("private_capital_profiles_contact").on(t.mandateId, t.contactId)]);

/** Jurisdiction-, rule- and time-specific. A person is never "accredited" in general. */
export const investorQualifications = sqliteTable("investor_qualifications", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  jurisdiction: text("jurisdiction").notNull(),          // e.g. "US", "GB", "MX"
  classification: text("classification").notNull(),    // e.g. "Accredited investor (Rule 501(a))"
  definitionVersion: text("definition_version").notNull().default(""),
  assessmentStatus: text("assessment_status").notNull().default(""),
  verificationStatus: text("verification_status", { enum: keys(QUALIFICATION_STATUSES) }).notNull().default("unknown"),
  method: text("method").notNull().default(""),
  verifiedBy: text("verified_by"),
  verifiedAt: text("verified_at"),
  expiresAt: text("expires_at"),
  evidenceRef: text("evidence_ref").notNull().default(""),   // a pointer (provider reference, Drive link), never the document
  restrictions: text("restrictions").notNull().default(""),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("investor_qualifications_contact").on(t.contactId), index("investor_qualifications_org").on(t.orgId)]);

/** The bridge between a project and capital: one offering of one tranche (or requirement). */
export const capitalOpportunities = sqliteTable("capital_opportunities", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  requirementId: text("requirement_id"),
  trancheId: text("tranche_id"),
  title: text("title").notNull(),
  instrument: text("instrument").notNull(),
  target: real("target"),
  currency: text("currency").notNull().default("USD"),
  offering: text("offering").notNull().default(""),
  jurisdictions: list("jurisdictions"),
  issuerOrgId: text("issuer_org_id"),
  sponsorOrgId: text("sponsor_org_id"),
  arranger: text("arranger").notNull().default(""),
  placementParty: text("placement_party").notNull().default(""),
  counsel: text("counsel").notNull().default(""),
  financialAdvisor: text("financial_advisor").notNull().default(""),
  regeneraRole: text("regenera_role").notNull().default("Not a party to the offering"),
  gateState: text("gate_state", { enum: keys(GATE_STATES) }).notNull().default("review_required"),
  gateReviewer: text("gate_reviewer"),          // name and role of the person who concluded (e.g. counsel)
  gateReviewedAt: text("gate_reviewed_at"),
  gateEvidence: text("gate_evidence").notNull().default(""),
  gateConditions: text("gate_conditions").notNull().default(""),
  approvedMaterials: text("approved_materials", { mode: "json" }).$type<{ title: string; version: string; ref: string }[]>().notNull().default(sql`'[]'`),
  status: text("status", { enum: ["draft", "active", "closed"] }).notNull().default("draft"),
  ...timestamps,
}, t => [index("capital_opportunities_project").on(t.projectId)]);

export const capitalMatches = sqliteTable("capital_matches", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull().references(() => capitalOpportunities.id, { onDelete: "cascade" }),
  investorKey: text("investor_key").notNull(),    // "profile:<id>" or "private:<id>"
  capitalProfileId: text("capital_profile_id"),
  privateProfileId: text("private_profile_id"),
  commercialScore: integer("commercial_score").notNull(),
  commercialReasons: text("commercial_reasons", { mode: "json" }).$type<string[]>().notNull(),
  eligibility: text("eligibility", { enum: keys(ELIGIBILITY) }).notNull(),
  eligibilityReasons: text("eligibility_reasons", { mode: "json" }).$type<string[]>().notNull(),
  status: text("status", { enum: keys(MATCH_STATUSES) }).notNull().default("suggested"),
  ...timestamps,
}, t => [uniqueIndex("capital_matches_unique").on(t.opportunityId, t.investorKey)]);

export const commitments = sqliteTable("commitments", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull().references(() => capitalOpportunities.id, { onDelete: "cascade" }),
  investorKey: text("investor_key").notNull(),
  capitalProfileId: text("capital_profile_id"),
  privateProfileId: text("private_profile_id"),
  stage: text("stage", { enum: keys(COMMITMENT_STAGES) }).notNull(),
  amount: real("amount"),
  currency: text("currency").notNull().default("USD"),
  evidence: text("evidence").notNull().default(""),
  updatedBy: text("updated_by"),
  ...timestamps,
}, t => [uniqueIndex("commitments_unique").on(t.opportunityId, t.investorKey)]);

export const commitmentEvents = sqliteTable("commitment_events", {
  id: id(),
  commitmentId: text("commitment_id").notNull().references(() => commitments.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  stage: text("stage", { enum: keys(COMMITMENT_STAGES) }).notNull(),
  amount: real("amount"),
  evidence: text("evidence").notNull().default(""),
  actor: text("actor"),
  at: text("at").notNull().default(now),
}, t => [index("commitment_events_commitment").on(t.commitmentId, t.at)]);

/** Exactly what each investor received: document, version, channel, sender, approval. */
export const materialDeliveries = sqliteTable("material_deliveries", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  investorKey: text("investor_key").notNull(),
  contactId: text("contact_id"),
  document: text("document").notNull(),
  version: text("version").notNull(),
  channel: text("channel").notNull(),
  sentBy: text("sent_by"),
  sentAt: text("sent_at").notNull().default(now),
  approvalRef: text("approval_ref").notNull().default(""),
  messageId: text("message_id"),
  acknowledgedAt: text("acknowledged_at"),
}, t => [index("material_deliveries_opportunity").on(t.opportunityId, t.investorKey)]);

export const introductions = sqliteTable("introductions", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  fromContactId: text("from_contact_id").notNull(),   // the introducer
  toContactId: text("to_contact_id"),
  toOrgId: text("to_org_id"),
  date: text("date"),
  context: text("context").notNull().default(""),
  projectId: text("project_id"),
  opportunityId: text("opportunity_id"),
  status: text("status", { enum: keys(INTRO_STATUSES) }).notNull().default("requested"),
  compensation: integer("compensation", { mode: "boolean" }).notNull().default(false),
  reviewStatus: text("review_status", { enum: ["not_required", "review_required", "reviewed"] }).notNull().default("not_required"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("introductions_from").on(t.fromContactId), index("introductions_to").on(t.toContactId)]);

export const debtSecurities = sqliteTable("debt_securities", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  issuerOrgId: text("issuer_org_id"),
  program: text("program").notNull(),
  instrument: text("instrument").notNull(),       // bond, note, green bond …
  currency: text("currency").notNull().default("USD"),
  principal: real("principal"),
  issueSize: real("issue_size"),
  minDenomination: real("min_denomination"),
  coupon: text("coupon").notNull().default(""),
  couponType: text("coupon_type").notNull().default(""),
  maturity: text("maturity"),
  frequency: text("frequency").notNull().default(""),
  seniority: text("seniority").notNull().default(""),
  security: text("security").notNull().default(""),
  guarantee: text("guarantee").notNull().default(""),
  useOfProceeds: text("use_of_proceeds").notNull().default(""),
  isin: text("isin"),
  venue: text("venue").notNull().default(""),
  trustee: text("trustee").notNull().default(""),
  payingAgent: text("paying_agent").notNull().default(""),
  arranger: text("arranger").notNull().default(""),
  placementAgent: text("placement_agent").notNull().default(""),
  counsel: text("counsel").notNull().default(""),
  jurisdictions: list("jurisdictions"),
  offeringRestrictions: text("offering_restrictions").notNull().default(""),
  eligibleRecipients: text("eligible_recipients").notNull().default(""),
  offeringDocuments: text("offering_documents").notNull().default(""),
  riskDisclosures: text("risk_disclosures").notNull().default(""),
  subscriptionProcess: text("subscription_process").notNull().default(""),
  status: text("status", { enum: ["planned", "in_preparation", "open", "closed", "matured", "cancelled"] }).notNull().default("planned"),
  ...timestamps,
});
