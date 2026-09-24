// Phase 1 CRM core (SPEC sections 9 and 21, docs/plans/phase-1.md).
// Every mandate-scoped table carries mandate_id and is read only through lib/db/scoped.ts.
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ACTIVITY_TYPES, CHANNELS, CONSENT_BASES, DEAL_STAGES, EMAIL_STATUSES, ENGAGEMENT_PATHS, ENGAGEMENTS, FEE_TYPES,
  LEAD_SOURCES, LEAD_STATES, MESSAGE_STATUSES, PARTNER_TIERS, PARTNER_TYPES, PRACTICES, REFERRAL_STATUSES,
  SCREENING_QUADRANTS, SEGMENT_GROUPS, TIERS, TRIGGER_STATUSES, TRIGGER_TYPES,
} from "../lib/vocab";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = {
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
};
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map(v => `'${v}'`).join(", ")})`);
const mandateId = () => text("mandate_id").notNull();

/** Per-field provenance: which source set a value, when, and with what confidence (SPEC section 12b). */
export type FieldSources = Record<string, { source: string; at: string; confidence?: "high" | "medium" | "low"; url?: string }>;

export const segments = sqliteTable("segments", {
  id: id(),
  key: text("key").notNull().unique(),
  group: text("group", { enum: SEGMENT_GROUPS }).notNull(),
  name: text("name").notNull(),
  path: text("path", { enum: ENGAGEMENT_PATHS }).notNull(),
  sectors: text("sectors", { mode: "json" }).$type<string[]>().notNull(),
  titles: text("titles", { mode: "json" }).$type<string[]>().notNull(),
  triggers: text("triggers").notNull().default(""),
  practices: text("practices", { mode: "json" }).$type<string[]>().notNull(),
  entryOffer: text("entry_offer").notNull().default(""),
  angle: text("angle").notNull().default(""),
  apolloFilters: text("apollo_filters", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, () => [check("segments_group_check", inList("\"group\"", SEGMENT_GROUPS)), check("segments_path_check", inList("path", ENGAGEMENT_PATHS))]);

export const organizations = sqliteTable("organizations", {
  id: id(),
  mandateId: mandateId(),
  name: text("name").notNull(),
  nameNormalized: text("name_normalized").notNull(),
  domain: text("domain"),
  website: text("website"),
  country: text("country"),              // ISO3 when known
  location: text("location"),
  sector: text("sector"),                // lib/vocab SECTORS key
  industry: text("industry"),            // free text from sources
  headcount: integer("headcount"),
  foundedYear: integer("founded_year"),
  segmentId: text("segment_id"),
  description: text("description"),
  linkedinUrl: text("linkedin_url"),
  apolloOrgId: text("apollo_org_id"),
  lei: text("lei"),
  wikidataId: text("wikidata_id"),
  secCik: text("sec_cik"),
  parentOrgId: text("parent_org_id"),
  lat: real("lat"),
  lng: real("lng"),
  geoSource: text("geo_source"),         // wikidata, nominatim, apollo, manual
  source: text("source", { enum: keys(LEAD_SOURCES) }).notNull(),
  fieldSources: text("field_sources", { mode: "json" }).$type<FieldSources>().notNull().default(sql`'{}'`),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [
  uniqueIndex("organizations_mandate_domain").on(t.mandateId, t.domain),
  uniqueIndex("organizations_mandate_apollo").on(t.mandateId, t.apolloOrgId),
  index("organizations_mandate_name").on(t.mandateId, t.nameNormalized),
  index("organizations_mandate_sector").on(t.mandateId, t.sector),
  index("organizations_mandate_country").on(t.mandateId, t.country),
]);

export const contacts = sqliteTable("contacts", {
  id: id(),
  mandateId: mandateId(),
  orgId: text("org_id"),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  fullName: text("full_name").notNull(),
  nameNormalized: text("name_normalized").notNull(),
  title: text("title"),
  seniority: text("seniority"),
  email: text("email"),
  emailLower: text("email_lower"),
  emailStatus: text("email_status", { enum: EMAIL_STATUSES }).notNull().default("unknown"),
  linkedinUrl: text("linkedin_url"),
  location: text("location"),
  country: text("country"),
  language: text("language"),
  timezone: text("timezone"),
  apolloPersonId: text("apollo_person_id"),
  source: text("source", { enum: keys(LEAD_SOURCES) }).notNull(),
  segmentId: text("segment_id"),
  leadState: text("lead_state", { enum: LEAD_STATES }).notNull().default("sourced"),
  tier: text("tier", { enum: TIERS }),
  score: integer("score"),
  consentBasis: text("consent_basis", { enum: CONSENT_BASES }).notNull().default("legitimate_interest"),
  suppressed: integer("suppressed", { mode: "boolean" }).notNull().default(false),
  linkedinProfileText: text("linkedin_profile_text"),
  fieldSources: text("field_sources", { mode: "json" }).$type<FieldSources>().notNull().default(sql`'{}'`),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [
  uniqueIndex("contacts_mandate_email").on(t.mandateId, t.emailLower),
  uniqueIndex("contacts_mandate_linkedin").on(t.mandateId, t.linkedinUrl),
  uniqueIndex("contacts_mandate_apollo").on(t.mandateId, t.apolloPersonId),
  index("contacts_mandate_org").on(t.mandateId, t.orgId),
  index("contacts_mandate_name").on(t.mandateId, t.nameNormalized),
  index("contacts_mandate_state").on(t.mandateId, t.leadState),
  index("contacts_mandate_score").on(t.mandateId, t.score),
  check("contacts_email_status_check", inList("email_status", EMAIL_STATUSES)),
  check("contacts_lead_state_check", inList("lead_state", LEAD_STATES)),
]);

export const dossiers = sqliteTable("dossiers", {
  id: id(),
  mandateId: mandateId(),
  orgId: text("org_id").notNull(),
  contactId: text("contact_id"),
  depth: text("depth", { enum: ["full", "light"] }).notNull(),
  notes: text("notes").notNull().default(""),      // gather step output: facts with URLs
  fields: text("fields", { mode: "json" }).$type<Record<string, unknown>>(),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }),
  status: text("status", { enum: ["gathering", "synthesizing", "ready", "failed"] }).notNull().default("gathering"),
  error: text("error"),
  refreshedAt: text("refreshed_at"),
  ...timestamps,
}, t => [index("dossiers_mandate_org").on(t.mandateId, t.orgId), index("dossiers_mandate_contact").on(t.mandateId, t.contactId)]);

export const triggers = sqliteTable("triggers", {
  id: id(),
  mandateId: mandateId(),
  orgId: text("org_id").notNull(),
  type: text("type", { enum: TRIGGER_TYPES }).notNull(),
  summary: text("summary").notNull(),
  eventDate: text("event_date"),
  sourceUrl: text("source_url"),
  source: text("source").notNull().default("manual"),
  urgency: integer("urgency").notNull().default(3),
  country: text("country"),
  lat: real("lat"),
  lng: real("lng"),
  signalId: text("signal_id"),
  relevance: integer("relevance"),        // 0-100, Claude's fit to Regenera's scope
  suggestedEngagement: text("suggested_engagement"),
  decisionRead: text("decision_read"),
  status: text("status", { enum: TRIGGER_STATUSES }).notNull().default("new"),
  dismissReason: text("dismiss_reason"),
  ...timestamps,
}, t => [index("triggers_mandate_org").on(t.mandateId, t.orgId), index("triggers_status_created").on(t.status, t.createdAt)]);

export const scores = sqliteTable("scores", {
  id: id(),
  mandateId: mandateId(),
  contactId: text("contact_id").notNull(),
  fit: integer("fit").notNull(),
  trigger: integer("trigger").notNull(),
  access: integer("access").notNull(),
  total: integer("total").notNull(),
  tier: text("tier", { enum: TIERS }).notNull(),
  rationale: text("rationale", { mode: "json" }).$type<{ fit: string; trigger: string; access: string }>().notNull(),
  match: text("match", { mode: "json" }).$type<Record<string, unknown>>(),
  screeningQuadrant: text("screening_quadrant", { enum: SCREENING_QUADRANTS }),
  screening: text("screening", { mode: "json" }).$type<Record<string, unknown>>(),
  modelVersion: text("model_version").notNull(),
  scoredAt: text("scored_at").notNull().default(now),
}, t => [index("scores_mandate_contact").on(t.mandateId, t.contactId, t.scoredAt)]);

export const deals = sqliteTable("deals", {
  id: id(),
  mandateId: mandateId(),
  orgId: text("org_id"),
  contactId: text("contact_id"),
  name: text("name").notNull(),
  path: text("path", { enum: ENGAGEMENT_PATHS }).notNull(),
  stage: text("stage", { enum: keys(DEAL_STAGES) }).notNull().default("lead"),
  practice: text("practice", { enum: keys(PRACTICES) }),
  engagement: text("engagement", { enum: keys(ENGAGEMENTS) }).notNull().default("diagnostic"),
  feeType: text("fee_type", { enum: keys(FEE_TYPES) }).notNull().default("one_time"),
  feeTerms: text("fee_terms", { mode: "json" }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
  valueEstimate: real("value_estimate"),
  probability: integer("probability"),
  sector: text("sector"),
  ticket: text("ticket"),
  source: text("source", { enum: keys(LEAD_SOURCES) }).notNull().default("other"),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  lostReason: text("lost_reason"),
  notes: text("notes").notNull().default(""),
  legacyPipelineEntryId: integer("legacy_pipeline_entry_id"),
  stageChangedAt: text("stage_changed_at").notNull().default(now),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [
  uniqueIndex("deals_mandate_legacy").on(t.mandateId, t.legacyPipelineEntryId),
  index("deals_mandate_stage").on(t.mandateId, t.stage, t.nextActionDate),
  check("deals_stage_check", inList("stage", keys(DEAL_STAGES))),
]);

export const activities = sqliteTable("activities", {
  id: id(),
  mandateId: mandateId(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  dealId: text("deal_id"),
  type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
  method: text("method"),
  detail: text("detail").notNull().default(""),
  occurredAt: text("occurred_at").notNull().default(now),
  source: text("source", { enum: ["job", "calendar", "manual", "site", "import"] }).notNull().default("manual"),
  actor: text("actor"),
  createdAt: timestamps.createdAt,
}, t => [
  index("activities_mandate_contact").on(t.mandateId, t.contactId, t.occurredAt),
  index("activities_mandate_org").on(t.mandateId, t.orgId, t.occurredAt),
  index("activities_mandate_deal").on(t.mandateId, t.dealId, t.occurredAt),
]);

export const messages = sqliteTable("messages", {
  id: id(),
  mandateId: mandateId(),
  contactId: text("contact_id").notNull(),
  dealId: text("deal_id"),
  channel: text("channel", { enum: CHANNELS }).notNull().default("email"),
  direction: text("direction", { enum: ["out", "in"] }).notNull().default("out"),
  mailboxRole: text("mailbox_role", { enum: ["primary", "sending"] }).notNull().default("primary"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("draft"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  enrollmentId: text("enrollment_id"),
  step: integer("step"),
  scheduledAt: text("scheduled_at"),
  tier: text("tier", { enum: TIERS }),
  angleTag: text("angle_tag"),
  variantId: text("variant_id"),
  rfcMessageId: text("rfc_message_id"),
  styleIssues: text("style_issues", { mode: "json" }).$type<{ rule: string; detail: string }[]>(),
  gmailMessageId: text("gmail_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  error: text("error"),
  sentAt: text("sent_at"),
  ...timestamps,
}, t => [
  index("messages_status").on(t.status, t.updatedAt),
  index("messages_due").on(t.status, t.scheduledAt),
  index("messages_thread").on(t.gmailThreadId),
  index("messages_mandate_contact").on(t.mandateId, t.contactId),
  check("messages_status_check", inList("status", MESSAGE_STATUSES)),
]);

export const suppression = sqliteTable("suppression", {
  id: id(),
  email: text("email"),
  domain: text("domain"),
  reason: text("reason", { enum: ["unsubscribe", "bounce", "conflict", "legal", "manual"] }).notNull(),
  addedAt: text("added_at").notNull().default(now),
}, t => [uniqueIndex("suppression_email").on(t.email), uniqueIndex("suppression_domain").on(t.domain)]);

export const siteEvents = sqliteTable("site_events", {
  id: id(),
  mandateId: mandateId(),
  kind: text("kind", { enum: ["inquiry", "referral"] }).notNull(),
  siteId: integer("site_id").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  contactId: text("contact_id"),
  dealId: text("deal_id"),
  receivedAt: text("received_at").notNull().default(now),
  updatedAt: timestamps.updatedAt,
}, t => [uniqueIndex("site_events_kind_site").on(t.mandateId, t.kind, t.siteId)]);

export const partners = sqliteTable("partners", {
  id: id(),
  mandateId: mandateId(),
  orgId: text("org_id"),
  name: text("name").notNull(),
  email: text("email"),
  type: text("type", { enum: PARTNER_TYPES }),
  tier: text("tier", { enum: PARTNER_TIERS }).notNull().default("standard"),
  referralStatus: text("referral_status", { enum: REFERRAL_STATUSES }),
  ...timestamps,
}, t => [uniqueIndex("partners_mandate_email").on(t.mandateId, t.email)]);

export const imports = sqliteTable("imports", {
  id: id(),
  mandateId: mandateId(),
  kind: text("kind", { enum: ["csv", "tracker", "apollo"] }).notNull(),
  filename: text("filename"),
  fileKey: text("file_key"),
  mapping: text("mapping", { mode: "json" }).$type<Record<string, string>>(),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  created: integer("created").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  flagged: integer("flagged").notNull().default(0),
  status: text("status", { enum: ["pending", "processing", "done", "failed"] }).notNull().default("pending"),
  error: text("error"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
});

export const lists = sqliteTable("lists", {
  id: id(),
  mandateId: mandateId(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["people", "companies"] }).notNull(),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [uniqueIndex("lists_mandate_name").on(t.mandateId, t.kind, t.name)]);

export const listMembers = sqliteTable("list_members", {
  listId: text("list_id").notNull(),
  entityId: text("entity_id").notNull(),
  addedAt: text("added_at").notNull().default(now),
}, t => [uniqueIndex("list_members_pk").on(t.listId, t.entityId), index("list_members_entity").on(t.entityId)]);

export const savedViews = sqliteTable("saved_views", {
  id: id(),
  mandateId: mandateId(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["people", "companies"] }).notNull(),
  tab: text("tab", { enum: ["saved", "apollo"] }).notNull(),
  query: text("query").notNull(),          // URL search string of the filter state
  createdBy: text("created_by").notNull(),
  ...timestamps,
});

export const merges = sqliteTable("merges", {
  id: id(),
  entity: text("entity", { enum: ["contact", "organization"] }).notNull(),
  keptId: text("kept_id").notNull(),
  mergedId: text("merged_id").notNull(),
  before: text("before", { mode: "json" }).notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamps.createdAt,
});

export const prompts = sqliteTable("prompts", {
  id: id(),
  key: text("key").notNull(),
  version: integer("version").notNull(),
  model: text("model").notNull(),
  system: text("system").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: timestamps.createdAt,
}, t => [uniqueIndex("prompts_key_version").on(t.key, t.version)]);

export const aiRuns = sqliteTable("ai_runs", {
  id: id(),
  promptKey: text("prompt_key").notNull(),
  promptVersion: integer("prompt_version").notNull(),
  model: text("model").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  webSearches: integer("web_searches").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  status: text("status", { enum: ["ok", "invalid", "error", "refusal", "budget"] }).notNull(),
  error: text("error"),
  createdAt: timestamps.createdAt,
}, t => [index("ai_runs_created").on(t.createdAt)]);

export const providerCalls = sqliteTable("provider_calls", {
  id: id(),
  provider: text("provider").notNull(),      // apollo, gleif, wikidata, edgar, doh, site
  endpoint: text("endpoint").notNull(),
  credits: integer("credits").notNull().default(0),
  httpStatus: integer("http_status"),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  detail: text("detail"),
  createdAt: timestamps.createdAt,
}, t => [index("provider_calls_provider_created").on(t.provider, t.createdAt)]);

/** Cached responses from free public sources, keyed by provider + request. */
export const sourceCache = sqliteTable("source_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  value: text("value").notNull(),
  expiresAt: text("expires_at").notNull(),
});

/** Raw, deduplicated signals from free sources before they become triggers (SPEC sections 4 and 12a). */
export const signals = sqliteTable("signals", {
  id: id(),
  source: text("source").notNull(),            // gdelt, ted, worldbank, edgar_form_d, gdacs
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  publishedAt: text("published_at").notNull(),
  deadline: text("deadline"),
  country: text("country"),
  lat: real("lat"),
  lng: real("lng"),
  orgName: text("org_name"),
  summary: text("summary").notNull().default(""),
  queryKey: text("query_key"),
  status: text("status", { enum: ["new", "relevant", "irrelevant", "triggered", "error"] }).notNull().default("new"),
  relevance: integer("relevance"),
  ...timestamps,
}, t => [uniqueIndex("signals_source_external").on(t.source, t.externalId), index("signals_status_published").on(t.status, t.publishedAt)]);

/** Saved trigger queries: what the scanner looks for, per source, theme and region. Editable without code. */
export const triggerQueries = sqliteTable("trigger_queries", {
  id: id(),
  key: text("key").notNull().unique(),
  source: text("source").notNull(),
  label: text("label").notNull(),
  query: text("query").notNull(),
  triggerType: text("trigger_type", { enum: TRIGGER_TYPES }).notNull(),
  segmentKeys: text("segment_keys", { mode: "json" }).$type<string[]>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  lastCount: integer("last_count"),
  ...timestamps,
});
