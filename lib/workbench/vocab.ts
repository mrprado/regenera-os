// Analyst workbench vocabulary (analyst-production prompt; hardening §14–15, §25, §62–63).
// QUESTION → ISSUE TREE → WORKPLAN → EVIDENCE → ANALYSIS → FINDINGS → SYNTHESIS → REVIEW → DECISION → ACTION.

export const MODES = {
  quick: { label: "Quick work", note: "Notes, small research questions, routine decisions. Minimal workflow; no review required." },
  formal: { label: "Formal analysis", note: "Investment decisions, client deliverables, legal/regulatory or technical conclusions, capital strategy, material project decisions. Evidence, review, versioning and a decision record are required." },
} as const;
export type Mode = keyof typeof MODES;

export const REQUEST_STATUSES = { open: "Open", workplan: "Workplan", evidence: "Evidence", analysis: "Analysis", synthesis: "Synthesis", review: "In review", approved: "Approved", decided: "Decided", closed: "Closed" } as const;
export type RequestStatus = keyof typeof REQUEST_STATUSES;

export const OUTPUT_FORMATS = { memo: "Decision memo", ic_memo: "Investment committee memo", diligence_report: "Diligence report", site_memo: "Site memo", board_memo: "Board memo", client_deliverable: "Client deliverable", note: "Internal note" } as const;
export const PRIORITIES = { critical: "Critical", high: "High", normal: "Normal", low: "Low" } as const;
export const CONFIDENTIALITY = { internal: "Internal", client_confidential: "Client confidential", restricted: "Restricted", shareable: "Shareable" } as const;

export const IC_STATUSES = { none: "Not for IC", draft: "Draft", analyst_review: "Analyst review", senior_review: "Senior review", ic_ready: "IC ready", ic: "At IC", approved: "Approved", declined: "Declined", deferred: "Deferred" } as const;
export type IcStatus = keyof typeof IC_STATUSES;
/** Allowed IC moves. Approved / declined / deferred are recorded only by a named human after IC. */
export const IC_NEXT: Record<IcStatus, IcStatus[]> = {
  none: ["draft"], draft: ["analyst_review"], analyst_review: ["senior_review", "draft"], senior_review: ["ic_ready", "analyst_review"], ic_ready: ["ic", "senior_review"],
  ic: ["approved", "declined", "deferred"], approved: [], declined: [], deferred: ["draft"],
};

export const NODE_KINDS = { question: "Question", hypothesis: "Hypothesis" } as const;
export const NODE_STATUSES = { open: "Open", in_progress: "In progress", answered: "Answered", not_applicable: "Not applicable" } as const;
export const CONCLUSIONS = { supported: "Supported", partially_supported: "Partially supported", rejected: "Rejected", inconclusive: "Inconclusive" } as const;

/** Standard confidence (hardening §12): no percentages without an explicit method. */
export const CONFIDENCE = { verified: "Verified", high: "High", moderate: "Moderate", preliminary: "Preliminary", estimated: "Estimated", unknown: "Unknown" } as const;
export type Confidence = keyof typeof CONFIDENCE;

/** Evidence classes (hardening §62). */
export const EVIDENCE_CLASSES = {
  primary: { label: "Primary", note: "Official or source-origin data." },
  secondary: { label: "Secondary", note: "Credible third-party analysis." },
  client_provided: { label: "Client provided", note: "Internal data from the client or sponsor." },
  modeled: { label: "Modelled", note: "Calculated output of a stated model." },
  inferred: { label: "Inferred", note: "Analyst or AI interpretation." },
} as const;
export type EvidenceClass = keyof typeof EVIDENCE_CLASSES;
export const EVIDENCE_KINDS = { document: "Document", dataset: "Dataset", table: "Table", quote: "Quote", map_view: "Map view", email: "Email", financial_statement: "Financial statement", market_datapoint: "Market datapoint", interview: "Interview note", regulatory_source: "Regulatory source", model_output: "Model output", site_visit: "Site visit" } as const;
export const RELIABILITY = { high: "High", medium: "Medium", low: "Low" } as const;

export const FINDING_KINDS = { finding: "Finding", red_flag: "Red flag", fact: "Fact", inference: "Inference", recommendation: "Recommendation" } as const;
export const SEVERITY = { high: "High", medium: "Medium", low: "Low", info: "Information" } as const;

export const REVIEW_MARKS = { source: "Source?", recalculate: "Recalculate", weak: "Too weak", comparable: "Need comparable", driver: "Explain driver", update_case: "Update to latest case", wording: "Wording", other: "Other" } as const;

/** Issue-tree templates: the branches a competent analyst would open for each kind of question. */
export const TEMPLATES: Record<string, { label: string; branches: { q: string; children: string[] }[] }> = {
  capital_readiness: { label: "Is the project capital-ready?", branches: [
    { q: "Land", children: ["Is site control secured?", "Is title clean?", "Is access secured?"] },
    { q: "Technical", children: ["Is feasibility complete?", "Is the design at the right stage?", "Which studies are outstanding?"] },
    { q: "Grid", children: ["Is interconnection secured or in queue?", "What is the queue position and timing?", "What upgrade cost applies?"] },
    { q: "Commercial", children: ["Is offtake contracted or in negotiation?", "Is pricing bankable?"] },
    { q: "Permitting", children: ["Which approvals are held?", "Which are pending and on what critical path?"] },
    { q: "Financial", children: ["Is CAPEX sourced?", "Do returns meet target investors' hurdles?", "What is the funding gap?"] },
    { q: "Sponsor", children: ["What is the sponsor's track record?", "Can the sponsor fund its equity?"] },
    { q: "Legal", children: ["Is the SPV in place?", "Are key contracts signed?"] },
  ] },
  investment_decision: { label: "Should we invest / proceed?", branches: [
    { q: "Market", children: ["Is there durable demand at the assumed price?", "What do comparables show?"] },
    { q: "Project", children: ["Is the project technically and legally deliverable?", "What are the binding constraints?"] },
    { q: "Economics", children: ["Do returns clear the hurdle in base and downside?", "Which assumptions drive value?"] },
    { q: "Counterparties", children: ["Is the sponsor capable?", "Are offtakers creditworthy?"] },
    { q: "Risk", children: ["Which risks are unmitigated?", "What would change the decision?"] },
    { q: "Community and nature", children: ["Is there consent and benefit sharing?", "Are there material nature impacts?"] },
    { q: "Exit", children: ["Who buys this asset and when?"] },
  ] },
  site_suitability: { label: "Is this site suitable?", branches: [
    { q: "Land", children: ["Who controls it and on what terms?", "What is the land use and zoning?"] },
    { q: "Terrain and water", children: ["Is slope and drainage acceptable?", "Is water available and sustainable?"] },
    { q: "Grid and infrastructure", children: ["How far is usable grid capacity?", "Is road and utility access adequate?"] },
    { q: "Ecology and hazard", children: ["Are there protected or sensitive areas?", "What hazard exposure applies?"] },
    { q: "Permitting and community", children: ["Which authority permits it?", "Who are the affected communities?"] },
    { q: "Market", children: ["Where are the buyers and at what distance?"] },
  ] },
  diligence: { label: "Diligence", branches: ["Commercial", "Financial", "Technical", "Legal", "Tax", "ESG", "Environmental", "Land", "Regulatory", "Community"].map(q => ({ q, children: [] })) },
  custom: { label: "Custom question", branches: [] },
};
