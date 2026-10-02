import { describe, expect, it } from "vitest";
import { priceService } from "@/lib/commercial/engine";
import { completedProviders } from "@/lib/scan/provider-reporting";
import { country } from "@/lib/scan/countries";
import { screenOrganization } from "@/lib/scan/criteria";
import { audience } from "@/lib/scan/audiences";
import { zScanConfig } from "@/lib/scan/config";

describe("observed origination regressions", () => {
  it.each([[1500, 6, 55, 2000], [5000, 18, 65, 6500], [10000, 40, 55, 11000]])(
    "keeps the target margin after rounding price %s", (listPrice, expectedHours, targetMarginPct, expected) => {
      const result = priceService({ listPrice, minPrice: 0, bandLow: 0, bandHigh: 15000, expectedHours,
        expectedExternalCost: 0, targetMarginPct, perMonth: false },
      { complexity: "standard", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: 120 });
      expect(result.suggested).toBe(expected);
      expect(result.expectedMarginPct!).toBeGreaterThanOrEqual(targetMarginPct);
    });
  it("does not round an exact margin-floor price up a step because of float noise", () => {
    // 9000 / (1 - 0.55) is 20000.000000000004 in floating point; the quote must stay 20000.
    expect(priceService({ listPrice: 20000, minPrice: 10000, bandLow: 10000, bandHigh: 30000, expectedHours: 70,
      expectedExternalCost: 2000, targetMarginPct: 55, perMonth: false },
    { complexity: "standard", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: 100 }).suggested).toBe(20000);
  });
  it("honors a configured minimum even for discounted low-complexity work", () => {
    expect(priceService({ listPrice: 1500, minPrice: 2500, bandLow: 0, bandHigh: 5000,
      expectedHours: 0, expectedExternalCost: 0, targetMarginPct: 55, perMonth: false },
    { complexity: "low", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: null }).suggested).toBe(2500);
  });
  it("does not exclude a US EPC because the provider spells out the country name", () => {
    expect(country("United States of America")?.iso3).toBe("USA");
    expect(country(" UAE ")?.iso3).toBe("ARE");
    const result = screenOrganization({ name: "Example EPC", country: "United States of America",
      industry: "Solar EPC contractor", description: null, headcount: null, domain: null, website: null },
    audience("epc_engineering")!, zScanConfig.parse({ audience: "epc_engineering", geography: ["United States"] }));
    expect(result.match).toBe("matches");
  });
  it("reports uncalled sources as skipped without masking actual calls or failures", () => {
    const result = completedProviders([
      { provider: "web", status: "ok", calls: 0, detail: "Available" },
      { provider: "existing", status: "ok", calls: 1, detail: "Read" },
      { provider: "apollo_orgs", status: "not_connected", detail: "Missing credential" },
      { provider: "gleif", status: "failed", calls: 0, detail: "Network failed" },
    ]);
    expect(result.map(p => p.status)).toEqual(["skipped", "ok", "not_connected", "failed"]);
    expect(result[0].detail).toMatch(/No calls made/);
  });
});
