import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, mandateMembers, mandates } from "@/db/schema";
import { mandateCondition, systemScope, type Scope } from "@/lib/db/scoped";
import { REGENERA_MANDATE_ID, resolveMembership } from "@/lib/membership";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
beforeEach(async () => {
  await t.db.delete(mandateMembers);
  await t.db.delete(mandates);
  await t.db.delete(auditLog);
});

const allow = new Set(["prado@regenera.bio"]);
const prado = { userId: "u_prado", email: "Prado@Regenera.bio" };

describe("membership bootstrap", () => {
  it("first allowlisted sign-in becomes the Regenera owner", async () => {
    const scope = await resolveMembership(t.db, prado, allow);
    expect(scope?.mandateIds).toEqual([REGENERA_MANDATE_ID]);
    expect(scope?.ownerOf).toEqual([REGENERA_MANDATE_ID]);
    const [m] = await t.db.select().from(mandates);
    expect(m.slug).toBe("regenera");
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "bootstrap_owner"));
    expect(audits).toHaveLength(1);
  });

  it("refuses non-allowlisted accounts", async () => {
    expect(await resolveMembership(t.db, { userId: "u_x", email: "x@example.com" }, allow)).toBeNull();
  });

  it("stops honoring the allowlist once any member exists", async () => {
    await resolveMembership(t.db, prado, allow);
    const other = await resolveMembership(t.db, { userId: "u_y", email: "y@example.com" }, new Set(["y@example.com"]));
    expect(other).toBeNull();
  });

  it("binds the Sites user id and refuses the same email from a different id", async () => {
    await resolveMembership(t.db, prado, allow);
    expect(await resolveMembership(t.db, prado, new Set())).not.toBeNull();
    expect(await resolveMembership(t.db, { userId: "u_imposter", email: prado.email }, new Set())).toBeNull();
  });
});

describe("mandate scoping", () => {
  beforeEach(async () => {
    await t.db.insert(mandates).values([
      { id: "m_a", slug: "a", name: "A", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
      { id: "m_b", slug: "b", name: "B", type: "investment", rules: { massAllowed: false, approvalRequired: true } },
    ]);
    await t.db.insert(mandateMembers).values([
      { mandateId: "m_a", email: "a@example.com", userId: "u_a", role: "owner" },
      { mandateId: "m_b", email: "b@example.com", userId: "u_b", role: "owner" },
    ]);
  });

  const visible = async (scope: Scope) =>
    (await t.db.select().from(mandates).where(mandateCondition(scope, mandates.id))).map(m => m.id).sort();

  it("a member of A cannot see B, and vice versa", async () => {
    const a = await resolveMembership(t.db, { userId: "u_a", email: "a@example.com" }, new Set());
    const b = await resolveMembership(t.db, { userId: "u_b", email: "b@example.com" }, new Set());
    expect(await visible(a!)).toEqual(["m_a"]);
    expect(await visible(b!)).toEqual(["m_b"]);
  });

  it("an empty scope sees nothing", async () => {
    expect(await visible({ kind: "user", userId: "u", email: "e", mandateIds: [], ownerOf: [] })).toEqual([]);
  });

  it("system scope sees everything and is audited", async () => {
    const scope = await systemScope(t.db, "test job");
    expect(await visible(scope)).toEqual(["m_a", "m_b"]);
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, "system_scope"))).toHaveLength(1);
  });
});
