// Built Environment intelligence vocabulary (docs/plans/phase-12-built-environment.md). Client-safe.
// Built environment is one node in Regenera's graph (land, projects, companies, technologies, materials, energy,
// water, capital, communities, regulation…), not a construction-tech directory. No claim here is a fact about a real
// company: records carry their origin (DEMO, LIVE, USER ENTERED, IMPORTED, API, RESEARCH).

export const BE_TABS = {
  overview: "Overview", map: "Market map", companies: "Companies", technologies: "Technologies", materials: "Materials", systems: "Construction systems",
  energy: "Building energy", water: "Water & circular", fit: "Project fit", partnerships: "Partnerships", capital: "Capital", signals: "Signals", regions: "Regions", procurement: "Procurement",
} as const;
export type BeTab = keyof typeof BE_TABS;

/** §2 Taxonomy (A–I). Keys are stable; labels are what people read. */
export const TAXONOMY = {
  architecture: { label: "Architecture & planning", items: ["architecture", "master planning", "urban design", "bioclimatic design", "passive design", "climate-responsive design", "adaptive reuse", "landscape architecture", "district planning", "mixed-use development", "hospitality", "residential", "workforce housing", "affordable housing", "commercial", "industrial", "data centers", "institutional", "infrastructure-linked development"] },
  construction: { label: "Construction systems", items: ["conventional construction", "modular", "prefab", "panelized", "volumetric construction", "3D printing", "robotic construction", "off-site manufacturing", "mass timber", "light-gauge steel", "precast systems", "hybrid systems", "assembly systems"] },
  materials: { label: "Materials", items: ["low-carbon concrete", "geopolymer cement", "carbon-negative concrete", "recycled aggregate", "timber", "mass timber", "bamboo", "hempcrete", "rammed earth", "adobe", "compressed earth blocks", "lime", "natural stone", "biochar materials", "mycelium materials", "agricultural-waste materials", "recycled plastics", "recycled metals", "circular materials", "insulation", "roofing", "facade systems", "glazing", "coatings"] },
  contech: { label: "Construction technology", items: ["BIM", "digital twins", "construction management software", "scheduling", "cost control", "site intelligence", "computer vision", "robotics", "drones", "sensors", "QA/QC", "safety technology", "workforce systems", "procurement platforms", "supply-chain technology", "progress tracking", "project controls", "reality capture", "geospatial construction tools"] },
  energy: { label: "Building energy", items: ["solar PV", "BESS", "microgrids", "heat pumps", "HVAC", "geothermal", "thermal storage", "building management systems", "energy management systems", "smart meters", "demand response", "energy efficiency", "passive cooling", "lighting systems", "EV infrastructure", "distributed generation"] },
  water: { label: "Water", items: ["water efficiency", "rainwater harvesting", "greywater", "wastewater treatment", "decentralized wastewater", "constructed wetlands", "stormwater", "desalination", "water recycling", "smart water systems", "leak detection", "irrigation", "watershed-sensitive design"] },
  circularity: { label: "Circularity", items: ["construction waste", "material reuse", "deconstruction", "demolition recovery", "recycling", "circular procurement", "waste-to-resource", "bio-based materials", "industrial symbiosis"] },
  property: { label: "Housing / property / proptech", items: ["housing finance", "mortgages", "affordability", "fractional ownership", "rent-to-own", "property management", "leasing", "homebuilding technology", "developer platforms", "digital sales", "property data", "real-estate operating systems"] },
  resilience: { label: "Resilience", items: ["wildfire", "flood", "hurricane", "heat", "drought", "seismic", "coastal exposure", "extreme weather", "climate adaptation", "insurance", "resilience retrofits"] },
} as const;
export type TaxonomyKey = keyof typeof TAXONOMY;

export const RECORD_ORIGINS = { demo: "DEMO", live: "LIVE", user_entered: "USER ENTERED", imported: "IMPORTED", api: "API", research: "RESEARCH" } as const;
export type RecordOrigin = keyof typeof RECORD_ORIGINS;

/** §7 axes. */
export const COMPANY_STAGES = { bootstrapped: "Bootstrapped", pre_seed: "Pre-seed", seed: "Seed", series_a: "Series A", series_b: "Series B", growth: "Growth", private_equity: "Private equity", public: "Public", strategic: "Strategic" } as const;
export const MATURITY = { rnd: "R&D", pilot: "Pilot", early_commercial: "Early commercial", proven: "Proven", scaled: "Scaled" } as const;
export const REGIONS = { north_america: "North America", latin_america: "Latin America", europe: "Europe", middle_east: "Middle East", africa: "Africa", india: "India", southeast_asia: "Southeast Asia", oceania: "Oceania" } as const;
export const PROJECT_TYPES = { residential: "Residential", hospitality: "Hospitality", commercial: "Commercial", industrial: "Industrial", mixed_use: "Mixed use", infrastructure: "Infrastructure", affordable_housing: "Affordable housing", master_planned: "Master-planned community", data_center: "Data center" } as const;
export type ProjectType = keyof typeof PROJECT_TYPES;

/** Climate and hazard suitability keys used by materials, technologies and the fit engine. */
export const CLIMATES = { tropical_humid: "Tropical humid", tropical_dry: "Tropical dry / savanna", arid: "Hot arid", temperate: "Temperate", cold: "Cold", coastal: "Coastal", highland: "Highland" } as const;
export type Climate = keyof typeof CLIMATES;
export const HAZARDS = { hurricane: "Hurricane", seismic: "Seismic", wildfire: "Wildfire", flood: "Flood", heat: "Extreme heat", drought: "Drought" } as const;
export type Hazard = keyof typeof HAZARDS;

/** §5 material filters. */
export const MATERIAL_TAGS = { low_carbon: "Low embodied carbon", natural: "Natural", local: "Locally sourced", circular: "Circular", biobased: "Bio-based", structural: "Structural", envelope: "Envelope", insulation: "Insulation", interior: "Interior", exterior: "Exterior" } as const;

/** Categorical effects (never a fake precise number). */
export const EFFECT = { much_lower: "Much lower", lower: "Lower", neutral: "Neutral", higher: "Higher", much_higher: "Much higher", unknown: "Unknown" } as const;
export type Effect = keyof typeof EFFECT;
export const COMPLEXITY = { low: "Low", moderate: "Moderate", high: "High", unknown: "Unknown" } as const;

/** §23 sustainability claim states. */
export const CLAIM_STATES = { company_reported: "Company reported", third_party_verified: "Third-party verified", certified: "Certified", estimated: "Estimated", unverified: "Unverified" } as const;
/** Words that need a supporting claim before they may describe a record. */
export const GUARDED_WORDS = /\b(carbon[- ]negative|sustainable|regenerative|zero[- ]carbon|net[- ]zero|carbon[- ]neutral)\b/i;

/** §3 signal types. */
export const SIGNAL_TYPES = {
  funding_round: { label: "Funding round", group: "company" }, acquisition: { label: "Acquisition", group: "company" }, new_factory: { label: "New factory", group: "company" }, production_capacity: { label: "Production capacity", group: "company" },
  executive_appointment: { label: "Executive appointment", group: "company" }, layoffs: { label: "Layoffs", group: "company" }, partnership: { label: "Partnership", group: "company" }, product_launch: { label: "Product launch", group: "company" },
  geographic_expansion: { label: "Geographic expansion", group: "company" }, new_development: { label: "New development", group: "project" }, planning_approval: { label: "Planning approval", group: "project" },
  building_permit: { label: "Building permit", group: "project" }, construction_start: { label: "Construction start", group: "project" }, tender: { label: "Major tender", group: "project" }, housing_program: { label: "Housing program", group: "project" },
  new_fund: { label: "New fund", group: "capital" }, green_finance: { label: "Green-building finance", group: "capital" }, concessional: { label: "Concessional capital", group: "capital" },
  building_code: { label: "Building code", group: "policy" }, embodied_carbon_rule: { label: "Embodied-carbon regulation", group: "policy" }, energy_code: { label: "Energy code", group: "policy" }, incentive: { label: "Incentive / tax credit", group: "policy" },
  certification: { label: "Certification", group: "technology" }, deployment: { label: "Commercial deployment", group: "technology" }, pilot: { label: "Pilot announcement", group: "technology" }, milestone: { label: "Technical milestone", group: "technology" },
} as const;
export type SignalType = keyof typeof SIGNAL_TYPES;
export const IMPORTANCE = { high: "High", medium: "Medium", low: "Low" } as const;

/** §10 commercial engagement types and compliance status for fee models. */
export const ENGAGEMENT_KINDS = {
  developer_advisory: "Developer advisory", technology_advisory: "Technology advisory", project_development: "Project development", project_origination: "Project origination", capital_advisory: "Capital advisory",
  strategic_partnership: "Strategic partnership", procurement_advisory: "Procurement advisory", market_entry: "Market-entry advisory", introductions: "Commercial introductions", site_sourcing: "Site sourcing",
  pilot_site: "Pilot site sourcing", development_partnership: "Development partnership", investor_introductions: "Investor introductions", debt_placement: "Debt placement support", project_finance: "Project finance support",
  incentive_strategy: "Grant / incentive strategy", offtake_strategy: "Offtake strategy", sustainability_advisory: "Sustainability advisory", technical_diligence: "Technical diligence coordination",
} as const;
export const FEE_MODELS = { retainer: "Monthly retainer", fixed: "Fixed project fee", success: "Success fee (where legally permissible)", mandate: "Advisory mandate" } as const;
export const FEE_COMPLIANCE = { unknown: "Unknown", review_required: "Review required", permitted: "Permitted", restricted: "Restricted", prohibited: "Prohibited" } as const;
export const OPPORTUNITY_STATUSES = { identified: "Identified", qualified: "Qualified", outreach: "Outreach", meeting: "Meeting", nda: "NDA", technical_review: "Technical review", pilot: "Project pilot", agreement: "Commercial agreement", closed_lost: "Closed · lost" } as const;
export const REL_STATUSES = { none: "No relationship", aware: "Aware", contacted: "Contacted", engaged: "Engaged", partner: "Partner", client: "Client" } as const;

/** §6 governed knowledge. */
export const KNOWLEDGE_ACCESS = { public: "Public", internal: "Internal", restricted: "Restricted", community_governed: "Community-governed", consent_pending: "Consent pending", non_commercial: "Non-commercial", confidential: "Confidential" } as const;
export const VERNACULAR_KINDS = ["adobe", "cob", "rammed earth", "lime construction", "stone construction", "vernacular timber", "bamboo", "shaded courtyards", "passive ventilation", "thermal mass", "traditional roofing", "rainwater systems", "settlement morphology", "landscape orientation", "seasonal building logic"] as const;

/** §8 recommendation categories in the solution stack. */
export const STACK_CATEGORIES = { design: "Design", construction: "Construction", materials: "Materials", energy: "Energy", water: "Water", digital: "Digital", resilience: "Resilience" } as const;
export type StackCategory = keyof typeof STACK_CATEGORIES;
export const MATCH_CONFIDENCE = { high: "High", moderate: "Moderate", low: "Low" } as const;

/** §15 graph edges for the built-environment relationship graph (stored as relationship_edges where possible). */
export const BE_EDGES = ["INVESTED_IN", "SUPPLIES", "USES", "DEVELOPS", "OWNS", "OPERATES", "FINANCES", "OFFTAKES", "ADVISES", "INTRODUCED_BY", "PARTNERED_WITH", "DEPLOYED_AT", "REGULATED_BY", "LOCATED_IN", "SERVES", "REQUESTED_BY", "MATCHED_TO"] as const;
