// Power stack: PPA bankability by dimension, revenue stack shares and concentration, LCOS, matching and strategies.
import { describe, expect, it } from "vitest";
import { haversineKm, lcos, matchDims, orderMatches, powerStrategies, ppaBankability, revenueStack, summariseBankability } from "@/lib/power/engine";

const ppa = (o: Record<string, unknown> = {}) => ({
  id: "p", name: "PPA", type: "corporate", status: "signed", buyerName: "Buyer", price: 60, contractedMwhYear: 100_000, termYears: 15, currency: "USD", escalationPct: 2, indexation: "",
  profile: "as_produced", riskAllocation: { volume: "seller", curtailment: "buyer", change_in_law: "shared" }, credit: { rating: "BBB+" }, lenderRights: { assignment: "yes", stepIn: "yes", directAgreement: "yes" },
  conditions: [{ condition: "Permits", status: "satisfied" }], revenueStreamId: null, ...o,
}) as never;

describe("PPA bankability", () => {
  it("assesses each dimension independently with reasons", () => {
    const d = ppaBankability(ppa(), { debtTenorYears: 18, debtCurrency: "USD", breakevenPrice: 50 });
    const get = (n: string) => d.find(x => x.dimension === n)!;
    expect(get("Counterparty strength").result).toBe("strong");
    expect(get("Tenor adequacy").result).toBe("acceptable");            // 15 ≥ 0.8 × 18
    expect(get("Price adequacy")).toMatchObject({ result: "strong" });  // 20% headroom
    expect(get("Curtailment allocation").result).toBe("strong");
    expect(get("Lender assignment").result).toBe("strong");
    expect(get("Volume certainty").result).toBe("acceptable");         // as-produced, seller bears volume
    expect(summariseBankability(d).material_issue).toBe(0);
  });

  it("flags sub-investment-grade without support, no assignment, FX mismatch and missing data as unknown", () => {
    const d = ppaBankability(ppa({ credit: { rating: "B" }, lenderRights: { assignment: "no" }, currency: "MXN", termYears: null, price: null }), { debtCurrency: "USD" });
    const get = (n: string) => d.find(x => x.dimension === n)!;
    expect(get("Counterparty strength").result).toBe("material_issue");
    expect(get("Lender assignment").result).toBe("material_issue");
    expect(get("Currency alignment").result).toBe("conditional");
    expect(get("Tenor adequacy").result).toBe("unknown");
    expect(get("Price adequacy").result).toBe("unknown");
  });
});

describe("revenue stack", () => {
  it("computes contracted and merchant shares, concentration and weighted tenor", () => {
    const streams = [
      { id: "s1", name: "PPA A", mechanism: "ppa", status: "signed", counterparty: "A", unitPrice: 50, annualVolume: 100, tenorYears: 20, currency: "USD" },
      { id: "s2", name: "Merchant", mechanism: "merchant", status: "signed", counterparty: "", unitPrice: 40, annualVolume: 50, tenorYears: null, currency: "USD" },
      { id: "s3", name: "Capacity", mechanism: "availability", status: "signed", counterparty: "B", unitPrice: 10, annualVolume: 300, tenorYears: 10, currency: "USD" },
    ] as never[];
    const s = revenueStack(streams, []);
    expect(s.total).toBe(5000 + 2000 + 3000);
    expect(s.contractedPct).toBeCloseTo(80, 6);
    expect(s.topCounterparty).toEqual({ name: "A", pct: 62.5 });
    expect(s.weightedTenor).toBeCloseTo((5000 * 20 + 3000 * 10) / 8000, 6);
  });
});

describe("storage and matching", () => {
  it("LCOS needs its inputs and is positive when complete", () => {
    expect(lcos({ powerMw: 100, energyMwh: 400, cyclesPerYear: null, roundTripPct: 86, degradationPctYear: 2, usefulLifeYears: 20, augmentation: [], capexPerKwh: 250, capexPerKw: null, fixedOmPerKwYear: 10, chargingCostPerMwh: 30 }).missing).toContain("cyclesPerYear");
    const r = lcos({ powerMw: 100, energyMwh: 400, cyclesPerYear: 365, roundTripPct: 86, degradationPctYear: 2, usefulLifeYears: 20, augmentation: [{ year: 10, mwh: 60, costPerKwh: 150 }], capexPerKwh: 250, capexPerKw: null, fixedOmPerKwYear: 10, chargingCostPerMwh: 30 });
    expect(r.lcos!).toBeGreaterThan(80); expect(r.lcos!).toBeLessThan(250); expect(r.durationHours).toBe(4);
  });

  it("explains power-to-load fit and orders fits first", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
    const load = { lat: 33.4, lng: -112.0, country: "USA", mw: 300, mwhYear: null, loadFactorPct: 85, renewableTargetPct: 100, procurement: ["physical_ppa", "vppa"], energizationDate: "2028-06-01" } as never;
    const near = matchDims({ id: "g", name: "Solar 200", lat: 33.3, lng: -112.2, capacity: 200, capacityUnit: "MW", assetClass: "solar", country: "USA", stage: "development", codYear: 2028 }, load);
    const far = matchDims({ id: "h", name: "Solar far", lat: 19.4, lng: -99.1, capacity: 50, capacityUnit: "MW", assetClass: "solar", country: "MEX", stage: "development", codYear: 2032 }, load);
    expect(near.dims.find(d => d.dimension === "Distance")!.result).toBe("fit");
    expect(near.estimated).toBe(true);
    expect(far.dims.find(d => d.dimension === "Distance")!.result).toBe("no_fit");
    expect(orderMatches([{ ...far, n: 2 }, { ...near, n: 1 }])[0].n).toBe(1);
    expect(powerStrategies({ mw: 300, loadFactorPct: 85, redundancy: "2n" }, { gridAvailableMw: 90 })[0].caveats[0]).toMatch(/Grid gap 210 MW/);
  });
});
