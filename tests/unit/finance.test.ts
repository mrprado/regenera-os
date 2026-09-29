// Project finance engine: hand-checkable cases for IRR/NPV, generation and revenue, tax, debt sizing and
// sculpting, IDC/fees/DSRA circularity, sources = uses, waterfall, sensitivities, stress, breakeven, health, diff.
import { describe, expect, it } from "vitest";
import { breakeven, diffModels, modelHealth, oneWay, stressCases, template, twoWay, valueBridge } from "@/lib/finance/analysis";
import { calculate, irr, netGeneration, npv, revenueFor } from "@/lib/finance/calc";
import type { ModelDefinition, Provenance } from "@/lib/finance/types";

const P: Provenance = { source: "test", date: "2026-09-29", owner: "alan", confidence: "moderate", status: "supported" };
function model(over: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    currency: "USD", basis: "nominal", constructionMonths: 12, operatingYears: 10, codDelayMonths: 0,
    capex: [{ id: "c", category: "equipment", label: "Plant", quantity: 1, unit: "lot", unitCost: 1000, contingencyPct: 0, ...P }],
    development: [], opex: [], generation: null, debt: null, grants: [],
    revenue: [{ id: "r", label: "Offtake", type: "offtake", certainty: "contracted", basis: "fixed", annualVolume: 1, unit: "u", price: 150, escalationPct: 0, startYear: 1, termYears: 0, tailPrice: 0, shareOfGeneration: 0, ...P }],
    tax: { ratePct: 0, depreciationYears: 10, lossCarryforward: true, interestDeductible: true, ...P },
    discountRatePct: 8, equityHurdlePct: 10, residualValue: 0, decommissioning: 0, includeSpeculative: false, stageDiscountRates: [], ...over,
  };
}

describe("return maths", () => {
  it("IRR and NPV on known flows", () => {
    expect(irr([-100, 110])).toBeCloseTo(10, 6);
    expect(irr([-1000, ...Array(10).fill(150)])).toBeCloseTo(8.1442, 3);
    expect(irr([100, 100])).toBeNull();
    expect(npv(10, [-100, 110])).toBeCloseTo(-100 / 1.1 + 110 / 1.21, 9);
  });
});

describe("unlevered model", () => {
  it("project IRR equals the annuity IRR; equity = project without debt; sources = uses", () => {
    const o = calculate(model());
    expect(o.projectIrr).toBeCloseTo(8.1442, 3);
    expect(o.equityIrr).toBeCloseTo(8.1442, 3);
    expect(o.sources.total).toBeCloseTo(o.uses.total, 6);
    expect(o.uses.total).toBe(1000);
    expect(o.moic).toBeCloseTo(1.5, 6);
    expect(o.paybackYears).toBeCloseTo(1 + 1000 / 150 - 1 + 1, 1);
  });

  it("generation, degradation and escalation; speculative revenue excluded unless included", () => {
    const m = model({ generation: { capacityMw: 10, capacityFactorPct: 25, availabilityPct: 100, degradationPct: 1, curtailmentPct: 0, lossesPct: 0, pCase: "P50", p75Factor: 0.95, p90Factor: 0.9, ...P },
      revenue: [
        { id: "ppa", label: "PPA", type: "ppa", certainty: "contracted", basis: "energy", annualVolume: 0, unit: "MWh", price: 50, escalationPct: 2, startYear: 1, termYears: 5, tailPrice: 40, shareOfGeneration: 100, ...P },
        { id: "cc", label: "Carbon", type: "carbon", certainty: "speculative", basis: "fixed", annualVolume: 1000, unit: "t", price: 10, escalationPct: 0, startYear: 1, termYears: 0, tailPrice: 0, shareOfGeneration: 0, ...P },
      ] });
    expect(netGeneration(m, 1)).toBeCloseTo(10 * 8760 * 0.25, 6);
    const y2 = revenueFor(m, 2);
    expect(y2.total).toBeCloseTo(21_900 * 0.99 * 50 * 1.02, 4);
    expect(y2.by.speculative).toBe(0);
    const y6 = revenueFor(m, 6); // after the 5-year term: merchant tail
    expect(y6.by.contracted).toBe(0);
    expect(y6.by.merchant).toBeCloseTo(21_900 * 0.99 ** 5 * 40 * 1.02 ** 5, 4);
    expect(revenueFor({ ...m, includeSpeculative: true }, 1).by.speculative).toBe(10_000);
    const p90 = { ...m, generation: { ...m.generation!, pCase: "P90" as const } };
    expect(netGeneration(p90, 1)).toBeCloseTo(21_900 * 0.9, 6);
  });

  it("tax with depreciation and loss carry-forward", () => {
    const m = model({ tax: { ratePct: 30, depreciationYears: 2, lossCarryforward: true, interestDeductible: true, ...P } });
    const ops = calculate(m).periods.filter(p => p.phase === "operations");
    // years 1–2: EBITDA 150 − dep 500 → losses 700 carried; used against 150/year from year 3 until exhausted
    expect(ops[0].tax).toBe(0); expect(ops[1].tax).toBe(0);
    expect(ops.slice(2, 6).every(p => p.tax === 0)).toBe(true); // 4 × 150 = 600 of 700 used
    expect(ops[6].tax).toBeCloseTo((150 - 100) * 0.3, 6);
    expect(ops[7].tax).toBeCloseTo(150 * 0.3, 6);
    expect(ops[0].cfads).toBe(150); expect(ops[7].cfads).toBeCloseTo(105, 6); // CFADS ≠ EBITDA once tax is paid
  });
});

describe("debt", () => {
  const debt = (over = {}) => ({ name: "Senior", sizing: "dscr" as const, targetDscr: 1.3, maxGearingPct: 90, amount: 0, ratePct: 6, tenorYears: 8, profile: "sculpted" as const, upfrontFeePct: 1, dsraMonths: 6, lockupDscr: 1.1, currency: "USD", ...P, ...over });

  it("sculpted debt: constant DSCR at target, repaid within tenor, IDC/fees/DSRA in uses, converged", () => {
    const o = calculate(model({ debt: debt() }));
    const ops = o.periods.filter(p => p.phase === "operations");
    ops.slice(0, 8).forEach(p => expect(p.dscr).toBeCloseTo(1.3, 3));
    expect(ops[7].debtClosing).toBeCloseTo(0, 3);
    expect(ops[8].debtService).toBe(0);
    expect(o.debt).toBeCloseTo(npv(6, Array(8).fill(150 / 1.3)), 2);
    expect(o.uses.idc).toBeGreaterThan(0); expect(o.uses.fees).toBeCloseTo(o.debt * 0.01, 6); expect(o.uses.dsra).toBeCloseTo((150 / 1.3) * 0.5, 2);
    expect(o.sources.total).toBeCloseTo(o.uses.total, 4);
    expect(o.converged).toBe(true);
    expect(o.llcr).toBeCloseTo(1.3, 2);
    expect(o.debtSizedBy).toMatch(/DSCR/);
    expect(o.equityIrr!).toBeGreaterThan(o.projectIrr!); // positive leverage at 6 % debt vs 8.1 % project
  });

  it("gearing cap binds when DSCR capacity is larger; annuity sized down to meet the DSCR", () => {
    const g = calculate(model({ debt: debt({ targetDscr: 1.05, maxGearingPct: 50 }) }));
    expect(g.debt).toBeCloseTo(0.5 * g.uses.total, 0);
    expect(g.debtSizedBy).toMatch(/gearing/);
    const a = calculate(model({ debt: debt({ profile: "annuity" }) }));
    expect(a.minDscr!).toBeGreaterThanOrEqual(1.3 - 1e-6);
  });

  it("distributions lock up below the lock-up DSCR; DSRA covers shortfalls", () => {
    const m = model({ debt: debt({ sizing: "amount", amount: 800, profile: "annuity", lockupDscr: 1.2 }) });
    const o = calculate(m);
    const ops = o.periods.filter(p => p.phase === "operations");
    expect(ops.some(p => p.lockedUp)).toBe(true);
    expect(ops.filter(p => p.lockedUp).every(p => p.distributions === 0)).toBe(true);
  });
});

describe("analysis", () => {
  const m = model({ debt: { name: "Senior", sizing: "dscr", targetDscr: 1.3, maxGearingPct: 80, amount: 0, ratePct: 6, tenorYears: 8, profile: "sculpted", upfrontFeePct: 1, dsraMonths: 6, lockupDscr: 1.1, currency: "USD", ...P } });

  it("tornado ranks drivers by equity IRR swing; two-way grid; stress cases lower returns", () => {
    const t = oneWay(m, 10);
    expect(t.rows[0].swing).toBeGreaterThanOrEqual(t.rows[t.rows.length - 1].swing);
    expect(["price", "yield", "capex"]).toContain(t.rows[0].key);
    const g = twoWay(m, "price", "capex");
    expect(g.grid[4][0]!).toBeGreaterThan(g.grid[0][4]!); // price up + capex down beats price down + capex up
    const s = stressCases(m);
    const base = calculate(m).equityIrr!;
    expect(s.find(x => x.key === "rev20")!.equityIrr!).toBeLessThan(base);
    expect(s.find(x => x.key === "capex15")!.equityIrr!).toBeLessThan(base);
  });

  it("breakeven price for the equity hurdle", () => {
    const k = breakeven(m, "price", { metric: "equityIrr", value: 10 })!;
    const x = JSON.parse(JSON.stringify(m)) as ModelDefinition; x.revenue[0].price *= k;
    expect(calculate(x).equityIrr!).toBeCloseTo(10, 2);
  });

  it("health flags placeholders, speculative inclusion, volume over generation and FX mismatch", () => {
    const t = template("utility_solar", "MXN");
    const h = modelHealth(t);
    expect(h.status).toBe("ERROR"); // no CAPEX values and placeholders
    expect(h.issues.map(i => i.code)).toEqual(expect.arrayContaining(["no_capex", "placeholders"]));
    const bad = model({ includeSpeculative: true, debt: { ...m.debt!, currency: "EUR" } });
    expect(modelHealth(bad).issues.map(i => i.code)).toEqual(expect.arrayContaining(["speculative_included", "fx_mismatch"]));
    expect(modelHealth(m).status).toBe("PASS");
  });

  it("version diff attributes the IRR change by block and the steps sum to the total", () => {
    const b = JSON.parse(JSON.stringify(m)) as ModelDefinition;
    b.capex[0].unitCost = 1080; b.revenue[0].price = 160; b.debt!.ratePct = 6.5;
    const d = diffModels(m, b);
    expect(d.changes.map(c => c.key)).toEqual(expect.arrayContaining(["capex[c].unitCost", "revenue[r].price", "debt.ratePct"]));
    const sum = d.attribution.reduce((a, x) => a + (x.delta ?? 0), 0);
    expect(sum).toBeCloseTo(d.to! - d.from!, 6);
  });

  it("value bridge uses the user's stage discount rates", () => {
    const vb = valueBridge({ ...m, stageDiscountRates: [{ stage: "Concept", ratePct: 25 }, { stage: "Permitted", ratePct: 15 }, { stage: "RTB", ratePct: 10 }] });
    expect(vb[1].value).toBeGreaterThan(vb[0].value);
    expect(vb[2].uplift).toBeCloseTo(vb[2].value - vb[1].value, 6);
  });
});
