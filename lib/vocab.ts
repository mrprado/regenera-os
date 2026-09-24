// Shared vocabulary, taken from the live regenera.bio (regenera-development-office).
// Every enum here also exists as a CHECK constraint in D1 and in AI output schemas (SPEC section 21).
import { z } from "zod";

export const PRACTICES = {
  systems_intelligence: "Systems Intelligence",
  development_strategy: "Development & Strategy",
  capital_partnerships: "Capital & Strategic Partnerships",
} as const;

export const SECTORS = {
  energy: "Energy",
  infrastructure: "Infrastructure",
  land_built_environment: "Land & Built Environment",
  waste_resource_systems: "Waste & Resource Systems",
  water_food_nature: "Water, Food & Nature",
} as const;

export const TERRITORIAL_SYSTEMS = {
  land_stewardship: "Land & Stewardship",
  water: "Water",
  energy_resource_flows: "Energy & Resource Flows",
  food_production: "Food & Production",
  community_health: "Community & Health",
  built_environment: "Built Environment",
  information_governance: "Information & Governance",
} as const;

export const METHOD_GATES = ["Basis to proceed", "Development case", "Institutional readiness", "Capital and delivery"] as const;

export const ENGAGEMENTS = {
  diagnostic: "Project diagnostic",
  capital_screening: "Capital-partner screening",
  readiness_mandate: "Readiness mandate",
  development_office: "Development office",
  capital_advisory: "Capital advisory",
  governance_monitoring: "Governance & monitoring",
} as const;

export const FEE_TYPES = {
  one_time: "One-time",
  monthly_retainer: "Monthly retainer",
  milestone: "Milestone",
  fee_plus_equity: "Fee + equity",
  success_fee: "Success fee (deal-based)",
} as const;

export const DEAL_STAGES = {
  lead: "Lead",
  contacted: "Contacted",
  engaged: "Engaged",
  call_booked: "Call booked",
  proposal: "Proposal",
  signed: "Signed",
  active: "Active",
  expansion: "Expansion",
  completed: "Completed",
  churned: "Churned",
  lost: "Lost",
  nurture: "Nurture",
} as const;

export const LEAD_SOURCES = {
  website: "Website",
  organic: "Organic",
  linkedin: "LinkedIn",
  google: "Google",
  referral: "Referral",
  email: "Email outreach",
  event: "Event / conference",
  trigger: "Trigger",
  mandate_match: "Mandate match",
  procurement: "Procurement",
  compliance: "Compliance-driven",
  channel: "Channel recruitment",
  apollo: "Apollo search",
  other: "Other",
} as const;

export const MANDATE_TYPES = ["advisory", "investment", "development"] as const;
export const ENGAGEMENT_PATHS = ["capital_mandate", "project_diagnostic", "partner_network"] as const;
export const PROJECT_STAGES = ["formation", "development", "construction", "operating", "expansion"] as const;
export const CAPITAL_STRUCTURES = ["no_preference", "equity", "debt", "project_finance", "strategic", "blended"] as const;
export const TICKET_BANDS = ["under_1m", "1m_5m", "5m_25m", "25m_100m", "over_100m"] as const;
export const READINESS_DIMENSIONS = ["control", "technical", "commercial", "institutional", "capital"] as const;
export const SCREENING_QUADRANTS = ["proceed", "develop", "redirect", "decline"] as const;
export const PARTNER_TIERS = ["standard", "strategic", "institutional"] as const;
export const REFERRAL_STATUSES = ["submitted", "scoped", "mandate_signed", "paid", "declined"] as const;

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const zPractice = z.enum(keys(PRACTICES));
export const zSector = z.enum(keys(SECTORS));
export const zTerritorialSystem = z.enum(keys(TERRITORIAL_SYSTEMS));
export const zEngagement = z.enum(keys(ENGAGEMENTS));
export const zFeeType = z.enum(keys(FEE_TYPES));
export const zDealStage = z.enum(keys(DEAL_STAGES));
export const zLeadSource = z.enum(keys(LEAD_SOURCES));

// CRM closed sets (SPEC section 21).
export const SEGMENT_GROUPS = ["capital", "corporate", "public", "channel", "community"] as const;
export const LEAD_STATES = ["sourced", "researched", "qualified", "parked", "queued", "contacted", "engaged", "nurture"] as const;
export const TIERS = ["targeted", "mass", "watchlist", "parked"] as const;
export const EMAIL_STATUSES = ["unknown", "inferred", "unverified", "verified_manual", "verified_provider", "invalid"] as const;
export const TRIGGER_TYPES = ["people", "capital", "regulatory", "crisis", "project", "procurement", "commitment", "event"] as const;
export const TRIGGER_STATUSES = ["new", "pursued", "watched", "dismissed"] as const;
export const CHANNELS = ["email", "linkedin_connect", "linkedin_message", "call", "meeting", "note"] as const;
export const MESSAGE_STATUSES = ["draft", "style_failed", "pending_approval", "approved", "sending", "sent", "failed", "cancelled"] as const;
export const CONSENT_BASES = ["legitimate_interest", "consent", "existing_relationship", "none"] as const;
export const PARTNER_TYPES = ["epc", "engineering", "law", "big4", "architect", "bank_lender", "fund_manager", "operator", "technology"] as const;
export const ACTIVITY_TYPES = ["email", "call", "meeting", "note", "linkedin", "stage_change", "import", "research", "site_inquiry", "referral"] as const;
export const APOLLO_SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern"] as const;
export const REPLY_CLASSES = ["interested", "not_now", "referral", "question", "objection", "unsubscribe", "out_of_office", "bounce", "hostile", "other"] as const;
// "drafting" = messages being written; then active / paused / completed / stopped (SPEC section 21).
export const ENROLLMENT_STATUSES_ALL = ["drafting", "active", "paused", "completed", "stopped"] as const;
