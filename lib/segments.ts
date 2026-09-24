// The 24 target segments (SPEC section 3), with Apollo free-plan search filters (SPEC section 5).
// Source of truth for the `segments` table; ensureSegments() upserts by key and never deletes.
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { segments } from "@/db/schema";

export type SegmentDef = {
  key: string;
  group: "capital" | "corporate" | "public" | "channel" | "community";
  name: string;
  path: "capital_mandate" | "project_diagnostic" | "partner_network";
  sectors: string[];
  titles: string[];
  triggers: string;
  practices: string[];
  entryOffer: string;
  angle: string;
  apolloFilters: {
    person_titles?: string[];
    person_seniorities?: string[];
    q_keywords?: string;
    organization_locations?: string[];
  };
  enabled?: boolean;
};

const SENIOR = ["owner", "founder", "c_suite", "partner", "vp", "head", "director"];
const ALL_SECTORS = ["energy", "infrastructure", "land_built_environment", "waste_resource_systems", "water_food_nature"];

export const SEGMENTS: SegmentDef[] = [
  // Capital
  { key: "impact_family_offices", group: "capital", name: "Impact family offices", path: "capital_mandate", sectors: ALL_SECTORS,
    titles: ["CIO", "Head of Impact", "Principal"], triggers: "New allocation, next-gen succession, new hire",
    practices: ["capital_partnerships"], entryOffer: "Mandate definition session", angle: "Define the mandate before projects are presented.",
    apolloFilters: { person_titles: ["chief investment officer", "head of impact", "principal", "head of investments"], person_seniorities: SENIOR, q_keywords: "family office impact" } },
  { key: "dfis_multilaterals", group: "capital", name: "DFIs and multilaterals", path: "capital_mandate", sectors: ALL_SECTORS,
    titles: ["Investment Officer", "Sector Lead"], triggers: "New facility or call for proposals, country strategy",
    practices: ["capital_partnerships"], entryOffer: "Screening briefing on mandate-fit projects", angle: "Mandate-fit projects, screened before review.",
    apolloFilters: { person_titles: ["investment officer", "sector lead", "principal investment officer"], q_keywords: "development finance" } },
  { key: "blended_finance_vehicles", group: "capital", name: "Blended finance vehicles", path: "capital_mandate", sectors: ALL_SECTORS,
    titles: ["Fund Manager", "Structuring Lead"], triggers: "Fund launch, first close, concessional tranche",
    practices: ["capital_partnerships"], entryOffer: "Capital-sequencing screen", angle: "Layers that are actually sequenced.",
    apolloFilters: { person_titles: ["fund manager", "structuring", "investment director"], q_keywords: "blended finance" } },
  { key: "natural_capital_funds", group: "capital", name: "Natural capital and regen ag funds", path: "capital_mandate", sectors: ["water_food_nature", "land_built_environment"],
    titles: ["Partner", "Investment Director"], triggers: "Fundraise, new strategy, deployment pressure",
    practices: ["capital_partnerships"], entryOffer: "Mandate brief and screening record", angle: "Deployment against a stated mandate.",
    apolloFilters: { person_titles: ["partner", "investment director", "managing director"], person_seniorities: SENIOR, q_keywords: "natural capital OR regenerative agriculture fund" } },
  { key: "foundations_pri_mri", group: "capital", name: "Foundations (PRI/MRI)", path: "capital_mandate", sectors: ALL_SECTORS,
    titles: ["Program Officer", "Impact Investing Director"], triggers: "New strategy, endowment alignment",
    practices: ["capital_partnerships"], entryOffer: "Mandate definition session", angle: "Mission-aligned mandate criteria.",
    apolloFilters: { person_titles: ["program officer", "director of impact investing", "mission related investment"], q_keywords: "foundation impact investing" } },
  { key: "pensions_insurers", group: "capital", name: "Pensions and insurers", path: "capital_mandate", sectors: ALL_SECTORS,
    titles: ["Head of Sustainable Investment"], triggers: "Net-zero or nature commitment, regulation",
    practices: ["capital_partnerships"], entryOffer: "Real-asset mandate brief", angle: "Real assets that meet the commitment.",
    apolloFilters: { person_titles: ["head of sustainable investment", "head of real assets", "head of infrastructure"], q_keywords: "pension OR insurance" } },
  { key: "sovereign_funds_mena", group: "capital", name: "Sovereign and state funds (MENA)", path: "capital_mandate", sectors: ALL_SECTORS,
    titles: ["Director Sustainability", "Real Assets"], triggers: "National programmes, giga-projects",
    practices: ["capital_partnerships", "systems_intelligence"], entryOffer: "Territorial opportunity briefing", angle: "Territory first, then capital.",
    apolloFilters: { person_titles: ["director sustainability", "real assets", "head of investments"], organization_locations: ["saudi arabia", "united arab emirates", "qatar", "oman", "bahrain", "kuwait"], q_keywords: "sovereign fund" } },
  // Corporate
  { key: "post_industrial_land", group: "corporate", name: "Post-industrial land and site rehabilitation", path: "project_diagnostic", sectors: ["land_built_environment", "water_food_nature"],
    titles: ["Closure Manager", "VP Environment", "Land Manager"], triggers: "Closure plan, rehabilitation obligation, land repurposing",
    practices: ["systems_intelligence", "development_strategy"], entryOffer: "Project diagnostic (land repurposing)", angle: "The site after closure is a development decision.",
    apolloFilters: { person_titles: ["closure manager", "rehabilitation manager", "environmental manager", "land manager"] }, enabled: false },
  { key: "agribusiness", group: "corporate", name: "Agribusiness", path: "project_diagnostic", sectors: ["water_food_nature"],
    titles: ["Head of Sourcing", "Sustainability Director"], triggers: "Deforestation rules, buyer demands, soil loss",
    practices: ["systems_intelligence"], entryOffer: "Productive-landscape diagnostic", angle: "Land as a producing system.",
    apolloFilters: { person_titles: ["head of sourcing", "sustainability director", "head of sustainable sourcing"], q_keywords: "agribusiness" } },
  { key: "food_consumer_brands", group: "corporate", name: "Food and consumer brands", path: "project_diagnostic", sectors: ["water_food_nature"],
    titles: ["CSO", "Head of Regenerative Sourcing"], triggers: "Public sourcing commitment, scope 3 targets",
    practices: ["development_strategy"], entryOffer: "Commitment-to-programme diagnostic", angle: "From commitment to a sequenced programme.",
    apolloFilters: { person_titles: ["chief sustainability officer", "head of regenerative agriculture", "head of sourcing"], q_keywords: "food beverage" } },
  { key: "real_estate_developers", group: "corporate", name: "Real estate developers and REITs", path: "project_diagnostic", sectors: ["land_built_environment", "water_food_nature"],
    titles: ["Head of Development", "ESG Director"], triggers: "Land acquisition, entitlement, green finance need",
    practices: ["development_strategy"], entryOffer: "Site and watershed diagnostic", angle: "A watershed boundary is a development boundary.",
    apolloFilters: { person_titles: ["head of development", "development director", "esg director"], q_keywords: "real estate development" } },
  { key: "energy_utilities", group: "corporate", name: "Energy and utilities", path: "project_diagnostic", sectors: ["energy", "infrastructure"],
    titles: ["Head of Development", "Land Manager"], triggers: "Project pipeline, interconnection delay, land-use conflict, community opposition",
    practices: ["systems_intelligence", "development_strategy"], entryOffer: "Project diagnostic (site, grid, land)", angle: "Interconnection queues are a development-stage risk.",
    apolloFilters: { person_titles: ["head of development", "development director", "land manager", "director of origination"], q_keywords: "renewable energy" } },
  { key: "hospitality_tourism", group: "corporate", name: "Hospitality and tourism", path: "project_diagnostic", sectors: ["land_built_environment", "water_food_nature"],
    titles: ["Owner", "Development Director"], triggers: "New resort or destination, certification",
    practices: ["development_strategy"], entryOffer: "Destination project diagnostic", angle: "The destination depends on the territory around it.",
    apolloFilters: { person_titles: ["owner", "development director", "head of development"], q_keywords: "resort hospitality development" } },
  { key: "industrials_manufacturers", group: "corporate", name: "Industrials and manufacturers", path: "project_diagnostic", sectors: ["waste_resource_systems", "energy"],
    titles: ["Plant Director", "CSO"], triggers: "Waste costs, water stress, disclosure",
    practices: ["systems_intelligence"], entryOffer: "Waste and resource systems diagnostic", angle: "Feedstock and material flows decide viability.",
    apolloFilters: { person_titles: ["plant director", "chief sustainability officer", "head of environment"], q_keywords: "manufacturing" } },
  // Public
  { key: "municipalities", group: "public", name: "Municipalities", path: "project_diagnostic", sectors: ["waste_resource_systems", "water_food_nature", "infrastructure"],
    titles: ["Mayor's office", "Public Works", "Environment Director"], triggers: "Landfill closure or crisis, tender, disaster",
    practices: ["systems_intelligence"], entryOffer: "Municipal systems diagnostic", angle: "Waste, water and land resolved as one system.",
    apolloFilters: { person_titles: ["director of public works", "environmental services director", "solid waste", "chief resilience officer"] } },
  { key: "national_ministries", group: "public", name: "National ministries", path: "project_diagnostic", sectors: ALL_SECTORS,
    titles: ["Environment, Agriculture, Energy officials"], triggers: "New policy, donor programme, NDC update",
    practices: ["development_strategy", "capital_partnerships"], entryOffer: "Programme readiness concept", angle: "Programmes that reach institutional readiness.",
    apolloFilters: { person_titles: ["director general", "secretary", "director of energy", "director of environment"], q_keywords: "ministry" } },
  { key: "sezs_development_authorities", group: "public", name: "SEZs and development authorities", path: "project_diagnostic", sectors: ["infrastructure", "land_built_environment", "energy"],
    titles: ["CEO", "Investment Promotion Head"], triggers: "New zone, investor push",
    practices: ["systems_intelligence", "development_strategy"], entryOffer: "Zone territorial diagnostic", angle: "Zone capacity is a territorial question.",
    apolloFilters: { person_titles: ["chief executive officer", "head of investment promotion"], q_keywords: "special economic zone OR development authority" } },
  { key: "tourism_authorities", group: "public", name: "Tourism authorities", path: "project_diagnostic", sectors: ["land_built_environment", "water_food_nature"],
    titles: ["Director General", "Planning Head"], triggers: "Overtourism, new destination plan",
    practices: ["systems_intelligence"], entryOffer: "Destination territorial framework", angle: "Carrying capacity before new supply.",
    apolloFilters: { person_titles: ["director general", "head of planning"], q_keywords: "tourism authority" } },
  // Channel (Partner Network)
  { key: "epc_engineering", group: "channel", name: "EPC and engineering firms", path: "partner_network", sectors: ["energy", "infrastructure", "waste_resource_systems"],
    titles: ["BD Director", "Head of Sustainability"], triggers: "Bid on relevant project, new market entry",
    practices: ["development_strategy"], entryOffer: "Partner Network invitation (Institutional tier)", angle: "Projects that reach the bid stage ready.",
    apolloFilters: { person_titles: ["business development director", "head of sustainability"], q_keywords: "EPC engineering construction" } },
  { key: "esg_law", group: "channel", name: "ESG law practices", path: "partner_network", sectors: ALL_SECTORS,
    titles: ["Partner", "Counsel"], triggers: "Client disclosure work, new regulation",
    practices: ["capital_partnerships"], entryOffer: "Partner Network invitation", angle: "Clients whose disclosure becomes a project decision.",
    apolloFilters: { person_titles: ["partner", "counsel"], q_keywords: "ESG sustainability law" } },
  { key: "big4_sustainability", group: "channel", name: "Big 4 sustainability teams", path: "partner_network", sectors: ALL_SECTORS,
    titles: ["Director", "Partner"], triggers: "Client gap in development expertise",
    practices: ["development_strategy"], entryOffer: "Specialist capability brief", angle: "Development expertise alongside the audit.",
    apolloFilters: { person_titles: ["director", "partner"], q_keywords: "sustainability climate", organization_locations: [] } },
  { key: "architects_planners", group: "channel", name: "Architects and planners", path: "partner_network", sectors: ["land_built_environment"],
    titles: ["Principal", "Design Director"], triggers: "Large masterplan win",
    practices: ["systems_intelligence"], entryOffer: "Joint territorial concept", angle: "The masterplan read against the territory.",
    apolloFilters: { person_titles: ["principal", "design director", "masterplanning director"], q_keywords: "architecture urban planning" } },
  { key: "banks_lenders", group: "channel", name: "Banks and institutional lenders", path: "partner_network", sectors: ALL_SECTORS,
    titles: ["Relationship Manager", "Project Finance Director"], triggers: "Sourcing bankable projects",
    practices: ["capital_partnerships"], entryOffer: "Partner Network invitation (Institutional tier)", angle: "Bankable projects, screened early.",
    apolloFilters: { person_titles: ["project finance director", "relationship manager", "head of infrastructure finance"], q_keywords: "project finance" } },
  // Community
  { key: "landholders_ranches", group: "community", name: "Large landholders and ranches", path: "project_diagnostic", sectors: ["water_food_nature", "land_built_environment"],
    titles: ["Owner", "Estate Manager"], triggers: "Succession, land degradation, carbon interest",
    practices: ["systems_intelligence"], entryOffer: "Productive-landscape diagnostic", angle: "Land value as a producing system.",
    apolloFilters: { person_titles: ["owner", "estate manager", "ranch manager"], q_keywords: "ranch OR estate agriculture" } },
  { key: "community_land_trusts_ngos", group: "community", name: "Indigenous and community land trusts, conservation NGOs", path: "project_diagnostic", sectors: ["water_food_nature"],
    titles: ["Director", "Finance Lead"], triggers: "Funding gap, land-rights win, programme launch",
    practices: ["capital_partnerships"], entryOffer: "Financing pathways session", angle: "Financing pathways that respect governance.",
    apolloFilters: { person_titles: ["executive director", "finance director", "conservation director"], q_keywords: "land trust OR conservation" } },
];

/** Idempotent: inserts missing segments and refreshes definitions, but keeps a segment's `enabled` choice. */
export async function ensureSegments(db: Db): Promise<void> {
  for (const s of SEGMENTS) {
    await db.insert(segments).values({ ...s, enabled: s.enabled ?? true })
      .onConflictDoUpdate({
        target: segments.key,
        set: {
          group: s.group, name: s.name, path: s.path, sectors: s.sectors, titles: s.titles, triggers: s.triggers,
          practices: s.practices, entryOffer: s.entryOffer, angle: s.angle, apolloFilters: s.apolloFilters,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        },
      });
  }
}
