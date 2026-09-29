// Deterministic annual project-finance calculation. Conventions (shown to users):
// - Annual periods. Construction years are t = 1…C (CAPEX spread evenly); operating years follow COD.
// - Nominal or real is the model's declared basis; escalation inputs must match it (the engine never mixes them).
// - CFADS = revenue − opex − tax (± working capital, not modelled). EBITDA is reported separately; never used as CFADS.
// - Debt: sculpted to a target DSCR, annuity, straight-line or bullet; sized by DSCR, gearing cap or fixed amount
//   (the lower of DSCR capacity and the gearing cap). IDC, upfront fees and DSRA are funded in uses; the circularity
//   (debt ↔ IDC/fees ↔ uses; interest ↔ tax ↔ CFADS) is solved by fixed-point iteration to < 1 currency unit.
// - IRR is annual (periodic) on end-of-year flows; NPV discounts to the start of construction.
// - Floating point: amounts are doubles; relative error ~1e-15 is immaterial to screening and underwriting outputs,
//   which are presented rounded. Sums use compensated addition.
import type { Certainty, ModelDefinition, ModelOutputs, PeriodRow } from "./types";

export const CONVENTIONS = "Annual periods; end-of-year cash flows; CFADS = revenue − opex − tax; debt sized at the lower of DSCR capacity and gearing cap; IDC, fees and DSRA funded in uses; circularity solved iteratively.";

function ksum(xs: number[]) { let s = 0, c = 0; for (const x of xs) { const y = x - c; const t = s + y; c = (t - s) - y; s = t; } return s; }

export function npv(ratePct: number, flows: number[]) { const r = ratePct / 100; return ksum(flows.map((v, t) => v / (1 + r) ** (t + 1))); }

/** IRR by bisection on [−99 %, 1000 %]; null when flows do not change sign or no root exists. */
export function irr(flows: number[]): number | null {
  if (!flows.some(v => v < 0) || !flows.some(v => v > 0)) return null;
  const f = (r: number) => ksum(flows.map((v, t) => v / (1 + r) ** (t + 1)));
  let lo = -0.99, hi = 10, flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid * 100;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return ((lo + hi) / 2) * 100;
}

const pFactor = (m: ModelDefinition) => (!m.generation ? 1 : m.generation.pCase === "P90" ? m.generation.p90Factor : m.generation.pCase === "P75" ? m.generation.p75Factor : 1);

/** Net generation (MWh) in operating year y (1-based). */
export function netGeneration(m: ModelDefinition, y: number) {
  const g = m.generation; if (!g) return 0;
  return g.capacityMw * 8760 * (g.capacityFactorPct / 100) * (g.availabilityPct / 100) * (1 - g.curtailmentPct / 100) * (1 - g.lossesPct / 100) * (1 - g.degradationPct / 100) ** (y - 1) * pFactor(m);
}

export function capexTotal(m: ModelDefinition) { return ksum(m.capex.map(l => l.quantity * l.unitCost * (1 + l.contingencyPct / 100))); }
export function devRemaining(m: ModelDefinition) { return ksum(m.development.map(l => Math.max(0, l.budget - l.spent))); }

/** Operating-year revenue by stream, respecting certainty (speculative excluded unless the model includes it). */
export function revenueFor(m: ModelDefinition, y: number) {
  const gen = netGeneration(m, y);
  const by: Record<Certainty, number> = { contracted: 0, forecast: 0, merchant: 0, speculative: 0 };
  for (const s of m.revenue) {
    if (s.certainty === "speculative" && !m.includeSpeculative) continue;
    if (y < s.startYear) continue;
    const k = y - s.startYear; // years since start
    const inTerm = s.termYears <= 0 || k < s.termYears;
    const price = inTerm ? s.price * (1 + s.escalationPct / 100) ** k : s.tailPrice * (1 + s.escalationPct / 100) ** k;
    if (!inTerm && !s.tailPrice) continue;
    const vol = s.basis === "energy" ? gen * (s.shareOfGeneration / 100) : s.annualVolume;
    by[inTerm ? s.certainty : "merchant"] += vol * price;
  }
  return { total: ksum(Object.values(by)), by, gen };
}

export function opexFor(m: ModelDefinition, y: number, revenue: number, gen: number) {
  return ksum(m.opex.map(o => {
    const esc = (1 + o.escalationPct / 100) ** (y - 1);
    return o.kind === "fixed" ? o.amount * esc : o.kind === "per_mwh" ? o.amount * gen * esc : (o.amount / 100) * revenue;
  }));
}

type DebtRun = { debt: number; schedule: { principal: number; interest: number; service: number; opening: number; closing: number }[] };

/** Debt schedule over operating years for a given amount (annual, end-of-period). */
function schedule(amount: number, rate: number, tenor: number, profile: string, cfads: number[], targetDscr: number): DebtRun {
  const out: DebtRun["schedule"] = []; let bal = amount;
  const annuity = rate > 0 ? (amount * rate) / (1 - (1 + rate) ** -tenor) : amount / tenor;
  // Sculpted: principal follows CFADS/DSCR − interest, scaled so the balance repays exactly within the tenor.
  let sculptScale = 1;
  if (profile === "sculpted") {
    const pv = ksum(cfads.slice(0, tenor).map((c, t) => (Math.max(0, c) / targetDscr) / (1 + rate) ** (t + 1)));
    sculptScale = pv > 0 ? amount / pv : 0;
  }
  for (let t = 0; t < cfads.length; t++) {
    const opening = bal, interest = bal * rate;
    let service = 0;
    if (t < tenor && bal > 1e-6) {
      if (profile === "sculpted") service = (Math.max(0, cfads[t]) / targetDscr) * sculptScale;
      else if (profile === "annuity") service = annuity;
      else if (profile === "straight") service = amount / tenor + interest;
      else service = t === tenor - 1 ? bal + interest : interest; // bullet
      if (t === tenor - 1) service = bal + interest;              // clears rounding on the final period
    }
    const principal = Math.min(bal, Math.max(0, service - interest));
    bal -= principal;
    out.push({ principal, interest: t < tenor || bal > 1e-6 ? interest : 0, service: principal + (opening > 1e-6 ? interest : 0), opening, closing: bal });
  }
  return { debt: amount, schedule: out };
}

/** Full calculation with circularity iteration. */
export function calculate(m: ModelDefinition): ModelOutputs {
  const C = Math.max(1, Math.ceil((m.constructionMonths + m.codDelayMonths) / 12));
  const N = Math.max(1, Math.round(m.operatingYears));
  const capex = capexTotal(m), dev = devRemaining(m);
  const grants = ksum(m.grants.map(g => g.amount));
  const ops = Array.from({ length: N }, (_, i) => { const r = revenueFor(m, i + 1); const opex = opexFor(m, i + 1, r.total, r.gen); return { ...r, opex, ebitda: r.total - opex }; });
  const depYears = Math.max(1, m.tax.depreciationYears);
  const t = m.debt;
  const rate = t ? t.ratePct / 100 : 0;

  let debt = 0, idc = 0, fees = 0, dsra = 0, taxes = new Array(N).fill(0), iterations = 0, converged = false, sizedBy = t ? "" : "none";
  let run: DebtRun = { debt: 0, schedule: [] };
  for (iterations = 1; iterations <= 100; iterations++) {
    const totalUses0 = capex + dev + idc + fees + dsra;
    const cfads = ops.map((o, i) => o.ebitda - taxes[i]);
    let target = 0;
    if (t && (t.tenorYears <= 0 || (t.sizing === "dscr" && t.targetDscr <= 0) || (t.sizing === "gearing" && t.maxGearingPct <= 0))) { sizedBy = "terms missing"; }
    else if (t) {
      const tenor = Math.min(t.tenorYears, N);
      if (t.sizing === "amount") { target = t.amount; sizedBy = "fixed amount"; }
      else {
        const dscrCap = ksum(cfads.slice(0, tenor).map((c, i) => (Math.max(0, c) / t.targetDscr) / (1 + rate) ** (i + 1)));
        const gearCap = (t.maxGearingPct / 100) * totalUses0;
        if (t.sizing === "gearing") { target = gearCap; sizedBy = "gearing cap"; }
        else { target = Math.min(dscrCap, gearCap); sizedBy = dscrCap <= gearCap ? `DSCR ${t.targetDscr.toFixed(2)}x` : `gearing cap ${t.maxGearingPct}%`; }
      }
      target = Math.max(0, target);
      run = schedule(target, rate, tenor, t.profile, cfads, t.targetDscr);
      // Profiles other than sculpted: shrink until the minimum DSCR meets the target (DSCR sizing only).
      if (t.sizing === "dscr" && t.profile !== "sculpted") {
        for (let k = 0; k < 60; k++) {
          const dscrs = run.schedule.map((p, i) => (p.service > 0 ? cfads[i] / p.service : Infinity));
          if (Math.min(...dscrs) >= t.targetDscr - 1e-9) break;
          target *= 0.97; run = schedule(target, rate, tenor, t.profile, cfads, t.targetDscr);
        }
      }
    }
    // IDC: debt drawn pro rata with CAPEX over construction; interest on the average balance, capitalised.
    const newIdc = t ? ksum(Array.from({ length: C }, (_, k) => (target * ((k + 0.5) / C)) * rate)) : 0;
    const newFees = t ? target * (t.upfrontFeePct / 100) : 0;
    const newDsra = t && run.schedule[0] ? run.schedule[0].service * (t.dsraMonths / 12) : 0;
    // Tax with interest shield (when deductible), straight-line depreciation and loss carry-forward.
    const newTaxes: number[] = []; let losses = 0;
    for (let i = 0; i < N; i++) {
      const dep = i < depYears ? (capex + idc + fees) / depYears : 0;
      const interest = t && m.tax.interestDeductible ? run.schedule[i]?.interest ?? 0 : 0;
      let taxable = ops[i].ebitda - dep - interest;
      if (m.tax.lossCarryforward) { if (taxable < 0) { losses -= taxable; taxable = 0; } else { const use = Math.min(losses, taxable); taxable -= use; losses -= use; } }
      newTaxes.push(Math.max(0, taxable) * (m.tax.ratePct / 100));
    }
    const delta = Math.abs(target - debt) + Math.abs(newIdc - idc) + Math.abs(newFees - fees) + Math.abs(newDsra - dsra) + ksum(newTaxes.map((x, i) => Math.abs(x - taxes[i])));
    debt = target; idc = newIdc; fees = newFees; dsra = newDsra; taxes = newTaxes;
    if (delta < 1) { converged = true; break; }
  }

  const usesTotal = capex + dev + idc + fees + dsra;
  const equity = Math.max(0, usesTotal - debt - grants);
  const cfads = ops.map((o, i) => o.ebitda - taxes[i]);
  const periods: PeriodRow[] = [];
  const empty = { contracted: 0, forecast: 0, merchant: 0, speculative: 0 };
  // Construction: CAPEX, development and financing costs, funded pro rata (debt and equity in proportion, grants first).
  for (let k = 0; k < C; k++) {
    const share = 1 / C, uses = usesTotal * share, grantsK = grants * share, debtK = debt * share;
    periods.push({ year: k + 1, phase: "construction", capex: (capex + dev) * share, revenue: 0, revenueByCertainty: { ...empty }, generationMwh: 0, opex: 0, ebitda: 0, depreciation: 0, interest: idc * share,
      taxableIncome: 0, tax: 0, cfads: 0, debtDraw: debtK, debtOpening: debt * (k / C), principal: 0, debtService: 0, debtClosing: debt * ((k + 1) / C), dscr: null, dsraFlow: k === C - 1 ? -dsra : 0,
      distributions: 0, lockedUp: false, equityFlow: -(uses - debtK - grantsK), projectFlow: -((capex + dev) * share) });
  }
  let dsraBal = dsra, losses = 0;
  for (let i = 0; i < N; i++) {
    const s = run.schedule[i] ?? { principal: 0, interest: 0, service: 0, opening: 0, closing: 0 };
    const dscr = s.service > 1e-6 ? cfads[i] / s.service : null;
    const lock = t ? dscr !== null && dscr < t.lockupDscr : false;
    let cash = cfads[i] - s.service;
    // DSRA: released at the end of the tenor; drawn to cover shortfalls.
    let dsraFlow = 0;
    if (cash < 0 && dsraBal > 0) { const use = Math.min(dsraBal, -cash); dsraBal -= use; cash += use; dsraFlow = use; }
    if (t && i === Math.min(t.tenorYears, N) - 1 && dsraBal > 0) { cash += dsraBal; dsraFlow += dsraBal; dsraBal = 0; }
    const last = i === N - 1;
    const terminal = last ? m.residualValue - m.decommissioning : 0;
    const dist = lock ? 0 : Math.max(0, cash) + (last ? terminal : 0);
    const dep = i < depYears ? (capex + idc + fees) / depYears : 0;
    let taxable = ops[i].ebitda - dep - (m.tax.interestDeductible ? s.interest : 0);
    if (m.tax.lossCarryforward) { if (taxable < 0) { losses -= taxable; taxable = 0; } else { const use = Math.min(losses, taxable); taxable -= use; losses -= use; } }
    periods.push({ year: C + i + 1, phase: "operations", capex: 0, revenue: ops[i].total, revenueByCertainty: ops[i].by, generationMwh: ops[i].gen, opex: ops[i].opex, ebitda: ops[i].ebitda, depreciation: dep,
      interest: s.interest, taxableIncome: Math.max(0, taxable), tax: taxes[i], cfads: cfads[i], debtDraw: 0, debtOpening: s.opening, principal: s.principal, debtService: s.service, debtClosing: s.closing,
      dscr, dsraFlow, distributions: dist, lockedUp: lock, equityFlow: dist, projectFlow: 0 });
  }
  // Project (unlevered, post-tax without interest shield) flows.
  const unleveredTax: number[] = []; let l2 = 0;
  for (let i = 0; i < N; i++) {
    const dep = i < depYears ? capex / depYears : 0;
    let taxable = ops[i].ebitda - dep;
    if (m.tax.lossCarryforward) { if (taxable < 0) { l2 -= taxable; taxable = 0; } else { const use = Math.min(l2, taxable); taxable -= use; l2 -= use; } }
    unleveredTax.push(Math.max(0, taxable) * (m.tax.ratePct / 100));
  }
  const projectFlows = [...periods.slice(0, C).map(p => p.projectFlow), ...ops.map((o, i) => o.ebitda - unleveredTax[i] + (i === N - 1 ? m.residualValue - m.decommissioning : 0))];
  periods.slice(C).forEach((p, i) => { p.projectFlow = projectFlows[C + i]; });
  const equityFlows = periods.map(p => p.equityFlow);
  const dscrs = periods.map(p => p.dscr).filter((d): d is number => d !== null);
  const tenor = t ? Math.min(t.tenorYears, N) : 0;
  const llcr = t && debt > 0 ? npv(t.ratePct, cfads.slice(0, tenor)) / debt : null;
  const plcr = t && debt > 0 ? npv(t.ratePct, cfads) / debt : null;
  let cum = 0, payback: number | null = null;
  for (let i = 0; i < equityFlows.length; i++) { const prev = cum; cum += equityFlows[i]; if (prev < 0 && cum >= 0 && payback === null) payback = i + (equityFlows[i] ? -prev / equityFlows[i] : 0); }
  const invested = -ksum(equityFlows.filter(v => v < 0)), returned = ksum(equityFlows.filter(v => v > 0));
  return {
    periods, uses: { capex, development: dev, idc, fees, dsra, total: usesTotal }, sources: { debt, grants, equity, total: debt + grants + equity },
    debt, debtSizedBy: sizedBy, minDscr: dscrs.length ? Math.min(...dscrs) : null, avgDscr: dscrs.length ? ksum(dscrs) / dscrs.length : null, llcr, plcr,
    projectIrr: irr(projectFlows), equityIrr: irr(equityFlows), projectNpv: npv(m.discountRatePct, projectFlows), equityNpv: npv(m.equityHurdlePct, equityFlows),
    moic: invested > 0 ? returned / invested : null, paybackYears: payback, capexPerMw: m.generation?.capacityMw ? capex / m.generation.capacityMw : null,
    ebitdaYear1: ops[0]?.ebitda ?? 0, revenueYear1: ops[0]?.total ?? 0, iterations, converged,
  };
}
