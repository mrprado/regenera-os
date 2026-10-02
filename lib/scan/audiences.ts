// Audience targeting definitions (phase 15 §7). Each audience has its OWN organization terms, exclusions, decision-maker
// titles, buying events and the attributes worth capturing; nothing is shared across audiences by group, so a bank
// search never inherits "EPC" or "law firm" terms. Terms are search inputs, not facts: a name or keyword match is
// recorded as "matches criteria" at most, and strategy is never inferred from a name (lib/scan/criteria.ts).
import { SEGMENTS } from "@/lib/segments";

export const ORG_ROLES = {
  paying_client: "Paying client",
  prospective_client: "Prospective client",
  capital_provider: "Capital provider",
  referral_partner: "Referral partner",
  delivery_partner: "Delivery partner / specialist",
  public_body: "Public-sector contracting body",
  community: "Community / beneficiary",
  expansion_client: "Existing client, expansion",
} as const;
export type OrgRole = keyof typeof ORG_ROLES;

export type AudienceKind = "client" | "capital" | "partner" | "public" | "community";
export type Audience = {
  key: string;
  label: string;
  kind: AudienceKind;
  /** The role a matching organization would hold for Regenera if qualified (never assigned automatically). */
  role: OrgRole;
  purpose: string;
  /** Apollo organization keyword tags and the internal re-screen use these; one audience, one vocabulary. */
  orgTerms: string[];
  /** Evidence words looked for in industry / description (case-insensitive word stems). */
  evidence: RegExp;
  /** Words that, when present in the name / industry / description, contradict the audience. */
  exclude: RegExp | null;
  titles: string[];
  seniorities: string[];
  buyingEvents: string[];
  /** Attributes this audience needs before qualification; shown as missing until sourced. */
  capture: string[];
  entryOffer: string;
  /** Existing prospecting segment this audience feeds (playbooks, sequences). */
  segmentKey?: string;
};

const SENIOR = ["owner", "founder", "c_suite", "partner", "vp", "head", "director"];
const CAPITAL_CAPTURE = ["Organization type", "Investment strategy", "Geography", "Sector", "Instruments", "Ticket range and currency", "Stage preference", "Fund / vintage or vehicle", "Stated mandate source", "Assessment date"];
const DEV_CAPTURE = ["Actual capabilities", "Geographic coverage", "Relevant projects", "Development / construction stage", "Procurement or origination need", "Decision-makers", "Sourced buying event"];
const PARTNER_CAPTURE = ["Referral value", "Delivery capability", "Existing relationship", "Potential joint offering", "Attribution terms", "Conflicts"];

export const AUDIENCES: Audience[] = [
  { key: "epc_engineering", label: "EPC and engineering firms", kind: "client", role: "prospective_client", segmentKey: "epc_engineering",
    purpose: "Contractors that build energy and infrastructure assets and need qualified project origination or bid support.",
    orgTerms: ["EPC", "engineering procurement construction", "solar EPC", "BESS integrator", "electrical contractor", "balance of plant"],
    evidence: /\b(epc|engineering|construction|contractor|installer|integrator|balance of plant)\b/i, exclude: /\b(law|legal|bank|capital|fund|university|recruit)/i,
    titles: ["vice president business development", "director of preconstruction", "head of origination", "business development director", "chief commercial officer"], seniorities: SENIOR,
    buyingEvents: ["Entered a new market or ISO", "Won or lost a comparable bid", "Hiring business development or estimating staff", "Backlog gap disclosed"],
    capture: DEV_CAPTURE, entryOffer: "EPC origination pilot (pre-qualified project pipeline)" },
  { key: "renewable_developers", label: "Renewable-energy developers", kind: "client", role: "prospective_client", segmentKey: "energy_utilities",
    purpose: "Developers holding solar, wind, storage or hybrid projects whose site, grid or capital path needs a diagnostic.",
    orgTerms: ["renewable energy developer", "solar developer", "wind developer", "energy storage developer", "independent power producer"],
    evidence: /\b(renewable|solar|wind|storage|bess|photovoltaic|independent power|ipp|clean energy)\b/i, exclude: /\b(installer|residential solar|law|bank|recruit)/i,
    titles: ["head of development", "development director", "vice president development", "director of origination", "chief development officer"], seniorities: SENIOR,
    buyingEvents: ["Interconnection queue filing or withdrawal", "Land-use or permitting conflict", "Capital raise or sell-down", "New market entry"],
    capture: DEV_CAPTURE, entryOffer: "Project diagnostic (site, grid, land)" },
  { key: "real_estate_developers", label: "Real-estate developers and REITs", kind: "client", role: "prospective_client", segmentKey: "real_estate_developers",
    purpose: "Developers and owners deciding on land, entitlement and green-finance questions for specific sites.",
    orgTerms: ["real estate developer", "property developer", "REIT", "master planned community", "mixed-use development"],
    evidence: /\b(real estate|property|developer|reit|residential|mixed-use|master.?plan|housing)\b/i, exclude: /\b(broker|brokerage|agency|realtor|mortgage|utility|manufactur|agribusiness)/i,
    titles: ["head of development", "development director", "chief investment officer", "esg director", "vice president acquisitions"], seniorities: SENIOR,
    buyingEvents: ["Land acquisition", "Entitlement or zoning application", "Green bond or sustainability-linked finance", "Water or climate constraint on a site"],
    capture: DEV_CAPTURE, entryOffer: "Site and watershed diagnostic" },
  { key: "infrastructure_developers", label: "Infrastructure developers and operators", kind: "client", role: "prospective_client",
    purpose: "Sponsors and operators of water, transport, logistics and utility infrastructure facing territorial or capital decisions.",
    orgTerms: ["infrastructure developer", "PPP concessionaire", "water utility operator", "toll road operator", "logistics park developer"],
    evidence: /\b(infrastructure|concession|ppp|utility|water treatment|transport|logistics|port|airport|toll)\b/i, exclude: /\b(software|it infrastructure|cloud|data hosting|recruit)/i,
    titles: ["head of development", "chief executive officer", "director of projects", "head of business development"], seniorities: SENIOR,
    buyingEvents: ["Concession tender", "Refinancing", "Capacity expansion", "Regulatory change"],
    capture: DEV_CAPTURE, entryOffer: "Infrastructure readiness diagnostic" },
  { key: "funds_asset_managers", label: "Funds and asset managers (real assets)", kind: "capital", role: "capital_provider",
    purpose: "Managers with stated real-asset, infrastructure or climate strategies whose mandate may fit Regenera's projects.",
    orgTerms: ["infrastructure fund", "real assets fund", "climate infrastructure investor", "asset manager infrastructure"],
    evidence: /\b(fund|asset management|investment management|capital partners|infrastructure investor|real assets)\b/i, exclude: /\b(mutual fund distribution|insurance broker|crypto|recruit)/i,
    titles: ["partner", "investment director", "head of infrastructure", "principal", "managing director"], seniorities: SENIOR,
    buyingEvents: ["Fund launch or close", "New strategy announced", "Deployment pressure disclosed", "Senior investment hire"],
    capture: CAPITAL_CAPTURE, entryOffer: "Mandate brief and screening record", segmentKey: "blended_finance_vehicles" },
  { key: "family_offices", label: "Family offices", kind: "capital", role: "capital_provider", segmentKey: "impact_family_offices",
    purpose: "Single- and multi-family offices with an evidenced direct or impact real-asset strategy (never inferred from the name).",
    orgTerms: ["family office", "single family office", "multi family office", "private investment office"],
    evidence: /\b(family office|private investment office|family investment)\b/i, exclude: /\b(wealth advisor|financial planner|insurance)/i,
    titles: ["chief investment officer", "head of impact", "principal", "head of investments"], seniorities: SENIOR,
    buyingEvents: ["New allocation or impact programme", "Next-generation succession", "Investment hire"],
    capture: CAPITAL_CAPTURE, entryOffer: "Mandate definition session" },
  { key: "private_equity", label: "Private-equity firms", kind: "capital", role: "capital_provider",
    purpose: "PE firms with infrastructure, energy-transition or agri strategies that buy or build platforms.",
    orgTerms: ["private equity infrastructure", "energy transition private equity", "growth equity climate", "buyout infrastructure"],
    evidence: /\b(private equity|buyout|growth equity|equity partners|capital partners)\b/i, exclude: /\b(venture studio|crowdfunding|recruit)/i,
    titles: ["partner", "principal", "managing director", "head of energy transition", "operating partner"], seniorities: SENIOR,
    buyingEvents: ["Platform acquisition", "Fund close", "Exit or recapitalization", "New thesis published"],
    capture: CAPITAL_CAPTURE, entryOffer: "Platform screening brief" },
  { key: "dfis_mdbs", label: "DFIs and multilateral development banks", kind: "capital", role: "capital_provider", segmentKey: "dfis_multilaterals",
    purpose: "Development finance institutions whose country strategies and facilities cover Regenera's geographies and sectors.",
    orgTerms: ["development finance institution", "multilateral development bank", "development bank", "export credit agency"],
    evidence: /\b(development finance|development bank|multilateral|dfi|export credit|ifc|idb|ebrd|afdb|adb)\b/i, exclude: null,
    titles: ["investment officer", "principal investment officer", "sector lead", "head of infrastructure"], seniorities: [],
    buyingEvents: ["New facility or call for proposals", "Country strategy update", "Blended-finance window opened"],
    capture: CAPITAL_CAPTURE, entryOffer: "Screening briefing on mandate-fit projects" },
  { key: "banks_lenders", label: "Banks and institutional lenders", kind: "capital", role: "capital_provider", segmentKey: "banks_lenders",
    purpose: "Lenders with project-finance or infrastructure-debt desks that need bankable, screened projects.",
    orgTerms: ["project finance bank", "infrastructure debt", "commercial bank project finance", "green lending", "institutional lender"],
    evidence: /\b(bank|banking|lender|lending|debt|credit|project finance)\b/i, exclude: /\b(food bank|blood bank|data bank|seed bank|law|engineering|construction)/i,
    titles: ["project finance director", "head of infrastructure finance", "relationship manager energy", "director structured finance"], seniorities: SENIOR,
    buyingEvents: ["New infrastructure-debt fund or desk", "Green-loan framework", "Regional expansion"],
    capture: CAPITAL_CAPTURE, entryOffer: "Bankable-project screening brief" },
  { key: "foundations", label: "Foundations (PRI / MRI)", kind: "capital", role: "capital_provider", segmentKey: "foundations_pri_mri",
    purpose: "Foundations with programme-related or mission-related investment activity in land, water, energy or communities.",
    orgTerms: ["foundation impact investing", "program related investment", "mission related investment", "philanthropic foundation"],
    evidence: /\b(foundation|philanthrop|endowment|trust)\b/i, exclude: /\b(makeup|cosmetic|concrete foundation|foundation repair)/i,
    titles: ["program officer", "director of impact investing", "chief investment officer", "program director"], seniorities: [],
    buyingEvents: ["New strategy or programme", "Endowment alignment commitment", "Grant round opened"],
    capture: CAPITAL_CAPTURE, entryOffer: "Mandate definition session" },
  { key: "natural_capital_funds", label: "Natural-capital funds", kind: "capital", role: "capital_provider", segmentKey: "natural_capital_funds",
    purpose: "Funds investing in forestry, regenerative agriculture, water or biodiversity with a stated deployment mandate.",
    orgTerms: ["natural capital fund", "regenerative agriculture fund", "forestry investment", "nature-based solutions fund", "timberland investment"],
    evidence: /\b(natural capital|regenerative|forestry|timberland|nature.?based|biodiversity|carbon|agri.*fund)\b/i, exclude: /\b(carbon fiber|recruit)/i,
    titles: ["partner", "investment director", "managing director", "head of natural capital"], seniorities: SENIOR,
    buyingEvents: ["Fundraise or first close", "New strategy", "Deployment pressure"],
    capture: CAPITAL_CAPTURE, entryOffer: "Mandate brief and screening record" },
  { key: "architects_planners", label: "Architects and planners", kind: "partner", role: "referral_partner", segmentKey: "architects_planners",
    purpose: "Design and planning practices whose masterplans create territorial questions Regenera answers.",
    orgTerms: ["architecture firm", "urban planning", "masterplanning", "landscape architecture"],
    evidence: /\b(architect|planning|masterplan|urban design|landscape)\b/i, exclude: /\b(software architect|enterprise architecture|cloud)/i,
    titles: ["principal", "design director", "masterplanning director", "partner"], seniorities: SENIOR,
    buyingEvents: ["Large masterplan win", "New regional office", "Competition shortlist"],
    capture: PARTNER_CAPTURE, entryOffer: "Joint territorial concept" },
  { key: "legal_advisory_partners", label: "Legal and advisory referral partners", kind: "partner", role: "referral_partner", segmentKey: "esg_law",
    purpose: "Law firms and advisers whose energy, real-estate or ESG clients reach project decisions.",
    orgTerms: ["energy law firm", "project finance law", "ESG advisory", "real estate law firm", "transaction advisory infrastructure"],
    evidence: /\b(law|legal|attorney|abogados|advisory|counsel|solicitor)\b/i, exclude: /\b(engineering|construction|bank)\b/i,
    titles: ["partner", "counsel", "head of energy", "head of projects"], seniorities: ["partner", "head", "director", "c_suite"],
    buyingEvents: ["Client disclosure or permitting mandate", "New regulation", "New practice group"],
    capture: PARTNER_CAPTURE, entryOffer: "Partner Network invitation" },
  { key: "industrial_resource_clients", label: "Industrial and resource-system clients", kind: "client", role: "prospective_client", segmentKey: "industrials_manufacturers",
    purpose: "Plants and operators with waste, water or energy flows that decide project viability.",
    orgTerms: ["manufacturing plant", "food processing", "mining operator", "cement producer", "chemical manufacturer"],
    evidence: /\b(manufactur|industrial|processing|mining|cement|chemical|plant|mill)\b/i, exclude: /\b(software|consulting|recruit|bank)/i,
    titles: ["plant director", "chief sustainability officer", "head of environment", "vice president operations"], seniorities: SENIOR,
    buyingEvents: ["Waste or water cost pressure", "Disclosure requirement", "Closure or expansion plan"],
    capture: DEV_CAPTURE, entryOffer: "Waste and resource systems diagnostic" },
  { key: "landowners_agriculture", label: "Landowners and agricultural operators", kind: "client", role: "prospective_client", segmentKey: "landholders_ranches",
    purpose: "Large landholders and agricultural operators deciding how land produces value over time.",
    orgTerms: ["ranch", "agricultural estate", "farming operation", "plantation", "agribusiness producer"],
    evidence: /\b(ranch|farm|agricultur|estate|plantation|hacienda|agro|livestock)\b/i, exclude: /\b(real estate brokerage|software|bank)/i,
    titles: ["owner", "estate manager", "ranch manager", "general manager"], seniorities: ["owner", "founder", "c_suite", "head", "director", "manager"],
    buyingEvents: ["Succession", "Land degradation or drought", "Carbon or restoration interest"],
    capture: DEV_CAPTURE, entryOffer: "Productive-landscape diagnostic" },
  { key: "municipalities_authorities", label: "Municipalities and development authorities", kind: "public", role: "public_body", segmentKey: "municipalities",
    purpose: "Public bodies that contract diagnostics, plans and programmes; reached through procurement rules.",
    orgTerms: ["municipality", "city government", "development authority", "special economic zone", "regional government"],
    evidence: /\b(municipal|city of|county|government|authority|ministry|secretar[ií]a|ayuntamiento|zone)\b/i, exclude: null,
    titles: ["director of public works", "chief resilience officer", "planning director", "head of investment promotion"], seniorities: [],
    buyingEvents: ["Tender or procurement notice", "Disaster or service failure", "New development plan"],
    capture: ["Procurement route", "Budget cycle", "Decision body", "Relevant programme", "Source notice"], entryOffer: "Municipal systems diagnostic" },
  { key: "communities_conservation", label: "Communities and conservation organizations", kind: "community", role: "community", segmentKey: "community_land_trusts_ngos",
    purpose: "Community land trusts, Indigenous organizations and conservation NGOs: partners and beneficiaries, never a sales target.",
    orgTerms: ["land trust", "conservation organization", "indigenous organization", "community cooperative"],
    evidence: /\b(trust|conservation|indigenous|community|cooperative|ejido|ngo|nonprofit)\b/i, exclude: null,
    titles: ["executive director", "conservation director", "finance director"], seniorities: [],
    buyingEvents: ["Funding gap", "Land-rights outcome", "Programme launch"],
    capture: ["Governance and consent process", "Territory", "Programmes", "Funding needs", "Existing relationships"], entryOffer: "Financing pathways session" },
];

// Legal-name words for registry discovery (GLEIF fulltext): registries hold legal names, often Spanish or Portuguese in
// LATAM, so these are short name stems rather than industry phrases. A name hit is still only "suggested by name".
const REGISTRY_TERMS: Record<string, string[]> = {
  epc_engineering: ["EPC", "ingenieria", "constructora", "engineering", "solar"],
  renewable_developers: ["renovables", "renewable", "solar", "eolica", "wind"],
  real_estate_developers: ["inmobiliaria", "desarrollos", "real estate", "properties"],
  infrastructure_developers: ["infraestructura", "infrastructure", "concesionaria"],
  funds_asset_managers: ["infrastructure fund", "asset management", "capital partners"],
  family_offices: ["family office"],
  private_equity: ["private equity", "capital partners"],
  dfis_mdbs: ["development bank", "banco de desarrollo", "development finance"],
  banks_lenders: ["banco", "bank"],
  foundations: ["foundation", "fundacion"],
  natural_capital_funds: ["forestry", "timberland", "natural capital"],
  architects_planners: ["arquitectura", "architects", "architecture"],
  legal_advisory_partners: ["abogados", "law", "legal"],
  industrial_resource_clients: ["industrial", "manufacturing", "cementos", "mineria"],
  landowners_agriculture: ["agricola", "agropecuaria", "ranch"],
  municipalities_authorities: ["municipio", "municipality"],
  communities_conservation: ["asociacion civil", "cooperativa", "conservation"],
};
export const registryTermsFor = (a: Audience) => REGISTRY_TERMS[a.key] ?? a.orgTerms.slice(0, 3);

const BY_KEY = new Map(AUDIENCES.map(a => [a.key, a]));
export const audience = (key: string) => BY_KEY.get(key) ?? null;
export const AUDIENCE_KINDS: Record<AudienceKind, string> = { client: "Prospective clients", capital: "Capital providers", partner: "Referral & delivery partners", public: "Public-sector bodies", community: "Communities & conservation" };

/** Dedupes title strings case-insensitively, keeping the first spelling. */
export function uniqueTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  return titles.filter(t => { const k = t.trim().toLowerCase().replace(/\s+/g, " "); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Audience for an existing prospecting segment (playbooks use it for company terms). */
export function audienceForSegment(segmentKey: string): Audience | null {
  return AUDIENCES.find(a => a.segmentKey === segmentKey) ?? null;
}
export const SEGMENT_KEYS = new Set(SEGMENTS.map(s => s.key));
