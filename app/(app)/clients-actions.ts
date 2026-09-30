"use server";

// Clients (Regenera internal): create client organizations, record offboarding steps. Owners of the Regenera workspace only.
import { and, eq, inArray, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accountConnections, tenantMembers, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { canSetEntitlements } from "@/lib/tenancy/access";
import { createTenant, deactivateMember, tenantWorkspaces } from "@/lib/tenancy/engine";
import { OFFBOARDING_STEPS, ORG_TYPES, PLANS } from "@/lib/tenancy/vocab";

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const zTenant = z.string().min(1).max(64).regex(/^[\w-]+$/);

export async function createClientAction(formData: FormData) {
  let id = "";
  await withOsUser(async user => {
    if (!canSetEntitlements(user.scope)) throw new Error("Regenera owners only");
    const legalName = str(formData, "legalName", 200);
    if (!legalName) throw new Error("Legal name required");
    const plan = z.enum(keys(PLANS)).catch("custom").parse(formData.get("plan"));
    const { tenant } = await createTenant(appDb(), { legalName, displayName: str(formData, "displayName", 120) || undefined, orgType: z.enum(keys(ORG_TYPES)).parse(formData.get("orgType")), jurisdiction: str(formData, "jurisdiction", 80), plan, baseCurrency: str(formData, "baseCurrency", 3).toUpperCase() || "USD", status: formData.get("status") === "prospect" ? "prospect" : "onboarding" }, user.email);
    const crm = str(formData, "crmOrgId", 64);
    if (crm) await appDb().update(tenants).set({ crmOrgId: crm }).where(eq(tenants.id, tenant.id));
    id = tenant.id;
  }, { internal: true });
  redirect(`/clients/${id}?notice=${encodeURIComponent("Client organization created with its first workspace. Invite its administrator from Organization → Users.")}`);
}

export async function offboardingStepAction(formData: FormData) {
  const tenantId = zTenant.parse(formData.get("tenantId"));
  const step = z.enum(keys(OFFBOARDING_STEPS)).parse(formData.get("step"));
  const note = str(formData, "note", 500);
  await withOsUser(async user => {
    if (!canSetEntitlements(user.scope)) throw new Error("Regenera owners only");
    const db = appDb();
    const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t || t.kind !== "client") throw new Error("Unknown client");
    const now = new Date().toISOString();
    // Steps with a system effect do it here; the rest are recorded with who and when. Nothing is deleted automatically.
    if (step === "freeze") await db.update(tenants).set({ status: "offboarding" }).where(eq(tenants.id, tenantId));
    if (step === "deactivate") {
      const ms = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), ne(tenantMembers.status, "deactivated")));
      for (const m of ms) if (m.email !== user.email) await deactivateMember(db, tenantId, m.email, user.email);
    }
    if (step === "integrations") {
      const ws = (await tenantWorkspaces(db, tenantId)).map(w => w.id);
      if (ws.length) await db.update(accountConnections).set({ status: "disconnected", updatedAt: now }).where(inArray(accountConnections.mandateId, ws));
    }
    if (step === "archive") await db.update(tenants).set({ status: "offboarded" }).where(eq(tenants.id, tenantId));
    await db.update(tenants).set({ offboarding: { ...t.offboarding, [step]: { done: ["done"], note, completedAt: now } }, updatedAt: now }).where(eq(tenants.id, tenantId));
    await audit(db, { actor: user.email, action: "offboarding_step", entity: "tenants", entityId: tenantId, after: { step, note } });
  }, { internal: true });
  redirect(`/clients/${tenantId}?tab=offboarding&notice=${encodeURIComponent(`${OFFBOARDING_STEPS[step]}: recorded.`)}`);
}
