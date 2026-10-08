// Built-in scan presets, aligned with Regenera's working scopes (2026-10-08). Each preset names its scope first, carries
// a written fit brief (signalCriteria, used by open-web discovery and shown to reviewers) and the region of the work.
// Names describe a search, not a market fact; every result still needs evidence and human review. Scopes:
//   A. Africa & Balkans solar + storage (RA-ESG portfolio: ZWE, NAM, ZAF, MOZ, MUS, TZA, BWA; Montenegro)
//   B. US utility-scale solar + storage EPC origination (EMC Renewables mandate)
//   C. Mexico & LATAM energy (utility solar portfolios, EPC)
//   D. Waste & resource systems (waste-to-energy, circular economy)
//   E. Land & built environment (regenerative development, hospitality, masterplanning; Mexico & Caribbean)
//   F. Water, food & nature (forestry, carbon, regenerative agriculture, conservation partners)
//   G. Capital across scopes (DFIs, lenders, infrastructure equity, funds, family offices, impact, de-risking)
// Saved workspace presets live in scan_presets; built-ins are code so every workspace gets the same definitions.
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { scanPresets } from "@/db/schema";
import { zScanConfig, type ScanConfig, type ScanSection } from "./config";

export type Preset = { key: string; name: string; section: ScanSection; note: string; config: ScanConfig; builtIn: boolean; id?: string };

const P = (key: string, name: string, section: ScanSection, note: string, cfg: Partial<ScanConfig> & { audience: string }): Preset =>
  ({ key, name, section, note, builtIn: true, config: zScanConfig.parse({ providers: ["existing", "web", "gleif", "apollo_orgs"], maxOrganizations: 50, ...cfg }) });

const WB6 = ["MNE", "SRB", "BIH", "ALB", "MKD"];
const RAESG = ["ZWE", "NAM", "ZAF", "MOZ", "MUS", "TZA", "BWA"];
const NO_CREDITS = ["existing", "web", "gleif"] as ScanConfig["providers"];

export const BUILT_IN_PRESETS: Preset[] = [
  // A. Africa & Balkans solar + storage
  P("africa_solar_developers", "Africa solar + storage · developers and IPPs", "prospecting", "Developers and independent power producers building utility-scale solar and storage in Southern and East Africa: partners, co-developers or buyers for the portfolio.",
    { audience: "renewable_developers", geography: ["africa"], terms: ["solar", "BESS", "IPP"], signalCriteria: "Developing, owning or acquiring utility-scale solar PV with battery storage (10 MW to 1 GW) in Southern or East Africa, under utility PPAs or mining / industrial offtake." }),
  P("africa_solar_epc", "Africa solar + storage · EPC contractors", "partners", "EPC and engineering contractors with delivered solar and battery projects in Sub-Saharan Africa.",
    { audience: "epc_engineering", geography: ["africa"], terms: ["solar", "BESS", "substation"], signalCriteria: "Completed or under-construction utility-scale solar PV and battery storage projects in Sub-Saharan Africa; ability to deliver 10 to 300 MW." }),
  P("africa_mining_offtakers", "Africa solar + storage · mines and industrial energy users", "prospecting", "Mines, smelters and heavy industry in the RA-ESG countries that need reliable, lower-cost power (captive or wheeled solar + storage).",
    { audience: "industrial_resource_clients", geography: RAESG, terms: ["mining", "gold", "smelter", "captive power"], signalCriteria: "Energy-intensive mining or industrial operations in Zimbabwe, Namibia, South Africa, Mozambique, Tanzania, Botswana or Mauritius seeking captive or contracted renewable power." }),
  P("africa_project_lenders", "Africa solar + storage · project-finance lenders", "capital", "Banks and lenders with renewable project-finance activity in Southern and East Africa.",
    { audience: "banks_lenders", geography: ["africa"], terms: ["project finance", "renewable energy"], signalCriteria: "Senior or mezzanine debt for solar and storage IPPs in Southern or East Africa; USD or local-currency tenors of 10+ years." }),
  P("africa_power_dfis", "Africa solar + storage · DFIs and development banks", "capital", "Development finance institutions financing private power in Africa (debt, equity, guarantees).",
    { audience: "dfis_mdbs", terms: ["renewable energy", "power", "Africa"], providers: NO_CREDITS, signalCriteria: "Current private-sector renewable energy lending, equity or guarantees in Sub-Saharan Africa, including higher-risk jurisdictions." }),
  P("balkans_solar", "Balkans solar + storage · developers, utilities and lenders", "prospecting", "Solar and storage developers, utilities and lenders in Montenegro and the Western Balkans.",
    { audience: "renewable_developers", geography: WB6, terms: ["solar", "BESS"], signalCriteria: "Utility-scale solar and storage in Montenegro and the Western Balkans (100 MW+), including grid-connected projects with EPCG or regional utilities." }),
  P("storage_equipment", "Solar + storage · equipment manufacturers and suppliers", "partners", "Module, inverter, tracker, battery (including sodium-ion) and grid-equipment suppliers for utility-scale projects.",
    { audience: "equipment_suppliers", terms: ["BESS", "sodium-ion", "inverter", "solar module"], providers: NO_CREDITS, signalCriteria: "Utility-scale supply track record in emerging markets; sodium-ion or lithium battery storage; regional service presence in Africa or Europe." }),
  // B. US utility-scale solar + storage (EMC Renewables)
  P("us_epc_firms", "US solar + storage · EPC firms and integrators", "prospecting", "EPCs and integrators in the United States; pairs with the EMC Renewables EPC origination mandate.",
    { audience: "epc_engineering", geography: ["USA"], terms: ["solar", "storage", "BESS"], signalCriteria: "Utility-scale PV and battery storage EPC capacity in the US; appetite for qualified project origination and bid support." }),
  P("us_utility_developers", "US solar + storage · utility-scale developers", "prospecting", "US developers with utility-scale solar and storage projects approaching EPC procurement (sources for the EPC origination mandate).",
    { audience: "renewable_developers", geography: ["USA"], terms: ["utility-scale solar", "battery storage", "interconnection"], signalCriteria: "US utility-scale solar or storage projects past interconnection studies and preparing EPC procurement in the next 12 to 24 months." }),
  // C. Mexico & LATAM energy
  P("mx_solar_developers", "Mexico & LATAM energy · utility solar developers and portfolios", "prospecting", "Developers holding utility-scale solar portfolios in Mexico (200 MW+ selection, RA-ESG RFI) and the wider region.",
    { audience: "renewable_developers", geography: ["MEX", "central_america_caribbean", "south_america"], terms: ["solar", "utility-scale", "fotovoltaico"], signalCriteria: "Utility-scale solar PV portfolios (50 to 300 MW per project) with land control and CENACE interconnection progress, open to institutional capital and EPC alignment." }),
  P("mx_solar_epc", "Mexico & LATAM energy · solar EPC firms", "partners", "EPC and engineering firms registered or located in Mexico whose records mention solar.",
    { audience: "epc_engineering", geography: ["MEX"], terms: ["solar", "fotovoltaico", "photovoltaic"], signalCriteria: "Delivered utility-scale or large commercial solar in Mexico; bankable track record." }),
  // D. Waste & resource systems
  P("wte_public_buyers", "Waste & resources · municipalities and utilities (waste-to-energy)", "prospecting", "Municipal and regional authorities facing landfill, waste or power needs that a waste-to-energy or circular solution could serve.",
    { audience: "municipalities_authorities", geography: ["IND", "africa", "MEX", "central_america_caribbean"], terms: ["waste management", "landfill", "waste-to-energy"], signalCriteria: "Current landfill closure, waste-collection tender, waste-to-energy feasibility or ministry programme; evidence of budget or procurement route." }),
  P("wte_technology_epc", "Waste & resources · waste-to-energy technology and EPC partners", "partners", "Technology providers and EPCs for gasification, pyrolysis, anaerobic digestion and other waste-to-energy plants.",
    { audience: "epc_engineering", terms: ["waste-to-energy", "gasification", "pyrolysis", "anaerobic digestion"], providers: NO_CREDITS, signalCriteria: "Operating waste-to-energy or carbon-conversion plants; ability to partner on 10 to 100 tonne-per-day facilities in emerging markets." }),
  P("industrial_waste_sources", "Waste & resources · industrial waste generators and offtakers", "prospecting", "Industries producing waste, biomass or residues (feedstock) or buying the outputs (power, heat, fuels, materials).",
    { audience: "industrial_resource_clients", terms: ["biomass", "industrial waste", "residues", "circular economy"], signalCriteria: "Large waste or residue streams with disposal cost or circularity targets; interest in on-site energy or materials recovery." }),
  // E. Land & built environment
  P("mx_real_estate_developers", "Land & built environment · Mexico real-estate developers", "organizations", "Property developers and REITs in Mexico, including the Riviera Maya and Tulum.",
    { audience: "real_estate_developers", geography: ["MEX"], terms: ["desarrollo", "real estate", "Tulum", "Riviera Maya"], signalCriteria: "Mixed-use, residential or tourism developments in planning, with sustainability, water, energy or mobility challenges." }),
  P("regenerative_hospitality", "Land & built environment · regenerative tourism and hospitality", "prospecting", "Eco-resort, regenerative tourism and hospitality developers in Mexico and the Caribbean.",
    { audience: "real_estate_developers", geography: ["MEX", "central_america_caribbean"], terms: ["eco resort", "regenerative", "hospitality", "eco park"], signalCriteria: "Regenerative or nature-based tourism, eco-park or hospitality projects needing systems design, permitting or capital." }),
  P("architects_planners", "Land & built environment · architects and masterplanners", "partners", "Design and planning practices with regenerative, low-carbon or masterplanning work.",
    { audience: "architects_planners", terms: ["masterplanning", "regenerative design", "urban planning"], signalCriteria: "Masterplans or regenerative developments in Mexico, Latin America or Africa." }),
  // F. Water, food & nature
  P("forestry_carbon_developers", "Water, food & nature · forestry and carbon project developers", "prospecting", "Reforestation, forestry and nature-based carbon project developers and landholders.",
    { audience: "landowners_agriculture", terms: ["reforestation", "forestry", "carbon credits", "restoration"], signalCriteria: "Reforestation, agroforestry or restoration projects with carbon or biodiversity revenue, needing structuring or capital." }),
  P("regenerative_agriculture", "Water, food & nature · regenerative agriculture operators", "prospecting", "Agricultural operators and landowners moving to regenerative, irrigated or agro-industrial models.",
    { audience: "landowners_agriculture", geography: ["africa", "MEX", "south_america"], terms: ["regenerative agriculture", "irrigation", "agro-industrial"], signalCriteria: "Farms or agro-industrial estates with water, energy or soil constraints and plans to expand or transition." }),
  P("conservation_partners", "Water, food & nature · communities, Indigenous and conservation partners", "partners", "Community land trusts, Indigenous organizations and conservation NGOs: partners and beneficiaries under consent rules, never a sales target.",
    { audience: "communities_conservation", terms: ["land trust", "conservation", "Indigenous"], providers: NO_CREDITS, signalCriteria: "Territories or programmes where projects need consent-based partnership, stewardship or benefit sharing." }),
  // G. Capital across scopes
  P("dfis", "Capital · DFIs and multilateral development banks (all scopes)", "capital", "Development finance institutions across energy, infrastructure, waste, land and nature.", { audience: "dfis_mdbs", providers: NO_CREDITS, signalCriteria: "Active private-sector programmes in emerging markets for renewable energy, infrastructure, circular economy or nature." }),
  P("lenders", "Capital · project-finance banks and lenders (all scopes)", "capital", "Banks and institutional lenders with project-finance or infrastructure-debt activity.", { audience: "banks_lenders", signalCriteria: "Infrastructure or renewable project debt in emerging or frontier markets." }),
  P("infra_pe", "Capital · infrastructure equity (emerging markets)", "capital", "PE firms whose records mention infrastructure or energy transition, especially emerging markets.", { audience: "private_equity", terms: ["infrastructure", "energy transition", "emerging markets"], signalCriteria: "Development or construction equity, or platform investment, in emerging-market energy and infrastructure." }),
  P("real_asset_funds", "Capital · real-asset funds and project buyers", "capital", "Fund and asset managers with real-asset strategies, including buyers of contracted operating assets.", { audience: "funds_asset_managers", signalCriteria: "Acquiring or financing contracted renewable or infrastructure assets (annuity-style income)." }),
  P("family_offices", "Capital · family offices (evidenced relevant strategy)", "capital", "Family offices; strategy is captured from sources, never inferred from the name.", { audience: "family_offices", signalCriteria: "Evidenced investment in energy, infrastructure, real estate or nature; direct or co-investment." }),
  P("foundations", "Capital · foundations and impact capital", "capital", "Foundations with programme- or mission-related investment in energy access, land, water or communities.", { audience: "foundations", signalCriteria: "Catalytic, concessional or programme-related capital for energy access, nature or community outcomes." }),
  P("nature_capital_funds", "Capital · nature-capital funds", "capital", "Funds in forestry, regenerative agriculture, water and biodiversity.", { audience: "natural_capital_funds", signalCriteria: "Investing in forestry, regenerative agriculture, water or biodiversity with measurable outcomes." }),
  P("derisking", "Capital · insurers, guarantors and export-credit agencies", "capital", "Political-risk insurers, credit guarantors and ECAs that unlock senior debt in higher-risk markets.", { audience: "insurers_guarantors", providers: NO_CREDITS, signalCriteria: "Political-risk, payment-risk or credit guarantees for energy and infrastructure in Africa, Latin America or the Balkans." }),
  // Advisory partners across scopes
  P("energy_legal_partners", "Partners · energy and project-finance legal and advisory", "partners", "Law and advisory firms with energy, project-finance, permitting or ESG practices where the work is.", { audience: "legal_advisory_partners", geography: ["africa", "MEX", "USA", ...WB6], signalCriteria: "Energy, infrastructure or project-finance practice in the project's country; permitting or PPA experience." }),
  P("mx_referral_partners", "Partners · Mexico legal and advisory referral partners", "partners", "Law and advisory firms in Mexico with energy, real-estate or ESG practices.", { audience: "legal_advisory_partners", geography: ["MEX"] }),
];

export async function listPresets(db: Db, mandateId: string, section?: ScanSection): Promise<Preset[]> {
  const saved = await db.select().from(scanPresets).where(and(eq(scanPresets.mandateId, mandateId), isNull(scanPresets.archivedAt))).orderBy(asc(scanPresets.name));
  const custom: Preset[] = saved.map(s => ({ id: s.id, key: s.key, name: s.name, section: s.section as ScanSection, note: s.note, builtIn: false, config: zScanConfig.parse(s.config) }));
  const all = [...BUILT_IN_PRESETS, ...custom];
  return section ? all.filter(p => p.section === section || (section === "organizations" && p.section !== "partners")) : all;
}

export async function findPreset(db: Db, mandateId: string, key: string): Promise<Preset | null> {
  return (await listPresets(db, mandateId)).find(p => p.key === key) ?? null;
}

export async function savePreset(db: Db, mandateId: string, input: { key: string; name: string; section: ScanSection; note?: string; config: ScanConfig }, by: string) {
  const config = zScanConfig.parse(input.config);
  const [row] = await db.insert(scanPresets).values({ mandateId, key: input.key, name: input.name, section: input.section, audience: config.audience, note: input.note ?? "", config, createdBy: by })
    .onConflictDoUpdate({ target: [scanPresets.mandateId, scanPresets.key], set: { name: input.name, section: input.section, audience: config.audience, note: input.note ?? "", config, updatedAt: new Date().toISOString(), archivedAt: null } }).returning();
  return row;
}
