// Operational playbooks (master build instruction §22–23): Process + Toolbox + Proof + Governance, versioned; runs
// against an entity with machine-verifiable definitions of done; corrections that improve the playbook durably.
// (Distinct from playbook_drafts, which are outreach message templates.)
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { PlaybookDefinition } from "../lib/playbooks/types";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const MATURITY = ["draft", "tested", "validated", "trusted", "automated"] as const;
export const RUN_STATUSES = ["running", "needs_review", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export const FAILURE_LAYERS = ["process", "toolbox", "proof"] as const;
export const CORRECTION_SCOPES = ["one_time", "process_rule", "toolbox_update", "proof_check"] as const;

export const playbooks = sqliteTable("playbooks", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  entityType: text("entity_type", { enum: ["project", "organization", "capital_opportunity", "deal", "document", "none"] }).notNull().default("project"),
  maturity: text("maturity", { enum: MATURITY }).notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(1),
  owner: text("owner"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [uniqueIndex("playbooks_key").on(t.mandateId, t.key)]);

export const playbookVersions = sqliteTable("playbook_versions", {
  id: id(),
  playbookId: text("playbook_id").notNull().references(() => playbooks.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  definition: text("definition", { mode: "json" }).$type<PlaybookDefinition>().notNull(),
  status: text("status", { enum: ["draft", "approved", "superseded", "rejected"] }).notNull().default("draft"),
  changeNote: text("change_note").notNull().default(""),
  proposedBy: text("proposed_by").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("playbook_versions_unique").on(t.playbookId, t.version)]);

export type StepState = { key: string; status: "todo" | "done" | "skipped" | "failed"; note: string; by: string | null; at: string | null };
export type CheckResult = { id: string; text: string; pass: boolean | null; detail: string };

export const playbookRuns = sqliteTable("playbook_runs", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  playbookId: text("playbook_id").notNull().references(() => playbooks.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  entityLabel: text("entity_label").notNull().default(""),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
  steps: text("steps", { mode: "json" }).$type<StepState[]>().notNull(),
  checks: text("checks", { mode: "json" }).$type<CheckResult[]>().notNull().default(sql`'[]'`),
  startedBy: text("started_by").notNull(),
  reviewedBy: text("reviewed_by"),
  approvedBy: text("approved_by"),
  completedAt: text("completed_at"),
  ...timestamps,
}, t => [index("playbook_runs_entity").on(t.entityType, t.entityId), index("playbook_runs_status").on(t.mandateId, t.status)]);

export const playbookCorrections = sqliteTable("playbook_corrections", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  playbookId: text("playbook_id").notNull().references(() => playbooks.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  failureLayer: text("failure_layer", { enum: FAILURE_LAYERS }).notNull(),
  scope: text("scope", { enum: CORRECTION_SCOPES }).notNull(),
  description: text("description").notNull(),
  change: text("change").notNull().default(""),
  fingerprint: text("fingerprint").notNull(),
  proposedVersion: integer("proposed_version"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("playbook_corrections_playbook").on(t.playbookId, t.fingerprint)]);
