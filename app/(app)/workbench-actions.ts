"use server";

// Analyst workbench actions. Every action re-loads the analysis through the user's workspace scope.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { analysisRequests, projects, storyPoints } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { RISK_CATEGORIES } from "@/lib/projects/vocab";
import { addEvidence, addFinding, addNode, approve, closeQuick, concludeNode, convertFinding, createRequest, markForReview, prepare, resolveMark, review, setIc } from "@/lib/workbench/engine";
import {
  CONCLUSIONS, CONFIDENCE, CONFIDENTIALITY, EVIDENCE_CLASSES, EVIDENCE_KINDS, FINDING_KINDS, IC_STATUSES, MODES, NODE_KINDS, NODE_STATUSES, OUTPUT_FORMATS, PRIORITIES, RELIABILITY, REVIEW_MARKS, SEVERITY, TEMPLATES,
} from "@/lib/workbench/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string) => zId.safeParse(f.get(k)).data ?? null;
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const back = (id: string, text: string, anchor = "") => `/workbench/${id}?notice=${encodeURIComponent(text)}${anchor}`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scoped(scope: Scope, id: string) {
  const [r] = await appDb().select().from(analysisRequests).where(and(eq(analysisRequests.id, id), mandateCondition(scope, analysisRequests.mandateId)));
  if (!r) throw new Error("Analysis not found");
  return r;
}
const rid = (f: FormData) => zId.parse(f.get("requestId"));

export async function createAnalysisAction(formData: FormData) {
  let id = "";
  await withOsUser(async user => {
    const projectId = opt(formData, "projectId");
    let mandateId = user.scope.mandateIds[0];
    if (projectId) {
      const [p] = await appDb().select({ m: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
      if (!p) throw new Error("Project not found");
      mandateId = p.m;
    }
    const r = await createRequest(appDb(), {
      mandateId, question: z.string().trim().min(8).max(500).parse(formData.get("question")), decision: str(formData, "decision", 500),
      mode: z.enum(keys(MODES)).catch("formal").parse(formData.get("mode")), template: z.enum(Object.keys(TEMPLATES) as [string, ...string[]]).catch("custom").parse(formData.get("template")),
      owner: str(formData, "owner", 200) || user.email, reviewer: str(formData, "reviewer", 200) || null, decisionMaker: str(formData, "decisionMaker", 200) || null, deadline: date(formData, "deadline"),
      outputFormat: z.enum(keys(OUTPUT_FORMATS)).catch("memo").parse(formData.get("outputFormat")), audience: str(formData, "audience", 200), scope: str(formData, "scope", 2000),
      priority: z.enum(keys(PRIORITIES)).catch("normal").parse(formData.get("priority")), confidentiality: z.enum(keys(CONFIDENTIALITY)).catch("internal").parse(formData.get("confidentiality")),
      projectId, dealId: opt(formData, "dealId"), engagementId: opt(formData, "engagementId"), workMandateId: opt(formData, "workMandateId"), workstreamId: opt(formData, "workstreamId"),
    }, user.email);
    id = r.id;
  });
  redirect(back(id, "Analysis opened. Refine the issue tree, then gather evidence against each question."));
}

export async function addNodeAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => { const r = await scoped(user.scope, id); await addNode(appDb(), r, { parentId: opt(formData, "parentId"), kind: z.enum(keys(NODE_KINDS)).parse(formData.get("kind")), text: z.string().trim().min(3).max(500).parse(formData.get("text")), evidenceRequired: str(formData, "evidenceRequired", 500), owner: str(formData, "owner", 200) || null, due: date(formData, "due") }, user.email); });
  redirect(back(id, "Added to the issue tree.", "#tree"));
}

export async function concludeNodeAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => {
    const r = await scoped(user.scope, id);
    await concludeNode(appDb(), r, zId.parse(formData.get("nodeId")), {
      status: z.enum(keys(NODE_STATUSES)).parse(formData.get("status")), conclusion: z.enum(keys(CONCLUSIONS)).nullable().catch(null).parse(formData.get("conclusion") || null),
      confidence: z.enum(keys(CONFIDENCE)).catch("unknown").parse(formData.get("confidence")), rationale: str(formData, "rationale", 1500),
    }, user.email);
  });
  redirect(back(id, "Question updated.", "#tree"));
}

export async function addEvidenceAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => {
    const r = await scoped(user.scope, id);
    await addEvidence(appDb(), r, {
      nodeId: opt(formData, "nodeId"), kind: z.enum(keys(EVIDENCE_KINDS)).catch("document").parse(formData.get("kind")), evidenceClass: z.enum(keys(EVIDENCE_CLASSES)).parse(formData.get("evidenceClass")),
      title: str(formData, "title", 300), source: str(formData, "source", 300), sourceUrl: z.string().url().max(1000).nullable().catch(null).parse(formData.get("sourceUrl") || null),
      documentId: opt(formData, "documentId"), claimId: opt(formData, "claimId"), mapView: str(formData, "mapView", 400) || null, sourceDate: date(formData, "sourceDate"),
      author: str(formData, "author", 200), excerpt: str(formData, "excerpt", 3000), page: str(formData, "page", 40) || null, geography: str(formData, "geography", 200),
      reliability: z.enum(keys(RELIABILITY)).catch("medium").parse(formData.get("reliability")), note: str(formData, "note", 1000),
    }, user.email);
  });
  redirect(back(id, "Evidence added.", "#evidence"));
}

export async function addFindingAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => {
    const r = await scoped(user.scope, id);
    await addFinding(appDb(), r, {
      nodeId: opt(formData, "nodeId"), kind: z.enum(keys(FINDING_KINDS)).parse(formData.get("kind")), finding: z.string().trim().min(3).max(1000).parse(formData.get("finding")),
      implication: str(formData, "implication", 1000), severity: z.enum(keys(SEVERITY)).catch("medium").parse(formData.get("severity")), resolution: str(formData, "resolution", 1000),
      assumptions: str(formData, "assumptions", 1000), confidence: z.enum(keys(CONFIDENCE)).catch("preliminary").parse(formData.get("confidence")),
      evidenceIds: formData.getAll("evidenceIds").map(String).filter(x => zId.safeParse(x).success),
    }, user.email);
  });
  redirect(back(id, "Finding recorded.", "#findings"));
}

export async function saveSynthesisAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => {
    const r = await scoped(user.scope, id);
    const patch = { summary: str(formData, "summary", 4000), recommendation: str(formData, "recommendation", 2000), updatedAt: new Date().toISOString(), ...(["open", "workplan", "evidence", "analysis"].includes(r.status) ? { status: "synthesis" as const } : {}) };
    await appDb().update(analysisRequests).set(patch).where(eq(analysisRequests.id, id));
    await audit(appDb(), { actor: user.email, action: "analysis_synthesis", entity: "analysis_requests", entityId: id, before: { summary: r.summary, recommendation: r.recommendation }, after: patch });
  });
  redirect(back(id, "Synthesis saved.", "#synthesis"));
}

export async function addStoryAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => {
    const r = await scoped(user.scope, id);
    const n = await appDb().select({ id: storyPoints.id }).from(storyPoints).where(eq(storyPoints.requestId, id));
    await appDb().insert(storyPoints).values({ mandateId: r.mandateId, requestId: id, observation: z.string().trim().min(3).max(1000).parse(formData.get("observation")), implication: str(formData, "implication", 1000), recommendation: str(formData, "recommendation", 1000), action: str(formData, "action", 1000), findingIds: formData.getAll("findingIds").map(String).filter(x => zId.safeParse(x).success), position: n.length });
    await audit(appDb(), { actor: user.email, action: "story_point_added", entity: "story_points", entityId: id });
  });
  redirect(back(id, "Storyline point added.", "#synthesis"));
}

export async function markAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => { const r = await scoped(user.scope, id); await markForReview(appDb(), r, { targetType: z.enum(["request", "node", "finding", "story", "evidence"]).parse(formData.get("targetType")), targetId: z.string().min(1).max(64).parse(formData.get("targetId")), mark: z.enum(keys(REVIEW_MARKS)).parse(formData.get("mark")), comment: str(formData, "comment", 1000) }, user.email); });
  redirect(back(id, "Review comment added; the analysis returns to the analyst.", "#review"));
}

export async function resolveMarkAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => { const r = await scoped(user.scope, id); await resolveMark(appDb(), r, zId.parse(formData.get("markId")), user.email); });
  redirect(back(id, "Comment resolved.", "#review"));
}

export async function signOffAction(formData: FormData) {
  const id = rid(formData);
  const step = z.enum(["prepare", "review", "approve", "close"]).parse(formData.get("step"));
  await withOsUser(async user => {
    await scoped(user.scope, id);
    if (step === "prepare") await prepare(appDb(), id, user.email);
    if (step === "review") await review(appDb(), id, user.email);
    if (step === "approve") await approve(appDb(), id, user.email, str(formData, "conclusion", 2000));
    if (step === "close") await closeQuick(appDb(), id, user.email, str(formData, "conclusion", 2000));
  });
  redirect(back(id, { prepare: "Prepared and sent for review.", review: "Reviewed.", approve: "Approved. The decision is recorded.", close: "Closed." }[step], "#review"));
}

export async function icAction(formData: FormData) {
  const id = rid(formData);
  await withOsUser(async user => { const r = await scoped(user.scope, id); await setIc(appDb(), r, z.enum(keys(IC_STATUSES)).parse(formData.get("to")), user.email, { rationale: str(formData, "rationale", 2000) || undefined, conditions: str(formData, "conditions", 2000) || undefined, followUps: str(formData, "followUps", 2000) || undefined }); });
  redirect(back(id, "Investment committee status updated.", "#ic"));
}

export async function convertFindingAction(formData: FormData) {
  const id = rid(formData);
  const to = z.enum(["task", "risk", "decision"]).parse(formData.get("to"));
  await withOsUser(async user => {
    const r = await scoped(user.scope, id);
    await convertFinding(appDb(), r, zId.parse(formData.get("findingId")), to, user.email, { riskCategory: z.enum(keys(RISK_CATEGORIES)).optional().catch(undefined).parse(formData.get("riskCategory") || undefined) });
  });
  redirect(back(id, `Finding turned into a ${to}.`, "#findings"));
}
