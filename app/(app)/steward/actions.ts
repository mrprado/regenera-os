"use server";
// Steward actions (phase 28A). Identity from the session; every record is checked against the user's workspaces.
// Knowledge permissions are only changed by a workspace owner, and never assumed: new records start restrictive.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { careActions, carePlans, communities, fundingAllocations, knowledgeRecords, stewardIndicators, stewardPlaces, stewardshipBudgets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { createKnowledgeRecord, setPermission, withdraw } from "@/lib/community/engine";
import { ACCESS_STATUS, ACTIVITIES, KNOWLEDGE_CATEGORIES } from "@/lib/community/vocab";
import { appDb, isOwner, mandateCondition, type Scope } from "@/lib/db/scoped";
import { addCareAction, addMeasurement, createCarePlan, createPlace, linkPlace, placeFromProject, setActionStatus, setAssessment, setPlaceGeometry } from "@/lib/steward/engine";
import {
  ASSESSMENT_DIMENSIONS, ASSESSMENT_STATUS, CARE_ACTION_STATUS, FUNDING_STAGES, GEOMETRY_ACCURACY, KNOWLEDGE_KINDS, KNOWLEDGE_TRADITIONS, MEASUREMENT_KIND, OUTCOME_DIMENSIONS, PLACE_LINK_RELATIONS,
} from "@/lib/steward/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 1000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const num = (f: FormData, k: string) => { const v = str(f, k, 40).replace(/[, ]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

async function scopedPlace(scope: Scope, id: string) {
  const [p] = await appDb().select().from(stewardPlaces).where(and(eq(stewardPlaces.id, id), mandateCondition(scope, stewardPlaces.mandateId)));
  if (!p) throw new Error("Place not found");
  return p;
}
async function scopedPlan(scope: Scope, id: string) {
  const [p] = await appDb().select().from(carePlans).where(and(eq(carePlans.id, id), mandateCondition(scope, carePlans.mandateId)));
  if (!p) throw new Error("Care plan not found");
  return p;
}

/** Runs a write; a validation or rule failure comes back as a plain notice on the same page, nothing half-saved. */
// Each action resolves its user with its own withOsUser call (route-guard test) and passes it in.
type U = { email: string; scope: Scope };
async function run(back: string, user: U, fn: (u: U) => Promise<string | void>, ok: string) {
  let msg = ok, to = back;
  try { const m = await fn(user); if (m) { if (m.startsWith("/")) to = m; else msg = m; } }
  catch (e) { msg = `Not saved: ${(e as Error).message}`; }
  redirect(note(to, msg));
}

export async function createPlaceAction(f: FormData) {
  await run("/steward?tab=places", await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const mandateId = scope.kind === "user" ? scope.mandateIds[0] : null;
    if (!mandateId) throw new Error("No workspace.");
    const raw = str(f, "geometry", 200_000);
    const projectId = zId.safeParse(f.get("projectId")).data;
    if (projectId && !raw) { const p = await placeFromProject(appDb(), scope, projectId, email); return `/steward/places/${p.id}`; }
    const place = await createPlace(appDb(), {
      mandateId, name: str(f, "name", 200) || (() => { throw new Error("A place needs a name."); })(), description: str(f, "description"), country: str(f, "country", 60) || null,
      geometry: raw ? JSON.parse(raw) : null, accuracy: z.enum(keys(GEOMETRY_ACCURACY)).catch("unknown").parse(f.get("accuracy")), geometrySource: str(f, "geometrySource", 300),
      sensitive: f.get("sensitive") === "on", responsible: str(f, "responsible", 200) || null, projectIds: projectId ? [projectId] : [],
    }, email);
    await audit(appDb(), { actor: email, action: "steward.place.create", entity: "steward_places", entityId: place.id, after: { name: place.name } });
    return `/steward/places/${place.id}`;
  }, "Place created.");
}

export async function setGeometryAction(f: FormData) {
  const placeId = zId.parse(f.get("placeId"));
  await run(`/steward/places/${placeId}`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    await scopedPlace(scope, placeId);
    await setPlaceGeometry(appDb(), placeId, { geometry: JSON.parse(str(f, "geometry", 200_000)), accuracy: z.enum(keys(GEOMETRY_ACCURACY)).parse(f.get("accuracy")), source: str(f, "source", 300), note: str(f, "note", 600) }, email);
  }, "Boundary saved as a new version; the previous one is kept.");
}

export async function linkPlaceAction(f: FormData) {
  const placeId = zId.parse(f.get("placeId"));
  await run(`/steward/places/${placeId}`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const p = await scopedPlace(scope, placeId);
    const entityType = z.enum(["project", "community"]).parse(f.get("entityType"));
    await linkPlace(appDb(), p.id, p.mandateId, entityType, zId.parse(f.get("entityId")), z.enum(keys(PLACE_LINK_RELATIONS)).parse(f.get("relation")), email, str(f, "note", 600));
  }, "Linked.");
}

export async function createCarePlanAction(f: FormData) {
  const placeId = zId.parse(f.get("placeId"));
  await run(`/steward/places/${placeId}`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const p = await scopedPlace(scope, placeId);
    const title = str(f, "title", 200); if (!title) throw new Error("A care plan needs a title.");
    const plan = await createCarePlan(appDb(), { mandateId: p.mandateId, placeId, projectId: zId.safeParse(f.get("projectId")).data ?? null, title, objective: str(f, "objective"), baseline: str(f, "baseline"),
      owner: str(f, "owner", 200) || null, startDate: date(f, "startDate"), reviewDate: date(f, "reviewDate"), monitoringProtocol: str(f, "monitoringProtocol"), permissionsNote: str(f, "permissionsNote"), createdBy: email });
    return `/steward/care/${plan.id}`;
  }, "Care plan created.");
}

export async function addCareActionAction(f: FormData) {
  const planId = zId.parse(f.get("planId"));
  await run(`/steward/care/${planId}`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const plan = await scopedPlan(scope, planId);
    const title = str(f, "title", 200); if (!title) throw new Error("An action needs a title.");
    const activity = z.enum(keys(ACTIVITIES)).safeParse(f.get("requiresActivity")).data ?? null;
    await addCareAction(appDb(), { mandateId: plan.mandateId, planId, title, description: str(f, "description"), owner: str(f, "owner", 200) || null, dueDate: date(f, "dueDate"), season: str(f, "season", 120),
      dependsOn: zId.safeParse(f.get("dependsOn")).data ?? null, monitoringMethod: str(f, "monitoringMethod", 600), budgetId: zId.safeParse(f.get("budgetId")).data ?? null,
      requiresKnowledgeId: activity ? zId.safeParse(f.get("requiresKnowledgeId")).data ?? null : null, requiresActivity: activity, createdBy: email });
  }, "Action added.");
}

export async function setActionStatusAction(f: FormData) {
  const actionId = zId.parse(f.get("actionId"));
  const [a] = await appDb().select({ planId: careActions.planId }).from(careActions).where(eq(careActions.id, actionId));
  const back = a ? `/steward/care/${a.planId}` : "/steward?tab=care";
  await run(back, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    if (!a) throw new Error("Action not found");
    await scopedPlan(scope, a.planId);
    await setActionStatus(appDb(), actionId, z.enum(keys(CARE_ACTION_STATUS)).parse(f.get("status")), email, str(f, "evidence"));
  }, "Status updated.");
}

export async function createBudgetAction(f: FormData) {
  const placeId = zId.parse(f.get("placeId"));
  await run(`/steward/places/${placeId}#budgets`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const p = await scopedPlace(scope, placeId);
    const label = str(f, "label", 200); const required = num(f, "required");
    if (!label || required == null) throw new Error("A budget needs a label and the amount required.");
    await appDb().insert(stewardshipBudgets).values({ mandateId: p.mandateId, placeId, planId: zId.safeParse(f.get("planId")).data ?? null, label, currency: (str(f, "currency", 3) || "USD").toUpperCase(),
      required, periodStart: date(f, "periodStart"), periodEnd: date(f, "periodEnd"), notes: str(f, "notes"), createdBy: email });
  }, "Budget recorded.");
}

export async function addAllocationAction(f: FormData) {
  const budgetId = zId.parse(f.get("budgetId"));
  const [b] = await appDb().select().from(stewardshipBudgets).where(eq(stewardshipBudgets.id, budgetId));
  await run(b ? `/steward/places/${b.placeId}#budgets` : "/steward", await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    if (!b) throw new Error("Budget not found");
    await scopedPlace(scope, b.placeId);
    const amount = num(f, "amount"); const source = str(f, "source", 200);
    if (amount == null || !source) throw new Error("Funding needs a source and an amount.");
    const stage = z.enum(keys(FUNDING_STAGES)).parse(f.get("stage"));
    if ((stage === "committed" || stage === "funded" || stage === "paid") && !str(f, "evidence")) throw new Error("Committed, funded or paid money needs evidence (an agreement, award letter or payment record).");
    await appDb().insert(fundingAllocations).values({ mandateId: b.mandateId, budgetId, source, stage, amount, currency: (str(f, "currency", 3) || b.currency).toUpperCase(), date: date(f, "date"), evidence: str(f, "evidence"), agreementRef: str(f, "agreementRef", 200), createdBy: email });
  }, "Funding recorded.");
}

export async function addIndicatorAction(f: FormData) {
  const placeId = zId.parse(f.get("placeId"));
  await run(`/steward/places/${placeId}#outcomes`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const p = await scopedPlace(scope, placeId);
    const name = str(f, "name", 200), unit = str(f, "unit", 60);
    if (!name || !unit) throw new Error("An indicator needs a name and a unit.");
    await appDb().insert(stewardIndicators).values({ mandateId: p.mandateId, placeId, dimension: z.enum(keys(OUTCOME_DIMENSIONS)).parse(f.get("dimension")), name, unit, method: str(f, "method", 600),
      geography: str(f, "geography", 200), target: num(f, "target"), targetNote: str(f, "targetNote", 300), frequency: str(f, "frequency", 120), owner: str(f, "owner", 200) || null, createdBy: email });
  }, "Indicator added.");
}

export async function addMeasurementAction(f: FormData) {
  const indicatorId = zId.parse(f.get("indicatorId"));
  const [i] = await appDb().select().from(stewardIndicators).where(eq(stewardIndicators.id, indicatorId));
  await run(i ? `/steward/places/${i.placeId}#outcomes` : "/steward", await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    if (!i) throw new Error("Indicator not found");
    await scopedPlace(scope, i.placeId);
    const value = num(f, "value"); const periodStart = date(f, "periodStart");
    if (value == null || !periodStart) throw new Error("A measurement needs a value and the date (or start of the period) it describes.");
    await addMeasurement(appDb(), { mandateId: i.mandateId, indicatorId, kind: z.enum(keys(MEASUREMENT_KIND)).parse(f.get("kind")), value, periodStart, periodEnd: date(f, "periodEnd"),
      uncertainty: str(f, "uncertainty", 200), evidence: str(f, "evidence"), sourceRef: str(f, "sourceRef", 400), observedBy: str(f, "observedBy", 200) || email, limitations: str(f, "limitations") });
  }, "Measurement recorded (unreviewed until a reviewer confirms it).");
}

export async function setAssessmentAction(f: FormData) {
  const placeId = zId.parse(f.get("placeId"));
  await run(`/steward/places/${placeId}#assessment`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const p = await scopedPlace(scope, placeId);
    await setAssessment(appDb(), { mandateId: p.mandateId, placeId, dimension: z.enum(keys(ASSESSMENT_DIMENSIONS)).parse(f.get("dimension")), status: z.enum(keys(ASSESSMENT_STATUS)).parse(f.get("status")),
      basis: str(f, "basis"), evidenceRef: str(f, "evidenceRef", 400), scope: str(f, "scope", 400) }, email);
  }, "Assessment recorded.");
}

export async function createKnowledgeAction(f: FormData) {
  await run("/steward?tab=knowledge", await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const placeId = zId.safeParse(f.get("placeId")).data ?? null;
    const communityId = zId.safeParse(f.get("communityId")).data ?? null;
    let mandateId = scope.kind === "user" ? scope.mandateIds[0] : null;
    if (placeId) mandateId = (await scopedPlace(scope, placeId)).mandateId;
    if (communityId) {
      const [c] = await appDb().select().from(communities).where(and(eq(communities.id, communityId), mandateCondition(scope, communities.mandateId)));
      if (!c) throw new Error("Community not found"); mandateId = c.mandateId;
    }
    if (!mandateId) throw new Error("No workspace.");
    const kind = z.enum(keys(KNOWLEDGE_KINDS)).parse(f.get("recordKind"));
    if (kind === "community_held" && !communityId) throw new Error("Community-held knowledge needs the community it belongs to.");
    const existenceOnly = f.get("existenceOnly") === "on";
    const title = str(f, "title", 200); if (!title) throw new Error("A knowledge record needs a title.");
    const r = await createKnowledgeRecord(appDb(), {
      mandateId, communityId, placeId, title, category: z.enum(keys(KNOWLEDGE_CATEGORIES)).parse(f.get("category")),
      descriptionPublic: existenceOnly ? "" : str(f, "descriptionPublic"), accessStatus: existenceOnly ? "existence_only" : z.enum(keys(ACCESS_STATUS)).catch("restricted").parse(f.get("accessStatus")),
      recordKind: kind, tradition: z.enum(keys(KNOWLEDGE_TRADITIONS)).catch("not_applicable").parse(f.get("tradition")), contributor: str(f, "contributor", 200),
      authorityEvidence: str(f, "authorityEvidence"), permittedPurpose: str(f, "permittedPurpose"), permittedUsers: str(f, "permittedUsers", 1000).split(/[,\s]+/).filter(e => e.includes("@")),
      reviewDate: date(f, "reviewDate"), compensation: str(f, "compensation", 600), benefitSharing: str(f, "benefitSharing", 600), originalLanguage: str(f, "originalLanguage", 60),
      translationProvenance: str(f, "translationProvenance", 600), sourceType: str(f, "sourceType", 120), spatialSensitivity: "hide",
    }, email);
    return `/steward/knowledge/${r.id}`;
  }, "Knowledge record created with restrictive defaults: AI use and publication prohibited until a permission says otherwise.");
}

export async function setKnowledgePermissionAction(f: FormData) {
  const recordId = zId.parse(f.get("recordId"));
  await run(`/steward/knowledge/${recordId}`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const [r] = await appDb().select().from(knowledgeRecords).where(and(eq(knowledgeRecords.id, recordId), mandateCondition(scope, knowledgeRecords.mandateId)));
    if (!r) throw new Error("Record not found");
    if (!isOwner(scope, r.mandateId)) throw new Error("Only a workspace owner records knowledge permissions, on the custodian's documented authority.");
    const evidence = str(f, "evidence"); if (!evidence) throw new Error("A permission needs evidence of the custodian's decision (meeting record, letter, protocol).");
    await setPermission(appDb(), { recordId, activity: z.enum(keys(ACTIVITIES)).parse(f.get("activity")), status: z.enum(["allowed", "allowed_with_conditions", "prohibited", "pending"]).parse(f.get("status")),
      authorityId: zId.safeParse(f.get("authorityId")).data ?? null, conditions: str(f, "conditions"), expiryDate: date(f, "expiryDate"), evidence }, email);
  }, "Permission recorded.");
}

export async function withdrawKnowledgeStewardAction(f: FormData) {
  const recordId = zId.parse(f.get("recordId"));
  await run(`/steward/knowledge/${recordId}`, await withOsUser(async u => ({ email: u.email, scope: u.scope })), async ({ email, scope }) => {
    const [r] = await appDb().select().from(knowledgeRecords).where(and(eq(knowledgeRecords.id, recordId), mandateCondition(scope, knowledgeRecords.mandateId)));
    if (!r) throw new Error("Record not found");
    if (!isOwner(scope, r.mandateId)) throw new Error("Only a workspace owner records a withdrawal.");
    const reason = str(f, "reason", 600); if (!reason) throw new Error("A withdrawal needs its reason.");
    const w = await withdraw(appDb(), recordId, email, reason);
    return `Withdrawal recorded. ${w.flagged} recorded use(s) flagged for remediation.`;
  }, "Withdrawn.");
}
