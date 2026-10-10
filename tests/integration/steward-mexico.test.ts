// Phase 28C: the Mexico pack registers its sources with honest statuses, and the Yucatán karst rule adds an advisory and
// exactly one evidence-request task per place (never duplicated), without changing any assessment on its own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { mandates, stewardSources, tasks } from "@/db/schema";
import { createPlace, currentAssessments } from "@/lib/steward/engine";
import { ensureAdvisoryTasks, regionalAdvisories } from "@/lib/steward/sources/packs";
import { syncSourceRegister } from "@/lib/steward/sources/pipeline";
import { createTestDb } from "../helpers/d1";

const M = "a1000000-0000-4000-8000-000000000001";
let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(mandates).values({ id: M, slug: "mx", name: "mx", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
  await syncSourceRegister(t.db);
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("Mexico pack", () => {
  it("registers Mexican sources without inventing APIs", async () => {
    const mx = (await t.db.select().from(stewardSources)).filter(s => s.region === "MEX");
    expect(mx.map(s => s.key).sort()).toEqual(["mx_conabio", "mx_conagua", "mx_inah", "mx_inegi_denue", "mx_inegi_indicators", "mx_inpi", "mx_ran"]);
    expect(mx.find(s => s.key === "mx_inegi_indicators")).toMatchObject({ enabled: false, health: "credential_required" });
    expect(mx.find(s => s.key === "mx_conagua")).toMatchObject({ enabled: false, accessMethod: "manual" });
    expect(mx.find(s => s.key === "mx_conabio")!.serviceUrl ?? null).toBeNull();
    expect(mx.find(s => s.key === "mx_inah")!.aiProcessing).toBe("prohibited");
  });

  it("flags karst for Yucatán places and creates one evidence task, not for elsewhere", async () => {
    expect(regionalAdvisories({ country: "MEX", geometry: null }, [-89.6, 20.9]).map(a => a.key)).toEqual(["mx_karst", "mx_rights"]);
    expect(regionalAdvisories({ country: "MEX", geometry: null }, [-99.1, 19.4]).map(a => a.key)).toEqual(["mx_rights"]);
    expect(regionalAdvisories({ country: "BRA", geometry: null }, [-47.9, -15.8])).toEqual([]);
    const yuc = await createPlace(t.db, { mandateId: M, name: "Cenote parcel", country: "MEX", geometry: { type: "Point", coordinates: [-89.6, 20.9] }, accuracy: "project_point" }, "test");
    await createPlace(t.db, { mandateId: M, name: "Valle de México site", country: "MEX", geometry: { type: "Point", coordinates: [-99.1, 19.4] }, accuracy: "project_point" }, "test");
    expect(await ensureAdvisoryTasks(t.db)).toBe(1);
    expect(await ensureAdvisoryTasks(t.db)).toBe(0);
    const made = await t.db.select().from(tasks).where(like(tasks.title, "Request local hydrogeological evidence%"));
    expect(made).toHaveLength(1);
    expect(made[0].title).toContain("Cenote parcel");
    expect((await currentAssessments(t.db, yuc.id)).find(a => a.dimension === "water")!.status).toBe("not_assessed");
  });
});
