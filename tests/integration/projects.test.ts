import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activities, capitalRequirements, capitalTranches, constraints, deals, mandates, organizations, projectParties, projectReadiness,
  projects, projectStageHistory, risks, tasks,
} from "@/db/schema";
import { capitalSummary, createProject, createProjectFromDeal, projectAlerts, setReadiness, setStage } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const NOW = new Date("2026-09-24T12:00:00Z");

beforeEach(async () => {
  for (const x of [risks, tasks, capitalTranches, capitalRequirements, constraints, projectParties, projectReadiness, projectStageHistory, activities, deals, projects, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
});

describe("project spine", () => {
  it("creates a project with 14 readiness dimensions, all Unknown, and a stage history entry", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Tulum solar + storage", stage: "screening" }, "alan");
    const r = await t.db.select().from(projectReadiness).where(eq(projectReadiness.projectId, p.id));
    expect(r).toHaveLength(14);
    expect(new Set(r.map(x => x.status))).toEqual(new Set(["unknown"]));
    expect((await t.db.select().from(projectStageHistory))[0]).toMatchObject({ toStage: "screening", reason: "Created" });
  });

  it("creates a project from an opportunity, links it once, and proposes the organization as sponsor", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "Costa Verde", nameNormalized: "costa verde", country: "MEX", source: "other" }).returning();
    const [d] = await t.db.insert(deals).values({ mandateId: M, orgId: org.id, name: "Costa Verde: project diagnostic", path: "project_diagnostic" }).returning();
    const first = await createProjectFromDeal(t.db, d.id, "alan");
    expect(first.created).toBe(true);
    expect(await createProjectFromDeal(t.db, d.id, "alan")).toEqual({ id: first.id, created: false });
    const [p] = await t.db.select().from(projects).where(eq(projects.id, first.id));
    expect(p).toMatchObject({ name: "project diagnostic", country: "MEX", stage: "diagnostic", mandateId: M });
    expect((await t.db.select().from(deals))[0].projectId).toBe(first.id);
    expect(await t.db.select().from(projectParties)).toEqual([expect.objectContaining({ role: "sponsor", orgId: org.id, confirmed: "proposed" })]);
  });

  it("records stage moves with reasons and upserts readiness with evidence", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "P" }, "alan");
    expect(await setStage(t.db, p.id, "diagnostic", "alan", "Diagnostic signed")).toBe(true);
    expect(await setStage(t.db, p.id, "diagnostic", "alan")).toBe(false);
    await setReadiness(t.db, p.id, "land", { status: "blocked", evidence: "Title dispute (registry extract 2026-09-01)" }, "alan");
    await setReadiness(t.db, p.id, "land", { status: "in_progress" }, "alan");
    const [land] = await t.db.select().from(projectReadiness).where(eq(projectReadiness.dimension, "land"));
    expect(land).toMatchObject({ status: "in_progress", evidence: "Title dispute (registry extract 2026-09-01)", updatedBy: "alan" });
    expect((await t.db.select().from(projectStageHistory)).map(h => h.toStage).sort()).toEqual(["diagnostic", "opportunity"]);
  });

  it("sums capital by currency without double counting tranches, and computes what is needed within 180 days", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "P" }, "alan");
    const [dev] = await t.db.insert(capitalRequirements).values({ projectId: p.id, mandateId: M, purpose: "Development", instrument: "development_capital", target: 1_500_000, secured: 500_000, targetClose: "2026-12-31" }).returning();
    await t.db.insert(capitalRequirements).values([
      { projectId: p.id, mandateId: M, purpose: "Senior debt", instrument: "senior_debt", target: 150_000_000, targetClose: "2028-06-30" },
      { projectId: p.id, mandateId: M, purpose: "Catalytic", instrument: "catalytic", target: 5_000_000, currency: "EUR", targetClose: "2027-01-15" },
      { projectId: p.id, mandateId: M, purpose: "Old", instrument: "grant", target: 9_000_000, status: "cancelled" },
    ]);
    await t.db.insert(capitalTranches).values([
      { projectId: p.id, requirementId: dev.id, mandateId: M, name: "A", instrument: "development_capital", target: 1_000_000 },
      { projectId: p.id, requirementId: dev.id, mandateId: M, name: "B", instrument: "development_capital", target: 500_000 },
    ]);
    const s = await capitalSummary(t.db, p.id, NOW);
    expect(s.byCurrency.find(c => c.currency === "USD")).toEqual({ currency: "USD", target: 151_500_000, secured: 500_000, neededNow: 1_000_000 });
    expect(s.byCurrency.find(c => c.currency === "EUR")).toEqual({ currency: "EUR", target: 5_000_000, secured: 0, neededNow: 5_000_000 });
    expect(s.tranches).toHaveLength(2);
  });

  it("Today alerts: blockers, capital needed now and stage moves, only within the user's entities", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Visible" }, "alan");
    const hidden = await createProject(t.db, { mandateId: OTHER, name: "Hidden" }, "alan");
    await t.db.insert(constraints).values([
      { projectId: p.id, mandateId: M, category: "grid", description: "No interconnection capacity until 2028", severity: "critical" },
      { projectId: p.id, mandateId: M, category: "legal", description: "Minor", severity: "low" },
      { projectId: p.id, mandateId: M, category: "permitting", description: "EIA submission late", severity: "medium", deadline: "2026-09-01" },
      { projectId: hidden.id, mandateId: OTHER, category: "land", description: "Hidden", severity: "critical" },
    ]);
    await setReadiness(t.db, p.id, "permitting", { status: "blocked" }, "alan");
    await t.db.insert(capitalRequirements).values({ projectId: p.id, mandateId: M, purpose: "Pre-development", instrument: "development_capital", target: 500_000, targetClose: "2026-11-30" });
    await setStage(t.db, p.id, "diagnostic", "alan", "Signed", );
    const a = await projectAlerts(t.db, [M], NOW);
    expect(a.blocked.map(b => b.why)).toEqual(expect.arrayContaining([
      expect.stringContaining("critical grid"), expect.stringContaining("overdue 2026-09-01"), "Readiness blocked: Permitting",
    ]));
    expect(a.blocked.some(b => b.why.includes("Minor") || b.name === "Hidden")).toBe(false);
    expect(a.capitalNow).toEqual([expect.objectContaining({ name: "Visible", gap: 500_000, targetClose: "2026-11-30" })]);
    expect(a.moved).toEqual([expect.objectContaining({ name: "Visible", from: "opportunity", to: "diagnostic" })]);
  });

  it("critical workflow, first slice: project → location → sponsor → readiness → constraint → capital requirement → development tranche → Today", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", stage: "opportunity" }, "alan");
    await t.db.update(projects).set({ country: "MEX", subdivision: "Yucatán", lat: 20.97, lng: -89.62 }).where(eq(projects.id, p.id));
    const [sponsor] = await t.db.insert(organizations).values({ mandateId: M, name: "Sponsor SA", nameNormalized: "sponsor sa", source: "other" }).returning();
    await t.db.insert(projectParties).values({ projectId: p.id, mandateId: M, orgId: sponsor.id, role: "sponsor", confirmed: "confirmed" });
    await setStage(t.db, p.id, "diagnostic", "alan", "Diagnostic started");
    await setReadiness(t.db, p.id, "grid", { status: "blocked", evidence: "Utility letter 2026-09-10" }, "alan");
    await t.db.insert(constraints).values({ projectId: p.id, mandateId: M, category: "grid", description: "Substation at capacity", severity: "high", owner: "Sponsor", resolutionAction: "Apply for network upgrade", deadline: "2026-12-01" });
    const [req] = await t.db.insert(capitalRequirements).values({ projectId: p.id, mandateId: M, purpose: "Development", instrument: "development_capital", target: 2_000_000, targetClose: "2027-02-28" }).returning();
    await t.db.insert(capitalTranches).values({ projectId: p.id, requirementId: req.id, mandateId: M, name: "Development tranche", instrument: "development_capital", target: 2_000_000, targetInvestorType: "family offices" });
    const today = await projectAlerts(t.db, [M], NOW);
    expect(today.blocked.length).toBeGreaterThanOrEqual(2);
    expect(today.capitalNow[0]).toMatchObject({ name: "Valle Solar", purpose: "Development", gap: 2_000_000 });
    expect(today.moved[0]).toMatchObject({ to: "diagnostic" });
  });

  it("reaching Capital Alignment queues the capital work as an action; risks stay with their project", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan");
    await setStage(t.db, p.id, "capital_alignment", "alan", "Readiness substantially complete");
    const ts = await t.db.select().from(tasks);
    expect(ts).toEqual([expect.objectContaining({ projectId: p.id, title: "Capital alignment: set up capital opportunities for Valle Solar" })]);
    await t.db.insert(risks).values({ projectId: p.id, mandateId: M, category: "fx", description: "Peso depreciation vs USD debt", likelihood: "likely", impact: "high" });
    expect((await t.db.select().from(risks))[0]).toMatchObject({ status: "open", residual: "unknown" });
  });
});
