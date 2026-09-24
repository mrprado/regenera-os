// Default trigger queries (SPEC sections 4 and 12a), tuned to Regenera's scope: capital mandates,
// energy, infrastructure, land, water, waste and resource systems. Stored in `trigger_queries`,
// editable without code; ensureTriggerQueries() adds missing ones and never overwrites edits.
import type { Db } from "@/db";
import { triggerQueries } from "@/db/schema";
import type { TRIGGER_TYPES } from "@/lib/vocab";

export type TriggerQueryDef = {
  key: string;
  source: "gdelt" | "ted" | "worldbank" | "edgar_form_d" | "gdacs";
  label: string;
  query: string;
  triggerType: (typeof TRIGGER_TYPES)[number];
  segmentKeys: string[];
  enabled?: boolean;
};

export const DEFAULT_TRIGGER_QUERIES: TriggerQueryDef[] = [
  // Capital: funds launching or closing in Regenera's sectors (news + SEC filings)
  { key: "gdelt_capital_funds", source: "gdelt", label: "Natural capital, regen ag and blended finance fund launches and closes", triggerType: "capital",
    query: '("natural capital fund" OR "regenerative agriculture fund" OR "nature-based solutions fund" OR "blended finance facility" OR "infrastructure fund") ("first close" OR "final close" OR launches OR launched)',
    segmentKeys: ["natural_capital_funds", "blended_finance_vehicles", "impact_family_offices", "pensions_insurers"] },
  { key: "formd_natural_capital", source: "edgar_form_d", label: "Form D: natural capital", triggerType: "capital", query: "natural capital", segmentKeys: ["natural_capital_funds"] },
  { key: "formd_regenerative", source: "edgar_form_d", label: "Form D: regenerative", triggerType: "capital", query: "regenerative", segmentKeys: ["natural_capital_funds", "impact_family_offices"] },
  { key: "formd_sustainable_infra", source: "edgar_form_d", label: "Form D: sustainable infrastructure", triggerType: "capital", query: "sustainable infrastructure", segmentKeys: ["blended_finance_vehicles", "pensions_insurers"] },
  { key: "formd_impact", source: "edgar_form_d", label: "Form D: impact fund", triggerType: "capital", query: "impact fund", segmentKeys: ["impact_family_offices", "foundations_pri_mri"] },
  // People: new decision-makers
  { key: "gdelt_people_moves", source: "gdelt", label: "New sustainability, impact and investment leaders", triggerType: "people",
    query: '(appointed OR appoints OR "names new" OR hires) ("chief sustainability officer" OR "head of impact" OR "chief investment officer" OR "head of sustainability")',
    segmentKeys: ["impact_family_offices", "food_consumer_brands", "real_estate_developers", "energy_utilities"] },
  // Crisis: water, waste, climate hazards hitting operators and municipalities
  { key: "gdelt_water_crisis", source: "gdelt", label: "Municipal water crises and drought", triggerType: "crisis",
    query: '("water crisis" OR "water shortage" OR "drought emergency" OR "water rationing") (municipality OR city OR utility OR mayor)',
    segmentKeys: ["municipalities", "agribusiness", "tourism_authorities"] },
  { key: "gdelt_landfill", source: "gdelt", label: "Landfill failures, closures and waste tenders", triggerType: "crisis",
    query: 'landfill (closure OR collapse OR fire OR crisis OR "reaches capacity" OR tender)',
    segmentKeys: ["municipalities", "industrials_manufacturers"] },
  { key: "gdacs_red_orange", source: "gdacs", label: "GDACS red and orange hazard alerts", triggerType: "crisis", query: "red,orange", segmentKeys: ["municipalities", "national_ministries"] },
  // Project: development constraints Regenera resolves
  { key: "gdelt_grid_constraints", source: "gdelt", label: "Grid interconnection and curtailment constraints", triggerType: "project",
    query: '("interconnection queue" OR "grid connection delay" OR curtailment OR "grid capacity") (solar OR wind OR "battery storage" OR renewable)',
    segmentKeys: ["energy_utilities", "epc_engineering"] },
  { key: "gdelt_desal_offshore", source: "gdelt", label: "Desalination, offshore wind and water infrastructure concessions", triggerType: "project",
    query: '(desalination OR "offshore wind" OR "water infrastructure") (tender OR auction OR concession OR "request for proposals")',
    segmentKeys: ["energy_utilities", "sovereign_funds_mena", "sezs_development_authorities"] },
  { key: "gdelt_land_projects", source: "gdelt", label: "Large land, resort and masterplan projects", triggerType: "project",
    query: '(masterplan OR "master plan" OR "eco-resort" OR "regenerative development" OR "land acquisition") (approved OR announces OR unveils) (hectares OR acres)',
    segmentKeys: ["real_estate_developers", "hospitality_tourism", "landholders_ranches"] },
  // Commitment and regulatory
  { key: "gdelt_nature_commitments", source: "gdelt", label: "Nature-positive and regenerative sourcing commitments", triggerType: "commitment",
    query: '("nature positive" OR "regenerative agriculture" OR "water positive" OR TNFD) (commitment OR pledge OR target OR programme OR program)',
    segmentKeys: ["food_consumer_brands", "agribusiness", "pensions_insurers"] },
  { key: "gdelt_eudr", source: "gdelt", label: "EU deforestation regulation compliance pressure", triggerType: "regulatory",
    query: '(EUDR OR "deforestation regulation") (compliance OR deadline OR suppliers OR traceability)',
    segmentKeys: ["agribusiness", "food_consumer_brands"] },
  { key: "gdelt_mine_closure", source: "gdelt", label: "Mine closure and site rehabilitation", triggerType: "regulatory",
    query: '("mine closure" OR "mine rehabilitation" OR "closure plan" OR "site rehabilitation") (approved OR submitted OR obligation OR repurposing)',
    segmentKeys: ["post_industrial_land"], enabled: false },
  // Procurement: consulting work Regenera can lead or join
  { key: "wb_environmental", source: "worldbank", label: "World Bank: environmental and social", triggerType: "procurement", query: "environmental", segmentKeys: ["national_ministries", "dfis_multilaterals"] },
  { key: "wb_water", source: "worldbank", label: "World Bank: water", triggerType: "procurement", query: "water", segmentKeys: ["municipalities", "national_ministries"] },
  { key: "wb_energy", source: "worldbank", label: "World Bank: renewable energy", triggerType: "procurement", query: "renewable energy", segmentKeys: ["energy_utilities", "national_ministries"] },
  { key: "wb_waste", source: "worldbank", label: "World Bank: solid waste", triggerType: "procurement", query: "solid waste", segmentKeys: ["municipalities"] },
  { key: "wb_land", source: "worldbank", label: "World Bank: land and landscape", triggerType: "procurement", query: "landscape", segmentKeys: ["national_ministries", "community_land_trusts_ngos"] },
  { key: "wb_feasibility", source: "worldbank", label: "World Bank: feasibility studies", triggerType: "procurement", query: "feasibility study", segmentKeys: ["national_ministries", "sezs_development_authorities"] },
  { key: "ted_feasibility", source: "ted", label: "EU tenders: feasibility and development studies", triggerType: "procurement", query: "feasibility study", segmentKeys: ["municipalities", "national_ministries"] },
  { key: "ted_eia", source: "ted", label: "EU tenders: environmental impact assessment", triggerType: "procurement", query: "environmental impact assessment", segmentKeys: ["municipalities", "energy_utilities"] },
  { key: "ted_nature_restoration", source: "ted", label: "EU tenders: nature restoration", triggerType: "procurement", query: "nature restoration", segmentKeys: ["national_ministries", "community_land_trusts_ngos"] },
  { key: "ted_water", source: "ted", label: "EU tenders: water resources and wastewater studies", triggerType: "procurement", query: "water resources", segmentKeys: ["municipalities"] },
  { key: "ted_waste_to_value", source: "ted", label: "EU tenders: waste valorisation", triggerType: "procurement", query: "waste valorisation", segmentKeys: ["municipalities", "industrials_manufacturers"] },
];

export async function ensureTriggerQueries(db: Db): Promise<void> {
  for (const q of DEFAULT_TRIGGER_QUERIES) {
    await db.insert(triggerQueries).values({ ...q, enabled: q.enabled ?? true }).onConflictDoNothing();
  }
}
