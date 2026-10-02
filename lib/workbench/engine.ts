// Analyst workbench engine. Rules that make the work auditable:
// - Formal analyses cannot conclude a hypothesis, or be signed off, without linked evidence.
// - Sign-off is prepared → reviewed → approved by named humans; the reviewer is not the preparer; AI is never a signer.
// - Approval of a project analysis writes a decision record; findings convert into tasks, risks or decisions.
// - The memo cites every evidence item by number, so SOURCE → EVIDENCE → FINDING → DECISION stays traceable.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { analysisRequests, claims, decisions, evidenceItems, findings, issueNodes, projects, reviewMarks, risks, storyPoints, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { RISK_CATEGORIES } from "@/lib/projects/vocab";
import { IC_NEXT, type IcStatus, type Mode, TEMPLATES } from "./vocab";

type Request = typeof analysisRequests.$inferSelect;
type Node = typeof issueNodes.$inferSelect;
type Finding = typeof findings.$inferSelect;
type Evidence = typeof evidenceItems.$inferSelect;
type Mark = typeof reviewMarks.$inferSelect;

/** A signer must be a named person (an email), never an AI or system actor. */
export function isHuman(actor: string | null | undefined) {
  if (!actor) return false;
  const a = actor.toLowerCase();
  return a.includes("@") && !/^(ai|claude|system|assistant|bot):/.test(a);
}

export type NewRequest = {
  mandateId: string; question: string; decision?: string; mode?: Mode; template?: string; owner?: string | null; reviewer?: string | null; decisionMaker?: string | null;
  deadline?: string | null; outputFormat?: Request["outputFormat"]; audience?: string; scope?: string; priority?: Request["priority"]; confidentiality?: Request["confidentiality"];
  projectId?: string | null; dealId?: string | null; engagementId?: string | null; workMandateId?: string | null; workstreamId?: string | null;
};

export async function createRequest(db: Db, input: NewRequest, actor: string) {
  const template = input.template && TEMPLATES[input.template] ? input.template : "custom";
  const [r] = await db.insert(analysisRequests).values({
    mandateId: input.mandateId, question: input.question.trim(), decision: input.decision ?? "", mode: input.mode ?? "formal", template, requester: actor, owner: input.owner ?? actor,
    reviewer: input.reviewer ?? null, decisionMaker: input.decisionMaker ?? null, deadline: input.deadline ?? null, outputFormat: input.outputFormat ?? "memo", audience: input.audience ?? "",
    scope: input.scope ?? "", priority: input.priority ?? "normal", confidentiality: input.confidentiality ?? "internal", projectId: input.projectId ?? null, dealId: input.dealId ?? null,
    engagementId: input.engagementId ?? null, workMandateId: input.workMandateId ?? null, workstreamId: input.workstreamId ?? null, status: template === "custom" ? "open" : "workplan",
  }).returning();
  let pos = 0;
  for (const b of TEMPLATES[template].branches) {
    const [parent] = await db.insert(issueNodes).values({ mandateId: r.mandateId, requestId: r.id, kind: "question", text: b.q, position: pos++ }).returning();
    for (const c of b.children) await db.insert(issueNodes).values({ mandateId: r.mandateId, requestId: r.id, parentId: parent.id, kind: "question", text: c, position: pos++ });
  }
  await audit(db, { actor, action: "analysis_created", entity: "analysis_requests", entityId: r.id, after: { question: r.question, mode: r.mode, template } });
  return r;
}

export async function loadRequest(db: Db, id: string) {
  const [r] = await db.select().from(analysisRequests).where(eq(analysisRequests.id, id));
  if (!r) return null;
  const [nodes, ev, fs, story, marks] = await Promise.all([
    db.select().from(issueNodes).where(eq(issueNodes.requestId, id)).orderBy(asc(issueNodes.position)),
    db.select().from(evidenceItems).where(eq(evidenceItems.requestId, id)).orderBy(asc(evidenceItems.createdAt)),
    db.select().from(findings).where(eq(findings.requestId, id)).orderBy(asc(findings.position), asc(findings.createdAt)),
    db.select().from(storyPoints).where(eq(storyPoints.requestId, id)).orderBy(asc(storyPoints.position)),
    db.select().from(reviewMarks).where(eq(reviewMarks.requestId, id)).orderBy(asc(reviewMarks.createdAt)),
  ]);
  return { r, nodes, evidence: ev, findings: fs, story, marks };
}

export async function addNode(db: Db, r: Request, input: { parentId?: string | null; kind: Node["kind"]; text: string; evidenceRequired?: string; owner?: string | null; due?: string | null }, actor: string) {
  if (input.parentId) {
    const [p] = await db.select({ id: issueNodes.id }).from(issueNodes).where(and(eq(issueNodes.id, input.parentId), eq(issueNodes.requestId, r.id)));
    if (!p) throw new Error("Unknown parent");
  }
  const existing = await db.select({ id: issueNodes.id }).from(issueNodes).where(eq(issueNodes.requestId, r.id));
  const [node] = await db.insert(issueNodes).values({ mandateId: r.mandateId, requestId: r.id, parentId: input.parentId ?? null, kind: input.kind, text: input.text.trim(), evidenceRequired: input.evidenceRequired ?? "", owner: input.owner ?? null, due: input.due ?? null, position: existing.length }).returning();
  if (r.status === "open") await db.update(analysisRequests).set({ status: "workplan", updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, r.id));
  await audit(db, { actor, action: "issue_node_added", entity: "issue_nodes", entityId: node.id, after: { kind: node.kind, text: node.text } });
  return node;
}

/** Concluding a node. In formal mode a conclusion needs at least one evidence item linked to that node. */
export async function concludeNode(db: Db, r: Request, nodeId: string, patch: { status: Node["status"]; conclusion: Node["conclusion"]; confidence: Node["confidence"]; rationale: string }, actor: string) {
  const [node] = await db.select().from(issueNodes).where(and(eq(issueNodes.id, nodeId), eq(issueNodes.requestId, r.id)));
  if (!node) throw new Error("Unknown node");
  if (r.mode === "formal" && (patch.conclusion || patch.status === "answered")) {
    const linked = await db.select({ id: evidenceItems.id }).from(evidenceItems).where(and(eq(evidenceItems.requestId, r.id), eq(evidenceItems.nodeId, nodeId))).limit(1);
    if (!linked.length) throw new Error("Link evidence to this question before concluding it (formal analysis)");
  }
  if (patch.confidence === "verified") {
    const primary = await db.select({ id: evidenceItems.id }).from(evidenceItems).where(and(eq(evidenceItems.requestId, r.id), eq(evidenceItems.nodeId, nodeId), inArray(evidenceItems.evidenceClass, ["primary", "client_provided"]))).limit(1);
    if (!primary.length) throw new Error("Verified needs primary or client-provided evidence; inferred or modelled evidence is not verification");
  }
  await db.update(issueNodes).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(issueNodes.id, nodeId));
  await audit(db, { actor, action: "issue_node_concluded", entity: "issue_nodes", entityId: nodeId, before: { status: node.status, conclusion: node.conclusion }, after: patch });
}

export type NewEvidence = Omit<typeof evidenceItems.$inferInsert, "id" | "mandateId" | "requestId" | "addedBy" | "createdAt">;
export async function addEvidence(db: Db, r: Request, input: NewEvidence, actor: string) {
  if (input.nodeId) { const [n] = await db.select({ id: issueNodes.id }).from(issueNodes).where(and(eq(issueNodes.id, input.nodeId), eq(issueNodes.requestId, r.id))); if (!n) throw new Error("Unknown question"); }
  if (input.claimId) { const [c] = await db.select({ m: claims.mandateId }).from(claims).where(eq(claims.id, input.claimId)); if (!c || c.m !== r.mandateId) throw new Error("Claim not in this workspace"); }
  if (!input.title.trim()) throw new Error("Evidence needs a title");
  if (!input.source?.trim() && !input.sourceUrl && !input.documentId && !input.claimId && !input.mapView) throw new Error("Evidence needs a source (name, link, document, claim or map view)");
  const [e] = await db.insert(evidenceItems).values({ ...input, mandateId: r.mandateId, requestId: r.id, projectId: input.projectId ?? r.projectId, addedBy: actor }).returning();
  if (["open", "workplan"].includes(r.status)) await db.update(analysisRequests).set({ status: "evidence", updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, r.id));
  await audit(db, { actor, action: "evidence_added", entity: "evidence_items", entityId: e.id, after: { title: e.title, class: e.evidenceClass } });
  return e;
}

export async function addFinding(db: Db, r: Request, input: { nodeId?: string | null; kind: Finding["kind"]; finding: string; implication?: string; severity?: Finding["severity"]; resolution?: string; assumptions?: string; confidence?: Finding["confidence"]; evidenceIds: string[] }, actor: string) {
  if (input.evidenceIds.length) {
    const ok = await db.select({ id: evidenceItems.id }).from(evidenceItems).where(and(eq(evidenceItems.requestId, r.id), inArray(evidenceItems.id, input.evidenceIds)));
    if (ok.length !== new Set(input.evidenceIds).size) throw new Error("Evidence must belong to this analysis");
  }
  const [f] = await db.insert(findings).values({ mandateId: r.mandateId, requestId: r.id, nodeId: input.nodeId ?? null, kind: input.kind, finding: input.finding.trim(), implication: input.implication ?? "", severity: input.severity ?? "medium", resolution: input.resolution ?? "", assumptions: input.assumptions ?? "", confidence: input.confidence ?? "preliminary", evidenceIds: input.evidenceIds, preparedBy: actor }).returning();
  if (["open", "workplan", "evidence"].includes(r.status)) await db.update(analysisRequests).set({ status: "analysis", updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, r.id));
  await audit(db, { actor, action: "finding_added", entity: "findings", entityId: f.id, after: { kind: f.kind, finding: f.finding } });
  return f;
}

/** What still stands between this analysis and sign-off. Empty list = ready. */
export function signOffGaps(d: { r: Request; nodes: Node[]; evidence: Evidence[]; findings: Finding[]; marks: Mark[] }) {
  const gaps: string[] = [];
  if (d.r.mode === "quick") return gaps;
  if (!d.findings.length) gaps.push("No findings recorded");
  const unsupported = d.findings.filter(f => f.kind !== "recommendation" && f.kind !== "inference" && f.evidenceIds.length === 0);
  if (unsupported.length) gaps.push(`${unsupported.length} finding(s) without evidence`);
  const hyps = d.nodes.filter(n => n.kind === "hypothesis" && !n.conclusion);
  if (hyps.length) gaps.push(`${hyps.length} hypothesis/hypotheses without a conclusion`);
  const openMarks = d.marks.filter(m => m.status === "open");
  if (openMarks.length) gaps.push(`${openMarks.length} open review comment(s)`);
  if (!d.r.summary.trim()) gaps.push("No executive summary");
  if (!d.r.recommendation.trim()) gaps.push("No recommendation");
  return gaps;
}

export async function prepare(db: Db, id: string, actor: string) {
  const d = await loadRequest(db, id);
  if (!d) throw new Error("Not found");
  if (!isHuman(actor)) throw new Error("A named person prepares an analysis");
  const gaps = signOffGaps(d);
  if (gaps.length) throw new Error(`Not ready for review: ${gaps.join("; ")}`);
  await db.update(analysisRequests).set({ status: "review", preparedBy: actor, preparedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, id));
  await audit(db, { actor, action: "analysis_prepared", entity: "analysis_requests", entityId: id });
}

export async function review(db: Db, id: string, actor: string) {
  const d = await loadRequest(db, id);
  if (!d) throw new Error("Not found");
  if (!isHuman(actor)) throw new Error("A named person reviews an analysis");
  if (d.r.status !== "review") throw new Error("Prepare the analysis first");
  if (d.r.preparedBy?.toLowerCase() === actor.toLowerCase()) throw new Error("The reviewer cannot be the preparer");
  if (d.marks.some(m => m.status === "open")) throw new Error("Resolve open review comments first");
  const now = new Date().toISOString();
  await db.update(analysisRequests).set({ reviewedBy: actor, reviewedAt: now, updatedAt: now }).where(eq(analysisRequests.id, id));
  await db.update(findings).set({ reviewedBy: actor, reviewedAt: now }).where(eq(findings.requestId, id));
  await audit(db, { actor, action: "analysis_reviewed", entity: "analysis_requests", entityId: id });
}

/** Approval: a named human, after review (formal). Project analyses write a decision record. */
export async function approve(db: Db, id: string, actor: string, conclusion: string) {
  const d = await loadRequest(db, id);
  if (!d) throw new Error("Not found");
  if (!isHuman(actor)) throw new Error("Only a named person can approve; AI never approves");
  if (!conclusion.trim()) throw new Error("State the conclusion");
  const r = d.r;
  if (r.mode === "formal") {
    if (!r.reviewedBy) throw new Error("A formal analysis must be reviewed before approval");
    const gaps = signOffGaps(d);
    if (gaps.length) throw new Error(`Not ready: ${gaps.join("; ")}`);
  }
  const now = new Date().toISOString();
  let decisionId: string | null = null;
  if (r.projectId) {
    const evidenceLine = memo(d).sources.map(({ n, e }) => `[${n}] ${e.title}${e.source ? ` — ${e.source}` : ""}${e.sourceDate ? ` (${e.sourceDate})` : ""}`).join("\n");
    const [dec] = await db.insert(decisions).values({ projectId: r.projectId, mandateId: r.mandateId, title: r.question, context: r.decision || r.scope, options: d.story.map(s => s.recommendation).filter(Boolean).join("\n"), decision: conclusion, rationale: r.recommendation, decidedBy: actor, decidedAt: now.slice(0, 10), status: "decided", evidence: `Analysis ${r.id}\n${evidenceLine}` }).returning();
    decisionId = dec.id;
  }
  await db.update(analysisRequests).set({ status: decisionId ? "decided" : "approved", conclusion, approvedBy: actor, approvedAt: now, decisionId, updatedAt: now }).where(eq(analysisRequests.id, id));
  await audit(db, { actor, action: "analysis_approved", entity: "analysis_requests", entityId: id, after: { conclusion, decisionId } });
  return { decisionId };
}

/** Quick work closes with a conclusion and no review. */
export async function closeQuick(db: Db, id: string, actor: string, conclusion: string) {
  const [r] = await db.select().from(analysisRequests).where(eq(analysisRequests.id, id));
  if (!r) throw new Error("Not found");
  if (r.mode !== "quick") throw new Error("Formal analyses are approved, not closed");
  await db.update(analysisRequests).set({ status: "closed", conclusion, approvedBy: actor, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, id));
  await audit(db, { actor, action: "analysis_closed", entity: "analysis_requests", entityId: id, after: { conclusion } });
}

export async function markForReview(db: Db, r: Request, input: { targetType: Mark["targetType"]; targetId: string; mark: Mark["mark"]; comment: string }, actor: string) {
  const [m] = await db.insert(reviewMarks).values({ mandateId: r.mandateId, requestId: r.id, ...input, author: actor }).returning();
  // A comment during review sends the analysis back to the analyst.
  if (r.status === "review" || r.reviewedBy) await db.update(analysisRequests).set({ status: "synthesis", reviewedBy: null, reviewedAt: null, version: r.version + 1, updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, r.id));
  await audit(db, { actor, action: "review_mark", entity: "review_marks", entityId: m.id, after: input });
  return m;
}

export async function resolveMark(db: Db, r: Request, markId: string, actor: string) {
  await db.update(reviewMarks).set({ status: "resolved", resolvedBy: actor, resolvedAt: new Date().toISOString() }).where(and(eq(reviewMarks.id, markId), eq(reviewMarks.requestId, r.id)));
  await audit(db, { actor, action: "review_mark_resolved", entity: "review_marks", entityId: markId });
}

export async function setIc(db: Db, r: Request, to: IcStatus, actor: string, input: { rationale?: string; conditions?: string; followUps?: string }) {
  if (!IC_NEXT[r.icStatus].includes(to)) throw new Error(`IC cannot move from ${r.icStatus} to ${to}`);
  if (["approved", "declined", "deferred"].includes(to)) {
    if (!isHuman(actor)) throw new Error("An IC outcome is recorded by a named person");
    if (!input.rationale?.trim()) throw new Error("Record the IC rationale");
  }
  if (to === "ic_ready" && r.mode === "formal" && !r.reviewedBy) throw new Error("IC-ready needs a reviewed analysis");
  await db.update(analysisRequests).set({ icStatus: to, icRationale: input.rationale ?? r.icRationale, icConditions: input.conditions ?? r.icConditions, icFollowUps: input.followUps ?? r.icFollowUps, updatedAt: new Date().toISOString() }).where(eq(analysisRequests.id, r.id));
  await audit(db, { actor, action: "ic_status", entity: "analysis_requests", entityId: r.id, before: { icStatus: r.icStatus }, after: { icStatus: to, ...input } });
}

/** Intelligence must not die inside reports: a finding becomes a task, a risk or a project decision. */
export async function convertFinding(db: Db, r: Request, findingId: string, to: "task" | "risk" | "decision", actor: string, opts: { riskCategory?: keyof typeof RISK_CATEGORIES } = {}, now = new Date()) {
  const [f] = await db.select().from(findings).where(and(eq(findings.id, findingId), eq(findings.requestId, r.id)));
  if (!f) throw new Error("Unknown finding");
  if (f.action) throw new Error("Already converted");
  let ref = "";
  if (to === "task") {
    const [t] = await db.insert(tasks).values({ mandateId: r.mandateId, projectId: r.projectId, dealId: r.dealId, type: "other", title: (f.resolution || f.finding).slice(0, 180), body: `From analysis: ${r.question}\nFinding: ${f.finding}${f.implication ? `\nImplication: ${f.implication}` : ""}`, dueAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() }).returning();
    ref = `task:${t.id}`;
  } else {
    if (!r.projectId) throw new Error("Link the analysis to a project first");
    const [p] = await db.select({ m: projects.mandateId }).from(projects).where(eq(projects.id, r.projectId));
    if (!p || p.m !== r.mandateId) throw new Error("Project not in this workspace");
    if (to === "risk") {
      if (!opts.riskCategory || !(opts.riskCategory in RISK_CATEGORIES)) throw new Error("Choose the risk category");
      const [k] = await db.insert(risks).values({ projectId: r.projectId, mandateId: r.mandateId, category: opts.riskCategory, description: f.finding, evidence: `Analysis ${r.id}; ${f.evidenceIds.length} evidence item(s)`, impact: f.severity === "high" ? "high" : f.severity === "low" || f.severity === "info" ? "low" : "medium", mitigation: f.resolution, owner: r.owner }).returning();
      ref = `risk:${k.id}`;
    } else {
      const [dc] = await db.insert(decisions).values({ projectId: r.projectId, mandateId: r.mandateId, title: f.finding.slice(0, 200), context: f.implication, decision: "", rationale: f.resolution, status: "open", evidence: `Analysis ${r.id}` }).returning();
      ref = `decision:${dc.id}`;
    }
  }
  await db.update(findings).set({ action: ref, updatedAt: now.toISOString() }).where(eq(findings.id, findingId));
  await audit(db, { actor, action: "finding_converted", entity: "findings", entityId: findingId, after: { to: ref } });
  return ref;
}

/** Memo sections with numbered citations: every evidence item cited by a finding gets a number in order of first use. */
export function memo(d: { r: Request; nodes: Node[]; evidence: Evidence[]; findings: Finding[]; story: (typeof storyPoints.$inferSelect)[] }) {
  const order: string[] = [];
  for (const f of d.findings) for (const e of f.evidenceIds) if (!order.includes(e)) order.push(e);
  for (const e of d.evidence) if (!order.includes(e.id)) order.push(e.id);
  const num = new Map(order.map((id, i) => [id, i + 1]));
  const cite = (ids: string[]) => ids.map(i => num.get(i)).filter(Boolean).sort((a, b) => a! - b!);
  const byId = new Map(d.evidence.map(e => [e.id, e]));
  return {
    findings: d.findings.map(f => ({ ...f, cites: cite(f.evidenceIds) })),
    sources: order.map(id => byId.get(id)).filter((e): e is Evidence => Boolean(e)).map(e => ({ n: num.get(e.id)!, e })),
    open: d.nodes.filter(n => n.status !== "answered" && n.status !== "not_applicable"),
    hypotheses: d.nodes.filter(n => n.kind === "hypothesis"),
  };
}
