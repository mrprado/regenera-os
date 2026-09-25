// Agreement catalog and lifecycle (docs/master-spec.md parts XLIX–LII). Regenera's own contracts are generated
// from templates (templates.ts); every other agreement is registered: its key terms and obligations are recorded,
// the executed document is linked, and the OS never gives legal conclusions about it.

export const CONTRACT_CATEGORIES: Record<string, { label: string; types: Record<string, string> }> = {
  corporate: { label: "Corporate", types: { shareholders: "Shareholders agreement", operating: "Operating agreement", jv: "Joint venture agreement", spv_documents: "SPV documents", board_resolution: "Board resolution", corporate_authority: "Corporate authority" } },
  regenera_commercial: { label: "Regenera commercial", types: { nda: "NDA", mutual_nda: "Mutual NDA", advisory: "Advisory agreement", consulting: "Consulting agreement", development_services: "Development services agreement", origination: "Project origination agreement", capital_advisory: "Capital advisory agreement", partnership: "Strategic partnership agreement", referral: "Referral / introduction agreement", retainer: "Retainer", success_fee: "Success-fee arrangement", mou: "MoU", loi: "LOI", term_sheet: "Term sheet" } },
  land: { label: "Land", types: { purchase: "Purchase agreement", lease: "Lease", option: "Option", easement: "Easement", right_of_way: "Right of way", concession: "Concession", access: "Land access agreement", surface_rights: "Surface rights", community_land: "Community land agreement" } },
  development: { label: "Development", types: { development: "Development agreement", co_development: "Co-development agreement", sponsor: "Sponsor agreement", municipal: "Municipal agreement", government: "Government agreement", ppp: "PPP / concession agreement" } },
  energy_commercial: { label: "Energy and commercial", types: { ppa: "PPA", offtake: "Offtake agreement", tolling: "Tolling agreement", feedstock: "Feedstock agreement", tipping_fee: "Tipping fee agreement", interconnection: "Interconnection agreement", grid_connection: "Grid connection agreement", transmission: "Transmission agreement", fuel_supply: "Fuel supply agreement", product_sale: "Product sale agreement" } },
  engineering: { label: "Engineering", types: { engineering_services: "Engineering services agreement", owners_engineer: "Owner's engineer agreement", feed: "FEED agreement", technical_advisory: "Technical advisory agreement" } },
  procurement: { label: "Procurement and construction", types: { rfi: "RFI", rfq: "RFQ", rfp: "RFP", epc: "EPC contract", epcm: "EPCM", construction: "Construction agreement", supply: "Supply agreement", equipment_purchase: "Equipment purchase agreement", framework: "Framework agreement", bop: "Balance of plant contract", logistics: "Logistics agreement", warranty: "Warranty agreement" } },
  operations: { label: "Operations", types: { om: "O&M agreement", asset_management: "Asset management agreement", service: "Service agreement", maintenance: "Maintenance agreement" } },
  financing: { label: "Financing", types: { loan: "Loan agreement", credit: "Credit agreement", facility: "Facility agreement", intercreditor: "Intercreditor agreement", security: "Security agreement", guarantee: "Guarantee", pledge: "Pledge", mortgage: "Mortgage", account_control: "Account control agreement", hedging: "Hedging agreement", common_terms: "Common terms agreement" } },
  equity: { label: "Equity", types: { subscription: "Subscription agreement", spa: "Share purchase agreement", sha: "Shareholders agreement", investment: "Investment agreement", preferred_equity: "Preferred equity agreement", equity_jv: "JV agreement" } },
  bonds: { label: "Bonds and notes", types: { offering_memorandum: "Offering memorandum", bond_subscription: "Subscription agreement", indenture: "Indenture", trust_deed: "Trust deed", agency: "Agency agreement", paying_agency: "Paying agency agreement", security_documents: "Security documents", bond_guarantee: "Guarantee", bond_terms: "Bond terms", investor_representation: "Investor representation letter" } },
  environmental_community: { label: "Environmental and community", types: { env_commitments: "Environmental commitments", restoration: "Restoration agreement", community_benefit: "Community benefit agreement", stakeholder: "Stakeholder agreement", offset: "Offset / compensation agreement" } },
  insurance: { label: "Insurance", types: { policy: "Policy", certificate: "Certificate", broker: "Broker correspondence", claim: "Claim" } },
};

export const typeLabel = (category: string | null, type: string | null) =>
  (category && type && CONTRACT_CATEGORIES[category]?.types[type]) || type || "Agreement";

/** Categories whose compensation is tied to securities or capital transactions: registering one flags a review. */
export const REVIEW_TYPES = new Set(["capital_advisory", "success_fee", "referral", "placement"]);

export const LIFECYCLE = {
  draft: "Draft", internal_review: "Internal review", counterparty_review: "Counterparty review", legal_review: "Legal review",
  negotiation: "Negotiation", approved: "Approved", signature: "Out for signature", effective: "Effective", active: "Active",
  amended: "Amended", renewal: "Renewal", expired: "Expired", terminated: "Terminated", archived: "Archived",
} as const;
export type Lifecycle = keyof typeof LIFECYCLE;
/** Once a contract reaches these states its executed text and key terms are locked; changes go through amendments. */
export const EXECUTED: Lifecycle[] = ["effective", "active", "amended", "renewal", "expired", "terminated", "archived"];
export const PRE_EXECUTION: Lifecycle[] = ["draft", "internal_review", "counterparty_review", "legal_review", "negotiation", "approved", "signature"];

export const OBLIGATION_CATEGORIES = {
  payment: "Payment", reporting: "Reporting", notice: "Notice", condition_precedent: "Condition precedent", condition_subsequent: "Condition subsequent",
  covenant: "Covenant", deliverable: "Deliverable", milestone: "Milestone", insurance: "Insurance", environmental_social: "Environmental and social",
  permit: "Permit / consent", renewal: "Renewal / option exercise", performance: "Performance test", other: "Other",
} as const;
export const RECURRENCE = { none: "One-off", monthly: "Monthly", quarterly: "Quarterly", semiannual: "Every six months", annual: "Annual" } as const;
export const OBLIGATION_STATUSES = { open: "Open", in_progress: "In progress", done: "Done", waived: "Waived", missed: "Missed" } as const;

export const DOCUMENT_CATEGORIES = {
  corporate: "Corporate", land: "Land", technical: "Technical", engineering: "Engineering", environmental: "Environmental", permitting: "Permitting",
  commercial: "Commercial", financial: "Financial", capital: "Capital", legal: "Legal", tax: "Tax", epc: "EPC", government: "Government",
  study: "Studies", map: "Maps", construction: "Construction", operations: "Operations",
} as const;
export const CONFIDENTIALITY = { internal: "Internal", confidential: "Confidential", restricted: "Restricted" } as const;
export const DOCUMENT_STATUSES = { draft: "Draft", in_review: "In review", approved: "Approved", executed: "Executed", superseded: "Superseded", expired: "Expired" } as const;
