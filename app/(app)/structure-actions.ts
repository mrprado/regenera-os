"use server";

// Capital stack scenarios and funding pathways (master build instruction §10–11).
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalStructures, fundingPathways, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { createPathway, setPathwayEligibility, setPathwayStatus, updatePathwaySteps } from "@/lib/capital/pathways";
import { createStructure, duplicateStructure, reviewStructure, saveStructure } from "@/lib/capital/stack";
import { ASSUMPTION_STATUSES, ELIGIBILITY_STATES, LAYER_STATUSES, PATHWAY_SOURCES, PATHWAY_STATUSES, STACK_LAYERS, STRUCTURE_STATUSES } from "@/lib/capital/structure-vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const zCurrency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

async function scopedProject(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}
async function scopedStructure(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [s] = await appDb().select().from(capitalStructures).where(and(eq(capitalStructures.id, id), mandateCondition(scope, capitalStructures.mandateId)));
  if (!s) throw new Error("Structure not found");
  return s;
}
async function scopedPathway(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [s] = await appDb().select().from(fundingPathways).where(and(eq(fundingPathways.id, id), mandateCondition(scope, fundingPathways.mandateId)));
  if (!s) throw new Error("Pathway not found");
  return s;
}
const stackUrl = (projectId: string, structureId?: string) => `/projects/${projectId}?tab=stack${structureId ? `&structure=${structureId}` : ""}`;

export async function createStructureAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const name = str(formData, "name", 120) || "Base structure";
  let sid = "";
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    sid = (await createStructure(appDb(), projectId, name, user.email)).id;
  });
  redirect(note(stackUrl(projectId, sid), "Scenario created from the project's capital requirements. Every layer starts as an assumption."));
}

export async function duplicateStructureAction(formData: FormData) {
  const id = zId.parse(formData.get("structureId"));
  const name = str(formData, "name", 120) || "Alternative scenario";
  let projectId = ""; let sid = "";
  await withOsUser(async user => {
    projectId = (await scopedStructure(user.scope, id)).projectId;
    sid = (await duplicateStructure(appDb(), id, name, user.email)).id;
  });
  redirect(note(stackUrl(projectId, sid), `Scenario "${name}" copied.`));
}

const zLayer = z.object({
  layer: z.enum(keys(STACK_LAYERS)), provider: z.string().trim().max(200), providerOrgId: z.string().uuid().nullable().optional(), requirementId: z.string().uuid().nullable().optional(),
  currency: zCurrency, amount: z.number().finite().min(0).max(1e13).nullable(), pricing: z.string().trim().max(200), ratePct: z.number().finite().min(-50).max(100).nullable(),
  tenorYears: z.number().finite().min(0).max(100).nullable(), amortization: z.string().trim().max(200), security: z.string().trim().max(300),
  status: z.enum(keys(LAYER_STATUSES)), conditions: z.string().trim().max(1000), source: z.string().trim().max(500), assumptionStatus: z.enum(keys(ASSUMPTION_STATUSES)),
});
const zSave = z.object({
  name: z.string().trim().min(1).max(120), currency: zCurrency, totalCost: z.number().finite().min(0).max(1e13).nullable(), costSource: z.string().trim().max(300),
  status: z.enum(keys(STRUCTURE_STATUSES)), notes: z.string().trim().max(2000), layers: z.array(zLayer).max(40),
});

/** Saves the builder's state (JSON posted by the client component). */
export async function saveStructureAction(formData: FormData) {
  const id = zId.parse(formData.get("structureId"));
  const data = zSave.parse(JSON.parse(String(formData.get("payload") ?? "{}")));
  let projectId = ""; let msg = "";
  await withOsUser(async user => {
    projectId = (await scopedStructure(user.scope, id)).projectId;
    const { layers, ...header } = data;
    const s = await saveStructure(appDb(), id, header, layers, user.email);
    msg = `Saved. Funded ${Math.round(s.funded).toLocaleString("en-US")} ${s.currency}${s.gap != null ? `, gap ${Math.round(s.gap).toLocaleString("en-US")}` : ""}. Any earlier review is reset.`;
  });
  redirect(note(stackUrl(projectId, id), msg));
}

export async function reviewStructureAction(formData: FormData) {
  const id = zId.parse(formData.get("structureId"));
  const status = z.enum(["not_reviewed", "in_review", "reviewed"]).parse(formData.get("reviewStatus"));
  const reviewNote = str(formData, "reviewNote", 500);
  let projectId = "";
  await withOsUser(async user => {
    const s = await scopedStructure(user.scope, id);
    if (!isOwner(user.scope, s.mandateId)) throw new Error("Only an owner records a review");
    projectId = s.projectId;
    await reviewStructure(appDb(), id, status, reviewNote, user.email);
  });
  redirect(note(stackUrl(projectId, id), "Review recorded."));
}

export async function deleteStructureAction(formData: FormData) {
  const id = zId.parse(formData.get("structureId"));
  let projectId = "";
  await withOsUser(async user => {
    const s = await scopedStructure(user.scope, id);
    projectId = s.projectId;
    await appDb().delete(capitalStructures).where(eq(capitalStructures.id, id));
    await audit(appDb(), { actor: user.email, action: "capital_structure_delete", entity: "capital_structures", entityId: id, before: { name: s.name } });
  });
  redirect(note(stackUrl(projectId), "Scenario deleted."));
}

// ---------- Funding pathways ----------
const pathUrl = (projectId: string) => `/projects/${projectId}?tab=pathways`;
const back = (f: FormData, fallback: string) => { const b = str(f, "back", 300); return b.startsWith("/capital/funding-pathways") || b.startsWith("/projects/") ? b : fallback; };

export async function createPathwayAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const sourceType = z.enum(keys(PATHWAY_SOURCES)).parse(formData.get("sourceType"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const fo = str(formData, "fundingOpportunityId", 60);
    await createPathway(appDb(), {
      projectId, name, sourceType, provider: str(formData, "provider", 200), amount: num(formData, "amount"),
      currency: zCurrency.catch(p.currency ?? "USD").parse(str(formData, "currency") || p.currency || "USD"), deadline: date(formData, "deadline"),
      owner: str(formData, "owner", 120) || user.email, notes: str(formData, "notes", 1000),
      fundingOpportunityId: z.string().uuid().safeParse(fo).data ?? null, requirementId: z.string().uuid().safeParse(formData.get("requirementId")).data ?? null,
    }, user.email);
  });
  redirect(note(back(formData, pathUrl(projectId)), "Pathway added with generic process steps. Eligibility starts as not assessed."));
}

export async function setPathwayStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("pathwayId"));
  const status = z.enum(keys(PATHWAY_STATUSES)).parse(formData.get("status"));
  let projectId = ""; let msg = `Status: ${PATHWAY_STATUSES[status]}.`;
  await withOsUser(async user => {
    projectId = (await scopedPathway(user.scope, id)).projectId;
    try { await setPathwayStatus(appDb(), id, status, user.email); } catch (e) { msg = `Not changed: ${(e as Error).message}`; }
  });
  redirect(note(back(formData, pathUrl(projectId)), msg));
}

export async function setPathwayEligibilityAction(formData: FormData) {
  const id = zId.parse(formData.get("pathwayId"));
  const eligibility = z.enum(keys(ELIGIBILITY_STATES)).parse(formData.get("eligibility"));
  let projectId = ""; let msg = `Eligibility: ${ELIGIBILITY_STATES[eligibility]}.`;
  await withOsUser(async user => {
    projectId = (await scopedPathway(user.scope, id)).projectId;
    try { await setPathwayEligibility(appDb(), id, eligibility, str(formData, "notes", 1000), str(formData, "source", 300), user.email); } catch (e) { msg = `Not changed: ${(e as Error).message}`; }
  });
  redirect(note(back(formData, pathUrl(projectId)), msg));
}

export async function toggleStepAction(formData: FormData) {
  const id = zId.parse(formData.get("pathwayId"));
  const stepId = z.string().max(40).parse(formData.get("stepId"));
  let projectId = "";
  await withOsUser(async user => {
    projectId = (await scopedPathway(user.scope, id)).projectId;
    await updatePathwaySteps(appDb(), id, { toggle: stepId }, user.email);
  });
  redirect(back(formData, pathUrl(projectId)));
}

export async function addStepAction(formData: FormData) {
  const id = zId.parse(formData.get("pathwayId"));
  const label = z.string().trim().min(2).max(200).parse(formData.get("label"));
  let projectId = "";
  await withOsUser(async user => {
    projectId = (await scopedPathway(user.scope, id)).projectId;
    await updatePathwaySteps(appDb(), id, { add: { label, due: date(formData, "due") } }, user.email);
  });
  redirect(back(formData, pathUrl(projectId)));
}

export async function deletePathwayAction(formData: FormData) {
  const id = zId.parse(formData.get("pathwayId"));
  let projectId = "";
  await withOsUser(async user => {
    const p = await scopedPathway(user.scope, id);
    projectId = p.projectId;
    await appDb().delete(fundingPathways).where(eq(fundingPathways.id, id));
    await audit(appDb(), { actor: user.email, action: "funding_pathway_delete", entity: "funding_pathways", entityId: id, before: { name: p.name } });
  });
  redirect(note(back(formData, pathUrl(projectId)), "Pathway removed."));
}
