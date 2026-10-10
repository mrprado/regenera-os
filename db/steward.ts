// Steward (docs/plans/phase-28-steward-ecosystem.md, stage 28A). Places, care, budgets, outcomes and assessments,
// workspace-scoped like everything else. Communities, knowledge, consent, grievances and commitments stay in
// db/community.ts; obligations and impact records in db/integrity.ts. Nothing here is generated from examples.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ASSESSMENT_DIMENSIONS, ASSESSMENT_STATUS, CARE_ACTION_STATUS, CARE_PLAN_STATUS, FUNDING_STAGES, GEOMETRY_ACCURACY, MEASUREMENT_KIND, OUTCOME_DIMENSIONS,
  PLACE_LINK_RELATIONS, PLACE_STATUS, REVIEW_STATUS,
} from "../lib/steward/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const stamps = { createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const stewardPlaces = sqliteTable("steward_places", {
  id: id(), mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(), description: text("description").notNull().default(""),
  country: text("country"), region: text("region").notNull().default(""),
  geometry: json<Record<string, unknown>>("geometry"),                       // GeoJSON geometry, current version
  geometryAccuracy: text("geometry_accuracy", { enum: keys(GEOMETRY_ACCURACY) }).notNull().default("unknown"),
  areaHa: real("area_ha"),                                                   // geodesic, only for polygons; null for points
  status: text("status", { enum: keys(PLACE_STATUS) }).notNull().default("baseline_needed"),
  watershedNote: text("watershed_note").notNull().default(""),
  responsible: text("responsible"),                                         // person accountable for care
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false), // generalise geometry for non-owners
  ...stamps,
}, t => [index("steward_places_mandate").on(t.mandateId)]);

/** Every geometry the place has had, with its accuracy and source: a boundary is never silently replaced. */
export const stewardPlaceGeometries = sqliteTable("steward_place_geometries", {
  id: id(), mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(),
  geometry: json<Record<string, unknown>>("geometry").notNull(), accuracy: text("accuracy", { enum: keys(GEOMETRY_ACCURACY) }).notNull(),
  source: text("source").notNull().default(""), areaHa: real("area_ha"), note: text("note").notNull().default(""),
  recordedBy: text("recorded_by").notNull(), recordedAt: text("recorded_at").notNull().default(now),
}, t => [index("steward_place_geometries_place").on(t.placeId)]);

/** Many-to-many: a place can have several projects and several communities, including contested claims. */
export const stewardPlaceLinks = sqliteTable("steward_place_links", {
  id: id(), mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(),
  entityType: text("entity_type", { enum: ["project", "community"] }).notNull(), entityId: text("entity_id").notNull(),
  relation: text("relation", { enum: keys(PLACE_LINK_RELATIONS) }).notNull().default("other"), note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("steward_place_links_unique").on(t.placeId, t.entityType, t.entityId, t.relation), index("steward_place_links_entity").on(t.entityType, t.entityId)]);

export const carePlans = sqliteTable("care_plans", {
  id: id(), mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(), projectId: text("project_id"),
  title: text("title").notNull(), objective: text("objective").notNull().default(""), baseline: text("baseline").notNull().default(""),
  owner: text("owner"), status: text("status", { enum: keys(CARE_PLAN_STATUS) }).notNull().default("draft"),
  startDate: text("start_date"), reviewDate: text("review_date"), monitoringProtocol: text("monitoring_protocol").notNull().default(""),
  permissionsNote: text("permissions_note").notNull().default(""), revision: integer("revision").notNull().default(1),
  ...stamps,
}, t => [index("care_plans_place").on(t.placeId)]);

export const careActions = sqliteTable("care_actions", {
  id: id(), mandateId: text("mandate_id").notNull(), planId: text("plan_id").notNull(),
  title: text("title").notNull(), description: text("description").notNull().default(""),
  owner: text("owner"), dueDate: text("due_date"), season: text("season").notNull().default(""),
  dependsOn: text("depends_on"),                                             // another care action
  monitoringMethod: text("monitoring_method").notNull().default(""),
  budgetId: text("budget_id"),
  // A knowledge record and activity this action needs permission for; checked before it can start.
  requiresKnowledgeId: text("requires_knowledge_id"), requiresActivity: text("requires_activity"),
  status: text("status", { enum: keys(CARE_ACTION_STATUS) }).notNull().default("planned"),
  completionEvidence: text("completion_evidence").notNull().default(""), completedAt: text("completed_at"), completedBy: text("completed_by"),
  ...stamps,
}, t => [index("care_actions_plan").on(t.planId), index("care_actions_due").on(t.mandateId, t.status, t.dueDate)]);

/** A budget for a place or plan over a period, in one currency. Amounts live in funding allocations by stage. */
export const stewardshipBudgets = sqliteTable("stewardship_budgets", {
  id: id(), mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(), planId: text("plan_id"),
  label: text("label").notNull(), periodStart: text("period_start"), periodEnd: text("period_end"),
  currency: text("currency").notNull().default("USD"), required: real("required").notNull().default(0), notes: text("notes").notNull().default(""),
  ...stamps,
}, t => [index("stewardship_budgets_place").on(t.placeId)]);

export const fundingAllocations = sqliteTable("funding_allocations", {
  id: id(), mandateId: text("mandate_id").notNull(), budgetId: text("budget_id").notNull(),
  source: text("source").notNull(), stage: text("stage", { enum: keys(FUNDING_STAGES) }).notNull(),
  amount: real("amount").notNull(), currency: text("currency").notNull(),
  date: text("date"), evidence: text("evidence").notNull().default(""), agreementRef: text("agreement_ref").notNull().default(""),
  ...stamps,
}, t => [index("funding_allocations_budget").on(t.budgetId)]);

export const stewardIndicators = sqliteTable("steward_indicators", {
  id: id(), mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(),
  dimension: text("dimension", { enum: keys(OUTCOME_DIMENSIONS) }).notNull(), name: text("name").notNull(),
  unit: text("unit").notNull(), method: text("method").notNull().default(""), geography: text("geography").notNull().default(""),
  target: real("target"), targetNote: text("target_note").notNull().default(""), frequency: text("frequency").notNull().default(""), owner: text("owner"),
  ...stamps,
}, t => [index("steward_indicators_place").on(t.placeId)]);

export const stewardMeasurements = sqliteTable("steward_measurements", {
  id: id(), mandateId: text("mandate_id").notNull(), indicatorId: text("indicator_id").notNull(),
  kind: text("kind", { enum: keys(MEASUREMENT_KIND) }).notNull().default("measurement"),
  value: real("value").notNull(), periodStart: text("period_start").notNull(), periodEnd: text("period_end"),
  uncertainty: text("uncertainty").notNull().default(""), evidence: text("evidence").notNull(), sourceRef: text("source_ref").notNull().default(""),
  observedBy: text("observed_by").notNull(), reviewer: text("reviewer"), reviewStatus: text("review_status", { enum: keys(REVIEW_STATUS) }).notNull().default("unreviewed"),
  limitations: text("limitations").notNull().default(""), recordedAt: text("recorded_at").notNull().default(now),
}, t => [index("steward_measurements_indicator").on(t.indicatorId, t.periodStart)]);

/** One row per change: the latest row per place and dimension is current, earlier rows are history. */
export const stewardAssessments = sqliteTable("steward_assessments", {
  id: id(), mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(),
  dimension: text("dimension", { enum: keys(ASSESSMENT_DIMENSIONS) }).notNull(), status: text("status", { enum: keys(ASSESSMENT_STATUS) }).notNull(),
  basis: text("basis").notNull(), evidenceRef: text("evidence_ref").notNull().default(""), scope: text("scope").notNull().default(""),
  assessedBy: text("assessed_by").notNull(), assessedAt: text("assessed_at").notNull().default(now),
}, t => [index("steward_assessments_place").on(t.placeId, t.dimension, t.assessedAt)]);
