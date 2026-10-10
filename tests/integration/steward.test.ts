// Phase 28A Steward: geometry and geodesic area, point-only limits, workspace isolation, care dependencies and
// knowledge permissions, evidence rules, budget stages and currencies, honest missing states, knowledge visibility and
// withdrawal (Workflows B, C and F). Synthetic records only, in an isolated test database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { communities, communityAuthorities, fundingAllocations, knowledgeUses, mandates, projects, stewardshipBudgets } from "@/db/schema";
import { checkPermission, createKnowledgeRecord, setPermission, withdraw } from "@/lib/community/engine";
import type { UserScope } from "@/lib/db/scoped";
import {
  addCareAction, addMeasurement, areaHa, canSeeKnowledge, canStartAction, createCarePlan, createPlace, currentAssessments, parseGeometry, placeFromProject,
  setActionStatus, setAssessment, stewardOverview, summariseBudget, visibleGeometry,
} from "@/lib/steward/engine";
import { stewardIndicators } from "@/db/schema";
import { createTestDb } from "../helpers/d1";

const M = "d0000000-0000-4000-8000-000000000001", OTHER = "d0000000-0000-4000-8000-000000000002";
const owner: UserScope = { kind: "user", userId: "o", email: "owner@example.com", mandateIds: [M], ownerOf: [M] };
const member: UserScope = { kind: "user", userId: "m", email: "member@example.com", mandateIds: [M], ownerOf: [] };
// ~1 km × 1 km square near the equator: about 100 ha on the ellipsoid.
const SQUARE = { type: "Polygon", coordinates: [[[-74, 0], [-73.991, 0], [-73.991, 0.009], [-74, 0.009], [-74, 0]]] };
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [[M, "m"], [OTHER, "o"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("places", () => {
  it("computes geodesic area for polygons, none for points, and rejects bad geometry", () => {
    const ha = areaHa(parseGeometry(SQUARE))!;
    expect(ha).toBeGreaterThan(98); expect(ha).toBeLessThan(101);
    expect(areaHa(parseGeometry({ type: "Point", coordinates: [-89.6, 20.9] }))).toBeNull();
    expect(() => parseGeometry({ type: "LineString", coordinates: [[0, 0], [1, 1]] })).toThrow(/Point, Polygon or MultiPolygon/);
    expect(() => parseGeometry({ type: "Point", coordinates: [200, 10] })).toThrow(/WGS84/);
    expect(() => parseGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] })).toThrow(/crosses itself/);
  });

  it("makes a place from a project point, labelled as a point with no area", async () => {
    const [p] = await t.db.insert(projects).values({ mandateId: M, name: "Cenote site", lat: 20.9, lng: -89.6, country: "MEX" }).returning();
    const place = await placeFromProject(t.db, owner, p.id, "owner@example.com");
    expect(place).toMatchObject({ geometryAccuracy: "project_point", areaHa: null });
    const other = (await t.db.insert(projects).values({ mandateId: OTHER, name: "Elsewhere" }).returning())[0];
    await expect(placeFromProject(t.db, owner, other.id, "owner@example.com")).rejects.toThrow(/not found/);
  });

  it("generalises sensitive places for non-owners only", () => {
    const g = parseGeometry(SQUARE) as Record<string, unknown>;
    expect(visibleGeometry({ geometry: g, sensitive: true }, true)).toBe(g);
    expect(visibleGeometry({ geometry: g, sensitive: true }, false)).toMatchObject({ type: "Point", generalised: true });
    expect(visibleGeometry({ geometry: g, sensitive: false }, false)).toBe(g);
  });
});

describe("care, knowledge and evidence", () => {
  it("blocks an action until its dependency is done and its knowledge permission is granted, and needs evidence to finish", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Restoration block", geometry: SQUARE, accuracy: "surveyed" }, "owner@example.com");
    expect(place.areaHa).toBeGreaterThan(98);
    const [c] = await t.db.insert(communities).values({ mandateId: M, name: "Synthetic community", createdBy: "owner@example.com" } as never).returning();
    const k = await createKnowledgeRecord(t.db, { mandateId: M, communityId: c.id, placeId: place.id, title: "Seasonal fire practice", category: "fire", accessStatus: "restricted" } as never, "owner@example.com");
    const plan = await createCarePlan(t.db, { mandateId: M, placeId: place.id, title: "Year 1", createdBy: "owner@example.com" });
    const first = await addCareAction(t.db, { mandateId: M, planId: plan.id, title: "Survey", createdBy: "owner@example.com" });
    const burn = await addCareAction(t.db, { mandateId: M, planId: plan.id, title: "Cool burn", dependsOn: first.id, requiresKnowledgeId: k.id, requiresActivity: "conservation_planning", createdBy: "owner@example.com" });
    const blocked = await canStartAction(t.db, burn.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons.join(" ")).toMatch(/Waits for "Survey"/);
    expect(blocked.reasons.join(" ")).toMatch(/No permission recorded/);
    await expect(setActionStatus(t.db, first.id, "done", "owner@example.com", " ")).rejects.toThrow(/needs evidence/);
    await setActionStatus(t.db, first.id, "done", "owner@example.com", "Survey report 2026-03");
    const [auth] = await t.db.insert(communityAuthorities).values({ mandateId: M, communityId: c.id, name: "Council", authorityType: "council", verificationStatus: "verified", powers: ["ai", "publication", "commercial", "digitization"], createdBy: "owner@example.com" } as never).returning();
    await setPermission(t.db, { recordId: k.id, activity: "conservation_planning", status: "allowed", authorityId: auth.id, evidence: "Council minutes 2026-04-02" }, "owner@example.com");
    expect((await canStartAction(t.db, burn.id)).ok).toBe(true);
    await expect(addCareAction(t.db, { mandateId: M, planId: plan.id, title: "Bad", dependsOn: "00000000-0000-4000-8000-000000000000", createdBy: "x" })).rejects.toThrow(/same plan/);

    // Workflow F: withdrawal stops use and flags recorded outputs.
    await t.db.insert(knowledgeUses).values({ mandateId: M, recordId: k.id, activity: "conservation_planning", outputType: "care plan", outputRef: plan.id, usedBy: "owner@example.com" });
    const w = await withdraw(t.db, k.id, "owner@example.com", "Council withdrew permission");
    expect(w.flagged).toBeGreaterThanOrEqual(1);
    expect((await checkPermission(t.db, k.id, "conservation_planning")).allowed).toBe(false);
    expect((await canStartAction(t.db, burn.id)).ok).toBe(false);
    expect((await t.db.select().from(knowledgeUses).where(eq(knowledgeUses.recordId, k.id)))[0].status).toBe("flagged");
  });

  it("hides restricted knowledge from members, AI and other workspaces, and lets permitted users see it", () => {
    const base = { mandateId: M, withdrawn: false, permittedUsers: [] as string[] };
    expect(canSeeKnowledge(owner, { ...base, accessStatus: "sacred" })).toBe(true);
    expect(canSeeKnowledge(member, { ...base, accessStatus: "sacred" })).toBe(false);
    expect(canSeeKnowledge(member, { ...base, accessStatus: "authorized_team" })).toBe(true);
    expect(canSeeKnowledge(member, { ...base, accessStatus: "confidential", permittedUsers: ["member@example.com"] })).toBe(true);
    expect(canSeeKnowledge({ kind: "system", reason: "ask" }, { ...base, accessStatus: "public" })).toBe(false);
    expect(canSeeKnowledge({ ...member, mandateIds: [OTHER] }, { ...base, accessStatus: "public" })).toBe(false);
  });

  it("refuses measurements without evidence or a number, and never treats missing assessments as fine", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Wetland" }, "owner@example.com");
    const [ind] = await t.db.insert(stewardIndicators).values({ mandateId: M, placeId: place.id, dimension: "ecological", name: "Canopy cover", unit: "%", createdBy: "owner@example.com" }).returning();
    await expect(addMeasurement(t.db, { mandateId: M, indicatorId: ind.id, value: 42, periodStart: "2026-01-01", evidence: "", observedBy: "x" })).rejects.toThrow(/evidence/);
    await expect(addMeasurement(t.db, { mandateId: M, indicatorId: ind.id, value: Number.NaN, periodStart: "2026-01-01", evidence: "plot survey", observedBy: "x" })).rejects.toThrow(/number/);
    const a = await currentAssessments(t.db, place.id);
    expect(a.every(x => x.status === "not_assessed")).toBe(true);
    await expect(setAssessment(t.db, { mandateId: M, placeId: place.id, dimension: "water", status: "verified_in_scope", basis: "Lab results" }, "o")).rejects.toThrow(/scope/);
    await setAssessment(t.db, { mandateId: M, placeId: place.id, dimension: "water", status: "condition_identified", basis: "Karst: surface data cannot show groundwater; hydrogeology requested" }, "o");
    expect((await currentAssessments(t.db, place.id)).find(x => x.dimension === "water")!.status).toBe("condition_identified");
  });
});

describe("budgets and overview", () => {
  it("keeps funding stages apart and never adds another currency", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Budget place" }, "o");
    const [b] = await t.db.insert(stewardshipBudgets).values({ mandateId: M, placeId: place.id, label: "Year 1", currency: "USD", required: 100_000, createdBy: "o" }).returning();
    await t.db.insert(fundingAllocations).values([
      { mandateId: M, budgetId: b.id, source: "Foundation", stage: "committed", amount: 40_000, currency: "USD", createdBy: "o" },
      { mandateId: M, budgetId: b.id, source: "Grant", stage: "funded", amount: 25_000, currency: "USD", createdBy: "o" },
      { mandateId: M, budgetId: b.id, source: "Local", stage: "paid", amount: 5_000, currency: "USD", createdBy: "o" },
      { mandateId: M, budgetId: b.id, source: "EU", stage: "funded", amount: 10_000, currency: "EUR", createdBy: "o" },
    ]);
    const s = summariseBudget(b, await t.db.select().from(fundingAllocations));
    expect(s.byStage).toEqual({ projected: 0, committed: 40_000, funded: 25_000, paid: 5_000 });
    expect(s.secured).toBe(30_000);
    expect(s.gap).toBe(70_000);
    expect(s.otherCurrency).toEqual([{ currency: "EUR", amount: 10_000, stage: "funded" }]);
  });

  it("shows only the user's workspaces, places without a baseline, and grievances only to owners", async () => {
    await createPlace(t.db, { mandateId: OTHER, name: "Not yours" }, "o");
    const today = "2026-10-10";
    const o = await stewardOverview(t.db, member, today);
    expect(o.places.some(p => p.name === "Not yours")).toBe(false);
    expect(o.needsBaseline.length).toBe(o.places.length);
    expect(o.canSeeGrievances).toBe(false);
    expect((await stewardOverview(t.db, owner, today)).canSeeGrievances).toBe(true);
  });
});
