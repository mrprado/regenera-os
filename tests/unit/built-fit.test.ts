// Built environment fit engine (§8): inferred site profile, explained recommendations with confidence (no score),
// explicit mismatches excluded, passive design strategies, and guarded sustainability words.
import { describe, expect, it } from "vitest";
import { designStrategies, evaluate, guardedClaimIssues, siteProfile, solutionStack, type Candidate } from "@/lib/built/fit";

const yucatan = siteProfile({ lat: 21.05, lng: -89.55, assetClass: "mixed_use", sector: "land_built_environment", stage: "screening", country: "MEX", description: "Illustrative eco park" }, [{ label: "Precipitation", value: "3.1 mm/day" }], ["water_stress"]);

describe("site profile", () => {
  it("infers climate, hazards and type, and says it inferred them", () => {
    expect(yucatan.climate).toBe("tropical_humid");
    expect(yucatan.hazards).toEqual(expect.arrayContaining(["hurricane", "drought"]));
    expect(yucatan.projectType).toBe("hospitality");
    expect(yucatan.climateBasis).toMatch(/Inferred/);
    expect(siteProfile({ lat: null, lng: null, assetClass: null, sector: null, stage: "opportunity", country: null }).climate).toBeNull();
  });
});

describe("recommendations", () => {
  const cand = (over: Partial<Candidate>): Candidate => ({ subjectType: "technology", id: "t", name: "X", category: "construction", maturity: "proven", climates: [], hazards: [], buildingTypes: [], stageFit: [], effects: {}, providers: ["o1"], ...over });
  it("explains fit and never returns a numeric score", () => {
    const r = evaluate(cand({ climates: ["tropical_humid"], hazards: ["hurricane"], buildingTypes: ["hospitality"], effects: { embodied: "lower" } }), yucatan)!;
    expect(r.confidence).toBe("high");
    expect(r.reason).toMatch(/tropical humid.*hospitality.*hurricane/);
    expect(r.impacts.carbon).toBe("lower");
    expect(JSON.stringify(r)).not.toMatch(/score/);
  });
  it("excludes explicit climate or building-type mismatches", () => {
    expect(evaluate(cand({ climates: ["cold"] }), yucatan)).toBeNull();
    expect(evaluate(cand({ buildingTypes: ["data_center"] }), yucatan)).toBeNull();
  });
  it("pilot-stage technology is labelled as pilot risk with lower confidence", () => {
    expect(evaluate(cand({ maturity: "pilot" }), yucatan)!.confidence).toBe("low");
  });
  it("adds passive design and resilience strategies by climate and hazard", () => {
    const d = designStrategies(yucatan).map(x => x.label);
    expect(d).toEqual(expect.arrayContaining(["Cross-ventilation and elevated floors", "Wind-rated envelope and roof tie-downs", "Water-sensitive site design"]));
    const s = solutionStack([cand({ category: "energy", name: "PV" })], yucatan);
    expect(s.stack.map(g => g.category)).toEqual(expect.arrayContaining(["design", "resilience", "energy", "water"]));
  });
});

describe("claims", () => {
  it("refuses guarded words without a supporting non-unverified claim", () => {
    expect(guardedClaimIssues("A carbon-negative, sustainable block", [])).toEqual(["carbon-negative", "sustainable"]);
    expect(guardedClaimIssues("A carbon-negative block", [{ claim: "Carbon negative per EPD", verification: "third_party_verified" }])).toEqual([]);
    expect(guardedClaimIssues("Regenerative materials", [{ claim: "regenerative sourcing", verification: "unverified" }])).toEqual(["regenerative"]);
  });
});
