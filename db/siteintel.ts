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
