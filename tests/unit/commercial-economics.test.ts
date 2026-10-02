// Phase 16 §4: the $12,500 / 45-day pilot and the separately approved $15,000/month retainer are economically separate,
// thin margins stay visible against the target, unknown costs stay unknown, price floors need a recorded override, and an
// unstarted mandate is pre-launch rather than "short".
import { describe, expect, it } from "vitest";
import { belowFloorWithoutOverride, engagementEconomics, engagementFloor, priceService } from "@/lib/commercial/engine";
import { isPrelaunch, mandateEconomicsFrom } from "@/lib/mandates/engine";

const base = { type: "epc_origination", retainer: 0, retainerStatus: "none", pilotFee: 0, pilotDays: null, implementationFee: 0, termMonths: null, engagementModel: null,
  dataCost: 0, partnerCost: 0, travelCost: 0, targetMarginPct: 55, currency: "USD", breadth: "regional", successEconomics: { structure: "none" } } as unknown as Parameters<typeof mandateEconomicsFrom>[0];

describe("pilot and retainer economics", () => {
  it("a $12,500 45-day pilot at 157.5 planned hours and $75/h contributes $687.50 and is flagged below the 55% target", () => {
    const e = mandateEconomicsFrom({ ...base, pilotFee: 12_500, pilotDays: 45 }, []);
    expect(e.monthlyHours).toBe(105);
    expect(e.pilot!.hours).toBe(157.5);
    expect(e.pilot!.cost).toBe(11_812.5);
    expect(e.pilot!.contribution).toBe(687.5);
    expect(e.pilot!.maxCost).toBe(5_625);
    expect(e.pilot!.belowTarget).toBe(true);
    expect(e.assumedRates).toBe(true);                 // unassigned seats use the named planning default, and say so
    expect(e.costBasis).toMatch(/planning default/i);
    expect(e.pilot!.costAtCatalogue).toBe(157.5 * 120);
  });

  it("without an agreed pilot length, 45 days is used and marked as an assumption", () => {
    expect(mandateEconomicsFrom({ ...base, pilotFee: 12_500 }, []).pilot!.daysAssumed).toBe(true);
  });

  it("a proposed $15k/month retainer is never counted as revenue; once approved it is, separately from the pilot", () => {
    const proposed = mandateEconomicsFrom({ ...base, pilotFee: 12_500, pilotDays: 45, retainer: 15_000, retainerStatus: "proposed", termMonths: 6 }, []);
    expect(proposed.retainer!.counted).toBe(false);
    expect(proposed.monthlyRevenue).toBe(0);
    expect(proposed.totalRevenue).toBe(12_500);       // the pilot only; no overlap with the retainer
    expect(proposed.retainer!.maxCost).toBe(6_750);    // 55% target on $15,000
    const approved = mandateEconomicsFrom({ ...base, pilotFee: 12_500, pilotDays: 45, retainer: 15_000, retainerStatus: "approved", termMonths: 6 }, []);
    expect(approved.monthlyRevenue).toBe(15_000);
    expect(approved.totalRevenue).toBe(12_500 + 15_000 * 6);
  });

  it("a retainer with no agreed term is not assumed to run 12 months", () => {
    const e = mandateEconomicsFrom({ ...base, retainer: 15_000, retainerStatus: "active", termMonths: null }, []);
    expect(e.retainer!.termMonths).toBeNull();
    expect(e.totalRevenue).toBe(0);
  });

  it("assigned team rates replace the planning default", () => {
    const e = mandateEconomicsFrom({ ...base, pilotFee: 12_500, pilotDays: 45 }, [{ role: "origination_analyst", name: "Analyst", costRate: 50 }]);
    expect(e.seats.find(s => s.seat === "origination_analyst")).toMatchObject({ rate: 50, assumed: false });
  });
});

describe("delivery before activation", () => {
  it("draft, proposed or not-yet-started mandates are pre-launch, never short", () => {
    expect(isPrelaunch({ status: "proposed", startDate: null, pilotStart: null }, "2026-10")).toBe(true);
    expect(isPrelaunch({ status: "active", startDate: "2026-11-01", pilotStart: null }, "2026-10")).toBe(true);
    expect(isPrelaunch({ status: "pilot", startDate: null, pilotStart: "2026-10-05" }, "2026-10")).toBe(false);
    expect(isPrelaunch({ status: "active", startDate: "2026-09-01", pilotStart: null }, "2026-10")).toBe(false);
  });
});

describe("price floors and unknown costs", () => {
  const svc = { listPrice: 2_000, minPrice: 1_500, bandLow: 1_500, bandHigh: 3_000, expectedHours: 6, expectedExternalCost: 0, targetMarginPct: 55, perMonth: false };
  it("rounds up and never undercuts the floor by cents", () => {
    const q = priceService({ ...svc, listPrice: 1_500 }, { complexity: "standard", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: 120 });
    expect(q.suggested).toBe(2_000);
    expect(q.suggested).toBeGreaterThanOrEqual(q.minimum);
  });
  it("a fee below the floor needs a recorded override", () => {
    const floor = engagementFloor({ hourlyCost: 120 }, [svc]);
    expect(floor.minimum).toBe(1_500);
    expect(belowFloorWithoutOverride(1_000, floor, { priceOverrideReason: null })).toBe(true);
    expect(belowFloorWithoutOverride(1_000, floor, { priceOverrideReason: "Strategic first client; scope reduced to one market" })).toBe(false);
    expect(belowFloorWithoutOverride(1_800, floor, { priceOverrideReason: null })).toBe(false);
  });
  it("flags a missing internal rate when services plan hours", () => {
    expect(engagementFloor({ hourlyCost: null }, [svc]).rateMissing).toBe(true);
  });
  it("planned time without an internal cost rate makes the margin unknown, not inflated", () => {
    const e = { fee: 10_000, monthlyFee: 0, months: 0, changeOrders: [], partners: [], hourlyCost: null, expectedHours: 40, probabilityPct: null, status: "active" } as never;
    const econ = engagementEconomics(e, [], [], []);
    expect(econ.marginPct).toBeNull();
    expect(econ.grossMargin).toBeNull();
    const priced = engagementEconomics({ ...(e as object), hourlyCost: 100 } as never, [], [], [{ hours: 40 } as never]);
    expect(priced.marginPct).toBe(60);
  });
});
