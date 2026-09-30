// Commercial operations: service catalogue, engagements (scope, workstreams, deliverables, schedule, change orders),
// invoices, expenses, time, partners and vendors, account connections (no secrets) and corporate entities.
// Regenera advisory economics are kept here, separate from project investment economics (lib/finance).
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { BUILD_CATEGORIES, ENGAGEMENT_TYPES, ENTRY_POINTS, PRODUCT_CLASSES, PRODUCT_ITEM_KINDS, PRODUCT_STATUSES, REVENUE_CATEGORIES, WORK_MANDATE_STATUSES, WORKSTREAM_KINDS, WORKSTREAM_STATUSES, ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, BILLING_TYPES, CONFLICT_STATES, DEPTHS, ENGAGEMENT_STATUSES, ENTITY_KINDS, EXPENSE_CATEGORIES, EXPENSE_CLASSES, INVOICE_STATUSES, LIFECYCLE_PHASES, PARTNER_KINDS, REGENERA_ROLES, SERVICE_FAMILIES } from "../lib/commercial/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'[]'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const services = sqliteTable("services", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  key: text("key").notNull(),
  family: text("family", { enum: keys(SERVICE_FAMILIES) }).notNull(),
  name: text("name").notNull(),
  depth: text("depth", { enum: keys(DEPTHS) }).notNull().default("standard"),
  description: text("description").notNull().default(""),
  idealClient: text("ideal_client").notNull().default(""),
  stages: json<string[]>("stages"), inputs: json<string[]>("inputs"), deliverables: json<string[]>("deliverables"), workflow: json<string[]>("workflow"),
  specialistRequired: json<string[]>("specialist_required"), nextServices: json<string[]>("next_services"),
  timelineWeeks: integer("timeline_weeks").notNull().default(4),
  billingType: text("billing_type", { enum: keys(BILLING_TYPES) }).notNull().default("fixed"),
  currency: text("currency").notNull().default("USD"),
  listPrice: real("list_price"), minPrice: real("min_price"), bandLow: real("band_low"), bandHigh: real("band_high"),
  perMonth: integer("per_month", { mode: "boolean" }).notNull().default(false),
  expectedHours: real("expected_hours").notNull().default(0), expectedExternalCost: real("expected_external_cost").notNull().default(0),
  targetMarginPct: real("target_margin_pct").notNull().default(55),
  role: text("role", { enum: keys(REGENERA_ROLES) }).notNull().default("advisory"),
  phase: text("phase", { enum: keys(LIFECYCLE_PHASES) }).notNull().default("p1"),
  approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(false),
  legalNotes: text("legal_notes").notNull().default(""),
  portalAccess: text("portal_access", { enum: ["none", "deliverables", "full"] }).notNull().default("deliverables"),
  ownerEmail: text("owner_email"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [uniqueIndex("services_key").on(t.mandateId, t.key, t.depth)]);

export type Discovery = { problem?: string; decision?: string; objective?: string; assets?: string; team?: string; currentSystems?: string; painPoints?: string; dataAvailability?: string; capitalSituation?: string; deadline?: string; budget?: string; buyingAuthority?: string; urgency?: string; estimatedValue?: number | null; likelyScope?: string; nextAction?: string; recordedAt?: string; recordedBy?: string };
export type Deliverable = { id: string; label: string; status: string; due: string | null; serviceKey?: string };
export type PaymentLine = { id: string; label: string; amount: number; due: string | null; invoiceId?: string | null };
export type ChangeOrder = { id: string; reason: string; description: string; fee: number; weeks: number; status: "proposed" | "approved" | "rejected"; approvedBy?: string | null; at: string };
export type PartnerLine = { orgId?: string | null; name: string; role: string; cost: number; share?: string };

export const engagements = sqliteTable("engagements", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  orgId: text("org_id"), projectId: text("project_id"), dealId: text("deal_id"), contractId: text("contract_id"), entityId: text("entity_id"),
  status: text("status", { enum: keys(ENGAGEMENT_STATUSES) }).notNull().default("prospect"),
  source: text("source").notNull().default(""),
  scope: text("scope").notNull().default(""),
  assumptions: text("assumptions").notNull().default(""),
  exclusions: text("exclusions").notNull().default(""),
  clientResponsibilities: text("client_responsibilities").notNull().default(""),
  workstreams: json<string[]>("workstreams"),                         // service keys
  deliverables: json<Deliverable[]>("deliverables"),
  paymentSchedule: json<PaymentLine[]>("payment_schedule"),
  changeOrders: json<ChangeOrder[]>("change_orders"),
  partners: json<PartnerLine[]>("partners"),
  team: json<string[]>("team"),
  billingType: text("billing_type", { enum: keys(BILLING_TYPES) }).notNull().default("fixed"),
  currency: text("currency").notNull().default("USD"),
  fee: real("fee").notNull().default(0),                                  // contract value (one-time part)
  monthlyFee: real("monthly_fee").notNull().default(0),
  months: integer("months").notNull().default(0),
  paymentTerms: text("payment_terms").notNull().default("Net 30"),
  probabilityPct: real("probability_pct"),                                // override of the stage default
  expectedHours: real("expected_hours").notNull().default(0),
  expectedExternalCost: real("expected_external_cost").notNull().default(0),
  hourlyCost: real("hourly_cost"),                                        // internal cost rate for margin (user-set)
  startDate: text("start_date"), endDate: text("end_date"),
  owner: text("owner"),
  conflictStatus: text("conflict_status", { enum: keys(CONFLICT_STATES) }).notNull().default("unchecked"),
  conflictNote: text("conflict_note").notNull().default(""),
  kycRequired: integer("kyc_required", { mode: "boolean" }).notNull().default(false),
  approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(false),
  approvedBy: text("approved_by"),
  portalEnabled: integer("portal_enabled", { mode: "boolean" }).notNull().default(false),
  nextService: text("next_service"),
  lostReason: text("lost_reason"),
  // Client lifecycle (phase 10)
  tenantId: text("tenant_id"),
  engagementType: text("engagement_type", { enum: keys(ENGAGEMENT_TYPES) }),
  revenueCategory: text("revenue_category", { enum: keys(REVENUE_CATEGORIES) }),
  entryPoint: text("entry_point", { enum: keys(ENTRY_POINTS) }),
  discovery: text("discovery", { mode: "json" }).$type<Discovery>().notNull().default(sql`'{}'`),
  renewalDate: text("renewal_date"),
  reportingCadence: text("reporting_cadence").notNull().default(""),
  sla: text("sla").notNull().default(""),
  successCriteria: text("success_criteria").notNull().default(""),
  includedModules: json<string[]>("included_modules"),
  ...timestamps,
}, t => [index("engagements_mandate_status").on(t.mandateId, t.status), index("engagements_org").on(t.orgId), index("engagements_project").on(t.projectId)]);

export const invoices = sqliteTable("invoices", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  engagementId: text("engagement_id").notNull(),
  number: text("number").notNull(),
  status: text("status", { enum: keys(INVOICE_STATUSES) }).notNull().default("draft"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  issueDate: text("issue_date"), dueDate: text("due_date"),
  paidAmount: real("paid_amount").notNull().default(0), paidAt: text("paid_at"),
  milestone: text("milestone").notNull().default(""),
  externalProvider: text("external_provider"), externalId: text("external_id"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [uniqueIndex("invoices_number").on(t.mandateId, t.number), index("invoices_engagement").on(t.engagementId), index("invoices_due").on(t.mandateId, t.status, t.dueDate)]);

export const expenses = sqliteTable("expenses", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  engagementId: text("engagement_id"),                                   // null = corporate overhead
  category: text("category", { enum: keys(EXPENSE_CATEGORIES) }).notNull(),
  classification: text("classification", { enum: keys(EXPENSE_CLASSES) }).notNull().default("included"),
  amount: real("amount").notNull(), currency: text("currency").notNull().default("USD"),
  date: text("date").notNull(), vendor: text("vendor").notNull().default(""), receiptUrl: text("receipt_url"), note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("expenses_engagement").on(t.engagementId)]);

export const timeEntries = sqliteTable("time_entries", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  engagementId: text("engagement_id").notNull(),
  person: text("person").notNull(), workstream: text("workstream").notNull().default(""),
  hours: real("hours").notNull(), date: text("date").notNull(), note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("time_entries_engagement").on(t.engagementId)]);

export const commercialPartners = sqliteTable("commercial_partners", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"), name: text("name").notNull(),
  kind: text("kind", { enum: keys(PARTNER_KINDS) }).notNull().default("vendor"),
  capabilities: json<string[]>("capabilities"), geographies: json<string[]>("geographies"),
  rates: text("rates").notNull().default(""), paymentTerms: text("payment_terms").notNull().default(""), commercialTerms: text("commercial_terms").notNull().default(""),
  insuranceExpiry: text("insurance_expiry"), contractId: text("contract_id"), performance: integer("performance"), notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("commercial_partners_mandate").on(t.mandateId, t.kind)]);

export const accountConnections = sqliteTable("account_connections", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  category: text("category", { enum: keys(ACCOUNT_CATEGORIES) }).notNull(),
  provider: text("provider").notNull(),
  status: text("status", { enum: keys(ACCOUNT_STATUSES) }).notNull().default("disconnected"),
  integrationKey: text("integration_key"),                                // link to the integration registry when an adapter exists
  accountOwner: text("account_owner"), entity: text("entity"), environment: text("environment", { enum: ["production", "sandbox"] }).notNull().default("production"),
  billingContact: text("billing_contact"), adminContact: text("admin_contact"), technicalContact: text("technical_contact"),
  plan: text("plan").notNull().default(""), monthlyCost: real("monthly_cost"), annualCost: real("annual_cost"), currency: text("currency").notNull().default("USD"),
  renewalDate: text("renewal_date"), purpose: text("purpose").notNull().default(""),
  costAllocation: text("cost_allocation", { enum: ["overhead", "project", "engagement"] }).notNull().default("overhead"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("account_connections_mandate").on(t.mandateId, t.category)]);

export const corporateEntities = sqliteTable("corporate_entities", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: keys(ENTITY_KINDS) }).notNull().default("operating"),
  jurisdiction: text("jurisdiction").notNull().default(""),
  formationDate: text("formation_date"), directors: json<string[]>("directors"), ownership: text("ownership").notNull().default(""),
  parentId: text("parent_id"), projectId: text("project_id"),
  bank: text("bank").notNull().default(""), taxRegistration: text("tax_registration").notNull().default(""), registeredAgent: text("registered_agent").notNull().default(""),
  annualFilingDue: text("annual_filing_due"), insurance: text("insurance").notNull().default(""), notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("corporate_entities_mandate").on(t.mandateId)]);

/** A defined scope of work under an engagement (the prompt's "Mandate"; not the `mandates` workspace table). */
export const workMandates = sqliteTable("work_mandates", {
  id: id(),
  mandateId: text("mandate_id").notNull(),                                // workspace
  engagementId: text("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  objective: text("objective").notNull().default(""),
  projectIds: json<string[]>("project_ids"),
  geography: text("geography").notNull().default(""),
  assetType: text("asset_type").notNull().default(""),
  scope: text("scope").notNull().default(""),
  capitalRequirement: text("capital_requirement").notNull().default(""),
  responsibilities: text("responsibilities").notNull().default(""),
  exclusions: text("exclusions").notNull().default(""),
  startDate: text("start_date"), expiryDate: text("expiry_date"), renewal: text("renewal").notNull().default(""),
  feeStructure: text("fee_structure").notNull().default(""),
  successFee: text("success_fee").notNull().default(""),                   // terms only; legality reviewed by counsel
  reporting: text("reporting").notNull().default(""),
  territory: text("territory"),                                           // encoded Atlas view of the mandate's spatial scope
  owner: text("owner"),
  status: text("status", { enum: keys(WORK_MANDATE_STATUSES) }).notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("work_mandates_engagement").on(t.engagementId)]);

export const workstreams = sqliteTable("workstreams", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  engagementId: text("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  workMandateId: text("work_mandate_id"),
  name: text("name").notNull(),
  kind: text("kind", { enum: keys(WORKSTREAM_KINDS) }).notNull().default("other"),
  lead: text("lead"),
  status: text("status", { enum: keys(WORKSTREAM_STATUSES) }).notNull().default("planned"),
  description: text("description").notNull().default(""),
  due: text("due"),
  ...timestamps,
}, t => [index("workstreams_engagement").on(t.engagementId)]);

/** Product governance register: requests, ideas, technical and product debt. Nothing is built without review. */
export const productItems = sqliteTable("product_items", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  kind: text("kind", { enum: keys(PRODUCT_ITEM_KINDS) }).notNull(),
  title: text("title").notNull(),
  problem: text("problem").notNull().default(""),
  user: text("user").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  frequency: text("frequency").notNull().default(""),
  revenueRelevance: text("revenue_relevance").notNull().default(""),
  urgency: text("urgency").notNull().default(""),
  workaround: text("workaround").notNull().default(""),
  component: text("component").notNull().default(""),
  impact: text("impact").notNull().default(""),
  effort: text("effort").notNull().default(""),
  classification: text("classification", { enum: keys(PRODUCT_CLASSES) }),
  buildCategory: text("build_category", { enum: keys(BUILD_CATEGORIES) }).notNull().default("not_ready"),
  status: text("status", { enum: keys(PRODUCT_STATUSES) }).notNull().default("proposed"),
  priority: text("priority", { enum: ["critical", "high", "medium", "low"] }).notNull().default("medium"),
  owner: text("owner"),
  source: text("source").notNull().default("internal"),                  // client, founder, internal, support
  tenantId: text("tenant_id"), engagementId: text("engagement_id"),
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"), decisionNote: text("decision_note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("product_items_kind").on(t.kind, t.status)]);
