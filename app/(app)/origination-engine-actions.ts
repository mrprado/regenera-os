"use server";

// Phase 22 origination actions. Every action is a person's decision; generated documents and outreach drafts are saved
// for review and nothing is sent. Owner-only where commercial commitments start (proposals create draft engagements).
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { originationHypotheses, originationItems, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { buildDossier, generateHypotheses, ORIGINATION_STAGES, proposeDiagnostic, syncOriginationQueue } from "@/lib/origination/engine";
import { createProject } from "@/lib/projects/engine";

const back = (f: FormData, d: string) => z.string().startsWith("/").catch(d).parse(f.get("back"));
const note = (to: string, msg: string) => `${to}${to.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}`;

export async function buildDossierAction(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));
  const to = back(formData, `/projects/${projectId}`);
  let msg = "";
  await withOsUser(async user => {
    const [p] = await appDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) { msg = "Project not found"; return; }
    const d = await buildDossier(appDb(), projectId, user.email);
    msg = `Origination dossier v${d.version} saved in Documents.`;
  });
  redirect(note(to, msg));
}

export async function proposeDiagnosticAction(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));
  const to = back(formData, `/projects/${projectId}`);
  let msg = "";
  await withOsUser(async user => {
    const [p] = await appDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) { msg = "Project not found"; return; }
    const r = await proposeDiagnostic(appDb(), projectId, user.email);
    msg = `Draft engagement, proposal (${r.service}) and outreach text saved for your approval. Nothing was sent.`;
  }, { owner: true });
  redirect(note(to, msg));
}

export async function setOriginationStageAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const stage = z.enum(Object.keys(ORIGINATION_STAGES) as [string, ...string[]]).parse(formData.get("stage"));
  await withOsUser(async user => {
    const r = await appDb().update(originationItems).set({ stage, owner: user.email, updatedAt: new Date().toISOString() }).where(and(eq(originationItems.id, id), mandateCondition(user.scope, originationItems.mandateId))).returning({ id: originationItems.id });
    if (r.length) await audit(appDb(), { actor: user.email, action: "origination.stage", entity: "origination_items", entityId: id, after: { stage } });
  });
  redirect(back(formData, "/origination"));
}

export async function refreshOriginationAction(formData: FormData) {
  let msg = "";
  await withOsUser(async user => {
    const h = await generateHypotheses(appDb(), user.scope.mandateIds[0]);
    const q = await syncOriginationQueue(appDb(), user.scope.mandateIds[0]);
    msg = `Queue refreshed (${q.upserts} items) · ${h.created} new hypotheses.`;
  });
  redirect(note(back(formData, "/origination"), msg));
}

export async function decideHypothesisAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const decision = z.enum(["validated", "dismissed", "converted"]).parse(formData.get("decision"));
  let to = back(formData, "/origination?tab=hypotheses");
  await withOsUser(async user => {
    const [h] = await appDb().select().from(originationHypotheses).where(and(eq(originationHypotheses.id, id), mandateCondition(user.scope, originationHypotheses.mandateId)));
    if (!h) return;
    let projectId: string | null = null;
    if (decision === "converted") {
      // A person converts a validated thesis into a project record: country only, no invented site.
      const p = await createProject(appDb(), { mandateId: h.mandateId, name: h.title.slice(0, 190), description: `From market hypothesis: ${h.thesis}`, country: h.country, sector: h.sector, originationSource: "Market hypothesis (converted by a person)" }, user.email);
      projectId = p.id; to = `/projects/${p.id}`;
    }
    await appDb().update(originationHypotheses).set({ status: decision, decidedBy: user.email, convertedProjectId: projectId, updatedAt: new Date().toISOString() }).where(eq(originationHypotheses.id, id));
    await audit(appDb(), { actor: user.email, action: `hypothesis.${decision}`, entity: "origination_hypotheses", entityId: id, after: { projectId } });
  });
  redirect(to);
}
