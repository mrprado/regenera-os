// Phase 2 automation (docs/plans/phase-2.md): sequences, enrollments, replies, tasks, mailbox state,
// relationship metadata and deliverability checks.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { ENROLLMENT_STATUSES_ALL, REPLY_CLASSES, TIERS } from "../lib/vocab";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type SequenceStep = { day: number; channel: "email" | "linkedin_connect" | "linkedin_message"; purpose: string; angle?: string };

export const sequences = sqliteTable("sequences", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  tier: text("tier", { enum: TIERS }).notNull(),
  segmentId: text("segment_id"),
  steps: text("steps", { mode: "json" }).$type<SequenceStep[]>().notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, t => [uniqueIndex("sequences_mandate_key").on(t.mandateId, t.key)]);

export const enrollments = sqliteTable("enrollments", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  contactId: text("contact_id").notNull(),
  orgId: text("org_id"),
  sequenceId: text("sequence_id").notNull(),
  status: text("status", { enum: ENROLLMENT_STATUSES_ALL }).notNull().default("drafting"),
  currentStep: integer("current_step").notNull().default(0),
  startAt: text("start_at").notNull(),
  stopReason: text("stop_reason"),
  enrolledBy: text("enrolled_by").notNull(),
  ...timestamps,
}, t => [
  index("enrollments_contact").on(t.contactId, t.status),
  index("enrollments_org").on(t.orgId, t.status),
  // One active enrollment per contact (SPEC section 21), enforced by a partial unique index.
  uniqueIndex("enrollments_one_active").on(t.contactId).where(sql`status in ('drafting','active','paused')`),
]);

export const replies = sqliteTable("replies", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  messageId: text("message_id"),
  gmailMessageId: text("gmail_message_id").notNull(),
  gmailThreadId: text("gmail_thread_id"),
  fromEmail: text("from_email").notNull(),
  subject: text("subject").notNull().default(""),
  snippet: text("snippet").notNull().default(""),
  body: text("body").notNull().default(""),
  receivedAt: text("received_at").notNull(),
  classification: text("classification", { enum: REPLY_CLASSES }),
  sentiment: text("sentiment"),
  extracted: text("extracted", { mode: "json" }).$type<Record<string, unknown>>(),
  suggestedResponse: text("suggested_response"),
  needsHuman: integer("needs_human", { mode: "boolean" }).notNull().default(true),
  handled: integer("handled", { mode: "boolean" }).notNull().default(false),
  testRecord: integer("test_record", { mode: "boolean" }).notNull().default(false), // fixture/test data: kept, but out of metrics and work queues
  ...timestamps,
}, t => [uniqueIndex("replies_gmail").on(t.gmailMessageId), index("replies_handled").on(t.handled, t.receivedAt)]);

export const tasks = sqliteTable("tasks", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  dealId: text("deal_id"),
  projectId: text("project_id"),            // physical project this row is about (phase 6)
  enrollmentId: text("enrollment_id"),
  messageId: text("message_id"),
  type: text("type", { enum: ["linkedin_connect", "linkedin_message", "call", "follow_up", "meeting_notes", "other"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  dueAt: text("due_at").notNull(),
  status: text("status", { enum: ["open", "done", "skipped"] }).notNull().default("open"),
  completedAt: text("completed_at"),
  owner: text("owner"),                       // member email; null = unassigned
  workstream: text("workstream"),             // groups related tasks (one bid = one workstream)
  testRecord: integer("test_record", { mode: "boolean" }).notNull().default(false), // fixture/test data: kept, but out of metrics and work queues
  ...timestamps,
}, t => [index("tasks_status_due").on(t.status, t.dueAt)]);

export const mailboxState = sqliteTable("mailbox_state", {
  role: text("role", { enum: ["primary", "sending"] }).primaryKey(),
  day: text("day").notNull(),                 // ET date the counter belongs to
  sentToday: integer("sent_today").notNull().default(0),
  pausedUntil: text("paused_until"),
  pauseReason: text("pause_reason"),
  historyId: text("history_id"),              // Gmail history cursor for the reply watcher
  calendarSyncedAt: text("calendar_synced_at"),
  updatedAt: timestamps.updatedAt,
});

/** Gmail/Calendar metadata only (never bodies): who at Regenera has corresponded with whom, and when. */
export const relationships = sqliteTable("relationships", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  email: text("email").notNull(),
  domain: text("domain").notNull(),
  mailbox: text("mailbox").notNull(),
  emailsSent: integer("emails_sent").notNull().default(0),
  emailsReceived: integer("emails_received").notNull().default(0),
  meetings: integer("meetings").notNull().default(0),
  lastContactAt: text("last_contact_at"),
  strength: real("strength").notNull().default(0),
  ...timestamps,
}, t => [uniqueIndex("relationships_key").on(t.mandateId, t.email, t.mailbox), index("relationships_domain").on(t.domain)]);

export const deliverabilityChecks = sqliteTable("deliverability_checks", {
  id: id(),
  domain: text("domain").notNull(),
  spf: integer("spf", { mode: "boolean" }).notNull(),
  dmarc: text("dmarc"),                       // policy: none / quarantine / reject / missing
  dkim: integer("dkim", { mode: "boolean" }).notNull(),
  mx: integer("mx", { mode: "boolean" }).notNull(),
  bounceRate: real("bounce_rate"),
  complaints: integer("complaints").notNull().default(0),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  checkedAt: text("checked_at").notNull().default(now),
}, t => [index("deliverability_domain").on(t.domain, t.checkedAt)]);

export const meetingBriefs = sqliteTable("meeting_briefs", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  eventId: text("event_id").notNull(),
  contactId: text("contact_id"),
  orgId: text("org_id"),
  dealId: text("deal_id"),
  title: text("title").notNull(),
  startsAt: text("starts_at").notNull(),
  brief: text("brief", { mode: "json" }).$type<Record<string, unknown>>(),
  ...timestamps,
}, t => [uniqueIndex("meeting_briefs_event").on(t.mandateId, t.eventId)]);
