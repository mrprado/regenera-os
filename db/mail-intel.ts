// Gmail historical intelligence (docs/plans/phase-13-mail-intelligence.md; spec: Regenera_OS_Gmail_Historical_
// Intelligence_Import_Spec.md). Three truth layers: SOURCE (mail_messages, immutable, keyed account + Gmail message id)
// → EXTRACTED FACT (mail_facts, with fact type, model, confidence, provenance, supersedes) → CANONICAL RECORD (the
// existing contacts, organizations, projects, capital profiles, deals, tasks, documents). Gmail is never modified.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const arr = <T = string>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const obj = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'{}'`);

/** A mailbox connected for read-only historical intelligence (OAuth gmail.readonly) or fed by import files. */
export const mailSources = sqliteTable("mail_sources", {
  account: text("account").primaryKey(),                  // e.g. alan@8608capitalinvestments.com
  mandateId: text("mandate_id").notNull(),                 // the workspace that owns this archive
  transport: text("transport").notNull().default("import"),   // gmail_api | import
  ownAddresses: arr("own_addresses"),                      // aliases that count as "me"
  refreshTokenEnc: text("refresh_token_enc"),              // AES-GCM, gmail.readonly only; never a password
  scopes: text("scopes").notNull().default(""),
  boundaryStart: text("boundary_start").notNull(),         // YYYY-MM-DD inclusive
  boundaryEnd: text("boundary_end").notNull(),             // YYYY-MM-DD inclusive
  includeSpamTrash: integer("include_spam_trash", { mode: "boolean" }).notNull().default(false),
  syncMode: text("sync_mode").notNull().default("backfill"),  // backfill | incremental
  historyId: text("history_id"),
  connectedBy: text("connected_by"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const mailIngestionRuns = sqliteTable("mail_ingestion_runs", {
  id: id(),
  account: text("account").notNull(),
  transport: text("transport").notNull(),
  boundaryStart: text("boundary_start").notNull(), boundaryEnd: text("boundary_end").notNull(),
  status: text("status").notNull().default("running"),     // running | complete | failed | partial
  counts: obj<Record<string, number>>("counts"),
  ingestionVersion: text("ingestion_version").notNull(), extractionModel: text("extraction_model").notNull(), schemaVersion: text("schema_version").notNull(),
  startedBy: text("started_by").notNull(),
  error: text("error"),
  startedAt: text("started_at").notNull().default(now), finishedAt: text("finished_at"),
});

/** §25 One row per source account. */
export const mailCheckpoints = sqliteTable("mail_checkpoints", {
  account: text("account").primaryKey(),
  boundaryStart: text("boundary_start").notNull(), boundaryEnd: text("boundary_end").notNull(),
  lastInternalDate: text("last_internal_date"), lastMessageId: text("last_message_id"), nextPageToken: text("next_page_token"),
  batchNumber: integer("batch_number").notNull().default(0), processed: integer("processed").notNull().default(0),
  ingestionVersion: text("ingestion_version").notNull(), extractionModel: text("extraction_model").notNull(), schemaVersion: text("schema_version").notNull(),
  status: text("status").notNull().default("idle"), error: text("error"),
  updatedAt: text("updated_at").notNull().default(now),
});

/** §4 Raw record, persisted before any interpretation. Immutable except classification columns. */
export const mailMessages = sqliteTable("mail_messages", {
  key: text("key").primaryKey(),                           // `${account}:${gmailMessageId}`
  mandateId: text("mandate_id").notNull(),
  account: text("account").notNull(),
  gmailMessageId: text("gmail_message_id").notNull(), gmailThreadId: text("gmail_thread_id").notNull(),
  internalDate: text("internal_date").notNull(),           // ISO
  fromEmail: text("from_email").notNull(), fromName: text("from_name").notNull().default(""),
  to: arr("to"), cc: arr("cc"), bcc: arr("bcc"), replyTo: text("reply_to"),
  subject: text("subject").notNull().default(""), snippet: text("snippet").notNull().default(""),
  body: text("body"),                                       // plain text (truncated at 20k chars); html is not stored
  bodyTruncated: integer("body_truncated", { mode: "boolean" }).notNull().default(false),
  direction: text("direction").notNull(),                   // sent | received
  labels: arr("labels"),
  hasAttachment: integer("has_attachment", { mode: "boolean" }).notNull().default(false),
  attachmentIds: arr("attachment_ids"),
  inReplyTo: text("in_reply_to"), references: text("references"),
  displayUrl: text("display_url"),
  rawHash: text("raw_hash").notNull(),
  batchId: text("batch_id").notNull(),
  // Interpretation (model-derived; never overwrites the source columns above)
  mailClass: text("mail_class").notNull().default("unclassified"),
  classBasis: text("class_basis").notNull().default(""),
  campaignId: text("campaign_id"),
  quotedOnly: integer("quoted_only", { mode: "boolean" }).notNull().default(false),
  ingestedAt: text("ingested_at").notNull().default(now),
}, t => [index("mail_messages_thread").on(t.account, t.gmailThreadId, t.internalDate), index("mail_messages_class").on(t.mandateId, t.mailClass, t.internalDate), index("mail_messages_from").on(t.fromEmail)]);

/** §5 Thread state. A thread can relate to many entities / projects. */
export const mailThreads = sqliteTable("mail_threads", {
  key: text("key").primaryKey(),                            // `${account}:${gmailThreadId}`
  mandateId: text("mandate_id").notNull(),
  account: text("account").notNull(), gmailThreadId: text("gmail_thread_id").notNull(),
  subject: text("subject").notNull().default(""),
  firstAt: text("first_at").notNull(), lastAt: text("last_at").notNull(),
  messageCount: integer("message_count").notNull().default(0), sentCount: integer("sent_count").notNull().default(0), receivedCount: integer("received_count").notNull().default(0),
  participants: arr("participants"),
  mailClass: text("mail_class").notNull().default("unclassified"),
  state: text("state").notNull().default("identified"),       // ENGAGEMENT_STATES
  lastDirection: text("last_direction"),
  awaitingReplyFrom: text("awaiting_reply_from"),              // me | them | null
  summary: text("summary").notNull().default(""),
  orgIds: arr("org_ids"), contactIds: arr("contact_ids"), projectIds: arr("project_ids"), dealIds: arr("deal_ids"),
  extractedAt: text("extracted_at"), extractionModel: text("extraction_model"),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("mail_threads_last").on(t.mandateId, t.mailClass, t.lastAt)]);

/** §6, §8 Every address in the corpus; promoted to a CRM contact only when it is a real counterparty. */
export const mailPeople = sqliteTable("mail_people", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  aliases: arr("aliases"),
  domain: text("domain").notNull(),
  contactId: text("contact_id"), orgId: text("org_id"),
  kind: text("kind").notNull().default("person"),            // person | system | list
  firstAt: text("first_at"), lastAt: text("last_at"),
  sentCount: integer("sent_count").notNull().default(0), receivedCount: integer("received_count").notNull().default(0),
  replyCount: integer("reply_count").notNull().default(0), meetingCount: integer("meeting_count").notNull().default(0), docsCount: integer("docs_count").notNull().default(0),
  engagementState: text("engagement_state").notNull().default("identified"),
  relationshipStage: text("relationship_stage").notNull().default("target"),  // target → transactional
  strength: text("strength").notNull().default("none"),        // none | weak | moderate | strong
  commercialStage: text("commercial_stage").notNull().default("none"),
  relevance: text("relevance").notNull().default("unknown"),
  responseQuality: text("response_quality").notNull().default("none"),
  evidence: arr<{ at: string; what: string; messageKey: string }>("evidence"),
  origin: text("origin").notNull().default(""),              // cold_outreach | inbound | introduction | campaign | existing
  lowSignal: integer("low_signal", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [uniqueIndex("mail_people_email").on(t.mandateId, t.email), index("mail_people_state").on(t.mandateId, t.engagementState)]);

/** §9 Campaigns reconstructed from outbound mail with a shared template. */
export const mailCampaigns = sqliteTable("mail_campaigns", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  account: text("account").notNull(),
  name: text("name").notNull(),
  purpose: text("purpose").notNull().default(""),
  assetPromoted: text("asset_promoted").notNull().default(""),
  templateHash: text("template_hash").notNull(),
  subjectTemplate: text("subject_template").notNull(),
  startedAt: text("started_at").notNull(), endedAt: text("ended_at").notNull(),
  counts: obj<Record<string, number>>("counts"),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [uniqueIndex("mail_campaigns_template").on(t.account, t.templateHash)]);

export const mailCampaignRecipients = sqliteTable("mail_campaign_recipients", {
  id: id(),
  campaignId: text("campaign_id").notNull(),
  email: text("email").notNull(),
  personId: text("person_id"),
  firstSentAt: text("first_sent_at").notNull(), lastContactAt: text("last_contact_at").notNull(),
  followUps: integer("follow_ups").notNull().default(0),
  replied: integer("replied", { mode: "boolean" }).notNull().default(false),
  responseType: text("response_type").notNull().default("none"),
  meetingHeld: integer("meeting_held", { mode: "boolean" }).notNull().default(false),
  materialsShared: integer("materials_shared", { mode: "boolean" }).notNull().default(false),
  commercialStage: text("commercial_stage").notNull().default("cold_emailed"),
  messageKeys: arr("message_keys"),
}, t => [uniqueIndex("mail_campaign_recipients_pair").on(t.campaignId, t.email)]);

/** §19 Extracted facts. Never overwritten: a changed value supersedes the prior fact. */
export const mailFacts = sqliteTable("mail_facts", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type").notNull(),                 // person | organization | project | capital_provider | deal | thread
  entityId: text("entity_id"),
  entityLabel: text("entity_label").notNull(),
  field: text("field").notNull(),
  value: text("value").notNull(),
  factType: text("fact_type").notNull(),                     // explicit | derived | hypothesis
  effectiveDate: text("effective_date"),
  sourceMessageKey: text("source_message_key").notNull(),
  sourceAttachmentId: text("source_attachment_id"),
  model: text("model").notNull(),
  confidence: real("confidence").notNull(),
  supersedesId: text("supersedes_id"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("mail_facts_entity").on(t.entityType, t.entityId, t.field), index("mail_facts_source").on(t.sourceMessageKey)]);

/** §16 Commitments and requests, split by direction; firm vs conditional kept. */
export const mailObligations = sqliteTable("mail_obligations", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind").notNull(),                              // commitment | request
  byMe: integer("by_me", { mode: "boolean" }).notNull(),     // Alan made it (commitment) / asked it (request)
  actor: text("actor").notNull(), counterparty: text("counterparty").notNull(),
  text: text("text").notNull(),
  firm: integer("firm", { mode: "boolean" }).notNull().default(true),
  dueDate: text("due_date"),
  status: text("status").notNull().default("open"),          // open | done | superseded | dropped
  confidence: real("confidence").notNull(),
  projectId: text("project_id"), taskId: text("task_id"),
  sourceMessageKey: text("source_message_key").notNull(),
  createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now),
}, t => [index("mail_obligations_open").on(t.mandateId, t.kind, t.status)]);

/** §15 */
export const mailIntroductions = sqliteTable("mail_introductions", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  introducerEmail: text("introducer_email").notNull(), introducedEmail: text("introduced_email"), introducedOrg: text("introduced_org"),
  date: text("date").notNull(), context: text("context").notNull().default(""),
  projectId: text("project_id"), resultingState: text("resulting_state").notNull().default("identified"),
  sourceMessageKey: text("source_message_key").notNull(),
}, t => [uniqueIndex("mail_introductions_key").on(t.sourceMessageKey, t.introducedEmail)]);

/** §17 Attachments are first-class; the original stays in Gmail (reference kept). */
export const mailAttachments = sqliteTable("mail_attachments", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  messageKey: text("message_key").notNull(),
  attachmentId: text("attachment_id").notNull(),
  filename: text("filename").notNull(), mimeType: text("mime_type").notNull().default(""), size: integer("size"),
  documentType: text("document_type").notNull().default("other"),
  confidentiality: text("confidentiality").notNull().default("unknown"),
  ndaCovered: text("nda_covered").notNull().default("unknown"),
  documentId: text("document_id"), projectId: text("project_id"),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("mail_attachments_key").on(t.messageKey, t.attachmentId)]);

/** §33 Human review queue. */
export const mailReviewItems = sqliteTable("mail_review_items", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind").notNull(),                              // merge | conflict | org_match | financial_fact | mandate | nda | stage_change | project_collision
  title: text("title").notNull(),
  detail: obj<Record<string, unknown>>("detail"),
  sourceMessageKey: text("source_message_key"),
  status: text("status").notNull().default("open"),          // open | accepted | rejected
  resolvedBy: text("resolved_by"), resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("mail_review_items_open").on(t.mandateId, t.status)]);
