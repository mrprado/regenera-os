// Phase 15: audience targeting, deterministic screening, presets and the audience-to-offer catalogue.
import { describe, expect, it } from "vitest";
import { AUDIENCES, audience, uniqueTitles, SEGMENT_KEYS } from "@/lib/scan/audiences";
import { configFingerprint, creditCeiling, zScanConfig } from "@/lib/scan/config";
import { country, expandGeography } from "@/lib/scan/countries";
import { screenOrganization } from "@/lib/scan/criteria";
import { offerAudienceValid, OFFERS } from "@/lib/scan/offers";
import { BUILT_IN_PRESETS } from "@/lib/scan/presets";
import { companyTermsFor } from "@/lib/radar/playbooks";

const org = (o: Partial<Parameters<typeof screenOrganization>[0]> = {}) => ({ name: "Acme", country: null, industry: null, description: null, headcount: null, domain: null, website: null, ...o });
const cfg = (o: Partial<ReturnType<typeof zScanConfig.parse>> = {}) => zScanConfig.parse({ audience: "epc_engineering", ...o });

describe("audience targeting", () => {
  it("keeps audiences distinct: banks never inherit EPC or law-firm terms, real estate never utilities or resorts", () => {
    const banks = companyTermsFor("banks_lenders").join(" ").toLowerCase();
    expect(banks).not.toMatch(/epc|engineering|law/);
    const re = companyTermsFor("real_estate_developers").join(" ").toLowerCase();
    expect(re).not.toMatch(/utility|agribusiness|resort|manufactur/);
    expect(new Set(AUDIENCES.map(a => a.key)).size).toBe(AUDIENCES.length);
  });
  it("maps audiences only to existing prospecting segments", () => {
    for (const a of AUDIENCES) if (a.segmentKey) expect(SEGMENT_KEYS.has(a.segmentKey), a.key).toBe(true);
  });
  it("dedupes titles case-insensitively", () => {
    expect(uniqueTitles(["Head of Development", "head of development", " Head  of development", "CIO"])).toEqual(["Head of Development", "CIO"]);
  });
  it("every offer references a known audience, and pricing comes only from the services catalogue", () => {
    for (const o of OFFERS) { expect(offerAudienceValid(o), o.key).toBe(true); expect(o.commercialModel).not.toMatch(/\$\s?\d|USD\s?\d/); }
    expect(OFFERS.filter(o => o.audience === "epc_engineering").map(o => o.motion).sort()).toEqual(["client", "delivery_partner", "introducer"]);
  });
  it("built-in presets parse and reference real audiences", () => {
    for (const p of BUILT_IN_PRESETS) expect(audience(p.config.audience), p.key).not.toBeNull();
  });
});

describe("countries", () => {
  it("resolves ISO3, ISO2 and names, and expands regions", () => {
    expect(country("MEX")?.name).toBe("Mexico");
    expect(country("mx")?.iso3).toBe("MEX");
    expect(country("Canada")?.iso3).toBe("CAN");
    expect(expandGeography(["MEX", "south_america"])).toContain("BRA");
  });
});

describe("screening", () => {
  const epc = audience("epc_engineering")!;
  it("supports geography and audience only from evidence", () => {
    const s = screenOrganization(org({ country: "MEX", industry: "Solar EPC contractor" }), epc, cfg({ geography: ["MEX"] }));
    expect(s.match).toBe("matches");
    expect(s.criteria.find(c => c.key === "geography")!.result).toBe("supported");
  });
  it("a name alone never proves the audience; missing data is unknown, not contradicted", () => {
    const s = screenOrganization(org({ name: "Sol EPC SA" }), epc, cfg({ geography: ["MEX"] }));
    expect(s.criteria.find(c => c.key === "audience")!.result).toBe("unknown");
    expect(s.criteria.find(c => c.key === "geography")!.result).toBe("unknown");
    expect(s.match).toBe("unknown");
    expect(s.missing[0]).toMatch(/Website/);
  });
  it("excludes on an out-of-geography country or an exclusion word, with the reason", () => {
    expect(screenOrganization(org({ country: "BRA", industry: "EPC" }), epc, cfg({ geography: ["MEX"] })).match).toBe("excluded");
    const law = screenOrganization(org({ industry: "Energy law firm" }), epc, cfg());
    expect(law.match).toBe("excluded");
    expect(law.exclusionReason).toMatch(/law/i);
  });
  it("credit ceiling counts organization pages plus the enrichment budget; fingerprints ignore order", () => {
    expect(creditCeiling(cfg({ providers: ["apollo_orgs"], maxOrganizations: 150, enrichmentBudget: 5 }))).toBe(7);
    expect(configFingerprint(cfg({ geography: ["MEX", "USA"] }))).toBe(configFingerprint(cfg({ geography: ["USA", "MEX"] })));
  });
});
