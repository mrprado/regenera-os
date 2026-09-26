"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  brokerProfiles, commissionEvents, commissionSchedules, dataRoomDocuments, dataRooms, distributionApprovals, documentRequests, documents, intakeSubmissions,
  portalGrants, portalMessages, portalUsers, projects, projectUpdates, referralAgreements, referralRegistrations,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { grantAccess, revokeGrant } from "@/lib/portal/access";
import { invitePortalUser, setPortalUserStatus } from "@/lib/portal/auth";
import { approveCommission, recordCommission, reviewReferral } from "@/lib/portal/broker";
import { convertIntake } from "@/lib/portal/intake";
import {
  AGREEMENT_STATUSES, BROKER_ROLES, BROKER_STATUSES, COMMISSION_TYPES, DATA_ROOM_FOLDERS, DEFAULT_NDA, GRANT_ENTITIES, INVITE_FLASH, PORTAL_KINDS, REQUEST_STATUSES,
} from "@/lib/portal/vocab";

type Scope = Parameters<typeof mandateCondition>[0];
const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const pick = <T extends Record<string, string>>(o: T, f: FormData, k: string) => { const v = str(f, k); return (v in o ? v : null) as (keyof T & string) | null; };
const list = (v: string) => v.split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean).slice(0, 40);
const back = (tab: string, text: string) => `/portals?tab=${tab}&notice=${encodeURIComponent(text)}`;

async function scopedPortalUser(scope: Scope, id: string) {
  const [u] = await appDb().select().from(portalUsers).where(and(eq(portalUsers.id, id), mandateCondition(scope, portalUsers.mandateId)));
  if (!u) throw new Error("Portal user not found");
  return u;
}

/** Invites (or re-invites) a portal user. The link is shown once to the inviter; nothing is emailed. */
export async function invitePortalUserAction(formData: FormData) {
  const kind = z.enum(keys(PORTAL_KINDS)).parse(formData.get("kind"));
  await withOsUser(async user => {
    const mandateId = str(formData, "mandateId") || user.scope.mandateIds[0];
    if (!user.scope.mandateIds.includes(mandateId)) throw new Error("Not your entity");
    const orgId = str(formData, "orgId") || null;
    const { user: pu, token } = await invitePortalUser(appDb(), { mandateId, email: str(formData, "email", 254), name: str(formData, "name", 120), kind, orgId }, user.email);
    if (kind === "broker") {
      const [b] = await appDb().select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.portalUserId, pu.id));
      if (!b) await appDb().insert(brokerProfiles).values({ mandateId, portalUserId: pu.id, orgId, complianceStatus: "under_review" });
    }
    (await cookies()).set(INVITE_FLASH, `${pu.email}|/portal/invite/${token}`, { httpOnly: true, sameSite: "lax", path: withBase("/portals"), maxAge: 300, secure: true });
  });
  redirect(back("users", "Invitation created. Copy the link below and send it yourself; it works once and expires in 14 days."));
}

export async function portalUserStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("portalUserId"));
  const status = z.enum(["active", "suspended", "revoked"]).parse(formData.get("status"));
  await withOsUser(async user => { await scopedPortalUser(user.scope, id); await setPortalUserStatus(appDb(), id, status, user.email); });
  redirect(back("users", `Account ${status}.`));
}

export async function grantAction(formData: FormData) {
  const portalUserId = zId.parse(formData.get("portalUserId"));
  const entityType = z.enum(keys(GRANT_ENTITIES)).parse(formData.get("entityType"));
  const entityId = zId.parse(formData.get(`entity_${entityType}`) || formData.get("entityId"));
  await withOsUser(async user => {
    await scopedPortalUser(user.scope, portalUserId);
    const expires = date(formData, "expiresAt");
    await grantAccess(appDb(), { portalUserId, entityType, entityId, canDownload: formData.get("canDownload") === "on", expiresAt: expires ? `${expires}T23:59:59Z` : null, note: str(formData, "note", 300) }, user.email);
  });
  redirect(back("access", "Access granted. It shows only what this grant names; gates (compliance, NDA, distribution approval) still apply."));
}

export async function revokeGrantAction(formData: FormData) {
  const id = zId.parse(formData.get("grantId"));
  await withOsUser(async user => {
    const [g] = await appDb().select().from(portalGrants).where(and(eq(portalGrants.id, id), mandateCondition(user.scope, portalGrants.mandateId)));
    if (!g) throw new Error("Not found");
    await revokeGrant(appDb(), id, user.email);
  });
  redirect(back("access", "Access revoked."));
}

export async function reviewBrokerAction(formData: FormData) {
  const id = zId.parse(formData.get("brokerId"));
  await withOsUser(async user => {
    const [b] = await appDb().select().from(brokerProfiles).where(and(eq(brokerProfiles.id, id), mandateCondition(user.scope, brokerProfiles.mandateId)));
    if (!b) throw new Error("Not found");
    const next = {
      roleType: pick(BROKER_ROLES, formData, "roleType") ?? b.roleType, complianceStatus: pick(BROKER_STATUSES, formData, "complianceStatus") ?? b.complianceStatus,
      agreementStatus: pick(AGREEMENT_STATUSES, formData, "agreementStatus") ?? b.agreementStatus, agreementExpiresAt: date(formData, "agreementExpiresAt") ?? b.agreementExpiresAt,
      licenseStatus: (z.enum(["none", "claimed", "verified", "expired"]).safeParse(formData.get("licenseStatus")).data ?? b.licenseStatus),
      jurisdictions: formData.has("jurisdictions") ? list(str(formData, "jurisdictions", 300)) : b.jurisdictions, registrationNumbers: str(formData, "registrationNumbers", 300) || b.registrationNumbers,
      licenseEvidence: str(formData, "licenseEvidence", 500) || b.licenseEvidence, reviewNote: str(formData, "reviewNote", 2000) || b.reviewNote,
    };
    if (next.licenseStatus === "verified" && !next.licenseEvidence) throw new Error("Record the licence evidence before marking it verified");
    await appDb().update(brokerProfiles).set({ ...next, reviewedBy: user.email, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(brokerProfiles.id, b.id));
    await audit(appDb(), { actor: user.email, action: "broker_reviewed", entity: "broker_profiles", entityId: b.id, before: { complianceStatus: b.complianceStatus, agreementStatus: b.agreementStatus, licenseStatus: b.licenseStatus }, after: { complianceStatus: next.complianceStatus, agreementStatus: next.agreementStatus, licenseStatus: next.licenseStatus } });
  }, { owner: true });
  redirect(back("brokers", "Introducer updated."));
}

export async function reviewReferralAction(formData: FormData) {
  const id = zId.parse(formData.get("registrationId"));
  const decision = z.enum(["approved", "rejected", "already_known", "converted"]).parse(formData.get("decision"));
  await withOsUser(async user => {
    const [r] = await appDb().select().from(referralRegistrations).where(and(eq(referralRegistrations.id, id), mandateCondition(user.scope, referralRegistrations.mandateId)));
    if (!r) throw new Error("Not found");
    await reviewReferral(appDb(), id, decision, str(formData, "note", 1000), user.email);
  }, { owner: true });
  redirect(back("referrals", "Decision recorded; the introducer sees the status and your note."));
}

export async function addAgreementAction(formData: FormData) {
  const brokerId = zId.parse(formData.get("brokerId"));
  const type = z.enum(keys(COMMISSION_TYPES)).parse(formData.get("type"));
  await withOsUser(async user => {
    const [b] = await appDb().select().from(brokerProfiles).where(and(eq(brokerProfiles.id, brokerId), mandateCondition(user.scope, brokerProfiles.mandateId)));
    if (!b) throw new Error("Not found");
    const [a] = await appDb().insert(referralAgreements).values({ mandateId: b.mandateId, brokerId, title: str(formData, "title", 200) || "Referral agreement", status: "draft", effectiveDate: date(formData, "effectiveDate"), expiresAt: date(formData, "expiresAt") }).returning();
    await appDb().insert(commissionSchedules).values({ agreementId: a.id, type, rate: num(formData, "rate"), amount: num(formData, "amount"), currency: str(formData, "currency", 8) || "USD", cap: num(formData, "cap"), minimum: num(formData, "minimum"), calculationBasis: str(formData, "calculationBasis", 500), eligibilityConditions: str(formData, "eligibilityConditions", 1000), paymentTrigger: str(formData, "paymentTrigger", 500) });
    await audit(appDb(), { actor: user.email, action: "referral_agreement_added", entity: "referral_agreements", entityId: a.id });
  }, { owner: true });
  redirect(back("brokers", "Agreement recorded as Draft with its schedule. Counsel review is required before any fee can be approved."));
}

export async function agreementStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("agreementId"));
  await withOsUser(async user => {
    const [a] = await appDb().select().from(referralAgreements).where(and(eq(referralAgreements.id, id), mandateCondition(user.scope, referralAgreements.mandateId)));
    if (!a) throw new Error("Not found");
    const status = z.enum(["draft", "active", "expired", "terminated"]).catch(a.status).parse(formData.get("status"));
    const legal = z.enum(["pending", "approved"]).catch(a.legalReviewStatus).parse(formData.get("legalReviewStatus"));
    await appDb().update(referralAgreements).set({ status, legalReviewStatus: legal, updatedAt: new Date().toISOString() }).where(eq(referralAgreements.id, a.id));
    if (formData.get("approveSchedule") === "on") await appDb().update(commissionSchedules).set({ approvalStatus: "approved", updatedAt: new Date().toISOString() }).where(eq(commissionSchedules.agreementId, a.id));
    await audit(appDb(), { actor: user.email, action: "referral_agreement_status", entity: "referral_agreements", entityId: a.id, before: { status: a.status, legal: a.legalReviewStatus }, after: { status, legal } });
  }, { owner: true });
  redirect(back("brokers", "Agreement updated."));
}

export async function recordCommissionAction(formData: FormData) {
  const brokerId = zId.parse(formData.get("brokerId"));
  const scheduleId = zId.parse(formData.get("scheduleId"));
  await withOsUser(async user => {
    const [b] = await appDb().select().from(brokerProfiles).where(and(eq(brokerProfiles.id, brokerId), mandateCondition(user.scope, brokerProfiles.mandateId)));
    if (!b) throw new Error("Not found");
    await recordCommission(appDb(), { brokerId, scheduleId, registrationId: str(formData, "registrationId") || null, basisAmount: num(formData, "basisAmount"), note: str(formData, "note", 500) }, user.email);
  }, { owner: true });
  redirect(back("brokers", "Commission recorded as Estimated."));
}

export async function commissionStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("eventId"));
  const status = z.enum(["approved", "invoiced", "paid", "void"]).parse(formData.get("status"));
  await withOsUser(async user => {
    const [e] = await appDb().select().from(commissionEvents).where(and(eq(commissionEvents.id, id), mandateCondition(user.scope, commissionEvents.mandateId)));
    if (!e) throw new Error("Not found");
    if (status === "approved") await approveCommission(appDb(), id, user.email);
    else {
      if ((status === "invoiced" || status === "paid") && e.status === "estimated") throw new Error("Approve the commission first");
      await appDb().update(commissionEvents).set({ status, paidAt: status === "paid" ? new Date().toISOString() : e.paidAt, updatedAt: new Date().toISOString() }).where(eq(commissionEvents.id, id));
      await audit(appDb(), { actor: user.email, action: "commission_status", entity: "commission_events", entityId: id, before: { status: e.status }, after: { status } });
    }
  }, { owner: true });
  redirect(back("brokers", "Commission updated."));
}

export async function createDataRoomAction(formData: FormData) {
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  await withOsUser(async user => {
    const projectId = str(formData, "projectId") || null;
    let mandateId = user.scope.mandateIds[0];
    if (projectId) {
      const [p] = await appDb().select({ mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
      if (!p) throw new Error("Project not found");
      mandateId = p.mandateId;
    }
    await appDb().insert(dataRooms).values({ mandateId, name, projectId, audience: pick(PORTAL_KINDS, formData, "audience") ?? "capital", ndaRequired: formData.get("ndaRequired") === "on", ndaText: str(formData, "ndaText", 8000) || DEFAULT_NDA });
  });
  redirect(back("rooms", "Data room created as Draft. Add documents, then open it and grant access."));
}

export async function dataRoomAction(formData: FormData) {
  const id = zId.parse(formData.get("dataRoomId"));
  await withOsUser(async user => {
    const [r] = await appDb().select().from(dataRooms).where(and(eq(dataRooms.id, id), mandateCondition(user.scope, dataRooms.mandateId)));
    if (!r) throw new Error("Not found");
    const docId = str(formData, "documentId");
    if (docId) {
      const [d] = await appDb().select({ id: documents.id }).from(documents).where(and(eq(documents.id, docId), mandateCondition(user.scope, documents.mandateId)));
      if (!d) throw new Error("Document not found");
      await appDb().insert(dataRoomDocuments).values({ dataRoomId: r.id, documentId: d.id, folder: pick(DATA_ROOM_FOLDERS, formData, "folder") ?? "corporate", addedBy: user.email }).onConflictDoNothing();
    }
    const status = z.enum(["draft", "open", "closed"]).catch(r.status).parse(formData.get("status") ?? r.status);
    const bump = formData.get("bumpNda") === "on";
    const ndaText = str(formData, "ndaText", 8000);
    await appDb().update(dataRooms).set({ status, ndaText: ndaText || r.ndaText, ndaVersion: bump || (ndaText && ndaText !== r.ndaText) ? r.ndaVersion + 1 : r.ndaVersion, updatedAt: new Date().toISOString() }).where(eq(dataRooms.id, r.id));
    if (status !== r.status) await audit(appDb(), { actor: user.email, action: "data_room_status", entity: "data_rooms", entityId: r.id, before: { status: r.status }, after: { status } });
  });
  redirect(back("rooms", "Data room updated."));
}

export async function distributionAction(formData: FormData) {
  const documentId = zId.parse(formData.get("documentId"));
  const audience = z.enum(keys(PORTAL_KINDS)).parse(formData.get("audience"));
  await withOsUser(async user => {
    const [d] = await appDb().select().from(documents).where(and(eq(documents.id, documentId), mandateCondition(user.scope, documents.mandateId)));
    if (!d) throw new Error("Document not found");
    const status = z.enum(["pending", "approved", "rejected"]).catch("pending").parse(formData.get("complianceStatus"));
    const [a] = await appDb().insert(distributionApprovals).values({
      mandateId: d.mandateId, documentId, audience, jurisdictions: list(str(formData, "jurisdictions", 300)), securitiesRelated: formData.get("securitiesRelated") === "on",
      validFrom: date(formData, "validFrom"), validUntil: date(formData, "validUntil"), complianceStatus: status, approvedBy: status === "approved" ? user.email : null,
    }).returning();
    await audit(appDb(), { actor: user.email, action: "distribution_approval", entity: "distribution_approvals", entityId: a.id, after: { documentId, audience, status } });
  }, { owner: true });
  redirect(back("distribution", "Distribution rule recorded."));
}

export async function createRequestAction(formData: FormData) {
  const title = z.string().trim().min(2).max(200).parse(formData.get("title"));
  await withOsUser(async user => {
    const portalUserId = str(formData, "portalUserId") || null;
    const pu = portalUserId ? await scopedPortalUser(user.scope, portalUserId) : null;
    const projectId = str(formData, "projectId") || null;
    await appDb().insert(documentRequests).values({ mandateId: pu?.mandateId ?? user.scope.mandateIds[0], projectId, portalUserId, title, description: str(formData, "description", 2000), folder: pick(DATA_ROOM_FOLDERS, formData, "folder"), dueDate: date(formData, "dueDate"), createdBy: user.email });
  });
  redirect(back("requests", "Request created. It appears in the recipient's portal."));
}

export async function reviewRequestAction(formData: FormData) {
  const id = zId.parse(formData.get("requestId"));
  const status = z.enum(keys(REQUEST_STATUSES)).parse(formData.get("status"));
  await withOsUser(async user => {
    const [r] = await appDb().select().from(documentRequests).where(and(eq(documentRequests.id, id), mandateCondition(user.scope, documentRequests.mandateId)));
    if (!r) throw new Error("Not found");
    await appDb().update(documentRequests).set({ status, updatedAt: new Date().toISOString() }).where(eq(documentRequests.id, id));
  });
  redirect(back("requests", "Request updated."));
}

export async function createUpdateAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const title = z.string().trim().min(2).max(200).parse(formData.get("title"));
  const body = z.string().trim().min(2).max(8000).parse(formData.get("body"));
  await withOsUser(async user => {
    const [p] = await appDb().select({ mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    const audiences = formData.getAll("audiences").map(String).filter(a => a in PORTAL_KINDS);
    const publish = formData.get("publish") === "on";
    await appDb().insert(projectUpdates).values({ mandateId: p.mandateId, projectId, title, body, audiences, createdBy: user.email, approvedBy: publish ? user.email : null, publishedAt: publish ? new Date().toISOString() : null });
  });
  redirect(back("requests", "Update saved."));
}

export async function publishUpdateAction(formData: FormData) {
  const id = zId.parse(formData.get("updateId"));
  await withOsUser(async user => {
    const [u] = await appDb().select().from(projectUpdates).where(and(eq(projectUpdates.id, id), mandateCondition(user.scope, projectUpdates.mandateId)));
    if (!u) throw new Error("Not found");
    await appDb().update(projectUpdates).set({ approvedBy: user.email, publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(projectUpdates.id, id));
    await audit(appDb(), { actor: user.email, action: "project_update_published", entity: "project_updates", entityId: id });
  });
  redirect(back("requests", "Update published to its audiences."));
}

export async function intakeAction(formData: FormData) {
  const id = zId.parse(formData.get("submissionId"));
  const decision = z.enum(["convert", "rejected", "spam", "reviewing"]).parse(formData.get("decision"));
  let msg = "Updated.";
  await withOsUser(async user => {
    const [x] = await appDb().select({ id: intakeSubmissions.id, email: intakeSubmissions.email }).from(intakeSubmissions).where(eq(intakeSubmissions.id, id));
    if (!x) throw new Error("Not found");
    if (decision === "convert") {
      const r = await convertIntake(appDb(), id, user.scope.mandateIds[0], user.email);
      if (r.token) (await cookies()).set(INVITE_FLASH, `${x.email}|/portal/invite/${r.token}`, { httpOnly: true, sameSite: "lax", path: withBase("/portals"), maxAge: 300, secure: true });
      msg = r.type === "project" ? "Converted into a project (sponsor proposed)." : r.token ? "Converted: introducer profile Applied, invitation link below." : "Converted.";
    } else await appDb().update(intakeSubmissions).set({ status: decision, reviewedBy: user.email, updatedAt: new Date().toISOString() }).where(eq(intakeSubmissions.id, id));
  });
  redirect(back("intake", msg));
}

export async function replyPortalAction(formData: FormData) {
  const portalUserId = zId.parse(formData.get("portalUserId"));
  const body = z.string().trim().min(1).max(4000).parse(formData.get("body"));
  await withOsUser(async user => {
    const pu = await scopedPortalUser(user.scope, portalUserId);
    await appDb().insert(portalMessages).values({ mandateId: pu.mandateId, portalUserId: pu.id, direction: "out", body, author: user.email });
    await appDb().update(portalMessages).set({ readAt: new Date().toISOString() }).where(and(eq(portalMessages.portalUserId, pu.id), eq(portalMessages.direction, "in")));
  });
  redirect(back("messages", "Reply posted in their portal (not emailed)."));
}
