// Power stack vocabulary: PPAs, bankability dimensions, grid interconnection, storage, large loads. Client-safe.

export const PPA_TYPES = {
  utility: "Utility PPA", corporate: "Corporate PPA", physical: "Physical PPA", virtual: "Virtual PPA (VPPA)", sleeved: "Sleeved PPA", cfd: "Contract for difference",
  merchant_hedge: "Merchant hedge", tolling: "Tolling agreement", fit: "Feed-in tariff", capacity: "Capacity agreement", availability: "Availability payment", hybrid: "Hybrid PPA",
} as const;
export const PPA_STATUS = { prospect: "Prospect", term_sheet: "Term sheet", negotiation: "Negotiation", signed: "Signed", conditions_precedent: "Conditions precedent", effective: "Effective", terminated: "Terminated" } as const;
export const PROFILES = { as_produced: "As produced", baseload: "Baseload", shaped: "Shaped", block: "Block", pay_as_nominated: "Pay as nominated", unknown: "Unknown" } as const;
export const ALLOCATION = { seller: "Seller (project)", buyer: "Buyer", shared: "Shared", unknown: "Unknown" } as const;
export const RISKS = {
  curtailment: "Curtailment", imbalance: "Imbalance", basis: "Basis risk", volume: "Volume risk", change_in_law: "Change in law", force_majeure: "Force majeure",
  transmission_losses: "Transmission losses", negative_pricing: "Negative pricing",
} as const;
export const TRISTATE = { yes: "Yes", no: "No", unknown: "Unknown" } as const;
export const PPA_CONDITIONS = ["Permits", "Interconnection agreement", "Financial close", "COD", "Land rights", "Offtaker board approval"] as const;

export const BANKABILITY = { strong: "Strong", acceptable: "Acceptable", conditional: "Conditional", material_issue: "Material issue", unknown: "Unknown" } as const;
export type Bankability = keyof typeof BANKABILITY;

export const STUDY_STAGES = {
  none: "Not applied", applied: "Application filed", feasibility: "Feasibility study", system_impact: "System impact study", facilities: "Facilities study",
  agreement: "Interconnection agreement signed", construction: "Network upgrades under construction", energized: "Energised",
} as const;
export const CHEMISTRIES = { lfp: "LFP", nmc: "NMC", sodium_ion: "Sodium-ion", flow_vanadium: "Vanadium flow", flow_other: "Other flow", zinc: "Zinc-based", thermal: "Thermal storage", pumped_hydro: "Pumped hydro", compressed_air: "Compressed air", hydrogen: "Hydrogen", other: "Other" } as const;
export const STORAGE_SERVICES = {
  arbitrage: "Energy arbitrage", capacity: "Capacity / resource adequacy", ancillary: "Ancillary services (frequency, reserves)", tolling: "Tolling", congestion: "Congestion relief",
  transmission_deferral: "Transmission deferral", renewable_shifting: "Renewable shifting", backup: "Backup / resilience", demand_charge: "Demand-charge reduction", vpp: "Virtual power plant",
} as const;

export const LOAD_TYPES = {
  hyperscaler: "Hyperscaler", colocation: "Colocation provider", ai_compute: "AI compute operator", cloud: "Cloud provider", enterprise_dc: "Enterprise data center",
  sovereign_ai: "Sovereign AI infrastructure", telecom: "Telecom", hpc: "High-performance computing", semiconductor: "Semiconductor fab", manufacturing: "Advanced manufacturing",
  ev_battery: "EV / battery factory", mining: "Mining", refining: "Refining", hydrogen: "Green hydrogen", desalination: "Desalination", industrial_park: "Industrial park", port: "Port",
  utility: "Utility / retailer", municipal: "Municipality / campus", other: "Other",
} as const;
export const DATA_CENTER_TYPES = ["hyperscaler", "colocation", "ai_compute", "cloud", "enterprise_dc", "sovereign_ai", "hpc"] as const;
export const LOAD_STAGES = { prospect: "Prospect / announced", planned: "Planned", site_selection: "Site selection", permitting: "Permitting", under_construction: "Under construction", operating: "Operating", expanding: "Expanding" } as const;
export const PROCUREMENT = { physical_ppa: "Physical PPA", vppa: "Virtual PPA", sleeved: "Sleeved PPA", tolling: "Tolling", onsite: "Onsite generation", utility_tariff: "Utility tariff", green_tariff: "Green tariff", storage: "Storage", capacity: "Capacity" } as const;
export const REDUNDANCY = { n: "N", n1: "N+1", n2: "N+2", "2n": "2N", unknown: "Unknown" } as const;
export const CONFIDENCE = { verified: "Verified", reported: "Reported", estimated: "Estimated", unknown: "Unknown" } as const;
