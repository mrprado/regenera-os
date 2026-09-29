// Natural asset operating layer vocabulary: structure, land pipeline, biological production, ecological design,
// certification & MRV, environmental inventory, environmental offtake, permanence risk, risk transfer. Client-safe.
// Generic terms only (no third-party product names).

export const NODE_KINDS = {
  asset: "Natural asset", opco: "Operating company", nursery: "Nursery / production", land_spv: "Land SPV", project_spv: "Project SPV", holdco: "HoldCo",
  investor: "Investor", client: "Client", offtaker: "Offtaker", lender: "Lender", insurer: "Insurer", community: "Community / landholder", manager: "Asset manager", other: "Other",
} as const;
export const LINK_KINDS = { ownership: "Ownership", contract: "Contract", cash_flow: "Cash flow", service: "Service", liability: "Liability / guarantee", land_right: "Land right / lease" } as const;

export const LAND_STAGES = {
  identified: "Candidate", screening: "Screening", diligence: "Diligence", option: "Option", acquisition: "Acquisition", acquired: "Acquired", project: "Project", dropped: "Dropped",
} as const;
export const LAND_FLOW = ["identified", "screening", "diligence", "option", "acquisition", "acquired", "project"] as const;
export const TENURE = { freehold: "Freehold / private title", communal: "Communal / ejido", concession: "Concession", lease: "Lease", customary: "Customary", public: "Public land", unclear: "Unclear" } as const;
export const INTERVENTIONS = {
  productive_forest: "Productive permanent forest", restoration: "Ecological restoration", agroforestry: "Agroforestry", regenerative_ag: "Regenerative agriculture",
  conservation: "Conservation", watershed: "Watershed / riparian", mangrove: "Mangrove / blue carbon", silvopasture: "Silvopasture", other: "Other",
} as const;
export const LAND_DILIGENCE = ["Title search", "Survey / boundary", "Encumbrances", "Zoning / land use", "Environmental baseline", "Water rights", "Community / FPIC", "Access", "Seller KYC", "Valuation"] as const;

export const FUNCTIONAL_GROUPS = { pioneer: "Pioneer", secondary: "Secondary", climax: "Climax", nitrogen_fixer: "Nitrogen fixer", timber: "Timber", fruit_nut: "Fruit / nut", mangrove: "Mangrove", grass_herb: "Grass / herb", shrub: "Shrub", other: "Other" } as const;
export const PLANTING_STATUS = { planned: "Planned", sourced: "Sourced", planted: "Planted", establishing: "Establishing", established: "Established", failed: "Failed" } as const;

export const STANDARDS = {
  vcs: "Verra VCS", ccb: "Verra CCB", sd_vista: "Verra SD VISta", gold_standard: "Gold Standard", plan_vivo: "Plan Vivo", car: "Climate Action Reserve", acr: "ACR",
  puro: "Puro.earth", isometric: "Isometric", biocarbon: "BioCarbon Standard", cercarbono: "Cercarbono", art_trees: "ART TREES", biodiversity: "Biodiversity credit framework", water: "Water benefit standard", other: "Other",
} as const;
export const CERT_STAGES = {
  feasibility: "Feasibility", pd: "Project description", listing: "Listing / pipeline", validation: "Validation", registration: "Registered", monitoring: "Monitoring", verification: "Verification", issuance: "Issuing", closed: "Closed",
} as const;
export const CERT_DOC_TYPES = {
  project_description: "Project description (PD)", pipeline_review: "Registry pipeline / completeness review", listing_rep: "Listing representation", accession_rep: "Accession representation",
  validation_report: "Validation report", validation_statement: "Validation statement", registration_rep: "Registration representation", monitoring_report: "Monitoring report",
  verification_report: "Verification report", verification_statement: "Verification statement", issuance_rep: "Issuance representation", partial_release_rep: "Partial release representation",
  non_permanence: "Non-permanence risk report", boundary: "Project boundary (KML / GeoJSON)", other: "Other",
} as const;
/** Documents a registered AFOLU project is expected to hold, by stage. The data room checklist reads from this. */
export const CERT_DOC_EXPECTED: Record<string, (keyof typeof CERT_DOC_TYPES)[]> = {
  pd: ["project_description", "boundary"],
  listing: ["project_description", "boundary", "listing_rep", "pipeline_review"],
  validation: ["project_description", "boundary", "listing_rep", "non_permanence"],
  registration: ["project_description", "boundary", "validation_report", "validation_statement", "registration_rep", "non_permanence"],
  verification: ["monitoring_report", "verification_report", "verification_statement", "non_permanence"],
  issuance: ["monitoring_report", "verification_report", "verification_statement", "issuance_rep", "non_permanence"],
};
export const PERIOD_STATUS = { open: "Open", monitoring_report: "Monitoring report", verification: "Under verification", verified: "Verified", issued: "Issued" } as const;

/** Environmental inventory ledger: every unit moves forward along this chain (retired is terminal). */
export const LOT_STATUS = { forecast: "Forecast", validated: "Validated", verified: "Verified", issued: "Issued", available: "Available", contracted: "Contracted", delivered: "Delivered", retired: "Retired", buffer: "Buffer pool", cancelled: "Cancelled" } as const;
export const LOT_FLOW = ["forecast", "validated", "verified", "issued", "available", "contracted", "delivered", "retired"] as const;
export const UNIT_TYPES = { carbon: "Carbon (tCO2e)", biodiversity: "Biodiversity unit", water: "Water benefit (m³)", rec: "Renewable energy certificate", other: "Other attribute" } as const;

export const OFFTAKE_KINDS = {
  carbon_forward: "Carbon forward sale", carbon_spot: "Carbon spot sale", biodiversity: "Biodiversity offtake", watershed_payment: "Watershed / PES payment",
  conservation_agreement: "Conservation agreement", rec: "REC / attribute offtake", other: "Other environmental attribute",
} as const;
export const OFFTAKE_STATUS = { prospect: "Prospect", term_sheet: "Term sheet", negotiation: "Negotiation", signed: "Signed", delivering: "Delivering", completed: "Completed", terminated: "Terminated" } as const;

/** Permanence / reversal risk categories (after the VCS AFOLU Non-Permanence Risk Tool structure). */
export const PERMANENCE_FACTORS = {
  internal: { project_management: "Project management", financial_viability: "Financial viability", opportunity_cost: "Opportunity cost", longevity: "Project longevity / continuity" },
  external: { tenure: "Land tenure and resource access", community: "Community engagement", political: "Political risk", encroachment: "Encroachment" },
  natural: { fire: "Fire", disease: "Pests and disease", drought: "Drought", extreme_weather: "Extreme weather", geological: "Geological" },
} as const;

export const RISK_TRANSFER = {
  construction: "Construction insurance", political_risk: "Political-risk insurance", offtaker_credit: "Offtaker credit insurance", carbon_delivery: "Carbon delivery insurance",
  performance_guarantee: "Performance guarantee", eca_guarantee: "ECA guarantee", partial_credit: "Partial credit guarantee", parametric: "Parametric climate insurance",
  natcat: "Natural catastrophe cover", forest: "Standing forest / biological asset insurance", other: "Other",
} as const;
export const RISK_TRANSFER_STATUS = { identified: "Identified", quoted: "Quoted", bound: "Bound", expired: "Expired", declined: "Declined" } as const;

/** Four horizons a natural asset is managed across (years). */
export const HORIZONS = { development: "Development", financing: "Financing", operating: "Operating", stewardship: "Ecological stewardship" } as const;
export const HORIZON_DEFAULTS = { development: [3, 7], financing: [10, 30], operating: [20, 50], stewardship: [50, 100] } as const;
