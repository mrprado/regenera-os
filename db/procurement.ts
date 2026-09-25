// Materials, procurement and the builders/suppliers network (docs/plans/phase-6.md M9). EPDs and network profiles are
// entity-level libraries; BoQ items, packages and bids belong to a project. Mandate-scoped.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { BID_STATUSES, CIRCULARITY, MATERIAL_CATEGORIES, PACKAGE_CATEGORIES, PACKAGE_STAGES, TRANSPORT_MODES, type Criterion, type LcaStage } from "../lib/procurement/vocab";
import { projects } from "./projects";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

/** Environmental Product Declarations as published. Never estimated: carbon is only computed from these. */
export const epds = sqliteTable("epds", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  manufacturer: text("manufacturer").notNull(),
  product: text("product").notNull(),
  category: text("category", { enum: keys(MATERIAL_CATEGORIES) }).notNull().default("other"),
  programOperator: text("program_operator").notNull().default(""),   // e.g. EPD International, IBU, UL
  registrationNumber: text("registration_number").notNull().default(""),
  pcr: text("pcr").notNull().default(""),
  geography: text("geography").notNull().default(""),
  declaredUnit: text("declared_unit").notNull(),                        // e.g. "t", "m3", "kWp", "unit"
  gwp: text("gwp", { mode: "json" }).$type<Partial<Record<LcaStage, number>>>().notNull().default(sql`'{}'`), // kg CO2e per declared unit
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false), // third-party verified
  verifier: text("verifier"),
  url: text("url"),
  ...timestamps,
}, t => [index("epds_mandate").on(t.mandateId, t.category)]);

export const boqItems = sqliteTable("boq_items", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  packageId: text("package_id"),
  material: text("material").notNull(),
  category: text("category", { enum: keys(MATERIAL_CATEGORIES) }).notNull().default("other"),
  specification: text("specification").notNull().default(""),
  quantity: real("quantity"),
  unit: text("unit"),
  manufacturer: text("manufacturer"),
  supplier: text("supplier"),
  origin: text("origin"),                      // country of manufacture
  distanceKm: real("distance_km"),
  transportMode: text("transport_mode", { enum: keys(TRANSPORT_MODES) }),
  unitCost: real("unit_cost"),
  currency: text("currency").notNull().default("USD"),
  leadTimeWeeks: real("lead_time_weeks"),
  recycledPct: real("recycled_pct"),
  biobasedPct: real("biobased_pct"),
  epdId: text("epd_id"),
  serviceLifeYears: real("service_life_years"),
  circularity: text("circularity", { enum: keys(CIRCULARITY) }).notNull().default("unknown"),
  designForDisassembly: integer("design_for_disassembly", { mode: "boolean" }).notNull().default(false),
  endOfLife: text("end_of_life").notNull().default(""),
  hazards: text("hazards").notNull().default(""),
  certification: text("certification").notNull().default(""),
  ...timestamps,
}, t => [index("boq_items_project").on(t.projectId)]);

export const procurementPackages = sqliteTable("procurement_packages", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: keys(PACKAGE_CATEGORIES) }).notNull(),
  scope: text("scope").notNull().default(""),
  stage: text("stage", { enum: keys(PACKAGE_STAGES) }).notNull().default("need"),
  budget: real("budget"),
  currency: text("currency").notNull().default("USD"),
  bidsDueAt: text("bids_due_at"),
  awardTargetAt: text("award_target_at"),
  requiredOnSiteAt: text("required_on_site_at"),
  esRequirements: text("es_requirements").notNull().default(""),   // E&S obligations flowed down to the supplier
  localContentTargetPct: real("local_content_target_pct"),
  weights: text("weights", { mode: "json" }).$type<Partial<Record<Criterion, number>>>().notNull().default(sql`'{}'`),
  awardedBidId: text("awarded_bid_id"),
  contractId: text("contract_id"),
  owner: text("owner"),
  ...timestamps,
}, t => [index("procurement_packages_project").on(t.projectId), index("procurement_packages_due").on(t.mandateId, t.stage, t.bidsDueAt)]);

export const bids = sqliteTable("bids", {
  id: id(),
  packageId: text("package_id").notNull().references(() => procurementPackages.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),
  bidder: text("bidder").notNull(),
  status: text("status", { enum: keys(BID_STATUSES) }).notNull().default("invited"),
  price: real("price"),
  currency: text("currency").notNull().default("USD"),
  scheduleWeeks: real("schedule_weeks"),
  leadTimeWeeks: real("lead_time_weeks"),
  warrantyYears: real("warranty_years"),
  liquidatedDamages: text("liquidated_damages").notNull().default(""),
  originCountry: text("origin_country"),
  factory: text("factory"),
  incoterms: text("incoterms"),
  port: text("port"),
  localContentPct: real("local_content_pct"),
  financingSupport: text("financing_support").notNull().default(""),
  scores: text("scores", { mode: "json" }).$type<Partial<Record<Criterion, number>>>().notNull().default(sql`'{}'`), // 0–10 per criterion
  exceptions: text("exceptions").notNull().default(""),   // deviations and clarifications
  submittedAt: text("submitted_at"),
  ...timestamps,
}, t => [index("bids_package").on(t.packageId)]);

/** What an organization can build or supply, for matching to projects. */
export const networkProfiles = sqliteTable("network_profiles", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  roles: text("roles", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),          // NETWORK_ROLES keys
  assetClasses: text("asset_classes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`), // ASSET_CLASSES keys
  technologies: text("technologies").notNull().default(""),
  jurisdictions: text("jurisdictions", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`), // countries (ISO3 or names) where licensed / present
  minProjectSize: real("min_project_size"),
  maxProjectSize: real("max_project_size"),
  currency: text("currency").notNull().default("USD"),
  completedAssets: integer("completed_assets"),
  trackRecord: text("track_record").notNull().default(""),
  bonding: text("bonding").notNull().default(""),
  insurance: text("insurance").notNull().default(""),
  balanceSheet: text("balance_sheet").notNull().default(""),
  warranty: text("warranty").notNull().default(""),
  bankable: integer("bankable", { mode: "boolean" }).notNull().default(false), // accepted by lenders / tier-1
  references: text("references").notNull().default(""),
  performance: text("performance").notNull().default(""),                  // Regenera's own experience with them
  ...timestamps,
}, t => [index("network_profiles_mandate").on(t.mandateId), index("network_profiles_org").on(t.orgId)]);
