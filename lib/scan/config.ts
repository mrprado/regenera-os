// Scan configuration (phase 15 §6). Every scan, whatever section launches it, is described by this one schema.
import { z } from "zod";

export const SCAN_SECTIONS = {
  organizations: "Organizations",
  people: "People",
  prospecting: "Prospecting",
  capital: "Capital",
  partners: "Partner network",
  intelligence: "Intelligence",
  funding: "Funding",
  mandates: "Mandates / pursuits",
  projects: "Projects",
} as const;
export type ScanSection = keyof typeof SCAN_SECTIONS;

export const SCAN_PROVIDERS = {
  existing: { label: "Existing workspace records", cost: "free", discovers: false, note: "Re-screens organizations already in this workspace against the criteria. Finds nothing new." },
  gleif: { label: "GLEIF legal-entity register", cost: "free", discovers: true, note: "Public LEI register: legal name, jurisdiction and registration status only. No sector, size or strategy evidence, so most criteria stay unknown." },
  apollo_orgs: { label: "Apollo organization search", cost: "credits", discovers: true, note: "Company search with industry and location filters. Costs Apollo credits per page (see Settings → Connections)." },
  apollo_people: { label: "Apollo people search", cost: "search", discovers: true, note: "Finds people by title at matched organizations. Search returns no email addresses; contact routes need separate, budgeted enrichment." },
  web: { label: "Open web (Claude web search)", cost: "ai", discovers: true, note: "Searches public websites, industry and member directories, business registries, procurement portals and news for matching organizations. Every candidate must cite the page it came from; no LinkedIn or login-only pages. Needs ANTHROPIC_API_KEY; spend is capped by the scan's research budget." },
  // Opportunity sources (objective scans): records already collected by the OS, matched against the objective.
  network_projects: { label: "Projects in your network", cost: "free", discovers: true, note: "Projects recorded in this workspace (stage, technology, size, location). Sponsor procurement plans still need confirming." },
  procurement: { label: "Procurement packages", cost: "free", discovers: true, note: "Packages on workspace projects that are at need or tender stage with bids not yet due." },
  funding_calls: { label: "Funding calls", cost: "free", discovers: true, note: "Calls ingested from Grants.gov, EU Funding & Tenders, UK Contracts Finder and other registered sources; closed calls are excluded." },
  queue_projects: { label: "Interconnection queues (MISO, SPP)", cost: "free", discovers: true, note: "Public US interconnection requests: location, technology, MW and study phase. Not open procurements; sponsors are not published." },
} as const;
export type ScanProvider = keyof typeof SCAN_PROVIDERS;

export const OPPORTUNITY_PROVIDERS = ["network_projects", "procurement", "funding_calls", "queue_projects"] as const;
export const zScanConfig = z.object({
  mode: z.enum(["organizations", "opportunities"]).default("organizations"),
  objectiveId: z.string().optional(),
  audience: z.string().min(1),
  geography: z.array(z.string()).default([]),          // ISO3 codes or region keys (lib/scan/countries.ts)
  sector: z.string().optional(),
  terms: z.array(z.string()).default([]),              // extra organization terms on top of the audience's own
  excludeTerms: z.array(z.string()).default([]),
  headcountMin: z.number().int().nonnegative().optional(),
  headcountMax: z.number().int().positive().optional(),
  titles: z.array(z.string()).default([]),             // overrides the audience's decision-maker titles when set
  seniorities: z.array(z.string()).default([]),
  signalCriteria: z.string().default(""),               // buying events to look for (recorded for review; not auto-proven)
  freshnessDays: z.number().int().positive().max(3650).default(365),
  providers: z.array(z.enum(["existing", "gleif", "web", "apollo_orgs", "apollo_people", ...OPPORTUNITY_PROVIDERS])).default(["existing"]),
  // Objective criteria for opportunity scans (copied from the objective when the scan starts, so the run is reproducible).
  capabilities: z.array(z.string()).default([]),
  sizeMin: z.number().nullable().default(null), sizeMax: z.number().nullable().default(null), sizeUnit: z.string().nullable().default(null),
  stages: z.array(z.string()).default([]),
  maxOrganizations: z.number().int().positive().max(500).default(50),
  maxPeoplePerOrg: z.number().int().min(0).max(10).default(0),
  enrichmentBudget: z.number().int().min(0).max(500).default(0),   // Apollo credits this scan may spend, in total
  researchBudgetUsd: z.number().min(0).max(50).default(3),          // Claude spend for open-web discovery in this scan, in total
  dedupe: z.enum(["merge_strong_ids", "flag_only"]).default("merge_strong_ids"),
  requireReview: z.boolean().default(true),
});
export type ScanConfig = z.infer<typeof zScanConfig>;

/** Credits a scan may spend at most: Apollo organization pages (1 credit per page of up to 100) plus the enrichment budget. */
export function creditCeiling(c: ScanConfig): number {
  const orgPages = c.providers.includes("apollo_orgs") ? Math.ceil(c.maxOrganizations / 100) : 0;
  return orgPages + c.enrichmentBudget;
}

/** Stable fingerprint of a configuration: the same preset with the same settings on the same day is one scan. */
export function configFingerprint(c: ScanConfig): string {
  const norm = { ...c, geography: [...c.geography].sort(), terms: [...c.terms].sort(), excludeTerms: [...c.excludeTerms].sort(), titles: [...c.titles].sort(), seniorities: [...c.seniorities].sort(), providers: [...c.providers].sort() };
  const json = JSON.stringify(norm, Object.keys(norm).sort());
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export const SCAN_STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", partial: "Partially completed", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
