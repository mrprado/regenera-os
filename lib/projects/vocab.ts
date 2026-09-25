// Project vocabulary from the master spec (docs/master-spec.md parts IX–XII, XXIII). Keys are stable; labels can change.

export const PROJECT_STAGES = {
  opportunity: "Opportunity", screening: "Screening", diagnostic: "Diagnostic", readiness: "Project readiness",
  development: "Development", structuring: "Structuring", capital_alignment: "Capital alignment", diligence: "Diligence",
  financial_close: "Financial close", engineering: "Engineering", procurement: "Procurement", construction: "Construction",
  commissioning: "Commissioning", cod: "COD", operations: "Operations", repowering: "Repowering", exit: "Exit",
  decommissioning: "Decommissioning",
} as const;
export type ProjectStage = keyof typeof PROJECT_STAGES;
export const STAGE_ORDER = Object.keys(PROJECT_STAGES) as ProjectStage[];

export const PROJECT_STATUSES = { active: "Active", on_hold: "On hold", dropped: "Dropped", operating: "Operating" } as const;

export const REGENERA_ROLES = {
  advisor: "Advisor", development_office: "Development office", co_developer: "Co-developer",
  capital_readiness: "Capital readiness support", monitoring: "Governance and monitoring", observer: "Tracking only",
} as const;

export const ASSET_CLASSES = {
  solar: "Solar", wind: "Wind", storage: "Storage", hydro: "Hydro", geothermal: "Geothermal", grid: "Grid and transmission",
  hydrogen: "Hydrogen and fuels", waste_to_value: "Waste to value", water_infrastructure: "Water infrastructure",
  nature_based: "Nature-based solutions", agriculture: "Agriculture and food", real_estate: "Real estate and built environment",
  transport: "Transport and logistics", industrial: "Industrial", mixed_use: "Mixed-use / territorial", other: "Other",
} as const;

export const READINESS_DIMENSIONS = {
  land: "Land", technical: "Technical", engineering: "Engineering", environmental: "Environmental", permitting: "Permitting",
  grid: "Grid / interconnection", commercial: "Commercial", financial: "Financial", capital: "Capital", legal: "Legal",
  stakeholder: "Stakeholder", procurement: "Procurement", construction: "Construction", operations: "Operations",
} as const;
export type ReadinessDimension = keyof typeof READINESS_DIMENSIONS;

export const READINESS_STATUSES = {
  unknown: "Unknown", not_started: "Not started", early: "Early", in_progress: "In progress",
  substantially_ready: "Substantially ready", ready: "Ready", blocked: "Blocked", not_applicable: "Not applicable",
} as const;

export const CONSTRAINT_CATEGORIES = {
  land: "Land", water: "Water", ecology: "Ecology", permitting: "Permitting", environmental: "Environmental",
  engineering: "Engineering", grid: "Grid", technical: "Technical", commercial: "Commercial", offtake: "Offtake",
  feedstock: "Feedstock", capital: "Capital", legal: "Legal", regulatory: "Regulatory", government: "Government",
  community: "Community", epc: "EPC", oem: "OEM", materials: "Materials", supply_chain: "Supply chain",
  logistics: "Logistics", labor: "Labor", tax: "Tax", currency: "Currency", data: "Data",
} as const;
export const SEVERITIES = { low: "Low", medium: "Medium", high: "High", critical: "Critical" } as const;
export const CONSTRAINT_STATUSES = { open: "Open", in_progress: "In progress", resolved: "Resolved", accepted: "Accepted risk" } as const;

export const PARTY_ROLES = {
  sponsor: "Sponsor", developer: "Developer", projectco: "ProjectCo / SPV", issuer: "Issuer", landowner: "Landowner",
  offtaker: "Offtaker", epc: "EPC", oem: "OEM / supplier", engineer: "Engineer", lender: "Lender", investor: "Investor",
  counsel: "Counsel", advisor: "Advisor", government: "Government / authority", community: "Community", other: "Other",
} as const;

export const INSTRUMENTS = {
  development_capital: "Development capital", sponsor_equity: "Sponsor equity", seed: "Seed capital", preferred_equity: "Preferred equity",
  project_equity: "Project equity", infrastructure_equity: "Infrastructure equity", strategic_equity: "Strategic equity",
  senior_debt: "Senior debt", project_finance: "Project finance", private_credit: "Private credit", mezzanine: "Mezzanine",
  bridge: "Bridge loan", construction_debt: "Construction debt", bond: "Bond", note: "Note", green_bond: "Green bond",
  sustainability_linked: "Sustainability-linked", dfi: "DFI / MDB", eca: "ECA", government: "Government", green_bank: "Green bank",
  guarantee: "Guarantee", concessional: "Concessional", catalytic: "Catalytic / first-loss", blended: "Blended finance",
  grant: "Grant", foundation: "Foundation / PRI / MRI", climate_finance: "Climate finance", nature_finance: "Conservation / biodiversity / watershed finance",
  carbon_finance: "Carbon finance", tax_incentive: "Tax incentive / subsidy", other: "Other",
} as const;

export const CAPITAL_STATUSES = { planned: "Planned", seeking: "Seeking", in_discussion: "In discussion", committed: "Committed", closed: "Closed", cancelled: "Cancelled" } as const;
