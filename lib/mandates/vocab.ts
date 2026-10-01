// Mandates (docs/plans/phase-14-mandates.md): the commercial "what are we being paid to accomplish" object above
// projects, capital, Atlas, relationships, pursuits and deals. NOT the `mandates` table (workspaces).
// One engine serves every side of the market: MANDATE → UNIVERSE → SIGNALS → MATCH → QUALIFY → APPROVE → ENGAGE →
// PURSUIT → … → LEARN. Readings are categorical with their basis; nothing here is a hidden score.

export const MANDATE_TYPES = {
  epc_origination: { label: "EPC origination", side: "EPC seeking projects", universe: "projects", desk: "epc" },
  capital: { label: "Capital deployment", side: "Capital seeking projects", universe: "projects", desk: "capital" },
  project_capital: { label: "Project capital raise", side: "Project seeking capital", universe: "capital", desk: "capital" },
  development: { label: "Development / site origination", side: "Developer seeking sites", universe: "projects", desk: "energy" },
  land: { label: "Land", side: "Land seeking developer, or developer seeking land", universe: "projects", desk: "land" },
  offtake: { label: "Offtake", side: "Generator seeking buyers", universe: "loads", desk: "energy" },
  funding: { label: "Funding (grants, incentives, concessional)", side: "Project seeking public / blended capital", universe: "funding", desk: "funding" },
  acquisition: { label: "Acquisition", side: "Buyer seeking assets or platforms", universe: "projects", desk: "capital" },
  project_sale: { label: "Project / portfolio sale", side: "Asset seeking acquirer", universe: "organizations", desk: "capital" },
  partnership: { label: "Partnership", side: "Seeking technical / strategic / implementation partners", universe: "organizations", desk: "advisory" },
  nature: { label: "Conservation / nature finance", side: "Nature outcome seeking capital and partners", universe: "organizations", desk: "nature" },
} as const;
export type MandateType = keyof typeof MANDATE_TYPES;

export const DESKS = { capital: "Capital", energy: "Energy", infrastructure: "Infrastructure", epc: "EPC", land: "Land", nature: "Nature", funding: "Funding", intelligence: "Intelligence", platform: "OS / Platform", advisory: "Advisory" } as const;
export type Desk = keyof typeof DESKS;

export const MANDATE_STATUSES = { draft: "Draft", proposed: "Proposed to client", pilot: "Pilot", active: "Active", paused: "Paused", completed: "Completed", lost: "Lost / declined", terminated: "Terminated" } as const;
export const HEALTH = { on_track: "On track", watch: "Watch", at_risk: "At risk", off_track: "Off track", not_started: "Not started" } as const;
export const PRIORITY = { critical: "Critical", high: "High", medium: "Medium", low: "Low" } as const;
export const CONFIDENTIALITY = { public_anonymized: "May publish anonymized", confidential: "Confidential", strictly_confidential: "Strictly confidential (named team only)" } as const;
export const OUTREACH_PERMISSION = { none: "No outreach (research only)", approval_each: "Outreach after client approval per target", approved_list: "Outreach to an approved list", delegated: "Delegated within agreed rules" } as const;
export const CADENCE = { weekly: "Weekly", biweekly: "Every two weeks", monthly: "Monthly" } as const;

/** Builder fields per mandate type (§4). `kind` drives the input; values land in `criteria`. */
export type CriterionField = { key: string; label: string; kind: "number" | "text" | "list" | "select" | "months"; unit?: string; options?: readonly string[]; hint?: string };
const geo: CriterionField[] = [{ key: "countries", label: "Countries", kind: "list" }, { key: "states", label: "States / provinces", kind: "list", hint: "US: two-letter codes" }];
export const BUILDER: Record<MandateType, CriterionField[]> = {
  epc_origination: [
    { key: "technologies", label: "Technologies", kind: "list", hint: "solar, bess, solar_bess" },
    { key: "minSolarMw", label: "Minimum solar capacity", kind: "number", unit: "MWac" }, { key: "minStorageMw", label: "Minimum storage power", kind: "number", unit: "MW" },
    { key: "minStorageMwh", label: "Minimum storage energy", kind: "number", unit: "MWh" },
    { key: "isos", label: "ISO / RTO", kind: "list", hint: "ERCOT, SPP, MISO, CAISO, PJM, WECC" }, ...geo,
    { key: "stages", label: "Development stages", kind: "list", hint: "mid_development, late_development, construction_ready" },
    { key: "procurementHorizonMonths", label: "Procurement horizon", kind: "months", hint: "expected NTP within" },
    { key: "minEpcValue", label: "Minimum expected EPC value", kind: "number", unit: "USD" },
    { key: "counterpartyTypes", label: "Customer types", kind: "list", hint: "ipp, developer, utility, infrastructure_fund" },
    { key: "epcStructure", label: "EPC structure", kind: "list", hint: "full_epc, epc_procurement, bop" },
    { key: "bonding", label: "Bonding / balance-sheet limits", kind: "text" }, { key: "labor", label: "Labor / union / prevailing wage", kind: "text" },
    { key: "domesticContent", label: "Domestic content considerations", kind: "text" }, { key: "knownAccounts", label: "Known / pre-existing accounts (excluded from success fee)", kind: "list" },
  ],
  capital: [
    { key: "capitalType", label: "Capital type", kind: "select", options: ["equity", "debt", "mezzanine", "hybrid"] }, { key: "ticketMin", label: "Ticket minimum", kind: "number", unit: "USD" }, { key: "ticketMax", label: "Ticket maximum", kind: "number", unit: "USD" },
    { key: "targetReturn", label: "Target return", kind: "text" }, { key: "holdYears", label: "Hold period", kind: "number", unit: "years" }, { key: "technologies", label: "Technologies / sectors", kind: "list" }, ...geo,
    { key: "stages", label: "Project stages", kind: "list" }, { key: "developmentRisk", label: "Development risk tolerance", kind: "select", options: ["none", "low", "medium", "high"] },
    { key: "merchantRisk", label: "Merchant risk tolerance", kind: "select", options: ["none", "low", "medium", "high"] }, { key: "currency", label: "Currency", kind: "text" },
    { key: "esg", label: "ESG / nature / community requirements", kind: "text" }, { key: "shariah", label: "Shariah requirements", kind: "select", options: ["no", "yes"] }, { key: "control", label: "Control preference", kind: "select", options: ["control", "minority", "either"] },
  ],
  project_capital: [
    { key: "raiseAmount", label: "Amount to raise", kind: "number", unit: "USD" }, { key: "capitalType", label: "Capital sought", kind: "select", options: ["development", "construction_equity", "senior_debt", "mezzanine", "acquisition", "operating"] },
    { key: "projectStage", label: "Project stage", kind: "text" }, ...geo, { key: "technologies", label: "Technology", kind: "list" }, { key: "investorTypes", label: "Investor types", kind: "list", hint: "family_office, infrastructure_fund, dfi, bank, strategic" },
    { key: "closeBy", label: "Target close", kind: "text" },
  ],
  development: [{ key: "technologies", label: "Technologies", kind: "list" }, ...geo, { key: "isos", label: "ISO / RTO", kind: "list" }, { key: "minAreaHa", label: "Minimum site area", kind: "number", unit: "ha" }, { key: "maxGridKm", label: "Maximum distance to grid", kind: "number", unit: "km" }],
  land: [{ key: "direction", label: "Direction", kind: "select", options: ["find_land", "find_developer"] }, { key: "areaHa", label: "Area", kind: "number", unit: "ha" }, ...geo, { key: "uses", label: "Target uses", kind: "list" }],
  offtake: [{ key: "generationMw", label: "Generation capacity", kind: "number", unit: "MW" }, ...geo, { key: "isos", label: "ISO / RTO", kind: "list" }, { key: "buyerTypes", label: "Buyer types", kind: "list" }, { key: "termYears", label: "Term sought", kind: "number", unit: "years" }],
  funding: [...geo, { key: "fundingKinds", label: "Funding kinds", kind: "list", hint: "grant, tender, concessional, tax_credit" }, { key: "minAward", label: "Minimum award", kind: "number", unit: "USD" }, { key: "keywords", label: "Program keywords", kind: "list" }],
  acquisition: [{ key: "assetTypes", label: "Asset types", kind: "list" }, ...geo, { key: "ticketMin", label: "Ticket minimum", kind: "number", unit: "USD" }, { key: "ticketMax", label: "Ticket maximum", kind: "number", unit: "USD" }, { key: "stages", label: "Stages", kind: "list" }],
  project_sale: [{ key: "askingValue", label: "Indicative value", kind: "number", unit: "USD" }, { key: "buyerTypes", label: "Buyer types", kind: "list" }, ...geo],
  partnership: [{ key: "partnerTypes", label: "Partner types", kind: "list" }, ...geo, { key: "capabilities", label: "Capabilities sought", kind: "list" }],
  nature: [{ key: "instruments", label: "Instruments", kind: "list", hint: "pes, carbon, biodiversity_credit, blended, grant" }, ...geo, { key: "areaHa", label: "Area", kind: "number", unit: "ha" }, { key: "capitalNeed", label: "Capital need", kind: "number", unit: "USD" }],
};

/** §8 Written qualification definitions. Each criterion is met / not met / unknown with a basis; never inferred silently. */
export type QualCriterion = { key: string; label: string; machine: boolean; level: "qualified" | "engagement" | "pursuit" };
export const QUALIFICATION: Record<MandateType, QualCriterion[]> = {
  epc_origination: [
    { key: "technology", label: "Technology matches the mandate", machine: true, level: "qualified" },
    { key: "geography", label: "Geography (state / ISO) matches", machine: true, level: "qualified" },
    { key: "size", label: "Minimum project size met", machine: true, level: "qualified" },
    { key: "stage", label: "Development stage independently supported", machine: true, level: "qualified" },
    { key: "timing", label: "Construction / procurement timing estimated", machine: true, level: "qualified" },
    { key: "epc_open", label: "EPC not definitively awarded", machine: false, level: "qualified" },
    { key: "sponsor", label: "Sponsor / developer identified and credible", machine: false, level: "qualified" },
    { key: "value", label: "Potential contract value is material", machine: true, level: "qualified" },
    { key: "blockers", label: "Material technical blockers reviewed", machine: false, level: "qualified" },
    { key: "evidence", label: "Source evidence recorded", machine: true, level: "qualified" },
    { key: "next_action", label: "Recommended next action exists", machine: true, level: "qualified" },
    { key: "pathway", label: "Decision-maker / procurement pathway identified", machine: false, level: "engagement" },
    { key: "contact", label: "Conversation established with the right person", machine: false, level: "engagement" },
    { key: "confirmed", label: "Customer confirms the project or pipeline is relevant", machine: false, level: "engagement" },
    { key: "client_approved", label: "Client approved the pursuit", machine: false, level: "pursuit" },
    { key: "owner", label: "Internal pursuit owner assigned", machine: false, level: "pursuit" },
  ],
  capital: [
    { key: "technology", label: "Sector / technology matches", machine: true, level: "qualified" }, { key: "geography", label: "Geography matches", machine: true, level: "qualified" },
    { key: "size", label: "Ticket within range", machine: true, level: "qualified" }, { key: "stage", label: "Stage / risk within tolerance", machine: true, level: "qualified" },
    { key: "sponsor", label: "Sponsor identified and credible", machine: false, level: "qualified" }, { key: "evidence", label: "Source evidence recorded", machine: true, level: "qualified" },
    { key: "next_action", label: "Next action exists", machine: true, level: "qualified" }, { key: "materials", label: "Teaser / summary available under NDA", machine: false, level: "engagement" },
    { key: "contact", label: "Sponsor engaged", machine: false, level: "engagement" }, { key: "client_approved", label: "Client approved the pursuit", machine: false, level: "pursuit" },
  ],
  project_capital: [
    { key: "mandate_fit", label: "Investor mandate covers sector, geography and stage", machine: true, level: "qualified" }, { key: "size", label: "Ticket range covers the raise", machine: true, level: "qualified" },
    { key: "evidence", label: "Investor criteria evidenced (public or stated)", machine: true, level: "qualified" }, { key: "compliance", label: "Investor qualification / KYC route clear (owner only)", machine: false, level: "qualified" },
    { key: "next_action", label: "Next action exists", machine: true, level: "qualified" }, { key: "contact", label: "Decision-maker engaged", machine: false, level: "engagement" },
    { key: "client_approved", label: "Sponsor approved the introduction", machine: false, level: "pursuit" },
  ],
  development: [], land: [], offtake: [], funding: [], acquisition: [], project_sale: [], partnership: [], nature: [],
};
const GENERIC: QualCriterion[] = [
  { key: "mandate_fit", label: "Meets the mandate criteria", machine: true, level: "qualified" }, { key: "geography", label: "Geography matches", machine: true, level: "qualified" },
  { key: "evidence", label: "Source evidence recorded", machine: true, level: "qualified" }, { key: "counterparty", label: "Counterparty identified and credible", machine: false, level: "qualified" },
  { key: "next_action", label: "Next action exists", machine: true, level: "qualified" }, { key: "contact", label: "Decision-maker engaged", machine: false, level: "engagement" },
  { key: "client_approved", label: "Client approved the pursuit", machine: false, level: "pursuit" },
];
export const qualificationFor = (t: MandateType) => (QUALIFICATION[t].length ? QUALIFICATION[t] : GENERIC);

/** §9 Stages. Advancement is never arbitrary: each requires the criteria of its level (see stageRequirements). */
export const CANDIDATE_STAGES = {
  discovered: "Discovered", screened: "Screened", matched: "Matched", pre_qualified: "Pre-qualified", qualified: "Qualified", approved: "Approved by client",
  engagement_qualified: "Engagement-qualified", active_pursuit: "Active pursuit", transaction_qualified: "Transaction-qualified",
  watch: "Watching", rejected: "Rejected", excluded: "Excluded",
} as const;
export type CandidateStage = keyof typeof CANDIDATE_STAGES;
export const STAGE_ORDER: CandidateStage[] = ["discovered", "screened", "matched", "pre_qualified", "qualified", "approved", "engagement_qualified", "active_pursuit", "transaction_qualified"];

/** §7 Fit dimensions. Each reading carries its basis; unknown is a reading, not a zero. */
export const FIT_DIMENSIONS = { mandate: "Mandate", technical: "Technical", financial: "Financial", geographic: "Geographic", timing: "Timing", strategic: "Strategic", relationship: "Relationship", compliance: "Compliance", risk: "Risk", esg: "ESG / nature / community" } as const;
export type FitDimension = keyof typeof FIT_DIMENSIONS;
export const READINGS = { strong: "Strong", partial: "Partial", weak: "Weak", fail: "Fails", unknown: "Unknown" } as const;
export type Reading = keyof typeof READINGS;
export type FitReading = { reading: Reading; basis: string };

/** §11 Attribution. Decided when the client responds; the record is the contract's evidence. */
export const ATTRIBUTION = {
  regenera_originated: { label: "Regenera originated", fee: true, note: "Regenera discovered the opportunity and initiated the commercial pathway." },
  regenera_assisted: { label: "Regenera assisted", fee: "per contract", note: "Client knew the opportunity; Regenera materially contributed." },
  client_originated: { label: "Client originated", fee: false, note: "Pre-existing client opportunity: no origination success fee." },
  partner_originated: { label: "Partner originated", fee: "per contract", note: "An external broker, advisor or partner originated it." },
  jointly_originated: { label: "Jointly originated", fee: "per contract", note: "Jointly sourced." },
  unattributed: { label: "Not yet attributed", fee: false, note: "No client response yet." },
} as const;
export type Attribution = keyof typeof ATTRIBUTION;

/** Client response on a proposed opportunity (§5 Sentinel lesson, §11). */
export const CLIENT_RESPONSES = {
  approve: { label: "Approve pursuit", stage: "approved", attribution: "regenera_originated" },
  watch: { label: "Watch", stage: "watch", attribution: null },
  reject: { label: "Reject", stage: "rejected", attribution: null },
  already_known: { label: "Already known", stage: "watch", attribution: "client_originated" },
  conflict: { label: "Conflict", stage: "excluded", attribution: null },
  outside_mandate: { label: "Outside mandate", stage: "excluded", attribution: null },
} as const;
export type ClientResponse = keyof typeof CLIENT_RESPONSES;

/** §10 Approval kinds. A person decides every one; AI never is the approver. */
export const APPROVAL_KINDS = {
  outreach: "Approve outreach", introduction: "Approve introduction", data_sharing: "Approve data sharing", nda: "Approve NDA", bid: "Approve bid",
  investor_access: "Approve investor access", diligence_material: "Approve diligence material", term_sheet: "Approve term sheet", offer: "Approve offer",
  capital_structure: "Approve capital structure", community_engagement: "Approve community engagement", final_submission: "Approve final submission",
  pursuit: "Approve pursuit", mandate: "Approve mandate terms", publication: "Approve anonymized publication",
} as const;
export type ApprovalKind = keyof typeof APPROVAL_KINDS;
export const APPROVAL_STATUSES = { pending: "Pending", approved: "Approved", approved_conditions: "Approved with conditions", rejected: "Rejected", withdrawn: "Withdrawn" } as const;

/** §12 Pursuits: active commercial efforts before (and through) a transaction. */
export const PURSUIT_TYPES = {
  epc: "EPC pursuit", investment: "Investment pursuit", capital_raise: "Capital raise", offtake: "Offtake pursuit", land: "Land pursuit", development: "Development pursuit",
  funding: "Funding pursuit", partnership: "Partnership pursuit", acquisition: "Acquisition pursuit", project_sale: "Project sale", technology: "Technology partnership", government: "Government engagement",
} as const;
export type PursuitType = keyof typeof PURSUIT_TYPES;
export const PURSUIT_TYPE_FOR: Record<MandateType, PursuitType> = { epc_origination: "epc", capital: "investment", project_capital: "capital_raise", development: "development", land: "land", offtake: "offtake", funding: "funding", acquisition: "acquisition", project_sale: "project_sale", partnership: "partnership", nature: "capital_raise" };

/** Workflows per pursuit type (§13 EPC). Base probability per stage is a planning default, always overridable with a reason. */
export const PURSUIT_FLOWS: Record<"epc" | "capital" | "generic", { key: string; label: string; p: number }[]> = {
  epc: [
    { key: "outreach", label: "Outreach", p: 2 }, { key: "discovery", label: "Discovery", p: 5 }, { key: "pursuit", label: "Pursuit", p: 10 }, { key: "rfq", label: "RFQ", p: 15 },
    { key: "rfp", label: "RFP", p: 20 }, { key: "bid", label: "Bid submitted", p: 25 }, { key: "bafo", label: "BAFO", p: 40 }, { key: "negotiation", label: "Negotiation", p: 60 }, { key: "award", label: "Award", p: 100 }, { key: "handoff", label: "Handoff to delivery", p: 100 },
  ],
  capital: [
    { key: "outreach", label: "Outreach", p: 2 }, { key: "intro", label: "Introduction", p: 5 }, { key: "nda", label: "NDA", p: 10 }, { key: "diligence", label: "Diligence", p: 20 }, { key: "ioi", label: "IOI", p: 30 },
    { key: "term_sheet", label: "Term sheet", p: 50 }, { key: "ic", label: "Investment committee", p: 65 }, { key: "docs", label: "Documentation", p: 80 }, { key: "close", label: "Close", p: 100 },
  ],
  generic: [{ key: "outreach", label: "Outreach", p: 3 }, { key: "discovery", label: "Discovery", p: 8 }, { key: "proposal", label: "Proposal", p: 25 }, { key: "negotiation", label: "Negotiation", p: 50 }, { key: "agreement", label: "Agreement", p: 100 }],
};
export const flowFor = (t: PursuitType) => (t === "epc" ? PURSUIT_FLOWS.epc : t === "investment" || t === "capital_raise" || t === "acquisition" || t === "project_sale" ? PURSUIT_FLOWS.capital : PURSUIT_FLOWS.generic);
export const PURSUIT_OUTCOMES = { open: "Open", won: "Won / awarded", lost: "Lost", stalled: "Stalled", withdrawn: "Withdrawn", no_bid: "No-bid" } as const;

/** §15 Bid / no-bid criteria (EPC). Each is rated by a person with a note. */
export const BID_CRITERIA = {
  strategic_fit: "Strategic fit", relationship: "Customer relationship", competition: "Competitive intensity", margin: "Estimated margin", readiness: "Project readiness",
  scope_clarity: "Scope clarity", complexity: "Technical complexity", schedule: "Schedule feasibility", labor: "Labor availability", bonding: "Bonding capacity", insurance: "Insurance",
  risk_allocation: "Risk allocation", ld_exposure: "LD exposure", equipment: "Equipment availability", interconnection: "Interconnection status", permitting: "Permitting",
  payment_terms: "Payment terms", customer_credit: "Customer credit", capacity: "Capacity to execute",
} as const;
export const BID_RATINGS = { favorable: "Favorable", acceptable: "Acceptable", concern: "Concern", blocker: "Blocker", unknown: "Unknown" } as const;
export const BID_DECISIONS = { go: "Go", conditional_go: "Conditional go", hold: "Hold", no_bid: "No-bid" } as const;

/** §36 Outcome economics. Templates, never universal prices; counsel reviews any success fee. */
export const SUCCESS_STRUCTURES = {
  none: "None", fixed_milestone: "Fixed milestone", award_bonus: "Award bonus", success_fee: "Success fee", pct_contract_value: "% of contract value", pct_transaction_value: "% of transaction value",
  pct_capital_raised: "% of capital raised", pct_gross_profit: "% of realized gross profit", equity: "Equity", carried_interest: "Carried interest", revenue_share: "Revenue share",
} as const;
export type SuccessStructure = keyof typeof SUCCESS_STRUCTURES;
export type SuccessEconomics = { structure: SuccessStructure; rate?: number | null; amount?: number | null; cap?: number | null; floor?: number | null; milestones?: { label: string; amount: number }[]; attributionWindowMonths?: number | null; appliesTo?: string; exclusions?: string; paymentEvent?: string; counselReviewed?: boolean };

/** §34 Engagement models: configurable pricing templates (the pasted research; override per mandate). */
export const ENGAGEMENT_MODELS = {
  pilot: { label: "Diagnostic / pilot", billing: "fixed", low: 10000, high: 15000, months: 1.5 },
  intelligence: { label: "Managed intelligence", billing: "monthly", low: 10000, high: 15000, months: 3 },
  origination: { label: "Managed origination", billing: "monthly", low: 15000, high: 25000, months: 3 },
  embedded: { label: "Embedded delivery", billing: "monthly", low: 20000, high: 50000, months: 12 },
  enterprise: { label: "Enterprise OS licence", billing: "annual", low: 100000, high: 500000, months: 12 },
  strategic: { label: "Strategic mandate", billing: "monthly", low: 25000, high: 50000, months: 12 },
} as const;
export type EngagementModel = keyof typeof ENGAGEMENT_MODELS;

/** §35 Pricing variables: each moves the recommended band; the recommendation is shown with its reasons. */
export const BREADTH = { narrow: { label: "Narrow (one market, one technology)", f: 0.7 }, regional: { label: "Regional (2-3 markets)", f: 1 }, national: { label: "National", f: 1.3 }, multi_country: { label: "Multi-country / multi-technology", f: 1.6 } } as const;

/** §24 Delivery floor metrics. Never raw activity alone: each metric says which level it measures. */
export const DELIVERY_METRICS = {
  screened: { label: "Projects / targets screened", level: "activity" }, updated: { label: "Opportunities materially updated", level: "activity" },
  qualified: { label: "Qualified opportunities", level: "output" }, priority: { label: "Priority pursuit recommendations", level: "output" },
  pathways: { label: "Verified account / contact pathways", level: "output" }, approved: { label: "Client-approved pursuits", level: "outcome" },
  meetings: { label: "Meetings generated", level: "outcome" }, rfps: { label: "RFQs / RFPs received", level: "commercial" }, awards: { label: "Awards / closes", level: "commercial" },
} as const;
export type DeliveryMetric = keyof typeof DELIVERY_METRICS;
export type FloorLine = { metric: DeliveryMetric; target: number; period: "month" | "pilot" };

/** §26 Seats. */
export const SEATS = {
  principal: "Managing partner / principal", partner_development: "Partner development", mandate_lead: "Mandate lead", partner_success: "Partner success", origination_analyst: "Origination analyst",
  capital_origination: "Capital origination", project_origination: "Project origination", epc_origination: "EPC origination", offtake_origination: "Offtake origination",
  funding_specialist: "Funding specialist", sector_specialist: "Sector specialist", gis_analyst: "Spatial / GIS analyst", regulatory_analyst: "Permitting / regulatory analyst",
  bid_manager: "Bid / proposal manager", transaction_lead: "Deal / transaction lead", financial_analyst: "Financial analyst", community_lead: "Community / TEK lead",
  legal_compliance: "Legal / compliance", data_engineer: "Data engineer", research_analyst: "Research analyst", diligence_manager: "Document / diligence manager",
} as const;
export type Seat = keyof typeof SEATS;
/** Staffing template per mandate type: seat → hours per month (§28 example). Automation carries the rest. */
export const STAFFING: Partial<Record<MandateType, Partial<Record<Seat, number>>>> = {
  epc_origination: { mandate_lead: 12, origination_analyst: 60, sector_specialist: 15, gis_analyst: 10, bid_manager: 8 },
  capital: { mandate_lead: 12, capital_origination: 40, financial_analyst: 20, legal_compliance: 4 },
  project_capital: { mandate_lead: 15, capital_origination: 40, financial_analyst: 25, diligence_manager: 10, legal_compliance: 6 },
  funding: { mandate_lead: 8, funding_specialist: 40, bid_manager: 20 },
};
export const DEFAULT_SEAT_RATE = 75; // USD per loaded hour when no team member is assigned (internal planning default)

/** §19 Evidence markers: an interpretation is never displayed like a source fact. */
export const EVIDENCE_KINDS = { verified: "Verified fact", source: "Source record", internal: "Internal intelligence", inference: "Model inference", analyst: "Analyst assessment", client: "Client-provided", unknown: "Unknown" } as const;
export type EvidenceKind = keyof typeof EVIDENCE_KINDS;
export type Evidence = { kind: EvidenceKind; text: string; source?: string; url?: string; observedAt?: string; by?: string };

/** §20 Signal types tied to mandates. */
export const SIGNAL_KINDS = {
  queue_new: "New interconnection request", queue_status: "Interconnection status changed", ia_executed: "Interconnection agreement executed", cod_change: "In-service / COD date changed",
  withdrawn: "Withdrawn from queue", permit: "Permit", ppa: "PPA / offtake", financing: "Financing", acquisition: "Acquisition", procurement: "Procurement / RFP", hire: "Executive hire / job posting",
  construction: "Construction start", equipment: "Equipment order", grant: "Grant opening", policy: "Policy / regulatory", other: "Other",
} as const;
export type SignalKind = keyof typeof SIGNAL_KINDS;

/** §42/§38 IP and data classes recorded per mandate deliverable. */
export const DATA_CLASSES = { client: "Client data", regenera: "Regenera data", public: "Public data", licensed: "Licensed data", derived: "Derived intelligence", models: "Regenera models", work_product: "Work product", client_confidential: "Client-confidential" } as const;
