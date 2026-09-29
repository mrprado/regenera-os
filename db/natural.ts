// Natural asset operating layer: structure graph (asset → OpCo → SPVs → HoldCo → investors), land pipeline, species
// and biological production, ecological design, certification & MRV (documents, monitoring periods, permanence risk),
// environmental inventory ledger, environmental offtakes, risk transfer, and long-duration horizons.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CERT_DOC_TYPES, CERT_STAGES, FUNCTIONAL_GROUPS, INTERVENTIONS, LAND_STAGES, LINK_KINDS, LOT_STATUS, NODE_KINDS, OFFTAKE_KINDS, OFFTAKE_STATUS, PERIOD_STATUS, PLANTING_STATUS, RISK_TRANSFER, RISK_TRANSFER_STATUS, STANDARDS, TENURE, UNIT_TYPES } from "../lib/natural/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'[]'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const structureNodes = sqliteTable("structure_nodes", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(),
  name: text("name").notNull(), kind: text("kind", { enum: keys(NODE_KINDS) }).notNull(),
  jurisdiction: text("jurisdiction"), entityId: text("entity_id"), orgId: text("org_id"),
  responsibilities: text("responsibilities").notNull().default(""), liabilities: text("liabilities").notNull().default(""),
  ...timestamps,
}, t => [index("structure_nodes_project").on(t.projectId)]);

export const structureLinks = sqliteTable("structure_links", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(),
  fromId: text("from_id").notNull(), toId: text("to_id").notNull(), kind: text("kind", { enum: keys(LINK_KINDS) }).notNull(),
  pct: real("pct"), amount: real("amount"), currency: text("currency"), description: text("description").notNull().default(""), contractId: text("contract_id"),
  ...timestamps,
}, t => [index("structure_links_project").on(t.projectId)]);

export type DiligenceItem = { item: string; status: "open" | "in_progress" | "clear" | "issue" | "n/a"; note: string };
export const landCandidates = sqliteTable("land_candidates", {
  id: id(), mandateId: text("mandate_id").notNull(), name: text("name").notNull(),
  stage: text("stage", { enum: keys(LAND_STAGES) }).notNull().default("identified"),
  country: text("country"), subdivision: text("subdivision"), lat: real("lat"), lng: real("lng"), geometry: text("geometry"),
  hectares: real("hectares"), askingPrice: real("asking_price"), currency: text("currency").notNull().default("USD"),
  tenure: text("tenure", { enum: keys(TENURE) }).notNull().default("unclear"), seller: text("seller").notNull().default(""), sellerOrgId: text("seller_org_id"),
  titleStatus: text("title_status").notNull().default(""), ecosystemCondition: text("ecosystem_condition").notNull().default(""), suitability: text("suitability").notNull().default(""),
  optionStatus: text("option_status").notNull().default(""), optionExpiry: text("option_expiry"), probabilityPct: real("probability_pct"),
  intervention: text("intervention", { enum: keys(INTERVENTIONS) }), capitalRequired: real("capital_required"),
  source: text("source").notNull().default(""), diligence: json<DiligenceItem[]>("diligence"), siteBaseline: text("site_baseline", { mode: "json" }).$type<Record<string, unknown> | null>(),
  dropReason: text("drop_reason"), projectId: text("project_id"), owner: text("owner"), notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("land_candidates_stage").on(t.mandateId, t.stage)]);

export const species = sqliteTable("species", {
  id: id(), mandateId: text("mandate_id").notNull(), scientificName: text("scientific_name").notNull(), commonName: text("common_name").notNull().default(""),
  functionalGroup: text("functional_group", { enum: keys(FUNCTIONAL_GROUPS) }).notNull().default("other"), native: text("native").notNull().default(""),
  climateTolerance: text("climate_tolerance").notNull().default(""), soils: text("soils").notNull().default(""), uses: text("uses").notNull().default(""),
  rotationYears: integer("rotation_years"), source: text("source").notNull().default(""), gbifKey: text("gbif_key"),
  ...timestamps,
}, t => [index("species_mandate").on(t.mandateId, t.scientificName)]);

export const nurseries = sqliteTable("nurseries", {
  id: id(), mandateId: text("mandate_id").notNull(), name: text("name").notNull(), projectId: text("project_id"), orgId: text("org_id"),
  location: text("location").notNull().default(""), capacityPerYear: integer("capacity_per_year"), ownOperated: integer("own_operated", { mode: "boolean" }).notNull().default(false),
  notes: text("notes").notNull().default(""), ...timestamps,
});

export type SurvivalCheck = { date: string; survivalPct: number; note?: string };
export const plantingBatches = sqliteTable("planting_batches", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), speciesId: text("species_id").notNull(), nurseryId: text("nursery_id"),
  provenance: text("provenance").notNull().default(""), quantity: integer("quantity").notNull(), areaHa: real("area_ha"), season: text("season").notNull().default(""),
  plantedDate: text("planted_date"), status: text("status", { enum: keys(PLANTING_STATUS) }).notNull().default("planned"),
  unitCost: real("unit_cost"), establishmentCostPerHa: real("establishment_cost_per_ha"), currency: text("currency").notNull().default("USD"), crew: text("crew").notNull().default(""),
  survival: json<SurvivalCheck[]>("survival"), replacementQty: integer("replacement_qty").notNull().default(0), maintenanceCycle: text("maintenance_cycle").notNull().default(""),
  ...timestamps,
}, t => [index("planting_batches_project").on(t.projectId)]);

export type SpeciesShare = { speciesId: string; sharePct: number; rationale: string };
export const ecologicalDesigns = sqliteTable("ecological_designs", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), name: text("name").notNull(),
  intervention: text("intervention", { enum: keys(INTERVENTIONS) }).notNull(), climateScenario: text("climate_scenario").notNull().default(""),
  siteFactors: json<Record<string, unknown>>("site_factors", "'{}'"), mix: json<SpeciesShare[]>("mix"),
  rationale: text("rationale").notNull().default(""), evidence: text("evidence").notNull().default(""), localKnowledge: text("local_knowledge").notNull().default(""),
  costPerHa: real("cost_per_ha"), status: text("status", { enum: ["draft", "reviewed", "adopted"] }).notNull().default("draft"), reviewedBy: text("reviewed_by"),
  ...timestamps,
}, t => [index("ecological_designs_project").on(t.projectId)]);

export type PermanenceScore = { factor: string; score: number; mitigation: string; evidence: string };
export const certifications = sqliteTable("certifications", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), name: text("name").notNull(),
  standard: text("standard", { enum: keys(STANDARDS) }).notNull(), secondaryStandards: json<string[]>("secondary_standards"), methodology: text("methodology").notNull().default(""),
  registryId: text("registry_id"), registryUrl: text("registry_url"), unitType: text("unit_type", { enum: keys(UNIT_TYPES) }).notNull().default("carbon"),
  stage: text("stage", { enum: keys(CERT_STAGES) }).notNull().default("feasibility"),
  creditingStart: text("crediting_start"), creditingEnd: text("crediting_end"), lifetimeYears: integer("lifetime_years"),
  validationBody: text("validation_body").notNull().default(""), verificationBody: text("verification_body").notNull().default(""),
  baseline: text("baseline").notNull().default(""), nextVerification: text("next_verification"),
  permanence: json<PermanenceScore[]>("permanence"), permanenceSource: text("permanence_source").notNull().default(""), bufferPct: real("buffer_pct"),
  ...timestamps,
}, t => [index("certifications_project").on(t.projectId)]);

export const certDocuments = sqliteTable("cert_documents", {
  id: id(), mandateId: text("mandate_id").notNull(), certificationId: text("certification_id").notNull(),
  docType: text("doc_type", { enum: keys(CERT_DOC_TYPES) }).notNull(), title: text("title").notNull(), version: text("version").notNull().default("1"),
  docDate: text("doc_date"), periodId: text("period_id"), documentId: text("document_id"), url: text("url"), status: text("status", { enum: ["draft", "final", "registry_published", "superseded"] }).notNull().default("draft"),
  addedBy: text("added_by").notNull(), ...timestamps,
}, t => [index("cert_documents_cert").on(t.certificationId)]);

export const monitoringPeriods = sqliteTable("monitoring_periods", {
  id: id(), mandateId: text("mandate_id").notNull(), certificationId: text("certification_id").notNull(),
  start: text("start").notNull(), end: text("end").notNull(), status: text("status", { enum: keys(PERIOD_STATUS) }).notNull().default("open"),
  estimatedUnits: real("estimated_units"), verifiedUnits: real("verified_units"), bufferUnits: real("buffer_units"), issuedUnits: real("issued_units"),
  verifier: text("verifier").notNull().default(""), reportDate: text("report_date"), verifiedDate: text("verified_date"), issuanceDate: text("issuance_date"),
  ...timestamps,
}, t => [index("monitoring_periods_cert").on(t.certificationId)]);

export type LotEvent = { at: string; from: string; to: string; by: string; note?: string };
export const creditLots = sqliteTable("credit_lots", {
  id: id(), mandateId: text("mandate_id").notNull(), certificationId: text("certification_id").notNull(), periodId: text("period_id"),
  vintage: text("vintage").notNull(), quantity: real("quantity").notNull(), status: text("status", { enum: keys(LOT_STATUS) }).notNull().default("forecast"),
  serialStart: text("serial_start"), serialEnd: text("serial_end"), price: real("price"), currency: text("currency").notNull().default("USD"),
  buyerOrgId: text("buyer_org_id"), offtakeId: text("offtake_id"), deliveredDate: text("delivered_date"), retiredDate: text("retired_date"), retirementBeneficiary: text("retirement_beneficiary"),
  history: json<LotEvent[]>("history"), parentId: text("parent_id"), ...timestamps,
}, t => [index("credit_lots_cert").on(t.certificationId, t.status)]);

export type OfftakeYear = { year: number; volume: number; price?: number | null };
export const envOfftakes = sqliteTable("env_offtakes", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), certificationId: text("certification_id"), name: text("name").notNull(),
  kind: text("kind", { enum: keys(OFFTAKE_KINDS) }).notNull(), status: text("status", { enum: keys(OFFTAKE_STATUS) }).notNull().default("prospect"),
  buyerOrgId: text("buyer_org_id"), buyerName: text("buyer_name").notNull().default(""), unit: text("unit").notNull().default("tCO2e"),
  schedule: json<OfftakeYear[]>("schedule"), price: real("price"), floorPrice: real("floor_price"), escalationPct: real("escalation_pct").notNull().default(0), currency: text("currency").notNull().default("USD"),
  prepayment: real("prepayment"), developmentFunding: real("development_funding"), performanceConditions: text("performance_conditions").notNull().default(""),
  certificationDependent: integer("certification_dependent", { mode: "boolean" }).notNull().default(true), replacementObligation: text("replacement_obligation").notNull().default(""),
  counterpartyRisk: text("counterparty_risk").notNull().default(""), contractId: text("contract_id"), signedDate: text("signed_date"), notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("env_offtakes_project").on(t.projectId)]);

export const riskTransfers = sqliteTable("risk_transfers", {
  id: id(), mandateId: text("mandate_id").notNull(), projectId: text("project_id").notNull(), kind: text("kind", { enum: keys(RISK_TRANSFER) }).notNull(),
  status: text("status", { enum: keys(RISK_TRANSFER_STATUS) }).notNull().default("identified"), providerOrgId: text("provider_org_id"), provider: text("provider").notNull().default(""),
  coverage: real("coverage"), premium: real("premium"), currency: text("currency").notNull().default("USD"), start: text("start"), end: text("end"),
  covers: text("covers").notNull().default(""), bankabilityNote: text("bankability_note").notNull().default(""), ...timestamps,
}, t => [index("risk_transfers_project").on(t.projectId)]);

export const assetHorizons = sqliteTable("asset_horizons", {
  projectId: text("project_id").primaryKey(), mandateId: text("mandate_id").notNull(),
  development: integer("development"), financing: integer("financing"), operating: integer("operating"), stewardship: integer("stewardship"),
  stewardshipPlan: text("stewardship_plan").notNull().default(""), steward: text("steward").notNull().default(""), updatedAt: text("updated_at").notNull().default(now),
});
