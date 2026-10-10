// Commercial lifecycle (phase 29A): relationship roles, stage history for every pipeline, versioned commercial proposals,
// delivery templates, engagement milestones / deliverables / client requests / change requests, and payments with
// evidence. Existing engagements, invoices, deals and contracts are reused; their JSON columns stay for older rows.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  CHANGE_REQUEST_STATUS, CLIENT_REQUEST_STATUS, DELIVERABLE_STATUS, FEE_STRUCTURES, INTRO_OUTCOMES, MILESTONE_STATUS, PARTNERSHIP_KINDS, PARTNERSHIP_STAGES, PAYMENT_KINDS, PAYMENT_METHODS, PIPELINES,
  PROPOSAL_STATUS, PROPOSAL_VERSION_STATUS, RELATIONSHIP_ROLES, RELATIONSHIP_STAGES, TEMPLATE_STATUS,
} from "../lib/lifecycle/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const arr = <T>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const stamps = { createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

/** Overlapping labels on a person or organization. `basis` "derived" rows come from engagements only. */
export const relationshipRoles = sqliteTable("relationship_roles", {
  id: id(), mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type", { enum: ["contact", "organization"] }).notNull(), entityId: text("entity_id").notNull(),
  role: text("role", { enum: keys(RELATIONSHIP_ROLES) }).notNull(),
  basis: text("basis", { enum: ["stated", "verified", "derived"] }).notNull().default("stated"),
  source: text("source").notNull().default(""), note: text("note").notNull().default(""),
  derivedFrom: text("derived_from"),                                   // engagement id for client / former client
  since: text("since"), until: text("until"),
  ...stamps,
}, t => [uniqueIndex("relationship_roles_unique").on(t.mandateId, t.entityType, t.entityId, t.role), index("relationship_roles_role").on(t.mandateId, t.role)]);

/** One relationship-development state per person or organization (phase 29B uses it; created now with the foundation). */
export const relationshipStatus = sqliteTable("relationship_status", {
  id: id(), mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type", { enum: ["contact", "organization"] }).notNull(), entityId: text("entity_id").notNull(),
  stage: text("stage", { enum: keys(RELATIONSHIP_STAGES) }).notNull().default("identified"),
  owner: text("owner"), nextAction: text("next_action").notNull().default(""), nextActionDue: text("next_action_due"), noActionReason: text("no_action_reason"),
  lastMeaningfulAt: text("last_meaningful_at"), stageChangedAt: text("stage_changed_at").notNull().default(now),
  ...stamps,
}, t => [uniqueIndex("relationship_status_entity").on(t.mandateId, t.entityType, t.entityId)]);

/** Every stage change on any pipeline, with its reason and evidence; overrides are marked. Never rewritten. */
export const pipelineStageHistory = sqliteTable("pipeline_stage_history", {
  id: id(), mandateId: text("mandate_id").notNull(),
  pipeline: text("pipeline", { enum: keys(PIPELINES) }).notNull(),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  fromStage: text("from_stage"), toStage: text("to_stage").notNull(),
  reason: text("reason").notNull().default(""), evidence: text("evidence").notNull().default(""),
  override: integer("override", { mode: "boolean" }).notNull().default(false),
  by: text("by").notNull(), at: text("at").notNull().default(now),
}, t => [index("pipeline_stage_history_entity").on(t.entityType, t.entityId, t.at)]);

/** A commercial proposal for Regenera's paid work on an opportunity (deal). Content lives in versions. */
export const offerProposals = sqliteTable("offer_proposals", {
  id: id(), mandateId: text("mandate_id").notNull(),
  dealId: text("deal_id").notNull(), orgId: text("org_id"), projectId: text("project_id"),
  title: text("title").notNull(),
  status: text("status", { enum: keys(PROPOSAL_STATUS) }).notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(1),
  acceptedVersionId: text("accepted_version_id"),
  contractId: text("contract_id"), engagementId: text("engagement_id"),
  owner: text("owner"),
  ...stamps,
}, t => [index("offer_proposals_deal").on(t.dealId), index("offer_proposals_mandate").on(t.mandateId, t.status)]);

export type ProposalDeliverable = { label: string; description?: string };
export type ProposalPayment = { label: string; amount: number; trigger: string };

/** Immutable once sent: a change after sending is a new version. The accepted version is the agreed scope. */
export const offerProposalVersions = sqliteTable("offer_proposal_versions", {
  id: id(), mandateId: text("mandate_id").notNull(), proposalId: text("proposal_id").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: keys(PROPOSAL_VERSION_STATUS) }).notNull().default("draft"),
  serviceIds: arr<string>("service_ids"),
  summary: text("summary").notNull().default(""), scope: text("scope").notNull().default(""),
  deliverables: arr<ProposalDeliverable>("deliverables"),
  assumptions: text("assumptions").notNull().default(""), exclusions: text("exclusions").notNull().default(""),
  timeline: text("timeline").notNull().default(""), responsibilities: text("responsibilities").notNull().default(""),
  feeStructure: text("fee_structure", { enum: keys(FEE_STRUCTURES) }).notNull().default("fixed"),
  currency: text("currency").notNull().default("USD"),
  fee: real("fee"), monthlyFee: real("monthly_fee"), months: integer("months"), hourlyRate: real("hourly_rate"), estimatedHours: real("estimated_hours"),
  paymentSchedule: arr<ProposalPayment>("payment_schedule"),
  validUntil: text("valid_until"),
  templateId: text("template_id"),
  sentAt: text("sent_at"), sentBy: text("sent_by"),
  decidedAt: text("decided_at"), decidedBy: text("decided_by"),         // client name or owner recording the decision
  decisionEvidence: text("decision_evidence"),
  contentHash: text("content_hash"),                                     // set when sent; proves the accepted text is unchanged
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("offer_proposal_versions_unique").on(t.proposalId, t.version)]);

export type TemplateMilestone = { key: string; label: string; offsetWeeks: number };
export type TemplateDeliverable = { label: string; milestoneKey: string; description?: string; inputs?: string[]; clientReview?: boolean };
export type TemplateRequest = { label: string; description?: string; dueOffsetDays: number };
export type TemplateTask = { title: string; offsetDays: number };

/** Versioned delivery template. Instantiation copies rows into an engagement; editing never touches live engagements. */
export const deliveryTemplates = sqliteTable("delivery_templates", {
  id: id(), mandateId: text("mandate_id").notNull(),
  key: text("key").notNull(), version: integer("version").notNull().default(1),
  name: text("name").notNull(), serviceKey: text("service_key"), description: text("description").notNull().default(""),
  status: text("status", { enum: keys(TEMPLATE_STATUS) }).notNull().default("draft"),
  milestones: arr<TemplateMilestone>("milestones"), deliverables: arr<TemplateDeliverable>("deliverables"),
  requests: arr<TemplateRequest>("requests"), tasks: arr<TemplateTask>("tasks"),
  qualification: arr<string>("qualification"), reportingCadence: text("reporting_cadence").notNull().default(""),
  seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
  ...stamps,
}, t => [uniqueIndex("delivery_templates_key").on(t.mandateId, t.key, t.version)]);

export const engagementMilestones = sqliteTable("engagement_milestones", {
  id: id(), mandateId: text("mandate_id").notNull(), engagementId: text("engagement_id").notNull(),
  key: text("key").notNull().default(""), label: text("label").notNull(), dueDate: text("due_date"),
  status: text("status", { enum: keys(MILESTONE_STATUS) }).notNull().default("planned"),
  blockedReason: text("blocked_reason"), blockedParty: text("blocked_party"),
  sort: integer("sort").notNull().default(0), completedAt: text("completed_at"),
  ...stamps,
}, t => [index("engagement_milestones_engagement").on(t.engagementId, t.sort)]);

/** Internal completion and client acceptance are separate states; acceptance is recorded with who and when. */
export const engagementDeliverables = sqliteTable("engagement_deliverables", {
  id: id(), mandateId: text("mandate_id").notNull(), engagementId: text("engagement_id").notNull(), milestoneId: text("milestone_id"),
  label: text("label").notNull(), description: text("description").notNull().default(""),
  owner: text("owner"), dueDate: text("due_date"), dependsOn: text("depends_on"), inputs: arr<string>("inputs"),
  status: text("status", { enum: keys(DELIVERABLE_STATUS) }).notNull().default("not_started"),
  clientReview: integer("client_review", { mode: "boolean" }).notNull().default(true),
  blockedReason: text("blocked_reason"), blockedParty: text("blocked_party"),
  documentId: text("document_id"), artifactUrl: text("artifact_url"), version: integer("version").notNull().default(1),
  completionEvidence: text("completion_evidence").notNull().default(""), internalDoneAt: text("internal_done_at"), internalDoneBy: text("internal_done_by"),
  acceptedAt: text("accepted_at"), acceptedBy: text("accepted_by"), acceptanceNote: text("acceptance_note"), revisionNote: text("revision_note"),
  ...stamps,
}, t => [index("engagement_deliverables_engagement").on(t.engagementId), index("engagement_deliverables_due").on(t.mandateId, t.status, t.dueDate)]);

/** Something Regenera needs from the client (document, answer, access, decision). */
export const clientRequests = sqliteTable("client_requests", {
  id: id(), mandateId: text("mandate_id").notNull(), engagementId: text("engagement_id").notNull(),
  label: text("label").notNull(), description: text("description").notNull().default(""), dueDate: text("due_date"),
  status: text("status", { enum: keys(CLIENT_REQUEST_STATUS) }).notNull().default("open"),
  documentId: text("document_id"), response: text("response").notNull().default(""),
  submittedAt: text("submitted_at"), submittedBy: text("submitted_by"), reviewedAt: text("reviewed_at"), reviewedBy: text("reviewed_by"), reviewNote: text("review_note"),
  ...stamps,
}, t => [index("client_requests_engagement").on(t.engagementId, t.status)]);

/** A change to agreed scope. The accepted proposal version is never edited; an approved change adds to it. */
export const changeRequests = sqliteTable("change_requests", {
  id: id(), mandateId: text("mandate_id").notNull(), engagementId: text("engagement_id").notNull(),
  baseVersionId: text("base_version_id"),
  title: text("title").notNull(), description: text("description").notNull().default(""), scopeEffect: text("scope_effect").notNull().default(""),
  feeImpact: real("fee_impact").notNull().default(0), currency: text("currency").notNull(), timelineWeeks: real("timeline_weeks").notNull().default(0),
  addDeliverables: arr<string>("add_deliverables"),
  status: text("status", { enum: keys(CHANGE_REQUEST_STATUS) }).notNull().default("proposed"),
  requestedBy: text("requested_by").notNull(), decidedBy: text("decided_by"), decidedAt: text("decided_at"), decisionEvidence: text("decision_evidence"),
  ...stamps,
}, t => [index("change_requests_engagement").on(t.engagementId)]);

/** Money received or returned against an invoice. The invoice's paid status is derived from these rows. */
export const payments = sqliteTable("payments", {
  id: id(), mandateId: text("mandate_id").notNull(), invoiceId: text("invoice_id").notNull(),
  kind: text("kind", { enum: keys(PAYMENT_KINDS) }).notNull().default("payment"),
  amount: real("amount").notNull(), currency: text("currency").notNull(),
  method: text("method", { enum: keys(PAYMENT_METHODS) }).notNull().default("bank_transfer"),
  receivedOn: text("received_on").notNull(),
  evidence: text("evidence").notNull(),                                  // bank reference, remittance, provider event
  provider: text("provider").notNull().default("manual"), providerPaymentId: text("provider_payment_id"),
  note: text("note").notNull().default(""),
  recordedBy: text("recorded_by").notNull(), recordedAt: text("recorded_at").notNull().default(now),
}, t => [uniqueIndex("payments_provider_id").on(t.provider, t.providerPaymentId), index("payments_invoice").on(t.invoiceId)]);

/** A partnership with an organization (phase 29B). Capability is verified with evidence; terms are only what was agreed. */
export const partnerships = sqliteTable("partnerships", {
  id: id(), mandateId: text("mandate_id").notNull(), orgId: text("org_id").notNull(),
  kind: text("kind", { enum: keys(PARTNERSHIP_KINDS) }).notNull(),
  stage: text("stage", { enum: keys(PARTNERSHIP_STAGES) }).notNull().default("potential"),
  capabilities: arr<string>("capabilities"), geographies: arr<string>("geographies"), sectors: arr<string>("sectors"),
  capabilityEvidence: text("capability_evidence").notNull().default(""), verifiedBy: text("verified_by"), verifiedAt: text("verified_at"),
  capacity: text("capacity").notNull().default(""),
  arrangement: text("arrangement").notNull().default(""),               // what is proposed or agreed, in plain words
  commercialTerms: text("commercial_terms").notNull().default(""),       // only when explicitly agreed; never assumed (no default referral fee)
  contractId: text("contract_id"), agreementEvidence: text("agreement_evidence"),
  owner: text("owner"), nextAction: text("next_action").notNull().default(""), nextActionDue: text("next_action_due"), noActionReason: text("no_action_reason"),
  stageChangedAt: text("stage_changed_at").notNull().default(now),
  ...stamps,
}, t => [uniqueIndex("partnerships_org_kind").on(t.mandateId, t.orgId, t.kind)]);

/** An introduction Regenera makes or receives, with authorization to share and its outcome. One open per parties + purpose. */
export const relationshipIntroductions = sqliteTable("relationship_introductions", {
  id: id(), mandateId: text("mandate_id").notNull(),
  fromOrgId: text("from_org_id"), fromContactId: text("from_contact_id"),   // the party being introduced (e.g. a partner)
  toOrgId: text("to_org_id"), toContactId: text("to_contact_id"),           // the party they are introduced to
  partnershipId: text("partnership_id"), projectId: text("project_id"), engagementId: text("engagement_id"),
  purpose: text("purpose").notNull(),
  authorization: text("authorization").notNull().default(""),               // who allowed what to be shared, and how
  materialsShared: arr<string>("materials_shared"),
  date: text("date"), owner: text("owner"), nextAction: text("next_action").notNull().default(""), nextActionDue: text("next_action_due"),
  outcome: text("outcome", { enum: keys(INTRO_OUTCOMES) }).notNull().default("pending"), outcomeNote: text("outcome_note").notNull().default(""),
  openKey: text("open_key"),                                                // set while open; unique, so an open duplicate is refused
  ...stamps,
}, t => [uniqueIndex("relationship_introductions_open").on(t.openKey), index("relationship_introductions_project").on(t.projectId)]);

/** How an engagement ended (phase 29D): outcome, the client's acceptance, lessons, continuation and permissions asked. */
export const engagementCloseouts = sqliteTable("engagement_closeouts", {
  id: id(), mandateId: text("mandate_id").notNull(), engagementId: text("engagement_id").notNull(),
  outcome: text("outcome").notNull(), acceptanceEvidence: text("acceptance_evidence").notNull(), lessons: text("lessons").notNull().default(""),
  continuation: text("continuation").notNull().default(""),
  caseStudy: text("case_study", { enum: ["not_asked", "requested", "granted", "declined"] }).notNull().default("not_asked"),
  referralRequested: integer("referral_requested", { mode: "boolean" }).notNull().default(false),
  outstanding: arr<string>("outstanding"),                                  // what was still open at closeout, as recorded
  reviewDue: text("review_due"),
  ...stamps,
}, t => [uniqueIndex("engagement_closeouts_engagement").on(t.engagementId)]);
