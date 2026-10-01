// Capital stack scenarios, funding pathways, opportunity stage gates and search for the new records (§10–12, §42).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  capitalRequirements, capitalStackLayers, capitalStructures, contacts, contracts, deals, fundingPathways, mandates, organizations, projectParties, projects, stageGates,
} from "@/db/schema";
import { createPathway, pathwayAlerts, setPathwayEligibility, setPathwayStatus, templateSteps, updatePathwaySteps } from "@/lib/capital/pathways";
import { createStructure, duplicateStructure, reviewStructure, saveStructure, structuresForProject, summarizeStack, type LayerInput } from "@/lib/capital/stack";
import type { UserScope } from "@/lib/db/scoped";
import { checkDealGate, ensureRulesAndGates } from "@/lib/events/engine";
import { createProject } from "@/lib/projects/engine";
import { globalSearch } from "@/lib/search";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";

beforeEach(async () => {
  for (const x of [fundingPathways, capitalStackLayers, capitalStructures, contracts, deals, stageGates, capitalRequirements, projectParties, projects, contacts, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

const L = (layer: LayerInput["layer"], amount: number | null, extra: Partial<LayerInput> = {}): LayerInput => ({ layer, provider: "", currency: "USD", amount, pricing: "", ratePct: null, tenorYears: null, amortization: "", security: "", status: "assumption", conditions: "", source: "", assumptionStatus: "assumption", ...extra });

describe("stack summary", () => {
  it("coverage, gap, mix, weighted rate over rated layers; guarantees do not fund", () => {
    const s = summarizeStack({ currency: "USD", totalCost: 100, layers: [
      L("senior_debt", 60, { ratePct: 7, status: "committed", assumptionStatus: "confirmed" }), L("sponsor_equity", 30, { ratePct: 14 }), L("guarantee", 50), L("grant", 5),
    ] });
    expect(s).toMatchObject({ funded: 95, gap: 5, coveragePct: 95, debtPct: 63.2, equityPct: 31.6, weightedRatePct: 9.33, rateCoveragePct: 94.7, committedPct: 63.2 });
    expect(s.layers.map(l => l.layer)).toEqual(["senior_debt", "sponsor_equity", "grant", "guarantee"]);
    expect(s.warnings.join(" ")).toMatch(/Funding gap of 5 USD/);
    expect(s.warnings.join(" ")).toMatch(/3 of 4 layers are unsourced/);
  });

  it("flags missing equity, heavy gearing, other currencies and missing cost", () => {
    const s = summarizeStack({ currency: "USD", totalCost: null, layers: [L("senior_debt", 90), L("mezzanine", 10, { currency: "EUR" })] });
    expect(s.coveragePct).toBeNull();
    const w = s.warnings.join(" ");
    expect(w).toMatch(/Total cost .* not set/);
    expect(w).toMatch(/No equity layer/);
    expect(w).toMatch(/in EUR; totals assume USD/);
    expect(w).toMatch(/Debt is 100% of funding/);
  });
});

describe("capital structures", () => {
  it("first scenario starts from requirements as assumptions; save, duplicate, preferred and review reset", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", capex: 100_000_000, currency: "USD" }, "alan");
    await t.db.insert(capitalRequirements).values([
      { projectId: p.id, mandateId: M, purpose: "Senior debt", instrument: "senior_debt", target: 70_000_000, currency: "USD" },
      { projectId: p.id, mandateId: M, purpose: "Sponsor equity", instrument: "sponsor_equity", target: 30_000_000, currency: "USD", status: "committed" },
    ]);
    const s = await createStructure(t.db, p.id, "Base", "alan");
    const [loaded] = await structuresForProject(t.db, p.id);
    expect(loaded).toMatchObject({ name: "Base", totalCost: 100_000_000, costSource: "Project record (capex)" });
    expect(loaded.layers.map(l => [l.layer, l.amount, l.status, l.assumptionStatus])).toEqual([["senior_debt", 70_000_000, "assumption", "assumption"], ["sponsor_equity", 30_000_000, "committed", "assumption"]]);

    await expect(reviewStructure(t.db, s.id, "reviewed", "", "alan")).rejects.toThrow(/reviewer/);
    await reviewStructure(t.db, s.id, "reviewed", "Counsel X, structure only, 2026-09-27", "alan");
    const sum = await saveStructure(t.db, s.id, { name: "Base", currency: "USD", totalCost: 100_000_000, costSource: "EPC budget", status: "preferred", notes: "" },
      [L("senior_debt", 65_000_000, { ratePct: 7.5 }), L("mezzanine", 5_000_000), L("sponsor_equity", 30_000_000)], "alan");
    expect(sum.gap).toBe(0);
    const [after] = await t.db.select().from(capitalStructures).where(eq(capitalStructures.id, s.id));
    expect(after).toMatchObject({ status: "preferred", reviewStatus: "not_reviewed" });

    const copy = await duplicateStructure(t.db, s.id, "Blended", "alan");
    expect((await t.db.select().from(capitalStackLayers).where(eq(capitalStackLayers.structureId, copy.id))).length).toBe(3);
    await saveStructure(t.db, copy.id, { name: "Blended", currency: "USD", totalCost: 100_000_000, costSource: "", status: "preferred", notes: "" }, [L("blended_finance", 100_000_000)], "alan");
    const all = await t.db.select().from(capitalStructures).where(eq(capitalStructures.projectId, p.id));
    expect(all.filter(x => x.status === "preferred").map(x => x.name)).toEqual(["Blended"]);
  });
});

describe("funding pathways", () => {
  it("template steps, eligibility needs a source to be confirmed, status follows the screen, alerts", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan");
    expect(templateSteps("dfi")[0].label).toMatch(/Concept note/);
    const fp = await createPathway(t.db, { projectId: p.id, name: "IFC senior loan", sourceType: "dfi", provider: "IFC", amount: 40_000_000, currency: "USD", deadline: "2026-10-05" }, "alan");
    expect(fp.steps.length).toBe(6);
    await expect(setPathwayStatus(t.db, fp.id, "eligible", "alan")).rejects.toThrow(/eligibility screen/);
    await expect(setPathwayEligibility(t.db, fp.id, "confirmed", "", "", "alan")).rejects.toThrow(/source/);
    await setPathwayEligibility(t.db, fp.id, "confirmed", "Country and sector in scope", "IFC email 2026-09-20", "alan");
    await setPathwayStatus(t.db, fp.id, "eligible", "alan");
    const steps = await updatePathwaySteps(t.db, fp.id, { toggle: "s1", add: { label: "Site visit", due: "2026-09-20" } }, "alan");
    expect(steps[0].done).toBe(true);
    const alerts = await pathwayAlerts(t.db, [M], "2026-09-27");
    expect(alerts.map(a => a.title)).toEqual(["IFC senior loan deadline", "Overdue step: Site visit"]);
    await setPathwayEligibility(t.db, fp.id, "not_eligible", "Ticket below minimum", "Programme rules", "alan");
    expect((await t.db.select().from(fundingPathways))[0].status).toBe("ineligible");
    expect(await pathwayAlerts(t.db, [M], "2026-09-27")).toEqual([]);
  });
});

describe("opportunity stage gates", () => {
  it("block until the deal and its linked project carry the evidence", async () => {
    await ensureRulesAndGates(t.db, M);
    expect((await t.db.select().from(stageGates).where(eq(stageGates.entityType, "deal"))).map(g => g.toStage).sort()).toEqual(["active", "engaged", "proposal", "signed"]);
    const [d] = await t.db.insert(deals).values({ mandateId: M, name: "Valle capital raise", path: "capital_mandate" }).returning();
    const g1 = await checkDealGate(t.db, d.id, "proposal");
    expect(g1.passed).toBe(false);
    expect(g1.results.find(r => r.id === "proposal:d5")?.detail).toBe("No project linked to this opportunity");
    expect(g1.results.map(r => r.id).slice(0, 2)).toEqual(["engaged:d1", "engaged:d2"]); // cumulative from Lead, deduplicated

    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "Valle Energía", nameNormalized: "valle energia", source: "other" }).returning();
    const [c] = await t.db.insert(contacts).values({ mandateId: M, orgId: org.id, fullName: "Ana Ruiz", nameNormalized: "ana ruiz", source: "other" }).returning();
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", country: "MX" }, "alan");
    await t.db.insert(projectParties).values({ projectId: p.id, mandateId: M, orgId: org.id, role: "sponsor" });
    await t.db.insert(capitalRequirements).values({ projectId: p.id, mandateId: M, purpose: "Senior debt", instrument: "senior_debt", target: 1, currency: "USD" });
    await t.db.update(deals).set({ orgId: org.id, contactId: c.id, valueEstimate: 250_000, projectId: p.id }).where(eq(deals.id, d.id));
    expect((await checkDealGate(t.db, d.id, "proposal")).passed).toBe(true);

    const signed = await checkDealGate(t.db, d.id, "signed");
    expect(signed.results.filter(r => !r.pass).map(r => r.id)).toEqual(["signed:d1", "signed:d2", "signed:d3"]);
    await t.db.update(deals).set({ stage: "signed" }).where(eq(deals.id, d.id));
    await t.db.insert(contracts).values({ mandateId: M, dealId: d.id, title: "Engagement letter", kind: "engagement_letter", lifecycle: "draft", body: "", terms: {} } as never);
    expect((await checkDealGate(t.db, d.id, "active")).passed).toBe(false);
    await t.db.update(contracts).set({ lifecycle: "effective" }).where(eq(contracts.dealId, d.id));
    expect((await checkDealGate(t.db, d.id, "active")).passed).toBe(true);
    expect((await checkDealGate(t.db, d.id, "lost")).gated).toBe(false);
  });

  it("project-diagnostic opportunities skip capital-only conditions", async () => {
    await ensureRulesAndGates(t.db, M);
    const [d] = await t.db.insert(deals).values({ mandateId: M, name: "Diagnostic", path: "project_diagnostic" }).returning();
    const ids = (await checkDealGate(t.db, d.id, "proposal")).results.map(r => r.id);
    expect(ids).toEqual(["engaged:d1", "engaged:d2", "proposal:d3", "proposal:d4", "proposal:d7"]);
  });
});

it("search finds pathways and structures in the user's entities", async () => {
  const p = await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan");
  await createPathway(t.db, { projectId: p.id, name: "Green Climate Fund concept", sourceType: "climate_fund", provider: "GCF", amount: null, currency: "USD", deadline: null }, "alan");
  await createStructure(t.db, p.id, "Green scenario", "alan");
  const scope: UserScope = { kind: "user", userId: "u", email: "u@example.com", mandateIds: [M], ownerOf: [] };
  const hits = await globalSearch(t.db, scope, "green");
  expect(hits.map(h => h.type)).toEqual(expect.arrayContaining(["Funding pathway", "Capital structure"]));
  // Only workspace records are scoped; the dataset catalogue is global reference data.
  expect((await globalSearch(t.db, { ...scope, mandateIds: ["other"] }, "green")).filter(h => h.type !== "Dataset").length).toBe(0);
});
