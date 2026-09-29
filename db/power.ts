// Power stack: PPAs (terms, delivery, risk allocation, credit, lender rights, conditions), grid interconnection,
// storage specifications, and large loads (data centers and other large electricity users) for power-to-load matching.
import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CHEMISTRIES, CONFIDENCE, LOAD_STAGES, LOAD_TYPES, PPA_STATUS, PPA_TYPES, PROFILES, REDUNDANCY, STUDY_STAGES } from "../lib/power/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'{}'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));
const meta = { createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now), deletedAt: text("deleted_at") };

export type PpaCredit = { rating?: string; ratingAgency?: string; lc?: string; guarantee?: string; deposit?: string; terminationPayment?: string };
export type PpaLenderRights = { assignment?: "yes" | "no" | "unknown"; stepIn?: "yes" | "no" | "unknown"; directAgreement?: "yes" | "no" | "unknown" };
export type PpaCondition = { condition: string; status: "open" | "satisfied" | "waived" };

export const ppas = sqliteTable("ppas", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), revenueStreamId: text("revenue_stream_id"),
  name: text("name").notNull(), type: text("type", { enum: keys(PPA_TYPES) }).notNull(), status: text("status", { enum: keys(PPA_STATUS) }).notNull().default("prospect"),
  buyerOrgId: text("buyer_org_id"), buyerName: text("buyer_name").notNull().default(""), guarantorName: text("guarantor_name").notNull().default(""), generatorEntity: text("generator_entity").notNull().default(""),
  contractedMw: real("contracted_mw"), contractedMwhYear: real("contracted_mwh_year"), startDate: text("start_date"), termYears: real("term_years"),
  price: real("price"), priceUnit: text("price_unit").notNull().default("MWh"), escalationPct: real("escalation_pct"), indexation: text("indexation").notNull().default(""), currency: text("currency").notNull().default("USD"),
  deliveryNode: text("delivery_node").notNull().default(""), settlementNode: text("settlement_node").notNull().default(""), profile: text("profile", { enum: keys(PROFILES) }).notNull().default("unknown"),
  volumeCommitment: text("volume_commitment").notNull().default(""),
  riskAllocation: json<Record<string, string>>("risk_allocation"), credit: json<PpaCredit>("credit"), lenderRights: json<PpaLenderRights>("lender_rights"),
  conditions: json<PpaCondition[]>("conditions", "'[]'"), contractId: text("contract_id"), signedDate: text("signed_date"), notes: text("notes").notNull().default(""),
  ...meta,
}, t => [index("ppas_project").on(t.projectId)]);

export const gridConnections = sqliteTable("grid_connections", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(),
  operator: text("operator").notNull().default(""), poi: text("poi").notNull().default(""), voltageKv: real("voltage_kv"), queueId: text("queue_id").notNull().default(""),
  applicationDate: text("application_date"), studyStage: text("study_stage", { enum: keys(STUDY_STAGES) }).notNull().default("none"),
  requestedMw: real("requested_mw"), approvedMw: real("approved_mw"), direction: text("direction", { enum: ["injection", "withdrawal", "both"] }).notNull().default("injection"),
  networkUpgrades: text("network_upgrades").notNull().default(""), upgradeCost: real("upgrade_cost"), costAllocation: text("cost_allocation").notNull().default(""), securityDeposit: real("security_deposit"),
  currency: text("currency").notNull().default("USD"), curtailmentRisk: text("curtailment_risk").notNull().default(""), transmissionConstraints: text("transmission_constraints").notNull().default(""),
  targetEnergization: text("target_energization"), dependencies: text("dependencies").notNull().default(""), evidence: text("evidence").notNull().default(""),
  ...meta,
}, t => [index("grid_connections_project").on(t.projectId)]);

export type StorageService = { service: string; sharePct: number; contracted: boolean };
export const storageSpecs = sqliteTable("storage_specs", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), name: text("name").notNull().default("Storage"),
  chemistry: text("chemistry", { enum: keys(CHEMISTRIES) }).notNull().default("lfp"), powerMw: real("power_mw").notNull(), energyMwh: real("energy_mwh").notNull(),
  cyclesPerYear: real("cycles_per_year"), roundTripPct: real("round_trip_pct"), degradationPctYear: real("degradation_pct_year"), usefulLifeYears: real("useful_life_years"),
  augmentation: json<{ year: number; mwh: number; costPerKwh: number }[]>("augmentation", "'[]'"), warrantyYears: real("warranty_years"),
  thermalManagement: text("thermal_management").notNull().default(""), fireSuppression: text("fire_suppression").notNull().default(""), ems: text("ems").notNull().default(""), pcs: text("pcs").notNull().default(""),
  capexPerKwh: real("capex_per_kwh"), capexPerKw: real("capex_per_kw"), fixedOmPerKwYear: real("fixed_om_per_kw_year"), chargingCostPerMwh: real("charging_cost_per_mwh"), currency: text("currency").notNull().default("USD"),
  services: json<StorageService[]>("services", "'[]'"), costSource: text("cost_source").notNull().default(""), ...meta,
}, t => [index("storage_specs_project").on(t.projectId)]);

export const largeLoads = sqliteTable("large_loads", {
  id: id(), mandateId: text("mandate_id").notNull(), name: text("name").notNull(), orgId: text("org_id"), projectId: text("project_id"),
  type: text("type", { enum: keys(LOAD_TYPES) }).notNull(), stage: text("stage", { enum: keys(LOAD_STAGES) }).notNull().default("prospect"),
  country: text("country"), region: text("region").notNull().default(""), lat: real("lat"), lng: real("lng"),
  mw: real("mw"), mwhYear: real("mwh_year"), loadFactorPct: real("load_factor_pct"), redundancy: text("redundancy", { enum: keys(REDUNDANCY) }).notNull().default("unknown"),
  uptimePct: real("uptime_pct"), renewableTargetPct: real("renewable_target_pct"), carbonTarget: text("carbon_target").notNull().default(""), energizationDate: text("energization_date"),
  procurement: json<string[]>("procurement", "'[]'"), ramp: text("ramp").notNull().default(""), waterNeeds: text("water_needs").notNull().default(""),
  source: text("source").notNull().default(""), sourceUrl: text("source_url"), confidence: text("confidence", { enum: keys(CONFIDENCE) }).notNull().default("unknown"), asOf: text("as_of"),
  isDemo: text("is_demo").notNull().default("no"), notes: text("notes").notNull().default(""), ...meta,
}, t => [index("large_loads_mandate").on(t.mandateId, t.type)]);
