// Community rights, knowledge governance and community economic participation. Knowledge records hold governance
// metadata only: protected content lives with its custodians (the OS stores at most a pointer, and none at all for
// existence-only / sacred records). Every table carries created/updated by and soft delete; changes are audited.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ACCESS_STATUS, ACTIVITIES, AUTHORITY_TYPES, COMMITMENT_STATUS, COMMITMENT_TYPES, COMMUNITY_TYPES, CONSENT_STATUS, CONSENT_TYPES, ENGAGEMENT_FORMATS, GOVERNANCE_RIGHT_TYPES,
  GOVERNANCE_STATUS, GRIEVANCE_STATUS, KNOWLEDGE_CATEGORIES, LEDGER_ENTRY_STATUS, MATERIALITY, PARTICIPATION_TYPES, PERMISSION_STATUS, RIGHT_STATUS, RIGHT_TYPES, STAKE_FUNDING, STRUCTURE_STATUS,
} from "../lib/community/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'[]'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));
const meta = {
  createdBy: text("created_by").notNull(), updatedBy: text("updated_by"), deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now),
};
const rs = (name: string) => text(name, { enum: keys(RIGHT_STATUS) }).notNull().default("unknown");

export const communities = sqliteTable("communities", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id"),
  name: text("name").notNull(), preferredName: text("preferred_name").notNull().default(""), peopleNationGroup: text("people_nation_group").notNull().default(""),
  communityType: text("community_type", { enum: keys(COMMUNITY_TYPES) }).notNull().default("local"),
  country: text("country"), jurisdiction: text("jurisdiction").notNull().default(""), region: text("region").notNull().default(""), territoryName: text("territory_name").notNull().default(""),
  administrativeArea: text("administrative_area").notNull().default(""), languagePrimary: text("language_primary").notNull().default(""), languagesOther: json<string[]>("languages_other"),
  populationEstimate: integer("population_estimate"), representativeBody: text("representative_body").notNull().default(""), recognizedAuthority: text("recognized_authority").notNull().default(""),
  customaryAuthority: text("customary_authority").notNull().default(""), legalEntityName: text("legal_entity_name").notNull().default(""), legalEntityType: text("legal_entity_type").notNull().default(""),
  landRelationship: text("land_relationship").notNull().default(""), tenureType: text("tenure_type").notNull().default(""),
  customaryRightsStatus: rs("customary_rights_status"), statutoryRightsStatus: rs("statutory_rights_status"), resourceRightsStatus: rs("resource_rights_status"), culturalRightsStatus: rs("cultural_rights_status"),
  knownDisputes: text("known_disputes").notNull().default(""), representationVerified: integer("representation_verified", { mode: "boolean" }).notNull().default(false),
  authorityVerified: integer("authority_verified", { mode: "boolean" }).notNull().default(false), verificationSource: text("verification_source").notNull().default(""),
  primaryContactId: text("primary_contact_id"), orgId: text("org_id"),
  // Generalised geometry only (never exact sacred or restricted locations).
  areaGeometry: text("area_geometry"), areaGeneralized: integer("area_generalized", { mode: "boolean" }).notNull().default(true),
  localContexts: json<Record<string, unknown>>("local_contexts", "'{}'"), // TK/BC notices and labels when the (NOT CONNECTED) adapter syncs
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false), notes: text("notes").notNull().default(""),
  ...meta,
}, t => [index("communities_project").on(t.projectId), index("communities_mandate").on(t.mandateId)]);

export const communityRights = sqliteTable("community_rights", {
  id: id(), mandateId: text("mandate_id").notNull(), communityId: text("community_id").notNull(), projectId: text("project_id"),
  rightType: text("right_type", { enum: keys(RIGHT_TYPES) }).notNull(), description: text("description").notNull().default(""), legalBasis: text("legal_basis").notNull().default(""),
  customaryBasis: text("customary_basis").notNull().default(""), geographicScope: text("geographic_scope").notNull().default(""), spatialRef: text("spatial_ref"),
  sourceDocument: text("source_document").notNull().default(""), status: text("status", { enum: keys(RIGHT_STATUS) }).notNull().default("asserted"),
  verifiedBy: text("verified_by"), verificationDate: text("verification_date"), affectedStage: text("affected_stage").notNull().default(""),
  materiality: text("materiality", { enum: keys(MATERIALITY) }).notNull().default("unknown"),
  mitigationRequired: integer("mitigation_required", { mode: "boolean" }).notNull().default(false), consentRequired: integer("consent_required", { mode: "boolean" }).notNull().default(false),
  compensationRequired: integer("compensation_required", { mode: "boolean" }).notNull().default(false), negotiationRequired: integer("negotiation_required", { mode: "boolean" }).notNull().default(false),
  resolution: text("resolution", { enum: ["open", "in_progress", "resolved", "disclosed"] }).notNull().default("open"), notes: text("notes").notNull().default(""),
  ...meta,
}, t => [index("community_rights_community").on(t.communityId)]);

/** Community and knowledge authorities: who may decide what. Powers are recorded per authority (AUTHORITY_POWERS). */
export const communityAuthorities = sqliteTable("community_authorities", {
  id: id(), mandateId: text("mandate_id").notNull(), communityId: text("community_id").notNull(),
  name: text("name").notNull(), authorityType: text("authority_type", { enum: keys(AUTHORITY_TYPES) }).notNull(), individualOrBody: text("individual_or_body", { enum: ["individual", "body"] }).notNull().default("body"),
  scope: text("scope").notNull().default(""), subjectsAuthorized: text("subjects_authorized").notNull().default(""), subjectsNotAuthorized: text("subjects_not_authorized").notNull().default(""),
  basis: text("basis").notNull().default(""), geographicScope: text("geographic_scope").notNull().default(""), termStart: text("term_start"), termEnd: text("term_end"),
  powers: json<string[]>("powers"), knowledgeCategories: json<string[]>("knowledge_categories"),
  verificationStatus: text("verification_status", { enum: ["unverified", "verified", "disputed"] }).notNull().default("unverified"), verifiedBy: text("verified_by"), documentation: text("documentation").notNull().default(""),
  notes: text("notes").notNull().default(""), ...meta,
}, t => [index("community_authorities_community").on(t.communityId)]);

export const knowledgeHolders = sqliteTable("knowledge_holders", {
  id: id(), mandateId: text("mandate_id").notNull(), communityId: text("community_id").notNull(),
  name: text("name").notNull(), preferredIdentifier: text("preferred_identifier").notNull().default(""), anonymousPublicly: integer("anonymous_publicly", { mode: "boolean" }).notNull().default(true),
  role: text("role").notNull().default(""), relationshipToKnowledge: text("relationship_to_knowledge").notNull().default(""), authorityScope: text("authority_scope").notNull().default(""),
  attributionPreference: text("attribution_preference").notNull().default(""), contactPermissions: text("contact_permissions").notNull().default(""), notes: text("notes").notNull().default(""),
  ...meta,
});

export const knowledgeRecords = sqliteTable("knowledge_records", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id"), communityId: text("community_id"),
  holderId: text("holder_id"), authorityId: text("authority_id"), custodianId: text("custodian_id"),
  title: text("title").notNull(), category: text("category", { enum: keys(KNOWLEDGE_CATEGORIES) }).notNull(), knowledgeType: text("knowledge_type").notNull().default("tek"),
  // descriptionPublic is what may be shown to anyone who can see the record; blank for existence-only records.
  descriptionPublic: text("description_public").notNull().default(""), protectedContentRef: text("protected_content_ref"),
  sourceType: text("source_type").notNull().default(""), originalLanguage: text("original_language").notNull().default(""), collectionMethod: text("collection_method").notNull().default(""),
  collectionDate: text("collection_date"),
  accessStatus: text("access_status", { enum: keys(ACCESS_STATUS) }).notNull().default("restricted"),
  governanceStatus: text("governance_status", { enum: keys(GOVERNANCE_STATUS) }).notNull().default("unknown"),
  consentStatus: text("consent_status", { enum: keys(CONSENT_STATUS) }).notNull().default("not_started"),
  spatialSensitivity: text("spatial_sensitivity", { enum: ["none", "generalise", "hide"] }).notNull().default("hide"), generalizedArea: text("generalized_area").notNull().default(""),
  publicationStatus: text("publication_status", { enum: ["unpublished", "approved", "published", "prohibited"] }).notNull().default("unpublished"),
  withdrawn: integer("withdrawn", { mode: "boolean" }).notNull().default(false), provenanceComplete: integer("provenance_complete", { mode: "boolean" }).notNull().default(false),
  localContexts: json<Record<string, unknown>>("local_contexts", "'{}'"), ...meta,
}, t => [index("knowledge_records_project").on(t.projectId), index("knowledge_records_community").on(t.communityId)]);

export const knowledgePermissions = sqliteTable("knowledge_permissions", {
  id: id(), mandateId: text("mandate_id").notNull(), recordId: text("record_id").notNull(),
  activity: text("activity", { enum: keys(ACTIVITIES) }).notNull(), status: text("status", { enum: keys(PERMISSION_STATUS) }).notNull().default("pending"),
  conditions: text("conditions").notNull().default(""), approvingAuthorityId: text("approving_authority_id"), approvalDate: text("approval_date"), expiryDate: text("expiry_date"),
  reconfirmationRequired: integer("reconfirmation_required", { mode: "boolean" }).notNull().default(false), withdrawalAllowed: integer("withdrawal_allowed", { mode: "boolean" }).notNull().default(true),
  evidence: text("evidence").notNull().default(""), notes: text("notes").notNull().default(""), ...meta,
}, t => [uniqueIndex("knowledge_permissions_activity").on(t.recordId, t.activity)]);

/** Where a knowledge record was used (report, memo, map export, design). Withdrawal flags every use for remediation. */
export const knowledgeUses = sqliteTable("knowledge_uses", {
  id: id(), mandateId: text("mandate_id").notNull(), recordId: text("record_id").notNull(), activity: text("activity", { enum: keys(ACTIVITIES) }).notNull(),
  outputType: text("output_type").notNull(), outputRef: text("output_ref").notNull().default(""), description: text("description").notNull().default(""), usedBy: text("used_by").notNull(),
  status: text("status", { enum: ["active", "flagged", "remediated"] }).notNull().default("active"), flaggedReason: text("flagged_reason"), usedAt: text("used_at").notNull().default(now),
}, t => [index("knowledge_uses_record").on(t.recordId)]);

export type Disclosures = Partial<Record<string, boolean>>;
export const consentRecords = sqliteTable("consent_records", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id"), communityId: text("community_id").notNull(), knowledgeRecordId: text("knowledge_record_id"),
  consentType: text("consent_type", { enum: keys(CONSENT_TYPES) }).notNull().default("fpic"), consentRequired: integer("consent_required", { mode: "boolean" }).notNull().default(true),
  authorityId: text("authority_id"), status: text("status", { enum: keys(CONSENT_STATUS) }).notNull().default("not_started"), scope: text("scope").notNull().default(""),
  disclosures: json<Disclosures>("disclosures", "'{}'"), languageUsed: text("language_used").notNull().default(""), interpreter: text("interpreter").notNull().default(""),
  method: text("method").notNull().default(""), evidence: text("evidence").notNull().default(""), conditions: text("conditions").notNull().default(""),
  consentDate: text("consent_date"), expiryDate: text("expiry_date"), reviewDate: text("review_date"), withdrawalMechanism: text("withdrawal_mechanism").notNull().default(""),
  reconsentTriggers: text("reconsent_triggers").notNull().default(""), history: json<{ at: string; from: string; to: string; by: string; note?: string }[]>("history"), notes: text("notes").notNull().default(""),
  ...meta,
}, t => [index("consent_records_project").on(t.projectId)]);

export const communityEngagements = sqliteTable("community_engagements", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id"), communityId: text("community_id").notNull(),
  date: text("date").notNull(), location: text("location").notNull().default(""), format: text("format", { enum: keys(ENGAGEMENT_FORMATS) }).notNull().default("meeting"),
  participants: text("participants").notNull().default(""), projectTeam: text("project_team").notNull().default(""), facilitator: text("facilitator").notNull().default(""), interpreter: text("interpreter").notNull().default(""),
  topics: text("topics").notNull().default(""), concerns: text("concerns").notNull().default(""), requests: text("requests").notNull().default(""), commitmentsMade: text("commitments_made").notNull().default(""),
  decisionStatus: text("decision_status").notNull().default(""), communityReviewStatus: text("community_review_status", { enum: ["not_shared", "shared", "reviewed", "corrected"] }).notNull().default("not_shared"),
  nextAction: text("next_action").notNull().default(""), owner: text("owner"), dueDate: text("due_date"), ...meta,
}, t => [index("community_engagements_community").on(t.communityId, t.date)]);

export type StructureTerms = {
  equityPct?: number | null; revenueSharePct?: number | null; royaltyPct?: number | null; royaltyPerUnit?: number | null; leasePerYear?: number | null; leaseEscalationPct?: number | null;
  stewardshipPerYear?: number | null; fundPctOfRevenue?: number | null; fixedPerYear?: number | null; stakeFunding?: keyof typeof STAKE_FUNDING | null; stakeCost?: number | null;
  stakeLoanRatePct?: number | null; preferredReturnPct?: number | null; downsideFloorPerYear?: number | null; startYear?: number | null; durationYears?: number | null;
};
export const participationStructures = sqliteTable("participation_structures", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), communityId: text("community_id").notNull(),
  scenario: text("scenario").notNull().default("Base"), name: text("name").notNull(), type: text("type", { enum: keys(PARTICIPATION_TYPES) }).notNull(),
  status: text("status", { enum: keys(STRUCTURE_STATUS) }).notNull().default("concept"), basis: text("basis").notNull().default(""), rationale: text("rationale").notNull().default(""),
  legalStructure: text("legal_structure").notNull().default(""), projectCompany: text("project_company").notNull().default(""), terms: json<StructureTerms>("terms", "'{}'"),
  inflationIndexed: integer("inflation_indexed", { mode: "boolean" }).notNull().default(false), transferability: text("transferability").notNull().default(""),
  changeOfControl: text("change_of_control").notNull().default(""), termination: text("termination").notNull().default(""),
  approvals: json<Record<string, string>>("approvals", "'{}'"), // community / developer / lender / investor / legal → APPROVAL key
  agreementId: text("agreement_id"), notes: text("notes").notNull().default(""), ...meta,
}, t => [index("participation_structures_project").on(t.projectId, t.scenario)]);

export const communityLedger = sqliteTable("community_ledger", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), communityId: text("community_id").notNull(), structureId: text("structure_id"),
  ledger: text("ledger", { enum: ["mitigation", "participation", "development"] }).notNull(), category: text("category").notNull(), description: text("description").notNull().default(""),
  amount: real("amount").notNull(), currency: text("currency").notNull().default("USD"), date: text("date").notNull(),
  status: text("status", { enum: keys(LEDGER_ENTRY_STATUS) }).notNull().default("scheduled"), evidence: text("evidence").notNull().default(""), ...meta,
}, t => [index("community_ledger_project").on(t.projectId, t.ledger)]);

export const communityFunds = sqliteTable("community_funds", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id"), communityId: text("community_id").notNull(),
  name: text("name").notNull(), legalVehicle: text("legal_vehicle").notNull().default(""), governanceBody: text("governance_body").notNull().default(""), beneficiaries: text("beneficiaries").notNull().default(""),
  allocationPolicy: json<{ category: string; pct: number }[]>("allocation_policy"), investmentPolicy: text("investment_policy").notNull().default(""), spendingPolicy: text("spending_policy").notNull().default(""),
  reservePolicy: text("reserve_policy").notNull().default(""), auditRequirement: text("audit_requirement").notNull().default(""), reportingFrequency: text("reporting_frequency").notNull().default(""),
  trustee: text("trustee").notNull().default(""), custodian: text("custodian").notNull().default(""), balance: real("balance"), currency: text("currency").notNull().default("USD"),
  notes: text("notes").notNull().default(""), ...meta,
});

export const communityGovernanceRights = sqliteTable("community_governance_rights", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), communityId: text("community_id").notNull(),
  rightType: text("right_type", { enum: keys(GOVERNANCE_RIGHT_TYPES) }).notNull(), governingDocument: text("governing_document").notNull().default(""), scope: text("scope").notNull().default(""),
  trigger: text("trigger").notNull().default(""), approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(false), informationAccess: text("information_access").notNull().default(""),
  votingThreshold: text("voting_threshold").notNull().default(""), duration: text("duration").notNull().default(""), scenario: text("scenario").notNull().default("Base"), notes: text("notes").notNull().default(""),
  ...meta,
});

export const communityCommitments = sqliteTable("community_commitments", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), communityId: text("community_id"),
  source: text("source").notNull().default(""), agreementId: text("agreement_id"), engagementId: text("engagement_id"), type: text("type", { enum: keys(COMMITMENT_TYPES) }).notNull(),
  description: text("description").notNull(), owner: text("owner"), beneficiary: text("beneficiary").notNull().default(""), startDate: text("start_date"), dueDate: text("due_date"),
  recurrence: text("recurrence", { enum: ["none", "monthly", "quarterly", "annual"] }).notNull().default("none"), amount: real("amount"), currency: text("currency").notNull().default("USD"),
  indexed: integer("indexed", { mode: "boolean" }).notNull().default(false), status: text("status", { enum: keys(COMMITMENT_STATUS) }).notNull().default("proposed"),
  evidence: text("evidence").notNull().default(""), verificationRequired: integer("verification_required", { mode: "boolean" }).notNull().default(false), verifiedBy: text("verified_by"),
  notes: text("notes").notNull().default(""), ...meta,
}, t => [index("community_commitments_project").on(t.projectId, t.status)]);

export const communityGrievances = sqliteTable("community_grievances", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), communityId: text("community_id"),
  received: text("received").notNull(), channel: text("channel").notNull().default(""), summary: text("summary").notNull(), category: text("category").notNull().default(""),
  status: text("status", { enum: keys(GRIEVANCE_STATUS) }).notNull().default("received"), owner: text("owner"), response: text("response").notNull().default(""), resolvedAt: text("resolved_at"),
  confidential: integer("confidential", { mode: "boolean" }).notNull().default(true), ...meta,
});
