// Steward vocabulary (docs/plans/phase-28-steward-ecosystem.md). Kept free of database imports.

export const GEOMETRY_ACCURACY = {
  surveyed: "Surveyed boundary", digitised: "Digitised from imagery or plans", approximate: "Approximate area", project_point: "Project point only", unknown: "Unknown",
} as const;

export const PLACE_STATUS = { baseline_needed: "Baseline needed", active: "Active care", monitoring: "Monitoring", closed: "Closed" } as const;

export const PLACE_LINK_RELATIONS = {
  project_site: "Project site", within: "Within the place", adjacent: "Adjacent", rights_holder: "Rights holder", customary_users: "Customary users",
  governance: "Governance body", contested: "Contested or overlapping claim", other: "Other",
} as const;

export const CARE_PLAN_STATUS = { draft: "Draft", active: "Active", paused: "Paused", completed: "Completed" } as const;
export const CARE_ACTION_STATUS = { planned: "Planned", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" } as const;

/** Money is kept by stage; stages are never added together and currencies never mixed without a dated conversion. */
export const FUNDING_STAGES = { projected: "Projected", committed: "Committed", funded: "Funded", paid: "Paid" } as const;

export const OUTCOME_DIMENSIONS = { ecological: "Ecological", community: "Community", cultural: "Cultural", operational: "Operational", financial: "Financial" } as const;
export const MEASUREMENT_KIND = { baseline: "Baseline", measurement: "Measurement" } as const;
export const REVIEW_STATUS = { unreviewed: "Unreviewed", reviewed: "Reviewed", disputed: "Disputed" } as const;

/** Assessment dimensions, each with its own status: never combined into one score. */
export const ASSESSMENT_DIMENSIONS = {
  ecological_baseline: "Ecological baseline", water: "Water", soil: "Soil", biodiversity: "Biodiversity", community_authority: "Community authority",
  land_access: "Land and access evidence", cultural_context: "Cultural context", knowledge_permissions: "Knowledge permissions", care_plan: "Care plan",
  budget: "Budget", reciprocity: "Reciprocity", resilience: "Resilience", monitoring: "Monitoring", evidence_quality: "Evidence quality",
} as const;
export type AssessmentDimension = keyof typeof ASSESSMENT_DIMENSIONS;
export const ASSESSMENT_STATUS = {
  not_assessed: "Not assessed", evidence_gathering: "Evidence gathering", needs_review: "Needs review", condition_identified: "Condition identified",
  action_required: "Action required", verified_in_scope: "Verified within stated scope",
} as const;
export type AssessmentStatus = keyof typeof ASSESSMENT_STATUS;

/** What a knowledge record is, kept apart so a reader never mistakes a reflection or an AI synthesis for community knowledge. */
export const KNOWLEDGE_KINDS = {
  community_held: "Community-held knowledge", published_reference: "Published reference", field_observation: "Field observation",
  practitioner_interpretation: "Practitioner interpretation", scientific_research: "Scientific research", personal_reflection: "Personal reflection", ai_synthesis: "AI-generated synthesis",
} as const;
/** Traditions kept distinct; one is never applied to another community or project by default. */
export const KNOWLEDGE_TRADITIONS = {
  indigenous_local: "Indigenous or local knowledge system", ayurveda: "Ayurveda", vastu_shilpa: "Vastu and Shilpa", biodynamic: "Biodynamic practice",
  contemplative: "Contemplative tradition", other_lineage: "Other lineage-specific system", not_applicable: "Not applicable",
} as const;

/** Data states used everywhere a source or assessment is shown. None of them means "low risk" or "none present". */
export const DATA_STATES = {
  not_queried: "Not queried", pending: "Query pending", no_records: "Query completed: no matching records", failed: "Query failed", no_coverage: "No source coverage",
  insufficient: "Insufficient evidence", restricted: "Access restricted", stale: "Stale data", unverified: "Unverified interpretation", available: "Data available",
} as const;
export type DataState = keyof typeof DATA_STATES;
