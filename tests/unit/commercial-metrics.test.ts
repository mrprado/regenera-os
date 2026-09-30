// Regenera commercial metrics: platform ARR, advisory MRR, other recurring, implementation backlog, renewals and mix
// are kept apart (company model §30; hardening §28). A retainer is never ARR; a subscription is never MRR advisory.
import { describe, expect, it } from "vitest";
import { categoryOf, commercialMetrics, type Row } from "@/lib/commercial/metrics";

const eng = (o: Record<string, unknown>) => ({ id: String(o.name), name: String(o.name), currency: "USD", status: "active", fee: 0, monthlyFee: 0, months: 0, billingType: "fixed", revenueCategory: null, engagementType: null, renewalDate: null, endDate: null, ...o });
const row = (e: Record<string, unknown>, econ: Partial<Row["econ"]> = {}): Row => ({ e: eng(e) as never, econ: { contractValue: 0, invoiced: 0, weighted: 0, grossMargin: 0, internalCostKnown: false, ...econ } });

describe("commercial metrics", () => {
  it("separates ARR, advisory MRR, other recurring and backlog", () => {
    const m = commercialMetrics([
      row({ name: "OS", revenueCategory: "subscription", monthlyFee: 5000 }, { contractValue: 60000 }),
      row({ name: "Retainer", billingType: "monthly_retainer", monthlyFee: 10000 }, { contractValue: 120000 }),
      row({ name: "MRV", revenueCategory: "monitoring", fee: 24000 }, { contractValue: 24000 }),
      row({ name: "Impl", revenueCategory: "implementation", fee: 120000 }, { contractValue: 120000, invoiced: 36000 }),
      row({ name: "Lead", status: "proposal", revenueCategory: "diagnostic", fee: 20000 }, { contractValue: 20000, weighted: 8000 }),
    ], "2026-09-29").byCurrency[0];
    expect(m).toMatchObject({ arr: 60000, advisoryMrr: 10000, otherMrr: 2000, backlog: 84000, pipeline: 20000, weighted: 8000 });
  });

  it("infers a category only when none is recorded, and says so", () => {
    expect(categoryOf({ revenueCategory: null, engagementType: "platform_subscription", billingType: "fixed" } as never)).toEqual({ category: "subscription", inferred: true });
    expect(categoryOf({ revenueCategory: "advisory", engagementType: "platform_subscription", billingType: "subscription" } as never)).toEqual({ category: "advisory", inferred: false });
  });

  it("lists renewals inside 120 days only, annualising recurring work", () => {
    const m = commercialMetrics([
      row({ name: "Soon", revenueCategory: "subscription", monthlyFee: 1000, renewalDate: "2026-12-01" }, { contractValue: 12000 }),
      row({ name: "Later", revenueCategory: "subscription", monthlyFee: 1000, renewalDate: "2027-06-01" }, { contractValue: 12000 }),
    ], "2026-09-29");
    expect(m.renewing.map(x => [x.name, x.value])).toEqual([["Soon", 12000]]);
  });
});
