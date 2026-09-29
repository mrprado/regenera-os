// Intelligence depth: relevance derived per dimension from records, person ratings survive re-derivation, thesis vs
// observed-transaction gaps, and the watch feed.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capitalProfiles, mandateEvidence, mandates, organizations, projects, signalAssessments, theses, triggers, watches } from "@/db/schema";
import { assess, rateDimension, thesisGaps, watchFeed } from "@/lib/intelligence/engine";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
let orgId = "", trigId = "";
beforeEach(async () => {
  for (const x of [signalAssessments, mandateEvidence, theses, watches, triggers, capitalProfiles, projects, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  [{ id: orgId }] = await t.db.insert(organizations).values({ mandateId: M, name: "Andes Infra Debt", nameNormalized: "andes infra debt", source: "other", country: "PER", sector: "energy" }).returning();
  [{ id: trigId }] = await t.db.insert(triggers).values({ mandateId: M, orgId, type: "capital", summary: "Andes Infra Debt closes USD 400M fund", eventDate: "2026-09-01", source: "test", country: "PER" } as never).returning();
});

describe("signal assessment", () => {
  it("derives relevance from records and keeps person ratings on re-derive", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Arequipa Solar" }, "alan");
    await t.db.update(projects).set({ country: "PER", sector: "energy" }).where(eq(projects.id, p.id));
    await t.db.insert(capitalProfiles).values({ mandateId: M, orgId, name: "Andes senior debt", capitalType: "senior_debt" } as never);
    const a = await assess(t.db, trigId, "alan");
    const get = (d: string, xs = a.relevance) => xs.find(x => x.dimension === d)!;
    expect(get("capital").rating).toBe("high");
    expect(get("project")).toMatchObject({ rating: "high", by: "derived" });
    expect(get("geography").reason).toMatch(/active in PER/);
    expect(a.related.projectIds).toEqual([p.id]);
    await expect(rateDimension(t.db, a.id, "technology", "high", "", "", "alan")).rejects.toThrow(/reason/);
    await rateDimension(t.db, a.id, "technology", "high", "Grid-scale solar credit", "", "alan");
    const again = await assess(t.db, trigId, "alan");
    expect(get("technology", again.relevance)).toMatchObject({ rating: "high", by: "person" });
    expect((await t.db.select().from(signalAssessments)).length).toBe(1);
  });
});

describe("thesis gaps and watches", () => {
  it("compares what they say with what they finance", async () => {
    const [cp] = await t.db.insert(capitalProfiles).values({ mandateId: M, orgId, name: "Andes", capitalType: "senior_debt" } as never).returning();
    await t.db.insert(theses).values([{ mandateId: M, orgId, theme: "grid", thesis: "Transmission is the bottleneck", sectors: ["transmission"], createdBy: "t" }, { mandateId: M, orgId, theme: "nature_finance", thesis: "Nature is an asset class", sectors: ["restoration"], createdBy: "t" }]);
    await t.db.insert(mandateEvidence).values({ mandateId: M, profileId: cp.id, layer: "observed", field: "sectors", statement: "Financed 220 kV transmission line, 2025", source: "press", createdBy: "t" });
    const g = await thesisGaps(t.db, orgId);
    expect(g.find(x => x.theme === "grid")!.gap).toBe("aligned");
    expect(g.find(x => x.theme === "nature_finance")!.gap).toBe("no_observed_evidence");
  });

  it("feeds new signals for watched institutions", async () => {
    await t.db.insert(watches).values({ mandateId: M, kind: "institution", orgId, label: "Andes", createdBy: "t" });
    const f = await watchFeed(t.db, [M]);
    expect(f[0].items.map(i => i.id)).toEqual([trigId]);
  });
});
