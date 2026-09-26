// Adapter normalizers against recorded response shapes (fixtures): CI never needs provider keys.
import { describe, expect, it } from "vitest";
import {
  CredentialRequired, LicenseRequired, normalizeEia, normalizeEntsoePrices, normalizeFirmsCsv, normalizeFred, normalizeImf, normalizeNoaa, normalizePvgis, normalizeStac,
  protectedAreasNear, zPvgis,
} from "@/lib/integrations/adapters";
import { INTEGRATIONS } from "@/lib/integrations/registry";

describe("adapter normalizers", () => {
  it("PVGIS: specific yield, in-plane irradiation and variability with provenance", () => {
    const facts = normalizePvgis(zPvgis.parse({ inputs: { location: { latitude: 20.97, longitude: -89.62 } }, outputs: { totals: { fixed: { E_y: 1712.4, "H(i)_y": 2210.2, SD_y: 41.3 } } } }));
    expect(facts.map(f => [f.key, f.numeric])).toEqual([["pv_specific_yield", 1712.4], ["pv_plane_irradiation", 2210.2], ["pv_interannual_sd", 41.3]]);
    expect(facts[0]).toMatchObject({ integrationKey: "pvgis", tier: 1, value: "1,712 kWh/kWp/year" });
  });

  it("Copernicus STAC: newest first, cloud filter, metadata only", () => {
    const scenes = normalizeStac({ features: [
      { id: "A", collection: "sentinel-2-l2a", properties: { datetime: "2026-09-01T16:00:00Z", "eo:cloud_cover": 12, platform: "sentinel-2b" } },
      { id: "B", collection: "sentinel-2-l2a", properties: { datetime: "2026-09-10T16:00:00Z", "eo:cloud_cover": 80 } },
      { id: "C", collection: "sentinel-2-l2a", properties: { datetime: "2026-09-12T16:00:00Z", "eo:cloud_cover": 5 } },
    ] }, 30);
    expect(scenes.map(s => s.id)).toEqual(["C", "A"]);
  });

  it("EIA v2, NOAA, FRED and IMF rows", () => {
    expect(normalizeEia({ response: { data: [{ period: "2025", price: "14.2", "price-units": "cents per kilowatt-hour", stateDescription: "Texas" }] } }, "price")).toEqual([{ period: "2025", value: 14.2, unit: "cents per kilowatt-hour", series: "Texas" }]);
    expect(normalizeNoaa({ results: [{ date: "2025-01-01T00:00:00", datatype: "PRCP", station: "GHCND:X", value: 81.2 }] })).toEqual([{ date: "2025-01-01", datatype: "PRCP", station: "GHCND:X", value: 81.2 }]);
    expect(normalizeFred({ observations: [{ date: "2026-09-25", value: "4.12" }, { date: "2026-09-24", value: "." }] })).toEqual([{ date: "2026-09-25", value: 4.12 }, { date: "2026-09-24", value: null }]);
    expect(normalizeImf({ CompactData: { DataSet: { Series: { Obs: [{ "@TIME_PERIOD": "2024", "@OBS_VALUE": "131.2" }] } } } })).toEqual([{ period: "2024", value: 131.2 }]);
    expect(normalizeImf({ CompactData: { DataSet: {} } })).toEqual([]);
  });

  it("FIRMS CSV and ENTSO-E XML", () => {
    const csv = "latitude,longitude,acq_date,confidence\n20.9,-89.6,2026-09-20,h\n20.8,-89.5,2026-09-22,n\n20.7,-89.4,2026-09-21,l";
    expect(normalizeFirmsCsv(csv)).toEqual({ count: 3, highConfidence: 1, latest: "2026-09-22" });
    expect(normalizeFirmsCsv("latitude,longitude\n")).toEqual({ count: 0, highConfidence: 0, latest: null });
    const xml = "<Publication_MarketDocument><currency_Unit.name>EUR</currency_Unit.name><price_Measure_Unit.name>MWH</price_Measure_Unit.name><Point><price.amount>80.5</price.amount></Point><Point><price.amount>-2.5</price.amount></Point></Publication_MarketDocument>";
    expect(normalizeEntsoePrices(xml)).toEqual({ points: 2, mean: 39, min: -2.5, max: 80.5, currency: "EUR", unit: "MWH" });
    expect(normalizeEntsoePrices("<Acknowledgement_MarketDocument/>")).toBeNull();
  });

  it("Protected Planet refuses without a commercial licence, then without a token", async () => {
    const db = {} as never;
    await expect(protectedAreasNear(db, "tok", "false", "MEX")).rejects.toBeInstanceOf(LicenseRequired);
    await expect(protectedAreasNear(db, undefined, "true", "MEX")).rejects.toBeInstanceOf(CredentialRequired);
  });
});

describe("registry", () => {
  it("every provider is registered once with licence terms; restricted sources are not enabled", () => {
    const keys = INTEGRATIONS.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of INTEGRATIONS) expect(i.license.length, i.key).toBeGreaterThan(2);
    const state = (k: string) => INTEGRATIONS.find(i => i.key === k)?.featureState;
    expect(state("wdpa")).toBe("license_required");
    expect(state("soilgrids")).toBe("disabled");
    expect(state("google_solar")).toBe("disabled");
    expect(state("nominatim")).toBe("development_only");
    expect(state("pvgis")).toBe("enabled");
    expect(INTEGRATIONS.filter(i => i.commercialUse === "no").every(i => i.featureState !== "enabled")).toBe(true);
  });
});
