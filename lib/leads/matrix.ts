// Lead generation by workflow (docs/plans/phase-27-lead-generation-by-workflow.md). A search is role × sector ×
// instrument × geography: the roles come from the workflow that needs the contact (a project sponsor, a lender for a
// capital need, an arranger for a bond…), the sector and instrument vocabularies stay separate so "blended finance"
// never pollutes an energy-developer search, and community bodies are never a target (Steward governs those).
import type { PeopleSearchParams } from "@/lib/sources/apollo";

export const LEAD_SECTORS = {
  energy: { label: "Energy", terms: ["renewable energy", "solar", "wind", "battery storage", "grid"] },
  land: { label: "Land and real estate", terms: ["land", "real estate", "masterplan", "site rehabilitation"] },
  agriculture: { label: "Agriculture and food", terms: ["regenerative agriculture", "agriculture", "agri-food", "sustainable sourcing"] },
  water: { label: "Water", terms: ["water", "wastewater", "desalination", "water utility"] },
  waste: { label: "Waste and resources", terms: ["waste management", "circular economy", "recycling", "resource recovery"] },
  infrastructure: { label: "Infrastructure", terms: ["infrastructure", "PPP", "public works", "transport"] },
  built: { label: "Built environment", terms: ["construction", "low carbon buildings", "mass timber", "modular construction"] },
  nature: { label: "Nature and carbon", terms: ["nature-based solutions", "natural capital", "biodiversity", "reforestation"] },
} as const;
export type LeadSector = keyof typeof LEAD_SECTORS;

export const LEAD_INSTRUMENTS = {
  equity: { label: "Equity", terms: ["private equity", "infrastructure fund", "real assets"] },
  debt: { label: "Senior debt / project finance", terms: ["project finance", "infrastructure debt", "structured finance"] },
  bond: { label: "Bonds (green, sustainability-linked, municipal)", terms: ["green bond", "sustainability-linked bond", "debt capital markets"] },
  blended: { label: "Blended finance", terms: ["blended finance", "concessional finance", "first loss", "guarantee"] },
  grant: { label: "Grants and philanthropy", terms: ["grant making", "philanthropy", "program related investment"] },
} as const;
export type LeadInstrument = keyof typeof LEAD_INSTRUMENTS;

type Workflow = {
  label: string; area: "Engage" | "Capital" | "Funding" | "Projects" | "Discover";
  /** Titles for people search; seniorities are added for Apollo. */
  roles: string[];
  /** Kinds of organisation, used for company search and as Apollo keywords. */
  orgs: string[];
  /** Capital workflows take an instrument; the others never add instrument words. */
  instrument?: LeadInstrument;
  why: string;
};

export const LEAD_WORKFLOWS = {
  sponsor: { label: "Project sponsor (diagnostic)", area: "Engage", roles: ["Chief Executive Officer", "Head of Development", "Chief Financial Officer", "Project Director", "Managing Director"], orgs: ["project developer", "sponsor"], why: "Decision makers who can commission a diagnostic for the project." },
  equity: { label: "Equity investors", area: "Capital", instrument: "equity", roles: ["Investment Director", "Partner", "Head of Real Assets", "Principal", "Managing Director"], orgs: ["infrastructure fund", "private equity", "impact fund"], why: "People who decide equity tickets in the sector." },
  lenders: { label: "Lenders (project finance)", area: "Capital", instrument: "debt", roles: ["Project Finance Director", "Head of Infrastructure Finance", "Director Structured Finance", "Relationship Manager"], orgs: ["bank", "infrastructure debt fund"], why: "Senior debt and project finance decision makers." },
  bond_issuers: { label: "Bond issuers", area: "Capital", instrument: "bond", roles: ["Treasurer", "Head of Funding", "Chief Financial Officer", "Head of Treasury"], orgs: ["municipality", "utility", "state-owned enterprise", "corporate issuer"], why: "Treasury teams that issue green or sustainability-linked bonds." },
  bond_arrangers: { label: "Bond arrangers and underwriters", area: "Capital", instrument: "bond", roles: ["Head of Debt Capital Markets", "Head of Sustainable Finance", "Director DCM", "Sustainable Finance Director"], orgs: ["investment bank", "debt capital markets"], why: "Arrangers who structure and place labelled bonds." },
  bond_reviewers: { label: "Second-party opinion and trustees", area: "Capital", instrument: "bond", roles: ["Head of Sustainable Finance Ratings", "Director Second Party Opinion", "Trust Officer", "Corporate Trust Director"], orgs: ["second party opinion", "ESG ratings", "corporate trustee"], why: "Reviewers and trustees a labelled bond needs." },
  blended: { label: "Blended finance (DFIs, guarantees, concessional)", area: "Capital", instrument: "blended", roles: ["Investment Officer", "Principal Investment Officer", "Program Manager", "Head of Blended Finance", "Guarantee Officer"], orgs: ["development finance institution", "multilateral development bank", "guarantee facility", "concessional fund"], why: "Concessional, guarantee and DFI capital that de-risks the structure." },
  grants: { label: "Grant makers and foundations", area: "Capital", instrument: "grant", roles: ["Program Officer", "Director of Programs", "Program Director", "Head of Grants"], orgs: ["foundation", "philanthropy", "grant maker"], why: "Programme staff who fund the theme." },
  consortium: { label: "Funding application partners", area: "Funding", roles: ["Business Development Director", "Head of Partnerships", "Research Director", "Grants Manager"], orgs: ["university", "research institute", "engineering firm", "NGO"], why: "Partners eligible to join a funding consortium." },
  offtakers: { label: "Offtakers and buyers", area: "Projects", roles: ["Head of Energy Procurement", "Head of Sourcing", "Procurement Director", "Chief Sustainability Officer"], orgs: ["corporate buyer", "utility", "food company"], why: "Buyers who sign offtake or sourcing agreements." },
  epc: { label: "EPC and engineering", area: "Projects", roles: ["Business Development Director", "Head of Engineering", "Project Director", "Head of Sustainability"], orgs: ["EPC", "engineering firm", "contractor"], why: "Delivery partners for engineering and construction." },
  operators: { label: "Energy developers, IPPs and grid operators", area: "Projects", roles: ["Head of Origination", "Grid Connections Manager", "Head of Development", "Development Director"], orgs: ["independent power producer", "utility", "transmission system operator"], why: "Energy origination and grid decision makers." },
  land: { label: "Landowners and land managers", area: "Projects", roles: ["Head of Land", "Estate Manager", "Development Director", "Land Manager"], orgs: ["landowner", "real estate developer", "estate"], why: "People who control land and its use (never community or Indigenous bodies)." },
  agriculture: { label: "Agriculture and food producers", area: "Projects", roles: ["Head of Sourcing", "Agronomy Director", "Cooperative Manager", "Head of Sustainability"], orgs: ["cooperative", "agri-food processor", "agribusiness"], why: "Producers, cooperatives and processors." },
  public: { label: "Public sector (water, waste, infrastructure)", area: "Discover", roles: ["Director of Public Works", "Utility Director", "Head of PPP Unit", "Environment Director"], orgs: ["municipality", "public utility", "PPP unit", "development authority"], why: "Public owners of water, waste and infrastructure." },
} as const satisfies Record<string, Workflow>;
export type LeadWorkflow = keyof typeof LEAD_WORKFLOWS;

/** Which workflows make sense for a record, first one preselected. */
export const WORKFLOWS_FOR: Record<string, LeadWorkflow[]> = {
  project: ["sponsor", "offtakers", "epc", "operators", "land", "agriculture", "lenders", "equity", "blended"],
  capital_need: ["equity", "lenders", "blended", "grants", "bond_issuers"],
  bond: ["bond_arrangers", "bond_reviewers", "bond_issuers"],
  funding_application: ["consortium", "grants"],
  queue_item: ["sponsor", "public"],
  general: ["sponsor", "equity", "lenders", "bond_issuers", "bond_arrangers", "bond_reviewers", "blended", "grants", "consortium", "offtakers", "epc", "operators", "land", "agriculture", "public"],
};

// Organisations Regenera must not prospect: community and Indigenous bodies belong to Steward (Phase 28 rule).
const EXCLUDE = ["indigenous", "community land trust", "first nation", "tribal council", "ejido", "comunidad"];

const q = (s: string) => (/[\s-]/.test(s) ? `"${s}"` : s);
const or = (terms: readonly string[]) => (terms.length === 1 ? q(terms[0]) : `(${terms.map(q).join(" OR ")})`);
const titleCase = (t: string) => t.replace(/(^|[\s/-])(\w)/g, (_, sep: string, c: string) => sep + c.toUpperCase());

export type LeadQueryInput = { workflow: LeadWorkflow; sector?: LeadSector | null; instrument?: LeadInstrument | null; country?: string | null; organization?: string | null };
export type LeadQuery = {
  peopleBoolean: string; companyBoolean: string;
  links: { linkedinPeople: string; salesNavigator: string; googlePeople: string; linkedinCompanies: string };
  apollo: PeopleSearchParams; why: string; label: string;
};

/** Builds every search for one need. Pure: same input, same strings. */
export function buildLeadQuery(input: LeadQueryInput): LeadQuery {
  const wf: Workflow = LEAD_WORKFLOWS[input.workflow];
  const instrument = wf.instrument ? (input.instrument ?? wf.instrument) : null;
  const sectorTerms = input.sector ? LEAD_SECTORS[input.sector].terms.slice(0, 3) : [];
  const instrumentTerms = instrument ? LEAD_INSTRUMENTS[instrument].terms.slice(0, 3) : [];
  // Capital: how they invest first, then the sector. Others: sector only.
  const topics = [...instrumentTerms, ...sectorTerms].slice(0, 5);
  const roles = wf.roles.map(titleCase);
  const org = input.organization?.trim();
  const where = input.country ? ` ${q(input.country)}` : "";
  const not = ` NOT ${or(EXCLUDE)}`;
  const peopleBoolean = `${or(roles)}${org ? ` AND ${q(org)}` : topics.length ? ` AND ${or(topics)}` : ""}${not}`;
  const companyBoolean = `${or(wf.orgs)}${topics.length ? ` AND ${or(topics)}` : ""}${not}`;
  const enc = encodeURIComponent;
  return {
    label: wf.label, why: wf.why, peopleBoolean, companyBoolean,
    links: {
      linkedinPeople: `https://www.linkedin.com/search/results/people/?keywords=${enc(peopleBoolean + where)}`,
      salesNavigator: `https://www.linkedin.com/sales/search/people?keywords=${enc(peopleBoolean)}`,
      googlePeople: `https://www.google.com/search?q=${enc(`site:linkedin.com/in ${or(roles.slice(0, 4))} ${org ? q(org) : or(topics.slice(0, 3))}${where}`.trim())}`,
      linkedinCompanies: `https://www.linkedin.com/search/results/companies/?keywords=${enc(`${or(wf.orgs.slice(0, 3))} ${topics[0] ?? ""}`.trim() + where)}`,
    },
    apollo: {
      person_titles: wf.roles.map(r => r.toLowerCase()),
      person_seniorities: ["owner", "founder", "c_suite", "partner", "vp", "head", "director"],
      ...(input.country ? { person_locations: [input.country] } : {}),
      ...(org ? { q_keywords: org } : topics.length ? { q_keywords: topics.slice(0, 2).join(" ") } : {}),
      include_similar_titles: true, per_page: 25,
    },
  };
}

/** True when an organisation looks like a community or Indigenous body: never prospected. */
export function isCommunityBody(name: string | null | undefined, roles?: string | null) {
  const s = `${name ?? ""} ${roles ?? ""}`.toLowerCase();
  return EXCLUDE.some(t => s.includes(t)) || /\bcommunity\b/.test(roles ?? "");
}

/** Map an OS sector key (projects, segments) to a lead sector. */
export function leadSectorFor(sector: string | null | undefined): LeadSector | null {
  const s = (sector ?? "").toLowerCase();
  if (/energy|solar|wind|power|storage|grid/.test(s)) return "energy";
  if (/agri|food|farm|ranch/.test(s)) return "agriculture";
  if (/water|wastewater/.test(s)) return "water";
  if (/waste|circular|resource/.test(s)) return "waste";
  if (/nature|forest|biodiversity|carbon|restoration/.test(s)) return "nature";
  if (/built|construction|building|housing/.test(s)) return "built";
  if (/land|real.?estate|property/.test(s)) return "land";
  if (/infra|transport|ppp/.test(s)) return "infrastructure";
  return null;
}
