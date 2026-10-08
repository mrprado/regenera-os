// Investment-readiness rubric (phase 22 §6), published in-app (/origination?tab=rubric). Sector templates choose which
// of the 14 readiness dimensions matter, their weight, which are critical, and what evidence is expected. Scoring per
// dimension: 0 not started / blocked · 1 early or in progress · 2 substantially ready · 3 ready, ONLY with evidence; a
// status without evidence is capped at 1; unknown is "insufficient data", never favourable. The overall reading is
// "insufficient evidence" when fewer than 60% of the template's dimensions are scored.
import { READINESS_DIMENSIONS } from "@/lib/projects/vocab";

type Dim = keyof typeof READINESS_DIMENSIONS;
export type SectorTemplate = { key: string; label: string; match: RegExp; dims: Partial<Record<Dim, { weight: number; critical?: boolean; evidence: string }>> };

export const TEMPLATES: SectorTemplate[] = [
  { key: "solar_bess", label: "Solar PV / BESS", match: /solar|pv|bess|battery|storage/i, dims: {
    land: { weight: 3, critical: true, evidence: "Lease / option / title over the full site" },
    grid: { weight: 3, critical: true, evidence: "Utility/TSO capacity confirmation, connection offer or queue position" },
    technical: { weight: 2, evidence: "Bankable resource assessment (P50/P90), layout" },
    permitting: { weight: 2, evidence: "Environmental licence, land-use and construction permits" },
    environmental: { weight: 2, evidence: "ESIA / screening to lender standards" },
    commercial: { weight: 3, critical: true, evidence: "PPA / offtake term sheet or merchant strategy" },
    financial: { weight: 2, evidence: "Financial model with sourced CAPEX/OPEX" },
    capital: { weight: 2, evidence: "Capital plan, sponsor equity, lender interest" },
    engineering: { weight: 1, evidence: "Preliminary design, EPC budget quote" },
    legal: { weight: 1, evidence: "SPV, corporate approvals, key contracts" } } },
  { key: "wind", label: "Wind", match: /wind/i, dims: {
    land: { weight: 3, critical: true, evidence: "Land rights incl. setbacks" }, grid: { weight: 3, critical: true, evidence: "Connection offer / capacity" },
    technical: { weight: 3, critical: true, evidence: "≥12 months on-site wind measurement" }, permitting: { weight: 2, evidence: "Permits incl. aviation, noise" },
    environmental: { weight: 2, evidence: "Bird/bat studies, ESIA" }, commercial: { weight: 3, evidence: "Offtake" }, financial: { weight: 2, evidence: "Model" }, capital: { weight: 2, evidence: "Capital plan" } } },
  { key: "waste", label: "Waste-to-energy / resource recovery", match: /waste|landfill|biogas|recycl|resource recovery|wte/i, dims: {
    technical: { weight: 3, critical: true, evidence: "Feedstock characterization (volume, composition, calorific value) and proven technology" },
    commercial: { weight: 3, critical: true, evidence: "Feedstock supply agreements, gate fees, energy / product offtake" },
    permitting: { weight: 2, evidence: "Waste and emissions permits" }, environmental: { weight: 2, evidence: "ESIA, emissions profile" },
    stakeholder: { weight: 2, evidence: "Municipal / community support" }, land: { weight: 1, evidence: "Site control" },
    financial: { weight: 2, evidence: "Model with gate-fee sensitivity" }, capital: { weight: 2, evidence: "Capital plan" } } },
  { key: "water", label: "Water / wastewater", match: /water|wastewater|sanitation|desal|irrigation/i, dims: {
    legal: { weight: 3, critical: true, evidence: "Concession / service contract, tariff framework" },
    technical: { weight: 2, evidence: "Demand study, design basis" }, commercial: { weight: 3, evidence: "Payment security, tariff collection history" },
    permitting: { weight: 2, evidence: "Abstraction / discharge permits" }, stakeholder: { weight: 2, evidence: "Public authority support" },
    financial: { weight: 2, evidence: "Model" }, capital: { weight: 2, evidence: "Capital plan, sovereign / sub-sovereign support" } } },
  { key: "nature", label: "Restoration / nature / regenerative agriculture", match: /restor|forest|carbon|biodivers|agri|regenerat|nature|mangrove/i, dims: {
    land: { weight: 3, critical: true, evidence: "Tenure and rights over the area" },
    stakeholder: { weight: 3, critical: true, evidence: "Community consent (FPIC where applicable), benefit-sharing" },
    environmental: { weight: 2, evidence: "Baseline (carbon / biodiversity / water)" }, commercial: { weight: 2, evidence: "Revenue model (credits, products, payments)" },
    legal: { weight: 2, evidence: "Rights to carbon / ecosystem service revenue" }, financial: { weight: 2, evidence: "Model" }, capital: { weight: 1, evidence: "Capital plan" } } },
  { key: "built", label: "Real estate / built environment", match: /real estate|hospitality|tourism|housing|urban|resort|master/i, dims: {
    land: { weight: 3, critical: true, evidence: "Title / control" }, permitting: { weight: 3, critical: true, evidence: "Zoning and building permits" },
    engineering: { weight: 2, evidence: "Design development" }, commercial: { weight: 2, evidence: "Market study, pre-sales / operator" },
    financial: { weight: 2, evidence: "Development appraisal" }, capital: { weight: 2, evidence: "Capital plan" }, environmental: { weight: 1, evidence: "Environmental screening" } } },
  { key: "general", label: "General infrastructure", match: /.*/, dims: {
    land: { weight: 2, critical: true, evidence: "Site control" }, technical: { weight: 2, evidence: "Feasibility" }, permitting: { weight: 2, evidence: "Permits" },
    commercial: { weight: 2, evidence: "Revenue / offtake" }, financial: { weight: 2, evidence: "Model" }, capital: { weight: 2, evidence: "Capital plan" } } },
];

/** Work package (services catalogue key) that closes a gap in each dimension. */
export const WORK_PACKAGE: Partial<Record<Dim, string>> = {
  land: "development_gap", grid: "site_intel_assess", technical: "prefeasibility", engineering: "owners_rep", environmental: "site_intel_assess",
  permitting: "permitting_coordination", commercial: "capital_strategy", financial: "financial_model", capital: "capital_strategy",
  legal: "diligence_coordination", stakeholder: "development_gap", procurement: "owners_rep",
};

const STATUS_SCORE: Record<string, number | null> = { unknown: null, not_started: 0, blocked: 0, early: 1, in_progress: 1, substantially_ready: 2, ready: 3, not_applicable: null };

export function templateFor(p: { technology?: string | null; assetClass?: string | null; name: string; sector?: string | null }) {
  const t = `${p.technology ?? ""} ${p.assetClass ?? ""} ${p.sector ?? ""} ${p.name}`;
  return TEMPLATES.find(x => x.key !== "general" && x.match.test(t)) ?? TEMPLATES.find(x => x.key === "general")!;
}

export type DimInput = { dimension: string; status: string; evidence: string; claims: number };
export type DimResult = { dimension: Dim; label: string; weight: number; critical: boolean; score: number | null; capped: boolean; evidenceExpected: string; note: string; workPackage: string | null };

/** Pure: score a project against its sector template. */
export function scoreReadiness(template: SectorTemplate, rows: DimInput[]) {
  const by = new Map(rows.map(r => [r.dimension, r]));
  const dims: DimResult[] = (Object.entries(template.dims) as [Dim, { weight: number; critical?: boolean; evidence: string }][]).map(([d, spec]) => {
    const r = by.get(d);
    const raw = r ? STATUS_SCORE[r.status] ?? null : null;
    const hasEvidence = !!r && (r.evidence.trim().length > 0 || r.claims > 0);
    const capped = raw !== null && raw > 1 && !hasEvidence;
    const score = raw === null ? null : capped ? 1 : raw;
    const note = raw === null ? "Insufficient data: status not assessed" : r?.status === "blocked" ? "Blocked" : capped ? "Status recorded without evidence: capped at 1" : hasEvidence ? "Evidence recorded" : "No evidence recorded";
    return { dimension: d, label: READINESS_DIMENSIONS[d], weight: spec.weight, critical: !!spec.critical, score, capped, evidenceExpected: spec.evidence, note, workPackage: score === null || score < 2 ? WORK_PACKAGE[d] ?? null : null };
  });
  const scored = dims.filter(d => d.score !== null);
  const coverage = dims.length ? scored.length / dims.length : 0;
  const weighted = scored.reduce((s, d) => s + d.score! * d.weight, 0) / Math.max(1, scored.reduce((s, d) => s + d.weight * 3, 0));
  const blocking = dims.filter(d => d.critical && (d.score === null || d.score === 0));
  const reading = coverage < 0.6 ? "insufficient_evidence" : blocking.length ? "blocked" : weighted >= 0.75 ? "investment_ready_candidate" : weighted >= 0.45 ? "advancing" : "early";
  return {
    template: template.key, templateLabel: template.label, dims, coverage, score: coverage < 0.6 ? null : Math.round(weighted * 100), reading,
    blocking: blocking.map(d => d.label),
    workPackages: [...new Set(dims.map(d => d.workPackage).filter((x): x is string => !!x))],
  };
}

export const READING_LABEL: Record<string, string> = {
  insufficient_evidence: "Insufficient evidence to score", blocked: "Blocked on a critical dimension", early: "Early",
  advancing: "Advancing", investment_ready_candidate: "Investment-ready candidate (verify in diligence)",
};
