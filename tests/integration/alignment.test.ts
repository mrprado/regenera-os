// Capital alignment: evidence-gated items and classification, incentive evidence chain, nature-adjusted scenarios
// (from financial model outputs), the Command alignment totals, flow summaries and the land-cover tally.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capitalFlows, finModels, incentives, mandates, natureAssessments, natureScenarios, projects } from "@/db/schema";
import { addItem, capitalAlignment, classifyAssessment, createAssessment, flowSummary, incentiveEvidenceGaps, saveFlow, saveIncentive, scenarioComparison, tradeoffLines } from "@/lib/alignment/engine";
import { tally, tileName } from "@/lib/geo/landcover";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [natureScenarios, natureAssessments, incentives, capitalFlows, finModels, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

describe("nature transition", () => {
  it("requires evidence, a basis, and explains high impacts before nature-positive", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
    await t.db.update(projects).set({ capex: 100_000_000, currency: "USD" }).where(eq(projects.id, p.id));
    const a = await createAssessment(t.db, { mandateId: M, name: "Valle NT", subjectType: "project", projectId: p.id }, "alan");
    expect(a.capitalAmount).toBe(100_000_000);
    await expect(addItem(t.db, a.id, "impacts", { kind: "land_conversion", materiality: "high", description: "Clearing", evidence: " " }, "alan")).rejects.toThrow(/Evidence/);
    await addItem(t.db, a.id, "impacts", { kind: "land_conversion", materiality: "high", description: "Clearing of 120 ha dry forest", evidence: "WorldCover 2021 baseline", metric: "habitat", value: 120, unit: "ha" }, "alan");
    await expect(classifyAssessment(t.db, a.id, "transition", "short", "alan")).rejects.toThrow(/basis/);
    await expect(classifyAssessment(t.db, a.id, "nature_positive", "Because the project is a solar farm with a nice design.", "alan")).rejects.toThrow(/High-materiality/);
    await classifyAssessment(t.db, a.id, "transition", "Replaces diesel generation; 120 ha clearing mitigated by 80 ha restoration commitment.", "alan");

    const totals = await capitalAlignment(t.db, [M]);
    expect(totals.byAlignment.transition).toBe(100_000_000);
    expect(totals.materialRisk).toBe(100_000_000);
    const q = await createProject(t.db, { mandateId: M, name: "Other" }, "alan");
    await t.db.update(projects).set({ capex: 20_000_000, currency: "USD" }).where(eq(projects.id, q.id));
    expect((await capitalAlignment(t.db, [M])).byAlignment.unclassified).toBe(20_000_000);
  });

  it("compares scenarios using model outputs and never monetises without a methodology", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
    const a = await createAssessment(t.db, { mandateId: M, name: "NT", subjectType: "project", projectId: p.id, capitalAmount: 1 }, "alan");
    const [m] = await t.db.insert(finModels).values({ mandateId: M, projectId: p.id, name: "Base", definition: {} as never, summary: { capex: 100_000_000, projectIrr: 18 } }).returning();
    await t.db.insert(natureScenarios).values({ mandateId: M, assessmentId: a.id, name: "Conventional", finModelId: m.id, habitatLossHa: 120, natureRisk: "high", createdAt: "2026-01-01T00:00:00Z" });
    await t.db.insert(natureScenarios).values({ mandateId: M, assessmentId: a.id, name: "Lower-impact", capex: 107_000_000, irrPct: 16.8, habitatLossHa: 42, mitigationCost: 1_000_000, createdAt: "2026-01-02T00:00:00Z" });
    const v = await scenarioComparison(t.db, a.id);
    expect(v[0]).toMatchObject({ capexUsed: 100_000_000, irrUsed: 18, fromModel: true });
    expect(v[1].deltas).toEqual({ capexPct: 7, irrPp: -1.2, habitatPct: -65 });
    expect(v[1].natureCostMonetised).toBeNull();
    expect(tradeoffLines(v)[0]).toMatch(/reduces habitat loss by 65%, increases CAPEX by 7%, moves IRR by -1.2 pp/);
  });
});

describe("incentives and flows", () => {
  it("blocks classification without the evidence chain", async () => {
    const base = { mandateId: M, country: "MEX", name: "Tariff 9-CU", sector: "agriculture" as const, mechanism: "input_subsidy" as const };
    expect(incentiveEvidenceGaps({ policyRef: "", mechanism: "other", beneficiary: "", economicEffect: "", environmentalEvidence: "" })).toEqual(["policyRef", "beneficiary", "economicEffect", "environmentalEvidence"]);
    await expect(saveIncentive(t.db, { ...base, classification: "potentially_negative" }, "alan")).rejects.toThrow(/needs evidence/);
    const ok = await saveIncentive(t.db, { ...base, classification: "potentially_negative", policyRef: "Tarifa 9-CU", beneficiary: "Irrigators", economicEffect: "Subsidised pumping", environmentalEvidence: "Aquifer drawdown studies" }, "alan");
    expect(ok.classifiedBy).toBe("alan");
  });

  it("summarises flows by sector, alignment and redirectable share", async () => {
    await expect(saveFlow(t.db, { mandateId: M, system: "Lerma", sector: "agriculture", amount: 10, source: "" }, "alan")).rejects.toThrow(/source/);
    await saveFlow(t.db, { mandateId: M, system: "Lerma", sector: "agriculture", amount: 60, source: "Budget", alignment: "potentially_negative", alignmentBasis: "Aquifer overdraft", redirectable: "partial" }, "alan");
    await saveFlow(t.db, { mandateId: M, system: "Lerma", sector: "restoration", amount: 5, source: "Budget", redirectable: "yes" }, "alan");
    const s = flowSummary(await t.db.select().from(capitalFlows));
    expect(s.total).toBe(65); expect(s.partly).toBe(60); expect(s.redirectable).toBe(5);
    expect(s.byAlignment.get("unclassified")).toBe(5);
  });
});

describe("land cover", () => {
  it("names WorldCover tiles and tallies masked areas", () => {
    expect(tileName(20.97, -89.62)).toBe("N18W090");
    expect(tileName(-0.5, 10.2)).toBe("S03E009");
    // 4x4 grid over a 0.004° square at the equator; polygon covers the left half.
    const vals = [10, 10, 40, 40, 10, 10, 40, 40, 10, 10, 40, 40, 10, 10, 40, 40];
    const r = tally(vals, 4, 4, [0, 0, 0.004, 0.004], [[[[0, 0], [0.002, 0], [0.002, 0.004], [0, 0.004], [0, 0]]]]);
    expect(r.cells).toBe(8);
    expect([...r.counts.keys()]).toEqual([10]);
    expect(r.areaHa).toBeCloseTo(0.002 * 111_320 * 0.004 * 110_574 / 10_000, 1);
  });
});
