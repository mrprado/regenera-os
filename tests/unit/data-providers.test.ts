// Institutional data-provider framework (WRI prompt §1–32): catalogue integrity, WRI Tier 1, honest status, Aqueduct
// and GFW parsing, evidence readings, screening flags, mandate alignment without "likely to invest", export checks.
import { describe, expect, it } from "vitest";
import { DATASETS, PROVIDERS, providerOf } from "@/lib/data-providers/catalog";
import { baseConnection, dataSourcesBlock, exportCheck, statusOf } from "@/lib/data-providers/engine";
import { evidenceReadings, mandateAlignment, screeningFlags } from "@/lib/data-providers/evidence";
import { readAqueductRow, waterImplications } from "@/lib/data-providers/wri/aqueduct";
import { summarizeLoss } from "@/lib/data-providers/wri/global-forest-watch";
import { pickDataset } from "@/lib/data-providers/wri/resource-watch";
import { energyAccessOpportunity } from "@/lib/data-providers/wri/energy-access-explorer";
import { datasetHits } from "@/lib/search";
import { PROVENANCE } from "@/lib/map/provenance";

describe("catalogue", () => {
  it("WRI is a Tier 1 institutional provider with its six platforms", () => {
    const w = providerOf("wri")!;
    expect(w.tier).toBe(1);
    expect(w.platforms.map(p => p.key)).toEqual(["aqueduct", "gfw", "resource_watch", "eae", "lcl", "wri_explorer"]);
  });
  it("every dataset has provenance, licence fields, a role and a limitation; ids are unique; providers exist", () => {
    expect(new Set(DATASETS.map(d => d.id)).size).toBe(DATASETS.length);
    for (const d of DATASETS) {
      expect(PROVIDERS.some(p => p.key === d.provider), d.id).toBe(true);
      expect(d.sourceUrl && d.license && d.attributionText && d.analyticalRole, d.id).toBeTruthy();
      expect(d.limitations.length, d.id).toBeGreaterThan(0);
      if (d.atlasLayer) expect(PROVENANCE[d.atlasLayer], d.id).toBeDefined();
    }
  });
  it("status is never 'connected' without a real success, and keys are reported missing", () => {
    const gfw = DATASETS.find(d => d.id === "wri.gfw.tree_cover_loss")!;
    expect(statusOf(gfw, null, {}).connection).toBe("api_available");
    expect(statusOf(gfw, null, {}).health).toBe("needs_key");
    expect(statusOf(gfw, { lastSuccessAt: new Date().toISOString(), failures: 0, lastSyncedAt: null, deprecated: false }, { GFW_API_KEY: "k" }).connection).toBe("connected");
    const eae = DATASETS.find(d => d.id === "wri.eae.energy_access")!;
    expect(baseConnection(eae, {})).toBe("external");
    expect(statusOf(DATASETS.find(d => d.id === "wri.aqueduct.baseline_water_stress")!, { lastSuccessAt: "2020-01-01T00:00:00Z", failures: 0, lastSyncedAt: null, deprecated: false }, {}, new Date("2026-09-30")).health).toBe("stale");
  });
});

describe("WRI adapters", () => {
  it("reads Aqueduct columns that exist and ignores the rest", () => {
    const r = readAqueductRow({ pfaf_id: 732101, bws_cat: 4, bws_label: "Extremely high (>80%)", bws_score: 4.6, bws_raw: 1.2, drr_cat: 2, drr_label: "Medium", unrelated: 1 });
    expect(r.basin).toBe("732101");
    expect(r.readings.map(x => x.indicator)).toEqual(["bws", "drr"]);
    expect(waterImplications(r.readings)).toContain("Environmental permitting and water rights");
  });
  it("summarizes GFW loss by year with a recent window", () => {
    const s = summarizeLoss([{ umd_tree_cover_loss__year: 2003, area__ha: 1.2 }, { umd_tree_cover_loss__year: 2021, area__ha: 3.05 }, { umd_tree_cover_loss__year: 2023, area__ha: 0.5 }]);
    expect(s).toMatchObject({ totalHa: 4.8, recentHa: 3.6, recentFrom: 2019, lastYear: 2023 });
  });
  it("picks the Resource Watch dataset whose name contains every search word", () => {
    const list = [{ id: "a", name: "Aqueduct Water Risk Atlas", provider: "cartodb", connector: "rest", tableName: null, updatedAt: null, geo: true }, { id: "b", name: "Aqueduct Baseline Water Stress", provider: "cartodb", connector: "rest", tableName: "wat_050", updatedAt: null, geo: true }];
    expect(pickDataset(list, "aqueduct baseline water stress")?.id).toBe("b");
  });
  it("energy access opportunity keeps unknowns as Not available", () => {
    const e = energyAccessOpportunity("Site", { accessPct: 55, ruralAccessPct: null, population: null, gridKm: 32, health: null, schools: null, ghi: null });
    expect(e.opportunity).toBe("Potential energy-access opportunity");
    expect(e.population).toBe("Not available");
  });
});

describe("evidence hierarchy", () => {
  it("gives three separate readings", () => {
    const r = evidenceReadings({ screeningSources: ["a", "b", "c", "d"], screeningDimensions: ["water", "ecology", "land", "energy", "grid", "climate"], jurisdictions: 1, requirements: 4, requirementsVerified: 1, permits: 0, permitsApproved: 0, level2Sources: 0, studies: [{ type: "grid", status: "final" }], documents: [] });
    expect(r).toMatchObject({ screening: "high", development: "incomplete", investment: "incomplete" });
    expect(r.notes.investment).toMatch(/missing ppa/);
  });
  it("screening flags carry dataset ids and diligence, never conclusions", () => {
    const f = screeningFlags({ aqueduct: [{ indicator: "bws", category: 4, categoryLabel: "Extremely high" }], loss: { totalHa: 12, recentHa: 3, recentFrom: 2019 }, transmissionMapped: false, electricityAccessPct: 60, communities: 0 });
    expect(f.map(x => x.flag)).toEqual(["water_stress", "forest_intersection", "land_conversion_signal", "grid_gap", "energy_access_opportunity"]);
    expect(f.every(x => !/compliant|illegal|harmful/i.test(x.observed + x.implication))).toBe(true);
    expect(f[0].datasetId).toBe("wri.aqueduct.baseline_water_stress");
  });
  it("mandate alignment never says an investor will invest", () => {
    expect(mandateAlignment([{ attribute: "energy_access", verification: "unverified" }], "Climate infrastructure, SDG 7, Africa, blended finance", false).signal).toBe("potential");
    expect(mandateAlignment([{ attribute: "energy_access", verification: "third_party_verified" }], "SDG 7", true).signal).toBe("verified");
    expect(mandateAlignment([{ attribute: "restoration", verification: "estimated" }], "Real estate core plus", false).signal).toBe("outreach");
    expect(mandateAlignment([], "", false).signal).toBe("unknown");
  });
});

describe("licensing and search", () => {
  it("export check refuses raw packaging where redistribution is not allowed", () => {
    const x = exportCheck(["wri.aqueduct.baseline_water_stress", "wdpa.protected_areas", "wri.eae.energy_access"]);
    expect(x.map(e => e.raw)).toEqual(["allowed", "prohibited", "verify"]);
    expect(dataSourcesBlock(["wdpa.protected_areas"], "2026-09-30")[0]).toMatch(/Raw data not redistributed/);
  });
  it("global search finds datasets by subject with place words", () => {
    expect(datasetHits("water stress Mexico").map(h => h.label)).toContain("Aqueduct 4.0 · Baseline water stress");
    expect(datasetHits("tree cover Ghana").some(h => /Tree cover/.test(h.label))).toBe(true);
    expect(datasetHits("energy access Kenya")[0].label).toMatch(/Energy Access/);
    expect(datasetHits("forest carbon Brazil")[0].label).toBe("Forest greenhouse gas net flux");
  });
});
