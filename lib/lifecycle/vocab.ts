// Commercial lifecycle vocabulary (phase 29, docs/plans/phase-29-commercial-lifecycle.md). Relationship roles are labels
// that can overlap; pipelines are separate and each keeps its own stage history. Client and former client are derived
// from engagements, never set by hand.

export const RELATIONSHIP_ROLES = {
  acquaintance: "Acquaintance", prospect: "Prospect", sponsor: "Sponsor", developer: "Developer", capital_partner: "Capital partner",
  technical_partner: "Technical partner", referral_partner: "Referral partner", advisor: "Advisor", client: "Client", former_client: "Former client",
} as const;
export type RelationshipRole = keyof typeof RELATIONSHIP_ROLES;
/** Set only from engagements (lib/lifecycle/relationships.ts deriveClientRoles). */
export const DERIVED_ROLES: RelationshipRole[] = ["client", "former_client"];

export const RELATIONSHIP_STAGES = {
  identified: "Identified", connected: "Connected", engaged: "Engaged", qualified: "Qualified", active: "Active relationship",
  nurture: "Nurture", dormant: "Dormant", closed: "Closed",
} as const;

/** Regenera's paid-work pipeline (deals.commercial_stage). Signed only through an accepted proposal version. */
export const COMMERCIAL_STAGES = {
  need_identified: "Need identified", discovery: "Discovery", scope_agreed: "Scope agreed", proposal: "Proposal", negotiation: "Negotiation", signed: "Signed",
  lost: "Lost", deferred: "Deferred", withdrawn: "Withdrawn",
} as const;
export type CommercialStage = keyof typeof COMMERCIAL_STAGES;
export const COMMERCIAL_FORWARD: CommercialStage[] = ["need_identified", "discovery", "scope_agreed", "proposal", "negotiation", "signed"];
export const COMMERCIAL_CLOSED: CommercialStage[] = ["lost", "deferred", "withdrawn"];
/** What each stage needs before a record may enter it. */
export const COMMERCIAL_ENTRY: Record<CommercialStage, string> = {
  need_identified: "A stated need or problem.",
  discovery: "A conversation or meeting with the buyer is recorded.",
  scope_agreed: "The qualification decision is Qualified.",
  proposal: "A proposal version has been sent.",
  negotiation: "A sent proposal is under discussion.",
  signed: "A proposal version is accepted and the agreement is recorded (only through Record agreement).",
  lost: "A reason.", deferred: "A reason.", withdrawn: "A reason.",
};

/** The old deal stages, read as commercial stages until a record moves under the new pipeline. */
export const FROM_DEAL_STAGE: Record<string, CommercialStage> = {
  lead: "need_identified", contacted: "need_identified", engaged: "discovery", call_booked: "discovery", proposal: "proposal",
  signed: "signed", active: "signed", expansion: "signed", completed: "signed", churned: "signed", lost: "lost", nurture: "deferred",
};
/** Kept in sync so the existing board and reports keep working. */
export const TO_DEAL_STAGE: Record<CommercialStage, string> = {
  need_identified: "lead", discovery: "engaged", scope_agreed: "engaged", proposal: "proposal", negotiation: "proposal", signed: "signed",
  lost: "lost", deferred: "nurture", withdrawn: "lost",
};

export const PIPELINES = { relationship: "Relationship", commercial: "Commercial", project: "Project", capital: "Capital discussion", partnership: "Partnership" } as const;

export const SERVICE_OFFER_STATUS = { draft: "Draft (not offered)", approved: "Approved offer", retired: "Retired" } as const;
export const FEE_STRUCTURES = { fixed: "Fixed fee", retainer: "Retainer", milestone: "Milestone", hourly: "Hourly" } as const;
export type FeeStructure = keyof typeof FEE_STRUCTURES;

export const PROPOSAL_STATUS = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn" } as const;
export const PROPOSAL_VERSION_STATUS = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", superseded: "Superseded" } as const;

export const MILESTONE_STATUS = { planned: "Planned", in_progress: "In progress", blocked: "Blocked", done: "Done" } as const;
export const DELIVERABLE_STATUS = {
  not_started: "Not started", in_progress: "In progress", blocked: "Blocked", internal_done: "Done internally", in_client_review: "With client for review",
  revision_requested: "Revision requested", accepted: "Accepted by client",
} as const;
export type DeliverableStatus = keyof typeof DELIVERABLE_STATUS;
export const CLIENT_REQUEST_STATUS = { open: "Open", submitted: "Submitted", accepted: "Accepted", rejected: "Needs resubmission", cancelled: "Cancelled" } as const;
export const CHANGE_REQUEST_STATUS = { proposed: "Proposed", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" } as const;
export const TEMPLATE_STATUS = { draft: "Draft", approved: "Approved", retired: "Retired" } as const;

export const PAYMENT_KINDS = { payment: "Payment", refund: "Refund", credit: "Credit note" } as const;
export const PAYMENT_METHODS = { bank_transfer: "Bank transfer", card: "Card", cheque: "Cheque", cash: "Cash", other: "Other" } as const;
