// Intelligence depth vocabulary: signal types, relevance dimensions, actions, mandate evidence layers, theses and
// watches. Relevance is rated per dimension with reason, evidence and confidence; there is no composite score.

export const SIGNAL_TYPES = {
  fund_close: "Fund close", financing: "Financing", transaction: "Transaction", acquisition: "Acquisition", project_announcement: "Project announcement", permit: "Permit",
  regulation: "Regulation", technology: "Technology", research: "Research", executive_move: "Executive move", mandate_change: "Mandate change", thesis: "Institutional thesis",
  ppa: "PPA", epc: "EPC award", concession: "Concession", government_program: "Government programme", price_movement: "Market price movement", failed_transaction: "Failed transaction",
  restructuring: "Restructuring", bankruptcy: "Bankruptcy", cancellation: "Project cancellation", other: "Other",
} as const;

export const RELEVANCE_DIMENSIONS = {
  capital: "Capital applicability", project: "Project applicability", geography: "Geography relevance", technology: "Technology relevance", relationship: "Relationship relevance",
  partnership: "Partnership potential", service: "Service relevance", revenue: "Revenue potential", strategic: "Strategic importance", research: "Research importance", content: "Content value",
} as const;
export type RelevanceDimension = keyof typeof RELEVANCE_DIMENSIONS;
export const RATINGS = { high: "High", conditional: "Conditional", low: "Low", none: "None", unknown: "Unknown" } as const;
export type Rating = keyof typeof RATINGS;
export const CONFIDENCE = { high: "High", moderate: "Moderate", low: "Low" } as const;

export const SIGNAL_ACTIONS = {
  research: "Research further", contact: "Contact relationship", update_mandate: "Update mandate", update_benchmark: "Update benchmark", update_tech: "Update technology economics",
  field_note: "Create field note", precedent: "Add precedent", question: "Create research question", no_action: "No action",
} as const;
export const ACTION_STATUS = { proposed: "Proposed", doing: "In progress", done: "Done", dropped: "Dropped" } as const;

/** Mandate evidence is layered; inferred mandates are never presented as verified. */
export const EVIDENCE_LAYERS = {
  stated: "Stated thesis (what they say)", public: "Public mandate (fund documents, policy)", observed: "Observed transactions (what they finance)", inferred: "Inferred actual mandate (Regenera's reading)",
} as const;
export type EvidenceLayer = keyof typeof EVIDENCE_LAYERS;
export const MANDATE_FIELDS = {
  sectors: "Sectors", technologies: "Technologies", geographies: "Geographies", stage: "Project stage", ticket: "Ticket size", tenor: "Tenor", return: "Target return / yield", instrument: "Capital type / instrument",
  offtake: "Offtake requirements", sponsor: "Sponsor requirements", impact: "Impact / ESG requirements", exclusions: "Exclusions", coinvest: "Co-investment preference", pace: "Deployment pace / dry powder", other: "Other",
} as const;

export const THESIS_THEMES = {
  energy_demand: "Energy demand", electrification: "Electrification", infrastructure_scarcity: "Infrastructure scarcity", systems_investing: "Systems investing", regeneration: "Regeneration",
  nature_finance: "Nature finance", resilience: "Resilience", private_credit: "Private credit", grid: "Grid modernisation", food: "Food systems", water: "Water", adaptation: "Adaptation",
  digital_infra: "AI / data infrastructure", other: "Other",
} as const;

export const WATCH_KINDS = { institution: "Institution", person: "Person (professional activity only)", source: "Source" } as const;
export const WATCH_EVENTS = {
  new_fund: "New fund", fund_close: "Fund close", mandate: "New mandate", investment: "Investment", acquisition: "Acquisition", financing: "Project financing", partnership: "Partnership",
  expansion: "Geographic expansion", hire: "Executive hire / role change", publication: "Research / publication", filing: "Regulatory filing", thesis: "Stated thesis change",
  conference: "Conference / interview", board: "Board appointment",
} as const;
