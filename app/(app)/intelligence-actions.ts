"use server";

// Intelligence depth: signal assessments, per-dimension relevance, actions and learning; layered mandate evidence;
// theses; watches.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalProfiles, mandateEvidence, signalAssessments, theses, triggers, watches } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { assess, rateDimension } from "@/lib/intelligence/engine";
import { ACTION_STATUS, EVIDENCE_LAYERS, MANDATE_FIELDS, RATINGS, RELEVANCE_DIMENSIONS, SIGNAL_ACTIONS, SIGNAL_TYPES, THESIS_THEMES, WATCH_EVENTS, WATCH_KINDS } from "@/lib/intelligence/vocab";

const zId = z.string().uuid();
const zTid = z.string().min(1).max(64).regex(/^[\w-]+$/); // trigger ids (seeded rows are not all UUIDs)
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 1000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const date = (f: FormData, k: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(f.get(k)).data ?? null;
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedTrigger(scope: Scope, id: string) {
  const [t] = await appDb().select().from(triggers).where(and(eq(triggers.id, id), mandateCondition(scope, triggers.mandateId)));
  if (!t) throw new Error("Signal not found");
  return t;
}
async function scopedAssessment(scope: Scope, id: string) {
  const [a] = await appDb().select().from(signalAssessments).where(and(eq(signalAssessments.id, id), mandateCondition(scope, signalAssessments.mandateId)));
  if (!a) throw new Error("Assessment not found");
  return a;
}

export async function assessSignalAction(formData: FormData) {
  const triggerId = zTid.parse(formData.get("triggerId"));
  await withOsUser(async user => { await scopedTrigger(user.scope, triggerId); await assess(appDb(), triggerId, user.email); });
  redirect(note(`/triggers/${triggerId}`, "Relevance derived from Regenera's records. Rate the dimensions that need judgement."));
}

export async function rateDimensionAction(formData: FormData) {
  const triggerId = zTid.parse(formData.get("triggerId"));
  let msg = "Rating recorded.";
  await withOsUser(async user => {
    const a = await scopedAssessment(user.scope, zId.parse(formData.get("assessmentId")));
    try { await rateDimension(appDb(), a.id, z.enum(keys(RELEVANCE_DIMENSIONS)).parse(formData.get("dimension")), z.enum(keys(RATINGS)).parse(formData.get("rating")), str(formData, "reason", 600), str(formData, "evidence", 600), user.email); }
    catch (e) { msg = `Not recorded: ${(e as Error).message}`; }
  });
  redirect(note(`/triggers/${triggerId}`, msg));
}

export async function saveInterpretationAction(formData: FormData) {
  const triggerId = zTid.parse(formData.get("triggerId"));
  await withOsUser(async user => {
    const a = await scopedAssessment(user.scope, zId.parse(formData.get("assessmentId")));
    await appDb().update(signalAssessments).set({
      signalType: z.enum(keys(SIGNAL_TYPES)).catch(a.signalType).parse(formData.get("signalType")),
      interpretation: { whatChanged: str(formData, "whatChanged"), whyItMatters: str(formData, "whyItMatters"), affectedSectors: str(formData, "affectedSectors", 300), affectedGeographies: str(formData, "affectedGeographies", 300), implications: str(formData, "implications") },
      classification: { sector: str(formData, "sector", 80) || undefined, technology: str(formData, "technology", 80) || undefined, transactionType: str(formData, "transactionType", 80) || undefined, capitalType: str(formData, "capitalType", 80) || undefined, projectStage: str(formData, "projectStage", 80) || undefined, policyRelevance: str(formData, "policyRelevance", 200) || undefined, geography: str(formData, "geography", 80) || undefined },
      reviewedBy: user.email, updatedAt: new Date().toISOString(),
    }).where(eq(signalAssessments.id, a.id));
    await audit(appDb(), { actor: user.email, action: "signal.interpret", entity: "signal_assessment", entityId: a.id });
  });
  redirect(note(`/triggers/${triggerId}`, "Interpretation saved."));
}

export async function addSignalActionAction(formData: FormData) {
  const triggerId = zTid.parse(formData.get("triggerId"));
  await withOsUser(async user => {
    const a = await scopedAssessment(user.scope, zId.parse(formData.get("assessmentId")));
    const action = z.enum(keys(SIGNAL_ACTIONS)).parse(formData.get("action"));
    await appDb().update(signalAssessments).set({ actions: [...a.actions, { id: crypto.randomUUID(), action, status: action === "no_action" ? "done" : "proposed", owner: str(formData, "owner", 200) || user.email, note: str(formData, "note", 600), outcome: "", at: new Date().toISOString() }], updatedAt: new Date().toISOString() }).where(eq(signalAssessments.id, a.id));
  });
  redirect(note(`/triggers/${triggerId}`, "Action recorded."));
}

/** Closing the loop: actions carry outcomes; the learning note is what changed in Regenera's knowledge. */
export async function updateSignalActionAction(formData: FormData) {
  const triggerId = zTid.parse(formData.get("triggerId"));
  let msg = "Updated.";
  await withOsUser(async user => {
    const a = await scopedAssessment(user.scope, zId.parse(formData.get("assessmentId")));
    const id = str(formData, "actionId", 60), status = z.enum(keys(ACTION_STATUS)).parse(formData.get("status")), outcome = str(formData, "outcome", 1000);
    if (status === "done" && !outcome) { msg = "Record the outcome when marking an action done."; return; }
    await appDb().update(signalAssessments).set({ actions: a.actions.map(x => (x.id === id ? { ...x, status, outcome } : x)), learning: str(formData, "learning", 2000) || a.learning, updatedAt: new Date().toISOString() }).where(eq(signalAssessments.id, a.id));
    await audit(appDb(), { actor: user.email, action: "signal.action_outcome", entity: "signal_assessment", entityId: a.id, after: { status, outcome } });
  });
  redirect(note(`/triggers/${triggerId}`, msg));
}

export async function addEvidenceAction(formData: FormData) {
  const profileId = zId.parse(formData.get("profileId"));
  let msg = "Evidence recorded.";
  await withOsUser(async user => {
    const [p] = await appDb().select({ id: capitalProfiles.id, mandateId: capitalProfiles.mandateId }).from(capitalProfiles).where(and(eq(capitalProfiles.id, profileId), mandateCondition(user.scope, capitalProfiles.mandateId)));
    if (!p) throw new Error("Profile not found");
    const layer = z.enum(keys(EVIDENCE_LAYERS)).parse(formData.get("layer"));
    const source = str(formData, "source", 400);
    if (layer !== "inferred" && !source) { msg = "Stated, public and observed evidence needs a source."; return; }
    if (layer === "inferred" && !str(formData, "statement", 1000).toLowerCase().includes("because") && !source) { msg = "Inferred mandates need their reasoning (\"because …\") or the evidence they rest on."; return; }
    await appDb().insert(mandateEvidence).values({ mandateId: p.mandateId, profileId, layer, field: z.enum(keys(MANDATE_FIELDS)).catch("other").parse(formData.get("field")), statement: str(formData, "statement", 1000), source, sourceUrl: str(formData, "sourceUrl", 500) || null, date: date(formData, "date"), confidence: z.enum(["high", "moderate", "low"]).catch("moderate").parse(formData.get("confidence")), transactionRef: str(formData, "transactionRef", 300), createdBy: user.email });
    await audit(appDb(), { actor: user.email, action: "mandate.evidence", entity: "capital_profile", entityId: profileId, after: { layer } });
  });
  redirect(note(`/capital/partners/${profileId}`, msg));
}

export async function addThesisAction(formData: FormData) {
  let msg = "Thesis recorded.", back = str(formData, "back", 300) || "/intelligence?tab=theses";
  await withOsUser(async user => {
    const thesis = str(formData, "thesis", 2000);
    if (!thesis) { msg = "State the thesis."; return; }
    await appDb().insert(theses).values({ mandateId: user.scope.mandateIds[0], orgId: zId.safeParse(formData.get("orgId")).data ?? null, contactId: zId.safeParse(formData.get("contactId")).data ?? null, profileId: zId.safeParse(formData.get("profileId")).data ?? null, theme: z.enum(keys(THESIS_THEMES)).parse(formData.get("theme")), thesis, evidence: str(formData, "evidence", 1000), sourceUrl: str(formData, "sourceUrl", 500) || null, date: date(formData, "date"), sectors: str(formData, "sectors", 300).split(/[,;]+/).map(x => x.trim()).filter(Boolean), geography: str(formData, "geography", 200), implications: str(formData, "implications", 1000), contradictions: str(formData, "contradictions", 1000), interpretation: str(formData, "interpretation", 1000), createdBy: user.email });
  });
  if (!back.startsWith("/")) back = "/intelligence?tab=theses";
  redirect(note(back, msg));
}

export async function addWatchAction(formData: FormData) {
  let msg = "Watch added.";
  await withOsUser(async user => {
    const kind = z.enum(keys(WATCH_KINDS)).parse(formData.get("kind"));
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null, contactId = zId.safeParse(formData.get("contactId")).data ?? null;
    if (kind === "institution" && !orgId) { msg = "Pick the institution."; return; }
    if (kind === "person" && !contactId) { msg = "Pick the person."; return; }
    await appDb().insert(watches).values({ mandateId: user.scope.mandateIds[0], kind, orgId: kind === "institution" ? orgId : null, contactId: kind === "person" ? contactId : null, label: str(formData, "label", 200) || "Watch", reason: str(formData, "reason", 600), owner: user.email, events: formData.getAll("events").map(String).filter(x => x in WATCH_EVENTS), createdBy: user.email });
  });
  redirect(note("/intelligence", msg));
}

export async function reviewWatchAction(formData: FormData) {
  await withOsUser(async user => {
    const id = zId.parse(formData.get("watchId"));
    await appDb().update(watches).set({ lastReviewedAt: new Date().toISOString() }).where(and(eq(watches.id, id), mandateCondition(user.scope, watches.mandateId)));
  });
  redirect(note("/intelligence", "Marked reviewed; only newer signals will show."));
}
