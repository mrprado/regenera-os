// Regulatory vocabulary (docs/master-spec.md parts XLIV–XLVIII, XX). The OS records requirements, reviews and
// evidence; it never concludes that a project or offering is compliant.

export const JURISDICTION_ROLES = {
  project_site: "Project site", projectco: "ProjectCo / SPV", sponsor: "Sponsor", regenera_entity: "Regenera entity", investor: "Investor",
  lender: "Lender", issuer: "Issuer", epc: "EPC", equipment_origin: "Equipment origin", offtaker: "Offtaker",
} as const;

export const REGULATION_DOMAINS = {
  corporate: "Corporate", foreign_investment: "Foreign investment", land: "Land", planning: "Planning", zoning: "Zoning", building: "Building",
  engineering: "Engineering", energy: "Energy", generation: "Generation", grid: "Grid", transmission: "Transmission", water: "Water", waste: "Waste",
  environmental: "Environmental", labor: "Labor", health_safety: "Health and safety", tax: "Tax", customs: "Customs", imports: "Imports",
  local_content: "Local content", currency: "Currency", data_privacy: "Data and privacy", community: "Community", indigenous_rights: "Indigenous rights",
  cultural_heritage: "Cultural heritage", decommissioning: "Decommissioning",
  // Lender and investor standards (a separate track from permission to build).
  lender_es: "Lender E&S standard", lender_other: "Lender / investor requirement",
} as const;

export const REQUIREMENT_STATUSES = {
  unknown: "Unknown", researching: "Researching", applicable: "Applicable", not_applicable: "Not applicable", counsel_review: "Counsel review",
  required: "Required", submitted: "Submitted", approved: "Approved", expired: "Expired",
} as const;

/** host_law = permission to build and operate; lender_standard = what a lender or investor requires, even if the law does not. */
export const TRACKS = { host_law: "Host-country law", lender_standard: "Lender / investor standard" } as const;

export const SOURCE_TIERS = { 1: "Tier 1 · government, regulator, utility", 2: "Tier 2 · multilateral, scientific", 3: "Tier 3 · professional, technical", 4: "Tier 4 · reputable secondary", 5: "Tier 5 · discovery, social, AI" } as const;

export const PERMIT_STATUSES = {
  not_started: "Not started", preparing: "Preparing", submitted: "Submitted", approved: "Approved", rejected: "Rejected", expired: "Expired", renewal: "Renewal in progress",
} as const;

export const REVIEW_SUBJECTS = { project: "Project", capital_opportunity: "Capital opportunity", contract: "Contract", introduction: "Introduction", outreach: "Outreach" } as const;
export const REVIEW_TOPICS = {
  permitting: "Permitting pathway", land_title: "Land title", environmental: "Environmental", offering_exemption: "Offering exemption", private_placement: "Private placement",
  general_solicitation: "General solicitation", financial_promotion: "Financial promotion", intermediary: "Broker / intermediary activity", investment_advice: "Investment advice",
  compensation: "Compensation", kyc_aml: "KYC / AML", sanctions: "Sanctions", beneficial_ownership: "Beneficial ownership", cross_border: "Cross-border marketing",
  tax: "Tax structuring", other: "Other",
} as const;
export const REVIEW_CONCLUSIONS = { permitted: "Permitted", permitted_with_conditions: "Permitted with conditions", not_permitted: "Not permitted", further_review: "Further review needed" } as const;

export const KYC_CHECKS = {
  entity_verification: "Entity verification", beneficial_ownership: "Beneficial ownership", sanctions: "Sanctions", pep: "PEP", aml: "AML",
  source_of_funds: "Source of funds", nda: "NDA", data_room: "Data room access",
} as const;
export const KYC_STATUSES = { not_started: "Not started", pending: "Pending", clear: "Clear", flagged: "Flagged", failed: "Failed", expired: "Expired" } as const;

/** Checklists a lender or investor may require, seeded as Unknown requirements on the lender track. */
export const STANDARD_CHECKLISTS: Record<string, { label: string; items: string[] }> = {
  ifc_ps: {
    label: "IFC Performance Standards",
    items: [
      "PS1 Assessment and management of environmental and social risks and impacts", "PS2 Labor and working conditions", "PS3 Resource efficiency and pollution prevention",
      "PS4 Community health, safety and security", "PS5 Land acquisition and involuntary resettlement", "PS6 Biodiversity conservation and sustainable management of living natural resources",
      "PS7 Indigenous peoples", "PS8 Cultural heritage",
    ],
  },
  wb_esf: {
    label: "World Bank Environmental and Social Framework",
    items: [
      "ESS1 Assessment and management of environmental and social risks and impacts", "ESS2 Labor and working conditions", "ESS3 Resource efficiency and pollution prevention and management",
      "ESS4 Community health and safety", "ESS5 Land acquisition, restrictions on land use and involuntary resettlement", "ESS6 Biodiversity conservation and sustainable management of living natural resources",
      "ESS7 Indigenous peoples / Sub-Saharan African historically underserved traditional local communities", "ESS8 Cultural heritage", "ESS9 Financial intermediaries", "ESS10 Stakeholder engagement and information disclosure",
    ],
  },
  equator: {
    label: "Equator Principles (EP4)",
    items: [
      "Principle 1 Review and categorisation", "Principle 2 Environmental and social assessment", "Principle 3 Applicable environmental and social standards",
      "Principle 4 Environmental and social management system and action plan", "Principle 5 Stakeholder engagement", "Principle 6 Grievance mechanism",
      "Principle 7 Independent review", "Principle 8 Covenants", "Principle 9 Independent monitoring and reporting", "Principle 10 Reporting and transparency",
    ],
  },
  ifc_ehs: { label: "IFC/WBG EHS Guidelines", items: ["General EHS Guidelines", "Industry sector EHS Guidelines applicable to this project"] },
};
