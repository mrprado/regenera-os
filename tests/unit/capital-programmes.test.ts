import { describe, expect, it } from "vitest";
import { COUNTRY_NOTES, matchProgrammes, PROGRAMMES, programmesCsv, regionsOf } from "@/lib/capital/programmes";
import { toGwh, yieldCheck } from "@/lib/diligence/yield";
import { normalizePvgis } from "@/lib/integrations/adapters";

describe("public capital programmes", () => {
  it("are institutions with a source link, lanes and regions; keys are unique", () => {
    expect(new Set(PROGRAMMES.map(p => p.key)).size).toBe(PROGRAMMES.length);
    for (const p of PROGRAMMES) { expect(p.url, p.key).toMatch(/^https:\/\//); expect(p.lanes.length, p.key).toBeGreaterThan(0); expect(p.regions.length, p.key).toBeGreaterThan(0); }
  });
  it("matches by geography and stage-appropriate lane, never by score", () => {
    const zim = matchProgrammes({ country: "ZWE", stage: "development", capacity: 100, capacityUnit: "MW" });
    const keys = zim.map(m => m.programme.key);
    expect(keys).toEqual(expect.arrayContaining(["tdb", "afdb_ns", "miga"]));
    expect(keys).not.toContain("ebrd");            // EBRD does not cover Zimbabwe
    expect(keys).not.toContain("dbn");             // Namibia only
    expect(zim[0]).not.toHaveProperty("score");
    const mne = matchProgrammes({ country: "MNE", stage: "opportunity", capacity: 240, capacityUnit: "MW" }).map(m => m.programme.key);
    expect(mne).toEqual(expect.arrayContaining(["ebrd", "wbif"]));
    expect(mne).not.toContain("sefa");
    expect(regionsOf("MOZ")).toEqual(expect.arrayContaining(["MOZ", "AFRICA", "SADC", "OIC"]));
  });
  it("early-stage projects lead with preparation and equity; every match carries what to verify", () => {
    const early = matchProgrammes({ country: "NAM", stage: "opportunity", capacity: 54, capacityUnit: "MW" });
    const sefa = early.find(m => m.programme.key === "sefa")!;
    expect(sefa.met.join(" ")).toMatch(/Project preparation/);
    expect(early.every(m => m.verify.includes("See the country note"))).toBe(true);
    expect(COUNTRY_NOTES.ZWE).toMatch(/arrears/);
  });
  it("exports institutions only, quoted for CSV", () => {
    const csv = programmesCsv(PROGRAMMES.slice(0, 2));
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).not.toMatch(/@/);
  });
});

describe("energy yield check", () => {
  it("flags output above single-axis tracking with the questions to ask", () => {
    const y = yieldCheck(1000, 3200, 1945, 2515)!;
    expect(y.statedKwhPerKw).toBe(3200);
    expect(y.reading).toBe("above_tracking");
    expect(y.question).toMatch(/27% above single-axis tracking/);
    expect(yieldCheck(54, 100, 1924, 2444)!.reading).toBe("consistent_fixed");
    expect(yieldCheck(46, 121, 1681, 2122)!.reading).toBe("above_tracking");
    expect(yieldCheck(100, 192.2, 1728, 2195)!.reading).toBe("needs_tracking");
    expect(yieldCheck(0, 10, 1, 1)).toBeNull();
    expect(toGwh("100,000", "MWh")).toBe(100);
  });
});

describe("PVGIS normalization", () => {
  it("records fixed and single-axis tracking yields", () => {
    const facts = normalizePvgis({ inputs: { location: { latitude: -30.47, longitude: 20.48 } }, outputs: { totals: { fixed: { E_y: 1943.3, "H(i)_y": 2500, SD_y: 30 }, inclined_axis: { E_y: 2515 } } } } as never);
    expect(facts.map(f => [f.key, Math.round(f.numeric ?? 0)])).toEqual([["pv_specific_yield", 1943], ["pv_specific_yield_tracking", 2515], ["pv_plane_irradiation", 2500], ["pv_interannual_sd", 30]]);
  });
});
