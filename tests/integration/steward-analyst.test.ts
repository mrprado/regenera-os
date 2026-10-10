// Phase 28D Steward across the OS: AI drafts cite only real evidence, use governed knowledge only with permission and are
// invalidated when it is withdrawn; Ask questions never return knowledge content; the daily digest is deduplicated and
// leaves out grievances; the Atlas feed generalises sensitive places. Synthetic records only, fake model client.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { communities, communityAuthorities, knowledgeUses, mandates, notifications, stewardDrafts } from "@/db/schema";
import { createKnowledgeRecord, setPermission, withdraw } from "@/lib/community/engine";
import type { UserScope } from "@/lib/db/scoped";
import { stewardDigest } from "@/lib/steward/alerts";
import { draftPlaceAssessment, evidencePack } from "@/lib/steward/drafts";
import { addCareAction, createCarePlan, createPlace } from "@/lib/steward/engine";
import { stewardPlacesFeed } from "@/lib/steward/map";
import { stewardQuestion } from "@/lib/steward/questions";
import { fakeAnthropic } from "../helpers/fake-anthropic";
import { createTestDb } from "../helpers/d1";

const M = "d2800000-0000-4000-8000-000000000001";
const owner: UserScope = { kind: "user", userId: "o", email: "owner@example.com", mandateIds: [M], ownerOf: [M] };
const member: UserScope = { kind: "user", userId: "m", email: "member@example.com", mandateIds: [M], ownerOf: [] };
const SQUARE = { type: "Polygon", coordinates: [[[-89.7, 20.9], [-89.69, 20.9], [-89.69, 20.91], [-89.7, 20.91], [-89.7, 20.9]]] };
const cfg = { apiKey: "test", monthlyBudgetUsd: 50 };
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(mandates).values({ id: M, slug: "s28d", name: "s28d", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("AI place assessment drafts", () => {
  it("drops facts citing unknown evidence, records governed knowledge use, and is invalidated on withdrawal", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Cenote parcel", geometry: SQUARE, accuracy: "surveyed" }, "owner@example.com");
    const [c] = await t.db.insert(communities).values({ mandateId: M, name: "Synthetic ejido", createdBy: "owner@example.com" } as never).returning();
    const k = await createKnowledgeRecord(t.db, { mandateId: M, communityId: c.id, placeId: place.id, title: "Water practice", category: "water", accessStatus: "authorized_team", descriptionPublic: "Seasonal water use is coordinated by the assembly." } as never, "owner@example.com");
    const secret = await createKnowledgeRecord(t.db, { mandateId: M, communityId: c.id, placeId: place.id, title: "Unpermitted", category: "water", accessStatus: "authorized_team", descriptionPublic: "SHOULD NOT REACH THE MODEL" } as never, "owner@example.com");
    const [auth] = await t.db.insert(communityAuthorities).values({ mandateId: M, communityId: c.id, name: "Assembly", authorityType: "council", verificationStatus: "verified", powers: ["ai"], createdBy: "owner@example.com" } as never).returning();
    await setPermission(t.db, { recordId: k.id, activity: "ai_summarization", status: "allowed", authorityId: auth.id, evidence: "Assembly minutes 2026-05-01" }, "owner@example.com");

    const pack = await evidencePack(t.db, owner, place.id);
    const text = pack.items.map(i => i.text).join("\n");
    expect(text).toContain("Seasonal water use");
    expect(text).not.toContain("SHOULD NOT REACH");
    expect(pack.knowledge).toEqual([k.id]);
    expect(secret.id).toBeTruthy();
    await expect(evidencePack(t.db, { ...owner, mandateIds: ["d2800000-0000-4000-8000-000000000009"] }, place.id)).rejects.toThrow(/not found/);

    const { client } = fakeAnthropic([{ facts: [{ statement: "Surveyed boundary", evidence: ["P1"] }, { statement: "Invented", evidence: ["Z9"] }], interpretations: [], gaps: ["No baseline"], nextAction: "Record a baseline" }]);
    const d = await draftPlaceAssessment(t.db, cfg, owner, place.id, "owner@example.com", client);
    const content = d.content as { facts: unknown[]; droppedForUnknownEvidence: string[] };
    expect(d.status).toBe("draft");
    expect(content.facts).toHaveLength(1);
    expect(content.droppedForUnknownEvidence).toEqual(["Z9"]);
    const uses = await t.db.select().from(knowledgeUses).where(and(eq(knowledgeUses.recordId, k.id), eq(knowledgeUses.outputRef, d.id)));
    expect(uses).toHaveLength(1);

    await withdraw(t.db, k.id, "owner@example.com", "Assembly withdrew AI use");
    const [after] = await t.db.select().from(stewardDrafts).where(eq(stewardDrafts.id, d.id));
    expect(after.status).toBe("invalidated");
    expect(after.invalidatedReason).toBeTruthy();
    expect((await evidencePack(t.db, owner, place.id)).knowledge).toEqual([]);
  });
});

describe("Steward across the OS", () => {
  it("answers Ask questions with counts, never knowledge content", async () => {
    const r = await stewardQuestion(t.db, member, "reviews_due_this_month", new Date("2027-12-01T00:00:00Z"));
    expect(JSON.stringify(r)).not.toMatch(/Seasonal water use|SHOULD NOT REACH/);
    expect(r).toHaveProperty("knowledgePermissionReviews");
    expect(await stewardQuestion(t.db, member, "nope", new Date())).toEqual({ error: "Unknown question" });
  });

  it("sends one digest per workspace per day and never mentions grievances", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Overdue block", accuracy: "unknown" }, "owner@example.com");
    const plan = await createCarePlan(t.db, { mandateId: M, placeId: place.id, title: "Plan", createdBy: "owner@example.com" });
    await addCareAction(t.db, { mandateId: M, planId: plan.id, title: "Fence", dueDate: "2026-01-01", createdBy: "owner@example.com" });
    const now = new Date("2026-10-10T15:00:00Z");
    expect(await stewardDigest(t.db, now)).toBe(1);
    expect(await stewardDigest(t.db, now)).toBe(0);
    const rows = await t.db.select().from(notifications).where(eq(notifications.entityType, "steward_digest"));
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toMatch(/overdue care action/);
    expect(rows[0].body).not.toMatch(/grievance/i);
  });

  it("generalises sensitive places on the Atlas feed for members, not owners", async () => {
    const p = await createPlace(t.db, { mandateId: M, name: "Sacred cenote", geometry: SQUARE, accuracy: "surveyed", sensitive: true }, "owner@example.com");
    const forMember = (await stewardPlacesFeed(t.db, member)).features.find(f => f.properties.id === p.id)!;
    const forOwner = (await stewardPlacesFeed(t.db, owner)).features.find(f => f.properties.id === p.id)!;
    expect(forMember.geometry.type).toBe("Point");
    expect(forMember.properties.generalised).toBe(1);
    expect(forOwner.geometry.type).toBe("Polygon");
  });
});
