// Phase 23: Origination & Integrity Engine. Versioned policies, auditable decisions (never rewritten by a new policy),
// findings, impact records (baseline · forecast · target · reported · verified), stewardship obligations and redesign
// scenarios. Additive; nothing here touches commercial pipeline stages.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const DECISION_STATES = ["eligible", "conditionally_eligible", "redesign_required", "enhanced_due_diligence", "insufficient_evidence", "excluded", "human_review"] as const;
export const CLASSIFICATIONS = ["regenerative_core", "transition_enabling", "conditional_redesign", "restricted_excluded"] as const;

export const originationPolicies = sqliteTable("origination_policies", {
  id: id(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "published", "retired"] }).notNull().default("published"),
  rules: text("rules", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  notes: text("notes").notNull().default(""),
  publishedBy: text("published_by").notNull(),
  publishedAt: text("published_at").notNull().default(now),
}, t => [uniqueIndex("origination_policies_version").on(t.version)]);

export type RuleHit = { rule: string; outcome: "pass" | "concern" | "fail" | "unknown"; basis: string; evidence?: string | null };
export type Reading = { key: string; label: string; value: string; basis: string };

export const policyDecisions = sqliteTable("policy_decisions", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  policyVersion: integer("policy_version").notNull(),
  classification: text("classification", { enum: CLASSIFICATIONS }).notNull(),
  state: text("state", { enum: DECISION_STATES }).notNull(),
  readings: text("readings", { mode: "json" }).$type<Reading[]>().notNull(),
  rules: text("rules", { mode: "json" }).$type<RuleHit[]>().notNull(),
  confidence: text("confidence", { enum: ["low", "medium", "high"] }).notNull(),
  outstanding: text("outstanding", { mode: "json" }).$type<string[]>().notNull(),
  remediation: text("remediation", { mode: "json" }).$type<string[]>().notNull(),
  decidedBy: text("decided_by").notNull(),
  nextReviewAt: text("next_review_at"),
  current: integer("current", { mode: "boolean" }).notNull().default(true),
  overrides: text("overrides", { mode: "json" }).$type<{ at: string; by: string; from: string; to: string; reason: string }[]>().notNull().default(sql`'[]'`),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("policy_decisions_project").on(t.projectId, t.current), index("policy_decisions_state").on(t.state, t.current)]);

export const integrityFindings = sqliteTable("integrity_findings", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  decisionId: text("decision_id").notNull(),
  kind: text("kind", { enum: ["concern", "uncertainty", "conflict", "positive"] }).notNull(),
  domain: text("domain").notNull(),                 // climate · land · water · biodiversity · resources · community · governance · commercial
  text: text("text").notNull(),
  source: text("source").notNull().default(""),
  provenance: text("provenance", { enum: ["verified", "official", "third_party", "regenera_model", "user_claim", "ai_hypothesis", "missing"] }).notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("integrity_findings_project").on(t.projectId, t.decisionId)]);

export const impactRecords = sqliteTable("impact_records", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  indicator: text("indicator").notNull(),          // lib/integrity/indicators.ts key
  kind: text("kind", { enum: ["baseline", "forecast", "target", "reported", "verified"] }).notNull(),
  value: real("value"),
  unit: text("unit").notNull(),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  method: text("method").notNull().default(""),
  source: text("source").notNull().default(""),
  verifiedBy: text("verified_by"),                 // third party for "verified" (Regenera is not a verification body)
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("impact_records_project").on(t.projectId, t.indicator)]);

export const stewardshipObligations = sqliteTable("stewardship_obligations", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["monitoring", "reporting", "benefit_sharing", "conservation", "maintenance", "verification"] }).notNull(),
  dueAt: text("due_at"),
  recurrenceMonths: integer("recurrence_months"),
  status: text("status", { enum: ["open", "done", "overdue", "waived"] }).notNull().default("open"),
  owner: text("owner"),
  indicator: text("indicator"),
  evidence: text("evidence").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("stewardship_due").on(t.status, t.dueAt)]);

export const redesignScenarios = sqliteTable("redesign_scenarios", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  version: integer("version").notNull(),
  variant: text("variant", { enum: ["original", "lower_impact", "regenerative"] }).notNull(),
  options: text("options", { mode: "json" }).$type<{ key: string; label: string; effect: string }[]>().notNull(),
  comparison: text("comparison", { mode: "json" }).$type<{ dimension: string; change: string; basis: "modelled" | "assumption" | "unknown" }[]>().notNull(),
  assumptions: text("assumptions", { mode: "json" }).$type<string[]>().notNull(),
  status: text("status", { enum: ["draft", "approved", "applied", "rejected"] }).notNull().default("draft"),
  decidedBy: text("decided_by"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("redesign_scenarios_project").on(t.projectId, t.version)]);
