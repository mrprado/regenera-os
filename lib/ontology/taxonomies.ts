// Controlled taxonomies of the Regenera canonical ontology v1.0 (docs/plans/phase-19-ontology-data-fabric.md).
// Pure constants: imported by db/ontology.ts, lib/* and pages. Keys are stable; labels can change.

/** Evidence levels L0–L4. Earlier screens used 1/2/3 (screening / jurisdictional / project): they map to L1/L2/L3. */
export const EVIDENCE_LEVELS = {
  0: { code: "L0", label: "Discovery", use: "Worth investigating: news, GDELT, OpenStreetMap, AI extraction. Never a basis for a decision." },
  1: { code: "L1", label: "Global screening", use: "Preliminary analysis: World Bank, WRI, NASA, Copernicus, SoilGrids, GBIF." },
  2: { code: "L2", label: "Official jurisdictional", use: "Serious diligence: system operator, regulator, cadastre, planning authority, permit register." },
  3: { code: "L3", label: "Project evidence", use: "Land title, interconnection study, PPA, EIA, survey, geotechnical, hydrology, engineering." },
  4: { code: "L4", label: "Verified professional", use: "Legal opinion, independent engineer, technical advisor report, audited model, surveyed title." },
} as const;
export type EvidenceLevel = keyof typeof EVIDENCE_LEVELS;
/** Legacy screening levels (1 screening, 2 jurisdictional, 3 project) keep their number: they are L1, L2, L3. */
export const levelCode = (n: number) => EVIDENCE_LEVELS[(Math.max(0, Math.min(4, Math.round(n))) as EvidenceLevel)].code;

/** Visibility of a record or field. Community-controlled and TEK-restricted never reach search, Ask or MCP. */
export const VISIBILITY = {
  public: "Public", internal: "Internal", client: "Client", nda: "NDA counterparties", restricted: "Restricted (named people)",
  community_controlled: "Community-controlled", tek_restricted: "TEK restricted",
} as const;
export const NEVER_SEARCHABLE: (keyof typeof VISIBILITY)[] = ["community_controlled", "tek_restricted"];

/** Organization roles. "Investor" is a role on an organization, not a separate root object. */
export const ORGANIZATION_ROLES = {
  developer: "Developer", sponsor: "Sponsor", epc: "EPC", oem: "OEM / manufacturer", investor: "Investor", lender: "Lender", dfi: "DFI",
  offtaker: "Offtaker", utility: "Utility", system_operator: "System operator (ISO/TSO)", advisor: "Advisor", consultant: "Consultant",
  legal: "Legal counsel", insurer: "Insurer", government: "Government", regulator: "Regulator", community: "Community organization",
  ngo: "NGO", landowner: "Landowner", om_provider: "O&M provider", surveyor: "Surveyor", land_agent: "Land agent",
} as const;

/** Land control: "land secured" is never a yes/no. */
export const LAND_CONTROL_TYPES = {
  none: "No control", loi: "Letter of intent", option: "Option agreement", lease: "Lease", purchase_agreement: "Purchase agreement",
  owned: "Owned (title)", concession: "Concession", usufruct: "Usufruct", easement: "Easement / right of way only",
  community_agreement: "Community / ejido agreement", government_allocation: "Government allocation",
} as const;
export const TITLE_EVIDENCE = { none: "None", claimed: "Claimed by counterparty", reviewed: "Reviewed (copy on file)", searched: "Registry searched", legal_opinion: "Legal opinion" } as const;
export const RIGHT_STATES = { unknown: "Unknown", not_needed: "Not needed", incomplete: "Incomplete", unconfirmed: "Unconfirmed", secured: "Secured" } as const;
export const CONFIDENCE = { low: "Low", medium: "Medium", high: "High" } as const;

export const STAKEHOLDER_CATEGORIES = {
  landholder: "Landholder", community: "Community", indigenous: "Indigenous people", local_government: "Local government", national_government: "National government",
  regulator: "Regulator", ngo: "NGO", neighbour: "Neighbour", employee: "Workforce / union", business: "Local business", media: "Media", other: "Other",
} as const;
export const LEVELS_3 = { low: "Low", medium: "Medium", high: "High" } as const;
export const STAKEHOLDER_POSITIONS = { unknown: "Unknown", supportive: "Supportive", neutral: "Neutral", concerned: "Concerned", opposed: "Opposed" } as const;

export const EQUIPMENT_CATEGORIES = {
  pv_module: "PV module", inverter: "Inverter", tracker: "Tracker", battery_cell: "Battery cell", battery_container: "Battery container", pcs: "PCS", ems: "EMS",
  wind_turbine: "Wind turbine", transformer: "Transformer", switchgear: "Switchgear", cable: "Cable", wte_reactor: "WtE reactor / gasifier", feed_system: "Feed system",
  generator: "Generator", gas_cleanup: "Gas clean-up", pump: "Pump", other: "Other",
} as const;
export const EQUIPMENT_STATUS = { considered: "Considered", shortlisted: "Shortlisted", selected: "Selected", ordered: "Ordered", delivered: "Delivered", installed: "Installed", rejected: "Rejected" } as const;

export const QUEUE_RELATIONS = { own_position: "This project's queue position", competing: "Competing position", nearby: "Nearby position (context)" } as const;

/** Identifier schemes for identity resolution: one Regenera ID, many external IDs and names. */
export const ALIAS_SCHEMES = {
  name: "Name / alias", lei: "LEI (GLEIF)", sec_cik: "SEC CIK", companies_house: "Companies House number", opencorporates: "OpenCorporates", wikidata: "Wikidata",
  eia_plant: "EIA plant ID", gem: "Global Energy Monitor ID", osm: "OpenStreetMap ID", iso_queue: "Interconnection queue ID", registry: "National registry number",
  tax_id: "Tax ID", domain: "Web domain", other: "Other",
} as const;

/** The 11 standard data-room folders and the document categories that fill each one. */
export const DATA_ROOM_FOLDERS: { key: string; label: string; categories: string[] }[] = [
  { key: "corporate", label: "01 Corporate", categories: ["corporate"] },
  { key: "land", label: "02 Land", categories: ["land", "map"] },
  { key: "technical", label: "03 Technical", categories: ["technical", "engineering", "study"] },
  { key: "grid", label: "04 Grid", categories: [] },
  { key: "environmental", label: "05 Environmental", categories: ["environmental"] },
  { key: "permitting", label: "06 Permitting", categories: ["permitting", "government"] },
  { key: "offtake", label: "07 Offtake", categories: ["commercial"] },
  { key: "financial", label: "08 Financial", categories: ["financial", "capital", "tax"] },
  { key: "legal", label: "09 Legal", categories: ["legal", "epc"] },
  { key: "insurance", label: "10 Insurance", categories: [] },
  { key: "esg", label: "11 ESG", categories: [] },
];

export const MATCH_KINDS = {
  investor: "Project ↔ investor", lender: "Project ↔ lender", epc: "Project ↔ EPC", oem: "Project ↔ equipment supplier",
  consultant: "Project ↔ consultant", offtaker: "Project ↔ offtaker",
} as const;
/** What a match kind looks for: network-profile roles (lib/procurement/vocab NETWORK_ROLES) and project-party roles
 *  held on other projects (lib/projects/vocab PARTY_ROLES). Grants are matched by the funding module, not here. */
export const MATCH_ROLE: Record<keyof typeof MATCH_KINDS, { network: string[]; party: string[] }> = {
  investor: { network: ["investor", "family_office", "foundation", "dfi"], party: ["investor", "sponsor"] },
  lender: { network: ["bank", "dfi"], party: ["lender"] },
  epc: { network: ["epc", "contractor"], party: ["epc"] },
  oem: { network: ["oem", "supplier"], party: ["oem"] },
  consultant: { network: ["engineer", "ecology", "hydrology", "energy", "gis", "forestry"], party: ["engineer", "advisor", "counsel"] },
  offtaker: { network: [], party: ["offtaker"] },
};

export const SANCTIONS_REVIEW = { pending: "Pending review", cleared: "Cleared (false positive)", confirmed: "Confirmed match" } as const;
