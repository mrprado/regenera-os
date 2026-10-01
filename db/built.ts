// Built Environment intelligence (docs/plans/phase-12-built-environment.md). Companies are CRM organizations with a
// built-environment profile (never a second company table); technologies and materials are separable from companies;
// matches, commercial opportunities and signals link projects, organizations and deals by id. Suppliers use the
// existing network_profiles (qualification columns added here); RFIs / RFPs use procurement_packages and bids.
// Traditional / vernacular knowledge has its own governed table and never enters search, Ask the OS or MCP.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const arr = <T = string>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);
const obj = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull().default(sql`'{}'`);
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };
const origin = () => text("origin").notNull().default("user_entered");   // RECORD_ORIGINS

export type BeSignalRef = { type: string; date: string; summary: string };

/** §3 A company's built-environment profile, keyed to its CRM organization. */
export const beCompanyProfiles = sqliteTable("be_company_profiles", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  legalName: text("legal_name"),
  status: text("company_status").notNull().default("active"),
  operatingRegions: arr("operating_regions"),          // REGIONS keys
  taxonomy: arr("taxonomy"),                             // TAXONOMY keys
  subsectors: arr("subsectors"),                         // taxonomy items
  technologyType: text("technology_type").notNull().default(""),
  productCategory: text("product_category").notNull().default(""),
  buildingSegments: arr("building_segments"),            // PROJECT_TYPES keys
  stageFit: arr("stage_fit"),                            // project stages
  problemSolved: text("problem_solved").notNull().default(""),
  summary: text("summary").notNull().default(""),
  maturity: text("maturity").notNull().default("pilot"), // MATURITY
  trl: integer("trl"), crl: integer("crl"),
  patents: text("patents").notNull().default(""), certifications: arr("certifications"), standards: arr("standards"), constraints: text("constraints").notNull().default(""),
  embodiedCarbonImpact: text("embodied_carbon_impact").notNull().default("unknown"),     // EFFECT; claims live in project_attributes
  operationalCarbonImpact: text("operational_carbon_impact").notNull().default("unknown"),
  waterImpact: text("water_impact").notNull().default("unknown"), wasteImpact: text("waste_impact").notNull().default("unknown"),
  pricingModel: text("pricing_model").notNull().default(""), costEffect: text("cost_effect").notNull().default("unknown"), minimumOrder: text("minimum_order").notNull().default(""),
  productionCapacity: text("production_capacity").notNull().default(""), leadTime: text("lead_time").notNull().default(""), deliveryModel: text("delivery_model").notNull().default(""),
  geographyServed: arr("geography_served"),
  fundingStage: text("funding_stage"),                   // COMPANY_STAGES
  capitalRaised: real("capital_raised"), capitalCurrency: text("capital_currency").notNull().default("USD"), latestRound: text("latest_round").notNull().default(""),
  investorOrgIds: arr("investor_org_ids"), investorNames: arr("investor_names"), expansionStatus: text("expansion_status").notNull().default(""),
  targetCustomers: text("target_customers").notNull().default(""), targetRegions: arr("target_regions"), partnershipInterest: integer("partnership_interest", { mode: "boolean" }).notNull().default(false),
  distributorInterest: integer("distributor_interest", { mode: "boolean" }).notNull().default(false), pilotInterest: integer("pilot_interest", { mode: "boolean" }).notNull().default(false),
  relationshipStatus: text("relationship_status").notNull().default("none"), relationshipOwner: text("relationship_owner"), engagementStage: text("engagement_stage").notNull().default(""),
  procurementFit: text("procurement_fit").notNull().default(""), capitalFit: text("capital_fit").notNull().default(""), advisoryFit: text("advisory_fit").notNull().default(""), marketEntryFit: text("market_entry_fit").notNull().default(""),
  notes: text("notes").notNull().default(""), nextAction: text("next_action"), nextActionDate: text("next_action_date"),
  recentSignals: arr<BeSignalRef>("recent_signals"),
  origin: origin(), sourceUrl: text("source_url"),
  ...timestamps,
}, t => [uniqueIndex("be_company_profiles_org").on(t.mandateId, t.orgId)]);

/** §4 Technologies: one company may have several. Effects are categorical (EFFECT), never a fake precise number. */
export const beTechnologies = sqliteTable("be_technologies", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id"),                                  // provider
  name: text("name").notNull(),
  category: text("category").notNull(),                   // TAXONOMY key
  subcategory: text("subcategory").notNull().default(""),
  trl: integer("trl"), crl: integer("crl"), maturity: text("maturity").notNull().default("pilot"),
  deploymentCount: integer("deployment_count"), deploymentLocations: arr("deployment_locations"),
  climates: arr("climates"), hazards: arr("hazards"), buildingTypes: arr("building_types"), projectSizes: arr("project_sizes"),
  effects: obj<Record<string, string>>("effects"),        // capex, opex, embodied, operational, water, waste, speed, labor → EFFECT
  permitting: text("permitting").notNull().default("unknown"), installation: text("installation").notNull().default("unknown"), maintenance: text("maintenance").notNull().default("unknown"),
  bankability: text("bankability").notNull().default("unknown"), insurability: text("insurability").notNull().default("unknown"), warranty: text("warranty").notNull().default(""),
  certifications: arr("certifications"), technicalDependencies: text("technical_dependencies").notNull().default(""), supplyChainDependencies: text("supply_chain_dependencies").notNull().default(""),
  deploymentRisks: text("deployment_risks").notNull().default(""), caseStudies: text("case_studies").notNull().default(""), references: text("references").notNull().default(""),
  stageFit: arr("stage_fit"),
  origin: origin(), sourceUrl: text("source_url"),
  ...timestamps,
}, t => [index("be_technologies_category").on(t.mandateId, t.category), index("be_technologies_org").on(t.orgId)]);

/** §5 Materials. Embodied carbon comes from an EPD or a claim with its state; never asserted. */
export const beMaterials = sqliteTable("be_materials", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  family: text("family").notNull(),                        // taxonomy materials item
  supplierOrgId: text("supplier_org_id"),
  origin: origin(),
  originPlace: text("origin_place").notNull().default(""), localAvailability: arr("local_availability"), manufacturingLocation: text("manufacturing_location").notNull().default(""),
  embodiedCarbon: real("embodied_carbon"), embodiedCarbonUnit: text("embodied_carbon_unit").notNull().default("kgCO2e/m3"), embodiedCarbonState: text("embodied_carbon_state").notNull().default("unverified"), epdId: text("epd_id"),
  recycledContentPct: real("recycled_content_pct"), biobasedPct: real("biobased_pct"),
  endOfLife: text("end_of_life").notNull().default(""), recyclability: text("recyclability").notNull().default("unknown"), reusability: text("reusability").notNull().default("unknown"),
  toxicity: text("toxicity").notNull().default(""), voc: text("voc").notNull().default(""), moisture: text("moisture").notNull().default(""), thermal: text("thermal").notNull().default(""),
  fire: text("fire").notNull().default(""), acoustic: text("acoustic").notNull().default(""), structural: text("structural").notNull().default(""), durability: text("durability").notNull().default(""), maintenance: text("maintenance").notNull().default(""),
  climates: arr("climates"), hazards: arr("hazards"), tags: arr("tags"), certifications: arr("certifications"),
  cost: text("cost").notNull().default(""), leadTime: text("lead_time").notNull().default(""), supplierCapacity: text("supplier_capacity").notNull().default(""),
  ...timestamps,
}, t => [index("be_materials_family").on(t.mandateId, t.family)]);

export const beSystems = sqliteTable("be_systems", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),                            // taxonomy construction item
  description: text("description").notNull().default(""),
  providerOrgIds: arr("provider_org_ids"),
  climates: arr("climates"), hazards: arr("hazards"), buildingTypes: arr("building_types"),
  speedEffect: text("speed_effect").notNull().default("unknown"), costEffect: text("cost_effect").notNull().default("unknown"), carbonEffect: text("carbon_effect").notNull().default("unknown"), laborEffect: text("labor_effect").notNull().default("unknown"),
  modularFeasibility: text("modular_feasibility").notNull().default(""), risks: text("risks").notNull().default(""),
  origin: origin(),
  ...timestamps,
});

/** §12 Signals. Each links entities and says why it matters. */
export const beSignals = sqliteTable("be_signals", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  date: text("date").notNull(),
  orgId: text("org_id"), entity: text("entity").notNull(),
  type: text("type").notNull(),                             // SIGNAL_TYPES
  summary: text("summary").notNull(),
  source: text("source").notNull(), sourceUrl: text("source_url"),
  region: text("region"), importance: text("importance").notNull().default("medium"),
  why: text("why").notNull().default(""), relevance: text("relevance").notNull().default(""),
  projectIds: arr("project_ids"), investorOrgIds: arr("investor_org_ids"),
  suggestedAction: text("suggested_action").notNull().default(""), status: text("status").notNull().default("new"),
  origin: origin(),
  ...timestamps,
}, t => [index("be_signals_date").on(t.mandateId, t.date)]);

/** §8 Project fit results. Reasons and categorical impacts, a confidence, never a bare score. */
export const beMatches = sqliteTable("be_matches", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  subjectType: text("subject_type").notNull(),              // technology | material | system | strategy
  subjectId: text("subject_id"),
  category: text("category").notNull(),                     // STACK_CATEGORIES
  label: text("label").notNull(),
  reason: text("reason").notNull(),
  confidence: text("confidence").notNull().default("moderate"),
  impacts: obj<Record<string, string>>("impacts"),          // cost, schedule, carbon, resilience → EFFECT
  stageFit: text("stage_fit").notNull().default(""),
  providerOrgIds: arr("provider_org_ids"),
  rank: integer("rank").notNull().default(0),
  status: text("status").notNull().default("suggested"),    // suggested | shortlisted | rejected
  runAt: text("run_at").notNull(),
  ...timestamps,
}, t => [index("be_matches_project").on(t.projectId, t.category)]);

/** §10 Commercial opportunity from a company / technology / project match. */
export const beOpportunities = sqliteTable("be_opportunities", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  kinds: arr("kinds"),                                      // ENGAGEMENT_KINDS
  projectIds: arr("project_ids"),
  regeneraAssets: text("regenera_assets").notNull().default(""),
  feeModels: arr("fee_models"),
  feeCompliance: text("fee_compliance").notNull().default("unknown"),
  status: text("status").notNull().default("identified"),
  dealId: text("deal_id"), signalId: text("signal_id"),
  owner: text("owner"),
  ...timestamps,
}, t => [index("be_opportunities_org").on(t.orgId)]);

/** §6 Traditional / vernacular / place-based building knowledge. Governed; not public or searchable by default. */
export const beKnowledge = sqliteTable("be_knowledge", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  title: text("title").notNull(),
  knowledgeType: text("knowledge_type").notNull(),         // VERNACULAR_KINDS or free text
  summary: text("summary").notNull().default(""),          // shown only when access allows
  knowledgeHolder: text("knowledge_holder"), community: text("community"), custodian: text("custodian"), communityId: text("community_id"),
  geographicContext: text("geographic_context").notNull().default(""), culturalContext: text("cultural_context").notNull().default(""),
  access: text("access").notNull().default("community_governed"),   // KNOWLEDGE_ACCESS
  consentStatus: text("consent_status").notNull().default("not_requested"),
  authorizedUse: text("authorized_use").notNull().default(""),
  commercialUse: integer("commercial_use", { mode: "boolean" }).notNull().default(false),
  publication: integer("publication", { mode: "boolean" }).notNull().default(false),
  digitization: integer("digitization", { mode: "boolean" }).notNull().default(false),
  attribution: text("attribution").notNull().default(""),
  benefitSharingRequired: integer("benefit_sharing_required", { mode: "boolean" }).notNull().default(true),
  benefitSharing: text("benefit_sharing").notNull().default(""), equityParticipation: text("equity_participation").notNull().default(""), revenueShare: text("revenue_share").notNull().default(""),
  communityFund: text("community_fund").notNull().default(""), communityGovernance: text("community_governance").notNull().default(""),
  restrictions: text("restrictions").notNull().default(""), reviewDate: text("review_date"), source: text("source").notNull().default(""), notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...timestamps,
});
