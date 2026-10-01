"use server";

// Site briefs (Atlas Site Diagram Studio). Every action re-reads the brief through the user's workspaces.
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deals, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { addAnnotation, addScenario, BRIEF_TEMPLATES, createBrief, newBriefVersion, removeAnnotation, saveBriefMeta, scopedBrief, setBriefReview, type BriefTemplate } from "@/lib/briefs";
import { appDb, isOwner } from "@/lib/db/scoped";

const zId = z.string().uuid();
const str = (f: FormData, k: string, max = 2000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const err = (e: unknown) => (e instanceof Error ? e.message : "Failed");

export async function createBriefAction(formData: FormData) {
  const template = z.enum(Object.keys(BRIEF_TEMPLATES) as [BriefTemplate, ...BriefTemplate[]]).catch("diagnostic").parse(formData.get("template"));
  const projectId = str(formData, "projectId", 60) || null, dealId = str(formData, "dealId", 60) || null;
  let target = "/map/briefs";
  try {
    await withOsUser(async user => {
      const db = appDb();
      let ws: string | undefined;
      if (projectId) [{ mandateId: ws } = { mandateId: undefined }] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
      else if (dealId) [{ mandateId: ws } = { mandateId: undefined }] = await db.select({ mandateId: deals.mandateId }).from(deals).where(eq(deals.id, dealId));
      if (!ws || !user.scope.mandateIds.includes(ws)) throw new Error("Choose a project or opportunity in your workspace.");
      const b = await createBrief(db, ws, { projectId, dealId, template }, user.email);
      await audit(db, { actor: user.email, action: "site_brief_created", entity: "site_briefs", entityId: b.id, after: { template, projectId, dealId } });
      target = note(`/map/briefs/${b.id}`, "Brief created from the project's location and sourced context. Add annotations by clicking the map.");
    });
  } catch (e) { target = note(projectId ? `/projects/${projectId}` : dealId ? `/deals/${dealId}` : "/map/briefs", err(e)); }
  redirect(target);
}

export async function addAnnotationAction(formData: FormData) {
  const id = zId.parse(formData.get("briefId"));
  let msg = "Annotation added.";
  try {
    await withOsUser(async user => {
      const b = await scopedBrief(appDb(), user.scope.mandateIds, id);
      const points = z.array(z.object({ lng: z.number(), lat: z.number() })).min(1).max(50).parse(JSON.parse(str(formData, "points", 20_000) || "[]"));
      await addAnnotation(appDb(), b, {
        points, kind: str(formData, "kind", 60), label: str(formData, "label", 200), note: str(formData, "note", 1000),
        contentClass: z.enum(["measured", "modeled", "conceptual", "observed", "unknown"]).parse(formData.get("contentClass")),
        evidence: str(formData, "evidence", 500), source: str(formData, "source", 500), scenarioId: str(formData, "scenarioId", 20) || null,
      }, user.email);
    });
  } catch (e) { msg = e instanceof z.ZodError ? "Pick a location on the map first." : err(e); }
  redirect(note(`/map/briefs/${id}`, msg));
}

export async function removeAnnotationAction(formData: FormData) {
  const id = zId.parse(formData.get("briefId"));
  let msg = "Annotation removed.";
  try { await withOsUser(async user => { await removeAnnotation(appDb(), await scopedBrief(appDb(), user.scope.mandateIds, id), str(formData, "annotationId", 60)); }); } catch (e) { msg = err(e); }
  redirect(note(`/map/briefs/${id}`, msg));
}

export async function addScenarioAction(formData: FormData) {
  const id = zId.parse(formData.get("briefId"));
  let msg = "Scenario added: same boundary, scale and rings, so it compares with the others.";
  try { await withOsUser(async user => { await addScenario(appDb(), await scopedBrief(appDb(), user.scope.mandateIds, id), str(formData, "name", 120), str(formData, "assumptions", 1500)); }); } catch (e) { msg = err(e); }
  redirect(note(`/map/briefs/${id}`, msg));
}

export async function saveBriefMetaAction(formData: FormData) {
  const id = zId.parse(formData.get("briefId"));
  let msg = "Saved.";
  try {
    await withOsUser(async user => {
      const b = await scopedBrief(appDb(), user.scope.mandateIds, id);
      const rings = str(formData, "rings", 100).split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n));
      await saveBriefMeta(appDb(), b, { assumptions: str(formData, "assumptions", 4000), rings, decisionId: str(formData, "decisionId", 60) || null });
    });
  } catch (e) { msg = err(e); }
  redirect(note(`/map/briefs/${id}`, msg));
}

export async function setBriefReviewAction(formData: FormData) {
  const id = zId.parse(formData.get("briefId"));
  const to = z.enum(["draft", "in_review", "approved"]).parse(formData.get("to"));
  let msg = to === "approved" ? "Approved. Further changes need a new version." : to === "in_review" ? "Sent for review." : "Back to draft.";
  try {
    await withOsUser(async user => {
      const b = await scopedBrief(appDb(), user.scope.mandateIds, id);
      await setBriefReview(appDb(), b, to, user.email, isOwner(user.scope, b.mandateId));
      await audit(appDb(), { actor: user.email, action: `site_brief_${to}`, entity: "site_briefs", entityId: id });
    });
  } catch (e) { msg = err(e); }
  redirect(note(`/map/briefs/${id}`, msg));
}

export async function newBriefVersionAction(formData: FormData) {
  const id = zId.parse(formData.get("briefId"));
  let target = `/map/briefs/${id}`;
  await withOsUser(async user => {
    const b = await newBriefVersion(appDb(), await scopedBrief(appDb(), user.scope.mandateIds, id), user.email);
    target = note(`/map/briefs/${b.id}`, `Version ${b.version} created; version ${b.version - 1} is kept unchanged.`);
  });
  redirect(target);
}

