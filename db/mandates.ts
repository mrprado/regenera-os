// Commercial mandates, the generalized matching + pursuit engine, approvals, attribution, delivery floors and
// public interconnection-queue reference data (docs/plans/phase-14-mandates.md). A commercial mandate is NOT the
// `mandates` workspace table: every row here carries `mandate_id` = the owning workspace, like all scoped data.
// Candidates reference canonical records (project, organization, capital profile, funding opportunity, queue entry)
// by id; nothing duplicates a project or account.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ClientResponse, Evidence, FitReading, FloorLine, SuccessEconomics } from "../lib/mandates/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const arr = <T = string>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const obj = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'{}'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type MandateGeography = { countries?: string[]; states?: string[]; isos?: string[]; regions?: string[]; jurisdictions?: string[] };
export type CriterionCheck = { met: "yes" | "no" | "unknown"; basis: string; by?: string; at?: string; machine?: boolean };
export type StageEvent = { from: string; to: string; at: string; by: string; reason: string; evidence?: string };

export const commercialMandates = sqliteTable("commercial_mandates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),                      // workspace
  name: text("name").notNull(),
  type: text("type").notNull(),                                 // MANDATE_TYPES
  desk: text("desk").notNull(),                                 // DESKS
  clientOrgId: text("client_org_id"), clientName: text("client_name").notNull().default(""), clientEntity: text("client_entity").notNull().default(""),
  engagementId: text("engagement_id"),                          // commercial engagement that pays for it
  owner: text("owner"), lead: text("lead"), originator: text("originator"),
  sector: text("sector").notNull().default(""), subsector: text("subsector").notNull().default(""), assetClass: text("asset_class").notNull().default(""),
  technologies: arr("technologies"),
  geography: obj<MandateGeography>("geography"),
  criteria: obj<Record<string, unknown>>("criteria"),           // BUILDER fields for the type
  exclusions: text("exclusions").notNull().default(""),
  qualificationNote: text("qualification_note").notNull().default(""),  // the written definition, in the client's words
  legalRestrictions: text("legal_restrictions").notNull().default(""), complianceRequirements: text("compliance_requirements").notNull().default(""),
  confidentiality: text("confidentiality").notNull().default("confidential"),
  outreachPermission: text("outreach_permission").notNull().default("approval_each"),
  dataAccess: text("data_access").notNull().default("named_team"),
  successDefinition: text("success_definition").notNull().default(""),
  deliveryFloor: arr<FloorLine>("delivery_floor"),
  reportingCadence: text("reporting_cadence").notNull().default("weekly"),
  engagementModel: text("engagement_model"),                    // ENGAGEMENT_MODELS
  breadth: text("breadth").notNull().default("regional"),
  termMonths: real("term_months"),
  retainer: real("retainer").notNull().default(0),              // per month
  pilotFee: real("pilot_fee").notNull().default(0),             // fixed
  implementationFee: real("implementation_fee").notNull().default(0),
  dataCost: real("data_cost").notNull().default(0), partnerCost: real("partner_cost").notNull().default(0), travelCost: real("travel_cost").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  successEconomics: obj<SuccessEconomics>("success_economics"),
  attributionRules: text("attribution_rules").notNull().default(""),
  contractId: text("contract_id"),
  startDate: text("start_date"), reviewDate: text("review_date"), endDate: text("end_date"),
  status: text("status").notNull().default("draft"),
  health: text("health").notNull().default("not_started"),
  healthNote: text("health_note").notNull().default(""),
  confidence: text("confidence").notNull().default("medium"),
  priority: text("priority").notNull().default("medium"),
  nextAction: text("next_action").notNull().default(""), nextActionDate: text("next_action_date"),
  publicLabel: text("public_label").notNull().default(""),     // anonymized line, published only after approval
  publishApproved: integer("publish_approved", { mode: "boolean" }).notNull().default(false),
  sources: arr<{ label: string; url: string; at: string }>("sources"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("commercial_mandates_ws").on(t.mandateId, t.status), index("commercial_mandates_type").on(t.type)]);

/** The universe: every entity considered against a mandate, with its stage, fit readings, checks and attribution. */
export const mandateCandidates = sqliteTable("mandate_candidates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  commercialMandateId: text("commercial_mandate_id").notNull().references(() => commercialMandates.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),                    // project | organization | capital_profile | funding_opportunity | queue_project | large_load
  entityId: text("entity_id").notNull(),                        // canonical id (queue_project key for public queue entries)
  name: text("name").notNull(),
  accountOrgId: text("account_org_id"),                          // sponsor / developer / investor organization when known
  projectId: text("project_id"),
  stage: text("stage").notNull().default("discovered"),
  fit: obj<Record<string, FitReading>>("fit"),
  checks: obj<Record<string, CriterionCheck>>("checks"),
  metCount: integer("met_count").notNull().default(0), unknownCount: integer("unknown_count").notNull().default(0), failCount: integer("fail_count").notNull().default(0),
  completeness: real("completeness").notNull().default(0),        // share of qualification criteria with a yes/no answer
  priority: text("priority").notNull().default("medium"),
  data: obj<Record<string, unknown>>("data"),                   // snapshot of the attributes the match used
  evidence: arr<Evidence>("evidence"),
  estValue: real("est_value"), estValueBasis: text("est_value_basis").notNull().default(""),
  windowStart: text("window_start"), windowEnd: text("window_end"), windowBasis: text("window_basis").notNull().default(""),
  attribution: text("attribution").notNull().default("unattributed"),
  originDate: text("origin_date"), originator: text("originator"), source: text("source").notNull().default(""),
  preExisting: integer("pre_existing", { mode: "boolean" }).notNull().default(false),
  clientResponse: text("client_response").$type<ClientResponse>(), clientResponseBy: text("client_response_by"), clientResponseAt: text("client_response_at"), clientResponseNote: text("client_response_note").notNull().default(""),
  disputeStatus: text("dispute_status").notNull().default("none"),
  nextAction: text("next_action").notNull().default(""), owner: text("owner"),
  pursuitId: text("pursuit_id"),
  feedback: text("feedback"),                                    // correct | incorrect | partial | outdated (human feedback on the match)
  feedbackNote: text("feedback_note").notNull().default(""),
  stageHistory: arr<StageEvent>("stage_history"),
  firstSeenAt: text("first_seen_at").notNull().default(now), lastSignalAt: text("last_signal_at"),
  ...timestamps,
}, t => [uniqueIndex("mandate_candidates_entity").on(t.commercialMandateId, t.entityType, t.entityId), index("mandate_candidates_stage").on(t.commercialMandateId, t.stage)]);

export const pursuits = sqliteTable("pursuits", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  commercialMandateId: text("commercial_mandate_id"),
  candidateId: text("candidate_id"),
  type: text("type").notNull(),                                  // PURSUIT_TYPES
  name: text("name").notNull(),
  accountOrgId: text("account_org_id"), projectId: text("project_id"), counterparty: text("counterparty").notNull().default(""),
  owner: text("owner"), team: arr("team"),
  value: real("value"), currency: text("currency").notNull().default("USD"), valueBasis: text("value_basis").notNull().default(""),
  stage: text("stage").notNull(),
  probabilityOverride: real("probability_override"), probabilityWhy: text("probability_why").notNull().default(""), probabilityAt: text("probability_at"),
  expectedOutcome: text("expected_outcome").notNull().default(""), expectedDate: text("expected_date"),
  nextAction: text("next_action").notNull().default(""), nextActionDate: text("next_action_date"), lastActionAt: text("last_action_at"),
  relationshipStatus: text("relationship_status").notNull().default("none"),
  risks: arr("risks"), competitors: arr("competitors"), decisionMakers: arr<{ contactId?: string; name: string; role: string }>("decision_makers"),
  commercialStructure: text("commercial_structure").notNull().default(""),
  diligenceStatus: text("diligence_status").notNull().default("not_started"), documentStatus: text("document_status").notNull().default("not_started"),
  attribution: text("attribution").notNull().default("unattributed"),
  bidCriteria: obj<Record<string, { rating: string; note: string }>>("bid_criteria"),
  bidDecision: text("bid_decision"), bidRationale: text("bid_rationale").notNull().default(""), bidDecidedBy: text("bid_decided_by"), bidDecidedAt: text("bid_decided_at"),
  dealId: text("deal_id"),
  outcome: text("outcome").notNull().default("open"),
  winLoss: obj<Record<string, string>>("win_loss"),            // reason, competitor, pricing, timing, relationship, technical, lessons …
  stageHistory: arr<StageEvent>("stage_history"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("pursuits_ws").on(t.mandateId, t.outcome), index("pursuits_mandate").on(t.commercialMandateId)]);

/** §10 Approval gates. Material actions wait here for a named person; the decision is the record. */
export const approvals = sqliteTable("approvals", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind").notNull(),                                  // APPROVAL_KINDS
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  commercialMandateId: text("commercial_mandate_id"),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  requester: text("requester").notNull(),
  approver: text("approver"),                                    // the named person (null = any workspace owner)
  status: text("status").notNull().default("pending"),
  rationale: text("rationale").notNull().default(""), conditions: text("conditions").notNull().default(""),
  documentVersion: text("document_version"),
  comments: arr<{ by: string; at: string; text: string }>("comments"),
  decidedBy: text("decided_by"), decidedAt: text("decided_at"),
  ...timestamps,
}, t => [index("approvals_pending").on(t.mandateId, t.status), index("approvals_entity").on(t.entityType, t.entityId)]);

/** §24 Delivery floor results per period (computed, then confirmed by the mandate lead with quality and remediation). */
export const mandateDeliveries = sqliteTable("mandate_deliveries", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  commercialMandateId: text("commercial_mandate_id").notNull().references(() => commercialMandates.id, { onDelete: "cascade" }),
  period: text("period").notNull(),                               // YYYY-MM
  metrics: obj<Record<string, { target: number; delivered: number }>>("metrics"),
  quality: text("quality").notNull().default(""), shortfall: text("shortfall").notNull().default(""), remediation: text("remediation").notNull().default(""),
  status: text("status").notNull().default("open"),              // open | met | short | reviewed
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"),
  ...timestamps,
}, t => [uniqueIndex("mandate_deliveries_period").on(t.commercialMandateId, t.period)]);

/** §20 Signals tied to a mandate and candidate. Inferences are flagged and never shown as confirmed events. */
export const mandateSignals = sqliteTable("mandate_signals", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  commercialMandateId: text("commercial_mandate_id").notNull(),
  candidateId: text("candidate_id"),
  kind: text("kind").notNull(),                                   // SIGNAL_KINDS
  whatChanged: text("what_changed").notNull(),
  whyItMatters: text("why_it_matters").notNull().default(""),
  recommendedAction: text("recommended_action").notNull().default(""),
  urgency: text("urgency").notNull().default("normal"),          // high | normal | low
  confidence: text("confidence").notNull().default("medium"),
  inference: integer("inference", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(), sourceUrl: text("source_url"),
  observedAt: text("observed_at").notNull(),
  status: text("status").notNull().default("new"),               // new | reviewed | actioned | dismissed
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("mandate_signals_dedupe").on(t.commercialMandateId, t.dedupeKey), index("mandate_signals_new").on(t.mandateId, t.status)]);

/** Public interconnection-queue entries (global reference data, like datasets): MISO and SPP, keyless public files.
 *  Developer names are not published by these queues; a candidate's sponsor stays "unidentified" until researched. */
export const queueProjects = sqliteTable("queue_projects", {
  key: text("key").primaryKey(),                                  // `${iso}:${number}`
  iso: text("iso").notNull(),
  number: text("number").notNull(),
  state: text("state").notNull().default(""), county: text("county").notNull().default(""),
  poi: text("poi").notNull().default(""), transmissionOwner: text("transmission_owner").notNull().default(""),
  fuel: text("fuel").notNull().default(""), technology: text("technology").notNull().default(""),   // solar | bess | solar_bess | wind | gas | other
  mw: real("mw"), mwWinter: real("mw_winter"),
  queueDate: text("queue_date"), inServiceDate: text("in_service_date"), withdrawnDate: text("withdrawn_date"),
  status: text("status").notNull().default(""), studyPhase: text("study_phase").notNull().default(""), iaStatus: text("ia_status").notNull().default(""),
  raw: obj<Record<string, unknown>>("raw"),
  firstSeenAt: text("first_seen_at").notNull().default(now), lastSeenAt: text("last_seen_at").notNull().default(now),
  lastChangedAt: text("last_changed_at"), changes: arr<{ at: string; field: string; from: string; to: string }>("changes"),
}, t => [index("queue_projects_iso").on(t.iso, t.technology, t.status), index("queue_projects_state").on(t.state)]);
