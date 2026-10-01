// Funding origination vocabulary (docs/plans/phase-11-funding-origination.md). Client-safe, pure.
// Funding is a pathway: opportunity → applicant → client → diagnostic → engagement → application → award →
// implementation → wider relationship. No state here is a probability of winning, and no label claims eligibility
// that a source has not confirmed.

/** §16 What kind of money it is. Grants and procurement follow different legal rules. */
export const FUNDING_KINDS = {
  grant: { label: "Grant", procurement: false },
  procurement: { label: "Procurement / contract", procurement: true },
  tender: { label: "Tender", procurement: true },
  rfp: { label: "RFP", procurement: true },
  concessional: { label: "Concessional finance", procurement: false },
  guarantee: { label: "Guarantee", procurement: false },
  tax_credit: { label: "Tax credit / incentive", procurement: false },
  philanthropic: { label: "Foundation / philanthropic", procurement: false },
  development_finance: { label: "Development finance", procurement: false },
  blended: { label: "Blended finance", procurement: false },
  other: { label: "Other", procurement: false },
} as const;
export type FundingKind = keyof typeof FUNDING_KINDS;

/** Maps the scanner's legacy type to the §16 classification until a person classifies it. */
export function kindFromLegacy(type: string, title = ""): FundingKind {
  const t = title.toLowerCase();
  if (type === "tender") return /\brfp\b|request for proposal/.test(t) ? "rfp" : "tender";
  if (type === "concessional") return "concessional";
  if (type === "prize") return "grant";
  if (/tax credit|incentive/.test(t)) return "tax_credit";
  if (/guarantee/.test(t)) return "guarantee";
  return "grant";
}

/** §7, §56 Eligibility is evidence, never a guess presented as fact. */
export const APPLICANT_ELIGIBILITY = {
  confirmed: { label: "Confirmed", note: "Confirmed against the call text or the funder, with a source." },
  likely: { label: "Likely", note: "Signals point to eligibility; not yet checked against the call." },
  uncertain: { label: "Uncertain", note: "Not enough information to say." },
  not_eligible: { label: "Not eligible", note: "The call excludes this applicant." },
} as const;
export type ApplicantEligibility = keyof typeof APPLICANT_ELIGIBILITY;

/** §9 Prospect stages for funding-originated applicants. */
export const PROSPECT_STAGES = {
  target: "Target", researched: "Researched", contact_ready: "Contact ready", contacted: "Contacted", responded: "Responded", discovery: "Discovery",
  qualified: "Qualified", diagnostic_proposed: "Diagnostic proposed", diagnostic_won: "Diagnostic won", engagement: "Engagement", lost: "Lost",
} as const;
export type ProspectStage = keyof typeof PROSPECT_STAGES;
export const PROSPECT_ORDER = Object.keys(PROSPECT_STAGES) as ProspectStage[];

/** §3 Three ways into funding work. */
export const ORIGINATION_MODES = { funding_first: "Funding-first (call → applicant)", client_first: "Client-first (client → programs)", stack_first: "Capital-stack first (project need → sources)" } as const;

/** §11 Funding readiness dimensions (categorical; no percentage). */
export const READINESS_DIMENSIONS = {
  eligibility: "Is the applicant legally eligible?",
  alignment: "Does the project align with program objectives?",
  definition: "Is the project or program defined well enough?",
  capacity: "Can the applicant deliver?",
  evidence: "Can impact and need be demonstrated?",
  consortium: "Are the necessary partners available?",
  match: "Can co-finance or match requirements be met?",
  timing: "Can a credible application be finished before the deadline?",
  compliance: "Are the required registrations and certifications in place?",
  reporting: "Can the applicant meet award reporting?",
} as const;
export type ReadinessDimension = keyof typeof READINESS_DIMENSIONS;
export const READINESS_STATES = {
  ready: "Ready", ready_conditions: "Ready with conditions", incomplete: "Incomplete", blocked: "Blocked", not_eligible: "Not eligible", unknown: "Unknown",
} as const;
export type ReadinessState = keyof typeof READINESS_STATES;

/** §12 */
export const BID_DECISIONS = { bid: "Bid", bid_conditions: "Bid with conditions", watch: "Watch", no_bid: "No bid" } as const;
export type BidDecision = keyof typeof BID_DECISIONS;

/** §18 */
export const CONSORTIUM_ROLES = {
  lead: "Lead applicant", partner: "Partner", technical: "Technical specialist", community: "Community partner", research: "Research partner",
  private: "Private sector", capital: "Capital partner", employer: "Employer partner", utility: "Utility", other: "Other",
} as const;
export const CONSORTIUM_STATUSES = { prospective: "Prospective", contacted: "Contacted", interested: "Interested", confirmed: "Confirmed", declined: "Declined", documents_pending: "Documents pending" } as const;

/** §20 Application workspace tabs. */
export const APPLICATION_TABS = {
  overview: "Overview", eligibility: "Eligibility", scoring: "Scoring criteria", applicant: "Applicant", consortium: "Consortium", workplan: "Workplan",
  narrative: "Narrative", budget: "Budget", evidence: "Evidence", attachments: "Attachments", compliance: "Compliance", reviews: "Reviews", submission: "Submission", activity: "Activity",
} as const;
export type ApplicationTab = keyof typeof APPLICATION_TABS;

/** §24 Review states in order. Submission needs a human approval first. */
export const APPLICATION_STATES = {
  first_draft: "First draft", technical_review: "Technical review", commercial_review: "Commercial review", compliance_review: "Compliance review",
  senior_review: "Senior review", client_review: "Client review", final_qa: "Final QA", approved: "Approved for submission", submitted: "Submitted",
  awarded: "Awarded", unsuccessful: "Unsuccessful", withdrawn: "Withdrawn",
} as const;
export type ApplicationState = keyof typeof APPLICATION_STATES;
export const APPLICATION_ORDER: ApplicationState[] = ["first_draft", "technical_review", "commercial_review", "compliance_review", "senior_review", "client_review", "final_qa", "approved", "submitted"];

/** §21 Default workplan, in order. Each maps to a workspace tab. */
export const WORKPLAN_TEMPLATE: { title: string; tab: ApplicationTab; role: TeamRole; hours: number; offsetDays: number; dependsOn?: number }[] = [
  { title: "Program interpretation", tab: "overview", role: "analyst", hours: 4, offsetDays: 35 },
  { title: "Eligibility confirmation", tab: "eligibility", role: "analyst", hours: 3, offsetDays: 33, dependsOn: 0 },
  { title: "Applicant research", tab: "applicant", role: "analyst", hours: 6, offsetDays: 30, dependsOn: 1 },
  { title: "Project definition", tab: "overview", role: "lead", hours: 4, offsetDays: 28, dependsOn: 2 },
  { title: "Theory of change", tab: "narrative", role: "proposal_manager", hours: 4, offsetDays: 24, dependsOn: 3 },
  { title: "Technical narrative", tab: "narrative", role: "sme", hours: 10, offsetDays: 18, dependsOn: 4 },
  { title: "Impact metrics", tab: "evidence", role: "analyst", hours: 4, offsetDays: 18, dependsOn: 4 },
  { title: "Budget", tab: "budget", role: "financial_modeler", hours: 8, offsetDays: 16, dependsOn: 3 },
  { title: "Partner coordination", tab: "consortium", role: "proposal_manager", hours: 6, offsetDays: 14 },
  { title: "Letters of support / commitment", tab: "attachments", role: "proposal_manager", hours: 4, offsetDays: 10, dependsOn: 8 },
  { title: "Compliance checklist", tab: "compliance", role: "proposal_manager", hours: 3, offsetDays: 7 },
  { title: "Senior review", tab: "reviews", role: "lead", hours: 3, offsetDays: 5, dependsOn: 5 },
  { title: "Final QA", tab: "reviews", role: "proposal_manager", hours: 3, offsetDays: 2, dependsOn: 11 },
  { title: "Submission", tab: "submission", role: "proposal_manager", hours: 2, offsetDays: 1, dependsOn: 12 },
];
export const TASK_STATUSES = { todo: "To do", doing: "In progress", blocked: "Blocked", review: "In review", done: "Done" } as const;

/** §37, §43 Delivery roles. Cost rates are per person, never hard-coded. */
export const TEAM_ROLES = {
  lead: "Founder / engagement lead", funding_lead: "Funding / proposal lead", proposal_manager: "Proposal manager", analyst: "Analyst", senior_analyst: "Senior analyst",
  operations: "Operations / PM", sme: "Sector specialist (SME)", financial_modeler: "Financial modeler", capture_lead: "Capture / senior bid lead", admin: "Admin / software",
} as const;
export type TeamRole = keyof typeof TEAM_ROLES;
export const EMPLOYMENT = { core: "Core", fractional: "Fractional / retainer", contractor: "Contractor", specialist: "Specialist (per engagement)" } as const;

/** §32 Planning ranges only (USD / hour), shown as guidance next to the editable rate. */
export const RATE_GUIDANCE: Partial<Record<TeamRole, [number, number]>> = {
  analyst: [30, 50], senior_analyst: [50, 90], proposal_manager: [70, 125], sme: [100, 250], financial_modeler: [75, 150], capture_lead: [125, 250],
};

/** §44 Work the founder should not own where staff exists. */
export const DELEGABLE = ["attachment chasing", "document formatting", "routine research", "deadline administration", "compliance checklist"] as const;
export const FOUNDER_FOCUS = ["Origination", "Relationships", "Structuring", "Senior judgment", "Client leadership", "Capital", "Expansion"] as const;

/** §37 Flexible specialist bench. */
export const SPECIALIST_BENCH = {
  water: "Water", energy: "Energy", grid: "Grid", agriculture: "Agriculture", forestry: "Forestry", biodiversity: "Biodiversity", carbon: "Carbon",
  infrastructure: "Infrastructure", housing: "Housing", workforce: "Workforce", federal: "Federal funding", state: "State funding", eu: "EU", dfi: "World Bank / DFI",
  modeling: "Financial modeling", mande: "Monitoring & evaluation", writing: "Technical writing", permitting: "Permitting / regulatory", built_environment: "Built environment",
} as const;
/** §39 Where a specialist came from (attribution only; no source is hard-wired into logic). */
export const SPECIALIST_SOURCES = {
  association: "Professional association", proposal_network: "Proposal-management network", grant_network: "Grant-professional network", linkedin: "LinkedIn (manual)",
  marketplace: "Freelancer marketplace", science_platform: "Scientific specialist platform", university: "University research center", consultancy: "Engineering consultancy",
  dfi_alumni: "Development-bank alumni", sector_association: "Sector association", referral: "Referral", other: "Other",
} as const;
export const NDA_STATES = { none: "None", sent: "Sent", signed: "Signed", expired: "Expired" } as const;
export const CONFLICT_STATES = { unchecked: "Not checked", clear: "Clear", potential: "Potential conflict", conflicted: "Conflicted" } as const;

/** §59 */
export const FUNDER_TYPES = {
  federal: "Federal agency", state: "State / provincial", municipal: "Municipality", development_bank: "Development bank", dfi: "DFI", foundation: "Foundation",
  philanthropic: "Philanthropic", climate_fund: "Climate fund", utility: "Utility", multilateral: "EU / multilateral", eca: "Export credit agency", other: "Other",
} as const;

/** §60 */
export const CALENDAR_KINDS = {
  opening: { label: "Opening date", internal: false }, info_session: { label: "Information session", internal: false }, clarification: { label: "Clarification deadline", internal: false },
  consortium_cutoff: { label: "Consortium cutoff", internal: true }, bid_no_bid: { label: "Internal bid / no-bid", internal: true }, draft: { label: "Draft deadline", internal: true },
  review: { label: "Review deadline", internal: true }, deadline: { label: "Submission deadline", internal: false }, award: { label: "Expected award", internal: false }, reporting: { label: "Reporting date", internal: false },
} as const;

/** §17 Registrations an applicant may need. Not every call needs every one. */
export const REGISTRATIONS = {
  sam: "SAM registration", uei: "UEI", tax_status: "Tax status", nonprofit: "Nonprofit status (e.g. 501(c)(3))", state_reg: "State registration", vendor_reg: "Vendor registration",
  portal_reg: "Funding-portal registration", certification: "Certification", audited_accounts: "Audited accounts", insurance: "Insurance", financials: "Financial statements", eu_pic: "EU PIC",
} as const;

/** §6 Organization classes for the ideal applicant profile. */
export const APPLICANT_CLASSES = {
  public_sector: "Public sector", municipality: "Municipality", utility: "Utility", nonprofit: "Nonprofit", university: "University / college", company: "Company", sme: "SME",
  developer: "Developer", consortium: "Consortium", community: "Community organization", research: "Research institution", tribal: "Tribal / Indigenous government",
} as const;

/** §30 Funding revenue lines. */
export const FUNDING_LINES = {
  diagnostic: "Diagnostic", application_strategy: "Application strategy", full_bid: "Full bid", complex_bid: "Complex application", consortium: "Consortium",
  capital_structuring: "Capital structuring", funding_retainer: "Funding retainer", post_award: "Post-award support", os: "OS", other: "Other",
} as const;
export type FundingLine = keyof typeof FUNDING_LINES;

/** §15 Fee bases. Contingent fees always need legal / program review. */
export const FEE_BASES = { fixed: "Fixed fee", milestone: "Milestone fee", retainer: "Retainer", implementation: "Implementation fee", recurring: "Recurring support", contingent: "Contingent / success fee" } as const;
export const CONTINGENT_FLAG = "LEGAL / PROGRAM REVIEW REQUIRED: contingent fees on public funding are restricted or prohibited under many grant, procurement and funder rules.";

/** §29 Expansion needs a Regenera service could meet. */
export const EXPANSION_KINDS = {
  infrastructure_strategy: "Infrastructure strategy", energy: "Solar / BESS / energy", land: "Land strategy", capital_planning: "Capital planning", project_intelligence: "Project intelligence",
  atlas: "ATLAS / spatial", os: "OS subscription", post_award: "Post-award support", built_environment: "Built environment", other: "Other",
} as const;
export const EXPANSION_STATUSES = { identified: "Identified", validated: "Relevance validated", proposed: "Proposed", won: "Won", declined: "Declined", parked: "Parked" } as const;

/** §65 Evidence-style flags instead of award probabilities. */
export const EVIDENCE_FLAGS = {
  strong_evidence: "Strong evidence", missing_evidence: "Missing evidence", high_competition: "High competition", deadline_risk: "Deadline risk",
  eligibility_confirmed: "Eligibility confirmed", partner_gap: "Partner gap", match_gap: "Match gap", registration_gap: "Registration gap",
} as const;

/** §22 Every sentence in an AI draft is one of these. */
export const DRAFT_BASIS = { source_fact: "Source fact", client_fact: "Client-provided fact", draft: "Draft language", missing: "Missing evidence" } as const;

/** §10 Phrases that promise awards. Outreach and drafts containing them are flagged. */
export const PROMISE_PATTERNS: RegExp[] = [
  /\bwe (can|will) (get|secure|win) you\b/i, /\bguarantee[ds]? (the |an |your )?(award|grant|funding)\b/i, /\bfree money\b/i,
  /\b(sure|certain) to (win|be funded)\b/i, /\bwe('ll| will) win\b/i, /\bensure (you|your organization) (receive|get)s? (the |this )?(grant|award)\b/i,
];
export function promiseIssues(text: string): string[] {
  return PROMISE_PATTERNS.filter(p => p.test(text)).map(p => `Promises an award (${p.source.replace(/\\b|\\/g, "")}). Position around pathway, eligibility, readiness and strategy instead.`);
}
