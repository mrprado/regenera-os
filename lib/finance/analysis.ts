// Analyses over a model definition: sensitivities (one- and two-way, ranked tornado), stress cases, breakevens,
// model health, version diff with return attribution, value bridge, and starter templates. All derived from the
// same deterministic calculation; scenarios are copies with explicit changes, never silent edits.
import { calculate, capexTotal, revenueFor } from "./calc";
import type { ModelDefinition, ModelOutputs, Provenance, RevenueClass } from "./types";

const clone = (m: ModelDefinition): ModelDefinition => JSON.parse(JSON.stringify(m));
export type Driver = { key: string; label: string; apply: (m: ModelDefinition, f: number) => void };

/** Multiplicative drivers (f = 1.1 means +10 %). */
export const DRIVERS: Driver[] = [
  { key: "price", label: "Contracted and merchant price", apply: (m, f) => m.revenue.forEach(s => { if (s.certainty !== "speculative") { s.price *= f; s.tailPrice *= f; } }) },
  { key: "capex", label: "CAPEX", apply: (m, f) => m.capex.forEach(l => { l.unitCost *= f; }) },
  { key: "yield", label: "Generation / volume", apply: (m, f) => { if (m.generation) m.generation.capacityFactorPct *= f; m.revenue.forEach(s => { if (s.basis === "fixed") s.annualVolume *= f; }); } },
  { key: "opex", label: "OPEX", apply: (m, f) => m.opex.forEach(o => { o.amount *= f; }) },
  { key: "rate", label: "Debt interest rate", apply: (m, f) => { if (m.debt) m.debt.ratePct *= f; } },
  { key: "tax", label: "Tax rate", apply: (m, f) => { m.tax.ratePct *= f; } },
];

export type Metric = "equityIrr" | "projectIrr" | "minDscr" | "debt" | "equityNpv";
const metric = (o: ModelOutputs, k: Metric) => o[k];

export function oneWay(m: ModelDefinition, pct = 10, drivers = DRIVERS) {
  const base = calculate(m);
  const rows = drivers.map(d => {
    const lo = clone(m); d.apply(lo, 1 - pct / 100); const hi = clone(m); d.apply(hi, 1 + pct / 100);
    const L = calculate(lo), H = calculate(hi);
    return { key: d.key, label: d.label, low: { equityIrr: L.equityIrr, minDscr: L.minDscr, debt: L.debt, equityNpv: L.equityNpv }, high: { equityIrr: H.equityIrr, minDscr: H.minDscr, debt: H.debt, equityNpv: H.equityNpv },
      swing: Math.abs((H.equityIrr ?? 0) - (L.equityIrr ?? 0)) };
  }).sort((a, b) => b.swing - a.swing);
  return { base: { equityIrr: base.equityIrr, minDscr: base.minDscr, debt: base.debt, equityNpv: base.equityNpv }, pct, rows };
}

export function twoWay(m: ModelDefinition, a: string, b: string, steps = [-20, -10, 0, 10, 20], out: Metric = "equityIrr") {
  const da = DRIVERS.find(d => d.key === a)!, db = DRIVERS.find(d => d.key === b)!;
  return { a: da.label, b: db.label, steps, grid: steps.map(sa => steps.map(sb => { const x = clone(m); da.apply(x, 1 + sa / 100); db.apply(x, 1 + sb / 100); return metric(calculate(x), out); })) };
}

export type StressCase = { key: string; label: string; apply: (m: ModelDefinition) => void };
export const STRESS: StressCase[] = [
  { key: "capex15", label: "Construction cost +15 %", apply: m => m.capex.forEach(l => { l.unitCost *= 1.15; }) },
  { key: "delay12", label: "12-month delay", apply: m => { m.codDelayMonths += 12; } },
  { key: "rev20", label: "Revenue −20 %", apply: m => m.revenue.forEach(s => { s.price *= 0.8; s.tailPrice *= 0.8; }) },
  { key: "rate300", label: "Interest +300 bps", apply: m => { if (m.debt) m.debt.ratePct += 3; } },
  { key: "curtail15", label: "Curtailment +15 points", apply: m => { if (m.generation) m.generation.curtailmentPct = Math.min(100, m.generation.curtailmentPct + 15); } },
  { key: "p90", label: "P90 generation", apply: m => { if (m.generation) m.generation.pCase = "P90"; } },
  { key: "nocarbon", label: "Environmental revenue = 0", apply: m => { m.revenue = m.revenue.filter(s => !/carbon|biodiversity|water|credit|rec/i.test(`${s.type} ${s.label}`)); } },
];

export function stressCases(m: ModelDefinition) {
  return STRESS.map(s => {
    const x = clone(m); s.apply(x); const o = calculate(x);
    const debtServiced = o.periods.filter(p => p.phase === "operations" && p.debtService > 0).every(p => p.cfads + p.dsraFlow >= p.debtService - 1);
    return { key: s.key, label: s.label, equityIrr: o.equityIrr, minDscr: o.minDscr, debt: o.debt, debtServiced, covenantBreach: m.debt ? (o.minDscr ?? Infinity) < m.debt.lockupDscr : false, equityPositive: (o.equityIrr ?? -100) > 0 };
  });
}

/** Scalar on a driver at which a metric crosses a threshold (bisection over 0.05×–5×); null when out of range. */
export function breakeven(m: ModelDefinition, driver: string, target: { metric: Metric; value: number }) {
  const d = DRIVERS.find(x => x.key === driver)!;
  const f = (s: number) => { const x = clone(m); d.apply(x, s); return (metric(calculate(x), target.metric) ?? -1e9) - target.value; };
  let lo = 0.05, hi = 5, flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (Math.abs(fm) < 1e-6) return mid; if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}

/** Revenue by class in one operating year (streams without a class count as primary operating revenue). */
export function revenueMix(m: ModelDefinition, year: number) {
  const byClass: Record<RevenueClass, number> = { primary_operating: 0, contracted_environmental: 0, variable_environmental: 0 };
  for (const s of m.revenue) {
    const v = revenueFor({ ...m, revenue: [s] }, year).total;
    byClass[s.revenueClass ?? "primary_operating"] += v;
  }
  const total = byClass.primary_operating + byClass.contracted_environmental + byClass.variable_environmental;
  return { year, byClass, total, environmentalPct: total ? Math.round(((byClass.contracted_environmental + byClass.variable_environmental) / total) * 100) : 0 };
}

export type HealthIssue = { level: "error" | "review"; code: string; message: string };
export function modelHealth(m: ModelDefinition, o: ModelOutputs = calculate(m)): { status: "PASS" | "REVIEW" | "ERROR"; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  const add = (level: HealthIssue["level"], code: string, message: string) => issues.push({ level, code, message });
  if (Math.abs(o.sources.total - o.uses.total) > 1) add("error", "sources_uses", `Sources ${o.sources.total.toFixed(0)} ≠ uses ${o.uses.total.toFixed(0)}`);
  if (o.debt < 0) add("error", "negative_debt", "Negative debt");
  if (!o.converged) add("error", "circularity", "Financing circularity did not converge");
  if (!m.capex.length || capexTotal(m) <= 0) add("error", "no_capex", "No CAPEX lines");
  if (!m.revenue.length) add("error", "no_revenue", "No revenue streams");
  if (m.includeSpeculative) add("review", "speculative_included", "Speculative revenue is included: not acceptable in a base case");
  if (m.debt && (m.debt.tenorYears <= 0 || (m.debt.sizing === "dscr" && m.debt.targetDscr <= 0) || (m.debt.sizing === "gearing" && m.debt.maxGearingPct <= 0) || m.debt.ratePct <= 0)) add("error", "debt_terms_missing", "Debt terms missing (tenor, rate, target DSCR or gearing): debt is not sized");
  if (m.debt && m.debt.tenorYears > m.operatingYears) add("error", "debt_beyond_life", "Debt tenor exceeds the operating life");
  if (m.debt && m.debt.currency && m.revenue.some(s => s.certainty !== "speculative") && m.debt.currency !== m.currency) add("review", "fx_mismatch", `Debt in ${m.debt.currency}, model and revenue in ${m.currency}: FX exposure`);
  const placeholders = [...m.capex, ...m.opex, ...m.revenue, ...m.development].filter(x => x.status === "placeholder");
  if (placeholders.length) add("review", "placeholders", `${placeholders.length} placeholder assumption(s): resolve before investment readiness`);
  const unsourced = [...m.capex, ...m.opex, ...m.revenue].filter(x => !x.source && x.status !== "placeholder");
  if (unsourced.length) add("review", "unsourced", `${unsourced.length} assumption(s) without a source`);
  if (m.generation) {
    const contractedShare = m.revenue.filter(s => s.basis === "energy").reduce((a, s) => a + s.shareOfGeneration, 0);
    if (contractedShare > 100.001) add("error", "volume_over_generation", `Revenue streams sell ${contractedShare.toFixed(0)} % of generation`);
    if (m.generation.capacityFactorPct > 70) add("review", "capacity_factor", `Capacity factor ${m.generation.capacityFactorPct}% is unusually high`);
  }
  if (m.revenue.some(s => s.startYear < 1)) add("error", "revenue_before_cod", "Revenue starts before COD");
  const mix = revenueMix(m, Math.min(3, Math.max(1, m.operatingYears)));
  if (mix.total > 0 && mix.environmentalPct > 50) add("review", "environmental_dependence", `Environmental attributes are ${mix.environmentalPct}% of year-${mix.year} revenue: confirm the project is viable on primary operating revenue`);
  if (o.periods.some(p => p.phase === "operations" && p.dscr !== null && p.dscr < 1)) add("review", "dscr_below_1", "DSCR below 1.00x in at least one year (DSRA may be drawn)");
  return { status: issues.some(i => i.level === "error") ? "ERROR" : issues.length ? "REVIEW" : "PASS", issues };
}

/** Changed inputs between two definitions (flat key → value) and the equity-IRR contribution of each group. */
export function diffModels(a: ModelDefinition, b: ModelDefinition) {
  const flat = (x: unknown, p = ""): Record<string, unknown> => {
    if (x === null || typeof x !== "object") return { [p]: x };
    if (Array.isArray(x)) return Object.assign({}, ...x.map((v, i) => flat(v, `${p}[${(v as { id?: string })?.id ?? i}]`)));
    return Object.assign({}, ...Object.entries(x).map(([k, v]) => flat(v, p ? `${p}.${k}` : k)));
  };
  const fa = flat(a), fb = flat(b);
  const changes = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(k => JSON.stringify(fa[k]) !== JSON.stringify(fb[k]) && !/\.(source|date|owner|comment|confidence|status|evidenceId)$/.test(k)).map(k => ({ key: k, from: fa[k], to: fb[k] }));
  // Attribution: apply each top-level block of b onto a in order; the IRR delta at each step.
  const blocks: (keyof ModelDefinition)[] = ["capex", "development", "opex", "revenue", "generation", "debt", "tax", "grants", "constructionMonths", "codDelayMonths", "operatingYears", "residualValue", "decommissioning", "includeSpeculative"];
  const cur = clone(a); let prev = calculate(cur).equityIrr;
  const attribution: { block: string; delta: number | null }[] = [];
  for (const k of blocks) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    (cur as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(b[k]));
    const now = calculate(cur).equityIrr;
    attribution.push({ block: k, delta: now !== null && prev !== null ? now - prev : null }); prev = now;
  }
  return { changes, attribution, from: calculate(a).equityIrr, to: calculate(b).equityIrr };
}

/** Value by development stage from user-entered stage discount rates (equity flows re-discounted; remaining dev cost is inside uses). */
export function valueBridge(m: ModelDefinition, o: ModelOutputs = calculate(m)) {
  const flows = o.periods.map(p => p.equityFlow);
  return m.stageDiscountRates.map(s => ({ stage: s.stage, ratePct: s.ratePct, value: flows.reduce((a, v, t) => a + v / (1 + s.ratePct / 100) ** (t + 1), 0) }))
    .map((row, i, arr) => ({ ...row, uplift: i ? row.value - arr[i - 1].value : null }));
}

// ---------- templates (structure only; every value is a labelled PLACEHOLDER until the user enters a sourced value) ----------
const ph = (comment: string): Provenance => ({ source: "", date: null, owner: null, confidence: "low", status: "placeholder", comment });
const id = (p: string, i: number) => `${p}${i}`;
export const TEMPLATES = {
  utility_solar: "Utility solar",
  solar_storage: "Solar + storage",
  generic_pf: "Generic project finance",
  restoration: "Restoration / natural capital",
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

export function template(key: TemplateKey, currency: string): ModelDefinition {
  const base: ModelDefinition = {
    currency, basis: "nominal", constructionMonths: 12, operatingYears: 25, codDelayMonths: 0, capex: [], development: [], opex: [], revenue: [], generation: null, debt: null, grants: [],
    tax: { ratePct: 0, depreciationYears: 20, lossCarryforward: true, interestDeductible: true, ...ph("Jurisdiction tax rate and depreciation: confirm with a tax adviser") },
    discountRatePct: 0, equityHurdlePct: 0, residualValue: 0, decommissioning: 0, includeSpeculative: false, stageDiscountRates: [],
  };
  const debt = { name: "Senior debt", sizing: "dscr" as const, targetDscr: 0, maxGearingPct: 0, amount: 0, ratePct: 0, tenorYears: 0, profile: "sculpted" as const, upfrontFeePct: 0, dsraMonths: 6, lockupDscr: 0, currency, ...ph("Lender terms: indicative term sheet required") };
  if (key === "utility_solar" || key === "solar_storage") {
    base.generation = { capacityMw: 0, capacityFactorPct: 0, availabilityPct: 99, degradationPct: 0.5, curtailmentPct: 0, lossesPct: 2, pCase: "P50", p75Factor: 0.96, p90Factor: 0.93, ...ph("Energy yield assessment (P50/P90) required; availability, losses and P-factors are template defaults to replace") };
    base.capex = ["Modules", "Inverters", "Trackers / structures", "BOS electrical", "Civil and site preparation", "Access roads", "Substation", "Interconnection / transmission", "EPC margin", "Owner's costs"].map((l, i) => ({ id: id("c", i), category: i < 4 ? "equipment" : i < 6 ? "civil" : i < 8 ? "grid" : "other", label: l, quantity: 0, unit: /Access roads|Interconnection/.test(l) ? "km" : "lot", unitCost: 0, contingencyPct: 5, ...ph("Quote or benchmark required") }));
    if (key === "solar_storage") base.capex.push({ id: "c_bess", category: "equipment", label: "Battery storage (MWh)", quantity: 0, unit: "MWh", unitCost: 0, contingencyPct: 5, ...ph("BESS quote required") });
    base.revenue = [{ id: "r0", label: "PPA", type: "ppa", certainty: "forecast", basis: "energy", annualVolume: 0, unit: "MWh", price: 0, escalationPct: 0, startYear: 1, termYears: 15, tailPrice: 0, shareOfGeneration: 100, ...ph("PPA term sheet required; status becomes contracted only when signed") }];
    base.opex = [{ id: "o0", label: "O&M", kind: "fixed", amount: 0, escalationPct: 2, ...ph("O&M quote") }, { id: "o1", label: "Land lease", kind: "fixed", amount: 0, escalationPct: 2, ...ph("Lease terms") }, { id: "o2", label: "Insurance", kind: "fixed", amount: 0, escalationPct: 2, ...ph("Broker indication") }, { id: "o3", label: "Asset management", kind: "fixed", amount: 0, escalationPct: 2, ...ph("") }];
    base.debt = debt;
  } else if (key === "generic_pf") {
    base.capex = [{ id: "c0", category: "equipment", label: "Equipment", quantity: 1, unit: "lot", unitCost: 0, contingencyPct: 5, ...ph("") }, { id: "c1", category: "civil", label: "Civil works", quantity: 1, unit: "lot", unitCost: 0, contingencyPct: 10, ...ph("") }];
    base.revenue = [{ id: "r0", label: "Offtake", type: "offtake", certainty: "forecast", basis: "fixed", annualVolume: 0, unit: "units", price: 0, escalationPct: 0, startYear: 1, termYears: 10, tailPrice: 0, shareOfGeneration: 0, ...ph("") }];
    base.opex = [{ id: "o0", label: "Operations", kind: "fixed", amount: 0, escalationPct: 2, ...ph("") }];
    base.debt = debt;
  } else {
    base.capex = [{ id: "c0", category: "restoration", label: "Restoration works", quantity: 0, unit: "ha", unitCost: 0, contingencyPct: 10, ...ph("From the Atlas restoration area × unit cost") }, { id: "c1", category: "monitoring", label: "Baseline and MRV setup", quantity: 1, unit: "lot", unitCost: 0, contingencyPct: 0, ...ph("") }];
    base.revenue = [{ id: "r0", label: "Carbon credits (net of buffer)", type: "carbon", certainty: "speculative", basis: "fixed", annualVolume: 0, unit: "tCO2e", price: 0, escalationPct: 0, startYear: 3, termYears: 0, tailPrice: 0, shareOfGeneration: 0, ...ph("Speculative until methodology, eligibility and offtake are established") }];
    base.opex = [{ id: "o0", label: "Monitoring and verification", kind: "fixed", amount: 0, escalationPct: 2, ...ph("") }];
    base.operatingYears = 30;
  }
  return base;
}
