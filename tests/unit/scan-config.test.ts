// Phase 16: scan presets round-trip every supported field, invalid input is refused with named errors (never truncated or
// dropped), geography is canonical (aliases, multiword names, regions, GCC vs MENA), and unknown locations need review.
import { describe, expect, it } from "vitest";
import { audience } from "@/lib/scan/audiences";
import { configProblems, scanOutcome, zScanConfig } from "@/lib/scan/config";
import { country, expandGeography, parseGeography, COUNTRIES, GCC } from "@/lib/scan/countries";
import { screenOrganization } from "@/lib/scan/criteria";
import { presetFormValues, presetFromForm, PRESET_LIMITS } from "@/lib/scan/preset-form";
import { queryTerms } from "@/lib/scan/web";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe("preset round trip", () => {
  it("an opportunity preset keeps its mode, criteria and sources through save → reload → parse", () => {
    const first = presetFromForm(fd({
      name: "US + GCC solar tenders", section: "projects", mode: "opportunities", geography: ["USA", "gcc"], geographyText: "United Kingdom; Namibia",
      capabilities: "solar PV, BESS", terms: "EPC tender, grid connection", excludeTerms: "residential", sizeMin: "20", sizeMax: "300", sizeUnit: "MW", stages: "rfp, tender",
      freshnessDays: "90", providers: ["funding_calls", "procurement", "web"], maxOrganizations: "40", researchBudgetUsd: "4.5", note: "Q4 pipeline",
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.config.mode).toBe("opportunities");
    expect(first.config.geography).toEqual(["USA", "gcc", "GBR", "NAM"]);
    expect(first.config.providers).toEqual(["funding_calls", "procurement", "web"]);
    const reloaded = presetFromForm(presetFormValues(first));
    expect(reloaded.ok && reloaded.config).toEqual(first.config);
    expect(reloaded.ok && reloaded.name).toBe(first.name);
  });

  it("an organization preset keeps titles, seniorities, headcount, sector, exclusion policy and freshness", () => {
    const p = presetFromForm(fd({
      name: "Gulf family offices", section: "capital", mode: "organizations", audience: "family_offices", geography: ["gcc"], sector: "energy transition",
      titles: "Chief Investment Officer; Head of Direct Investments", seniorities: "c_suite, director", headcountMin: "5", headcountMax: "200",
      audienceExclusions: "ignore", excludeTerms: "", signalCriteria: "new energy fund", freshnessDays: "180", providers: ["web", "gleif"], maxOrganizations: "25", maxPeoplePerOrg: "2",
    }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.config).toMatchObject({ sector: "energy transition", titles: ["Chief Investment Officer", "Head of Direct Investments"], seniorities: ["c_suite", "director"], headcountMin: 5, headcountMax: 200, audienceExclusions: "ignore", freshnessDays: 180, maxPeoplePerOrg: 2 });
    const again = presetFromForm(presetFormValues(p));
    expect(again.ok && again.config).toEqual(p.config);
  });

  it("refuses over-long criteria, unreadable numbers and unknown countries with named errors instead of erasing them", () => {
    const r = presetFromForm(fd({ name: "Bad", section: "prospecting", mode: "organizations", audience: "epc_engineering", terms: "x".repeat(PRESET_LIMITS.terms + 1), maxOrganizations: "lots", geographyText: "Atlantis", providers: ["web"] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Organization terms is \d+ characters; the limit is 2000/);
    expect(r.errors.join(" ")).toMatch(/Maximum new organizations must be a whole number/);
    expect(r.errors.join(" ")).toMatch(/Geography not recognized: Atlantis/);
  });

  it("refuses mixing modes and sources", () => {
    expect(presetFromForm(fd({ name: "Mixed", section: "projects", mode: "opportunities", capabilities: "solar", providers: ["apollo_orgs"] })).ok).toBe(false);
    expect(configProblems(zScanConfig.parse({ audience: "epc_engineering", providers: ["queue_projects"] })).join(" ")).toMatch(/Organization mode cannot use opportunity sources/);
    expect(configProblems(zScanConfig.parse({ mode: "opportunities", audience: "objective", providers: ["procurement"] })).join(" ")).toMatch(/needs criteria/);
  });
});

describe("geography", () => {
  it("covers every ISO country once, including the energy portfolio's markets", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(249);
    expect(new Set(COUNTRIES.map(c => c.iso3)).size).toBe(COUNTRIES.length);
    for (const n of ["Zimbabwe", "Namibia", "Mauritius", "Tanzania", "Mozambique", "Botswana", "Montenegro"]) expect(country(n), n).not.toBeNull();
  });
  it("normalizes aliases and never splits multiword names", () => {
    for (const [i, o] of [["US", "USA"], ["U.S.A.", "USA"], ["United States of America", "USA"], ["UK", "GBR"], ["GB", "GBR"], ["UAE", "ARE"], ["United Arab Emirates", "ARE"], ["KSA", "SAU"], ["México", "MEX"], ["Côte d’Ivoire", "CIV"]]) expect(country(i)?.iso3, i).toBe(o);
    expect(parseGeography("United States, South Africa\nSaudi Arabia").geography).toEqual(["USA", "ZAF", "SAU"]);
  });
  it("keeps GCC and MENA distinct", () => {
    expect(expandGeography(["gcc"]).sort()).toEqual([...GCC].sort());
    const mena = expandGeography(["mena"]);
    expect(GCC.every(c => mena.includes(c))).toBe(true);
    expect(mena).toContain("EGY");
    expect(expandGeography(["gcc"])).not.toContain("EGY");
  });
  it("treats an unrecognized recorded country as needing review, not a mismatch", () => {
    const s = screenOrganization({ name: "X", country: "Republic of Nowhere", industry: "Solar EPC contractor", description: null, headcount: null, domain: null, website: null }, audience("epc_engineering")!, zScanConfig.parse({ audience: "epc_engineering", geography: ["MEX"] }));
    expect(s.criteria.find(c => c.key === "geography")!.result).toBe("unknown");
    expect(s.match).not.toBe("excluded");
  });
});

describe("what a scan says it searched and how it ended", () => {
  it("exposes the query terms and honours the audience-exclusion policy", () => {
    const a = audience("epc_engineering")!;
    const on = queryTerms(a, zScanConfig.parse({ audience: "epc_engineering", terms: ["BESS"], excludeTerms: [] }));
    expect(on.include).toContain("BESS");
    const off = queryTerms(a, zScanConfig.parse({ audience: "epc_engineering", excludeTerms: [], audienceExclusions: "ignore" }));
    expect(off.exclude).toEqual([]);
    if (a.exclude) expect(on.exclude.length).toBeGreaterThan(0);
  });
  it("labels an empty completed run as a zero result", () => {
    expect(scanOutcome({ status: "completed", counts: { found: 0 } })).toBe("Completed: no results");
    expect(scanOutcome({ status: "completed", counts: { found: 4 } })).toBe("Completed");
  });
});
