// Domain events, rule-driven triggers, notifications and stage gates (master build instruction §09, §12, §17, §62,
// §75). Events are append-only facts; trigger rules turn them into notifications, tasks, playbook runs or jobs.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CheckSpec } from "../lib/playbooks/types";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const events = sqliteTable("events", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  type: text("type").notNull(),                 // PROJECT_STAGE_CHANGED, BROKER_REFERRAL_SUBMITTED …
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  actor: text("actor").notNull(),
  processedAt: text("processed_at"),
  at: text("at").notNull().default(now),
}, t => [index("events_unprocessed").on(t.processedAt, t.at), index("events_entity").on(t.entityType, t.entityId)]);

export type RuleCondition = { field: string; op: "eq" | "neq" | "in" | "gte" | "lte" | "contains"; value: string | number | string[] };
export type RuleAction =
  | { type: "notify"; priority: "critical" | "action" | "information"; category: string; title: string; to?: string | null }
  | { type: "task"; title: string; dueDays?: number }
  | { type: "playbook"; key: string }
  | { type: "job"; job: "capital.rematch" };

export const triggerRules = sqliteTable("trigger_rules", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  eventType: text("event_type").notNull(),
  conditions: text("conditions", { mode: "json" }).$type<RuleCondition[]>().notNull().default(sql`'[]'`),
  actions: text("actions", { mode: "json" }).$type<RuleAction[]>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  owner: text("owner"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  lastRunAt: text("last_run_at"),
  lastResult: text("last_result").notNull().default(""),
  runs: integer("runs").notNull().default(0),
  ...timestamps,
}, t => [index("trigger_rules_event").on(t.mandateId, t.eventType, t.enabled)]);

export const NOTIFICATION_CATEGORIES = ["project", "capital", "deal", "relationship", "intelligence", "compliance", "document", "contract", "broker", "partner", "playbook", "system"] as const;

export const notifications = sqliteTable("notifications", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  recipient: text("recipient"),                  // email; null = every member of the entity
  category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),
  priority: text("priority", { enum: ["critical", "action", "information"] }).notNull().default("information"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  link: text("link"),
  eventId: text("event_id"),
  ruleId: text("rule_id"),
  assignedTo: text("assigned_to"),
  readAt: text("read_at"),
  resolvedAt: text("resolved_at"),
  snoozedUntil: text("snoozed_until"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("notifications_open").on(t.mandateId, t.resolvedAt, t.createdAt)]);

export const notificationMutes = sqliteTable("notification_mutes", {
  id: id(),
  email: text("email").notNull(),
  category: text("category").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/** Requirements to enter a stage. Checks reuse the playbook proof checks, so a gate is evidence, not narrative. */
export const stageGates = sqliteTable("stage_gates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type", { enum: ["project", "deal"] }).notNull().default("project"),
  toStage: text("to_stage").notNull(),
  conditions: text("conditions", { mode: "json" }).$type<{ id: string; text: string; check: CheckSpec; scope?: "deal" | "project"; paths?: string[] }[]>().notNull(),
  enforce: text("enforce", { enum: ["block", "warn"] }).notNull().default("block"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, t => [index("stage_gates_stage").on(t.mandateId, t.entityType, t.toStage)]);
