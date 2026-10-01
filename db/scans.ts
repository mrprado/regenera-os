// Shared scanning engine and account qualification (docs/plans/phase-15-command-scans.md). One background scan
// architecture serves every section (organizations, people, prospecting, capital, partners, intelligence, funding,
// mandates, projects) through audience presets. A scan produces reviewable records, never outreach or opportunities.
// Every row is workspace-scoped (mandate_id) like all other data.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const obj = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'{}'`);
const arr = <T>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const SCAN_STATUSES = ["queued", "running", "partial", "completed", "failed", "cancelled"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];
export type ScanStage = { key: string; label: string; status: "pending" | "running" | "done" | "skipped" | "failed"; detail?: string; done?: number; total?: number | null };
export type ProviderStatus = { provider: string; status: "ok" | "not_connected" | "skipped" | "failed" | "limited"; detail: string; calls?: number; credits?: number };
export type ScanCounts = { found: number; new: number; existing: number; duplicates: number; matching: number; partial: number; excluded: number; needsReview: number; people: number; usableRoutes: number; providerFailures: number };
export type CriterionResult = { key: string; label: string; result: "supported" | "contradicted" | "unknown"; evidence: string; source?: string };

export const scanPresets = sqliteTable("scan_presets", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  section: text("section").notNull(),                     // SCAN_SECTIONS
  audience: text("audience").notNull(),                   // AUDIENCES key
  config: obj<Record<string, unknown>>("config"),        // ScanConfig (lib/scan/config.ts)
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  note: text("note").notNull().default(""),
  createdBy: text("created_by"),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [uniqueIndex("scan_presets_mandate_key").on(t.mandateId, t.key)]);

export const scanRuns = sqliteTable("scan_runs", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  presetId: text("preset_id"),
  presetName: text("preset_name").notNull().default(""),
  objectiveId: text("objective_id"),                       // the objective this scan serves (null = a preset scan)
  section: text("section").notNull(),
  audience: text("audience").notNull(),
  config: obj<Record<string, unknown>>("config"),
  status: text("status", { enum: SCAN_STATUSES }).notNull().default("queued"),
  stages: arr<ScanStage>("stages"),
  providers: arr<ProviderStatus>("providers"),
  counts: obj<ScanCounts>("counts"),
  creditsUsed: integer("credits_used").notNull().default(0),
  creditCeiling: integer("credit_ceiling").notNull().default(0),
  checkpoint: obj<Record<string, unknown>>("checkpoint"),  // resumable cursor: stage, provider page, org offset
  idempotencyKey: text("idempotency_key").notNull(),
  fallbackAccepted: integer("fallback_accepted", { mode: "boolean" }).notNull().default(false),
  error: text("error"),
  retryGuidance: text("retry_guidance"),
  requestedBy: text("requested_by").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  cancelledAt: text("cancelled_at"),
  ...timestamps,
}, t => [
  uniqueIndex("scan_runs_idempotency").on(t.mandateId, t.idempotencyKey),
  index("scan_runs_mandate_status").on(t.mandateId, t.status, t.createdAt),
]);

export const scanResults = sqliteTable("scan_results", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  runId: text("run_id").notNull(),
  // organization / person for discovery; project, funding_call, queue_project, procurement for opportunity matching.
  entityType: text("entity_type", { enum: ["organization", "person", "funding_call", "candidate", "project", "queue_project", "procurement"] }).notNull(),
  entityId: text("entity_id").notNull(),
  name: text("name").notNull(),
  outcome: text("outcome", { enum: ["new", "existing", "duplicate", "excluded"] }).notNull(),
  match: text("match", { enum: ["matches", "partial", "unknown", "excluded"] }).notNull(),
  criteria: arr<CriterionResult>("criteria"),
  missing: arr<string>("missing"),
  exclusionReason: text("exclusion_reason"),
  provider: text("provider").notNull(),
  sourceUrl: text("source_url"),
  retrievedAt: text("retrieved_at").notNull(),
  identityConflicts: arr<string>("identity_conflicts"),
  confidence: text("confidence"),                          // evidence confidence, separate from match quality
  caveats: arr<string>("caveats"),
  nextAction: text("next_action"),
  review: text("review", { enum: ["needs_review", "accepted", "rejected"] }).notNull().default("needs_review"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, t => [
  uniqueIndex("scan_results_run_entity").on(t.runId, t.entityType, t.entityId),
  index("scan_results_mandate_entity").on(t.mandateId, t.entityType, t.entityId),
]);

export const QUALIFICATION_STATUSES = ["discovered", "criteria_matched", "human_reviewed", "ready_for_outreach", "engaged", "qualified_opportunity", "disqualified", "parked"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];
export type DimensionReading = { reading: "strong" | "partial" | "weak" | "unknown"; basis: string; source?: string; at?: string; by?: string };
export type QualificationEvent = { from: string; to: string; at: string; by: string; reason: string };

/** One row per organization per workspace: where the account stands, on six separate dimensions (never one score). */
export const accountQualifications = sqliteTable("account_qualifications", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  audience: text("audience"),
  status: text("status", { enum: QUALIFICATION_STATUSES }).notNull().default("discovered"),
  dimensions: obj<Record<string, DimensionReading>>("dimensions"),
  rubricVersion: text("rubric_version").notNull(),
  criteria: arr<{ key: string; label: string; result: "supported" | "contradicted" | "unknown"; evidence: string; source?: string }>("criteria"),
  who: text("who").notNull().default(""),                // who it is
  decision: text("decision").notNull().default(""),      // relevant decision or project
  whyNow: text("why_now").notNull().default(""),
  entryOffer: text("entry_offer").notNull().default(""),
  nextAction: text("next_action").notNull().default(""),
  disqualifyReason: text("disqualify_reason"),
  firstRunId: text("first_run_id"),
  lastRunId: text("last_run_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  history: arr<QualificationEvent>("history"),
  ...timestamps,
}, t => [
  uniqueIndex("account_qualifications_org").on(t.mandateId, t.orgId),
  index("account_qualifications_status").on(t.mandateId, t.status),
]);
