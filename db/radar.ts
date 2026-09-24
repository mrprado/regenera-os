// Phase 3 radar and reach (docs/plans/phase-3.md): saved searches, public list diffs, extension tokens, reports.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const SAVED_SEARCH_KINDS = ["apollo_people", "apollo_orgs", "xray", "salesnav"] as const;

export const savedSearches = sqliteTable("saved_searches", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: SAVED_SEARCH_KINDS }).notNull(),
  segmentId: text("segment_id"),
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>(), // Apollo filters
  query: text("query"),                                                     // X-ray or Sales Navigator Boolean
  region: text("region"),
  cadence: text("cadence").notNull().default("weekly:mon:06:00"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  lastNew: integer("last_new"),
  createdBy: text("created_by").notNull().default("system"),
  ...timestamps,
}, t => [uniqueIndex("saved_searches_key").on(t.mandateId, t.key)]);

/** Results a saved search found that are not yet in the CRM. Reviewed on People or Companies. */
export const searchResults = sqliteTable("search_results", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  savedSearchId: text("saved_search_id").notNull(),
  kind: text("kind", { enum: ["person", "org"] }).notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  subtitle: text("subtitle"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["new", "saved", "dismissed"] }).notNull().default("new"),
  foundAt: text("found_at").notNull().default(now),
}, t => [uniqueIndex("search_results_key").on(t.savedSearchId, t.externalId), index("search_results_status").on(t.mandateId, t.status)]);

export const listSources = sqliteTable("list_sources", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  leadSource: text("lead_source").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  baselineAt: text("baseline_at"),
  lastRunAt: text("last_run_at"),
  lastCount: integer("last_count"),
  lastNew: integer("last_new"),
  lastError: text("last_error"),
});

/** Every entry ever seen on a public list; a new key on a later run is a "new entry". */
export const listEntries = sqliteTable("list_entries", {
  id: id(),
  sourceKey: text("source_key").notNull(),
  entryKey: text("entry_key").notNull(),
  name: text("name").notNull(),
  country: text("country"),
  sector: text("sector"),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  isNew: integer("is_new", { mode: "boolean" }).notNull().default(false),
  orgId: text("org_id"),
  firstSeenAt: text("first_seen_at").notNull().default(now),
}, t => [uniqueIndex("list_entries_key").on(t.sourceKey, t.entryKey), index("list_entries_new").on(t.sourceKey, t.isNew, t.firstSeenAt)]);

export const extensionTokens = sqliteTable("extension_tokens", {
  id: id(),
  userEmail: text("user_email").notNull(),
  tokenHash: text("token_hash").notNull(),
  label: text("label").notNull().default("Chrome"),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("extension_tokens_hash").on(t.tokenHash)]);

export const reports = sqliteTable("reports", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind", { enum: ["weekly"] }).notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  metrics: text("metrics", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  body: text("body", { mode: "json" }).$type<Record<string, unknown>>(),
  emailedAt: text("emailed_at"),
  ...timestamps,
}, t => [uniqueIndex("reports_period").on(t.mandateId, t.kind, t.periodStart)]);
