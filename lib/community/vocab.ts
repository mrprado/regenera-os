// Community rights, knowledge governance and community economic participation vocabulary. Client-safe.
// Principles: rights before benefits; compensation is not benefit sharing; consultation is not consent; knowledge
// access is governed, not assumed; the person who shares knowledge may not be the authority that authorises its use.

export const COMMUNITY_TYPES = {
  indigenous: "Indigenous People / Nation", ejido: "Ejido / agrarian community", comunidad_agraria: "Comunidad agraria", local: "Local community",
  cooperative: "Land cooperative", resource_users: "Resource-user group", farmers: "Farmers' association", municipality: "Municipality", other: "Other",
} as const;
export const RIGHT_STATUS = { verified: "Verified", asserted: "Asserted", disputed: "Disputed", unknown: "Unknown", not_applicable: "Not applicable" } as const;

export const RIGHT_TYPES = {
  customary_land: "Customary land", statutory_land: "Statutory land", resource_access: "Resource access", grazing: "Grazing", water: "Water", fishing: "Fishing", hunting: "Hunting",
  gathering: "Gathering", forest_use: "Forest use", cultural_landscape: "Cultural landscape", sacred_site: "Sacred site", burial_site: "Burial site", mobility_corridor: "Mobility corridor",
  livelihood: "Livelihood", stewardship: "Ecosystem stewardship", ip: "Intellectual property", traditional_knowledge: "Traditional knowledge", genetic_resources: "Genetic resources",
  cultural_heritage: "Cultural heritage", access_easement: "Access easement", community_infrastructure: "Community infrastructure", other: "Other",
} as const;
export const MATERIALITY = { low: "Low", medium: "Medium", high: "High", critical: "Critical", unknown: "Unknown" } as const;

export const AUTHORITY_TYPES = {
  elected: "Elected", customary: "Customary", council: "Council", elder: "Elder", clan: "Clan", family: "Family", womens_group: "Women's group", youth: "Youth body",
  ceremonial: "Ceremonial", healer: "Traditional healer", landholder: "Landholder", assembly: "Ejido / community assembly", cooperative: "Cooperative", trust: "Legal trust",
  incorporated: "Incorporated body", other: "Other",
} as const;
/** Powers a (knowledge) authority can hold. Recorded per authority; never inferred from who shared the knowledge. */
export const AUTHORITY_POWERS = {
  publication: "Authorise publication", commercial: "Authorise commercial use", digitization: "Authorise digitisation", ai: "Authorise AI use", withdraw: "Withdraw permission",
  land: "Decide on land", consent: "Give or withhold project consent",
} as const;

export const KNOWLEDGE_CATEGORIES = {
  ecological: "Ecological", land_use: "Land use", oral_history: "Oral history", sacred: "Sacred / cultural", ethnobotanical: "Ethnobotanical", medicinal: "Medicinal",
  agricultural: "Agricultural", hydrological: "Hydrological", wildlife: "Wildlife", seasonal: "Seasonal", fire: "Fire management", soil: "Soil", food: "Food systems",
  ceremonial: "Ceremonial", cultural_landscape: "Cultural landscape", architecture: "Architecture", settlement: "Settlement history", place_names: "Place names",
  navigation: "Navigation", climate: "Weather / climate", stewardship: "Stewardship practice", biodiversity: "Biodiversity", other: "Other",
} as const;
export const KNOWLEDGE_TYPES = {
  scientific: "Scientific", engineering: "Engineering", financial: "Financial", legal: "Legal", regulatory: "Regulatory", historical: "Historical", remote_sensing: "Remote sensing",
  field_observation: "Field observation", community_observation: "Community observation", oral_history: "Oral history", tek: "Traditional Ecological Knowledge",
  indigenous: "Indigenous Knowledge", practitioner: "Practitioner experience",
} as const;

export const ACCESS_STATUS = {
  public: "Public", community_only: "Community only", authorized_researchers: "Authorised researchers", authorized_team: "Authorised project team", restricted: "Restricted",
  confidential: "Confidential", sacred: "Sacred", secret: "Secret", gender_restricted: "Gender restricted", age_restricted: "Age restricted", lineage_restricted: "Lineage restricted",
  practitioner_restricted: "Practitioner restricted", ceremonial: "Ceremonial", seasonal: "Seasonal", location_sensitive: "Location sensitive", non_digitizable: "Non-digitisable",
  existence_only: "Existence only", unavailable: "Unavailable",
} as const;
export type AccessStatus = keyof typeof ACCESS_STATUS;
/** Access states under which the OS stores metadata only: no description, no content pointer, no location. */
export const EXISTENCE_ONLY: AccessStatus[] = ["sacred", "secret", "non_digitizable", "existence_only", "ceremonial"];
/** Governance summary status (knowledge governance statuses from the master additions). */
export const GOVERNANCE_STATUS = { public: "Public", community_shared: "Community shared", project_specific: "Project specific", restricted: "Restricted", sacred_do_not_digitize: "Sacred: do not digitise", unknown: "Unknown" } as const;

export const ACTIVITIES = {
  interview_recording: "Interview recording", photography: "Photography", audio: "Audio", video: "Video", transcription: "Transcription", translation: "Translation", digitization: "Digitisation",
  internal_research: "Internal research", environmental_assessment: "Environmental assessment", conservation_planning: "Conservation planning", engineering_design: "Engineering design",
  project_design: "Project design", gis_representation: "GIS representation", exact_coordinate_storage: "Exact coordinate storage", exact_coordinate_disclosure: "Exact coordinate disclosure",
  generalized_mapping: "Generalised mapping", public_publication: "Public publication", academic_publication: "Academic publication", investor_diligence: "Investor diligence",
  lender_diligence: "Lender diligence", sponsor_access: "Project sponsor access", commercial_advisory: "Commercial advisory use", third_party_transfer: "Third-party transfer",
  ai_inference: "AI inference", ai_summarization: "AI summarisation", ai_retrieval: "AI retrieval", ai_embedding: "AI embedding", ai_training: "AI model training",
  ai_external_transfer: "External model transfer", ai_third_party_provider: "Third-party model provider", derivative_analysis: "Derivative analysis", marketing: "Marketing",
  education: "Education", ip_development: "IP development", patent: "Patent-related use", biodiversity_credit: "Biodiversity credit development", carbon_project: "Carbon project use",
  ecosystem_services: "Ecosystem services use", regulatory_submission: "Regulatory submission", archive: "Archive", public_database: "Public database inclusion",
} as const;
export type Activity = keyof typeof ACTIVITIES;
export const AI_ACTIVITIES: Activity[] = ["ai_inference", "ai_summarization", "ai_retrieval", "ai_embedding", "ai_training", "ai_external_transfer", "ai_third_party_provider"];
/** Which authority power an activity needs. Activities not listed need an authority with any recorded power. */
export const ACTIVITY_POWER: Partial<Record<Activity, keyof typeof AUTHORITY_POWERS>> = {
  public_publication: "publication", academic_publication: "publication", public_database: "publication", marketing: "commercial", commercial_advisory: "commercial",
  ip_development: "commercial", patent: "commercial", biodiversity_credit: "commercial", carbon_project: "commercial", ecosystem_services: "commercial", third_party_transfer: "commercial",
  investor_diligence: "commercial", lender_diligence: "commercial", digitization: "digitization", interview_recording: "digitization", audio: "digitization", video: "digitization",
  photography: "digitization", transcription: "digitization", ai_inference: "ai", ai_summarization: "ai", ai_retrieval: "ai", ai_embedding: "ai", ai_training: "ai",
  ai_external_transfer: "ai", ai_third_party_provider: "ai",
};
export const PERMISSION_STATUS = { allowed: "Allowed", allowed_with_conditions: "Allowed with conditions", prohibited: "Prohibited", pending: "Pending", expired: "Expired", withdrawn: "Withdrawn" } as const;

export const CONSENT_STATUS = {
  not_started: "Not started", engagement_initiated: "Engagement initiated", consultation_underway: "Consultation underway", pending_review: "Pending community review",
  conditions_proposed: "Conditions proposed", granted: "Consent granted", granted_with_conditions: "Consent granted with conditions", withheld: "Consent withheld",
  suspended: "Suspended", withdrawn: "Withdrawn", expired: "Expired", not_applicable: "Not applicable",
} as const;
export type ConsentStatus = keyof typeof CONSENT_STATUS;
export const CONSENT_GRANTED: ConsentStatus[] = ["granted", "granted_with_conditions"];
/** Disclosures a consent record tracks. A granted consent with any of these false is flagged, never hidden. */
export const DISCLOSURES = {
  purpose: "Purpose", project_description: "Project description", commercial_intent: "Commercial intent", risks: "Risks", benefits: "Benefits", data_use: "Data use",
  third_party_use: "Third-party use", ai_use: "AI use", recording: "Recording", mapping: "Mapping", financial_structure: "Financial structure", benefit_structure: "Community benefit structure",
} as const;
export const CONSENT_TYPES = { fpic: "FPIC (project)", knowledge: "Knowledge use", research: "Research participation", land: "Land access", recording: "Recording", other: "Other" } as const;

export const ENGAGEMENT_FORMATS = { assembly: "Community assembly", meeting: "Meeting", site_visit: "Site visit", workshop: "Workshop", call: "Call", letter: "Letter", other: "Other" } as const;

export const PARTICIPATION_TYPES = {
  direct_equity: "Direct equity", carried_equity: "Carried equity", vendor_financed_equity: "Vendor-financed equity", concessional_equity: "Concessional-financed equity",
  revenue_share: "Revenue share", gross_revenue_share: "Gross revenue share", net_revenue_share: "Net revenue share", royalty: "Royalty", production_royalty: "Production royalty",
  profit_participation: "Profit participation", fcf_participation: "Free cash flow participation", land_lease: "Land lease", lease_plus_upside: "Land lease plus upside",
  lease_to_equity: "Lease-to-equity", land_for_equity: "Land-for-equity", stewardship_contract: "Stewardship contract", ecosystem_services: "Ecosystem services agreement",
  biodiversity_share: "Biodiversity revenue share", carbon_share: "Carbon revenue share", benefit_fund: "Community benefit fund", trust: "Community trust",
  intergenerational_fund: "Intergenerational fund", employment: "Employment commitment", procurement: "Procurement commitment", capacity_building: "Capacity-building commitment",
  infrastructure: "Infrastructure benefit", development_fund: "Development fund", hybrid: "Hybrid structure",
} as const;
export type ParticipationType = keyof typeof PARTICIPATION_TYPES;
export const STRUCTURE_STATUS = { concept: "Concept", modelled: "Modelled", proposed: "Proposed", negotiation: "Negotiation", agreed: "Agreed", executed: "Executed", active: "Active", terminated: "Terminated" } as const;
export const APPROVAL = { pending: "Pending", approved: "Approved", rejected: "Rejected", not_required: "Not required" } as const;
export const STAKE_FUNDING = {
  direct: "Direct community investment", sponsor_funded: "Sponsor-funded (carried)", vendor_financed: "Vendor financed", dfi: "DFI financed", concessional: "Concessional facility",
  grant: "Philanthropic grant", blended: "Blended-finance vehicle", trust: "Trust-funded", future_distributions: "Financed from future distributions", land_contribution: "Land contribution",
  subsidy: "Public subsidy", guarantee_loan: "Guarantee-backed loan",
} as const;

/** The three ledgers are never summed into one "community contribution" figure. */
export const LEDGERS = {
  mitigation: { label: "A · Mitigation / compensation", help: "Displacement, land, livelihood, access, environmental and cultural impacts; legally required or negotiated remediation." },
  participation: { label: "B · Community economic participation", help: "Equity, revenue share, royalties, distributions, stewardship revenue and project upside." },
  development: { label: "C · Community development / partnership", help: "Education, infrastructure, capacity building, enterprise, health, conservation, cultural preservation and voluntary commitments." },
} as const;
export type Ledger = keyof typeof LEDGERS;
export const LEDGER_OF: Record<ParticipationType, Ledger> = {
  direct_equity: "participation", carried_equity: "participation", vendor_financed_equity: "participation", concessional_equity: "participation", revenue_share: "participation",
  gross_revenue_share: "participation", net_revenue_share: "participation", royalty: "participation", production_royalty: "participation", profit_participation: "participation",
  fcf_participation: "participation", land_lease: "participation", lease_plus_upside: "participation", lease_to_equity: "participation", land_for_equity: "participation",
  stewardship_contract: "participation", ecosystem_services: "participation", biodiversity_share: "participation", carbon_share: "participation", benefit_fund: "development",
  trust: "participation", intergenerational_fund: "participation", employment: "development", procurement: "development", capacity_building: "development",
  infrastructure: "development", development_fund: "development", hybrid: "participation",
};
export const LEDGER_ENTRY_STATUS = { projected: "Projected", scheduled: "Scheduled", paid: "Paid", overdue: "Overdue", disputed: "Disputed", cancelled: "Cancelled" } as const;

export const GOVERNANCE_RIGHT_TYPES = {
  board_seat: "Board seat", board_observer: "Board observer", advisory_committee: "Advisory committee", environmental_monitoring: "Environmental monitoring",
  heritage_committee: "Cultural heritage committee", information: "Information right", audit: "Audit right", consultation: "Consultation right", consent: "Consent right",
  reserved_matter: "Reserved matter", veto: "Veto (where legally / contractually applicable)", cultural_approval: "Approval of cultural matters", knowledge_approval: "Approval of knowledge use",
  grievance: "Grievance mechanism", dispute_panel: "Dispute panel", change_consultation: "Project-change consultation", budget_visibility: "Budget visibility",
  fund_oversight: "Benefit-fund oversight", trustee_appointment: "Trustee appointment", transfer_approval: "Transfer approval", change_of_control: "Change-of-control rights",
} as const;

export const COMMITMENT_STATUS = { proposed: "Proposed", agreed: "Agreed", active: "Active", fulfilled: "Fulfilled", overdue: "Overdue", disputed: "Disputed", amended: "Amended", suspended: "Suspended", terminated: "Terminated" } as const;
export const COMMITMENT_TYPES = { payment: "Payment", employment: "Employment", procurement: "Local procurement", training: "Training", infrastructure: "Infrastructure", consultation: "Consultation", reporting: "Reporting", monitoring: "Monitoring", restoration: "Restoration", other: "Other" } as const;
export const GRIEVANCE_STATUS = { received: "Received", acknowledged: "Acknowledged", investigating: "Investigating", resolved: "Resolved", escalated: "Escalated", closed: "Closed" } as const;

export const COMMUNITY_AGREEMENTS = [
  "Community Research Agreement", "Knowledge Governance Agreement", "FPIC / Consent Record", "Participant Information Sheet", "Individual Consent Form", "Community Benefit Agreement",
  "Impact Benefit Agreement", "Community Participation Agreement", "Revenue-Sharing Agreement", "Community Equity Agreement", "Stewardship Agreement", "Land Use Agreement",
  "Community Trust Agreement", "Community Fund Governance Charter", "Data / Knowledge Access Schedule", "Knowledge Permitted-Use Schedule", "Cultural Heritage Protocol",
  "Community Monitoring Framework", "Grievance Procedure", "Local Procurement Agreement", "Employment & Training Commitment Schedule",
] as const;

/** Community-governance gates by development stage (checked, never auto-passed). */
export const COMMUNITY_GATES: { stage: string; checks: { key: string; label: string }[] }[] = [
  { stage: "Origination", checks: [{ key: "screened", label: "Community presence, tenure and cultural sensitivity screened" }] },
  { stage: "Pre-feasibility", checks: [{ key: "identified", label: "Communities identified" }, { key: "rights_mapped", label: "Rights mapped" }, { key: "authority_identified", label: "Authority identified" }] },
  { stage: "Feasibility", checks: [{ key: "engaging", label: "Engagement underway" }, { key: "kg_framework", label: "Knowledge governance framework established (where knowledge is involved)" }, { key: "structures_evaluated", label: "Participation structures evaluated" }] },
  { stage: "Development", checks: [{ key: "consent_progressing", label: "Required consent processes progressing" }, { key: "structures_modelled", label: "Participation economics modelled" }] },
  { stage: "Financing", checks: [{ key: "rights_resolved", label: "Material rights issues resolved or disclosed" }, { key: "commitments_recorded", label: "Commitments recorded with owners" }] },
  { stage: "Financial close", checks: [{ key: "consent_granted", label: "Required consent documented as granted" }, { key: "agreements_executed", label: "Required agreements executed" }] },
];

/** Community-alignment preferences on capital profiles (explainable fit, never an opaque score). */
export const CP_PREFERENCE = { required: "Required", preferred: "Preferred", accepted: "Accepted", neutral: "Neutral", case_by_case: "Case-by-case", excluded: "Excluded by mandate", unknown: "Unknown" } as const;
export const ALIGNMENT_FLAGS = {
  indigenous_partnership: "Indigenous partnership mandate", community_ownership: "Community ownership preference", just_transition: "Just transition mandate", local_ownership: "Local ownership preference",
  biodiversity: "Biodiversity mandate", conservation: "Conservation finance mandate", adaptation: "Climate adaptation mandate", social_infrastructure: "Social infrastructure mandate",
  blended: "Blended finance appetite", concessional: "Concessional appetite", dfi_eligible: "DFI eligibility", impact: "Impact mandate", emerging_markets: "Emerging markets mandate",
  stewardship: "Stewardship preference", gender_lens: "Gender lens", livelihoods: "Livelihoods focus", local_enterprise: "Local enterprise focus", human_rights_dd: "Human rights diligence standard",
} as const;
export const SUPPORTED_STRUCTURES = { community_equity: "Community equity", revenue_share: "Revenue share", royalty: "Royalty", trust: "Community trust", indigenous_ownership: "Indigenous ownership", local_ownership: "Local ownership", stewardship: "Stewardship payments", blended: "Blended finance", dfi: "DFI", guarantee: "Guarantee", development_fund: "Development fund", concessional: "Concessional facility" } as const;

export const LEGAL_NOTE = "Community participation, Indigenous rights, FPIC, securities issuance, equity transfers, land rights, tax treatment, benefit-sharing, cultural heritage, biodiversity access, genetic resources, trust structures and community investment vehicles are governed by jurisdiction-specific law. The OS supports diligence, workflow, analysis, documentation and structuring; it does not substitute for local legal counsel, Indigenous or community counsel, tax, securities or environmental counsel, qualified cultural advisers or local authorities.";
