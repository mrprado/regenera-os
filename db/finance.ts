// Financial models (financial modeling and underwriting extension): versioned definitions, stored outputs summary,
// approval and lock, financeability status set by people (never by AI), and an assumption change log with reasons.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ModelDefinition } from "../lib/finance/types";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const FIN_MODEL_STATUSES = ["draft", "in_review", "approved", "locked", "superseded"] as const;
export const FIN_CASE_TYPES = ["screening", "sponsor", "investment", "lender", "investor", "financial_close", "internal"] as const;
export const FINANCEABILITY = ["screening", "economic_not_bankable", "structurable", "lender_review", "financeable_subject_to_conditions", "financial_close"] as const;

export const finModels = sqliteTable("fin_models", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  template: text("template").notNull().default("custom"),
  version: integer("version").notNull().default(1),
  parentId: text("parent_id"),                 // previous version
  caseType: text("case_type", { enum: FIN_CASE_TYPES }).notNull().default("screening"),
  status: text("status", { enum: FIN_MODEL_STATUSES }).notNull().default("draft"),
  financeability: text("financeability", { enum: FINANCEABILITY }).notNull().default("screening"),
  definition: text("definition", { mode: "json" }).$type<ModelDefinition>().notNull(),
  summary: text("summary", { mode: "json" }).$type<Record<string, number | string | null>>().notNull().default(sql`'{}'`),
  health: text("health").notNull().default("REVIEW"),
  preparedBy: text("prepared_by"), reviewedBy: text("reviewed_by"), approvedBy: text("approved_by"),
  approvedAt: text("approved_at"), lockedAt: text("locked_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("fin_models_project").on(t.projectId, t.version)]);

export const finChanges = sqliteTable("fin_changes", {
  id: id(),
  modelId: text("model_id").notNull(),
  path: text("path").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  reason: text("reason").notNull().default(""),
  actor: text("actor").notNull(),
  at: text("at").notNull().default(now),
}, t => [index("fin_changes_model").on(t.modelId, t.at)]);
