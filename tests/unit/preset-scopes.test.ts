import { describe, expect, it } from "vitest";
import { configProblems } from "@/lib/scan/config";
import { expandGeography } from "@/lib/scan/countries";
import { BUILT_IN_PRESETS } from "@/lib/scan/presets";

describe("built-in presets aligned with working scopes", () => {
  it("every preset runs as saved, has unique key, a scope-first name and a fit brief", () => {
    expect(new Set(BUILT_IN_PRESETS.map(p => p.key)).size).toBe(BUILT_IN_PRESETS.length);
    for (const p of BUILT_IN_PRESETS) {
      expect(configProblems(p.config), p.key).toEqual([]);
      expect(p.name, p.key).toMatch(/ · /);
      if (p.key !== "mx_referral_partners") expect(p.config.signalCriteria.length, p.key).toBeGreaterThan(30);
    }
  });
  it("covers each working scope", () => {
    const names = BUILT_IN_PRESETS.map(p => p.name.split(" · ")[0]);
    for (const scope of ["Africa solar + storage", "Balkans solar + storage", "US solar + storage", "Mexico & LATAM energy", "Waste & resources", "Land & built environment", "Water, food & nature", "Capital", "Partners"]) expect(names, scope).toContain(scope);
  });
  it("the RA-ESG countries and Montenegro are inside the Africa / Balkans presets", () => {
    const geo = (k: string) => expandGeography(BUILT_IN_PRESETS.find(p => p.key === k)!.config.geography);
    for (const c of ["ZWE", "NAM", "ZAF", "MOZ", "MUS", "TZA", "BWA"]) expect(geo("africa_solar_developers"), c).toContain(c);
    expect(geo("balkans_solar")).toContain("MNE");
  });
  it("credit-free presets never include Apollo", () => {
    for (const k of ["africa_power_dfis", "storage_equipment", "wte_technology_epc", "conservation_partners", "dfis", "derisking"]) expect(BUILT_IN_PRESETS.find(p => p.key === k)!.config.providers, k).not.toContain("apollo_orgs");
  });
});
