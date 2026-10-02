"use server";

// Connected commercial workflow (docs/plans/phase-15-command-scans.md part B): profiles, objectives, objective scans,
// account coverage, commercial qualification, attribution, effort, relationship ownership and reviews, meeting notes,
// identity edits and new opportunities. Every action re-reads the record through the user's workspaces first.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { activities, deals, objectives, organizations, BASES, COVERAGE_ROLES, OBJECTIVE_KINDS, QUALIFICATION_FIELDS, type Basis, type FieldSources, type ObjectiveKind, type QualificationField } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { registrableDomain } from "@/lib/dedupe/normalize";
import { runJobsOfTypes } from "@/lib/jobs/tick";
import { attribute, decideQualification, decideReview, logEffort, raiseConflictReviews, setCoverage, setQualificationField, setRelationshipOwner, ATTRIBUTION_CHANNELS_KEYS } from "@/lib/flow/commercial";
import { extractMarked, extractWithClaude, proposeFromNote, saveMeetingNote } from "@/lib/flow/meetings";
import { saveObjective, scanConfigFor, SECTION_FOR } from "@/lib/flow/objectives";
import { PROFILE_ROLES, saveProfile } from "@/lib/flow/profiles";
import { country } from "@/lib/scan/countries";
import { ScanBlocked, startScan } from "@/lib/scan/engine";
import { DEAL_STAGES, ENGAGEMENT_PATHS, ENGAGEMENTS } from "@/lib/vocab";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 2000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const list = (f: FormData, k: string) => str(f, k).split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
const num = (f: FormData, k: string) => { const v = str(f, k, 40).replace(/[, ]/g, ""); return v && Number.isFinite(Number(v)) ? Number(v) : null; };
const err = (e: unknown) => (e instanceof Error ? e.message : "Failed");
type U = { scope: { mandateIds: string[] }; email: string };

async function scopedOrg(user: U, orgId: string) {
  const [o] = await appDb().select().from(organizations).where(eq(organizations.id, orgId));
  if (!o || !user.scope.mandateIds.includes(o.mandateId)) throw new Error("Organization not found");
  return o;
}
async function scopedDeal(user: U, dealId: string) {
  const [d] = await appDb().select().from(deals).where(eq(deals.id, dealId));
  if (!d || !user.scope.mandateIds.includes(d.mandateId)) throw new Error("Opportunity not found");
  return d;
}

// ---------- organizations ----------
/** A person's identity edits (website, country, location, description) are recorded as manual and never overwritten
 *  by a scan or enrichment (those only fill empty fields). */
export async function updateOrgIdentityAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  let msg = "Identity saved.";
  try {
    await withOsUser(async user => {
      const o = await scopedOrg(user, orgId);
      const website = str(formData, "website", 300), iso = country(str(formData, "country", 80))?.iso3 ?? (str(formData, "country", 80) || null);
      const t = new Date().toISOString();
      const fs: FieldSources = { ...o.fieldSources };
      const patch: Partial<typeof organizations.$inferInsert> = {};
      const setF = (k: "website" | "domain" | "country" | "location" | "description" | "industry", v: string | null) => { if (v && v !== o[k]) { (patch as Record<string, unknown>)[k] = v; fs[k] = { source: "manual", at: t, confidence: "high" }; } };
      setF("website", website ? (/^https?:\/\//.test(website) ? website : `https://${website}`) : null);
      setF("domain", registrableDomain(website));
      setF("country", iso); setF("location", str(formData, "location", 200) || null); setF("industry", str(formData, "industry", 200) || null); setF("description", str(formData, "description", 1500) || null);
      const roles = formData.getAll("roles").map(String).filter(r => r.length < 40);
      await appDb().update(organizations).set({ ...patch, roles, fieldSources: fs, updatedAt: t }).where(eq(organizations.id, o.id));
      await audit(appDb(), { actor: user.email, action: "org_identity", entity: "organizations", entityId: o.id, after: { ...patch, roles } });
    });
  } catch (e) { msg = err(e); }
  redirect(note(`/companies/${orgId}`, msg));
}

export async function setRelationshipOwnerAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  await withOsUser(async user => { const o = await scopedOrg(user, orgId); await setRelationshipOwner(appDb(), o.mandateId, o.id, str(formData, "owner", 200) || null, user.email); });
  redirect(note(`/companies/${orgId}?tab=coverage`, "Relationship owner saved."));
}

export async function setTestRecordAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  const on = formData.get("test") === "on";
  await withOsUser(async user => {
    const o = await scopedOrg(user, orgId);
    await appDb().update(organizations).set({ testRecord: on, updatedAt: new Date().toISOString() }).where(eq(organizations.id, o.id));
    await audit(appDb(), { actor: user.email, action: "org_test_record", entity: "organizations", entityId: o.id, after: { testRecord: on } });
  });
  redirect(note(`/companies/${orgId}`, on ? "Marked as a test record: kept, but out of metrics and work queues." : "No longer a test record."));
}

// ---------- profiles ----------
export async function saveProfileAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  const role = z.enum(Object.keys(PROFILE_ROLES) as [string, ...string[]]).parse(formData.get("role"));
  const basis = (k: string) => z.enum(BASES).catch("stated").parse(formData.get(k)) as Basis;
  let msg = "Profile saved.";
  try {
    await withOsUser(async user => {
      const o = await scopedOrg(user, orgId);
      const values: Record<string, { value: string; basis: Basis; source?: string }> = {};
      for (const f of PROFILE_ROLES[role].fields) values[f.key] = { value: str(formData, `v_${f.key}`, 1500), basis: basis(`b_${f.key}`), source: str(formData, `s_${f.key}`, 300) || undefined };
      const coverage = list(formData, "coverage").map(c => country(c)?.iso3 ?? c.toUpperCase()).slice(0, 60);
      await saveProfile(appDb(), o.mandateId, o.id, role, { values, coverage, coverageBasis: basis("coverageBasis") }, user.email);
    });
  } catch (e) { msg = err(e); }
  redirect(note(`/companies/${orgId}?tab=profile`, msg));
}

// ---------- objectives ----------
export async function saveObjectiveAction(formData: FormData) {
  const id = str(formData, "id", 60) || undefined;
  const orgId = str(formData, "orgId", 60) || null;
  const kind = z.enum(Object.keys(OBJECTIVE_KINDS) as [ObjectiveKind, ...ObjectiveKind[]]).parse(formData.get("kind"));
  let target = "/objectives";
  try {
    await withOsUser(async user => {
      const ws = orgId ? (await scopedOrg(user, orgId)).mandateId : user.scope.mandateIds[0];
      if (!ws) throw new Error("No workspace");
      const o = await saveObjective(appDb(), ws, {
        orgId, kind, title: z.string().trim().min(3).max(200).parse(formData.get("title")), owner: str(formData, "owner", 200) || user.email,
        beneficiary: str(formData, "beneficiary", 200), desiredOutcome: str(formData, "desiredOutcome"), targetAudience: str(formData, "targetAudience", 60) || null, offerKey: str(formData, "offerKey", 60) || null,
        geography: list(formData, "geography").map(c => country(c)?.iso3 ?? c), sector: str(formData, "sector", 60) || null, capabilities: list(formData, "capabilities"), commercial: list(formData, "commercial"),
        sizeMin: num(formData, "sizeMin"), sizeMax: num(formData, "sizeMax"), sizeUnit: str(formData, "sizeUnit", 20) || null, stages: list(formData, "stages"), timing: str(formData, "timing", 300),
        exclusions: list(formData, "exclusions"), requiredEvidence: str(formData, "requiredEvidence", 1000), deliverable: str(formData, "deliverable", 500), successMeasure: str(formData, "successMeasure", 500),
        status: "active", source: str(formData, "source", 300), reviewStatus: "reviewed",
        dealId: str(formData, "dealId", 60) || null, projectId: str(formData, "projectId", 60) || null, commercialMandateId: null,
      }, user.email, id);
      target = note(`/objectives/${o.id}`, "Objective saved. Review the scan scope, then run it.");
    });
  } catch (e) { target = note(orgId ? `/companies/${orgId}?tab=profile` : "/objectives", err(e)); }
  redirect(target);
}

export async function scanObjectiveAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let target = `/objectives/${id}`;
  try {
    await withOsUser(async user => {
      const db = appDb();
      const [o] = await db.select().from(objectives).where(eq(objectives.id, id));
      if (!o || !user.scope.mandateIds.includes(o.mandateId)) throw new Error("Objective not found");
      const plan = scanConfigFor(o);
      if ("blocked" in plan) throw new Error(plan.blocked);
      const { run, reused } = await startScan(db, { mandateId: o.mandateId, requestedBy: user.email, section: SECTION_FOR[o.kind as ObjectiveKind], presetName: plan.label, config: plan.config, fallbackAccepted: formData.get("fallback") === "on" }, { apollo: apolloConfig(), ai: aiConfig() });
      if (!reused) await runJobsOfTypes(db, ["scan.step"], { budgetMs: 4_000 });
      target = note(`/scans/${run.id}`, reused ? "A scan for this objective is already running or ran today; showing it." : "Scan started.");
    });
  } catch (e) { target = note(`/objectives/${id}`, e instanceof ScanBlocked ? e.message : err(e)); }
  redirect(target);
}

// ---------- coverage ----------
export async function setCoverageAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  const role = z.enum(Object.keys(COVERAGE_ROLES) as [string, ...string[]]).parse(formData.get("role"));
  let msg = "Coverage saved.";
  try {
    await withOsUser(async user => {
      const o = await scopedOrg(user, orgId);
      await setCoverage(appDb(), o.mandateId, o.id, role, { contactId: str(formData, "contactId", 60) || null, relationshipOwner: str(formData, "owner", 200) || null, nextAction: str(formData, "nextAction", 500), evidence: str(formData, "evidence", 1000) }, user.email);
    });
  } catch (e) { msg = err(e); }
  redirect(note(`/companies/${orgId}?tab=coverage`, msg));
}

export async function raiseReviewsAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  let n = 0;
  await withOsUser(async user => { const o = await scopedOrg(user, orgId); n = await raiseConflictReviews(appDb(), o.mandateId, o.id, user.email); });
  redirect(note(`/companies/${orgId}?tab=coverage`, n ? `${n} item${n === 1 ? "" : "s"} raised for review.` : "No conflicts detected in the records (this is not a legal conflicts check)."));
}

export async function decideReviewAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId")), id = zId.parse(formData.get("id"));
  const status = z.enum(["cleared", "blocked"]).parse(formData.get("status"));
  let msg = "Recorded.";
  try { await withOsUser(async user => { const o = await scopedOrg(user, orgId); await decideReview(appDb(), o.mandateId, id, status, str(formData, "reason", 500), user.email); }); } catch (e) { msg = err(e); }
  redirect(note(`/companies/${orgId}?tab=coverage`, msg));
}

// ---------- opportunities ----------
export async function createOpportunityAction(formData: FormData) {
  let target = "/deals?new=1";
  try {
    await withOsUser(async user => {
      const db = appDb();
      const orgId = str(formData, "orgId", 60) || null;
      const ws = orgId ? (await scopedOrg(user, orgId)).mandateId : user.scope.mandateIds[0];
      if (!ws) throw new Error("No workspace");
      const path = z.enum(ENGAGEMENT_PATHS).parse(formData.get("path"));
      const engagement = z.enum(Object.keys(ENGAGEMENTS) as [keyof typeof ENGAGEMENTS, ...(keyof typeof ENGAGEMENTS)[]]).catch("diagnostic").parse(formData.get("engagement"));
      const nextAction = z.string().trim().min(3, "A next action is required").max(300).parse(formData.get("nextAction"));
      const nextActionDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A next-action date is required").parse(formData.get("nextActionDate"));
      const [d] = await db.insert(deals).values({
        mandateId: ws, orgId, name: z.string().trim().min(3).max(200).parse(formData.get("name")), path, engagement, stage: "lead",
        valueEstimate: num(formData, "value"), expectedClose: str(formData, "expectedClose", 10) || null, nextAction, nextActionDate, source: "other",
      }).returning();
      const channel = z.enum(ATTRIBUTION_CHANNELS_KEYS).catch("manual").parse(formData.get("channel"));
      await attribute(db, ws, { entityType: "deal", entityId: d.id, channel, campaign: str(formData, "campaign", 120) || null, introducerOrgId: str(formData, "introducerOrgId", 60) || null, note: str(formData, "sourceNote", 500) }, user.email);
      await db.insert(activities).values({ mandateId: ws, dealId: d.id, orgId, type: "stage_change", detail: `Created at ${DEAL_STAGES.lead}`, source: "manual", actor: user.email });
      await audit(db, { actor: user.email, action: "deal_created", entity: "deals", entityId: d.id, after: { name: d.name, channel } });
      target = note(`/deals/${d.id}`, "Opportunity created. Record the qualification evidence as you learn it.");
    });
  } catch (e) { target = note("/deals?new=1", e instanceof z.ZodError ? e.issues[0]?.message ?? "Check the form" : err(e)); }
  redirect(target);
}

export async function setOppQualificationAction(formData: FormData) {
  const dealId = zId.parse(formData.get("dealId"));
  const field = z.enum(Object.keys(QUALIFICATION_FIELDS) as [QualificationField, ...QualificationField[]]).parse(formData.get("field"));
  let msg = "Saved.";
  try { await withOsUser(async user => { const d = await scopedDeal(user, dealId); await setQualificationField(appDb(), d.mandateId, d.id, field, str(formData, "text", 1000), str(formData, "evidence", 1000), user.email); }); } catch (e) { msg = err(e); }
  redirect(note(`/deals/${dealId}#qualification`, msg));
}

export async function decideOppQualificationAction(formData: FormData) {
  const dealId = zId.parse(formData.get("dealId"));
  const decision = z.enum(["qualified", "not_qualified"]).parse(formData.get("decision"));
  let msg = decision === "qualified" ? "Recorded as a qualified commercial opportunity." : "Recorded as not qualified.";
  try { await withOsUser(async user => { const d = await scopedDeal(user, dealId); await decideQualification(appDb(), d.mandateId, d.id, decision, str(formData, "reason", 1000), user.email); }); } catch (e) { msg = err(e); }
  redirect(note(`/deals/${dealId}#qualification`, msg));
}

export async function attributeAction(formData: FormData) {
  const entityType = z.enum(["organization", "deal"]).parse(formData.get("entityType"));
  const entityId = zId.parse(formData.get("entityId"));
  const back = entityType === "deal" ? `/deals/${entityId}` : `/companies/${entityId}?tab=coverage`;
  await withOsUser(async user => {
    const ws = entityType === "deal" ? (await scopedDeal(user, entityId)).mandateId : (await scopedOrg(user, entityId)).mandateId;
    await attribute(appDb(), ws, { entityType, entityId, channel: z.enum(ATTRIBUTION_CHANNELS_KEYS).catch("manual").parse(formData.get("channel")), campaign: str(formData, "campaign", 120) || null, introducerOrgId: str(formData, "introducerOrgId", 60) || null, note: str(formData, "note", 500) }, user.email);
  });
  redirect(note(back, "Source recorded."));
}

export async function logEffortAction(formData: FormData) {
  const dealId = str(formData, "dealId", 60) || null;
  let msg = "Time logged.";
  try {
    await withOsUser(async user => {
      const ws = dealId ? (await scopedDeal(user, dealId)).mandateId : user.scope.mandateIds[0];
      await logEffort(appDb(), ws, { campaign: str(formData, "campaign", 120) || null, dealId, minutes: Math.round(num(formData, "minutes") ?? 0), on: str(formData, "on", 10) || new Date().toISOString().slice(0, 10), note: str(formData, "note", 300) }, user.email);
    });
  } catch (e) { msg = err(e); }
  redirect(note(dealId ? `/deals/${dealId}` : "/scans?tab=economics", msg));
}

// ---------- meeting notes ----------
export async function saveMeetingNoteAction(formData: FormData) {
  const dealId = str(formData, "dealId", 60) || null, orgId = str(formData, "orgId", 60) || null;
  const back = dealId ? `/deals/${dealId}` : orgId ? `/companies/${orgId}` : "/today";
  let msg = "";
  try {
    await withOsUser(async user => {
      const db = appDb();
      const ws = dealId ? (await scopedDeal(user, dealId)).mandateId : orgId ? (await scopedOrg(user, orgId)).mandateId : user.scope.mandateIds[0];
      const n = await saveMeetingNote(db, ws, { orgId, dealId, title: z.string().trim().min(2).max(200).parse(formData.get("title")), heldOn: str(formData, "heldOn", 10) || new Date().toISOString().slice(0, 10), participants: str(formData, "participants", 500), notes: z.string().trim().min(5).max(20_000).parse(formData.get("notes")) }, user.email);
      const ctx = { dealId, orgId: n.orgId, noteId: n.id };
      let changes = extractMarked(n.notes, ctx);
      const ai = aiConfig();
      if (ai && formData.get("useClaude") === "on") { try { changes = [...changes, ...(await extractWithClaude(db, ai, n.notes, ctx))]; } catch { /* the marked proposals still stand */ } }
      const k = await proposeFromNote(db, ws, n.id, changes, user.email);
      msg = k ? `Notes saved; ${k} proposed change${k === 1 ? "" : "s"} waiting for your confirmation below and on Command.` : "Notes saved. No follow-ups were marked (use lines like \"Action: …\", \"Next step: …\", \"Need: …\").";
    });
  } catch (e) { msg = err(e); }
  redirect(note(back, msg));
}
