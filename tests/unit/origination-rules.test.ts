import { describe, expect, it } from "vitest";
import { assessEligibility, capitalStageOf } from "@/lib/origination/eligibility";
import { recommendForOrg, recommendForProject } from "@/lib/origination/engine";
import { scoreReadiness, templateFor } from "@/lib/origination/readiness";

const rules = { status: "open", deadline: "2099-01-01", countries: ["Namibia"], sectors: ["energy"], applicantTypes: ["Businesses"], amountMin: null, amountMax: 3e6, currency: "USD", type: "grant", source: "worldbank" };
const facts = { country: "NAM", sector: "energy", stage: "screening", capexUsd: null, capitalNeedUsd: 2e6, sponsorGroups: ["corporate"] };

describe("phase 22 eligibility: five outcomes, never a score", () => {
  it("eligible on stated criteria", () => expect(assessEligibility(rules, facts, "2026-10-08").eligibility).toBe("eligible"));
  it("ineligible when a hard rule fails", () => expect(assessEligibility({ ...rules, applicantTypes: ["Local government"] }, facts, "2026-10-08").eligibility).toBe("ineligible"));
  it("expired or closed", () => expect(assessEligibility({ ...rules, deadline: "2020-01-01" }, facts, "2026-10-08").eligibility).toBe("expired_or_closed"));
  it("insufficient evidence without a project country", () => expect(assessEligibility(rules, { ...facts, country: null }, "2026-10-08").eligibility).toBe("insufficient_evidence"));
  it("potentially eligible with unknowns, and asks the questions", () => {
    const e = assessEligibility({ ...rules, applicantTypes: [] }, { ...facts, sponsorGroups: [] }, "2026-10-08");
    expect(e.eligibility).toBe("potentially_eligible");
    expect(e.questions.join(" ")).toMatch(/legal entity type/);
  });
  it("capital stage from project stage", () => {
    expect(capitalStageOf("screening")).toBe("development");
    expect(capitalStageOf("construction")).toBe("construction");
    expect(capitalStageOf("operations")).toBe("long_term");
  });
});

describe("phase 22 readiness rubric and commercial operations engine", () => {
  it("picks the sector template and treats unknown as insufficient", () => {
    const t = templateFor({ name: "Landfill gas to energy", technology: "biogas" });
    expect(t.key).toBe("waste");
    expect(scoreReadiness(t, []).reading).toBe("insufficient_evidence");
  });
  it("recommends services by need", () => {
    expect(recommendForProject("insufficient_evidence", false).key).toBe("project_diagnostic");
    expect(recommendForProject("early", true).key).toBe("funding_diagnostic");
    expect(recommendForOrg(["epc"])?.key).toBe("ai_systems_implementation");
    expect(recommendForOrg(["oem"])?.key).toBe("technology_commercialization");
    expect(recommendForOrg(["investor"])?.key).toBe("capital_provider_screening");
  });
});
