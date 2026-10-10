// Phase 29E on synthetic records: conflicting extracted values go to review and never overwrite the held value
// (accept writes it with provenance; keep leaves it), an expired funding call is not shown as a current match, material
// Steward findings need an owner and review date and resolve only with evidence, and owner exports contain only the
// owner's workspaces. Full backup and restore of every table is covered by tests/integration/intel.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deals, fieldReviews, fundingOpportunities, fundingProjectMatches, mandates, organizations, projects, tasks } from "@/db/schema";
import { upsertOrganization } from "@/lib/crm/entities";
import { projectFundingMatches } from "@/lib/funding/project-match";
import { exportArea } from "@/lib/lifecycle/export";
import { decideFieldReview, pendingReviews } from "@/lib/lifecycle/reviews";
import { createFinding, findingsFor, setFindingStatus } from "@/lib/steward/findings";
import { createTestDb } from "../helpers/d1";

const M = "d2940000-0000-4000-8000-000000000001", OTHER = "d2940000-0000-4000-8000-000000000002";
const by = "owner@example.com";
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [[M, "s29e"], [OTHER, "s29e-o"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("conflicting extracted values", () => {
  it("queues the disagreement once, keeps the held value, and applies it only when a person accepts", async () => {
    const first = await upsertOrganization(t.db, M, { name: "TEST Conflict Energy", domain: "conflict-energy.example", country: "MEX" }, "other", { source: "analyst", confidence: "high" });
    const again = await upsertOrganization(t.db, M, { name: "TEST Conflict Energy", domain: "conflict-energy.example", country: "USA", headcount: 40 }, "other", { source: "wikidata", confidence: "medium", url: "https://www.wikidata.org/wiki/Q0" });
    expect(again.row.country).toBe("MEX");
    expect(again.row.headcount).toBe(40); // an empty field is filled
    await upsertOrganization(t.db, M, { name: "TEST Conflict Energy", domain: "conflict-energy.example", country: "USA" }, "other", { source: "wikidata", confidence: "medium" });
    const pending = (await pendingReviews(t.db, [M])).filter(r => r.entityId === first.row.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ field: "country", currentValue: "MEX", proposedValue: "USA", source: "wikidata" });
    await decideFieldReview(t.db, pending[0].id, "accepted", "Confirmed HQ moved", by);
    const [o] = await t.db.select().from(organizations).where(eq(organizations.id, first.row.id));
    expect(o.country).toBe("USA");
    expect(o.fieldSources.country?.source).toMatch(/wikidata \(accepted by owner@example.com\)/);
    await upsertOrganization(t.db, M, { name: "TEST Conflict Energy", domain: "conflict-energy.example", country: "CAN" }, "other", { source: "scan" });
    const [p2] = (await pendingReviews(t.db, [M])).filter(r => r.entityId === first.row.id);
    await decideFieldReview(t.db, p2.id, "rejected", "", by);
    expect((await t.db.select().from(organizations).where(eq(organizations.id, first.row.id)))[0].country).toBe("USA");
    expect((await t.db.select().from(fieldReviews).where(eq(fieldReviews.id, p2.id)))[0].status).toBe("rejected");
    expect(await pendingReviews(t.db, [OTHER])).toHaveLength(0);
  });
});

describe("expired funding", () => {
  it("does not show a call whose deadline has passed as a current match", async () => {
    const [proj] = await t.db.insert(projects).values({ mandateId: M, name: "TEST funded site", country: "MEX" }).returning();
    const opp = (title: string, deadline: string) => ({ mandateId: M, source: "grants_gov" as const, externalId: title, dedupeKey: title, title, type: "grant" as const, url: "https://example.org", deadline, status: "open" as const });
    const [live, expired] = await t.db.insert(fundingOpportunities).values([opp("TEST live call", "2099-01-01"), opp("TEST expired call", "2020-01-01")] as never).returning();
    for (const o of [live, expired]) await t.db.insert(fundingProjectMatches).values({ mandateId: M, opportunityId: o.id, projectId: proj.id, geography: "listed", reasons: { met: [], unknown: [] } } as never);
    expect((await projectFundingMatches(t.db, proj.id)).map(m => m.title)).toEqual(["TEST live call"]);
  });
});

describe("Steward findings", () => {
  it("need an owner and review date when material, create the owner's task, and resolve only with evidence", async () => {
    const [proj] = await t.db.insert(projects).values({ mandateId: M, name: "TEST karst site", country: "MEX" }).returning();
    const base = { mandateId: M, projectId: proj.id, dimension: "water" as const, subject: "Cenote connected to the site", evidence: "Field visit photos 2026-10-02", implication: "Foundations and drainage must avoid the cenote catchment", requiredAction: "Commission a hydrogeological survey" };
    await expect(createFinding(t.db, base, by)).rejects.toThrow(/owner and a review date/);
    const f = await createFinding(t.db, { ...base, owner: by, reviewDate: "2026-12-01", affectedParties: "TEST ejido water committee" }, by);
    expect(f.uncertainty).toBe("unknown");
    const [task] = await t.db.select().from(tasks).where(eq(tasks.workstream, `steward-finding:${f.id}`));
    expect(task).toMatchObject({ owner: by, status: "open" });
    await expect(setFindingStatus(t.db, f.id, "resolved", {}, by)).rejects.toThrow(/evidence/);
    await setFindingStatus(t.db, f.id, "resolved", { evidence: "Survey report 2026-11-20: no connection" }, by);
    expect((await findingsFor(t.db, proj.id))[0]).toMatchObject({ status: "resolved", resolvedBy: by });
    expect((await t.db.select().from(tasks).where(eq(tasks.id, task.id)))[0].status).toBe("done");
  });
});

describe("owner export", () => {
  it("contains only the owner's workspaces", async () => {
    await t.db.insert(deals).values([{ mandateId: M, name: "TEST mine", path: "project_diagnostic" }, { mandateId: OTHER, name: "TEST not mine", path: "project_diagnostic" }] as never);
    const out = await exportArea(t.db, [M], "commercial");
    const names = (out.deals as { name: string }[]).map(d => d.name);
    expect(names).toContain("TEST mine");
    expect(names).not.toContain("TEST not mine");
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["offer_proposals", "payments", "engagement_deliverables", "pipeline_stage_history"]));
    expect(await exportArea(t.db, [], "relationships")).toEqual({});
  });
});
