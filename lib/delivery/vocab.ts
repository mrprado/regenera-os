// Project delivery vocabulary (docs/master-spec.md parts XVI, XX, LX and roadmap step 4: milestones, critical path,
// decisions; engineering; environmental and social; insurance). Keys are stable; labels can change.

export const MILESTONE_CATEGORIES = {
  land: "Land", permitting: "Permitting", environmental: "Environmental and social", grid: "Grid / interconnection",
  engineering: "Engineering", commercial: "Commercial / offtake", financing: "Financing", legal: "Legal and corporate",
  procurement: "Procurement", construction: "Construction", commissioning: "Commissioning", operations: "Operations", other: "Other",
} as const;
export const MILESTONE_STATUSES = { planned: "Planned", in_progress: "In progress", done: "Done", missed: "Missed", cancelled: "Cancelled" } as const;

export const DECISION_STATUSES = { open: "Open", decided: "Decided", revisited: "Revisited", withdrawn: "Withdrawn" } as const;

export const STUDY_TYPES = {
  survey: "Survey", topography: "Topography", geotechnical: "Geotechnical", hydrology: "Hydrology", flood: "Flood",
  seismic: "Seismic", resource: "Resource assessment (solar, wind, water, feedstock)", grid: "Grid / interconnection study",
  traffic_logistics: "Traffic and logistics", sector: "Sector study", esia: "ESIA", biodiversity: "Biodiversity baseline",
  market: "Market / offtake study", other: "Other",
} as const;
export type StudyType = keyof typeof STUDY_TYPES;
export const STUDY_STATUSES = {
  not_started: "Not started", scoping: "Scoping", procuring: "Procuring", in_progress: "In progress", draft: "Draft received",
  final: "Final received", accepted: "Accepted (reviewed)", superseded: "Superseded", not_required: "Not required",
} as const;
/** Statuses that mean the information exists (a draft counts as partial but present). */
export const STUDY_HAVE = new Set(["draft", "final", "accepted", "not_required"]);

export const DESIGN_STAGES = {
  concept: "Concept", feasibility: "Feasibility", pre_feed: "Pre-FEED", feed: "FEED", d30: "30% design", d60: "60% design",
  d90: "90% design", ifc: "Issued for construction", as_built: "As-built",
} as const;
export const DISCIPLINES = {
  civil: "Civil", structural: "Structural", electrical: "Electrical", mechanical: "Mechanical", process: "Process",
  geotechnical: "Geotechnical", hydrology: "Hydrology", fire: "Fire", controls: "Controls", grid: "Grid",
} as const;
export const DESIGN_STATUSES = { planned: "Planned", in_progress: "In progress", issued: "Issued", approved: "Approved by engineer of record", superseded: "Superseded" } as const;
// Engineering requirements: the OS tracks which codes apply and who confirmed; it never certifies compliance.
export const ENG_REQ_STATUSES = {
  identified: "Identified", applies: "Applies (to design basis)", confirmed: "Confirmed by engineer of record",
  not_applicable: "Not applicable", to_verify: "To verify",
} as const;

// Which studies a project at Development or later is expected to have, by asset class. Missing ones show on Today as
// "missing engineering information". This is a screening checklist, not an engineering scope.
export const CORE_STUDIES: Record<string, StudyType[]> = {
  solar: ["topography", "geotechnical", "resource", "grid", "flood"],
  wind: ["resource", "geotechnical", "grid", "traffic_logistics"],
  storage: ["geotechnical", "grid"],
  hydro: ["hydrology", "geotechnical", "seismic", "flood"],
  geothermal: ["resource", "geotechnical", "seismic"],
  grid: ["survey", "geotechnical", "grid"],
  hydrogen: ["resource", "geotechnical", "grid", "market"],
  waste_to_value: ["resource", "geotechnical", "market", "traffic_logistics"],
  water_infrastructure: ["hydrology", "geotechnical", "topography"],
  nature_based: ["survey", "biodiversity", "hydrology"],
  agriculture: ["survey", "hydrology", "market"],
  real_estate: ["survey", "topography", "geotechnical", "flood"],
  transport: ["survey", "geotechnical", "traffic_logistics"],
  industrial: ["survey", "geotechnical", "resource", "grid"],
  mixed_use: ["survey", "topography", "geotechnical", "hydrology"],
  other: ["survey", "geotechnical"],
};
export const ESIA_FROM_STAGE = "development";

// Environmental and social (part XX): topics, the standard each issue is judged against, and the mitigation hierarchy.
export const ES_TOPICS = {
  esia: "ESIA", biodiversity: "Biodiversity", critical_habitat: "Critical habitat", water: "Water", air: "Air", noise: "Noise",
  light: "Light", waste: "Waste", hazardous: "Hazardous materials", ghg: "GHG emissions", climate_resilience: "Climate resilience",
  labor: "Labor and working conditions", ohs: "Occupational health and safety", community_hs: "Community health and safety",
  land_acquisition: "Land acquisition", resettlement: "Resettlement", indigenous: "Indigenous peoples", cultural_heritage: "Cultural heritage",
  stakeholder: "Stakeholder engagement", grievance: "Grievance mechanism", supply_chain: "Supply-chain E&S", decommissioning: "Decommissioning",
} as const;
export const ES_FRAMEWORKS = {
  host_law: "Host-country law", ifc_ps: "IFC Performance Standards", ifc_ehs: "IFC/WBG EHS Guidelines", wb_esf: "World Bank ESF",
  equator: "Equator Principles", lender: "Other DFI / ECA / lender requirement",
} as const;
export const MITIGATION_STEPS = { avoid: "Avoid", minimize: "Minimize", restore: "Restore", offset: "Offset / compensate", none: "Not yet decided" } as const;
export const ES_STATUSES = { identified: "Identified", assessing: "Assessing", mitigating: "Mitigating", managed: "Managed", closed: "Closed" } as const;

// Insurance (part LX).
export const INSURANCE_TYPES = {
  car: "Construction all risks (CAR)", dsu: "Delay in start-up (DSU)", property: "Operational property", bi: "Business interruption",
  gl: "General liability", professional: "Professional indemnity", environmental: "Environmental liability", marine_cargo: "Marine cargo",
  political_risk: "Political risk", credit: "Credit", cyber: "Cyber", other: "Other",
} as const;
export const INSURANCE_PHASES = { construction: "Construction", operations: "Operations", both: "Construction and operations" } as const;
export const INSURANCE_STATUSES = { required: "Required", quoting: "Quoting", bound: "Bound", lapsed: "Lapsed", not_required: "Not required" } as const;
