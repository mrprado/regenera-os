// Site intelligence runs: a staged background pipeline per project. Each stage keeps its own status, summary, facts,
// sources and error, so results appear progressively and one failing provider never blocks the others.
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type StageFact = { label: string; value: string; source: string };
export type StageState = { key: string; status: "queued" | "running" | "done" | "failed" | "skipped"; startedAt?: string; finishedAt?: string; summary?: string; facts?: StageFact[]; error?: string };

export const siteIntelRuns = sqliteTable("site_intel_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(),
  status: text("status", { enum: ["queued", "running", "complete", "partial"] }).notNull().default("queued"),
  stages: text("stages", { mode: "json" }).$type<StageState[]>().notNull(),
  geometryHash: text("geometry_hash").notNull().default(""), startedBy: text("started_by").notNull(),
  createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now), finishedAt: text("finished_at"),
}, t => [index("site_intel_runs_project").on(t.projectId, t.createdAt)]);

// Cached Earth Engine results: never recomputed on page open; invalidated by geometry, parameters or analysis version.
export const eeResults = sqliteTable("ee_results", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(),
  analysis: text("analysis").notNull(), params: text("params").notNull().default(""), geometryHash: text("geometry_hash").notNull(), analysisVersion: text("analysis_version").notNull(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>().notNull(), dataset: text("dataset").notNull().default(""), scaleM: text("scale_m").notNull().default(""),
  generatedAt: text("generated_at").notNull().default(now), expiresAt: text("expires_at"),
}, t => [index("ee_results_key").on(t.projectId, t.analysis, t.geometryHash)]);

// Site embeddings (AlphaEarth annual, 64 dims) for landscape similarity. Backend-only; never shown as raw numbers.
export const siteEmbeddings = sqliteTable("site_embeddings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), year: text("year").notNull(),
  source: text("source").notNull(), vector: text("vector", { mode: "json" }).$type<number[]>().notNull(), geometryHash: text("geometry_hash").notNull(),
  analysisVersion: text("analysis_version").notNull(), generatedAt: text("generated_at").notNull().default(now),
}, t => [index("site_embeddings_project").on(t.projectId, t.year)]);
