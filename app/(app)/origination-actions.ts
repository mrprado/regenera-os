"use server";

// Mandates, pursuits and approvals (docs/plans/phase-14-mandates.md). Every action re-reads the record through the
// user's scope before writing; people decide (engine refuses non-human actors for decisions).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { approvals, jobs, mandateSignals } from "@/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { runJobsOfTypes } from "@/lib/jobs/tick";
import { withOsUser } from "@/lib/auth";
import { appDb, isInternal, mandateCondition } from "@/lib/db/scoped";
import { advanceCandidate, clientRespond, getWork, setWork, type MandateWork, closePursuit, createMandate, createPursuit, decideApproval, decideBid, movePursuit, recordCheck, requestApproval, reviewDelivery, saveBidCriteria, setCandidateFeedback, setProbability, updateMandate, updatePursuit, type MandateInput } from "@/lib/mandates/engine";
import { candidateDetail, mandateById, pursuitDetail } from "@/lib/mandates/queries";
import { APPROVAL_KINDS, BID_CRITERIA, BUILDER, CANDIDATE_STAGES, CLIENT_RESPONSES, DELIVERY_METRICS, MANDATE_TYPES, SUCCESS_STRUCTURES, type ApprovalKind, type CandidateStage, type ClientResponse, type DeliveryMetric, type FloorLine, type MandateType, type SuccessStructure } from "@/lib/mandates/vocab";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 2000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k, 40).replace(/[, $]/g, ""); return v && !Number.isNaN(Number(v)) ? Number(v) : null; };
const list = (f: FormData, k: string) => str(f, k).split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
const err = (e: unknown) => (e instanceof Error ? e.message : "Failed");

function mandateFields(f: FormData, type: MandateType) {
  const criteria: Record<string, unknown> = {};
  for (const c of BUILDER[type]) {
    if (c.key === "countries" || c.key === "states") continue;
    const k = `c_${c.key}`;
    if (c.kind === "number" || c.kind === "months") { const v = num(f, k); if (v != null) criteria[c.key] = v; }
    else if (c.kind === "list") { const v = list(f, k); if (v.length) criteria[c.key] = v; }
    else { const v = str(f, k, 500); if (v) criteria[c.key] = v; }
  }
  const floor: FloorLine[] = (Object.keys(DELIVERY_METRICS) as DeliveryMetric[]).map(m => ({ metric: m, target: num(f, `floor_${m}`) ?? 0, period: "month" as const })).filter(x => x.target > 0);
  const structure = z.enum(Object.keys(SUCCESS_STRUCTURES) as [SuccessStructure, ...SuccessStructure[]]).catch("none").parse(f.get("successStructure"));
  return {
    clientName: str(f, "clientName", 200), clientEntity: str(f, "clientEntity", 200), owner: str(f, "owner", 200) || null, lead: str(f, "lead", 200) || null, originator: str(f, "originator", 200) || null,
    sector: str(f, "sector", 100), subsector: str(f, "subsector", 100), assetClass: str(f, "assetClass", 100),
    technologies: list(f, "c_technologies").map(s => s.toLowerCase()),
    geography: { countries: list(f, "c_countries"), states: list(f, "c_states").map(s => s.toUpperCase()), isos: list(f, "c_isos").map(s => s.toUpperCase()) },
    criteria, exclusions: str(f, "exclusions"), qualificationNote: str(f, "qualificationNote"), legalRestrictions: str(f, "legalRestrictions"), complianceRequirements: str(f, "complianceRequirements"),
    confidentiality: str(f, "confidentiality", 40) || "confidential", outreachPermission: str(f, "outreachPermission", 40) || "approval_each", successDefinition: str(f, "successDefinition"),
    deliveryFloor: floor, reportingCadence: str(f, "reportingCadence", 20) || "weekly", engagementModel: str(f, "engagementModel", 30) || null, breadth: str(f, "breadth", 30) || "regional",
    termMonths: num(f, "termMonths"), retainer: num(f, "retainer") ?? 0, pilotFee: num(f, "pilotFee") ?? 0, implementationFee: num(f, "implementationFee") ?? 0,
    dataCost: num(f, "dataCost") ?? 0, partnerCost: num(f, "partnerCost") ?? 0, travelCost: num(f, "travelCost") ?? 0,
    successEconomics: { structure, rate: num(f, "successRate"), amount: num(f, "successAmount"), cap: num(f, "successCap"), floor: num(f, "successFloor"), attributionWindowMonths: num(f, "attributionWindow"), appliesTo: str(f, "successAppliesTo", 500), exclusions: str(f, "successExclusions", 500), paymentEvent: str(f, "paymentEvent", 300), counselReviewed: f.get("counselReviewed") === "on" },
    attributionRules: str(f, "attributionRules"), startDate: str(f, "startDate", 10) || null, reviewDate: str(f, "reviewDate", 10) || null, endDate: str(f, "endDate", 10) || null,
    status: str(f, "status", 20) || "draft", priority: str(f, "priority", 20) || "medium", nextAction: str(f, "nextAction", 500), nextActionDate: str(f, "nextActionDate", 10) || null,
    publicLabel: str(f, "publicLabel", 200),
  };
}

export async function createMandateAction(formData: FormData) {
  const type = z.enum(Object.keys(MANDATE_TYPES) as [MandateType, ...MandateType[]]).parse(formData.get("type"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  let id = "";
  await withOsUser(async user => {
    const ws = user.scope.mandateIds[0];
    if (!ws) throw new Error("No workspace");
    const m = await createMandate(appDb(), { mandateId: ws, name, type, ...mandateFields(formData, type) } as MandateInput, user.email);
    id = m.id;
  });
  redirect(note(`/mandates/${id}`, "Mandate created. Build the universe to screen candidates against it."));
}

export async function updateMandateAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const m = await mandateById(appDb(), user.scope, id);
    if (!m) throw new Error("Not found");
    const fields = mandateFields(formData, m.type as MandateType);
    await updateMandate(appDb(), id, { ...fields, name: str(formData, "name", 200) || m.name, publishApproved: m.publishApproved && fields.publicLabel === m.publicLabel }, user.email);
  });
  redirect(note(`/mandates/${id}?tab=profile`, "Mandate saved."));
}

export async function approvePublicationAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const m = await mandateById(appDb(), user.scope, id);
    if (!m || !m.publicLabel.trim()) throw new Error("Write the anonymized line first.");
    if (/[A-Z][a-z]+ (Inc|LLC|Ltd|PLC|GmbH|S\.A\.)/.test(m.publicLabel) || (m.clientName && m.publicLabel.toLowerCase().includes(m.clientName.toLowerCase()))) throw new Error("The public line appears to name the client or a company. Anonymize it.");
    await updateMandate(appDb(), id, { publishApproved: true }, user.email);
  }, { owner: true });
  redirect(note(`/mandates/${id}?tab=profile`, "Anonymized line approved for publication."));
}

const MANDATE_JOBS = ["mandates.queue.sync", "mandates.universe"];

/** Queues the universe build as background slices, runs the first few seconds now, and returns; the mandate page keeps
 *  driving the remaining slices while open and the scheduler finishes anything left. */
export async function buildUniverseAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const m = await mandateById(appDb(), user.scope, id);
    if (!m) throw new Error("Not found");
    const started = new Date().toISOString();
    await setWork(appDb(), id, { phase: "queued", label: "Queued", done: 0, total: 0, created: 0, updated: 0, startedAt: started });
    await enqueue(appDb(), "mandates.universe", { id, offset: 0, actor: user.email }, { dedupeKey: `universe:${id}:${started}:0` });
    await runJobsOfTypes(appDb(), MANDATE_JOBS, { budgetMs: 4_000 });
  });
  redirect(`/mandates/${id}?tab=universe`);
}

export async function syncQueuesAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const m = await mandateById(appDb(), user.scope, id);
    if (!m) throw new Error("Not found");
    const started = new Date().toISOString(), later = new Date(Date.now() + 1000);
    await setWork(appDb(), id, { phase: "queued", label: "Queued: MISO and SPP sync, then screening", done: 0, total: 0, created: 0, updated: 0, startedAt: started });
    for (const iso of ["miso", "spp"] as const) await enqueue(appDb(), "mandates.queue.sync", { iso, mandateId: id }, { dedupeKey: `queue-sync:${iso}:${started}` });
    await enqueue(appDb(), "mandates.universe", { id, offset: 0, actor: user.email }, { dedupeKey: `universe:${id}:${started}:0`, runAfter: later });
    await runJobsOfTypes(appDb(), MANDATE_JOBS, { budgetMs: 4_000 });
  }, { internal: true });
  redirect(`/mandates/${id}?tab=universe`);
}

/** Polled by the mandate page while background work is queued: runs one short burst of the mandate jobs and reports
 *  progress. Safe to call from several tabs: jobs are claimed atomically. */
export async function continueMandateWorkAction(id: string) {
  const mid = zId.parse(id);
  return withOsUser(async user => {
    const m = await mandateById(appDb(), user.scope, mid);
    if (!m) throw new Error("Not found");
    const r = await runJobsOfTypes(appDb(), MANDATE_JOBS, { budgetMs: 6_000 });
    const w = await getWork(appDb(), mid);
    if (w && w.phase !== "done" && !r.more && r.ran === 0) {
      const [pending] = await appDb().select({ n: sql<number>`count(*)` }).from(jobs).where(and(inArray(jobs.type, MANDATE_JOBS), inArray(jobs.status, ["queued", "running"])));
      if (!pending?.n) {
        const [dead] = await appDb().select({ e: jobs.lastError }).from(jobs).where(and(inArray(jobs.type, MANDATE_JOBS), eq(jobs.status, "dead"))).orderBy(desc(jobs.updatedAt)).limit(1);
        const failed: MandateWork = { ...w, phase: "failed", label: "Stopped", error: dead?.e ?? "No queued work remains" };
        await setWork(appDb(), mid, failed);
        return failed;
      }
    }
    return w;
  });
}

async function ownCandidate(scope: Parameters<typeof candidateDetail>[1], id: string) {
  const d = await candidateDetail(appDb(), scope, id);
  if (!d) throw new Error("Not found");
  return d;
}

export async function recordCheckAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const key = z.string().max(40).parse(formData.get("key"));
  const met = z.enum(["yes", "no", "unknown"]).parse(formData.get("met"));
  let msg = "Check recorded.";
  await withOsUser(async user => { await ownCandidate(user.scope, id); try { await recordCheck(appDb(), id, key, met, str(formData, "basis", 1000), user.email); } catch (e) { msg = err(e); } });
  redirect(note(`/mandates/candidates/${id}`, msg));
}

export async function advanceCandidateAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const to = z.enum(Object.keys(CANDIDATE_STAGES) as [CandidateStage, ...CandidateStage[]]).parse(formData.get("to"));
  let msg = "";
  await withOsUser(async user => {
    await ownCandidate(user.scope, id);
    const r = await advanceCandidate(appDb(), id, to, user.email, str(formData, "reason", 500) || "Advanced");
    msg = r.ok ? `Moved to ${CANDIDATE_STAGES[to]}.` : `Not yet: ${r.missing.join("; ")}.`;
  });
  redirect(note(`/mandates/candidates/${id}`, msg));
}

export async function clientRespondAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const response = z.enum(Object.keys(CLIENT_RESPONSES) as [ClientResponse, ...ClientResponse[]]).parse(formData.get("response"));
  const back = str(formData, "back", 300) || `/mandates/candidates/${id}`;
  let msg = `${CLIENT_RESPONSES[response].label} recorded.`;
  await withOsUser(async user => { await ownCandidate(user.scope, id); try { await clientRespond(appDb(), id, response, user.email, str(formData, "note", 1000)); } catch (e) { msg = err(e); } });
  redirect(note(back.startsWith("/") ? back : `/mandates/candidates/${id}`, msg));
}

export async function feedbackAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const fb = z.enum(["correct", "incorrect", "partial", "outdated"]).parse(formData.get("feedback"));
  await withOsUser(async user => { await ownCandidate(user.scope, id); await setCandidateFeedback(appDb(), id, fb, str(formData, "note", 500), user.email); });
  redirect(note(`/mandates/candidates/${id}`, "Feedback recorded: it informs future screening."));
}

export async function createPursuitAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let pid = "", msg = "";
  await withOsUser(async user => { await ownCandidate(user.scope, id); try { pid = await createPursuit(appDb(), id, user.email, str(formData, "owner", 200) || null); } catch (e) { msg = err(e); } });
  redirect(pid ? note(`/pursuits/${pid}`, "Pursuit opened.") : note(`/mandates/candidates/${id}`, msg));
}

async function ownPursuit(scope: Parameters<typeof pursuitDetail>[1], id: string) {
  const d = await pursuitDetail(appDb(), scope, id);
  if (!d) throw new Error("Not found");
  return d;
}

export async function movePursuitAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Stage updated.";
  await withOsUser(async user => { await ownPursuit(user.scope, id); try { await movePursuit(appDb(), id, str(formData, "to", 30), user.email, str(formData, "reason", 500), str(formData, "evidence", 1000)); } catch (e) { msg = err(e); } });
  redirect(note(`/pursuits/${id}`, msg));
}

export async function updatePursuitAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await ownPursuit(user.scope, id);
    await updatePursuit(appDb(), id, {
      owner: str(formData, "owner", 200) || null, nextAction: str(formData, "nextAction", 500), nextActionDate: str(formData, "nextActionDate", 10) || null, value: num(formData, "value"), valueBasis: str(formData, "valueBasis", 500),
      expectedDate: str(formData, "expectedDate", 10) || null, expectedOutcome: str(formData, "expectedOutcome", 300), relationshipStatus: str(formData, "relationshipStatus", 40) || "none",
      risks: list(formData, "risks"), competitors: list(formData, "competitors"), commercialStructure: str(formData, "commercialStructure", 500),
      decisionMakers: list(formData, "decisionMakers").map(s => { const [name, role] = s.split(/\s*[—–-]\s*/); return { name: name.trim(), role: (role ?? "").trim() }; }),
    }, user.email);
  });
  redirect(note(`/pursuits/${id}`, "Pursuit saved."));
}

export async function probabilityAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Probability updated.";
  await withOsUser(async user => { await ownPursuit(user.scope, id); try { await setProbability(appDb(), id, formData.get("clear") === "1" ? null : num(formData, "value"), str(formData, "why", 500), user.email); } catch (e) { msg = err(e); } });
  redirect(note(`/pursuits/${id}`, msg));
}

export async function bidCriteriaAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await ownPursuit(user.scope, id);
    const c = Object.fromEntries(Object.keys(BID_CRITERIA).map(k => [k, { rating: str(formData, `r_${k}`, 20) || "unknown", note: str(formData, `n_${k}`, 300) }]));
    await saveBidCriteria(appDb(), id, c, user.email);
  });
  redirect(note(`/pursuits/${id}?tab=bid`, "Bid criteria saved."));
}

export async function decideBidAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const decision = z.enum(["go", "conditional_go", "hold", "no_bid"]).parse(formData.get("decision"));
  let msg = "Decision recorded.";
  await withOsUser(async user => { await ownPursuit(user.scope, id); try { await decideBid(appDb(), id, decision, str(formData, "rationale", 2000), user.email); } catch (e) { msg = err(e); } });
  redirect(note(`/pursuits/${id}?tab=bid`, msg));
}

export async function closePursuitAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const outcome = z.enum(["won", "lost", "stalled", "withdrawn"]).parse(formData.get("outcome"));
  let msg = "Outcome recorded.";
  await withOsUser(async user => {
    await ownPursuit(user.scope, id);
    const wl = Object.fromEntries(["reason", "competitor", "pricing", "timing", "relationship", "technical", "financial", "risk", "clientFeedback", "lessons", "followUp", "value"].map(k => [k, str(formData, k, 1000)]).filter(([, v]) => v));
    try { await closePursuit(appDb(), id, outcome, wl, user.email); } catch (e) { msg = err(e); }
  });
  redirect(note(`/pursuits/${id}?tab=outcome`, msg));
}

export async function requestApprovalAction(formData: FormData) {
  const kind = z.enum(Object.keys(APPROVAL_KINDS) as [ApprovalKind, ...ApprovalKind[]]).parse(formData.get("kind"));
  const entityType = z.enum(["pursuits", "mandate_candidates", "commercial_mandates"]).parse(formData.get("entityType"));
  const entityId = zId.parse(formData.get("entityId"));
  const back = str(formData, "back", 300) || "/approvals";
  await withOsUser(async user => {
    const ws = entityType === "pursuits" ? (await ownPursuit(user.scope, entityId)).p.mandateId : entityType === "mandate_candidates" ? (await ownCandidate(user.scope, entityId)).c.mandateId : (await mandateById(appDb(), user.scope, entityId))?.mandateId;
    if (!ws) throw new Error("Not found");
    await requestApproval(appDb(), { mandateId: ws, kind, entityType, entityId, title: str(formData, "title", 300) || APPROVAL_KINDS[kind], detail: str(formData, "detail", 2000), approver: str(formData, "approver", 200) || null, commercialMandateId: str(formData, "cm", 60) || null, documentVersion: str(formData, "documentVersion", 60) || null }, user.email);
  });
  redirect(note(back.startsWith("/") ? back : "/approvals", "Approval requested."));
}

export async function decideApprovalAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const status = z.enum(["approved", "approved_conditions", "rejected", "withdrawn"]).parse(formData.get("status"));
  let msg = "Decision recorded.";
  await withOsUser(async user => {
    const [a] = await appDb().select({ id: approvals.id }).from(approvals).where(and(eq(approvals.id, id), mandateCondition(user.scope, approvals.mandateId)));
    if (!a) throw new Error("Not found");
    try { await decideApproval(appDb(), id, status, str(formData, "rationale", 2000), str(formData, "conditions", 1000), user.email); } catch (e) { msg = err(e); }
  });
  redirect(note("/approvals", msg));
}

export async function reviewDeliveryAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const period = z.string().regex(/^\d{4}-\d{2}$/).parse(formData.get("period"));
  await withOsUser(async user => {
    const m = await mandateById(appDb(), user.scope, id);
    if (!m) throw new Error("Not found");
    await reviewDelivery(appDb(), m, period, { quality: str(formData, "quality"), shortfall: str(formData, "shortfall"), remediation: str(formData, "remediation") }, user.email);
  });
  redirect(note(`/mandates/${id}?tab=delivery`, "Delivery review recorded."));
}

export async function signalStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const status = z.enum(["reviewed", "actioned", "dismissed"]).parse(formData.get("status"));
  const back = str(formData, "back", 300) || "/mandates";
  await withOsUser(async user => {
    await appDb().update(mandateSignals).set({ status }).where(and(eq(mandateSignals.id, id), mandateCondition(user.scope, mandateSignals.mandateId)));
  });
  redirect(note(back.startsWith("/") ? back : "/mandates", "Signal updated."));
}

export async function internalOnly() { return withOsUser(async user => isInternal(user.scope)); }

/** Loads the prepared live records (EMC pilot from EMC's website; RA-ESG from its documents). Idempotent. Internal. */
export async function loadPreparedMandatesAction() {
  let msg = "";
  await withOsUser(async user => {
    const { seedEmcPilot, seedRaEsg } = await import("@/lib/mandates/seed-live");
    const ws = user.scope.memberOf?.includes("mandate_regenera") ? "mandate_regenera" : user.scope.mandateIds[0];
    const a = await seedEmcPilot(appDb(), ws, user.email);
    const b = await seedRaEsg(appDb(), ws, user.email);
    msg = `EMC pilot ${a.created ? "created" : "already present"}; RA-ESG ${b.created ? `created with ${"projects" in b ? b.projects : 0} projects` : "already present"}.`;
  }, { internal: true });
  redirect(note("/mandates", msg));
}
