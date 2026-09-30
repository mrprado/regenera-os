"use server";

// Organization console actions (client admin + Regenera). Every action re-checks tenant administration server-side.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { mcpTokens, orgUnits, teams, tenantMembers, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { appDb } from "@/lib/db/scoped";
import { canAdminTenant, canSetEntitlements } from "@/lib/tenancy/access";
import { applyPlan, createSandbox, deactivateMember, inviteOsUser, reactivateMember, revokeInvite, setModule, updateMember } from "@/lib/tenancy/engine";
import {
  CLIENT_MODULES, LANGUAGES, MODULES, ONBOARDING_STEPS, ORG_INVITE_FLASH, ORG_TYPES, OS_USER_TYPES, PERSONAS, PLANS, SUPPORT_TIERS, TEAM_KINDS, TENANT_STATUSES, UNIT_KINDS, UNIT_SYSTEMS,
} from "@/lib/tenancy/vocab";

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const int = (f: FormData, k: string) => { const n = Number(str(f, k)); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
const zTenant = z.string().min(1).max(64).regex(/^[\w-]+$/);
const back = (tenantId: string, tab: string, text: string) => `/org?tenant=${tenantId}&tab=${tab}&notice=${encodeURIComponent(text)}`;

type Scope = Parameters<typeof canAdminTenant>[0];
function admin(scope: Scope, tenantId: string) { if (!canAdminTenant(scope, tenantId)) throw new Error("Not an administrator of this organization"); }

export async function saveOrgProfileAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const [before] = await appDb().select().from(tenants).where(eq(tenants.id, tenantId));
    const langs = formData.getAll("languages").map(String).filter(l => l in LANGUAGES);
    const accent = str(formData, "accent", 7);
    const patch = {
      displayName: str(formData, "displayName", 120) || before.displayName, legalName: str(formData, "legalName", 200) || before.legalName,
      jurisdiction: str(formData, "jurisdiction", 80), headquarters: str(formData, "headquarters", 120), website: str(formData, "website", 200),
      baseCurrency: (str(formData, "baseCurrency", 3).toUpperCase() || "USD").replace(/[^A-Z]/g, "").slice(0, 3) || "USD",
      units: z.enum(keys(UNIT_SYSTEMS)).catch(before.units).parse(formData.get("units")),
      timezone: str(formData, "timezone", 60) || "UTC", languages: langs.length ? langs : ["en"], dateFormat: str(formData, "dateFormat", 20) || "YYYY-MM-DD",
      reportingPrefs: str(formData, "reportingPrefs", 1000),
      branding: { logoUrl: str(formData, "logoUrl", 300) || undefined, accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : undefined, reportFooter: str(formData, "reportFooter", 200) || undefined, customDomain: before.branding.customDomain },
      ...(before.kind === "client" ? { orgType: z.enum(keys(ORG_TYPES)).catch(before.orgType).parse(formData.get("orgType")) } : {}),
      updatedAt: new Date().toISOString(),
    };
    await appDb().update(tenants).set(patch).where(eq(tenants.id, tenantId));
    await audit(appDb(), { actor: user.email, action: "tenant_profile", entity: "tenants", entityId: tenantId, before, after: patch });
  });
  redirect(back(tenantId, "profile", "Profile saved."));
}

/** Contract terms (plan, seats, status, support tier, renewal): Regenera owners only. */
export async function saveAccountTermsAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => {
    if (!canSetEntitlements(user.scope)) throw new Error("Regenera owners only");
    const [before] = await appDb().select().from(tenants).where(eq(tenants.id, tenantId));
    const patch = {
      status: z.enum(keys(TENANT_STATUSES)).catch(before.status).parse(formData.get("status")),
      supportTier: z.enum(keys(SUPPORT_TIERS)).catch(before.supportTier).parse(formData.get("supportTier")),
      seatsPurchased: int(formData, "seatsPurchased"), externalSeats: int(formData, "externalSeats"), storageGb: int(formData, "storageGb"), apiDailyLimit: int(formData, "apiDailyLimit"),
      clientSince: str(formData, "clientSince", 10) || null, renewalDate: str(formData, "renewalDate", 10) || null, terminationDate: str(formData, "terminationDate", 10) || null,
      renewalLikelihood: str(formData, "renewalLikelihood", 200) || null, accountOwner: str(formData, "accountOwner", 200) || before.accountOwner,
      updatedAt: new Date().toISOString(),
    };
    if (before.kind === "regenera" && patch.status !== "active") throw new Error("The Regenera tenant stays active");
    await appDb().update(tenants).set(patch).where(eq(tenants.id, tenantId));
    await audit(appDb(), { actor: user.email, action: "tenant_terms", entity: "tenants", entityId: tenantId, before, after: patch });
  });
  redirect(back(tenantId, "modules", "Account terms saved."));
}

export async function addOrgUnitAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const parentId = str(formData, "parentId", 64) || null;
    if (parentId) { const [p] = await appDb().select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.id, parentId), eq(orgUnits.tenantId, tenantId))); if (!p) throw new Error("Unknown parent"); }
    const [u] = await appDb().insert(orgUnits).values({ tenantId, parentId, kind: z.enum(keys(UNIT_KINDS)).parse(formData.get("kind")), name: str(formData, "name", 160) || "Unnamed", jurisdiction: str(formData, "jurisdiction", 80), ownershipPct: str(formData, "ownershipPct", 10) || null, notes: str(formData, "notes", 500) }).returning();
    await audit(appDb(), { actor: user.email, action: "org_unit_added", entity: "org_units", entityId: u.id, after: u });
  });
  redirect(back(tenantId, "structure", "Entity added."));
}

export async function removeOrgUnitAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const id = z.string().uuid().parse(formData.get("unitId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const children = await appDb().select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.parentId, id)));
    if (children.length) throw new Error("Remove or move its child entities first");
    await appDb().delete(orgUnits).where(and(eq(orgUnits.id, id), eq(orgUnits.tenantId, tenantId)));
    await audit(appDb(), { actor: user.email, action: "org_unit_removed", entity: "org_units", entityId: id });
  });
  redirect(back(tenantId, "structure", "Entity removed."));
}

export async function inviteOrgUserAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const { token, email } = await inviteOsUser(appDb(), {
      tenantId, email: str(formData, "email", 254), name: str(formData, "name", 120), userType: z.enum(OS_USER_TYPES).parse(formData.get("userType")),
      persona: z.enum(keys(PERSONAS)).catch("general").parse(formData.get("persona")), workspaceIds: formData.getAll("workspaceIds").map(String), teams: formData.getAll("teams").map(String).slice(0, 20),
    }, user.email);
    (await cookies()).set(ORG_INVITE_FLASH, `${email}|/join/${token}`, { httpOnly: true, sameSite: "lax", path: withBase("/org"), maxAge: 300, secure: true });
  });
  redirect(back(tenantId, "users", "Invitation created. Copy the link below and send it yourself; it works once and expires in 7 days."));
}

export async function revokeOrgInviteAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => { admin(user.scope, tenantId); await revokeInvite(appDb(), z.string().uuid().parse(formData.get("inviteId")), tenantId, user.email); });
  redirect(back(tenantId, "users", "Invitation withdrawn."));
}

export async function updateOrgMemberAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const internalActor = user.scope.userType === undefined || user.scope.userType === "regenera_internal";
    await updateMember(appDb(), tenantId, str(formData, "email", 254), {
      userType: z.enum(OS_USER_TYPES).parse(formData.get("userType")), persona: z.enum(keys(PERSONAS)).catch("general").parse(formData.get("persona")),
      teams: formData.getAll("teams").map(String).slice(0, 20), moduleDeny: CLIENT_MODULES.filter(m => !formData.getAll("modules").map(String).includes(m)),
    }, user.email, internalActor);
  });
  redirect(back(tenantId, "users", "Member updated."));
}

export async function deactivateOrgMemberAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => { admin(user.scope, tenantId); await deactivateMember(appDb(), tenantId, str(formData, "email", 254), user.email); });
  redirect(back(tenantId, "users", "Member deactivated: their access, sessions and API tokens ended."));
}

export async function reactivateOrgMemberAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => { admin(user.scope, tenantId); await reactivateMember(appDb(), tenantId, str(formData, "email", 254), user.email); });
  redirect(back(tenantId, "users", "Member reactivated."));
}

export async function saveTeamAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const [tm] = await appDb().insert(teams).values({ tenantId, name: str(formData, "name", 80) || "Team", kind: z.enum(keys(TEAM_KINDS)).catch("other").parse(formData.get("kind")), description: str(formData, "description", 300) }).onConflictDoNothing().returning();
    if (tm) await audit(appDb(), { actor: user.email, action: "team_created", entity: "teams", entityId: tm.id, after: tm });
  });
  redirect(back(tenantId, "teams", "Team saved."));
}

export async function deleteTeamAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const id = z.string().uuid().parse(formData.get("teamId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    await appDb().delete(teams).where(and(eq(teams.id, id), eq(teams.tenantId, tenantId)));
    const ms = await appDb().select().from(tenantMembers).where(eq(tenantMembers.tenantId, tenantId));
    for (const m of ms.filter(x => x.teams.includes(id))) await appDb().update(tenantMembers).set({ teams: m.teams.filter(t => t !== id) }).where(eq(tenantMembers.id, m.id));
    await audit(appDb(), { actor: user.email, action: "team_deleted", entity: "teams", entityId: id });
  });
  redirect(back(tenantId, "teams", "Team removed."));
}

export async function setModuleAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const mod = z.enum(keys(MODULES)).parse(formData.get("module"));
  await withOsUser(async user => {
    if (!canSetEntitlements(user.scope)) throw new Error("Entitlements follow the contract; Regenera owners change them");
    await setModule(appDb(), tenantId, mod, formData.get("enabled") === "on", user.email, z.enum(["plan", "contract", "trial", "beta"]).catch("contract").parse(formData.get("source")), str(formData, "expiresAt", 10) || null);
  });
  redirect(back(tenantId, "modules", `${MODULES[mod]} updated.`));
}

export async function applyPlanAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const plan = z.enum(keys(PLANS)).parse(formData.get("plan"));
  await withOsUser(async user => { if (!canSetEntitlements(user.scope)) throw new Error("Regenera owners only"); await applyPlan(appDb(), tenantId, plan, user.email); });
  redirect(back(tenantId, "modules", `${PLANS[plan].label} modules applied. Modules outside the plan are unchanged; switch them off individually if the contract says so.`));
}

export async function requestModuleAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const mod = z.enum(keys(MODULES)).parse(formData.get("module"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const [t] = await appDb().select({ req: tenants.requestedModules }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t.req.includes(mod)) await appDb().update(tenants).set({ requestedModules: [...t.req, mod] }).where(eq(tenants.id, tenantId));
    await audit(appDb(), { actor: user.email, action: "module_requested", entity: "tenants", entityId: tenantId, after: { module: mod } });
  });
  redirect(back(tenantId, "modules", "Request recorded. Your Regenera account owner will follow up."));
}

export async function onboardingItemAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const step = z.enum(keys(ONBOARDING_STEPS)).parse(formData.get("step"));
  const item = str(formData, "item", 80);
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    if (!(ONBOARDING_STEPS[step].items as readonly string[]).includes(item)) throw new Error("Unknown item");
    const [t] = await appDb().select({ o: tenants.onboarding, status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    const cur = t.o[step] ?? { done: [] };
    const done = cur.done.includes(item) ? cur.done.filter(x => x !== item) : [...cur.done, item];
    const next = { ...t.o, [step]: { done, completedAt: done.length === ONBOARDING_STEPS[step].items.length ? new Date().toISOString() : null } };
    const allDone = (Object.keys(ONBOARDING_STEPS) as (keyof typeof ONBOARDING_STEPS)[]).every(s => (next[s]?.done.length ?? 0) === ONBOARDING_STEPS[s].items.length);
    await appDb().update(tenants).set({ onboarding: next, ...(allDone && t.status === "onboarding" ? { status: "active" as const, clientSince: new Date().toISOString().slice(0, 10) } : {}) }).where(eq(tenants.id, tenantId));
    await audit(appDb(), { actor: user.email, action: "onboarding_item", entity: "tenants", entityId: tenantId, after: { step, item, done: done.includes(item), live: allDone } });
  });
  redirect(back(tenantId, "onboarding", "Onboarding updated."));
}

export async function createSandboxAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  await withOsUser(async user => { admin(user.scope, tenantId); await createSandbox(appDb(), tenantId, user.email); });
  redirect(back(tenantId, "data", "Sandbox workspace created. Switch to it in the header; everything in it is marked SANDBOX."));
}

export async function revokeMemberTokenAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const id = z.string().uuid().parse(formData.get("tokenId"));
  await withOsUser(async user => {
    admin(user.scope, tenantId);
    const emails = (await appDb().select({ e: tenantMembers.email }).from(tenantMembers).where(eq(tenantMembers.tenantId, tenantId))).map(r => r.e);
    if (emails.length) await appDb().update(mcpTokens).set({ revokedAt: new Date().toISOString() }).where(and(eq(mcpTokens.id, id), inArray(mcpTokens.userEmail, emails), isNull(mcpTokens.revokedAt)));
    await audit(appDb(), { actor: user.email, action: "api_token_revoked", entity: "mcp_tokens", entityId: id });
  });
  redirect(back(tenantId, "api", "Token revoked."));
}
