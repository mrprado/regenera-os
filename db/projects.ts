// Project spine (docs/plans/phase-6.md M1): the physical asset, its parties, readiness, constraints and capital needs.
// Every row is mandate-scoped like the rest of the OS.
import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FieldSources } from "./crm";
import {
  ASSET_CLASSES, CAPITAL_STATUSES, CONSTRAINT_CATEGORIES, CONSTRAINT_STATUSES, IMPACT, INSTRUMENTS, LIKELIHOOD, PARTY_ROLES, PROJECT_STAGES,
  PROJECT_STATUSES, READINESS_DIMENSIONS, READINESS_STATUSES, REGENERA_ROLES, RESIDUAL, RISK_CATEGORIES, RISK_STATUSES, SEVERITIES,
} from "../lib/projects/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const projects = sqliteTable("projects", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  assetClass: text("asset_class", { enum: keys(ASSET_CLASSES) }),
  sector: text("sector"),                     // lib/vocab SECTORS
  subsector: text("subsector"),
  technology: text("technology"),
  capacity: real("capacity"),
  capacityUnit: text("capacity_unit"),        // MW, MWh, m3/day, t/yr, ha …
  capex: real("capex"),
  currency: text("currency"),
  stage: text("stage", { enum: keys(PROJECT_STAGES) }).notNull().default("opportunity"),
  status: text("status", { enum: keys(PROJECT_STATUSES) }).notNull().default("active"),
  regeneraRole: text("regenera_role", { enum: keys(REGENERA_ROLES) }),
  originationSource: text("origination_source"),
  country: text("country"),                   // ISO3 or name
  subdivision: text("subdivision"),
  municipality: text("municipality"),
  lat: real("lat"),
  lng: real("lng"),
  geometry: text("geometry"),                 // GeoJSON (polygon or line) when known
  ownerEmail: text("owner_email"),
  systems: text("systems", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`), // TERRITORIAL_SYSTEMS keys
  fieldSources: text("field_sources", { mode: "json" }).$type<FieldSources>().notNull().default(sql`'{}'`),
  stageChangedAt: text("stage_changed_at").notNull().default(now),
  archivedAt: text("archived_at"),
  ...timestamps,
}, t => [index("projects_mandate_stage").on(t.mandateId, t.stage), index("projects_country").on(t.country)]);

export const projectParties = sqliteTable("project_parties", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),
  contactId: text("contact_id"),
  role: text("role", { enum: keys(PARTY_ROLES) }).notNull(),
  confirmed: text("confirmed", { enum: ["confirmed", "proposed"] }).notNull().default("proposed"),
  note: text("note").notNull().default(""),
  ...timestamps,
}, t => [index("project_parties_project").on(t.projectId), index("project_parties_org").on(t.orgId)]);

export const projectReadiness = sqliteTable("project_readiness", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  dimension: text("dimension", { enum: keys(READINESS_DIMENSIONS) }).notNull(),
  status: text("status", { enum: keys(READINESS_STATUSES) }).notNull().default("unknown"),
  evidence: text("evidence").notNull().default(""),
  owner: text("owner"),
  updatedBy: text("updated_by"),
  ...timestamps,
}, t => [uniqueIndex("project_readiness_unique").on(t.projectId, t.dimension)]);

export const constraints = sqliteTable("constraints", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  category: text("category", { enum: keys(CONSTRAINT_CATEGORIES) }).notNull(),
  description: text("description").notNull(),
  severity: text("severity", { enum: keys(SEVERITIES) }).notNull().default("medium"),
  evidence: text("evidence").notNull().default(""),
  owner: text("owner"),
  resolutionAction: text("resolution_action").notNull().default(""),
  deadline: text("deadline"),
  dependsOn: text("depends_on"),
  status: text("status", { enum: keys(CONSTRAINT_STATUSES) }).notNull().default("open"),
  resolvedAt: text("resolved_at"),
  ...timestamps,
}, t => [index("constraints_project").on(t.projectId), index("constraints_mandate_open").on(t.mandateId, t.status, t.severity)]);

export const projectStageHistory = sqliteTable("project_stage_history", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  reason: text("reason").notNull().default(""),
  actor: text("actor"),
  at: text("at").notNull().default(now),
}, t => [index("project_stage_history_project").on(t.projectId, t.at)]);

export const capitalRequirements = sqliteTable("capital_requirements", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  purpose: text("purpose").notNull(),                // e.g. "Pre-development", "Senior debt"
  stage: text("stage", { enum: keys(PROJECT_STAGES) }),
  instrument: text("instrument", { enum: keys(INSTRUMENTS) }).notNull(),
  target: real("target"),
  minimum: real("minimum"),
  maximum: real("maximum"),
  currency: text("currency").notNull().default("USD"),
  targetClose: text("target_close"),                 // YYYY-MM-DD
  useOfFunds: text("use_of_funds").notNull().default(""),
  economics: text("economics").notNull().default(""),
  term: text("term").notNull().default(""),
  security: text("security").notNull().default(""),
  seniority: text("seniority").notNull().default(""),
  repayment: text("repayment").notNull().default(""),
  exitRefinance: text("exit_refinance").notNull().default(""),
  regulatoryStatus: text("regulatory_status").notNull().default("Not reviewed"),
  status: text("status", { enum: keys(CAPITAL_STATUSES) }).notNull().default("planned"),
  secured: real("secured").notNull().default(0),     // amount committed so far (M2 replaces with the commitment ledger)
  ...timestamps,
}, t => [index("capital_requirements_project").on(t.projectId)]);

export const capitalTranches = sqliteTable("capital_tranches", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  requirementId: text("requirement_id").notNull().references(() => capitalRequirements.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  instrument: text("instrument", { enum: keys(INSTRUMENTS) }).notNull(),
  target: real("target"),
  currency: text("currency").notNull().default("USD"),
  minParticipation: real("min_participation"),
  maxParticipation: real("max_participation"),
  economics: text("economics").notNull().default(""),
  seniority: text("seniority").notNull().default(""),
  security: text("security").notNull().default(""),
  eligibility: text("eligibility").notNull().default(""),
  targetInvestorType: text("target_investor_type").notNull().default(""),
  status: text("status", { enum: keys(CAPITAL_STATUSES) }).notNull().default("planned"),
  ...timestamps,
}, t => [index("capital_tranches_requirement").on(t.requirementId)]);

export const risks = sqliteTable("risks", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  category: text("category", { enum: keys(RISK_CATEGORIES) }).notNull(),
  description: text("description").notNull(),
  evidence: text("evidence").notNull().default(""),
  likelihood: text("likelihood", { enum: keys(LIKELIHOOD) }).notNull().default("possible"),
  impact: text("impact", { enum: keys(IMPACT) }).notNull().default("medium"),
  mitigation: text("mitigation").notNull().default(""),
  owner: text("owner"),
  trigger: text("trigger").notNull().default(""),
  status: text("status", { enum: keys(RISK_STATUSES) }).notNull().default("open"),
  residual: text("residual", { enum: keys(RESIDUAL) }).notNull().default("unknown"),
  ...timestamps,
}, t => [index("risks_project").on(t.projectId, t.status)]);
