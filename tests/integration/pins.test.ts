// Phase 25 pinned items: scoping, entitlement, limit and replace, uniqueness, removal of unavailable pins, reordering.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mandates, pinnedItems, projects } from "@/db/schema";
import type { UserScope } from "@/lib/db/scoped";
import { listPins, pinRecord, reorderPins, resolvePin, unpin } from "@/lib/pins/queries";
import { pinTarget } from "@/lib/pins/vocab";
import { createTestDb } from "../helpers/d1";

const A = "a0000000-0000-4000-8000-000000000001", B = "b0000000-0000-4000-8000-000000000002";
const U = "pin-user@example.com";
const scope: UserScope = { kind: "user", userId: "u", email: U, mandateIds: [A], ownerOf: [A] };
let t: Awaited<ReturnType<typeof createTestDb>>;
const ids: string[] = [];
let other = "";

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [[A, "a"], [B, "b"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
  for (let i = 0; i < 8; i++) { const [p] = await t.db.insert(projects).values({ mandateId: A, name: `Project ${i}` }).returning({ id: projects.id }); ids.push(p.id); }
  const [o] = await t.db.insert(projects).values({ mandateId: B, name: "Other workspace project" }).returning({ id: projects.id });
  other = o.id;
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("pinned items", () => {
  it("recognises record pages, longest path first", () => {
    expect(pinTarget(`/projects/${A}`)).toEqual({ type: "project", id: A });
    expect(pinTarget(`/funding/applications/${A}`)).toEqual({ type: "funding_application", id: A });
    expect(pinTarget(`/funding/${A}`)).toEqual({ type: "funding_opportunity", id: A });
    expect(pinTarget(`/projects/${A}/record`)).toBeNull();
    expect(pinTarget("/projects")).toBeNull();
  });

  it("never resolves a record in another workspace or outside the user's modules", async () => {
    expect(await resolvePin(t.db, scope, "project", other)).toBeNull();
    expect(await pinRecord(t.db, scope, U, "project", other)).toEqual({ ok: false, reason: "not_found" });
    expect(await resolvePin(t.db, { ...scope, modules: ["command"] }, "project", ids[0])).toBeNull();
    expect((await resolvePin(t.db, scope, "project", ids[0]))?.label).toBe("Project 0");
  });

  it("pins once per record, up to six, then asks which to replace", async () => {
    for (let i = 0; i < 6; i++) expect(await pinRecord(t.db, scope, U, "project", ids[i])).toEqual({ ok: true });
    expect(await pinRecord(t.db, scope, U, "project", ids[0])).toEqual({ ok: true });
    expect((await listPins(t.db, scope, U)).pins).toHaveLength(6);
    expect(await pinRecord(t.db, scope, U, "project", ids[6])).toEqual({ ok: false, reason: "full" });
    const first = (await listPins(t.db, scope, U)).pins[0];
    expect(await pinRecord(t.db, scope, U, "project", ids[6], first.id)).toEqual({ ok: true });
    const after = (await listPins(t.db, scope, U)).pins;
    expect(after).toHaveLength(6);
    expect(after.map(p => p.entityId)).not.toContain(ids[0]);
    expect(after.at(-1)?.entityId).toBe(ids[6]);
  });

  it("shows current names, reorders, and ignores other users' pins", async () => {
    await t.db.update(projects).set({ name: "Renamed project" }).where(eq(projects.id, ids[1]));
    const { pins } = await listPins(t.db, scope, U);
    expect(pins.find(p => p.entityId === ids[1])?.label).toBe("Renamed project");
    const reversed = [...pins].reverse().map(p => p.id);
    await reorderPins(t.db, U, [...reversed, "00000000-0000-4000-8000-00000000dead"]);
    expect((await listPins(t.db, scope, U)).pins.map(p => p.id)).toEqual(reversed);
    expect((await listPins(t.db, { ...scope, email: "someone@example.com" }, "someone@example.com")).pins).toEqual([]);
  });

  it("removes pins the user can no longer open, and unpins", async () => {
    await t.db.update(projects).set({ archivedAt: new Date().toISOString() }).where(eq(projects.id, ids[2]));
    const lost = await listPins(t.db, { ...scope, mandateIds: [] }, U);
    expect(lost.pins).toEqual([]);
    expect(lost.removed).toBe(6);
    expect(await t.db.select().from(pinnedItems).where(eq(pinnedItems.userEmail, U))).toEqual([]);
    await pinRecord(t.db, scope, U, "project", ids[3]);
    const [p] = (await listPins(t.db, scope, U)).pins;
    await unpin(t.db, U, p.id);
    expect((await listPins(t.db, scope, U)).pins).toEqual([]);
  });
});
