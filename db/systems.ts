// Systems and interventions (master build instruction §20–21). Not an ESG dashboard: each assessment follows
// baseline → dependencies → impacts → thresholds → risks → opportunities → interventions → future state, and is
// translated into development, operating, permitting, cost and capital implications. No composite score.
import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { INTERVENTION_STATUSES, INTERVENTION_TYPES, SYSTEM_CATEGORIES } from "../lib/systems/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const systemAssessments = sqliteTable("system_assessments", {
  id: id(),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  category: text("category", { enum: keys(SYSTEM_CATEGORIES) }).notNull(),
  baseline: text("baseline").notNull().default(""),
  dependencies: text("dependencies").notNull().default(""),
  impacts: text("impacts").notNull().default(""),
  thresholds: text("thresholds").notNull().default(""),
  risks: text("risks").notNull().default(""),
  opportunities: text("opportunities").notNull().default(""),
  futureState: text("future_state").notNull().default(""),
  // Translation into what matters for the asset and its capital (§20).
  capacity: text("capacity", { enum: ["unknown", "ample", "adequate", "constrained", "exceeded"] }).notNull().default("unknown"),
  implications: text("implications", { mode: "json" }).$type<Partial<Record<"durability" | "development" | "operating" | "permitting" | "capital" | "cost", string>>>().notNull().default(sql`'{}'`),
  frameworks: text("frameworks", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`), // reference mapping only (TNFD, IFC PS, ISSB)
  sources: text("sources").notNull().default(""),
  status: text("status", { enum: ["draft", "reviewed"] }).notNull().default("draft"),
  reviewer: text("reviewer"),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, t => [index("system_assessments_project").on(t.projectId, t.category)]);

export const interventions = sqliteTable("interventions", {
  id: id(),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  assessmentId: text("assessment_id"),
  systemIssue: text("system_issue").notNull(),
  description: text("description").notNull().default(""),
  implementationType: text("implementation_type", { enum: keys(INTERVENTION_TYPES) }).notNull().default("other"),
  costEstimate: real("cost_estimate"),
  currency: text("currency").notNull().default("USD"),
  costBasis: text("cost_basis").notNull().default(""),       // where the estimate comes from
  expectedOutcome: text("expected_outcome").notNull().default(""),
  financialRelevance: text("financial_relevance").notNull().default(""),
  riskReduction: text("risk_reduction").notNull().default(""),
  riskId: text("risk_id"),
  fundingPathway: text("funding_pathway").notNull().default(""),
  capitalRequirementId: text("capital_requirement_id"),
  partnerOrgId: text("partner_org_id"),
  evidence: text("evidence").notNull().default(""),
  status: text("status", { enum: keys(INTERVENTION_STATUSES) }).notNull().default("proposed"),
  ...timestamps,
}, t => [index("interventions_project").on(t.projectId, t.status)]);
