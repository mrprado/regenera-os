import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mandateMembers, mandates, organizations, portalUsers, projects, spatialLayers } from "@/db/schema";
import { DEMO_MANDATE, removeDemo, seedDemo } from "@/lib/demo/seed";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

describe("demo data", () => {
  it("lives in its own DEMO entity, labels itself everywhere, is idempotent and removable", async () => {
    expect((await seedDemo(t.db, "owner@regenera.bio")).created).toBe(true);
    expect((await seedDemo(t.db, "owner@regenera.bio")).created).toBe(false);
    const ps = await t.db.select().from(projects).where(eq(projects.mandateId, DEMO_MANDATE));
    expect(ps.map(p => p.name).sort()).toEqual(["DEMO — Africa Energy Project", "DEMO — Mexico Solar 100 MW", "DEMO — New Zealand Solar", "DEMO — Yucatán Eco Park"]);
    expect((await t.db.select().from(organizations).where(eq(organizations.mandateId, DEMO_MANDATE))).every(o => o.name.startsWith("DEMO — "))).toBe(true);
    expect((await t.db.select().from(portalUsers).where(eq(portalUsers.mandateId, DEMO_MANDATE))).every(u => u.isDemo && u.email.endsWith("@example.test"))).toBe(true);
    expect((await t.db.select().from(spatialLayers).where(eq(spatialLayers.mandateId, DEMO_MANDATE))).every(l => l.isDemo && l.name.startsWith("DEMO / SAMPLE DATA"))).toBe(true);
    expect((await t.db.select().from(mandates).where(eq(mandates.id, DEMO_MANDATE)))[0].rules.massAllowed).toBe(false);
    await removeDemo(t.db);
    expect(await t.db.select().from(projects).where(eq(projects.mandateId, DEMO_MANDATE))).toEqual([]);
    expect(await t.db.select().from(mandateMembers).where(eq(mandateMembers.mandateId, DEMO_MANDATE))).toEqual([]);
  });
});
