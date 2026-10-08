// Funding ↔ project matches (phase 21 §4): open or forthcoming funding records matched to Regenera projects by hard
// gates (geography listed or global, sector, deadline) before anything else. Every match keeps its reasons; people
// accept or dismiss. A match is not eligibility: the reasons say what is still unknown.
import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const fundingProjectMatches = sqliteTable("funding_project_matches", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  projectId: text("project_id").notNull(),
  geography: text("geography", { enum: ["listed", "global"] }).notNull(),
  reasons: text("reasons", { mode: "json" }).$type<{ met: string[]; unknown: string[] }>().notNull(),
  status: text("status", { enum: ["proposed", "accepted", "dismissed"] }).notNull().default("proposed"),
  // Phase 22: hard-gate eligibility outcome (never a score), each check with its basis, soft factors kept separate.
  eligibility: text("eligibility", { enum: ["eligible", "potentially_eligible", "ineligible", "insufficient_evidence", "expired_or_closed"] }),
  checks: text("checks", { mode: "json" }).$type<{ rule: string; result: "pass" | "fail" | "unknown"; basis: string }[]>(),
  soft: text("soft", { mode: "json" }).$type<{ factor: string; note: string }[]>(),
  questions: text("questions", { mode: "json" }).$type<string[]>(),
  capitalStage: text("capital_stage", { enum: ["development", "construction", "long_term"] }),
  decidedBy: text("decided_by"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [uniqueIndex("funding_project_matches_pair").on(t.opportunityId, t.projectId), index("funding_project_matches_project").on(t.projectId, t.status)]);
