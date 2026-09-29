// Capital structures (stack scenarios) and funding pathways (master build instruction §10–11). A structure is a
// scenario for one project; its layers carry instrument, provider, amount, pricing, tenor, security, status and how
// well each input is supported. Funding pathways are routes to specific capital sources with eligibility and steps.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ASSUMPTION_STATUSES, ELIGIBILITY_STATUSES_KEYS, LAYER_STATUSES, PATHWAY_SOURCES, PATHWAY_STATUSES, REVIEW_STATUSES, STACK_LAYERS, STRUCTURE_STATUSES, type PathwayStep } from "../lib/capital/structure-vocab";
import { projects } from "./projects";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const capitalStructures = sqliteTable("capital_structures", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  basedOnId: text("based_on_id"),                 // scenario copied from
  currency: text("currency").notNull().default("USD"),
  totalCost: real("total_cost"),                  // uses of funds the stack must cover
  costSource: text("cost_source").notNull().default(""),
  status: text("status", { enum: keys(STRUCTURE_STATUSES) }).notNull().default("draft"),
  reviewStatus: text("review_status", { enum: keys(REVIEW_STATUSES) }).notNull().default("not_reviewed"),
  reviewNote: text("review_note").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by"),
  ...timestamps,
}, t => [index("capital_structures_project").on(t.projectId)]);

export const capitalStackLayers = sqliteTable("capital_stack_layers", {
  id: id(),
  structureId: text("structure_id").notNull().references(() => capitalStructures.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  layer: text("layer", { enum: keys(STACK_LAYERS) }).notNull(),
  provider: text("provider").notNull().default(""),
  providerOrgId: text("provider_org_id"),
  requirementId: text("requirement_id"),          // link to the project's capital requirement, when one exists
  currency: text("currency").notNull().default("USD"),
  amount: real("amount"),
  pricing: text("pricing").notNull().default(""), // e.g. "SOFR + 350 bp", "12% pref"
  ratePct: real("rate_pct"),                      // all-in rate for weighting, when known
  tenorYears: real("tenor_years"),
  amortization: text("amortization").notNull().default(""),
  security: text("security").notNull().default(""),
  status: text("status", { enum: keys(LAYER_STATUSES) }).notNull().default("assumption"),
  conditions: text("conditions").notNull().default(""),
  source: text("source").notNull().default(""),
  assumptionStatus: text("assumption_status", { enum: keys(ASSUMPTION_STATUSES) }).notNull().default("assumption"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, t => [index("capital_stack_layers_structure").on(t.structureId)]);

export const fundingPathways = sqliteTable("funding_pathways", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  sourceType: text("source_type", { enum: keys(PATHWAY_SOURCES) }).notNull(),
  provider: text("provider").notNull().default(""),
  providerOrgId: text("provider_org_id"),
  fundingOpportunityId: text("funding_opportunity_id"), // a call/tender from Funding radar
  capitalProfileId: text("capital_profile_id"),
  requirementId: text("requirement_id"),
  structureLayerId: text("structure_layer_id"),
  amount: real("amount"),
  currency: text("currency").notNull().default("USD"),
  status: text("status", { enum: keys(PATHWAY_STATUSES) }).notNull().default("identified"),
  eligibility: text("eligibility", { enum: ELIGIBILITY_STATUSES_KEYS }).notNull().default("unknown"),
  eligibilityNotes: text("eligibility_notes").notNull().default(""),
  eligibilitySource: text("eligibility_source").notNull().default(""),
  deadline: text("deadline"),                     // YYYY-MM-DD
  steps: text("steps", { mode: "json" }).$type<PathwayStep[]>().notNull().default(sql`'[]'`),
  owner: text("owner"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("funding_pathways_project").on(t.projectId), index("funding_pathways_deadline").on(t.mandateId, t.deadline)]);
