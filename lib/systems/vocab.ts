// Systems vocabulary (master build instruction §20–21).
export const SYSTEM_CATEGORIES = {
  system_capacity: "System capacity", land: "Land", water: "Water", biodiversity: "Biodiversity", soil: "Soil", climate: "Climate",
  resources: "Resources", community: "Community", cultural: "Cultural context", local_economy: "Local economy", resilience: "Resilience",
} as const;
export const CAPACITY_LABELS = { unknown: "Unknown", ample: "Ample", adequate: "Adequate", constrained: "Constrained", exceeded: "Threshold exceeded" } as const;
export const IMPLICATIONS = { durability: "Asset durability", development: "Development risk", operating: "Operating risk", permitting: "Permitting exposure", capital: "Capital implications", cost: "Cost implications" } as const;
export const FRAMEWORKS = { tnfd: "TNFD (LEAP)", ifc_ps: "IFC Performance Standards", issb: "ISSB / sustainability-related financial risk" } as const;
export const INTERVENTION_TYPES = {
  watershed_restoration: "Watershed restoration", habitat_corridor: "Habitat corridor", soil_restoration: "Soil restoration", agrivoltaics: "Agrivoltaics",
  energy_efficiency: "Energy efficiency", waste_treatment: "Waste treatment", circular_materials: "Circular materials", community_infrastructure: "Community infrastructure",
  water_efficiency: "Water efficiency", nature_based: "Nature-based solution", other: "Other",
} as const;
export const INTERVENTION_STATUSES = { proposed: "Proposed", evaluating: "Evaluating", funded: "Funded", implementing: "Implementing", complete: "Complete", dropped: "Dropped" } as const;
