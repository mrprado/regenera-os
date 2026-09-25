"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { capitalOpportunities, contacts, contracts, kycChecks, permits, projectJurisdictions, projects, requirements } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition, type UserScope } from "@/lib/db/scoped";
import { recordReview, seedChecklist, setRequirementStatus, updatePermit } from "@/lib/regulatory/engine";
import {
  JURISDICTION_ROLES, KYC_CHECKS, KYC_STATUSES, PERMIT_STATUSES, REGULATION_DOMAINS, REQUIREMENT_STATUSES, REVIEW_CONCLUSIONS, REVIEW_SUBJECTS, REVIEW_TOPICS,
  STANDARD_CHECKLISTS, TRACKS,
} from "@/lib/regulatory/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null;
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const tab = (projectId: string) => `/projects/${projectId}?tab=regulatory`;

async function scopedProject(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [p] = await appDb().select({ id: projects.id, mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

export async function addJurisdictionAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const role = z.enum(keys(JURISDICTION_ROLES)).parse(formData.get("role"));
  const jurisdiction = z.string().trim().min(2).max(10).regex(/^[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?$/).parse(formData.get("jurisdiction")).toUpperCase();
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    await appDb().insert(projectJurisdictions).values({ projectId, mandateId: p.mandateId, role, jurisdiction, note: str(formData, "note", 300) }).onConflictDoNothing();
  });
  redirect(note(tab(projectId), `${JURISDICTION_ROLES[role]}: ${jurisdiction} added to the matrix.`));
}

export async function removeJurisdictionAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let projectId = "";
  await withOsUser(async user => {
    const [row] = await appDb().select().from(projectJurisdictions).where(and(eq(projectJurisdictions.id, id), mandateCondition(user.scope, projectJurisdictions.mandateId)));
    if (!row) throw new Error("Not found");
    projectId = row.projectId;
    await appDb().delete(projectJurisdictions).where(eq(projectJurisdictions.id, id));
  });
  redirect(note(tab(projectId), "Removed."));
}

export async function addRequirementAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const title = z.string().trim().min(3).max(300).parse(formData.get("title"));
  const domain = z.enum(keys(REGULATION_DOMAINS)).parse(formData.get("domain"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const tier = Number(str(formData, "sourceTier"));
    await appDb().insert(requirements).values({
      projectId, mandateId: p.mandateId, track: z.enum(keys(TRACKS)).catch("host_law").parse(formData.get("track")), domain, title,
      jurisdiction: opt(formData, "jurisdiction", 10)?.toUpperCase() ?? null, authority: str(formData, "authority", 200),
      status: z.enum(keys(REQUIREMENT_STATUSES)).catch("unknown").parse(formData.get("status")), source: str(formData, "source", 500),
      sourceTier: tier >= 1 && tier <= 5 ? tier : null, owner: opt(formData, "owner", 120), nextVerification: date(formData, "nextVerification"),
    });
  });
  redirect(note(tab(projectId), "Requirement added."));
}

export async function requirementStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const status = z.enum(keys(REQUIREMENT_STATUSES)).parse(formData.get("status"));
  let projectId = "";
  let msg = `Set to ${REQUIREMENT_STATUSES[status]}.`;
  await withOsUser(async user => {
    const [r] = await appDb().select({ projectId: requirements.projectId }).from(requirements).where(and(eq(requirements.id, id), mandateCondition(user.scope, requirements.mandateId)));
    if (!r) throw new Error("Not found");
    projectId = r.projectId;
    try { await setRequirementStatus(appDb(), id, { status, evidence: str(formData, "evidence", 2000) || undefined, reviewer: str(formData, "reviewer", 200) || undefined, nextVerification: date(formData, "nextVerification") }, user.email); }
    catch (e) { msg = errorText(e); }
  });
  redirect(note(tab(projectId), msg));
}

export async function seedChecklistAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const key = z.enum(Object.keys(STANDARD_CHECKLISTS) as [string, ...string[]]).parse(formData.get("checklist"));
  let n = 0;
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    n = await seedChecklist(appDb(), projectId, key, user.email);
  });
  redirect(note(tab(projectId), n ? `${n} ${STANDARD_CHECKLISTS[key].label} items added as Unknown. Record applicability with evidence.` : "Already on the list."));
}

export async function addPermitAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const name = z.string().trim().min(2).max(300).parse(formData.get("name"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    await appDb().insert(permits).values({
      projectId, mandateId: p.mandateId, name, authority: str(formData, "authority", 200), jurisdiction: opt(formData, "jurisdiction", 10)?.toUpperCase() ?? null,
      reference: str(formData, "reference", 200), status: z.enum(keys(PERMIT_STATUSES)).catch("not_started").parse(formData.get("status")),
      expiresAt: date(formData, "expiresAt"), approvedAt: date(formData, "approvedAt"), conditions: str(formData, "conditions", 2000), owner: opt(formData, "owner", 120),
      requirementId: zId.safeParse(formData.get("requirementId")).data ?? null,
    });
  });
  redirect(note(tab(projectId), "Permit added. Expiring permits appear on Today 90 days ahead."));
}

export async function updatePermitAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let projectId = "";
  let msg = "Permit updated.";
  await withOsUser(async user => {
    const [p] = await appDb().select({ projectId: permits.projectId }).from(permits).where(and(eq(permits.id, id), mandateCondition(user.scope, permits.mandateId)));
    if (!p) throw new Error("Not found");
    projectId = p.projectId;
    try {
      await updatePermit(appDb(), id, {
        status: z.enum(keys(PERMIT_STATUSES)).parse(formData.get("status")), approvedAt: date(formData, "approvedAt") ?? undefined, expiresAt: date(formData, "expiresAt") ?? undefined,
      }, user.email);
    } catch (e) { msg = errorText(e); }
  });
  redirect(note(tab(projectId), msg));
}

/** Resolves the entity (mandate) of the record under review, within the user's scope. */
async function subjectMandate(scope: UserScope, type: keyof typeof REVIEW_SUBJECTS, id: string) {
  const table = type === "project" ? projects : type === "capital_opportunity" ? capitalOpportunities : type === "contract" ? contracts : null;
  if (!table) return scope.mandateIds[0];
  const [row] = await appDb().select({ mandateId: table.mandateId }).from(table).where(and(eq(table.id, id), mandateCondition(scope, table.mandateId)));
  if (!row) throw new Error("Record not found");
  return row.mandateId;
}

export async function addReviewAction(formData: FormData) {
  const subjectType = z.enum(keys(REVIEW_SUBJECTS)).parse(formData.get("subjectType"));
  const subjectId = zId.parse(formData.get("subjectId"));
  const back = z.string().startsWith("/").catch("/projects").parse(formData.get("back"));
  let msg = "Review recorded.";
  await withOsUser(async user => {
    const mandateId = await subjectMandate(user.scope, subjectType, subjectId);
    try {
      await recordReview(appDb(), {
        mandateId, subjectType, subjectId, topic: z.enum(keys(REVIEW_TOPICS)).parse(formData.get("topic")), jurisdiction: opt(formData, "jurisdiction", 10)?.toUpperCase() ?? null,
        conclusion: z.enum(keys(REVIEW_CONCLUSIONS)).parse(formData.get("conclusion")), conditions: str(formData, "conditions", 2000), reviewer: str(formData, "reviewer", 200),
        reviewerRole: str(formData, "reviewerRole", 120), reviewedAt: date(formData, "reviewedAt") ?? new Date().toISOString().slice(0, 10), evidence: str(formData, "evidence", 2000),
        validUntil: date(formData, "validUntil"),
      }, user.email);
    } catch (e) { msg = errorText(e); }
  }, { owner: true });
  redirect(note(back, msg));
}

export async function addKycAction(formData: FormData) {
  const back = z.string().startsWith("/capital").catch("/capital").parse(formData.get("back"));
  const checkType = z.enum(keys(KYC_CHECKS)).parse(formData.get("checkType"));
  await withOsUser(async user => {
    const contactId = zId.safeParse(formData.get("contactId")).data ?? null;
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
    if (!contactId && !orgId) throw new Error("Person or entity required");
    const [c] = contactId ? await appDb().select({ mandateId: contacts.mandateId }).from(contacts).where(and(eq(contacts.id, contactId), mandateCondition(user.scope, contacts.mandateId))) : [{ mandateId: user.scope.mandateIds[0] }];
    if (!c) throw new Error("Not found");
    const [row] = await appDb().insert(kycChecks).values({
      mandateId: c.mandateId, contactId, orgId, checkType, provider: str(formData, "provider", 120), status: z.enum(keys(KYC_STATUSES)).catch("not_started").parse(formData.get("status")),
      providerRef: str(formData, "providerRef", 200), checkedAt: date(formData, "checkedAt"), expiresAt: date(formData, "expiresAt"),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "kyc_recorded", entity: "kyc_checks", entityId: row.id, after: { checkType, status: row.status } });
  }, { owner: true });
  redirect(note(back, "KYC status recorded (status and provider reference only)."));
}
