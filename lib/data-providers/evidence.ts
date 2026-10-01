// Evidence hierarchy and screening flags (docs/data/EVIDENCE_LEVELS.md). Pure and client-safe.
// Level 1 global screening → Level 2 jurisdictional diligence → Level 3 project-specific evidence. A project shows
// three separate readings, never one blended score. Screening flags are observations with sources and the local
// diligence they call for; none is a legal conclusion.
import type { EvidenceLevel } from "./types";

export const READINGS = { high: "High", partial: "Partial", low: "Low", incomplete: "Incomplete", complete: "Complete", none: "None" } as const;
export type Reading = keyof typeof READINGS;

export type EvidenceInputs = {
  screeningSources: string[];           // distinct Level 1 datasets / providers used for this site
  screeningDimensions: string[];        // dimensions covered (water, ecology, land, energy, grid, climate, community…)
  jurisdictions: number; requirements: number; requirementsVerified: number; permits: number; permitsApproved: number; level2Sources: number;
  studies: { type: string; status: string }[];   // engineering / environmental studies
  documents: string[];                  // document types held: ppa, lease, title, eia, interconnection, model, legal_opinion, survey
};

const CORE_DIMENSIONS = ["water", "ecology", "land", "energy", "grid", "climate", "community"];
const INVESTMENT_DOCS = ["interconnection", "ppa", "lease_or_title", "eia", "resource", "model", "legal_opinion"];

export function evidenceReadings(x: EvidenceInputs) {
  const covered = CORE_DIMENSIONS.filter(d => x.screeningDimensions.includes(d));
  const screening: Reading = covered.length >= 6 && x.screeningSources.length >= 4 ? "high" : covered.length >= 3 ? "partial" : covered.length ? "low" : "none";
  const devScore = (x.jurisdictions > 0 ? 1 : 0) + (x.requirements > 0 && x.requirementsVerified / Math.max(1, x.requirements) >= 0.5 ? 1 : 0) + (x.permits > 0 ? 1 : 0) + (x.level2Sources > 0 ? 1 : 0);
  const development: Reading = devScore >= 4 && x.permitsApproved === x.permits && x.permits > 0 ? "complete" : devScore >= 2 ? "partial" : devScore ? "incomplete" : "none";
  const docs = new Set(x.documents.map(d => (d === "lease" || d === "title" ? "lease_or_title" : d)));
  for (const s of x.studies) if (["final", "accepted", "complete"].includes(s.status)) {
    if (/interconnect|grid/.test(s.type)) docs.add("interconnection");
    if (/eia|esia|environment/.test(s.type)) docs.add("eia");
    if (/resource|yield|solar|wind|hydro/.test(s.type)) docs.add("resource");
  }
  const held = INVESTMENT_DOCS.filter(d => docs.has(d));
  const investment: Reading = held.length === INVESTMENT_DOCS.length ? "complete" : held.length >= 3 ? "partial" : held.length ? "incomplete" : "none";
  return {
    screening, development, investment,
    notes: {
      screening: `${covered.length} of ${CORE_DIMENSIONS.length} dimensions screened from ${x.screeningSources.length} source(s)${covered.length < CORE_DIMENSIONS.length ? `; missing ${CORE_DIMENSIONS.filter(d => !covered.includes(d)).join(", ")}` : ""}`,
      development: `${x.jurisdictions} jurisdiction(s), ${x.requirementsVerified}/${x.requirements} requirements verified, ${x.permitsApproved}/${x.permits} permits approved, ${x.level2Sources} jurisdictional source(s)`,
      investment: `${held.length} of ${INVESTMENT_DOCS.length} project-specific evidence types held${held.length < INVESTMENT_DOCS.length ? `; missing ${INVESTMENT_DOCS.filter(d => !held.includes(d)).map(d => d.replace(/_/g, " ")).join(", ")}` : ""}`,
    },
  };
}

export const SCREENING_FLAGS = {
  water_stress: { label: "Water stress", diligence: "Local hydrological study, water-rights and abstraction permits" },
  forest_intersection: { label: "Forest intersection", diligence: "Ecological survey; lender and offtaker deforestation-free policies" },
  protected_area_proximity: { label: "Protected-area proximity", diligence: "Official WDPA / national register check and environmental authority consultation" },
  land_conversion_signal: { label: "Land-conversion signal", diligence: "Cause of conversion, tenure history and cut-off dates of applicable standards" },
  grid_gap: { label: "Grid gap", diligence: "Grid operator hosting capacity and interconnection study" },
  energy_access_opportunity: { label: "Energy access opportunity", diligence: "Household and productive-use demand survey, willingness to pay" },
  community_exposure: { label: "Community exposure", diligence: "Stakeholder mapping, FPIC where applicable, grievance mechanism" },
  climate_exposure: { label: "Climate exposure", diligence: "Site-specific hazard study and insurance review" },
} as const;
export type ScreeningFlag = keyof typeof SCREENING_FLAGS;

export type FlagDraft = { flag: ScreeningFlag; observed: string; implication: string; datasetId: string | null; value: string | null; evidenceLevel: EvidenceLevel };
export type ScreeningInputs = {
  aqueduct?: { indicator: string; category: number | null; categoryLabel: string | null }[];
  loss?: { totalHa: number; recentHa: number; recentFrom: number } | null;
  naturalPct?: number | null;
  transmissionKm?: number | null; transmissionMapped?: boolean;
  electricityAccessPct?: number | null;
  communities?: number; populated?: boolean;
  seismicEvents?: number | null; floodCategory?: number | null;
  protectedWithinKm?: number | null;
};

/** Observations → flags. Each keeps its dataset; thresholds are screening conventions and are stated in the text. */
export function screeningFlags(x: ScreeningInputs): FlagDraft[] {
  const out: FlagDraft[] = [];
  const bws = x.aqueduct?.find(r => r.indicator === "bws");
  if (bws && (bws.category ?? -1) >= 3) out.push({ flag: "water_stress", observed: `Baseline water stress: ${bws.categoryLabel ?? `category ${bws.category}`}`, implication: "Potential water availability constraint; favours low-water technologies and storage", datasetId: "wri.aqueduct.baseline_water_stress", value: bws.categoryLabel, evidenceLevel: 1 });
  if (x.loss && x.loss.totalHa > 0) out.push({ flag: "forest_intersection", observed: `${x.loss.totalHa} ha tree cover loss within the site since 2001`, implication: "Forest history on site; ecological and reputational diligence", datasetId: "wri.gfw.tree_cover_loss", value: String(x.loss.totalHa), evidenceLevel: 1 });
  else if (x.naturalPct != null && x.naturalPct >= 50) out.push({ flag: "forest_intersection", observed: `${x.naturalPct}% natural land cover within the boundary`, implication: "Natural habitat on site", datasetId: "esa.worldcover", value: String(x.naturalPct), evidenceLevel: 1 });
  if (x.loss && x.loss.recentHa > 0) out.push({ flag: "land_conversion_signal", observed: `${x.loss.recentHa} ha tree cover loss since ${x.loss.recentFrom}`, implication: "Recent conversion may breach deforestation-free cut-off dates", datasetId: "wri.gfw.tree_cover_loss", value: String(x.loss.recentHa), evidenceLevel: 1 });
  if (x.transmissionMapped === false || (x.transmissionKm != null && x.transmissionKm > 20)) out.push({ flag: "grid_gap", observed: x.transmissionMapped === false ? "No transmission line mapped within the search radius (OpenStreetMap)" : `Nearest mapped transmission ≈ ${x.transmissionKm} km`, implication: "Interconnection cost and time; distributed or off-grid options", datasetId: "osm.infrastructure", value: x.transmissionKm != null ? String(x.transmissionKm) : null, evidenceLevel: 1 });
  if (x.electricityAccessPct != null && x.electricityAccessPct < 80) out.push({ flag: "energy_access_opportunity", observed: `National electricity access ${x.electricityAccessPct}% (World Bank)`, implication: "Potential distributed-energy and productive-use demand", datasetId: "wb.wdi", value: String(x.electricityAccessPct), evidenceLevel: 1 });
  if ((x.communities ?? 0) > 0 || x.populated) out.push({ flag: "community_exposure", observed: (x.communities ?? 0) > 0 ? `${x.communities} communities recorded` : "Settlements mapped near the site", implication: "Social licence, consent and benefit-sharing", datasetId: null, value: null, evidenceLevel: 1 });
  if ((x.floodCategory ?? -1) >= 3 || (x.seismicEvents ?? 0) >= 5) out.push({ flag: "climate_exposure", observed: [(x.floodCategory ?? -1) >= 3 ? "High flood risk category (Aqueduct)" : null, (x.seismicEvents ?? 0) >= 5 ? `${x.seismicEvents} M4+ earthquakes nearby in the record` : null].filter(Boolean).join("; "), implication: "Design standards and insurance", datasetId: (x.floodCategory ?? -1) >= 3 ? "wri.aqueduct.riverine_flood" : null, value: null, evidenceLevel: 1 });
  if (x.protectedWithinKm != null && x.protectedWithinKm <= 5) out.push({ flag: "protected_area_proximity", observed: `Protected area tagged within ${x.protectedWithinKm} km (OpenStreetMap tags; not the official register)`, implication: "Possible restrictions and buffer requirements", datasetId: "wdpa.protected_areas", value: String(x.protectedWithinKm), evidenceLevel: 1 });
  return out;
}

/** §12 Impact / ESG attributes. Each claim must link to a source, methodology, evidence and confidence. */
export const IMPACT_ATTRIBUTES = {
  energy_access: "Energy access", decarbonization: "Decarbonization", restoration: "Restoration", water_resilience: "Water resilience", biodiversity: "Biodiversity",
  avoided_conversion: "Avoided land conversion", community_infrastructure: "Community infrastructure", food_systems: "Food systems", adaptation: "Climate adaptation",
} as const;
export const CLAIM_STATES = { company_reported: "Company reported", third_party_verified: "Third-party verified", certified: "Certified", estimated: "Estimated", unverified: "Unverified" } as const;

/** §13 Mandate alignment signal. Never "likely to invest". */
export const ALIGNMENT_SIGNALS = { verified: "Verified mandate alignment", potential: "Potential mandate alignment", unknown: "Unknown", outreach: "Requires outreach" } as const;
export function mandateAlignment(attributes: { attribute: string; verification: string }[], mandateText: string, mandateVerified: boolean) {
  const t = mandateText.toLowerCase();
  const KEYS: Record<string, RegExp> = {
    energy_access: /energy access|sdg ?7|electrif|mini-?grid/, decarbonization: /decarboni|climate mitigation|net zero|renewable/, restoration: /restor|reforest|nature-based/, water_resilience: /water/,
    biodiversity: /biodiversity|nature/, avoided_conversion: /deforest|conversion/, community_infrastructure: /community|social infrastructure/, food_systems: /food|agri/, adaptation: /adaptation|resilien/,
  };
  const hits = attributes.filter(a => KEYS[a.attribute]?.test(t));
  if (!mandateText.trim()) return { signal: "unknown" as const, matched: [] as string[] };
  if (!hits.length) return { signal: "outreach" as const, matched: [] as string[] };
  const evidenced = hits.filter(h => h.verification !== "unverified");
  return { signal: mandateVerified && evidenced.length ? ("verified" as const) : ("potential" as const), matched: hits.map(h => h.attribute) };
}
