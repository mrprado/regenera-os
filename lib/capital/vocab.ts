// Capital vocabulary (docs/master-spec.md parts XXVII–XLVII). Keys are stable.

export const CAPITAL_TYPES = {
  fund: "Fund / asset manager", family_office: "Family office", private_individual: "Private individual / principal", dfi: "DFI / MDB",
  bank: "Bank / lender", institutional: "Institutional investor", foundation: "Foundation / philanthropy", strategic: "Strategic / corporate",
  government: "Government / agency", green_bank: "Green bank", eca: "Export credit agency", other: "Other",
} as const;

export const RELATIONSHIP_STRENGTH = { unknown: "Unknown", cold: "Cold", warm: "Warm", strong: "Strong" } as const;
export const APPETITE = { unknown: "Unknown", no: "No", maybe: "Possibly", yes: "Yes" } as const;

export const QUALIFICATION_STATUSES = {
  unknown: "Unknown", unassessed: "Unassessed", assessment_required: "Assessment required", self_certified: "Self-certified (where legally valid)",
  third_party_verified: "Third-party verified", professionally_verified: "Professionally verified", expired: "Expired", not_eligible: "Not eligible",
} as const;
/** Statuses that can support regulatory eligibility (subject to jurisdiction, expiry and the offering's own review). */
export const QUALIFYING_STATUSES = ["self_certified", "third_party_verified", "professionally_verified"] as const;

export const INVESTOR_JOURNEY = {
  identified: "Identified", profiled: "Profiled", qualification_required: "Qualification required", qualified: "Qualified",
  relationship_building: "Relationship building", opportunity_matched: "Opportunity matched", compliance_review: "Compliance review",
  approved_for_outreach: "Approved for outreach", presented: "Presented", interested: "Interested", materials_provided: "Materials provided",
  meeting: "Meeting", diligence: "Diligence", ioi: "IOI", soft_circle: "Soft circle", commitment: "Commitment", subscription: "Subscription",
  funded: "Funded", active_investor: "Active investor", reporting: "Reporting", maturity_exit: "Maturity / exit",
} as const;

/** Commitment ledger stages, in order. Only one current row per investor per opportunity: nothing is double counted. */
export const COMMITMENT_STAGES = {
  conversation: "Conversation", interest: "Interest", ioi: "IOI", soft_circle: "Soft circle", commitment: "Commitment",
  subscription: "Executed subscription", funded: "Funded", withdrawn: "Withdrawn",
} as const;
export type CommitmentStage = keyof typeof COMMITMENT_STAGES;

export const GATE_STATES = { review_required: "Review required", hold: "Hold", clear: "Clear", approved: "Approved", not_permitted: "Not permitted" } as const;
export type GateState = keyof typeof GATE_STATES;

export const OUTREACH_TYPES = {
  relationship: "Relationship outreach", project_introduction: "Project introduction", investment_communication: "Investment communication",
  financial_promotion: "Financial promotion", approved_offering: "Approved offering communication",
} as const;
export type OutreachType = keyof typeof OUTREACH_TYPES;
/** These types can only be sent through the compliance gate (never autonomously, never without an approved opportunity). */
export const GATED_OUTREACH: OutreachType[] = ["investment_communication", "financial_promotion", "approved_offering"];

export const MATCH_STATUSES = { suggested: "Suggested", shortlisted: "Shortlisted", approved_for_outreach: "Approved for outreach", dismissed: "Dismissed" } as const;
export const ELIGIBILITY = { eligible: "Eligible (on record)", unknown: "Unknown", not_eligible: "Not eligible", not_assessed: "Not assessed" } as const;
export const INTRO_STATUSES = { requested: "Requested", permission_granted: "Permission granted", made: "Made", declined: "Declined" } as const;
