import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decisions, economicCases, esIssues, insurancePolicies, mandates, projectMilestones, projects, revenueStreams, studies } from "@/db/schema";
import { addMilestone, deliveryAlerts, setDependencies, setMilestoneStatus } from "@/lib/delivery/engine";
import { deriveScenarios, revenueFromStreams, saveCase, updateCaseInputs } from "@/lib/economics/engine";
import { DEFAULT_INPUTS } from "@/lib/economics/vocab";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const NOW = new Date("2026-09-24T12:00:00Z");

beforeEach(async () => {
  for (const x of [economicCases, revenueStreams, insurancePolicies, esIssues, studies, decisions, projectMilestones, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
});

describe("project delivery", () => {
  it("milestones: dependencies stay in the project, cycles are refused, completion is dated", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "P" }, "alan");
    const a = await addMilestone(t.db, { projectId: p.id, name: "Land option", durationDays: 30 }, "alan");
    const b = await addMilestone(t.db, { projectId: p.id, name: "Interconnection agreement", durationDays: 90, dependsOn: [a.id, "not-a-milestone"] }, "alan");
    expect(b.dependsOn).toEqual([a.id]);
    expect(await setDependencies(t.db, a.id, [b.id], "2026-09-24")).toBe(false);
    await setMilestoneStatus(t.db, a.id, "done", "alan", NOW);
    expect((await t.db.select().from(projectMilestones).where(eq(projectMilestones.id, a.id)))[0]).toMatchObject({ status: "done", completedAt: "2026-09-24" });
  });

  it("Today: late critical milestones, due decisions, missing studies, high E&S issues and insurance, within the user's entities", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", stage: "development", assetClass: "solar" }, "alan");
    const hidden = await createProject(t.db, { mandateId: OTHER, name: "Hidden", stage: "construction", assetClass: "wind" }, "alan");
    const land = await addMilestone(t.db, { projectId: p.id, name: "Land lease signed", durationDays: 60 }, "alan");
    await addMilestone(t.db, { projectId: p.id, name: "PPA condition: permits by Nov 15", durationDays: 30, dependsOn: [land.id], dueDate: "2026-11-15", evidence: "PPA clause 7.2" }, "alan");
    await addMilestone(t.db, { projectId: p.id, name: "Far away", durationDays: 1, dueDate: "2027-06-01" }, "alan");
    await addMilestone(t.db, { projectId: hidden.id, name: "Hidden overdue", durationDays: 1, dueDate: "2026-01-01" }, "alan");
    await t.db.insert(decisions).values([
      { projectId: p.id, mandateId: M, title: "Choose EPC shortlist", dueDate: "2026-09-28" },
      { projectId: p.id, mandateId: M, title: "Later", dueDate: "2026-12-01" },
    ]);
    await t.db.insert(studies).values({ projectId: p.id, mandateId: M, type: "topography", status: "final" });
    await t.db.insert(esIssues).values([
      { projectId: p.id, mandateId: M, topic: "critical_habitat", framework: "ifc_ps", reference: "PS6", description: "Jaguar corridor overlaps the north block", severity: "critical" },
      { projectId: p.id, mandateId: M, topic: "noise", description: "Minor", severity: "low" },
    ]);
    await t.db.insert(insurancePolicies).values([
      { projectId: p.id, mandateId: M, type: "gl", phase: "both", status: "bound", expiresAt: "2026-10-30" },
      { projectId: hidden.id, mandateId: OTHER, type: "car", status: "required" },
    ]);

    const a = await deliveryAlerts(t.db, [M], NOW);
    expect(a.milestones.map(x => x.name)).toEqual(["PPA condition: permits by Nov 15"]);
    expect(a.milestones[0]).toMatchObject({ red: true, why: expect.stringContaining("Critical path: forecast 2026-12-23") });
    expect(a.decisions.map(x => x.title)).toEqual(["Choose EPC shortlist"]);
    expect(a.missingEngineering).toEqual([{ projectId: p.id, project: "Valle Solar", missing: expect.arrayContaining(["geotechnical", "resource", "grid", "flood", "esia"]) }]);
    expect(a.missingEngineering[0].missing).not.toContain("topography");
    expect(a.es.map(x => x.topic)).toEqual(["critical_habitat"]);
    expect(a.insurance).toEqual([expect.objectContaining({ type: "gl", why: "Expires", date: "2026-10-30" })]);

    const all = await deliveryAlerts(t.db, null, NOW);
    expect(all.insurance.map(x => x.why)).toContain("Required in construction, not bound");
    expect(all.milestones.map(x => x.name)).toContain("Hidden overdue");
  });

  it("economics: revenue from streams in one currency; a base case derives downside and upside, refreshed on edit", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "P" }, "alan");
    const rows = await t.db.insert(revenueStreams).values([
      { projectId: p.id, mandateId: M, mechanism: "ppa", name: "PPA", unitPrice: 55, annualVolume: 100_000, currency: "USD" },
      { projectId: p.id, mandateId: M, mechanism: "environmental_credit", name: "I-RECs", unitPrice: 2, annualVolume: 100_000, currency: "MXN" },
      { projectId: p.id, mandateId: M, mechanism: "merchant", name: "Merchant", currency: "USD" },
    ]).returning();
    expect(revenueFromStreams(rows, "USD")).toEqual({ total: 5_500_000, skipped: ["I-RECs: in MXN", "Merchant: price or volume missing"] });

    const inputs = { ...DEFAULT_INPUTS, currency: "USD", capex: 40_000_000, revenueYear1: 5_500_000, opexYear1: 700_000 };
    const baseCase = await saveCase(t.db, p.id, { name: "Base", kind: "base", inputs, source: "Sponsor model v3" }, "alan");
    expect(baseCase.outputs!.projectIrr).toBeGreaterThan(0);
    await deriveScenarios(t.db, baseCase.id, "alan");
    await deriveScenarios(t.db, baseCase.id, "alan");
    const cases = await t.db.select().from(economicCases).where(eq(economicCases.projectId, p.id));
    expect(cases.map(c => c.kind).sort()).toEqual(["base", "downside", "upside"]);
    const down = cases.find(c => c.kind === "downside")!;
    expect(down.inputs.capex).toBeCloseTo(46_000_000);
    expect(down.outputs!.equityIrr!).toBeLessThan(baseCase.outputs!.equityIrr!);

    await updateCaseInputs(t.db, baseCase.id, { ...inputs, capex: 50_000_000 }, "alan");
    const [down2] = await t.db.select().from(economicCases).where(eq(economicCases.id, down.id));
    expect(down2.inputs.capex).toBeCloseTo(57_500_000);
  });
});
