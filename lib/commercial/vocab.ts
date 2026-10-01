// Commercial operations vocabulary (commercial operations, services, pricing and account ecosystem). Client-safe.

export const SERVICE_FAMILIES = {
  strategy: "Strategy & origination", spatial: "Spatial & site intelligence", development: "Project development", financial: "Financial & underwriting",
  capital: "Capital", funding: "Funding & capital strategy", environmental: "Environmental / natural capital", intelligence: "Intelligence", transaction: "Transaction / execution", portfolio: "Portfolio / ongoing",
} as const;
export const DEPTHS = { screen: "Screen", assess: "Assess", execute: "Execute", standard: "Standard" } as const;
export const BILLING_TYPES = {
  fixed: "Fixed fee", monthly_retainer: "Monthly retainer", project_retainer: "Project retainer", milestone: "Milestone fee", time_materials: "Time & materials", day_rate: "Day rate",
  subscription: "Subscription", development_management: "Development management fee", transaction_support: "Transaction support fee",
  performance: "Performance-linked (only where legally permissible and approved)", equity: "Equity / carry (separately negotiated)", hybrid: "Hybrid",
} as const;
export const LIFECYCLE_PHASES = { p0: "Phase 0 · Diagnostic", p1: "Phase 1 · Screening / intelligence", p2: "Phase 2 · Feasibility / strategy", p3: "Phase 3 · Development mandate", p4: "Phase 4 · Capital / transaction", p5: "Phase 5 · Monitoring / portfolio" } as const;
export const REGENERA_ROLES = { advisory: "Advisory", coordination: "Coordination", analysis: "Analysis", project_management: "Project management", introduction: "Introduction", owners_rep: "Owner's representative" } as const;

export const ENGAGEMENT_STATUSES = {
  prospect: "Lead", qualified: "Qualified", discovery: "Discovery", scoping: "Solution design", proposal: "Proposal", negotiation: "Negotiation", contracting: "Won · contracting", active: "Active engagement",
  waiting_on_client: "Waiting on client", on_hold: "On hold", complete: "Complete", renewal: "Renewal", closed: "Closed", lost: "Lost",
} as const;
/** Internal default probabilities for pipeline weighting (editable per engagement; not a forecast model). */
export const STAGE_PROBABILITY: Record<keyof typeof ENGAGEMENT_STATUSES, number> = { prospect: 5, qualified: 10, discovery: 15, scoping: 25, proposal: 40, negotiation: 60, contracting: 85, active: 100, waiting_on_client: 100, on_hold: 100, complete: 100, renewal: 70, closed: 100, lost: 0 };
export const DELIVERABLE_STATUSES = { not_started: "Not started", in_progress: "In progress", client_input: "Client input required", internal_review: "Internal review", ready: "Ready", delivered: "Delivered", accepted: "Accepted" } as const;
export const INVOICE_STATUSES = { draft: "Draft", scheduled: "Scheduled", sent: "Sent", viewed: "Viewed", due: "Due", overdue: "Overdue", paid: "Paid", partially_paid: "Partially paid", void: "Void" } as const;
export const EXPENSE_CATEGORIES = { travel: "Travel", flights: "Flights", hotel: "Hotel", meals: "Meals", site_visit: "Site visit", data: "Data", imagery: "Imagery", consultants: "Consultants", survey: "Survey", legal: "Legal", printing: "Printing", other: "Other" } as const;
export const EXPENSE_CLASSES = { included: "Included", reimbursable: "Reimbursable", pass_through: "Pass-through" } as const;
export const PARTNER_KINDS = { vendor: "Vendor", partner: "Partner", strategic_partner: "Strategic partner", referral_partner: "Referral partner", joint_delivery: "Joint delivery", subconsultant: "Subconsultant" } as const;
export const VENDOR_CAPABILITIES = ["Engineer", "Environmental consultant", "Law firm", "Tax adviser", "Surveyor", "EPC", "Technical adviser", "GIS provider", "Remote sensing provider", "Carbon specialist", "Hydrologist", "Geotechnical", "Community engagement", "Design", "Data provider"] as const;
export const CHANGE_REASONS = { scope: "Scope expansion", geography: "Additional geography", project: "New project", model: "Additional model", stakeholder: "New stakeholder", urgency: "Urgent timeline", travel: "Additional travel", other: "Other" } as const;
export const CONFLICT_STATES = { unchecked: "Not checked", clear: "Clear", review: "Review", conflict: "Conflict" } as const;

export const ACCOUNT_CATEGORIES = { communication: "Communication", documents: "Documents", signature: "Signature", billing: "Billing", accounting: "Accounting", banking: "Banking", geospatial: "Geospatial", data: "Data", ai: "AI", development: "Development", professional: "Professional services", insurance: "Insurance", other: "Other" } as const;
export const ACCOUNT_STATUSES = { connected: "Connected", disconnected: "Disconnected", error: "Error", expiring: "Expiring", requires_admin: "Requires admin", not_applicable: "No API (relationship only)" } as const;
export const ENTITY_KINDS = { holding: "Holding company", operating: "Operating company", subsidiary: "Subsidiary", country: "Country entity", spv: "Project SPV" } as const;

// Client lifecycle (phase 10): what Regenera is hired to do, how it earns, and how the client arrived.
export const ENGAGEMENT_TYPES = {
  diagnostic: "Systems / project diagnostic", advisory: "Advisory", platform_subscription: "Platform subscription", systems_build: "Systems build", capital_advisory: "Capital advisory",
  site_intelligence: "Site intelligence", land_strategy: "Land strategy", development_advisory: "Development advisory", project_structuring: "Project structuring",
  portfolio_intelligence: "Portfolio intelligence", custom_os: "Custom OS build", technical_coordination: "Technical coordination", ongoing_monitoring: "Ongoing monitoring",
} as const;
/** Revenue categories, reported separately and never mixed with project finance. Recurring ones feed ARR / MRR. */
export const REVENUE_CATEGORIES = {
  diagnostic: { label: "Diagnostic", recurring: false }, advisory: { label: "Advisory (project)", recurring: false }, retainer: { label: "Advisory retainer", recurring: true },
  implementation: { label: "Implementation", recurring: false }, subscription: { label: "Platform subscription", recurring: true }, systems_build: { label: "Systems build", recurring: false },
  capital_advisory: { label: "Capital advisory", recurring: false }, success_fee: { label: "Success fee", recurring: false }, introducer_fee: { label: "Introducer fee", recurring: false },
  monitoring: { label: "Monitoring / MRV", recurring: true }, data: { label: "Data / intelligence", recurring: true }, support: { label: "Support / SLA", recurring: true },
  custom_development: { label: "Custom development", recurring: false }, training: { label: "Training", recurring: false },
} as const;
export type RevenueCategory = keyof typeof REVENUE_CATEGORIES;
export const ENTRY_POINTS = {
  project: "A · A specific project", capital: "B · A capital problem", investment: "C · An investment-screening problem", operating: "D · An operating problem (spreadsheets, Drive, email)",
  development: "E · A development problem (land, grid, water, permits)", portfolio: "F · A portfolio problem", custom_system: "G · A custom-system request",
  funding: "H · A funding call (funding-originated)",
} as const;
export const WORK_MANDATE_STATUSES = { draft: "Draft", active: "Active", paused: "Paused", complete: "Complete", expired: "Expired", cancelled: "Cancelled" } as const;
export const WORKSTREAM_STATUSES = { planned: "Planned", active: "Active", blocked: "Blocked", review: "In review", complete: "Complete" } as const;
export const WORKSTREAM_KINDS = { land: "Land", development: "Development", energy: "Energy", finance: "Finance", capital: "Capital", community: "Community", nature: "Nature", technical: "Technical", systems: "Systems / platform", other: "Other" } as const;

// Product governance (hardening prompt §29, §77–81): every request and debt item is classified before it is built.
export const PRODUCT_ITEM_KINDS = { request: "Client / internal request", idea: "Idea (backlog)", tech_debt: "Technical debt", product_debt: "Product debt", bug: "Bug" } as const;
export const PRODUCT_CLASSES = { core: "Core (universal)", vertical: "Vertical (reusable for a sector)", configuration: "Configuration (client setting)", custom: "Custom (client-specific code)", advisory: "Advisory (human judgement)" } as const;
export const BUILD_CATEGORIES = { bug: "Bug", depth: "Depth", client_requirement: "Validated client requirement", not_ready: "Not yet justified" } as const;
export const PRODUCT_STATUSES = { proposed: "Proposed", under_review: "Under review", accepted: "Accepted", scheduled: "Scheduled", done: "Done", declined: "Declined" } as const;
