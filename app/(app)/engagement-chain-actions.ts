"use server";

// Client lifecycle on an engagement (phase 10): type, revenue category, discovery record, renewal/SLA/reporting,
// mandates (defined scopes of work) and workstreams. Scoped through the engagement's workspace.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { engagements, projects, workMandates, workstreams } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { ENGAGEMENT_TYPES, ENTRY_POINTS, REVENUE_CATEGORIES, WORK_MANDATE_STATUSES, WORKSTREAM_KINDS, WORKSTREAM_STATUSES } from "@/lib/commercial/vocab";
import { MODULES } from "@/lib/tenancy/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const back = (id: string, text: string) => `/commercial/engagements/${id}?notice=${encodeURIComponent(text)}#lifecycle`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedEngagement(scope: Scope, id: string) {
  const [e] = await appDb().select().from(engagements).where(and(eq(engagements.id, id), mandateCondition(scope, engagements.mandateId)));
  if (!e) throw new Error("Engagement not found");
  return e;
}

export async function saveLifecycleAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const patch = {
      engagementType: z.enum(keys(ENGAGEMENT_TYPES)).nullable().catch(null).parse(formData.get("engagementType") || null),
      revenueCategory: z.enum(keys(REVENUE_CATEGORIES)).nullable().catch(null).parse(formData.get("revenueCategory") || null),
      entryPoint: z.enum(keys(ENTRY_POINTS)).nullable().catch(null).parse(formData.get("entryPoint") || null),
      tenantId: str(formData, "tenantId", 64) || null,
      renewalDate: date(formData, "renewalDate"), reportingCadence: str(formData, "reportingCadence", 200), sla: str(formData, "sla", 200), successCriteria: str(formData, "successCriteria", 2000),
      includedModules: formData.getAll("includedModules").map(String).filter(m => m in MODULES && m !== "clients"),
      updatedAt: new Date().toISOString(),
    };
    await appDb().update(engagements).set(patch).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_lifecycle", entity: "engagements", entityId: id, before: { engagementType: e.engagementType, revenueCategory: e.revenueCategory }, after: patch });
  });
  redirect(back(id, "Lifecycle saved."));
}

export async function saveDiscoveryAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedEngagement(user.scope, id);
    const v = Number(str(formData, "estimatedValue").replace(/[^0-9.]/g, ""));
    const discovery = Object.fromEntries(["problem", "decision", "objective", "assets", "team", "currentSystems", "painPoints", "dataAvailability", "capitalSituation", "deadline", "budget", "buyingAuthority", "urgency", "likelyScope", "nextAction"]
      .map(k => [k, str(formData, k, 1500)]).filter(([, x]) => x));
    await appDb().update(engagements).set({ discovery: { ...discovery, estimatedValue: Number.isFinite(v) && v > 0 ? v : null, recordedAt: new Date().toISOString(), recordedBy: user.email }, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_discovery", entity: "engagements", entityId: id });
  });
  redirect(back(id, "Discovery record saved."));
}

export async function addWorkMandateAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const projectIds = formData.getAll("projectIds").map(String).filter(x => zId.safeParse(x).success);
    if (projectIds.length) {
      const ok = await appDb().select({ id: projects.id }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId)));
      const allowed = new Set(ok.map(p => p.id));
      if (projectIds.some(p => !allowed.has(p))) throw new Error("Project not in your workspaces");
    }
    const [m] = await appDb().insert(workMandates).values({
      mandateId: e.mandateId, engagementId: id, name: z.string().trim().min(2).max(200).parse(formData.get("name")), objective: str(formData, "objective", 1500), projectIds,
      geography: str(formData, "geography", 200), assetType: str(formData, "assetType", 120), scope: str(formData, "scope", 3000), capitalRequirement: str(formData, "capitalRequirement", 200),
      responsibilities: str(formData, "responsibilities", 1500), exclusions: str(formData, "exclusions", 1500), startDate: date(formData, "startDate"), expiryDate: date(formData, "expiryDate"),
      feeStructure: str(formData, "feeStructure", 500), successFee: str(formData, "successFee", 500), reporting: str(formData, "reporting", 300), owner: str(formData, "owner", 120) || user.email,
      status: "active", createdBy: user.email,
    }).returning();
    await audit(appDb(), { actor: user.email, action: "work_mandate_created", entity: "work_mandates", entityId: m.id, after: { engagementId: id, name: m.name } });
  });
  redirect(back(id, "Mandate added."));
}

export async function workMandateStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const mid = zId.parse(formData.get("mandateRowId"));
  const status = z.enum(keys(WORK_MANDATE_STATUSES)).parse(formData.get("status"));
  await withOsUser(async user => {
    await scopedEngagement(user.scope, id);
    await appDb().update(workMandates).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(workMandates.id, mid), eq(workMandates.engagementId, id)));
    await audit(appDb(), { actor: user.email, action: "work_mandate_status", entity: "work_mandates", entityId: mid, after: { status } });
  });
  redirect(back(id, "Mandate updated."));
}

export async function addWorkstreamAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const wm = zId.safeParse(formData.get("workMandateId")).data ?? null;
    const [w] = await appDb().insert(workstreams).values({
      mandateId: e.mandateId, engagementId: id, workMandateId: wm, name: z.string().trim().min(2).max(160).parse(formData.get("name")),
      kind: z.enum(keys(WORKSTREAM_KINDS)).catch("other").parse(formData.get("kind")), lead: str(formData, "lead", 120) || null, description: str(formData, "description", 1500), due: date(formData, "due"),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "workstream_created", entity: "workstreams", entityId: w.id, after: { engagementId: id, name: w.name } });
  });
  redirect(back(id, "Workstream added."));
}

export async function workstreamStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const wid = zId.parse(formData.get("workstreamId"));
  const status = z.enum(keys(WORKSTREAM_STATUSES)).parse(formData.get("status"));
  await withOsUser(async user => {
    await scopedEngagement(user.scope, id);
    await appDb().update(workstreams).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(workstreams.id, wid), eq(workstreams.engagementId, id)));
    await audit(appDb(), { actor: user.email, action: "workstream_status", entity: "workstreams", entityId: wid, after: { status } });
  });
  redirect(back(id, "Workstream updated."));
}
