// Phase 22 origination engine: market-first hypotheses and the unified origination queue. Additive. Funding ↔ project
// eligibility lives on funding_project_matches (eligibility, checks, soft factors, capital stage).
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** A market-first development thesis. Always a HYPOTHESIS: never shown or counted as a project until a person converts it. */
export const originationHypotheses = sqliteTable("origination_hypotheses", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(),
  title: text("title").notNull(),
  thesis: text("thesis").notNull(),
  country: text("country"),                         // ISO3; the region the thesis is about (no invented coordinates)
  sector: text("sector"),
  evidence: text("evidence", { mode: "json" }).$type<{ kind: string; id: string; label: string; url?: string | null; date?: string | null }[]>().notNull(),
  counterparts: text("counterparts", { mode: "json" }).$type<{ orgId: string; name: string; why: string }[]>().notNull().default(sql`'[]'`),
  validation: text("validation", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  status: text("status", { enum: ["to_validate", "validated", "converted", "dismissed"] }).notNull().default("to_validate"),
  dedupeKey: text("dedupe_key").notNull(),
  convertedProjectId: text("converted_project_id"),
  decidedBy: text("decided_by"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("origination_hypotheses_status").on(t.status, t.createdAt), index("origination_hypotheses_dedupe").on(t.dedupeKey)]);

/** One queue for all three entrances. Stage follows the directive's commercial lifecycle; value is computed from real records. */
export const originationItems = sqliteTable("origination_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(),
  entrance: text("entrance", { enum: ["capital_first", "project_first", "market_first"] }).notNull(),
  strategy: text("strategy", { enum: ["existing_project", "site_asset", "needs_based", "funding_match", "client_need"] }).notNull(),
  title: text("title").notNull(),
  projectId: text("project_id"), opportunityId: text("opportunity_id"), hypothesisId: text("hypothesis_id"), orgId: text("org_id"), matchId: text("match_id"),
  stage: text("stage").notNull().default("discovered"),
  recommendedService: text("recommended_service"),   // services catalogue key
  serviceReason: text("service_reason"),
  expectedValueUsd: real("expected_value_usd"),       // band midpoint × evidence factors; never revenue
  valueBasis: text("value_basis"),
  priority: integer("priority").notNull().default(0),
  nextAction: text("next_action"),
  engagementId: text("engagement_id"), dossierId: text("dossier_id"), proposalId: text("proposal_id"),
  owner: text("owner"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("origination_items_stage").on(t.stage, t.priority), index("origination_items_dedupe").on(t.dedupeKey)]);
