import { describe, expect, it } from "vitest";
import { audience } from "@/lib/scan/audiences";
import { PARTNER_TYPES, projectPresetKey, projectScanConfig, reachOf, type PartnerType } from "@/lib/scan/project-scan";

const project = { country: "NAM", technology: "Solar PV + BESS", assetClass: null, capacity: 54, capacityUnit: "MW", stage: "development" } as const;

describe("project partner scans", () => {
  it("every partner type points at a real audience", () => {
    for (const k of Object.keys(PARTNER_TYPES) as PartnerType[]) expect(audience(PARTNER_TYPES[k].audience), k).toBeTruthy();
  });
  it("reach: country, the country's region, or worldwide", () => {
    expect(reachOf("NAM", "country")).toEqual(["NAM"]);
    expect(reachOf("NAM", "region")).toEqual(["africa"]);
    expect(reachOf("NAM", "global")).toEqual([]);
    expect(reachOf(null, "region")).toEqual([]);
  });
  it("builds a reviewable config from the project: audience, geography, technology terms, stage", () => {
    const epc = projectScanConfig(project, "epc");
    expect(epc).toMatchObject({ audience: "epc_engineering", geography: ["africa"], stages: ["development"], requireReview: true });
    expect(epc.terms).toEqual(expect.arrayContaining(["solar", "storage", "BESS"]));
    const dfi = projectScanConfig(project, "dfis");
    expect(dfi.geography).toEqual([]);
    expect(dfi.providers).not.toContain("apollo_orgs");
    expect(dfi.signalCriteria).toMatch(/54 MW Solar PV \+ BESS at development stage in NAM/);
    expect(projectScanConfig(project, "advisory").geography).toEqual(["NAM"]);
    expect(projectPresetKey("0123456789abcdef", "epc")).toBe("proj_01234567_epc");
  });
});
