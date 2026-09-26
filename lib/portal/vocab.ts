// External surfaces vocabulary (master build instruction §02, §26, §31–38, §69).

export const PORTAL_KINDS = { sponsor: "Project sponsor", capital: "Capital partner", broker: "Broker / introducer", partner: "Partner (EPC, consultant …)", stakeholder: "Stakeholder" } as const;
export type PortalKind = keyof typeof PORTAL_KINDS;
export const PORTAL_USER_STATUSES = { invited: "Invited", active: "Active", suspended: "Suspended", revoked: "Revoked" } as const;

// What a grant can point at. Visibility is explicit per entity.
export const GRANT_ENTITIES = { project: "Project", capital_opportunity: "Capital opportunity", data_room: "Data room", document: "Document", procurement_package: "Procurement package", deal: "Opportunity / deal" } as const;
export type GrantEntity = keyof typeof GRANT_ENTITIES;

export const DATA_ROOM_FOLDERS = {
  corporate: "Corporate", land: "Land", technical: "Technical", grid: "Grid", permits: "Permits", environmental: "Environmental",
  financial: "Financial", commercial: "Commercial", offtake: "PPA / offtake", epc: "EPC", legal: "Legal", insurance: "Insurance", capital: "Capital",
} as const;

export const REQUEST_STATUSES = { open: "Open", submitted: "Submitted", accepted: "Accepted", rejected: "Needs more", cancelled: "Cancelled" } as const;

// Broker / introducer (§31–33). A role type is a commercial label, not authority to offer securities.
export const BROKER_ROLES = {
  referral_partner: "Referral partner", introducer: "Introducer", consultant: "Consultant", licensed_broker: "Licensed broker-dealer",
  placement_agent: "Placement agent", strategic_partner: "Strategic partner",
} as const;
export const SECURITIES_ROLES = new Set(["licensed_broker", "placement_agent"]);
export const BROKER_STATUSES = { applied: "Applied", under_review: "Under review", approved: "Approved", restricted: "Restricted", suspended: "Suspended", expired: "Expired" } as const;
export const AGREEMENT_STATUSES = { none: "No agreement", sent: "Sent", signed: "Signed", expired: "Expired" } as const;
export const REFERRAL_TARGETS = { company: "Company", person: "Person", investor: "Investor", project: "Project", opportunity: "Opportunity" } as const;
export const REFERRAL_STATUSES = {
  submitted: "Submitted", conflict_review: "Conflict review", approved: "Approved", rejected: "Rejected", already_known: "Already known",
  expired: "Expired", converted: "Converted",
} as const;
export const REFERRAL_DAYS = 365; // an approved registration protects the introduction for this long unless the agreement says otherwise
export const COMMISSION_TYPES = { fixed: "Fixed", percentage: "Percentage", bps: "Basis points", milestone: "Milestone", custom: "Custom" } as const;
export const COMMISSION_STATUSES = { estimated: "Estimated / subject to agreement", approved: "Approved", invoiced: "Invoiced", paid: "Paid", void: "Void" } as const;

export const INTAKE_KINDS = { project: "Project sponsor", capital: "Capital", broker: "Broker / introducer", partner: "Partner" } as const;
export type IntakeKind = keyof typeof INTAKE_KINDS;
export const INTAKE_STATUSES = { new: "New", reviewing: "Reviewing", converted: "Converted", rejected: "Rejected", spam: "Spam" } as const;

export const DEFAULT_NDA = `CONFIDENTIALITY UNDERTAKING (DRAFT — COUNSEL REVIEW REQUIRED)

By entering this data room you agree that the information in it is confidential, is provided by or through Regenera for the sole purpose of evaluating the opportunity described, and will not be disclosed to anyone other than your professional advisers bound by equivalent confidentiality, or used for any other purpose. Nothing in the data room is an offer of securities or investment advice. Access is logged.`;
export const INVITE_FLASH = "portal_invite_flash"; // one-time display of a new invite link to the inviter
