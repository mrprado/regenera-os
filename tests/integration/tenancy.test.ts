// Client operating layer security (docs/plans/phase-10-client-os.md; prompt §108): tenant segregation through workspace
// grants, no elevation, client admins never reach Regenera commercial data, invitations are single-use and expire,
// deactivated users and suspended organizations lose access, module entitlements gate routes.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authSessions, engagements, mandateMembers, mandates, osCredentials, osInvites, projects, tenantMembers, tenantModules, tenants } from "@/db/schema";
import { mandateCondition } from "@/lib/db/scoped";
import { resolveMembership } from "@/lib/membership";
import { acceptOsInvite, applyPlan, createTenant, credentialFor, deactivateMember, ensureRegeneraTenant, inviteOsUser, pathAllowed, setModule, updateMember } from "@/lib/tenancy/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const R = "mandate_regenera";
const who = (email: string) => resolveMembership(t.db, { userId: `email:${email}`, email }, new Set());
let A = { tenant: "", ws: "" }, B = { tenant: "", ws: "" };

async function member(tenantId: string, ws: string, email: string, userType: "client_admin" | "client_user" | "read_only", now = new Date()) {
  const { token } = await inviteOsUser(t.db, { tenantId, email, userType, workspaceIds: [ws] }, "alan@regenera.bio", now);
  const r = await acceptOsInvite(t.db, token, "correct horse 42 battery", now);
  expect(r.ok).toBe(true);
  return token;
}

beforeEach(async () => {
  for (const x of [osInvites, osCredentials, tenantModules, tenantMembers, engagements, projects, mandateMembers, authSessions, mandates, tenants]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: R, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  await t.db.insert(mandateMembers).values({ mandateId: R, email: "alan@regenera.bio", role: "owner" });
  await ensureRegeneraTenant(t.db);
  const a = await createTenant(t.db, { legalName: "Alpha Family Office AG", orgType: "family_office", plan: "core" }, "alan@regenera.bio");
  const b = await createTenant(t.db, { legalName: "Beta Renewables SA", orgType: "renewable_developer", plan: "professional" }, "alan@regenera.bio");
  A = { tenant: a.tenant.id, ws: a.workspace.id }; B = { tenant: b.tenant.id, ws: b.workspace.id };
  await t.db.insert(projects).values([{ mandateId: A.ws, name: "Alpha estate" }, { mandateId: B.ws, name: "Beta solar" }, { mandateId: R, name: "Regenera internal" }] as never);
  await t.db.insert(engagements).values({ mandateId: R, name: "Alpha OS implementation", fee: 120000 });
});

describe("segregation", () => {
  it("existing members stay Regenera internal with every module", async () => {
    const s = await who("alan@regenera.bio");
    expect(s).toMatchObject({ userType: "regenera_internal", modules: "all" });
  });

  it("Client A cannot read Client B's projects, nor Regenera's", async () => {
    await member(A.tenant, A.ws, "cfo@alpha.example", "client_user");
    const s = (await who("cfo@alpha.example"))!;
    expect(s.mandateIds).toEqual([A.ws]);
    const rows = await t.db.select({ name: projects.name }).from(projects).where(mandateCondition(s, projects.mandateId));
    expect(rows.map(r => r.name)).toEqual(["Alpha estate"]);
  });

  it("a client admin never reaches Regenera commercial data or the Clients module", async () => {
    await member(A.tenant, A.ws, "admin@alpha.example", "client_admin");
    const s = (await who("admin@alpha.example"))!;
    expect(s.adminOf).toEqual([A.tenant]);
    expect(await t.db.select().from(engagements).where(mandateCondition(s, engagements.mandateId))).toHaveLength(0);
    expect(pathAllowed(s.modules, "/commercial")).toBe(false);
    expect(pathAllowed(s.modules, "/clients/x")).toBe(false);
    await expect(setModule(t.db, A.tenant, "clients", true, "alan@regenera.bio")).rejects.toThrow(/internal/);
  });

  it("an orphaned grant in a client workspace (no tenant membership) gives nothing", async () => {
    await t.db.insert(mandateMembers).values({ mandateId: B.ws, email: "stray@x.example", role: "owner" });
    expect(await who("stray@x.example")).toBeNull();
  });
});

describe("no elevation", () => {
  it("client users cannot become Regenera internal, by invite or by edit", async () => {
    await expect(inviteOsUser(t.db, { tenantId: A.tenant, email: "x@alpha.example", userType: "regenera_internal", workspaceIds: [A.ws] }, "admin@alpha.example")).rejects.toThrow(/Regenera tenant/);
    await member(A.tenant, A.ws, "u@alpha.example", "client_user");
    await expect(updateMember(t.db, A.tenant, "u@alpha.example", { userType: "regenera_internal" }, "admin@alpha.example", false)).rejects.toThrow(/internal/);
  });

  it("an invitation can only grant the inviting organization's workspaces", async () => {
    await expect(inviteOsUser(t.db, { tenantId: A.tenant, email: "x@alpha.example", userType: "client_user", workspaceIds: [B.ws, R] }, "admin@alpha.example")).rejects.toThrow(/workspace/);
  });

  it("read-only users resolve as read-only", async () => {
    await member(B.tenant, B.ws, "viewer@beta.example", "read_only");
    expect((await who("viewer@beta.example"))?.userType).toBe("read_only");
  });
});

describe("invitations", () => {
  it("are single use", async () => {
    const token = await member(A.tenant, A.ws, "u@alpha.example", "client_user");
    expect(await acceptOsInvite(t.db, token, "another pass 99 word")).toMatchObject({ ok: false });
  });

  it("expire", async () => {
    const past = new Date(Date.now() - 8 * 86_400_000);
    const { token } = await inviteOsUser(t.db, { tenantId: A.tenant, email: "late@alpha.example", userType: "client_user", workspaceIds: [A.ws] }, "alan@regenera.bio", past);
    expect(await acceptOsInvite(t.db, token, "correct horse 42 battery")).toMatchObject({ ok: false });
    expect(await who("late@alpha.example")).toBeNull();
  });

  it("store only a PBKDF2 hash, which then checks the password", async () => {
    await member(A.tenant, A.ws, "u@alpha.example", "client_user");
    const [c] = await t.db.select().from(osCredentials).where(eq(osCredentials.email, "u@alpha.example"));
    expect(c.passwordHash).not.toContain("correct horse");
    const check = (await credentialFor(t.db, "u@alpha.example"))!;
    expect(await check("correct horse 42 battery")).toBe(true);
    expect(await check("wrong")).toBe(false);
  });

  it("respect purchased seats", async () => {
    await t.db.update(tenants).set({ seatsPurchased: 1 }).where(eq(tenants.id, A.tenant));
    await member(A.tenant, A.ws, "one@alpha.example", "client_user");
    await expect(inviteOsUser(t.db, { tenantId: A.tenant, email: "two@alpha.example", userType: "client_user", workspaceIds: [A.ws] }, "alan@regenera.bio")).rejects.toThrow(/seats/);
  });
});

describe("deactivation and suspension", () => {
  it("a deactivated user loses access and their sessions", async () => {
    await member(A.tenant, A.ws, "gone@alpha.example", "client_user");
    await t.db.insert(authSessions).values({ tokenHash: "h1", email: "gone@alpha.example", expiresAt: "2099-01-01" });
    await deactivateMember(t.db, A.tenant, "gone@alpha.example", "admin@alpha.example");
    expect(await who("gone@alpha.example")).toBeNull();
    expect(await t.db.select().from(authSessions).where(eq(authSessions.email, "gone@alpha.example"))).toHaveLength(0);
  });

  it("a suspended organization's users lose access; Regenera staff keep theirs", async () => {
    await member(A.tenant, A.ws, "u@alpha.example", "client_user");
    await t.db.insert(tenantMembers).values({ tenantId: A.tenant, email: "alan@regenera.bio", userType: "client_admin" }).onConflictDoNothing();
    await t.db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, A.tenant));
    expect(await who("u@alpha.example")).toBeNull();
    expect((await who("alan@regenera.bio"))?.mandateIds).toEqual([R]);
  });
});

describe("entitlements", () => {
  it("modules follow the plan, member restrictions and contract changes", async () => {
    await member(A.tenant, A.ws, "u@alpha.example", "client_user");
    let s = (await who("u@alpha.example"))!;
    expect(pathAllowed(s.modules, "/projects/123")).toBe(true);
    expect(pathAllowed(s.modules, "/capital")).toBe(false);          // core plan
    expect(pathAllowed(s.modules, "/org")).toBe(true);               // no module needed
    expect(pathAllowed(s.modules, "/settings/jobs")).toBe(false);    // platform administration is Regenera-internal
    await applyPlan(t.db, A.tenant, "professional", "alan@regenera.bio");
    await updateMember(t.db, A.tenant, "u@alpha.example", { moduleDeny: ["deals", "clients"] }, "admin@alpha.example", false);
    s = (await who("u@alpha.example"))!;
    expect(pathAllowed(s.modules, "/capital")).toBe(true);
    expect(pathAllowed(s.modules, "/deals")).toBe(false);
    await setModule(t.db, A.tenant, "capital", false, "alan@regenera.bio");
    s = (await who("u@alpha.example"))!;
    expect(pathAllowed(s.modules, "/capital/alignment")).toBe(false);
    const [row] = await t.db.select().from(tenantModules).where(and(eq(tenantModules.tenantId, A.tenant), eq(tenantModules.module, "capital")));
    expect(row.enabled).toBe(false);
  });
});
