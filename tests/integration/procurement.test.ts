import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bids, contractParties, contracts, contractVersions, mandates, procurementPackages, projects } from "@/db/schema";
import { awardBid, procurementAlerts } from "@/lib/procurement/engine";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const NOW = new Date("2026-09-25T12:00:00Z");

beforeEach(async () => {
  for (const x of [bids, procurementPackages, contractParties, contractVersions, contracts, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
});

describe("procurement", () => {
  it("awarding a bid selects it, closes the others, and registers a draft EPC agreement carrying the E&S flow-down", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan");
    const [pkg] = await t.db.insert(procurementPackages).values({ projectId: p.id, mandateId: M, name: "EPC", category: "epc", stage: "evaluation", esRequirements: "IFC PS2 labour standards; grievance mechanism for workers" }).returning();
    const [a, b] = await t.db.insert(bids).values([
      { packageId: pkg.id, projectId: p.id, mandateId: M, bidder: "Constructora A", status: "received", price: 30_000_000, scheduleWeeks: 52 },
      { packageId: pkg.id, projectId: p.id, mandateId: M, bidder: "Constructora B", status: "shortlisted", price: 31_000_000 },
      { packageId: pkg.id, projectId: p.id, mandateId: M, bidder: "Declined Co", status: "declined" },
    ]).returning();
    await expect(awardBid(t.db, (await t.db.select().from(bids).where(eq(bids.bidder, "Declined Co")))[0].id, "alan", NOW)).rejects.toThrow(/received bid/);
    const r = await awardBid(t.db, a.id, "alan", NOW);
    const statuses = Object.fromEntries((await t.db.select().from(bids)).map(x => [x.bidder, x.status]));
    expect(statuses).toEqual({ "Constructora A": "selected", "Constructora B": "not_selected", "Declined Co": "declined" });
    const [c] = await t.db.select().from(contracts).where(eq(contracts.id, r.contractId));
    expect(c).toMatchObject({ kind: "registered", category: "procurement", contractType: "epc", projectId: p.id, lifecycle: "draft", value: 30_000_000 });
    expect(c.body).toContain("IFC PS2 labour standards");
    expect((await t.db.select().from(procurementPackages))[0]).toMatchObject({ stage: "award", awardedBidId: a.id, contractId: c.id });
    await expect(awardBid(t.db, b.id, "alan", NOW)).rejects.toThrow(/already awarded/);
  });

  it("Today: bids due within 7 days, late awards and lead-time risk, within the user's entities", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Visible" }, "alan");
    const h = await createProject(t.db, { mandateId: OTHER, name: "Hidden" }, "alan");
    await t.db.insert(procurementPackages).values([
      { projectId: p.id, mandateId: M, name: "Modules RFP", category: "equipment", stage: "rfp", bidsDueAt: "2026-09-30" },
      { projectId: p.id, mandateId: M, name: "Civil", category: "civil", stage: "evaluation", awardTargetAt: "2026-09-01" },
      { projectId: h.id, mandateId: OTHER, name: "Hidden RFP", category: "bop", stage: "rfp", bidsDueAt: "2026-09-28" },
    ]);
    const [trafo] = await t.db.insert(procurementPackages).values({ projectId: p.id, mandateId: M, name: "Main transformer", category: "equipment", stage: "manufacturing", requiredOnSiteAt: "2027-03-01" }).returning();
    const [bid] = await t.db.insert(bids).values({ packageId: trafo.id, projectId: p.id, mandateId: M, bidder: "OEM", status: "selected", leadTimeWeeks: 40 }).returning();
    await t.db.update(procurementPackages).set({ awardedBidId: bid.id }).where(eq(procurementPackages.id, trafo.id));

    const a = await procurementAlerts(t.db, [M], NOW);
    expect(a.bidsDue.map(x => x.name)).toEqual(["Modules RFP"]);
    expect(a.awardLate.map(x => x.name)).toEqual(["Civil"]);
    expect(a.leadTime).toEqual([expect.objectContaining({ name: "Main transformer", why: expect.stringContaining("needed on site 2027-03-01") })]);
  });
});
