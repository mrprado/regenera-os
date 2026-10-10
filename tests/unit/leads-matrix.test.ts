// Phase 27: lead queries are built from role × sector × instrument × geography, and never target community bodies.
import { describe, expect, it } from "vitest";
import { buildLeadQuery, isCommunityBody, LEAD_WORKFLOWS, leadSectorFor, WORKFLOWS_FOR } from "@/lib/leads/matrix";

describe("lead query matrix", () => {
  it("keeps instrument words out of non-capital searches", () => {
    const q = buildLeadQuery({ workflow: "operators", sector: "energy", instrument: "blended", country: "Mexico" });
    expect(q.peopleBoolean).not.toMatch(/blended|concessional|green bond/i);
    expect(q.peopleBoolean).toContain('"Head Of Origination"');
    expect(q.peopleBoolean).toContain('"renewable energy"');
    expect(q.apollo.person_locations).toEqual(["Mexico"]);
  });
  it("searches capital by how it invests, then the sector", () => {
    const bond = buildLeadQuery({ workflow: "bond_arrangers", sector: "water" });
    expect(bond.peopleBoolean).toMatch(/\("green bond" OR "sustainability-linked bond" OR "debt capital markets" OR water OR wastewater\)/);
    const blended = buildLeadQuery({ workflow: "blended", sector: "agriculture" });
    expect(blended.companyBoolean).toContain('"development finance institution"');
    expect(blended.peopleBoolean).toContain('"blended finance"');
  });
  it("targets a named organisation instead of topics when one is given", () => {
    const q = buildLeadQuery({ workflow: "sponsor", sector: "energy", organization: "Valle Energía" });
    expect(q.peopleBoolean).toContain('AND "Valle Energía"');
    expect(q.apollo.q_keywords).toBe("Valle Energía");
  });
  it("excludes community and Indigenous bodies from every search", () => {
    for (const w of Object.keys(LEAD_WORKFLOWS) as (keyof typeof LEAD_WORKFLOWS)[]) {
      const q = buildLeadQuery({ workflow: w });
      expect(q.peopleBoolean).toMatch(/NOT \(indigenous OR "community land trust"/);
      expect(q.companyBoolean).toMatch(/NOT \(indigenous/);
    }
    expect(isCommunityBody("Consejo Indígena de la Sierra")).toBe(false); // accent: caught by the communities table link instead
    expect(isCommunityBody("Ejido San Juan")).toBe(true);
    expect(isCommunityBody("Acme Energy", "partner community")).toBe(true);
    expect(isCommunityBody("Acme Energy", "developer")).toBe(false);
  });
  it("capitalises words, quotes phrases, and offers the right workflows per record", () => {
    const q = buildLeadQuery({ workflow: "public" });
    expect(q.peopleBoolean).toContain('"Director Of Public Works"');
    expect(WORKFLOWS_FOR.bond[0]).toBe("bond_arrangers");
    expect(WORKFLOWS_FOR.capital_need).toContain("blended");
    expect(leadSectorFor("solar_pv")).toBe("energy");
    expect(leadSectorFor("regenerative_agriculture")).toBe("agriculture");
    expect(leadSectorFor(null)).toBeNull();
  });
});
