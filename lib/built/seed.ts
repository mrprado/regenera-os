// Built environment DEMO data (built environment prompt §24). Fictional organizations only, every name "DEMO — …",
// origin "demo", no figures presented as real: embodied carbon, prices and capital amounts stay empty ("Not
// recorded") and claims are "unverified". Lives in the demo workspace and is removed with it.
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { beCompanyProfiles, beKnowledge, beMatches, beMaterials, beOpportunities, beSignals, beSystems, beTechnologies, bids, networkProfiles, organizations, procurementPackages } from "@/db/schema";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { runBuiltIntelligence } from "./engine";

const D = (s: string) => `DEMO — ${s}`;
type Co = [name: string, country: string, taxonomy: string, subsector: string, region: string, stage: string, maturity: string, segments: string[], climates: string[], hazards: string[], techs: [string, string][]];

// 40 fictional companies: [name, ISO3, taxonomy, subsector, region, funding stage, maturity, segments, climates, hazards, technologies [name, effect profile]]
const COMPANIES: Co[] = [
  ["Tierra Viva Earth Systems", "MEX", "materials", "compressed earth blocks", "latin_america", "seed", "early_commercial", ["hospitality", "residential", "affordable_housing"], ["tropical_dry", "arid", "tropical_humid"], ["heat"], [["Stabilized compressed earth block press", "low"], ["Rammed earth wall system", "low"]]],
  ["Andes Low Carbon Concrete", "COL", "materials", "low-carbon concrete", "latin_america", "series_a", "proven", ["commercial", "industrial", "infrastructure", "residential"], [], ["seismic"], [["Calcined-clay cement blend", "low"]]],
  ["Geopolimeros del Sur", "CHL", "materials", "geopolymer cement", "latin_america", "seed", "pilot", ["infrastructure", "industrial"], [], ["seismic"], [["Fly-ash geopolymer binder", "low"]]],
  ["Bambu Estructural", "CRI", "materials", "bamboo", "latin_america", "pre_seed", "early_commercial", ["hospitality", "residential"], ["tropical_humid"], ["seismic", "hurricane"], [["Engineered bamboo frame", "low"], ["Bamboo glulam panels", "low"]]],
  ["Northwoods Mass Timber", "CAN", "construction", "mass timber", "north_america", "growth", "scaled", ["commercial", "residential", "mixed_use"], ["temperate", "cold"], ["seismic"], [["CLT floor and wall panels", "low"], ["Glulam post-and-beam kit", "low"]]],
  ["ModuHaus Volumetric", "USA", "construction", "volumetric construction", "north_america", "series_b", "proven", ["residential", "affordable_housing", "hospitality"], [], ["hurricane"], [["Steel-frame volumetric modules", "fast"]]],
  ["Casa Rapida Panelized", "MEX", "construction", "panelized", "latin_america", "series_a", "early_commercial", ["affordable_housing", "residential"], ["tropical_humid", "tropical_dry", "arid"], ["hurricane", "seismic"], [["Insulated concrete panel system", "fast"]]],
  ["PrintForm 3D Construction", "USA", "construction", "3D printing", "north_america", "series_b", "early_commercial", ["residential", "affordable_housing"], ["arid", "tropical_dry", "temperate"], ["hurricane"], [["Robotic cementitious wall printing", "fast"]]],
  ["Lattice Light Steel", "BRA", "construction", "light-gauge steel", "latin_america", "growth", "proven", ["residential", "commercial"], [], ["seismic", "hurricane"], [["LGS framing system", "fast"]]],
  ["Precast Peninsular", "MEX", "construction", "precast systems", "latin_america", "private_equity", "scaled", ["industrial", "infrastructure", "commercial"], [], ["hurricane"], [["Hollow-core precast slabs", "fast"]]],
  ["SiteSense Robotics", "USA", "contech", "reality capture", "north_america", "series_a", "early_commercial", ["commercial", "infrastructure", "industrial"], [], [], [["Autonomous site scanning", "neutral"]]],
  ["TwinBuild Digital", "GBR", "contech", "digital twins", "europe", "series_b", "proven", ["commercial", "infrastructure", "mixed_use"], [], [], [["Construction digital twin platform", "neutral"]]],
  ["PlanWorks BIM", "ESP", "contech", "BIM", "europe", "growth", "scaled", ["commercial", "residential", "mixed_use", "hospitality"], [], [], [["Cloud BIM coordination", "neutral"]]],
  ["Obra Control", "MEX", "contech", "project controls", "latin_america", "seed", "early_commercial", ["residential", "commercial"], [], [], [["Cost and schedule control app", "neutral"]]],
  ["SkyGrade Drones", "AUS", "contech", "drones", "oceania", "series_a", "proven", ["infrastructure", "industrial"], [], [], [["Drone earthworks surveying", "neutral"]]],
  ["Helio Rooftop Systems", "MEX", "energy", "solar PV", "latin_america", "series_a", "proven", ["hospitality", "commercial", "residential", "mixed_use"], ["tropical_humid", "tropical_dry", "arid"], ["hurricane"], [["Hurricane-rated rooftop PV racking", "neutral"]]],
  ["VoltStore BESS", "USA", "energy", "BESS", "north_america", "growth", "scaled", ["commercial", "industrial", "data_center", "hospitality"], [], [], [["LFP containerized storage", "neutral"]]],
  ["Microred Caribe", "DOM", "energy", "microgrids", "latin_america", "seed", "early_commercial", ["hospitality", "mixed_use", "infrastructure"], ["tropical_humid"], ["hurricane"], [["Island-mode microgrid controller", "neutral"]]],
  ["ThermaLoop Heat Pumps", "DEU", "energy", "heat pumps", "europe", "growth", "scaled", ["residential", "commercial"], ["temperate", "cold"], [], [["Air-to-water heat pump", "neutral"]]],
  ["CoolMass Thermal Storage", "IND", "energy", "thermal storage", "india", "series_a", "early_commercial", ["commercial", "data_center", "industrial"], ["arid", "tropical_dry", "tropical_humid"], ["heat"], [["Ice thermal storage for cooling", "neutral"]]],
  ["Aurora Building OS", "SGP", "energy", "building management systems", "southeast_asia", "series_b", "proven", ["commercial", "hospitality", "mixed_use"], [], [], [["Cloud BMS and energy analytics", "neutral"]]],
  ["GeoTerra Geothermal", "NZL", "energy", "geothermal", "oceania", "series_a", "proven", ["commercial", "residential"], [], [], [["Ground-source loop design", "neutral"]]],
  ["ChargePoint Sur", "CHL", "energy", "EV infrastructure", "latin_america", "seed", "early_commercial", ["commercial", "hospitality", "residential"], [], [], [["Managed EV charging", "neutral"]]],
  ["AquaCosecha", "MEX", "water", "rainwater harvesting", "latin_america", "bootstrapped", "proven", ["hospitality", "residential", "mixed_use"], ["tropical_humid", "tropical_dry"], ["drought"], [["Rainwater capture and filtration", "neutral"]]],
  ["Humedal Systems", "MEX", "water", "constructed wetlands", "latin_america", "seed", "proven", ["hospitality", "mixed_use", "residential"], ["tropical_humid", "tropical_dry", "temperate"], [], [["Constructed wetland wastewater treatment", "neutral"]]],
  ["GreyLoop Water Reuse", "ISR", "water", "greywater", "middle_east", "series_a", "proven", ["residential", "hospitality", "commercial"], ["arid", "tropical_dry"], ["drought"], [["Greywater recycling unit", "neutral"]]],
  ["LeakSense Smart Water", "USA", "water", "leak detection", "north_america", "series_a", "proven", ["commercial", "residential", "hospitality"], [], [], [["Smart water metering and leak detection", "neutral"]]],
  ["DesalSol", "ARE", "water", "desalination", "middle_east", "growth", "proven", ["hospitality", "infrastructure"], ["arid", "tropical_dry"], ["drought"], [["Solar-powered reverse osmosis", "neutral"]]],
  ["Reclaim Deconstruction", "NLD", "circularity", "deconstruction", "europe", "seed", "early_commercial", ["commercial", "residential"], [], [], [["Material passport and deconstruction service", "low"]]],
  ["Agregado Circular", "COL", "circularity", "recycling", "latin_america", "seed", "early_commercial", ["infrastructure", "residential"], [], [], [["Recycled aggregate plant", "low"]]],
  ["Myco Panels", "USA", "materials", "mycelium materials", "north_america", "seed", "pilot", ["commercial", "residential"], ["temperate", "arid"], [], [["Mycelium acoustic panels", "low"]]],
  ["Hemp Habitat", "FRA", "materials", "hempcrete", "europe", "series_a", "early_commercial", ["residential"], ["temperate"], [], [["Hempcrete wall blocks", "low"]]],
  ["Cal Maya Lime", "MEX", "materials", "lime", "latin_america", "bootstrapped", "proven", ["hospitality", "residential"], ["tropical_humid", "tropical_dry"], [], [["Natural hydraulic lime renders", "low"]]],
  ["Vidrio Solar", "ESP", "materials", "glazing", "europe", "series_a", "proven", ["commercial", "hospitality"], [], ["heat"], [["Solar-control glazing", "neutral"]]],
  ["StormShield Envelopes", "USA", "resilience", "hurricane", "north_america", "private_equity", "scaled", ["residential", "hospitality", "commercial"], ["tropical_humid", "coastal"], ["hurricane", "flood"], [["Impact-rated window and roof system", "neutral"]]],
  ["FloodGuard Barriers", "NLD", "resilience", "flood", "europe", "series_a", "proven", ["commercial", "infrastructure"], [], ["flood"], [["Demountable flood barriers", "neutral"]]],
  ["SeismoBase Isolation", "JPN", "resilience", "seismic", "oceania", "growth", "scaled", ["commercial", "infrastructure"], [], ["seismic"], [["Base isolation bearings", "neutral"]]],
  ["Hogar Futuro Finance", "MEX", "property", "housing finance", "latin_america", "series_a", "early_commercial", ["affordable_housing", "residential"], [], [], [["Rent-to-own platform", "neutral"]]],
  ["KeyStack Proptech", "USA", "property", "developer platforms", "north_america", "series_b", "proven", ["residential", "mixed_use"], [], [], [["Development pipeline platform", "neutral"]]],
  ["Studio Bioclima", "MEX", "architecture", "bioclimatic design", "latin_america", "bootstrapped", "proven", ["hospitality", "residential", "mixed_use"], ["tropical_humid", "tropical_dry"], ["hurricane", "heat"], [["Bioclimatic design service", "low"]]],
];

const INVESTORS = ["Verde Climate Ventures", "Horizon Built Capital", "Latam Infrastructure Partners", "Circular Futures Fund", "Blue Planet Impact", "Northstar Growth Equity", "Pacific Resilience Fund",
  "Solaris Family Office", "Terra Nova Real Assets", "Cleantech Seed Collective", "Emerging Markets Housing Fund", "Andean Development Bank (sample)", "Green Building Finance Co.", "Coastal Adaptation Fund",
  "Mass Timber Capital", "Water Futures Partners", "Proptech Ventures Latam", "Global Materials Fund", "Microgrid Access Fund", "Strategic Cement Holdings (sample)"];

const MATERIALS: [string, string, string[], string[], string[]][] = [
  ["Stabilized compressed earth block", "compressed earth blocks", ["local", "natural", "low_carbon", "structural", "envelope"], ["tropical_dry", "arid", "tropical_humid"], ["heat"]],
  ["Rammed earth (lime-stabilized)", "rammed earth", ["local", "natural", "low_carbon", "structural", "envelope"], ["arid", "tropical_dry"], ["heat"]],
  ["Adobe (traditional)", "adobe", ["local", "natural", "low_carbon", "envelope"], ["arid"], ["heat"]],
  ["Regional limestone (sawn)", "natural stone", ["local", "natural", "structural", "exterior"], ["tropical_humid", "tropical_dry"], []],
  ["Natural hydraulic lime render", "lime", ["natural", "low_carbon", "exterior", "interior"], ["tropical_humid", "tropical_dry", "temperate"], []],
  ["Lime-based plaster", "lime", ["natural", "interior"], [], []],
  ["Calcined-clay cement concrete", "low-carbon concrete", ["low_carbon", "structural"], [], ["seismic"]],
  ["Geopolymer concrete", "geopolymer cement", ["low_carbon", "circular", "structural"], [], []],
  ["Recycled concrete aggregate", "recycled aggregate", ["circular", "structural"], [], []],
  ["Certified tropical hardwood", "timber", ["biobased", "structural"], ["tropical_humid"], []],
  ["Cross-laminated timber", "mass timber", ["biobased", "low_carbon", "structural"], ["temperate", "cold"], ["seismic"]],
  ["Glulam beams", "mass timber", ["biobased", "structural"], ["temperate", "cold"], []],
  ["Engineered bamboo", "bamboo", ["biobased", "low_carbon", "structural"], ["tropical_humid"], ["seismic"]],
  ["Round bamboo culms (treated)", "bamboo", ["biobased", "local", "structural"], ["tropical_humid"], []],
  ["Hempcrete blocks", "hempcrete", ["biobased", "insulation", "envelope"], ["temperate"], []],
  ["Mycelium panels", "mycelium materials", ["biobased", "interior"], [], []],
  ["Biochar-amended mortar", "biochar materials", ["low_carbon", "circular"], [], []],
  ["Agricultural-fibre board", "agricultural-waste materials", ["biobased", "circular", "interior"], [], []],
  ["Recycled plastic lumber", "recycled plastics", ["circular", "exterior"], ["tropical_humid", "coastal"], []],
  ["Recycled steel sections", "recycled metals", ["circular", "structural"], [], ["seismic", "hurricane"]],
  ["Wood-fibre insulation", "insulation", ["biobased", "insulation"], ["temperate", "cold"], []],
  ["Cellulose insulation", "insulation", ["biobased", "circular", "insulation"], ["temperate", "cold"], []],
  ["Mineral wool insulation", "insulation", ["insulation"], [], ["wildfire"]],
  ["Palm thatch roofing (traditional)", "roofing", ["local", "natural", "biobased"], ["tropical_humid"], []],
  ["Clay roof tiles", "roofing", ["natural", "exterior"], ["tropical_dry", "arid", "temperate"], []],
  ["Cool-roof coating", "coatings", ["exterior"], ["tropical_humid", "tropical_dry", "arid"], ["heat"]],
  ["Standing-seam metal roof (wind-rated)", "roofing", ["exterior"], [], ["hurricane"]],
  ["Ventilated rainscreen facade", "facade systems", ["envelope", "exterior"], [], []],
  ["Solar-control double glazing", "glazing", ["envelope"], [], ["heat"]],
  ["Impact-rated glazing", "glazing", ["envelope"], ["coastal", "tropical_humid"], ["hurricane"]],
  ["Low-VOC mineral paint", "coatings", ["interior"], [], []],
  ["Permeable pavers", "circular materials", ["exterior"], [], ["flood"]],
  ["Reclaimed brick", "circular materials", ["circular", "exterior"], [], []],
  ["Compressed stabilized earth tiles", "compressed earth blocks", ["local", "natural"], ["tropical_dry"], []],
  ["Coconut-fibre boards", "agricultural-waste materials", ["biobased", "local"], ["tropical_humid"], []],
];

const SYSTEMS: [string, string, string[], string[], string[], string, string, string][] = [
  ["Conventional reinforced concrete frame", "conventional construction", [], [], ["residential", "commercial", "hospitality", "industrial"], "neutral", "neutral", "higher"],
  ["Load-bearing compressed earth block", "conventional construction", ["tropical_dry", "arid", "tropical_humid"], ["heat"], ["hospitality", "residential", "affordable_housing"], "slower", "lower", "lower"],
  ["Rammed earth walls", "hybrid systems", ["arid", "tropical_dry"], ["heat"], ["hospitality", "residential"], "slower", "neutral", "lower"],
  ["Volumetric steel modules", "volumetric construction", [], ["hurricane"], ["residential", "hospitality", "affordable_housing"], "faster", "neutral", "neutral"],
  ["Volumetric timber modules", "volumetric construction", ["temperate", "cold"], [], ["residential", "hospitality"], "faster", "neutral", "lower"],
  ["Panelized insulated concrete", "panelized", [], ["hurricane", "seismic"], ["affordable_housing", "residential"], "faster", "lower", "neutral"],
  ["Panelized light-gauge steel", "light-gauge steel", [], ["seismic", "hurricane"], ["residential", "commercial"], "faster", "neutral", "neutral"],
  ["CLT platform construction", "mass timber", ["temperate", "cold"], ["seismic"], ["commercial", "residential", "mixed_use"], "faster", "higher", "lower"],
  ["Glulam post and beam", "mass timber", ["temperate"], [], ["commercial", "hospitality"], "faster", "higher", "lower"],
  ["Engineered bamboo frame", "hybrid systems", ["tropical_humid"], ["seismic", "hurricane"], ["hospitality", "residential"], "neutral", "lower", "lower"],
  ["3D-printed cementitious walls", "3D printing", ["arid", "tropical_dry", "temperate"], [], ["residential", "affordable_housing"], "faster", "neutral", "neutral"],
  ["Hollow-core precast floors", "precast systems", [], [], ["industrial", "commercial", "infrastructure"], "faster", "neutral", "neutral"],
  ["Tilt-up concrete", "precast systems", [], [], ["industrial"], "faster", "lower", "neutral"],
  ["Steel portal frame", "conventional construction", [], [], ["industrial", "data_center"], "faster", "neutral", "higher"],
  ["Hybrid timber-concrete", "hybrid systems", ["temperate"], [], ["commercial", "mixed_use"], "neutral", "neutral", "lower"],
  ["Elevated timber pavilions on piers", "hybrid systems", ["tropical_humid"], ["flood"], ["hospitality"], "neutral", "neutral", "lower"],
  ["Off-site bathroom pods", "off-site manufacturing", [], [], ["hospitality", "residential"], "faster", "neutral", "neutral"],
  ["Robotic brick laying", "robotic construction", [], [], ["residential", "commercial"], "faster", "neutral", "neutral"],
  ["Masonry with lime mortar", "conventional construction", ["tropical_humid", "tropical_dry", "temperate"], [], ["hospitality", "residential"], "slower", "neutral", "lower"],
  ["Modular micro-cabins", "modular", [], ["hurricane"], ["hospitality"], "faster", "neutral", "neutral"],
];

const SIGNALS: [company: number, type: string, summary: string, region: string, importance: string, daysAgo: number, why: string][] = [
  [5, "geographic_expansion", "Volumetric modular producer announces entry into Mexico", "latin_america", "high", 3, "Matches residential and hospitality demos in Mexico"],
  [6, "funding_round", "Panelized system company closes Series A", "latin_america", "high", 6, "New capital for regional expansion; pilot-site interest"],
  [1, "production_capacity", "Low-carbon concrete producer adds plant capacity", "latin_america", "medium", 9, "Supply availability for Mexico projects"],
  [16, "partnership", "BESS provider partners with a regional EPC", "north_america", "medium", 12, "Integration with solar projects"],
  [17, "pilot", "Microgrid controller pilot at a Caribbean resort", "latin_america", "high", 4, "Relevant to Yucatán Eco Park resilience"],
  [23, "product_launch", "Rainwater system launched for hospitality", "latin_america", "medium", 18, "Water-stressed sites"],
  [4, "new_factory", "Mass timber producer opens second factory", "north_america", "low", 25, "Temperate projects only"],
  [7, "certification", "3D-printed wall system receives code evaluation", "north_america", "medium", 15, "Permitting path for printed housing"],
  [36, "funding_round", "Base isolation company raises growth capital", "oceania", "low", 40, "Seismic regions"],
  [37, "housing_program", "Affordable housing rent-to-own program announced", "latin_america", "high", 2, "Housing opportunity in Mexico"],
  [15, "geographic_expansion", "Hurricane-rated rooftop PV expands across the Caribbean", "latin_america", "medium", 20, "Coastal hospitality"],
  [11, "partnership", "Digital twin platform partners with a developer group", "europe", "low", 30, "Portfolio monitoring"],
  [0, "tender", "Municipal tender for earth-block community buildings", "latin_america", "high", 5, "Pilot opportunity for compressed earth"],
  [33, "embodied_carbon_rule", "Sample embodied-carbon disclosure rule proposed", "europe", "medium", 10, "Affects material selection"],
  [39, "deployment", "Bioclimatic studio completes eco-lodge", "latin_america", "medium", 22, "Design precedent for tropical hospitality"],
];

export async function seedBuiltDemo(db: Db, M: string, projectIds: string[], today = new Date()) {
  const org = async (name: string, country: string) => (await db.insert(organizations).values({ mandateId: M, name: D(name), nameNormalized: normalizeOrgName(D(name)), country, source: "other", description: "Demo record for training and walkthroughs; not a real organization." }).returning({ id: organizations.id }))[0].id;
  const investors: string[] = [];
  for (const n of INVESTORS) investors.push(await org(n, "USA"));
  const coIds: string[] = [];
  for (const [i, c] of COMPANIES.entries()) {
    const [name, country, taxonomy, subsector, region, stage, maturity, segments, climates, hazards, techs] = c;
    const id = await org(name, country);
    coIds.push(id);
    await db.insert(beCompanyProfiles).values({
      mandateId: M, orgId: id, operatingRegions: [region], taxonomy: [taxonomy], subsectors: [subsector], technologyType: subsector, productCategory: subsector, buildingSegments: segments, maturity, fundingStage: stage,
      investorOrgIds: [investors[i % investors.length], investors[(i * 7 + 3) % investors.length]], latestRound: stage.replace("_", " "), summary: `Sample ${subsector} company for demos.`, problemSolved: `Sample: ${subsector} for ${segments.slice(0, 2).join(" and ")} projects.`,
      targetRegions: region === "latin_america" ? ["latin_america"] : [region, "latin_america"].slice(0, i % 3 === 0 ? 2 : 1), partnershipInterest: i % 2 === 0, pilotInterest: i % 3 === 0,
      expansionStatus: i % 3 === 0 ? "Expanding into Latin America (sample)" : "", origin: "demo",
    });
    for (const [t, prof] of techs) await db.insert(beTechnologies).values({
      mandateId: M, orgId: id, name: D(t), category: taxonomy, subcategory: subsector, maturity, trl: maturity === "pilot" ? 6 : maturity === "early_commercial" ? 8 : 9, climates, hazards, buildingTypes: segments,
      effects: { embodied: prof === "low" ? "lower" : "unknown", speed: prof === "fast" ? "lower" : "unknown", capex: "unknown", opex: "unknown" }, bankability: maturity === "scaled" ? "established" : "limited track record", origin: "demo",
    });
  }
  // A few extra technologies so the register is realistic in size (sample variants of existing ones).
  const extras: [number, string][] = [[15, "Carport PV canopies"], [16, "Behind-the-meter BESS for hospitality"], [17, "Solar-plus-storage microgrid"], [20, "Occupancy-based HVAC control"], [23, "Stormwater retention tanks"], [24, "Decentralized wastewater package plant"], [38, "Build-to-rent pipeline analytics"]];
  for (const [ci, t] of extras) { const c = COMPANIES[ci]; await db.insert(beTechnologies).values({ mandateId: M, orgId: coIds[ci], name: D(t), category: c[2], subcategory: c[3], maturity: c[6], climates: c[8], hazards: c[9], buildingTypes: c[7], effects: {}, origin: "demo" }); }
  for (const [i, [name, family, tags, climates, hazards]] of MATERIALS.entries()) {
    const supplier = COMPANIES.findIndex(c => c[3] === family || c[2] === "materials" && family.includes(c[3].split(" ")[0]));
    await db.insert(beMaterials).values({ mandateId: M, name: D(name), family, supplierOrgId: supplier >= 0 ? coIds[supplier] : null, origin: "demo", tags, climates, hazards, embodiedCarbonState: "unverified", localAvailability: tags.includes("local") ? ["latin_america"] : [], cost: "Not recorded", leadTime: i % 4 === 0 ? "Not recorded" : "" });
  }
  for (const [name, kind, climates, hazards, types, speed, cost, carbon] of SYSTEMS) {
    const prov = COMPANIES.map((c, i) => ({ c, i })).filter(x => x.c[3] === kind || x.c[10].some(t => t[0].toLowerCase().includes(kind.split(" ")[0]))).map(x => coIds[x.i]).slice(0, 3);
    await db.insert(beSystems).values({ mandateId: M, name: D(name), kind, climates, hazards, buildingTypes: types, speedEffect: speed === "faster" ? "lower" : speed === "slower" ? "higher" : "neutral", costEffect: cost, carbonEffect: carbon, providerOrgIds: prov, origin: "demo" });
  }
  for (const [ci, type, summary, region, importance, daysAgo, why] of SIGNALS) {
    await db.insert(beSignals).values({ mandateId: M, date: new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10), orgId: coIds[ci], entity: D(COMPANIES[ci][0]), type, summary: `${summary} (sample)`, source: "DEMO sample signal (not a real event)", region, importance, why, relevance: why, projectIds: projectIds.slice(0, 2), suggestedAction: "Review fit; consider a partnership opportunity", origin: "demo" });
  }
  // Governed knowledge sample: restricted, consent pending, not searchable.
  await db.insert(beKnowledge).values({ mandateId: M, title: D("Vernacular Maya house ventilation (sample record)"), knowledgeType: "passive ventilation", summary: "Sample governed record: content would be held under the community's terms.", community: D("Sample community"), access: "consent_pending", consentStatus: "not_requested", benefitSharingRequired: true, createdBy: "demo" });
  // Project matches and procurement (RFI / RFP) on the demo projects.
  for (const pid of projectIds) await runBuiltIntelligence(db, pid, "demo");
  const matches = await db.select().from(beMatches).where(inArray(beMatches.projectId, projectIds));
  const withProviders = matches.filter(m => m.providerOrgIds.length).slice(0, 5);
  for (const [i, m] of withProviders.entries()) {
    const stage = i < 2 ? "rfi" : "rfp";
    const [pkg] = await db.insert(procurementPackages).values({ projectId: m.projectId, mandateId: M, name: D(`${stage.toUpperCase()} · ${m.label.replace("DEMO — ", "")}`), category: m.category === "energy" ? "equipment" : m.category === "materials" ? "supply" : "civil", stage, scope: `Sample ${stage.toUpperCase()} from a built-environment recommendation.`, bidsDueAt: new Date(today.getTime() + (8 + i * 5) * 86_400_000).toISOString().slice(0, 10), owner: "demo" }).returning({ id: procurementPackages.id });
    for (const o of m.providerOrgIds.slice(0, 3)) await db.insert(bids).values({ packageId: pkg.id, projectId: m.projectId, mandateId: M, orgId: o, bidder: "DEMO supplier", status: stage === "rfp" ? "received" : "invited", scores: stage === "rfp" ? { technical: 6 + (i % 3), cost: 5 + (i % 4), schedule: 7 } : {} });
    for (const o of m.providerOrgIds.slice(0, 1)) await db.insert(networkProfiles).values({ mandateId: M, orgId: o, roles: ["supplier"], approvedStatus: i % 2 ? "in_review" : "not_assessed", trackRecord: "Sample" }).onConflictDoNothing();
  }
  await db.insert(beOpportunities).values({ mandateId: M, orgId: coIds[0], title: D("Earth-block pilot at Yucatán Eco Park"), kinds: ["pilot_site", "market_entry"], projectIds: projectIds.slice(0, 1), feeModels: ["retainer"], feeCompliance: "unknown", regeneraAssets: "Sample: demo projects in Mexico", status: "identified" });
  return { companies: coIds.length, investors: investors.length };
}

export const BUILT_DEMO_TABLES = [beOpportunities, beMatches, beSignals, beSystems, beMaterials, beTechnologies, beCompanyProfiles, beKnowledge] as const;
