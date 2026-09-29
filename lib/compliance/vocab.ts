// Prospecting compliance vocabulary: provenance classes, campaign activity classes, permission states, risk tiers,
// contact preference statuses. The OS classifies and escalates; it never presents its output as legal advice.

export const PROVENANCE = {
  first_party: "First party", referral: "Referral", existing_relationship: "Existing relationship", public_corporate: "Public corporate", event: "Event",
  public_filing: "Public filing", licensed_database: "Licensed database", enrichment: "Enrichment", unknown: "Unknown",
} as const;
export type Provenance = keyof typeof PROVENANCE;
/** LEAD_SOURCES → provenance class. "other" and anything unmapped is Unknown and not outreach-eligible in campaigns. */
export const SOURCE_PROVENANCE: Record<string, Provenance> = {
  website: "first_party", organic: "first_party", email: "first_party", referral: "referral", event: "event", apollo: "licensed_database", linkedin: "public_corporate",
  google: "public_corporate", trigger: "public_corporate", procurement: "public_filing", compliance: "public_filing", mandate_match: "public_corporate", channel: "referral",
};

export const ACTIVITY_CLASSES = {
  business_development: "Ordinary business development", advisory_marketing: "Advisory service marketing", capital_intelligence: "Capital intelligence", market_research: "General market research",
  institutional_introduction: "Institutional introduction", debt_introduction: "Debt / project finance introduction", securities_solicitation: "Securities solicitation",
  ma_asset_sale: "M&A / asset sale", partnership: "Partnership origination",
} as const;
export type ActivityClass = keyof typeof ACTIVITY_CLASSES;
export const PERMISSION = { allowed: "Allowed", allowed_with_conditions: "Allowed with conditions", consent_required: "Consent required", legal_review_required: "Legal review required", blocked: "Blocked" } as const;
export type Permission = keyof typeof PERMISSION;
export const RISK = { low: "Low", moderate: "Moderate", high: "High", blocked: "Blocked" } as const;
export type Risk = keyof typeof RISK;
export const CAMPAIGN_STATUS = { draft: "Draft", review: "In review", approved: "Approved", active: "Active", paused: "Paused", closed: "Closed" } as const;
export const RECIPIENT_TYPES = { corporate: "Corporate (B2B)", institutional_investor: "Institutional investor", individual_investor: "Individual / private investor", public_body: "Public body", developer: "Developer / sponsor", partner: "Partner / supplier", individual: "Individual (consumer)" } as const;
export const CHANNELS = { email: "Email", linkedin: "LinkedIn (manual only)", call: "Call", event: "Event", letter: "Letter" } as const;
export const RULE_TOPICS = { b2b_email: "B2B electronic marketing", consumer_email: "Consumer electronic marketing", data_protection: "Personal data processing", calls: "Telephone marketing", securities: "Securities offering / solicitation", broker: "Broker / placement agent licensing", finder_fee: "Finder / success fees", other: "Other" } as const;
export const COUNSEL_STATUS = { not_reviewed: "Not reviewed", reviewed: "Reviewed by counsel", outdated: "Review outdated" } as const;
export const PREFERENCE_STATUS = { do_not_contact: "Do not contact", email_opt_out: "Email opt-out", call_opt_out: "Call opt-out", all_marketing_opt_out: "All marketing opt-out", legal_hold: "Legal hold" } as const;
export const DISCLAIMER = "Classification and briefs are workflow aids assembled from rules you have recorded with their sources. They are not legal advice and do not replace counsel.";
