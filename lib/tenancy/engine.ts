// Tenancy engine (docs/plans/phase-10-client-os.md §2 slice 1). Workspaces (`mandates`) stay the isolation boundary:
// a user reads a workspace's data only through a mandate_members grant, and every scoped query already filters on
// those grants. This module adds who the user is (user type, persona, tenant), whether they are still allowed in
// (deactivation, suspended tenants), which modules they may open, and how client users get credentials.
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import { authSessions, loginEvents, mandateMembers, mandates, mcpTokens, osCredentials, osInvites, tenantMembers, tenantModules, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { checkPassword, hashPassword, passwordProblem } from "@/lib/portal/auth";
import { hashToken, newToken, normalizeEmail } from "@/lib/session";
import { CLIENT_MODULES, type ModuleKey, MODULES, type OsUserType, type Persona, PLANS, type PlanKey, REGENERA_TENANT_ID, strongest } from "./vocab";

export const OS_INVITE_DAYS = 7;

export type Access = {
  mandateIds: string[];
  userType: OsUserType;
  persona: Persona;
  tenantIds: string[];
  adminOf: string[];
  modules: ModuleKey[] | "all";
};

/** Idempotent: the Regenera tenant exists and owns every workspace without a tenant. */
export async function ensureRegeneraTenant(db: Db) {
  await db.insert(tenants).values({ id: REGENERA_TENANT_ID, kind: "regenera", legalName: "Regenera", displayName: "Regenera", orgType: "regenera", status: "active", plan: "enterprise" }).onConflictDoNothing();
  await db.update(mandates).set({ tenantId: REGENERA_TENANT_ID }).where(isNull(mandates.tenantId));
}

/**
 * Filters a user's workspace grants by tenant state and resolves their user type and modules.
 * Grants in a workspace whose tenant has the user deactivated, or whose tenant is suspended/offboarded, are dropped.
 * Members with no tenant_members row are Regenera members from before the client layer (migration 0039 backfills).
 */
export async function resolveAccess(db: Db, email: string, grants: { mandateId: string; role: string }[]): Promise<Access | null> {
  if (grants.length === 0) return null;
  const ws = await db.select({ id: mandates.id, tenantId: mandates.tenantId }).from(mandates).where(inArray(mandates.id, grants.map(g => g.mandateId)));
  const tenantOf = new Map(ws.map(w => [w.id, w.tenantId ?? REGENERA_TENANT_ID]));
  const tIds = [...new Set(ws.map(w => w.tenantId ?? REGENERA_TENANT_ID))];
  const [ts, ms] = await Promise.all([
    db.select({ id: tenants.id, kind: tenants.kind, status: tenants.status }).from(tenants).where(inArray(tenants.id, tIds)),
    db.select().from(tenantMembers).where(eq(tenantMembers.email, email)),
  ]);
  const tenant = new Map(ts.map(t => [t.id, t]));
  const member = new Map(ms.map(m => [m.tenantId, m]));
  const allowed = grants.filter(g => {
    const tId = tenantOf.get(g.mandateId);
    if (!tId) return false;
    const t = tenant.get(tId), m = member.get(tId);
    if (m?.status === "deactivated") return false;
    if (t && t.kind === "client" && (t.status === "suspended" || t.status === "offboarded")) return false;
    // A client workspace needs an explicit tenant membership; an orphaned grant gives nothing.
    if (t?.kind === "client" && !m) return false;
    return true;
  });
  if (allowed.length === 0) return null;
  const liveTenants = [...new Set(allowed.map(g => tenantOf.get(g.mandateId)!))];
  const types: OsUserType[] = liveTenants.map(tId => member.get(tId)?.userType ?? (tenant.get(tId)?.kind === "regenera" || !tenant.get(tId) ? "regenera_internal" : "client_user"));
  const userType = strongest(types) ?? "client_user";
  const persona = (liveTenants.map(t => member.get(t)?.persona).find(p => p && p !== "general") ?? "general") as Persona;
  const adminOf = liveTenants.filter(t => member.get(t)?.userType === "client_admin");
  let modules: Access["modules"] = "all";
  if (userType !== "regenera_internal") {
    const rows = await db.select().from(tenantModules).where(inArray(tenantModules.tenantId, liveTenants));
    const nowIso = new Date().toISOString();
    const set = new Set<ModuleKey>();
    for (const tId of liveTenants) {
      const deny = new Set(member.get(tId)?.moduleDeny ?? []);
      for (const r of rows) if (r.tenantId === tId && r.enabled && (!r.expiresAt || r.expiresAt > nowIso) && r.module !== "clients" && !deny.has(r.module)) set.add(r.module);
    }
    modules = [...set];
  }
  return { mandateIds: allowed.map(g => g.mandateId), userType, persona, tenantIds: liveTenants, adminOf, modules };
}

export { hasModule, pathAllowed } from "./vocab";

// ---------------------------------------------------------------------------------------------------------------------
// Tenants

export type NewTenant = { legalName: string; displayName?: string; orgType: typeof tenants.$inferInsert.orgType; jurisdiction?: string; plan?: PlanKey; accountOwner?: string; baseCurrency?: string; status?: typeof tenants.$inferInsert.status };

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";

/** Creates a client tenant with its first workspace and the plan's module entitlements. */
export async function createTenant(db: Db, input: NewTenant, actor: string) {
  if (input.orgType === "regenera") throw new Error("There is one Regenera tenant");
  const [t] = await db.insert(tenants).values({
    legalName: input.legalName.trim(), displayName: (input.displayName || input.legalName).trim(), orgType: input.orgType, jurisdiction: input.jurisdiction ?? "",
    plan: input.plan ?? "custom", accountOwner: input.accountOwner ?? actor, baseCurrency: input.baseCurrency ?? "USD", status: input.status ?? "onboarding",
  }).returning();
  let slug = slugify(t.displayName);
  const [clash] = await db.select({ id: mandates.id }).from(mandates).where(eq(mandates.slug, slug));
  if (clash) slug = `${slug}-${t.id.slice(0, 6)}`;
  const [w] = await db.insert(mandates).values({ slug, name: t.displayName, type: "advisory", rules: { massAllowed: false, approvalRequired: true }, tenantId: t.id }).returning();
  if (input.plan) await applyPlan(db, t.id, input.plan, actor);
  await audit(db, { actor, action: "tenant_created", entity: "tenants", entityId: t.id, after: { legalName: t.legalName, orgType: t.orgType, plan: t.plan, workspace: w.id } });
  return { tenant: t, workspace: w };
}

export async function applyPlan(db: Db, tenantId: string, plan: PlanKey, actor: string) {
  const [t] = await db.select({ kind: tenants.kind }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new Error("Unknown tenant");
  const mods = PLANS[plan].modules;
  for (const m of mods) await setModule(db, tenantId, m, true, actor, "plan");
  await db.update(tenants).set({ plan, updatedAt: new Date().toISOString() }).where(eq(tenants.id, tenantId));
  await audit(db, { actor, action: "tenant_plan", entity: "tenants", entityId: tenantId, after: { plan, modules: mods } });
}

export async function setModule(db: Db, tenantId: string, module: ModuleKey, enabled: boolean, actor: string, source: "plan" | "contract" | "trial" | "beta" = "contract", expiresAt: string | null = null) {
  if (!(module in MODULES)) throw new Error("Unknown module");
  const [t] = await db.select({ kind: tenants.kind }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new Error("Unknown tenant");
  if (module === "clients" && t.kind === "client") throw new Error("The Clients module is Regenera-internal");
  const [before] = await db.select().from(tenantModules).where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.module, module)));
  await db.insert(tenantModules).values({ tenantId, module, enabled, source, expiresAt, updatedBy: actor })
    .onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.module], set: { enabled, source, expiresAt, updatedBy: actor, updatedAt: new Date().toISOString() } });
  await audit(db, { actor, action: "module_entitlement", entity: "tenant_modules", entityId: `${tenantId}:${module}`, before: before ?? null, after: { enabled, source, expiresAt } });
}

export async function tenantWorkspaces(db: Db, tenantId: string) {
  return db.select({ id: mandates.id, name: mandates.name, sandbox: mandates.sandbox }).from(mandates)
    .where(tenantId === REGENERA_TENANT_ID ? or(eq(mandates.tenantId, tenantId), isNull(mandates.tenantId)) : eq(mandates.tenantId, tenantId));
}

/** Sandbox workspace for a tenant: test imports, scenarios and workflows without touching production records. */
export async function createSandbox(db: Db, tenantId: string, actor: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new Error("Unknown tenant");
  const slug = `${slugify(t.displayName)}-sandbox-${crypto.randomUUID().slice(0, 4)}`;
  const [w] = await db.insert(mandates).values({ slug, name: `${t.displayName} · SANDBOX`, type: "advisory", rules: { massAllowed: false, approvalRequired: true }, tenantId, sandbox: true }).returning();
  // Everyone active in the tenant gets the sandbox too.
  const members = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, "active")));
  for (const m of members) await db.insert(mandateMembers).values({ mandateId: w.id, email: m.email, role: m.userType === "client_admin" ? "owner" : "member" }).onConflictDoNothing();
  await audit(db, { actor, action: "sandbox_created", entity: "mandates", entityId: w.id, after: { tenantId } });
  return w;
}

// ---------------------------------------------------------------------------------------------------------------------
// Members, invitations, credentials

export type InviteInput = { tenantId: string; email: string; name?: string; userType: OsUserType; persona?: Persona; workspaceIds: string[]; teams?: string[] };

export async function seatUsage(db: Db, tenantId: string) {
  const [t] = await db.select({ seats: tenants.seatsPurchased }).from(tenants).where(eq(tenants.id, tenantId));
  const active = await db.select({ id: tenantMembers.id }).from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.status, ["active", "invited"])));
  return { purchased: t?.seats ?? 0, used: active.length };
}

/** Creates a single-use invitation. Nothing is emailed: the link is shared by hand (same rule as portal invites). */
export async function inviteOsUser(db: Db, input: InviteInput, actor: string, now = new Date()) {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Invalid email");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId));
  if (!t) throw new Error("Unknown tenant");
  if (input.userType === "regenera_internal" && t.kind !== "regenera") throw new Error("Regenera internal users belong to the Regenera tenant");
  if (t.kind === "regenera" && input.userType !== "regenera_internal" && input.userType !== "read_only") throw new Error("Regenera users are internal or read-only");
  if (t.status === "offboarded" || t.status === "suspended") throw new Error(`Tenant is ${t.status}`);
  const ws = await tenantWorkspaces(db, t.id);
  const own = new Set(ws.map(w => w.id));
  const workspaceIds = input.workspaceIds.filter(w => own.has(w));
  if (workspaceIds.length === 0) throw new Error("Choose at least one workspace of this organization");
  const [existing] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, t.id), eq(tenantMembers.email, email)));
  if (!existing && t.seatsPurchased > 0) {
    const s = await seatUsage(db, t.id);
    if (s.used >= s.purchased) throw new Error(`All ${s.purchased} seats are in use`);
  }
  const token = newToken();
  await db.insert(osInvites).values({
    tenantId: t.id, email, name: input.name ?? "", tokenHash: await hashToken(token), userType: input.userType, persona: input.persona ?? "general",
    workspaceIds, teams: input.teams ?? [], invitedBy: actor, expiresAt: new Date(now.getTime() + OS_INVITE_DAYS * 86_400_000).toISOString(),
  });
  if (!existing) await db.insert(tenantMembers).values({ tenantId: t.id, email, name: input.name ?? "", userType: input.userType, persona: input.persona ?? "general", teams: input.teams ?? [], status: "invited", invitedBy: actor });
  await audit(db, { actor, action: "os_invited", entity: "tenant_members", entityId: `${t.id}:${email}`, after: { userType: input.userType, workspaceIds } });
  return { token, email };
}

export async function openInvite(db: Db, token: string | undefined, now = new Date()) {
  if (!token || token.length > 100) return null;
  const [inv] = await db.select().from(osInvites).where(and(eq(osInvites.tokenHash, await hashToken(token)), isNull(osInvites.usedAt), isNull(osInvites.revokedAt), gt(osInvites.expiresAt, now.toISOString())));
  if (!inv) return null;
  const [m] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, inv.tenantId), eq(tenantMembers.email, inv.email)));
  if (m?.status === "deactivated") return null;
  const [t] = await db.select({ displayName: tenants.displayName, status: tenants.status }).from(tenants).where(eq(tenants.id, inv.tenantId));
  if (!t || t.status === "offboarded" || t.status === "suspended") return null;
  return { invite: inv, tenantName: t.displayName };
}

/** Accepts an invitation: sets the password (hashed), activates the member and grants the invited workspaces. Single use. */
export async function acceptOsInvite(db: Db, token: string | undefined, password: string, now = new Date()): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const open = await openInvite(db, token, now);
  if (!open) return { ok: false, reason: "This invitation is invalid, used or expired." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, reason: problem };
  const inv = open.invite;
  // Mark used first so a replay in parallel cannot grant twice.
  const used = await db.update(osInvites).set({ usedAt: now.toISOString() }).where(and(eq(osInvites.id, inv.id), isNull(osInvites.usedAt))).returning({ id: osInvites.id });
  if (used.length === 0) return { ok: false, reason: "This invitation is invalid, used or expired." };
  const hash = await hashPassword(password);
  await db.insert(osCredentials).values({ email: inv.email, passwordHash: hash }).onConflictDoUpdate({ target: osCredentials.email, set: { passwordHash: hash, updatedAt: now.toISOString() } });
  await db.insert(tenantMembers).values({ tenantId: inv.tenantId, email: inv.email, name: inv.name, userType: inv.userType, persona: inv.persona, teams: inv.teams, status: "active", invitedBy: inv.invitedBy })
    .onConflictDoUpdate({ target: [tenantMembers.tenantId, tenantMembers.email], set: { userType: inv.userType, persona: inv.persona, teams: inv.teams, status: "active", updatedAt: now.toISOString() } });
  for (const w of inv.workspaceIds) {
    const role = inv.userType === "client_admin" ? "owner" as const : "member" as const;
    await db.insert(mandateMembers).values({ mandateId: w, email: inv.email, role }).onConflictDoUpdate({ target: [mandateMembers.mandateId, mandateMembers.email], set: { role, updatedAt: now.toISOString() } });
  }
  await audit(db, { actor: inv.email, action: "os_invite_accepted", entity: "tenant_members", entityId: `${inv.tenantId}:${inv.email}`, after: { userType: inv.userType } });
  return { ok: true, email: inv.email };
}

export async function revokeInvite(db: Db, inviteId: string, tenantId: string, actor: string) {
  await db.update(osInvites).set({ revokedAt: new Date().toISOString() }).where(and(eq(osInvites.id, inviteId), eq(osInvites.tenantId, tenantId)));
  await audit(db, { actor, action: "os_invite_revoked", entity: "os_invites", entityId: inviteId });
}

/** Deactivates a member in one tenant: their grants there stop working at once; sessions and API tokens end if nothing else is left. */
export async function deactivateMember(db: Db, tenantId: string, email: string, actor: string) {
  const e = email.toLowerCase();
  if (e === actor.toLowerCase()) throw new Error("You cannot deactivate yourself");
  const [m] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.email, e)));
  if (!m) throw new Error("Not a member");
  const nowIso = new Date().toISOString();
  await db.update(tenantMembers).set({ status: "deactivated", deactivatedAt: nowIso, deactivatedBy: actor, updatedAt: nowIso }).where(eq(tenantMembers.id, m.id));
  await db.update(osInvites).set({ revokedAt: nowIso }).where(and(eq(osInvites.tenantId, tenantId), eq(osInvites.email, e), isNull(osInvites.usedAt)));
  const grants = await db.select({ mandateId: mandateMembers.mandateId, role: mandateMembers.role }).from(mandateMembers).where(eq(mandateMembers.email, e));
  if (!(await resolveAccess(db, e, grants))) {
    await db.delete(authSessions).where(eq(authSessions.email, e));
    await db.update(mcpTokens).set({ revokedAt: nowIso }).where(and(eq(mcpTokens.userEmail, e), isNull(mcpTokens.revokedAt)));
  }
  await audit(db, { actor, action: "member_deactivated", entity: "tenant_members", entityId: m.id, before: { status: m.status }, after: { status: "deactivated" } });
}

export async function reactivateMember(db: Db, tenantId: string, email: string, actor: string) {
  await db.update(tenantMembers).set({ status: "active", deactivatedAt: null, deactivatedBy: null, updatedAt: new Date().toISOString() }).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.email, email.toLowerCase())));
  await audit(db, { actor, action: "member_reactivated", entity: "tenant_members", entityId: `${tenantId}:${email}` });
}

/** Admin edit of a member. A client admin can never grant Regenera-internal, and cannot elevate beyond client admin. */
export async function updateMember(db: Db, tenantId: string, email: string, patch: { userType?: OsUserType; persona?: Persona; teams?: string[]; moduleDeny?: string[] }, actor: string, actorIsInternal: boolean) {
  const [t] = await db.select({ kind: tenants.kind }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new Error("Unknown tenant");
  if (patch.userType === "regenera_internal" && (t.kind !== "regenera" || !actorIsInternal)) throw new Error("Only the Regenera tenant has internal users");
  if (patch.moduleDeny) patch.moduleDeny = patch.moduleDeny.filter(m => (CLIENT_MODULES as string[]).includes(m));
  const [before] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.email, email.toLowerCase())));
  if (!before) throw new Error("Not a member");
  await db.update(tenantMembers).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(tenantMembers.id, before.id));
  if (patch.userType) {
    // Workspace role follows the user type: client admins own their organization's workspaces.
    const ws = (await tenantWorkspaces(db, tenantId)).map(w => w.id);
    if (ws.length) await db.update(mandateMembers).set({ role: patch.userType === "client_admin" ? "owner" : "member" }).where(and(eq(mandateMembers.email, before.email), inArray(mandateMembers.mandateId, ws)));
  }
  await audit(db, { actor, action: "member_updated", entity: "tenant_members", entityId: before.id, before: { userType: before.userType, persona: before.persona, teams: before.teams, moduleDeny: before.moduleDeny }, after: patch });
}

/** Password check for sign-in: invited OS users use their own credential; everyone else the Regenera check. */
export async function credentialFor(db: Db, email: string) {
  const [c] = await db.select().from(osCredentials).where(eq(osCredentials.email, email));
  return c ? (password: string) => checkPassword(password, c.passwordHash) : null;
}

/** Login history for the security center. Failed attempts are recorded too (lockout itself stays in auth_failures). */
export async function recordLogin(db: Db, input: { email: string; ok: boolean; method: string; ip: string; userAgent: string }) {
  await db.insert(loginEvents).values({ ...input, userAgent: input.userAgent.slice(0, 200) });
  if (input.ok) await db.update(tenantMembers).set({ lastLoginAt: new Date().toISOString() }).where(eq(tenantMembers.email, input.email));
}
