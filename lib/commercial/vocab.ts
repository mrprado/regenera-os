// Commercial operations vocabulary (commercial operations, services, pricing and account ecosystem). Client-safe.

export const SERVICE_FAMILIES = {
  strategy: "Strategy & origination", spatial: "Spatial & site intelligence", development: "Project development", financial: "Financial & underwriting",
  capital: "Capital", environmental: "Environmental / natural capital", intelligence: "Intelligence", transaction: "Transaction / execution", portfolio: "Portfolio / ongoing",
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
  prospect: "Prospect", scoping: "Scoping", proposal: "Proposal", negotiation: "Negotiation", contracting: "Contracting", active: "Active",
  waiting_on_client: "Waiting on client", on_hold: "On hold", complete: "Complete", renewal: "Renewal", closed: "Closed", lost: "Lost",
} as const;
/** Internal default probabilities for pipeline weighting (editable per engagement; not a forecast model). */
export const STAGE_PROBABILITY: Record<keyof typeof ENGAGEMENT_STATUSES, number> = { prospect: 10, scoping: 25, proposal: 40, negotiation: 60, contracting: 85, active: 100, waiting_on_client: 100, on_hold: 100, complete: 100, renewal: 70, closed: 100, lost: 0 };
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
