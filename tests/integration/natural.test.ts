// Natural asset layer: land-pipeline gates and conversion, inventory ledger (forward-only, splits, issuance, buffer,
// retirement), permanence buffer, offtake revenue and model stream, coverage, and the certification data room.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { certifications, creditLots, landCandidates, mandates, monitoringPeriods, projects } from "@/db/schema";
import { dataRoom, defaultDiligence, inventorySummary, landGate, moveLand, moveLot, offtakeCoverage, offtakeRevenue, offtakeToRevenueStream, permanenceBuffer, recordIssuance } from "@/lib/natural/engine";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [creditLots, monitoringPeriods, certifications, landCandidates, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

describe("land pipeline", () => {
  it("moves forward only, gates on diligence, and converts to a project", async () => {
    const geometry = JSON.stringify({ type: "Polygon", coordinates: [[[-89.6, 20.9], [-89.5, 20.9], [-89.5, 21], [-89.6, 20.9]]] });
    const [c] = await t.db.insert(landCandidates).values({ mandateId: M, name: "Finca Norte", geometry, lat: 20.95, lng: -89.55, diligence: defaultDiligence(), capitalRequired: 2_000_000 }).returning();
    await moveLand(t.db, c.id, "screening", "alan");
    await expect(moveLand(t.db, c.id, "identified", "alan")).rejects.toThrow(/forward/);
    await moveLand(t.db, c.id, "diligence", "alan");
    await expect(moveLand(t.db, c.id, "option", "alan")).rejects.toThrow(/Start diligence/);
    const d = defaultDiligence().map(x => ({ ...x, status: "clear" as const }));
    d[0].status = "issue";
    await t.db.update(landCandidates).set({ diligence: d }).where(eq(landCandidates.id, c.id));
    await moveLand(t.db, c.id, "option", "alan");
    await expect(moveLand(t.db, c.id, "acquisition", "alan")).rejects.toThrow(/Title search/);
    d[0].status = "clear";
    await t.db.update(landCandidates).set({ diligence: d, hectares: 420 }).where(eq(landCandidates.id, c.id));
    await moveLand(t.db, c.id, "acquisition", "alan");
    await moveLand(t.db, c.id, "acquired", "alan");
    const pid = await moveLand(t.db, c.id, "project", "alan");
    const [p] = await t.db.select().from(projects).where(eq(projects.id, pid!));
    expect(p).toMatchObject({ name: "Finca Norte", capacity: 420, capacityUnit: "ha", capex: 2_000_000, geometry });
    expect(landGate({ stage: "screening", diligence: [], hectares: null, geometry: null, lat: 1 }, "dropped", "")).toMatch(/reason/);
  });
});

describe("inventory ledger", () => {
  it("issues from verified periods, splits lots, blocks backward moves and requires a buyer and beneficiary", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Bosque" }, "alan");
    const [c] = await t.db.insert(certifications).values({ mandateId: M, projectId: p.id, name: "Bosque VCS", standard: "vcs", bufferPct: 15 }).returning();
    const [per] = await t.db.insert(monitoringPeriods).values({ mandateId: M, certificationId: c.id, start: "2025-01-01", end: "2025-12-31", verifiedUnits: 10_000 }).returning();
    await expect(recordIssuance(t.db, per.id, { issued: 8_500, buffer: 1_500, vintage: "2025", date: "2026-05-01" }, "alan")).rejects.toThrow(/verified monitoring period/);
    await t.db.update(monitoringPeriods).set({ status: "verified" }).where(eq(monitoringPeriods.id, per.id));
    await expect(recordIssuance(t.db, per.id, { issued: 9_000, buffer: 1_500, vintage: "2025", date: "2026-05-01" }, "alan")).rejects.toThrow(/exceeds/);
    await recordIssuance(t.db, per.id, { issued: 8_500, buffer: 1_500, vintage: "2025", date: "2026-05-01" }, "alan");
    const lots = await t.db.select().from(creditLots);
    const issued = lots.find(l => l.status === "issued")!;
    expect(lots.find(l => l.status === "buffer")?.quantity).toBe(1_500);
    await expect(moveLot(t.db, issued.id, "contracted", "alan", { quantity: 3_000 })).rejects.toThrow(/buyer or an offtake/);
    const sold = await moveLot(t.db, issued.id, "contracted", "alan", { quantity: 3_000, price: 22, buyerOrgId: crypto.randomUUID() });
    await expect(moveLot(t.db, sold, "issued", "alan")).rejects.toThrow(/forward/);
    await expect(moveLot(t.db, sold, "retired", "alan")).rejects.toThrow(/beneficiary/);
    await moveLot(t.db, sold, "retired", "alan", { beneficiary: "Buyer Co 2026 claim" });
    await expect(moveLot(t.db, sold, "delivered", "alan")).rejects.toThrow(/final/);
    const s = inventorySummary(await t.db.select().from(creditLots));
    expect(s).toMatchObject({ onHand: 5_500, delivered: 3_000, buffer: 1_500, avgPrice: 22 });
  });

  it("forecast units cannot be issued without verification", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "B" }, "alan");
    const [c] = await t.db.insert(certifications).values({ mandateId: M, projectId: p.id, name: "B", standard: "vcs" }).returning();
    const [l] = await t.db.insert(creditLots).values({ mandateId: M, certificationId: c.id, vintage: "2027", quantity: 100 }).returning();
    await expect(moveLot(t.db, l.id, "issued", "alan")).rejects.toThrow(/verified before issuance/);
  });
});

describe("permanence, offtake and data room", () => {
  it("computes the indicative buffer with a 10% floor and a 60 ceiling", () => {
    expect(permanenceBuffer([{ factor: "fire", score: 4, mitigation: "", evidence: "" }])).toEqual({ rating: 4, bufferPct: 10, eligible: true });
    expect(permanenceBuffer([{ factor: "a", score: 40, mitigation: "", evidence: "" }, { factor: "b", score: 25, mitigation: "", evidence: "" }]).eligible).toBe(false);
  });

  it("prices offtake schedules with escalation and floor, and builds a classed model stream", () => {
    const o = { id: "o1", name: "Forward", kind: "carbon_forward", status: "signed", buyerName: "Buyer", unit: "tCO2e", schedule: [{ year: 2028, volume: 1000 }, { year: 2029, volume: 1000 }], price: 20, floorPrice: 21, escalationPct: 10, prepayment: 5000, signedDate: "2026-01-01", certificationDependent: true } as never;
    const r = offtakeRevenue(o);
    expect(r.rows[0].price).toBe(21); expect(r.rows[1].price).toBeCloseTo(22, 6);
    const s = offtakeToRevenueStream(o, 2027);
    expect(s).toMatchObject({ certainty: "contracted", revenueClass: "contracted_environmental", startYear: 2, termYears: 2, annualVolume: 1000 });
    const cov = offtakeCoverage([o], [{ status: "forecast", vintage: "2028", quantity: 800 } as never]);
    expect(cov[0]).toEqual({ year: 2028, contracted: 1000, expected: 800, gap: -200 });
  });

  it("lists missing documents cumulatively by stage", () => {
    const d = dataRoom("registration", [{ docType: "project_description", status: "final" }, { docType: "validation_report", status: "superseded" }]);
    expect(d.missing).toContain("validation_report");
    expect(d.missing).not.toContain("project_description");
    expect(d.missing).toContain("boundary");
  });
});
