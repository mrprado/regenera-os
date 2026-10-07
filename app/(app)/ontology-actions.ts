"use server";

// Phase 19 actions: land control, stakeholders, equipment, queue links, permit dependencies, question layers,
// partner matches, identifiers, typed relationships and sanctions screening. Every action runs inside the guard
// (withOsUser) and checks that the record belongs to one of the user's workspaces.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  contacts, equipment, landControls, organizations, permitDependencies, permits, projectEquipment, projectQueueLinks, projects, queueProjects,
  sanctionsChecks, stakeholders,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition, type Scope } from "@/lib/db/scoped";
import { findCandidates, recordMatch } from "@/lib/diligence/matches";
import { enqueue } from "@/lib/jobs/queue";
import { QUESTIONS, runLive, type QuestionKey } from "@/lib/fabric/questions";
import { addOntologyEdge } from "@/lib/ontology/edges";
import { ENTITY_TYPES } from "@/lib/ontology/entities";
import { addAlias, type AliasScheme } from "@/lib/ontology/identity";
import { PREDICATE_KEYS } from "@/lib/ontology/relations";
import {
  ALIAS_SCHEMES, CONFIDENCE, EQUIPMENT_CATEGORIES, EQUIPMENT_STATUS, LAND_CONTROL_TYPES, LEVELS_3, MATCH_KINDS, QUEUE_RELATIONS, RIGHT_STATES,
  STAKEHOLDER_CATEGORIES, STAKEHOLDER_POSITIONS, TITLE_EVIDENCE,
} from "@/lib/ontology/taxonomies";
import { LIST_KEYS, screenEntity } from "@/lib/sanctions/engine";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 600) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string, d: keyof T & string) => z.enum(keys(o)).catch(d).parse(f.get(k));
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const tabUrl = (projectId: string, tab: string) => `/projects/${projectId}?tab=${tab}`;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240);

async function scopedProject(scope: Scope, id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

// ---------- land control ----------
export async function saveLandControlAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const rowId = zId.safeParse(formData.get("id")).data;
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const values = {
      parcelRef: str(formData, "parcelRef", 200), areaHa: num(formData, "areaHa"), controlType: pick(LAND_CONTROL_TYPES, formData, "controlType", "none"),
      counterparty: str(formData, "counterparty", 200), termMonths: num(formData, "termMonths"), startsOn: date(formData, "startsOn"), expiresOn: date(formData, "expiresOn"),
      extension: str(formData, "extension", 300), titleEvidence: pick(TITLE_EVIDENCE, formData, "titleEvidence", "none"), encumbrances: num(formData, "encumbrances"),
      rightsOfWay: pick(RIGHT_STATES, formData, "rightsOfWay", "unknown"), waterRights: pick(RIGHT_STATES, formData, "waterRights", "unknown"), mineralRights: pick(RIGHT_STATES, formData, "mineralRights", "unknown"),
      legalConfidence: pick(CONFIDENCE, formData, "legalConfidence", "low"), notes: str(formData, "notes", 2000), updatedAt: new Date().toISOString(),
    };
    if (rowId) await appDb().update(landControls).set(values).where(and(eq(landControls.id, rowId), eq(landControls.projectId, p.id)));
    else await appDb().insert(landControls).values({ ...values, mandateId: p.mandateId, projectId: p.id });
    await audit(appDb(), { actor: user.email, action: rowId ? "land_control_updated" : "land_control_added", entity: "land_controls", entityId: rowId ?? p.id, after: values });
  });
  redirect(note(tabUrl(projectId, "land"), "Land control saved."));
}

export async function deleteLandControlAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId")); const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    await appDb().delete(landControls).where(and(eq(landControls.id, id), eq(landControls.projectId, p.id)));
    await audit(appDb(), { actor: user.email, action: "land_control_removed", entity: "land_controls", entityId: id });
  }, { owner: true });
  redirect(note(tabUrl(projectId, "land"), "Parcel removed."));
}

// ---------- stakeholders ----------
export async function saveStakeholderAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const rowId = zId.safeParse(formData.get("id")).data;
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const values = {
      name, category: pick(STAKEHOLDER_CATEGORIES, formData, "category", "other"), relationship: str(formData, "relationship", 300),
      influence: pick(LEVELS_3, formData, "influence", "medium"), interest: pick(LEVELS_3, formData, "interest", "medium"), position: pick(STAKEHOLDER_POSITIONS, formData, "position", "unknown"),
      consentRequired: formData.get("consentRequired") === "on", consultationRequired: formData.get("consultationRequired") === "on",
      commitments: str(formData, "commitments", 1000), lastEngagementAt: date(formData, "lastEngagementAt"), nextAction: str(formData, "nextAction", 300), nextActionDue: date(formData, "nextActionDue"),
      notes: str(formData, "notes", 2000), updatedAt: new Date().toISOString(),
    };
    if (rowId) await appDb().update(stakeholders).set(values).where(and(eq(stakeholders.id, rowId), eq(stakeholders.projectId, p.id)));
    else await appDb().insert(stakeholders).values({ ...values, mandateId: p.mandateId, projectId: p.id });
    await audit(appDb(), { actor: user.email, action: rowId ? "stakeholder_updated" : "stakeholder_added", entity: "stakeholders", entityId: rowId ?? p.id, after: { name, position: values.position } });
  });
  redirect(note(tabUrl(projectId, "stakeholders"), "Stakeholder saved."));
}

// ---------- equipment ----------
export async function addEquipmentAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const existing = zId.safeParse(formData.get("equipmentId")).data;
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    let equipmentId = existing;
    if (existing) {
      const [e] = await appDb().select({ id: equipment.id }).from(equipment).where(and(eq(equipment.id, existing), mandateCondition(user.scope, equipment.mandateId)));
      if (!e) throw new Error("Equipment not found");
    } else {
      const [e] = await appDb().insert(equipment).values({
        mandateId: p.mandateId, category: pick(EQUIPMENT_CATEGORIES, formData, "category", "other"), manufacturer: z.string().trim().min(1).max(160).parse(formData.get("manufacturer")),
        model: z.string().trim().min(1).max(160).parse(formData.get("model")), rating: num(formData, "rating"), ratingUnit: str(formData, "ratingUnit", 20) || null,
        countryOfOrigin: str(formData, "countryOfOrigin", 80) || null, certifications: str(formData, "certifications", 400), leadTimeWeeks: num(formData, "leadTimeWeeks"),
        warrantyYears: num(formData, "warrantyYears"), bankable: formData.get("bankable") === "on", source: str(formData, "source", 300),
      }).returning({ id: equipment.id });
      equipmentId = e.id;
    }
    await appDb().insert(projectEquipment).values({ mandateId: p.mandateId, projectId: p.id, equipmentId: equipmentId!, quantity: num(formData, "quantity"), status: pick(EQUIPMENT_STATUS, formData, "status", "considered"), price: num(formData, "price"), currency: str(formData, "currency", 3).toUpperCase() || null });
    await audit(appDb(), { actor: user.email, action: "equipment_linked", entity: "project_equipment", entityId: p.id, after: { equipmentId } });
  });
  redirect(note(tabUrl(projectId, "equipment"), "Equipment added."));
}

export async function setEquipmentStatusAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId")); const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    await appDb().update(projectEquipment).set({ status: pick(EQUIPMENT_STATUS, formData, "status", "considered"), updatedAt: new Date().toISOString() }).where(and(eq(projectEquipment.id, id), eq(projectEquipment.projectId, p.id)));
  });
  redirect(tabUrl(projectId, "equipment"));
}

// ---------- interconnection queue ----------
export async function linkQueueAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const queueKey = z.string().trim().min(3).max(80).parse(formData.get("queueKey"));
  let msg = "Queue position linked.";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const [q] = await appDb().select({ key: queueProjects.key }).from(queueProjects).where(eq(queueProjects.key, queueKey));
    if (!q) { msg = `No queue position ${queueKey} in the synced public queues (MISO, SPP).`; return; }
    await appDb().insert(projectQueueLinks).values({ mandateId: p.mandateId, projectId: p.id, queueKey, relation: pick(QUEUE_RELATIONS, formData, "relation", "own_position"), note: str(formData, "note", 300), createdBy: user.email }).onConflictDoNothing();
  });
  redirect(note(tabUrl(projectId, "equipment"), msg));
}

// ---------- permit dependencies ----------
export async function addPermitDependencyAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const permitId = zId.parse(formData.get("permitId")); const dependsOnId = zId.parse(formData.get("dependsOnId"));
  let msg = "Dependency recorded.";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    if (permitId === dependsOnId) { msg = "A permit cannot depend on itself."; return; }
    const both = await appDb().select({ id: permits.id }).from(permits).where(and(eq(permits.projectId, p.id)));
    if (![permitId, dependsOnId].every(x => both.some(b => b.id === x))) throw new Error("Permit not found on this project");
    const deps = await appDb().select().from(permitDependencies).where(eq(permitDependencies.projectId, p.id));
    // Refuse a cycle: dependsOn must not (transitively) depend on permitId.
    const reach = new Set<string>([dependsOnId]); let grew = true;
    while (grew) { grew = false; for (const d of deps) if (reach.has(d.permitId) && !reach.has(d.dependsOnId)) { reach.add(d.dependsOnId); grew = true; } }
    if (reach.has(permitId)) { msg = "That would make a circular dependency."; return; }
    await appDb().insert(permitDependencies).values({ mandateId: p.mandateId, projectId: p.id, permitId, dependsOnId, createdBy: user.email }).onConflictDoNothing();
  });
  redirect(note(tabUrl(projectId, "diligence"), msg));
}

// ---------- question layers ----------
export async function runQuestionAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const q = z.enum(Object.keys(QUESTIONS) as [QuestionKey, ...QuestionKey[]]).parse(formData.get("question"));
  let msg = "";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    try { const r = await runLive(appDb(), p, q); msg = `${QUESTIONS[q].label}: ${r.stored} value(s) stored.${r.failed.length ? ` Not available: ${r.failed.join(" ")}` : ""}`; }
    catch (e) { msg = err(e); }
  });
  redirect(`${note(tabUrl(projectId, "questions"), msg)}#q-${q}`);
}

// ---------- matches ----------
export async function decideMatchAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId")); const orgId = zId.parse(formData.get("orgId"));
  const kind = z.enum(keys(MATCH_KINDS)).parse(formData.get("kind"));
  const status = z.enum(["shortlisted", "dismissed"]).parse(formData.get("status"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const c = (await findCandidates(appDb(), user.scope.kind === "user" ? user.scope.mandateIds : [p.mandateId], p, kind, 200)).find(x => x.orgId === orgId);
    if (!c) throw new Error("Candidate not found");
    await recordMatch(appDb(), p.mandateId, p.id, kind, c, status, user.email);
    await audit(appDb(), { actor: user.email, action: `match_${status}`, entity: "ontology_matches", entityId: p.id, after: { kind, orgId, met: c.met, failed: c.failed } });
  });
  redirect(note(`${tabUrl(projectId, "matches")}&kind=${kind}`, status === "shortlisted" ? "Shortlisted. Nothing was sent; outreach stays in the approval queue." : "Dismissed."));
}

// ---------- identifiers and typed relationships ----------
export async function addAliasAction(formData: FormData) {
  const entityType = z.enum(["organization", "person", "project"]).parse(formData.get("entityType"));
  const entityId = zId.parse(formData.get("entityId"));
  const scheme = z.enum(keys(ALIAS_SCHEMES)).parse(formData.get("scheme")) as AliasScheme;
  const value = z.string().trim().min(1).max(300).parse(formData.get("value"));
  const back = z.string().startsWith("/").catch("/intelligence/ontology").parse(formData.get("back"));
  let msg = "Identifier recorded.";
  await withOsUser(async user => {
    const table = entityType === "organization" ? organizations : entityType === "person" ? contacts : projects;
    const [row] = await appDb().select({ mandateId: table.mandateId }).from(table).where(and(eq(table.id, entityId), mandateCondition(user.scope, table.mandateId)));
    if (!row) throw new Error("Record not found");
    const r = await addAlias(appDb(), { mandateId: row.mandateId, entityType, entityId, scheme, value, createdBy: user.email });
    if (!r.ok) msg = `That ${ALIAS_SCHEMES[scheme]} already belongs to another ${r.conflict.entityType} (${r.conflict.entityId.slice(0, 8)}). Merge or correct the records instead of duplicating.`;
    else if (r.existed) msg = "Already recorded.";
    else await audit(appDb(), { actor: user.email, action: "alias_added", entity: entityType, entityId, after: { scheme, value } });
  });
  redirect(note(back, msg));
}

export async function addEdgeAction(formData: FormData) {
  const back = z.string().startsWith("/").catch("/intelligence/ontology").parse(formData.get("back"));
  let msg = "Relationship recorded.";
  await withOsUser(async user => {
    const mandateId = z.string().min(1).parse(formData.get("mandateId"));
    if (user.scope.kind === "user" && !user.scope.mandateIds.includes(mandateId)) throw new Error("Workspace not available");
    try {
      await addOntologyEdge(appDb(), {
        mandateId, fromType: z.enum(ENTITY_TYPES).parse(formData.get("fromType")), fromId: z.string().trim().min(1).max(80).parse(formData.get("fromId")),
        predicate: z.enum(PREDICATE_KEYS).parse(formData.get("predicate")), toType: z.enum(ENTITY_TYPES).parse(formData.get("toType")), toId: z.string().trim().min(1).max(80).parse(formData.get("toId")),
        validFrom: date(formData, "validFrom"), validTo: date(formData, "validTo"), evidenceClaimId: zId.safeParse(formData.get("evidenceClaimId")).data ?? null, note: str(formData, "note", 400), createdBy: user.email,
      });
    } catch (e) { msg = err(e); }
  });
  redirect(note(back, msg));
}

// ---------- sanctions ----------
export async function screenAction(formData: FormData) {
  const entityType = z.enum(["organization", "person"]).parse(formData.get("entityType"));
  const entityId = zId.parse(formData.get("entityId"));
  const back = z.string().startsWith("/").catch("/network/sanctions").parse(formData.get("back"));
  let msg = "";
  await withOsUser(async user => {
    const table = entityType === "organization" ? organizations : contacts;
    const nameCol = entityType === "organization" ? organizations.name : contacts.fullName;
    const [row] = await appDb().select({ mandateId: table.mandateId, name: nameCol }).from(table).where(and(eq(table.id, entityId), mandateCondition(user.scope, table.mandateId)));
    if (!row) throw new Error("Record not found");
    try {
      const c = await screenEntity(appDb(), { mandateId: row.mandateId, entityType, entityId, name: row.name, actor: user.email });
      msg = c.result === "clear" ? `${row.name}: no match on ${c.listsChecked.length} list(s).` : `${row.name}: ${c.matches.length} possible match(es). Review before any introduction or contract.`;
      await audit(appDb(), { actor: user.email, action: "sanctions_screened", entity: entityType, entityId, after: { result: c.result, matches: c.matches.length } });
    } catch (e) { msg = err(e); }
  });
  redirect(note(back, msg));
}

export async function reviewSanctionsAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const review = z.enum(["cleared", "confirmed"]).parse(formData.get("review"));
  const reviewNote = z.string().trim().min(5, "Say why (at least a few words).").max(1000).parse(formData.get("reviewNote"));
  const back = z.string().startsWith("/").catch("/network/sanctions").parse(formData.get("back"));
  await withOsUser(async user => {
    const [c] = await appDb().select().from(sanctionsChecks).where(and(eq(sanctionsChecks.id, id), mandateCondition(user.scope, sanctionsChecks.mandateId)));
    if (!c || c.result !== "possible_match") throw new Error("Check not found");
    await appDb().update(sanctionsChecks).set({ review, reviewNote, reviewedBy: user.email, reviewedAt: new Date().toISOString() }).where(eq(sanctionsChecks.id, id));
    await audit(appDb(), { actor: user.email, action: `sanctions_${review}`, entity: c.entityType, entityId: c.entityId, before: { review: c.review }, after: { review, reviewNote } });
  }, { owner: true });
  redirect(note(back, review === "cleared" ? "Recorded as a false positive." : "Recorded as a confirmed match. Introductions and contracts with this party stay blocked."));
}

export async function refreshSanctionsAction() {
  await withOsUser(async user => {
    if (!isOwner(user.scope)) throw new Error("Owners only");
    const at = new Date();
    for (const list of LIST_KEYS) await enqueue(appDb(), "sanctions.list", { list }, { dedupeKey: `sanctions:${list}:${at.toISOString().slice(0, 13)}`, now: at });
    await audit(appDb(), { actor: user.email, action: "sanctions_refresh_requested", entity: "sanctions_lists", after: { lists: LIST_KEYS } });
  }, { owner: true });
  redirect(note("/network/sanctions", "Refresh queued: one job per list. The tick runs them within a few minutes."));
}
