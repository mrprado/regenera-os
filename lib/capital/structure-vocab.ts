// Capital stack and funding pathway vocabulary (master build instruction §10–11). Client-safe.

/** Stack layers in default seniority order (most senior first) with their family. */
export const STACK_LAYERS = {
  senior_debt: { label: "Senior debt", family: "debt", rank: 10 },
  project_finance: { label: "Project finance", family: "debt", rank: 11 },
  construction_debt: { label: "Construction debt", family: "debt", rank: 12 },
  eca_finance: { label: "ECA-backed finance", family: "debt", rank: 13 },
  dfi_capital: { label: "DFI capital", family: "debt", rank: 14 },
  equipment_finance: { label: "Equipment finance", family: "debt", rank: 15 },
  vendor_finance: { label: "Vendor finance", family: "debt", rank: 16 },
  bond: { label: "Bond", family: "debt", rank: 17 },
  green_bond: { label: "Green bond", family: "debt", rank: 18 },
  sukuk: { label: "Sukuk / Shariah-compatible structure", family: "debt", rank: 19 },
  mezzanine: { label: "Mezzanine", family: "mezzanine", rank: 30 },
  blended_finance: { label: "Blended finance", family: "mezzanine", rank: 31 },
  catalytic_capital: { label: "Catalytic capital (first loss)", family: "mezzanine", rank: 32 },
  pri: { label: "Programme-related investment (PRI)", family: "mezzanine", rank: 33 },
  preferred_equity: { label: "Preferred equity", family: "equity", rank: 40 },
  common_equity: { label: "Common equity", family: "equity", rank: 41 },
  development_equity: { label: "Development equity", family: "equity", rank: 42 },
  sponsor_equity: { label: "Sponsor equity", family: "equity", rank: 43 },
  grant: { label: "Grant", family: "grant", rank: 50 },
  guarantee: { label: "Guarantee (credit support, not funding)", family: "support", rank: 60 },
} as const;
export type StackLayer = keyof typeof STACK_LAYERS;
export type StackFamily = (typeof STACK_LAYERS)[StackLayer]["family"];

export const LAYER_STATUSES = { assumption: "Assumption", indicative: "Indicative", in_discussion: "In discussion", term_sheet: "Term sheet", committed: "Committed", closed: "Closed", declined: "Declined" } as const;
/** How well an input is supported: an assumption is never shown as a fact. */
export const ASSUMPTION_STATUSES = { assumption: "Assumption (unsourced)", indicated: "Indicated by counterparty", sourced: "Sourced (document or market data)", confirmed: "Confirmed in writing", verified: "Verified by a reviewer" } as const;
export const STRUCTURE_STATUSES = { draft: "Draft", working: "Working scenario", preferred: "Preferred scenario", superseded: "Superseded" } as const;
export const REVIEW_STATUSES = { not_reviewed: "Not reviewed", in_review: "In legal / compliance review", reviewed: "Reviewed (see record)" } as const;

export const FAMILY_COLORS: Record<StackFamily, string> = { debt: "#476b5e", mezzanine: "#b59a5b", equity: "#173b2a", grant: "#7a8675", support: "#c9a84d" };

// Funding pathways: a route to a specific source of capital for a project, with eligibility and steps.
export const PATHWAY_SOURCES = {
  grant: "Grant programme", dfi: "DFI / MDB", eca: "Export credit agency", green_bank: "Green bank", climate_fund: "Climate fund (GCF, GEF, CIF …)",
  blended: "Blended finance facility", concessional: "Concessional lender", commercial_bank: "Commercial bank", project_finance: "Project finance lenders",
  private_credit: "Private credit", infrastructure_fund: "Infrastructure fund", family_office: "Family office", foundation: "Foundation / PRI",
  strategic: "Strategic investor", green_bond: "Green bond / capital markets", sukuk: "Islamic finance (sukuk)", carbon: "Carbon / environmental markets",
  tax_incentive: "Tax incentive / subsidy", government: "Government programme", other: "Other",
} as const;
export const PATHWAY_STATUSES = { identified: "Identified", screening: "Screening eligibility", eligible: "Eligible (screened)", ineligible: "Not eligible", preparing: "Preparing", submitted: "Submitted", in_diligence: "In diligence", approved: "Approved / awarded", declined: "Declined", withdrawn: "Withdrawn" } as const;
export const ELIGIBILITY_STATES = { unknown: "Not assessed", likely: "Likely (unverified)", confirmed: "Confirmed by the source", not_eligible: "Not eligible" } as const;
export type PathwayStep = { id: string; label: string; due: string | null; done: boolean };
export const ELIGIBILITY_STATUSES_KEYS = Object.keys(ELIGIBILITY_STATES) as [keyof typeof ELIGIBILITY_STATES, ...(keyof typeof ELIGIBILITY_STATES)[]];
