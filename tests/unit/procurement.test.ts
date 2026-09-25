import { describe, expect, it } from "vitest";
import { embodiedCarbon, evaluateBids, matchNetwork, normUnit } from "@/lib/procurement/logic";

describe("bid evaluation", () => {
  const w = { technical: 50, cost: 50, schedule: 0, warranty: 0, bankability: 0, track_record: 0, local_content: 0, carbon: 0, financing: 0 };
  it("scores cost from the lowest price and weights the evaluators' scores; unscored criteria count as zero and are listed", () => {
    const r = evaluateBids([
      { id: "a", bidder: "Cheap", status: "received", price: 80, currency: "USD", scores: { technical: 6 } },
      { id: "b", bidder: "Strong", status: "received", price: 100, currency: "USD", scores: { technical: 10 } },
      { id: "c", bidder: "Silent", status: "received", price: 90, currency: "USD", scores: {} },
      { id: "d", bidder: "Invited only", status: "invited", price: null, currency: "USD", scores: {} },
    ], w);
    expect(r.ranked.map(x => x.bidder)).toEqual(["Strong", "Cheap", "Silent"]);
    expect(r.ranked[0].total).toBeCloseTo((10 * 50 + 8 * 50) / 100, 6);
    expect(r.ranked[1].total).toBeCloseTo((6 * 50 + 10 * 50) / 100, 6);
    expect(r.ranked[2].missing).toEqual(["technical"]);
  });

  it("does not auto-score cost across currencies and warns on a single bid", () => {
    expect(evaluateBids([{ id: "a", bidder: "A", status: "received", price: 1, currency: "USD", scores: {} }, { id: "b", bidder: "B", status: "received", price: 1, currency: "EUR", scores: {} }], w).ranked[0].missing).toContain("cost");
    expect(evaluateBids([{ id: "a", bidder: "A", status: "received", price: 1, currency: "USD", scores: {} }], w).notes.join(" ")).toMatch(/Only one bid/);
  });
});

describe("embodied carbon", () => {
  const epds = [
    { id: "e1", declaredUnit: "tonne", gwp: { a1a3: 1850, a4: 40 }, validUntil: "2030-01-01", product: "Rebar", manufacturer: "X" },
    { id: "e2", declaredUnit: "m³", gwp: { a1a3: 300 }, validUntil: "2025-01-01", product: "C30 concrete", manufacturer: "Y" },
  ];
  it("computes only from EPDs in matching units, flags gaps and expired EPDs, never estimates", () => {
    const r = embodiedCarbon([
      { id: "s", material: "Rebar", quantity: 100, unit: "t", epdId: "e1" },
      { id: "c", material: "Concrete", quantity: 2000, unit: "m3", epdId: "e2" },
      { id: "m", material: "Modules", quantity: 90000, unit: "unit", epdId: null },
      { id: "u", material: "Steel in kg", quantity: 5000, unit: "kg", epdId: "e1" },
    ], epds, "2026-09-25");
    expect(r.lines.map(l => l.status)).toEqual(["computed", "computed", "no_epd", "unit_mismatch"]);
    expect(r.totals).toEqual({ a1a3: 185_000 + 600_000, a4: 4_000 });
    expect(r.upfrontTonnes).toBeCloseTo(789, 6);
    expect(r.lines[1].expiredEpd).toBe(true);
    expect(r.coverage).toBe(0.5);
    expect(normUnit(" Tonnes ")).toBe("t");
  });
});

describe("network matching", () => {
  it("requires the asset class when both sides state it and explains the score", () => {
    const profiles = [
      { id: "1", orgId: "o1", roles: ["epc"], assetClasses: ["solar"], jurisdictions: ["MEX"], minProjectSize: 10e6, maxProjectSize: 200e6, bankable: true, completedAssets: 12 },
      { id: "2", orgId: "o2", roles: ["epc"], assetClasses: ["wind"], jurisdictions: ["MEX"], minProjectSize: null, maxProjectSize: null, bankable: true, completedAssets: 3 },
      { id: "3", orgId: "o3", roles: ["oem"], assetClasses: [], jurisdictions: [], minProjectSize: null, maxProjectSize: null, bankable: false, completedAssets: null },
    ];
    const m = matchNetwork({ assetClass: "solar", country: "mex", capex: 42e6 }, profiles);
    expect(m.map(x => x.orgId)).toEqual(["o1", "o3"]);
    expect(m[0].reasons).toEqual(expect.arrayContaining(["Builds this asset class", "Present / licensed in the project country", "Project size in range", "Lender-accepted (bankable)"]));
    expect(m[1].gaps).toContain("Jurisdictions not recorded");
    expect(matchNetwork({ assetClass: "solar", country: "MEX", capex: null }, profiles, "oem").map(x => x.orgId)).toEqual(["o3"]);
  });
});
