// Origination & Integrity Engine — policy v1 (phase 23). Published policies are immutable; a new version never rewrites
// earlier decisions. Rules are deterministic and cite their basis; references are to recognised frameworks (IFC
// Performance Standards, TNFD LEAP, GHG Protocol project accounting, Equator Principles), not certifications.
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { originationPolicies } from "@/db/schema";

export const DECISION_STATE_LABEL = {
  eligible: "Eligible", conditionally_eligible: "Conditionally eligible", redesign_required: "Redesign required", enhanced_due_diligence: "Enhanced due diligence",
  insufficient_evidence: "Insufficient evidence", excluded: "Excluded", human_review: "Human review required",
} as const;
export const CLASSIFICATION_LABEL = {
  regenerative_core: "A · Regenerative core", transition_enabling: "B · Transition & enabling infrastructure",
  conditional_redesign: "C · Conditional / redesign required", restricted_excluded: "D · Restricted / excluded",
} as const;
export type DecisionState = keyof typeof DECISION_STATE_LABEL;
export type Classification = keyof typeof CLASSIFICATION_LABEL;

/** States that stop proposals, outreach drafts, queue advancement and capital introductions (service-layer gate). */
export const BLOCKING_STATES: DecisionState[] = ["excluded", "human_review"];

export type PolicyRules = {
  /** Activities excluded outright (matched on name, technology and description). Configurable. */
  exclusions: { key: string; pattern: string; why: string }[];
  /** Sector classes by technology / description pattern, first match wins. */
  sectorClasses: { pattern: string; classification: Classification; method: string }[];
  /** Sector methods that require named evidence before the project can be Eligible. */
  methodEvidence: Record<string, { fields: string[]; why: string }>;
  protectedNearKm: number;
  waterIntensive: string;
  priorityCountries: string[];
  reviewDays: Partial<Record<DecisionState, number>>;
};

export const POLICY_V1: PolicyRules = {
  exclusions: [
    { key: "illegal_deforestation", pattern: "illegal (logging|deforestation)|clear[- ]?cut(ting)? of (primary|old[- ]growth) forest", why: "Illegal deforestation (IFC PS6)" },
    { key: "thermal_coal", pattern: "\\b(thermal coal|coal[- ]fired|coal mine|lignite)\\b", why: "New thermal coal capacity or mining is outside Regenera's mandate" },
    { key: "forced_displacement", pattern: "forced (eviction|displacement|resettlement)", why: "Forced displacement (IFC PS5)" },
    { key: "unlawful_pollution", pattern: "unlawful (discharge|dumping|pollution)|illegal dumping", why: "Unlawful pollution (IFC PS3)" },
    { key: "fpic_violation", pattern: "without (free,? prior and informed )?consent|fpic (violation|breach)", why: "Material breach of Indigenous Peoples' consent requirements (IFC PS7)" },
  ],
  sectorClasses: [
    { pattern: "restor|reforest|agroforest|regenerative agri|watershed|conservation|biodiversity|mangrove|soil", classification: "regenerative_core", method: "nature" },
    { pattern: "\\bsolar|\\bpv\\b|\\bwind\\b|\\bwind(farm|power)|\\bgeotherm|small hydro|mini-?grid|microgrid", classification: "regenerative_core", method: "renewable" },
    { pattern: "storage|bess|battery|transmission|grid|substation|distribution", classification: "transition_enabling", method: "grid" },
    { pattern: "waste|landfill|biogas|recycl|resource recovery|wte|incinerat|pyroly|gasif", classification: "transition_enabling", method: "waste" },
    { pattern: "water treatment|wastewater|desal|sanitation|water supply|irrigation", classification: "transition_enabling", method: "water" },
    { pattern: "remediat|brownfield|decommission|retrofit|methane|decarboni", classification: "transition_enabling", method: "transition" },
    { pattern: "data cent|industrial|cement|steel|smelter", classification: "conditional_redesign", method: "industrial" },
    { pattern: "real estate|resort|hospitality|tourism|housing|residential|urban|master ?plan", classification: "conditional_redesign", method: "built" },
    { pattern: "\\bhydro(power|electric)?\\b|\\bdam\\b", classification: "conditional_redesign", method: "hydro" },
  ],
  methodEvidence: {
    waste: { fields: ["feedstock", "emissions", "residues", "technology"], why: "Waste-to-energy and resource recovery are never regenerative by default: feedstock composition, waste-hierarchy fit, air emissions, residues and technology performance need independent evidence" },
    industrial: { fields: ["water", "power_source", "heat_recovery"], why: "Data centres and industry need credible power sourcing, water demand and heat-recovery evidence" },
    built: { fields: ["water", "land_rights", "habitat"], why: "Built-environment projects need water demand, land rights and habitat evidence" },
    hydro: { fields: ["flow", "habitat", "resettlement"], why: "Hydropower needs environmental flow, habitat and resettlement evidence" },
  },
  protectedNearKm: 1,
  waterIntensive: "data cent|agri|irrigat|resort|hospitality|real estate|housing|industrial|biogas|green hydrogen|hydrogen",
  priorityCountries: ["MEX", "USA", "ZAF", "NAM", "ZWE", "MOZ", "BWA", "MUS", "TZA", "MNE", "NZL", "IND"],
  reviewDays: { eligible: 180, conditionally_eligible: 90, redesign_required: 60, enhanced_due_diligence: 45, insufficient_evidence: 30, excluded: 365, human_review: 14 },
};

/** Returns the latest published policy, publishing v1 on first use. */
export async function currentPolicy(db: Db): Promise<{ version: number; rules: PolicyRules }> {
  const [p] = await db.select().from(originationPolicies).where(eq(originationPolicies.status, "published")).orderBy(desc(originationPolicies.version)).limit(1);
  if (p) return { version: p.version, rules: p.rules as unknown as PolicyRules };
  await db.insert(originationPolicies).values({ version: 1, name: "Origination & Integrity Policy v1", rules: POLICY_V1 as unknown as Record<string, unknown>, notes: "Initial policy (phase 23).", publishedBy: "system" }).onConflictDoNothing();
  return { version: 1, rules: POLICY_V1 };
}
