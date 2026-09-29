// Financial model records: template creation, change log, versions and reasons, approval gate, lock, financeability
// basis, ATLAS quantities into CAPEX, and a valid XLSX package.
import { eq } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { finChanges, finModels, mandates, projects, siteFeatures } from "@/db/schema";
import { applySiteQuantities, approveModel, createModel, newVersion, saveDefinition, setFinanceability, siteQuantities } from "@/lib/finance/engine";
import { modelWorkbook } from "@/lib/finance/xlsx";
import { saveFeature } from "@/lib/geo/workbench";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [finChanges, finModels, siteFeatures, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

it("template, change log, approval gate, lock, versions and financeability basis", async () => {
  const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", capacity: 40, capacityUnit: "MW", currency: "USD" }, "alan");
  const m = await createModel(t.db, { projectId: p.id, name: "Screening", template: "utility_solar" }, "alan");
  expect(m.definition.generation?.capacityMw).toBe(40);
  expect(m.health).toBe("ERROR"); // placeholders and zero CAPEX
  await expect(approveModel(t.db, m.id, "Reviewer", "alan")).rejects.toThrow(/health is ERROR/);

  const def = structuredClone(m.definition);
  def.capex.forEach(l => { l.quantity = 1; l.unitCost = 1_000_000; l.status = "supported"; l.source = "EPC quote v1"; });
  def.generation!.capacityFactorPct = 24;
  def.revenue[0].price = 55; def.revenue[0].status = "supported"; def.revenue[0].source = "Offtaker LOI";
  def.opex.forEach(o => { o.amount = 100_000; o.status = "supported"; o.source = "O&M quote"; });
  def.debt = { ...def.debt!, targetDscr: 1.3, maxGearingPct: 70, ratePct: 7.5, tenorYears: 15, lockupDscr: 1.1, status: "supported", source: "Term sheet" };
  def.discountRatePct = 9; def.equityHurdlePct = 12; def.tax.ratePct = 30;
  const r = await saveDefinition(t.db, m.id, def, "", "alan");
  expect(r.changed).toBeGreaterThan(10);
  const [saved] = await t.db.select().from(finModels).where(eq(finModels.id, m.id));
  expect(saved.summary.debt).toBeGreaterThan(0);
  expect((await t.db.select().from(finChanges).where(eq(finChanges.modelId, m.id))).some(c => c.path === "revenue[r0].price")).toBe(true);

  await approveModel(t.db, m.id, "J. Analyst, Regenera", "alan");
  await expect(saveDefinition(t.db, m.id, { ...def, discountRatePct: 10 }, "x", "alan")).rejects.toThrow(/locked/);
  const v2 = await newVersion(t.db, m.id, "Lender case", "lender", "alan");
  expect(v2.version).toBe(2);
  await expect(saveDefinition(t.db, v2.id, { ...def, discountRatePct: 10 }, "", "alan")).rejects.toThrow(/reason/);
  expect((await saveDefinition(t.db, v2.id, { ...def, discountRatePct: 10 }, "Lender base rate", "alan")).changed).toBe(1);
  await expect(setFinanceability(t.db, v2.id, "structurable", "", "alan")).rejects.toThrow(/basis/);
  await setFinanceability(t.db, v2.id, "structurable", "Debt sized at 1.30x against indicative DFI terms (J. Analyst)", "alan");

  const wb = unzipSync(modelWorkbook("Valle — V2", { version: 2, caseType: "lender", status: "draft", preparedBy: "alan", approvedBy: null }, def));
  expect(Object.keys(wb)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet7.xml"]));
  expect(strFromU8(wb["xl/workbook.xml"])).toContain('name="Cash flow"');
});

it("ATLAS quantities feed CAPEX lines without setting unit costs", async () => {
  const p = await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan");
  await saveFeature(t.db, { mandateId: M, projectId: p.id, purpose: "road", name: "Access", geometry: { type: "LineString", coordinates: [[0, 0], [0, 0.01]] } }, "alan");
  await saveFeature(t.db, { mandateId: M, projectId: p.id, purpose: "transmission_route", name: "Tie-in", geometry: { type: "LineString", coordinates: [[0, 0], [0.05, 0]] } }, "alan");
  const q = await siteQuantities(t.db, p.id);
  expect(q.roadKm).toBeCloseTo(1.11, 1); expect(q.transmissionKm).toBeCloseTo(5.57, 1);
  const m = await createModel(t.db, { projectId: p.id, name: "S", template: "utility_solar" }, "alan");
  const next = applySiteQuantities(m.definition, q);
  const road = next.capex.find(l => l.label === "Access roads")!;
  expect(road).toMatchObject({ unit: "km", unitCost: 0, fromSite: "ATLAS: road features" });
  expect(road.quantity).toBeCloseTo(1.11, 1);
});
