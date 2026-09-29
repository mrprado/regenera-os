// Materials, procurement, supply chain and the EPC / supplier network (docs/master-spec.md XVII–XIX, LIII–LVI).

export const MATERIAL_CATEGORIES = {
  steel: "Steel", concrete: "Concrete and cement", aluminium: "Aluminium", copper: "Copper", glass: "Glass", pv_modules: "PV modules",
  batteries: "Batteries", inverters: "Inverters and power electronics", cables: "Cables", timber: "Timber", polymers: "Polymers and membranes",
  aggregates: "Aggregates and earthworks", pipes: "Pipes and valves", equipment: "Mechanical equipment", other: "Other",
} as const;

// Circularity hierarchy (part XVIII), most to least preferred.
export const CIRCULARITY = { avoid: "Avoid", reduce: "Reduce", reuse: "Reuse", reclaim: "Reclaim", recycle: "Recycle", recover: "Recover", dispose: "Dispose", unknown: "Not assessed" } as const;
export const TRANSPORT_MODES = { road: "Road", rail: "Rail", sea: "Sea", air: "Air", barge: "Barge", mixed: "Mixed" } as const;

// EN 15804 life-cycle stages carried by an EPD (kg CO2e per declared unit).
export const LCA_STAGES = { a1a3: "A1–A3 product", a4: "A4 transport", a5: "A5 construction", b: "B use", c: "C end of life", d: "D beyond the system" } as const;
export type LcaStage = keyof typeof LCA_STAGES;

export const PACKAGE_CATEGORIES = {
  epc: "EPC", equipment: "Major equipment", bop: "Balance of plant", civil: "Civil works", electrical: "Electrical works",
  supply: "Materials supply", services: "Services", consultancy: "Engineering / consultancy", logistics: "Logistics", om: "O&M", other: "Other",
} as const;
export type PackageCategory = keyof typeof PACKAGE_CATEGORIES;

// Procurement pipeline (part LIV).
export const PACKAGE_STAGES = {
  need: "Need", rfi: "RFI", rfp: "RFQ / RFP issued", bids: "Bids received", clarification: "Clarification", evaluation: "Evaluation",
  bafo: "BAFO", selection: "Selection", negotiation: "Negotiation", award: "Awarded", manufacturing: "Manufacturing", logistics: "Logistics",
  delivery: "Delivered", closed: "Closed", cancelled: "Cancelled",
} as const;
export type PackageStage = keyof typeof PACKAGE_STAGES;
export const AWARDED_STAGES: PackageStage[] = ["award", "manufacturing", "logistics", "delivery", "closed"];

export const BID_STATUSES = {
  invited: "Invited", declined: "Declined", received: "Received", clarification: "Clarification", shortlisted: "Shortlisted",
  bafo: "BAFO", selected: "Selected", not_selected: "Not selected", withdrawn: "Withdrawn",
} as const;

// Evaluation criteria (technical and commercial) with default weights; cost is scored from price automatically.
export const CRITERIA = {
  technical: "Technical", cost: "Cost", schedule: "Schedule", warranty: "Warranty and performance", bankability: "Bankability",
  track_record: "Track record", local_content: "Local content", carbon: "Materials and carbon", financing: "Financing support",
} as const;
export type Criterion = keyof typeof CRITERIA;
export const DEFAULT_WEIGHTS: Record<Criterion, number> = { technical: 25, cost: 30, schedule: 10, warranty: 10, bankability: 10, track_record: 5, local_content: 5, carbon: 5, financing: 0 };

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;

// Award → registered agreement type in the contract catalog.
export const AWARD_CONTRACT: Record<PackageCategory, { category: string; type: string }> = {
  epc: { category: "procurement", type: "epc" }, equipment: { category: "procurement", type: "equipment_purchase" }, bop: { category: "procurement", type: "bop" },
  civil: { category: "procurement", type: "construction" }, electrical: { category: "procurement", type: "construction" }, supply: { category: "procurement", type: "supply" },
  services: { category: "operations", type: "service" }, consultancy: { category: "engineering", type: "engineering_services" }, logistics: { category: "procurement", type: "logistics" },
  om: { category: "operations", type: "om" }, other: { category: "procurement", type: "supply" },
};

// Builders and suppliers network (part LVI).
export const NETWORK_ROLES = {
  epc: "EPC contractor", oem: "OEM / manufacturer", supplier: "Supplier / distributor", engineer: "Engineering firm", contractor: "Contractor", om: "O&M provider", logistics: "Logistics",
  // Ecosystem network (natural assets)
  investor: "Investor", bank: "Bank", dfi: "DFI", family_office: "Family office", foundation: "Foundation",
  forestry: "Forestry", ecology: "Ecology", hydrology: "Hydrology", energy: "Energy specialist", gis: "GIS / remote sensing",
  university: "University", institute: "Research institute", lab: "Laboratory",
  nursery: "Nursery", operator: "Operator / asset manager",
  ngo: "NGO", conservation: "Conservation organisation", community_org: "Community organisation",
  registry: "Registry", validator: "Validator (VVB)", verifier: "Verifier (VVB)", buyer: "Environmental buyer", broker: "Broker", insurer: "Insurer", mrv: "MRV provider",
  regulator: "Regulator", municipality: "Municipality", ministry: "Ministry", utility: "Utility",
  local_group: "Local group", indigenous: "Indigenous organisation", landholder: "Landholder", steward: "Steward",
} as const;
/** Ecosystem network grouping: how Regenera organises relationships around natural assets (not a generic CRM taxonomy). */
export const ECOSYSTEM_GROUPS: Record<string, { label: string; roles: (keyof typeof NETWORK_ROLES)[] }> = {
  capital: { label: "Capital", roles: ["investor", "bank", "dfi", "family_office", "foundation"] },
  technical: { label: "Technical", roles: ["engineer", "forestry", "ecology", "hydrology", "energy", "gis"] },
  research: { label: "Research", roles: ["university", "institute", "lab"] },
  implementation: { label: "Implementation", roles: ["epc", "nursery", "contractor", "operator", "om", "oem", "supplier", "logistics"] },
  conservation: { label: "Nature / conservation", roles: ["ngo", "conservation", "community_org"] },
  markets: { label: "Environmental markets", roles: ["registry", "validator", "verifier", "buyer", "broker", "insurer", "mrv"] },
  government: { label: "Government", roles: ["regulator", "municipality", "ministry", "utility"] },
  community: { label: "Community", roles: ["local_group", "indigenous", "landholder", "steward"] },
};
