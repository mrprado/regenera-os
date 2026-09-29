// Capital alignment and nature transition vocabulary. Client-safe.
// Classifications are always made by people with cited evidence; nothing here scores or labels anything by itself.

export const ALIGNMENT = {
  nature_positive: "Nature-positive",
  transition: "Transition",
  neutral: "Neutral",
  potentially_negative: "Potentially nature-negative",
  unclassified: "Unclassified",
} as const;
export type Alignment = keyof typeof ALIGNMENT;
export const ALIGNMENT_COLORS: Record<Alignment, string> = { nature_positive: "#2f7d4f", transition: "#6b9fb8", neutral: "#a5a097", potentially_negative: "#b0432f", unclassified: "#d8d3c8" };

export const SUBJECT_TYPES = { project: "Project", organization: "Company", portfolio: "Portfolio", landholding: "Landholding", municipality: "Municipality", strategy: "Investment strategy", system: "System (watershed / region)" } as const;

/** Ecosystem services an activity can depend on (after ENCORE / TNFD dependency categories). */
export const DEPENDENCIES = {
  water_supply: "Water supply", soils: "Soil quality", pollination: "Pollination", flood_protection: "Flood and storm protection", forest_cover: "Forest cover",
  coastal_protection: "Coastal protection", climate_regulation: "Local climate regulation", erosion_control: "Erosion control", water_purification: "Water purification",
  biomass: "Biomass provisioning", ecosystem_stability: "Ecosystem stability", other: "Other",
} as const;
/** Pressures on nature (after IPBES direct drivers and TNFD impact drivers). */
export const PRESSURES = {
  land_conversion: "Land / sea-use conversion", water_withdrawal: "Water withdrawal", pollution: "Pollution (air, water, soil)", fragmentation: "Habitat fragmentation",
  emissions: "GHG emissions", biodiversity_loss: "Direct biodiversity loss", soil_degradation: "Soil degradation", invasive_species: "Invasive species", extraction: "Resource extraction",
  other: "Other",
} as const;
export const DRIVERS = {
  subsidy: "Subsidy", tax: "Tax treatment", cheap_land: "Cheap land", underpriced_water: "Underpriced water", fossil_subsidy: "Fossil fuel subsidy",
  externality: "Unpriced externality", infrastructure_incentive: "Infrastructure incentive", demand: "Market demand", regulatory_gap: "Regulatory gap", other: "Other",
} as const;
export const PATHWAYS = {
  redesign: "Redesign", relocation: "Relocation", technology: "Technology change", land_use: "Land-use change", subsidy_reform: "Subsidy reform",
  mitigation_hierarchy: "Mitigation hierarchy", restoration: "Restoration", env_markets: "Environmental markets", blended_finance: "Blended finance",
  concession: "Concession restructuring", revenue_model: "Different revenue model", other: "Other",
} as const;
export const MATERIALITY = { low: "Low", medium: "Medium", high: "High", unknown: "Unknown" } as const;
export const NATURE_RISK = { low: "Low", moderate: "Moderate", high: "High", unknown: "Unknown" } as const;

export const INCENTIVE_SECTORS = {
  renewables: "Renewable energy", agriculture: "Agriculture", water: "Water", forestry: "Forestry", infrastructure: "Infrastructure", mining: "Mining",
  oil_gas: "Oil & gas", real_estate: "Real estate", restoration: "Restoration", conservation: "Conservation", climate: "Climate", other: "Other",
} as const;
export const INCENTIVE_CLASS = { nature_positive: "Nature-positive", transitional: "Transitional", neutral: "Neutral", potentially_negative: "Potentially nature-negative", unclassified: "Unclassified" } as const;
export const MECHANISMS = { tax_credit: "Tax credit / deduction", direct_subsidy: "Direct subsidy / grant", price_support: "Price support / tariff", concessional_loan: "Concessional loan / guarantee", exemption: "Exemption / waiver", input_subsidy: "Input subsidy (energy, water, fertiliser)", concession: "Concession / land grant", procurement: "Public procurement", other: "Other" } as const;

export const FLOW_SECTORS = { agriculture: "Agriculture", infrastructure: "Infrastructure", energy: "Energy", real_estate: "Real estate", tourism: "Tourism", mining: "Mining", industry: "Industry", conservation: "Conservation", restoration: "Restoration", water: "Water", other: "Other" } as const;
export const REDIRECTABLE = { yes: "Realistically redirectable", partial: "Partly redirectable", no: "Not redirectable", unknown: "Unknown" } as const;

/** Capital types by alignment role (for mapping capital, not for classifying any specific provider). */
export const CAPITAL_ROLES = {
  positive: ["Conservation finance", "Restoration funds", "Climate funds", "Biodiversity funds", "Catalytic capital", "Philanthropic capital", "DFIs", "Sustainability-linked debt", "Green bonds"],
  transition: ["Transition finance", "Irrigation modernisation", "Wastewater systems", "Mining rehabilitation", "Lower-impact infrastructure", "Industrial efficiency", "Habitat mitigation", "Supply-chain transition", "Brownfield reuse"],
} as const;
