// Screening economics (docs/master-spec.md XXII): annual cash flows, sculpted debt sizing, project and equity IRR, NPV,
// DSCR, LLCR, payback; downside/upside scenarios and a sensitivity table. Pure functions, no I/O.
import type { CaseInputs, CaseOutputs, CaseYear } from "./vocab";

const pct = (x: number) => (Number.isFinite(x) ? x : 0) / 100;

/** Net present value of flows at fractional times (years). */
export function npvAt(rate: number, flows: { t: number; v: number }[]) {
  return flows.reduce((s, f) => s + f.v / Math.pow(1 + rate, f.t), 0);
}

/** IRR by bisection; null when the flows never change sign or no root exists in (-95%, 500%). */
export function irr(flows: { t: number; v: number }[]): number | null {
  if (!flows.some(f => f.v < 0) || !flows.some(f => f.v > 0)) return null;
  let lo = -0.95, hi = 5;
  let flo = npvAt(lo, flows), fhi = npvAt(hi, flows);
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npvAt(mid, flows);
    if (Math.abs(fm) < 1e-7) return mid;
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  return (lo + hi) / 2;
}

export function runCase(i: CaseInputs): CaseOutputs {
  const notes: string[] = [];
  const life = Math.max(1, Math.round(i.lifeYears));
  const c = Math.max(0, i.constructionMonths + i.codDelayMonths) / 12; // years from financial close to COD
  const dep = i.capex / life;
  const years: CaseYear[] = [];
  for (let t = 1; t <= life; t++) {
    const decay = Math.pow(1 - pct(i.degradationPct), t - 1);
    const revenue = i.revenueYear1 * pct(i.yieldPct) * (1 - pct(i.fxShockPct)) * Math.pow(1 + pct(i.revenueEscalationPct), t - 1) * decay
      + i.carbonTonnes * i.carbonPrice * decay;
    const opex = i.opexYear1 * Math.pow(1 + pct(i.opexEscalationPct), t - 1);
    const ebitda = revenue - opex;
    const tax = Math.max(0, (ebitda - dep) * pct(i.taxRatePct));
    years.push({ year: t, revenue, opex, ebitda, tax, cfads: ebitda - tax, debtService: 0, dscr: null });
  }

  // Debt: sculpt debt service to CFADS / target DSCR over the tenor, capped by gearing.
  const r = pct(i.interestRatePct), n = Math.min(life, Math.max(0, Math.round(i.debtTenorYears)));
  const sculpted = years.slice(0, n).map(y => (i.targetDscr > 0 ? Math.max(0, y.cfads) / i.targetDscr : 0));
  const dscrCapacity = sculpted.reduce((s, ds, k) => s + ds / Math.pow(1 + r, k + 1), 0);
  const gearingCap = Math.max(0, pct(i.gearingPct) * i.capex);
  let debt = Math.min(dscrCapacity, gearingCap);
  const debtSizedBy = debt <= 0 ? "none" : dscrCapacity <= gearingCap ? "dscr" : "gearing";
  if (debt > 0) {
    const scale = debt / dscrCapacity;
    sculpted.forEach((ds, k) => { years[k].debtService = ds * scale; years[k].dscr = years[k].debtService > 0 ? years[k].cfads / years[k].debtService : null; });
  } else debt = 0;
  if (years.slice(0, n).some(y => y.cfads <= 0) && debt > 0) notes.push("Some debt years have no positive CFADS; debt service is zero in those years.");

  const dscrs = years.map(y => y.dscr).filter((x): x is number => x !== null);
  const llcr = debt > 0 ? years.slice(0, n).reduce((s, y, k) => s + y.cfads / Math.pow(1 + r, k + 1), 0) / debt : null;
  const equity = i.capex - debt;
  const projectFlows = [{ t: 0, v: -i.capex }, ...years.map(y => ({ t: c + y.year, v: y.cfads }))];
  const equityFlows = [{ t: 0, v: -equity }, ...years.map(y => ({ t: c + y.year, v: y.cfads - y.debtService }))];

  let cum = -i.capex, paybackYears: number | null = null;
  for (const y of years) {
    if (cum + y.cfads >= 0 && y.cfads > 0) { paybackYears = c + y.year - 1 + (-cum / y.cfads); break; }
    cum += y.cfads;
  }
  if (years[0] && years[0].ebitda <= 0) notes.push("Year-1 EBITDA is not positive.");
  if (i.codDelayMonths > 0) notes.push(`COD delayed ${i.codDelayMonths} months: revenue starts later; delay costs and IDC are not modelled.`);

  return {
    projectIrr: irr(projectFlows), equityIrr: equity > 0 ? irr(equityFlows) : null, npv: npvAt(pct(i.discountRatePct), projectFlows),
    minDscr: dscrs.length ? Math.min(...dscrs) : null, avgDscr: dscrs.length ? dscrs.reduce((a, b) => a + b, 0) / dscrs.length : null,
    llcr, paybackYears, debt, equity, debtSizedBy, ebitdaYear1: years[0]?.ebitda ?? 0, years, notes,
  };
}

type Shock = { label: string; apply: (i: CaseInputs) => Partial<CaseInputs> };

/** Preset scenario shocks (documented, not hidden): downside and upside relative to a base case. */
export const SCENARIOS: Record<"downside" | "upside", { label: string; shocks: string[]; apply: (i: CaseInputs) => CaseInputs }> = {
  downside: {
    label: "Downside",
    shocks: ["CAPEX +15%", "COD +6 months", "Interest +1.5 pp", "Yield −10%", "OPEX +10%"],
    apply: i => ({ ...i, capex: i.capex * 1.15, codDelayMonths: i.codDelayMonths + 6, interestRatePct: i.interestRatePct + 1.5, yieldPct: i.yieldPct * 0.9, opexYear1: i.opexYear1 * 1.1 }),
  },
  upside: {
    label: "Upside",
    shocks: ["CAPEX −5%", "Yield +5%", "Interest −0.5 pp"],
    apply: i => ({ ...i, capex: i.capex * 0.95, yieldPct: i.yieldPct * 1.05, interestRatePct: Math.max(0, i.interestRatePct - 0.5) }),
  },
};

/** The spec's sensitivity variables: CAPEX, COD delay, interest, FX, yield, revenue, material cost, carbon price, OPEX. */
export const SENSITIVITIES: { key: string; low: Shock; high: Shock }[] = [
  { key: "CAPEX", low: { label: "−10%", apply: i => ({ capex: i.capex * 0.9 }) }, high: { label: "+10%", apply: i => ({ capex: i.capex * 1.1 }) } },
  { key: "COD delay", low: { label: "none", apply: () => ({}) }, high: { label: "+12 months", apply: i => ({ codDelayMonths: i.codDelayMonths + 12 }) } },
  { key: "Interest rate", low: { label: "−1 pp", apply: i => ({ interestRatePct: Math.max(0, i.interestRatePct - 1) }) }, high: { label: "+1 pp", apply: i => ({ interestRatePct: i.interestRatePct + 1 }) } },
  { key: "FX", low: { label: "none", apply: () => ({}) }, high: { label: "−20% revenue value", apply: i => ({ fxShockPct: Math.min(100, i.fxShockPct + 20) }) } },
  { key: "Yield / resource", low: { label: "−10%", apply: i => ({ yieldPct: i.yieldPct * 0.9 }) }, high: { label: "+10%", apply: i => ({ yieldPct: i.yieldPct * 1.1 }) } },
  { key: "Revenue price", low: { label: "−10%", apply: i => ({ revenueYear1: i.revenueYear1 * 0.9 }) }, high: { label: "+10%", apply: i => ({ revenueYear1: i.revenueYear1 * 1.1 }) } },
  { key: "Material cost", low: { label: "−20%", apply: i => ({ capex: i.capex * (1 - 0.2 * pct(i.materialSharePct)) }) }, high: { label: "+20%", apply: i => ({ capex: i.capex * (1 + 0.2 * pct(i.materialSharePct)) }) } },
  { key: "Carbon price", low: { label: "−50%", apply: i => ({ carbonPrice: i.carbonPrice * 0.5 }) }, high: { label: "+50%", apply: i => ({ carbonPrice: i.carbonPrice * 1.5 }) } },
  { key: "OPEX", low: { label: "−10%", apply: i => ({ opexYear1: i.opexYear1 * 0.9 }) }, high: { label: "+10%", apply: i => ({ opexYear1: i.opexYear1 * 1.1 }) } },
];

export type SensitivityRow = { key: string; lowLabel: string; highLabel: string; lowIrr: number | null; highIrr: number | null; lowDscr: number | null; highDscr: number | null; swing: number };

/** Equity IRR and minimum DSCR under each shock, widest swing first. Variables with no effect (e.g. no carbon) are dropped. */
export function sensitivity(base: CaseInputs): SensitivityRow[] {
  const b = runCase(base);
  return SENSITIVITIES.map(s => {
    const lo = runCase({ ...base, ...s.low.apply(base) }), hi = runCase({ ...base, ...s.high.apply(base) });
    const swing = Math.abs((hi.equityIrr ?? hi.projectIrr ?? 0) - (lo.equityIrr ?? lo.projectIrr ?? 0)) + Math.abs((hi.minDscr ?? 0) - (lo.minDscr ?? 0)) / 100;
    return { key: s.key, lowLabel: s.low.label, highLabel: s.high.label, lowIrr: lo.equityIrr ?? lo.projectIrr, highIrr: hi.equityIrr ?? hi.projectIrr, lowDscr: lo.minDscr, highDscr: hi.minDscr, swing };
  }).filter(r => r.swing > 1e-9 || b.equityIrr === null).sort((a, b2) => b2.swing - a.swing);
}
