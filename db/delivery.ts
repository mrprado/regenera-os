// Project delivery (docs/plans/phase-6.md M7): milestones with dependencies (critical path), decisions, engineering
// studies, design packages and code requirements, environmental and social issues, insurance. Mandate-scoped.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  DECISION_STATUSES, DESIGN_STAGES, DESIGN_STATUSES, DISCIPLINES, ENG_REQ_STATUSES, ES_FRAMEWORKS, ES_STATUSES, ES_TOPICS,
  INSURANCE_PHASES, INSURANCE_STATUSES, INSURANCE_TYPES, MILESTONE_CATEGORIES, MILESTONE_STATUSES, MITIGATION_STEPS, STUDY_STATUSES, STUDY_TYPES,
} from "../lib/delivery/vocab";
import { SEVERITIES } from "../lib/projects/vocab";
import { projects } from "./projects";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };
const projectId = () => text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" });

export const projectMilestones = sqliteTable("project_milestones", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: keys(MILESTONE_CATEGORIES) }).notNull().default("other"),
  durationDays: integer("duration_days").notNull().default(0), // work needed once its dependencies are done
  dueDate: text("due_date"),                                     // committed or contractual date (YYYY-MM-DD)
  dependsOn: text("depends_on", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  status: text("status", { enum: keys(MILESTONE_STATUSES) }).notNull().default("planned"),
  completedAt: text("completed_at"),
  owner: text("owner"),
  evidence: text("evidence").notNull().default(""),              // e.g. "PPA clause 7.2"
  contractId: text("contract_id"),
  obligationId: text("obligation_id"),
  constraintId: text("constraint_id"),
  isTarget: integer("is_target", { mode: "boolean" }).notNull().default(false), // e.g. financial close, COD
  ...timestamps,
}, t => [index("project_milestones_project").on(t.projectId), index("project_milestones_due").on(t.mandateId, t.status, t.dueDate)]);

export const decisions = sqliteTable("decisions", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  title: text("title").notNull(),
  context: text("context").notNull().default(""),
  options: text("options").notNull().default(""),
  decision: text("decision").notNull().default(""),
  rationale: text("rationale").notNull().default(""),
  decidedBy: text("decided_by"),
  decidedAt: text("decided_at"),
  dueDate: text("due_date"),
  status: text("status", { enum: keys(DECISION_STATUSES) }).notNull().default("open"),
  evidence: text("evidence").notNull().default(""),
  ...timestamps,
}, t => [index("decisions_project").on(t.projectId, t.status)]);

export const studies = sqliteTable("studies", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  type: text("type", { enum: keys(STUDY_TYPES) }).notNull(),
  title: text("title").notNull().default(""),
  status: text("status", { enum: keys(STUDY_STATUSES) }).notNull().default("not_started"),
  providerOrgId: text("provider_org_id"),
  provider: text("provider"),
  cost: real("cost"),
  currency: text("currency").notNull().default("USD"),
  dueDate: text("due_date"),
  completedAt: text("completed_at"),
  findings: text("findings").notNull().default(""),
  reviewer: text("reviewer"),
  reviewedAt: text("reviewed_at"),
  documentId: text("document_id"),
  ...timestamps,
}, t => [index("studies_project").on(t.projectId, t.type)]);

export const designPackages = sqliteTable("design_packages", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  stage: text("stage", { enum: keys(DESIGN_STAGES) }).notNull(),
  discipline: text("discipline", { enum: keys(DISCIPLINES) }).notNull(),
  status: text("status", { enum: keys(DESIGN_STATUSES) }).notNull().default("planned"),
  engineer: text("engineer"),              // firm or engineer of record
  issuedAt: text("issued_at"),
  approvedBy: text("approved_by"),
  documentId: text("document_id"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("design_packages_project").on(t.projectId)]);

export const engineeringRequirements = sqliteTable("engineering_requirements", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  discipline: text("discipline", { enum: keys(DISCIPLINES) }).notNull(),
  standard: text("standard").notNull(),    // e.g. "IEC 62446-1", "NOM-001-SEDE-2012"
  version: text("version").notNull().default(""),
  jurisdiction: text("jurisdiction"),
  authority: text("authority"),
  source: text("source").notNull().default(""),
  effectiveDate: text("effective_date"),
  lastVerified: text("last_verified"),
  reviewer: text("reviewer"),
  status: text("status", { enum: keys(ENG_REQ_STATUSES) }).notNull().default("identified"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("engineering_requirements_project").on(t.projectId)]);

export const esIssues = sqliteTable("es_issues", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  topic: text("topic", { enum: keys(ES_TOPICS) }).notNull(),
  framework: text("framework", { enum: keys(ES_FRAMEWORKS) }).notNull().default("host_law"),
  reference: text("reference").notNull().default(""),       // e.g. "IFC PS6 para 16", "LGEEPA art. 28"
  description: text("description").notNull(),
  severity: text("severity", { enum: keys(SEVERITIES) }).notNull().default("medium"),
  mitigationStep: text("mitigation_step", { enum: keys(MITIGATION_STEPS) }).notNull().default("none"),
  mitigation: text("mitigation").notNull().default(""),
  owner: text("owner"),
  dueDate: text("due_date"),
  evidence: text("evidence").notNull().default(""),
  status: text("status", { enum: keys(ES_STATUSES) }).notNull().default("identified"),
  ...timestamps,
}, t => [index("es_issues_project").on(t.projectId, t.status)]);

export const insurancePolicies = sqliteTable("insurance_policies", {
  id: id(),
  projectId: projectId(),
  mandateId: text("mandate_id").notNull(),
  type: text("type", { enum: keys(INSURANCE_TYPES) }).notNull(),
  phase: text("phase", { enum: keys(INSURANCE_PHASES) }).notNull().default("construction"),
  status: text("status", { enum: keys(INSURANCE_STATUSES) }).notNull().default("required"),
  insurer: text("insurer"),
  broker: text("broker"),
  coverageLimit: real("coverage_limit"),
  deductible: real("deductible"),
  premium: real("premium"),
  currency: text("currency").notNull().default("USD"),
  startsAt: text("starts_at"),
  expiresAt: text("expires_at"),
  lenderRequirement: text("lender_requirement").notNull().default(""),
  ...timestamps,
}, t => [index("insurance_project").on(t.projectId), index("insurance_expiry").on(t.mandateId, t.status, t.expiresAt)]);
