// Capital alignment and nature transition: assessments of dependencies, impacts, financial drivers and transition
// pathways (each item carries its evidence), nature-adjusted scenarios, subsidy and incentive intelligence, and
// financial flow mapping for a system. Classifications are made by people with a stated basis, never inferred.
import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ALIGNMENT, FLOW_SECTORS, INCENTIVE_CLASS, INCENTIVE_SECTORS, MECHANISMS, NATURE_RISK, REDIRECTABLE, SUBJECT_TYPES } from "../lib/alignment/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type NatureItem = { id: string; kind: string; materiality: "low" | "medium" | "high" | "unknown"; description: string; metric?: string; value?: number | null; unit?: string; evidence: string; source?: string };
export type PathwayItem = { id: string; kind: string; description: string; capexDeltaPct?: number | null; impactDeltaPct?: number | null; evidence: string };

export const natureAssessments = sqliteTable("nature_assessments", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  subjectType: text("subject_type", { enum: keys(SUBJECT_TYPES) }).notNull().default("project"),
  projectId: text("project_id"),
  orgId: text("org_id"),
  capitalAmount: real("capital_amount"),        // capital the assessment covers (defaults to project capex)
  currency: text("currency").notNull().default("USD"),
  alignment: text("alignment", { enum: keys(ALIGNMENT) }).notNull().default("unclassified"),
  alignmentBasis: text("alignment_basis").notNull().default(""),
  classifiedBy: text("classified_by"),
  classifiedAt: text("classified_at"),
  dependencies: text("dependencies", { mode: "json" }).$type<NatureItem[]>().notNull().default(sql`'[]'`),
  impacts: text("impacts", { mode: "json" }).$type<NatureItem[]>().notNull().default(sql`'[]'`),
  drivers: text("drivers", { mode: "json" }).$type<NatureItem[]>().notNull().default(sql`'[]'`),
  pathways: text("pathways", { mode: "json" }).$type<PathwayItem[]>().notNull().default(sql`'[]'`),
  siteBaseline: text("site_baseline", { mode: "json" }).$type<Record<string, unknown> | null>(),
  summary: text("summary").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("nature_assessments_project").on(t.projectId), index("nature_assessments_mandate").on(t.mandateId)]);

export const natureScenarios = sqliteTable("nature_scenarios", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  assessmentId: text("assessment_id").notNull(),
  name: text("name").notNull(),
  configuration: text("configuration").notNull().default(""),
  finModelId: text("fin_model_id"),             // when linked, CAPEX and IRR come from the model's stored outputs
  capex: real("capex"),
  irrPct: real("irr_pct"),
  habitatLossHa: real("habitat_loss_ha"),
  restorationHa: real("restoration_ha"),
  waterDemandM3: real("water_demand_m3"),
  natureRisk: text("nature_risk", { enum: keys(NATURE_RISK) }).notNull().default("unknown"),
  // Monetised nature economics: only counted where a methodology is stated.
  mitigationCost: real("mitigation_cost"), restorationCost: real("restoration_cost"), transitionCost: real("transition_cost"),
  environmentalLiability: real("environmental_liability"), naturalCapitalRevenue: real("natural_capital_revenue"), avoidedRisk: real("avoided_risk"),
  methodology: text("methodology").notNull().default(""),
  finance: text("finance").notNull().default(""), // e.g. "Biodiversity finance potential; concessional capital potential"
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("nature_scenarios_assessment").on(t.assessmentId)]);

export const incentives = sqliteTable("incentives", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  country: text("country").notNull(),
  subdivision: text("subdivision"),
  name: text("name").notNull(),
  sector: text("sector", { enum: keys(INCENTIVE_SECTORS) }).notNull(),
  mechanism: text("mechanism", { enum: keys(MECHANISMS) }).notNull(),
  policyRef: text("policy_ref").notNull().default(""),
  beneficiary: text("beneficiary").notNull().default(""),
  economicEffect: text("economic_effect").notNull().default(""),
  environmentalEvidence: text("environmental_evidence").notNull().default(""),
  annualValue: real("annual_value"),
  currency: text("currency").notNull().default("USD"),
  classification: text("classification", { enum: keys(INCENTIVE_CLASS) }).notNull().default("unclassified"),
  classifiedBy: text("classified_by"),
  sourceUrl: text("source_url"),
  asOf: text("as_of"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("incentives_country").on(t.country, t.sector)]);

export const capitalFlows = sqliteTable("capital_flows", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  system: text("system").notNull(),             // watershed, region or landscape name
  projectId: text("project_id"),
  sector: text("sector", { enum: keys(FLOW_SECTORS) }).notNull(),
  description: text("description").notNull().default(""),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  year: text("year"),
  alignment: text("alignment", { enum: keys(ALIGNMENT) }).notNull().default("unclassified"),
  alignmentBasis: text("alignment_basis").notNull().default(""),
  redirectable: text("redirectable", { enum: keys(REDIRECTABLE) }).notNull().default("unknown"),
  source: text("source").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("capital_flows_system").on(t.mandateId, t.system)]);
