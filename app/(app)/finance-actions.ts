"use server";

// Financial models (financial modeling and underwriting extension).
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { finModels, projects } from "@/db/schema";
import { FINANCEABILITY, FIN_CASE_TYPES } from "@/db/finance";
import { withOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { TEMPLATES } from "@/lib/finance/analysis";
import { applySiteQuantities, approveModel, createModel, newVersion, saveDefinition, setFinanceability, siteQuantities } from "@/lib/finance/engine";
import type { ModelDefinition } from "@/lib/finance/types";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const url = (projectId: string, modelId?: string) => `/projects/${projectId}?tab=financials${modelId ? `&model=${modelId}` : ""}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");

async function scopedModel(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [m] = await appDb().select().from(finModels).where(and(eq(finModels.id, id), mandateCondition(scope, finModels.mandateId)));
  if (!m) throw new Error("Model not found");
  return m;
}

export async function createModelAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const tpl = z.enum(Object.keys(TEMPLATES) as [keyof typeof TEMPLATES, ...(keyof typeof TEMPLATES)[]]).parse(formData.get("template"));
  let id = "";
  await withOsUser(async user => {
    const [p] = await appDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    id = (await createModel(appDb(), { projectId, name: str(formData, "name", 120) || `${TEMPLATES[tpl]} model`, template: tpl }, user.email)).id;
  });
  redirect(note(url(projectId, id), "Model created from the template. Every value starts as a PLACEHOLDER until you enter it with its source."));
}

const zDef = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), basis: z.enum(["nominal", "real"]) }).passthrough();
export async function saveModelAction(formData: FormData) {
  const id = zId.parse(formData.get("modelId"));
  const def = zDef.parse(JSON.parse(String(formData.get("definition") ?? "{}"))) as unknown as ModelDefinition;
  let projectId = ""; let msg = "";
  await withOsUser(async user => {
    projectId = (await scopedModel(user.scope, id)).projectId;
    try { const r = await saveDefinition(appDb(), id, def, str(formData, "reason", 300), user.email); msg = r.changed ? `Saved ${r.changed} change(s); each is in the change log.` : "No changes."; }
    catch (e) { msg = `Not saved: ${(e as Error).message}`; }
  });
  redirect(note(url(projectId, id), msg));
}

export async function newVersionAction(formData: FormData) {
  const id = zId.parse(formData.get("modelId"));
  let projectId = "", next = "";
  await withOsUser(async user => {
    projectId = (await scopedModel(user.scope, id)).projectId;
    const caseType = z.enum(FIN_CASE_TYPES).optional().catch(undefined).parse(formData.get("caseType") || undefined);
    next = (await newVersion(appDb(), id, str(formData, "name", 120) || "New version", caseType, user.email)).id;
  });
  redirect(note(url(projectId, next), "New version created from the selected case."));
}

export async function approveModelAction(formData: FormData) {
  const id = zId.parse(formData.get("modelId"));
  let projectId = "", msg = "Approved and locked.";
  await withOsUser(async user => {
    const m = await scopedModel(user.scope, id); projectId = m.projectId;
    if (!isOwner(user.scope, m.mandateId)) throw new Error("Only an owner approves a case");
    try { await approveModel(appDb(), id, str(formData, "reviewer", 120), user.email); } catch (e) { msg = `Not approved: ${(e as Error).message}`; }
  });
  redirect(note(url(projectId, id), msg));
}

export async function setFinanceabilityAction(formData: FormData) {
  const id = zId.parse(formData.get("modelId"));
  const status = z.enum(FINANCEABILITY).parse(formData.get("financeability"));
  let projectId = "", msg = "Financeability status recorded.";
  await withOsUser(async user => {
    projectId = (await scopedModel(user.scope, id)).projectId;
    try { await setFinanceability(appDb(), id, status, str(formData, "note", 500), user.email); } catch (e) { msg = `Not recorded: ${(e as Error).message}`; }
  });
  redirect(note(url(projectId, id), msg));
}

export async function importSiteQuantitiesAction(formData: FormData) {
  const id = zId.parse(formData.get("modelId"));
  let projectId = "", msg = "";
  await withOsUser(async user => {
    const m = await scopedModel(user.scope, id); projectId = m.projectId;
    const q = await siteQuantities(appDb(), m.projectId);
    if (!q.features) { msg = "No saved ATLAS features on this project yet (save roads, transmission routes or restoration areas from the workbench)."; return; }
    try { const r = await saveDefinition(appDb(), id, applySiteQuantities(m.definition, q), "Quantities from ATLAS workbench", user.email); msg = `Applied site quantities (${r.changed} change(s)): roads ${q.roadKm.toFixed(2)} km, transmission ${q.transmissionKm.toFixed(2)} km, restoration ${q.restorationHa.toFixed(1)} ha. Unit costs remain yours to enter.`; }
    catch (e) { msg = `Not applied: ${(e as Error).message}`; }
  });
  redirect(note(url(projectId, id), msg));
}
