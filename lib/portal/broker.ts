// Broker / introducer workflows (master build instruction §31–33, §93): referral registration with duplicate, existing
// relationship, competing claim, jurisdiction and agreement checks; review; commission estimates that stay "estimated"
// until the schedule and the agreement's legal review are approved. Registration never promises economics.
import { emitEvent } from "@/lib/events/engine";
import { and, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { brokerProfiles, commissionEvents, commissionSchedules, contacts, deals, organizations, referralAgreements, referralRegistrations } from "@/db/schema";
import { audit } from "@/lib/audit";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { brokerStanding } from "./access";
import { REFERRAL_DAYS } from "./vocab";

type Registration = typeof referralRegistrations.$inferSelect;
const day = (d: Date) => d.toISOString().slice(0, 10);

export type ReferralInput = Pick<Registration, "targetType" | "name"> & Partial<Pick<Registration, "organization" | "contactEmail" | "jurisdiction" | "relationship" | "intendedIntroduction" | "projectId" | "notes" | "evidence">>;

/** Runs every check and stores the registration as Submitted, or Conflict review when anything needs a human. */
export async function registerReferral(db: Db, brokerId: string, input: ReferralInput, now = new Date()) {
  const [broker] = await db.select().from(brokerProfiles).where(eq(brokerProfiles.id, brokerId));
  if (!broker) throw new Error("Broker not found");
  const conflicts: { kind: string; detail: string }[] = [];
  const orgName = normalizeOrgName(input.organization || (input.targetType === "company" || input.targetType === "investor" ? input.name : ""));
  const email = input.contactEmail?.trim().toLowerCase() || null;

  const [org] = orgName ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.mandateId, broker.mandateId), eq(organizations.nameNormalized, orgName))) : [];
  const [contact] = email ? await db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(and(eq(contacts.mandateId, broker.mandateId), eq(contacts.emailLower, email))) : [];
  if (org) {
    conflicts.push({ kind: "existing_record", detail: `Organization already in the OS: ${org.name}` });
    const [d] = await db.select({ n: sql<number>`count(*)` }).from(deals).where(eq(deals.orgId, org.id));
    if (d.n > 0) conflicts.push({ kind: "existing_relationship", detail: `${d.n} existing opportunit${d.n === 1 ? "y" : "ies"} with this organization` });
  }
  if (contact) conflicts.push({ kind: "existing_record", detail: `Person already in the OS: ${contact.name}` });

  const claimConds = [orgName ? sql`lower(${referralRegistrations.organization}) = ${input.organization?.trim().toLowerCase() ?? ""}` : undefined, email ? eq(referralRegistrations.contactEmail, email) : undefined].filter(Boolean);
  if (claimConds.length) {
    const others = await db.select({ id: referralRegistrations.id, brokerId: referralRegistrations.brokerId, status: referralRegistrations.status }).from(referralRegistrations)
      .where(and(eq(referralRegistrations.mandateId, broker.mandateId), ne(referralRegistrations.brokerId, brokerId), inArray(referralRegistrations.status, ["submitted", "conflict_review", "approved"]),
        or(sql`${referralRegistrations.expiresAt} is null`, gt(referralRegistrations.expiresAt, day(now))), or(...claimConds)));
    if (others.length) conflicts.push({ kind: "competing_claim", detail: `Another introducer has a ${others[0].status.replace(/_/g, " ")} registration for this party` });
  }
  if (input.jurisdiction && broker.jurisdictions.length && !broker.jurisdictions.map(j => j.toUpperCase()).includes(input.jurisdiction.toUpperCase()))
    conflicts.push({ kind: "jurisdiction", detail: `${input.jurisdiction} is outside the introducer's recorded jurisdictions (${broker.jurisdictions.join(", ")})` });
  const standing = await brokerStanding(db, { id: broker.portalUserId, status: "active" } as never, now);
  if (!standing.active) conflicts.push({ kind: "agreement", detail: standing.reasons.join("; ") });
  if (input.targetType === "investor" && !standing.securities) conflicts.push({ kind: "role", detail: "Investor introduction by a non-licensed role: counsel to confirm the introduction does not amount to arranging or offering securities" });

  const [r] = await db.insert(referralRegistrations).values({
    mandateId: broker.mandateId, brokerId, targetType: input.targetType, name: input.name.trim(), organization: input.organization?.trim() ?? "", contactEmail: email,
    jurisdiction: input.jurisdiction ?? null, relationship: input.relationship ?? "", intendedIntroduction: input.intendedIntroduction ?? "", projectId: input.projectId ?? null,
    notes: input.notes ?? "", evidence: input.evidence ?? "", status: conflicts.length ? "conflict_review" : "submitted", conflicts,
    matchedOrgId: org?.id ?? null, matchedContactId: contact?.id ?? null,
  }).returning();
  await audit(db, { actor: `portal:${broker.portalUserId}`, action: "referral_submitted", entity: "referral_registrations", entityId: r.id, after: { status: r.status, conflicts: conflicts.length } });
  await emitEvent(db, { mandateId: broker.mandateId, type: "BROKER_REFERRAL_SUBMITTED", entityType: "referral", entityId: r.id, payload: { name: r.name, status: r.status, conflicts: conflicts.length }, actor: `portal:${broker.portalUserId}` });
  return r;
}

/** Internal decision. Approved registrations protect the introduction for REFERRAL_DAYS. */
export async function reviewReferral(db: Db, registrationId: string, decision: "approved" | "rejected" | "already_known" | "converted", note: string, actor: string, now = new Date()) {
  const [r] = await db.select().from(referralRegistrations).where(eq(referralRegistrations.id, registrationId));
  if (!r) throw new Error("Registration not found");
  await db.update(referralRegistrations).set({
    status: decision, decisionNote: note, reviewedBy: actor, reviewedAt: now.toISOString(), updatedAt: now.toISOString(),
    expiresAt: decision === "approved" ? day(new Date(now.getTime() + REFERRAL_DAYS * 86_400_000)) : r.expiresAt,
  }).where(eq(referralRegistrations.id, r.id));
  await audit(db, { actor, action: "referral_reviewed", entity: "referral_registrations", entityId: r.id, before: { status: r.status }, after: { status: decision, note } });
  if (decision === "approved") await emitEvent(db, { mandateId: r.mandateId, type: "BROKER_REFERRAL_APPROVED", entityType: "referral", entityId: r.id, payload: { name: r.name }, actor });
}

type Schedule = Pick<typeof commissionSchedules.$inferSelect, "type" | "rate" | "amount" | "cap" | "minimum">;

/** Arithmetic only; whether anything is owed is for the agreement and its approvals. */
export function estimateCommission(s: Schedule, basisAmount: number | null): number | null {
  let v: number | null;
  if (s.type === "percentage") v = basisAmount !== null && s.rate !== null ? (basisAmount * s.rate) / 100 : null;
  else if (s.type === "bps") v = basisAmount !== null && s.rate !== null ? (basisAmount * s.rate) / 10_000 : null;
  else if (s.type === "fixed" || s.type === "milestone") v = s.amount;
  else v = null;
  if (v === null) return null;
  if (s.minimum !== null) v = Math.max(v, s.minimum);
  if (s.cap !== null) v = Math.min(v, s.cap);
  return Math.round(v * 100) / 100;
}

/** Records a commission line. It stays Estimated unless the schedule is approved AND the agreement is active with legal
 * review approved AND the registration is approved or converted. */
export async function recordCommission(db: Db, input: { brokerId: string; scheduleId: string; registrationId?: string | null; dealId?: string | null; basisAmount: number | null; note?: string }, actor: string) {
  const [s] = await db.select({ s: commissionSchedules, a: referralAgreements }).from(commissionSchedules).innerJoin(referralAgreements, eq(referralAgreements.id, commissionSchedules.agreementId)).where(eq(commissionSchedules.id, input.scheduleId));
  if (!s || s.a.brokerId !== input.brokerId) throw new Error("Schedule not found for this introducer");
  const amount = estimateCommission(s.s, input.basisAmount);
  if (amount === null) throw new Error("This schedule needs a basis amount (or is custom: record it manually)");
  const [reg] = input.registrationId ? await db.select().from(referralRegistrations).where(eq(referralRegistrations.id, input.registrationId)) : [];
  if (input.registrationId && (!reg || reg.brokerId !== input.brokerId)) throw new Error("Registration not found for this introducer");
  const [e] = await db.insert(commissionEvents).values({
    mandateId: s.a.mandateId, brokerId: input.brokerId, scheduleId: s.s.id, registrationId: input.registrationId ?? null, dealId: input.dealId ?? null,
    basisAmount: input.basisAmount, amount, currency: s.s.currency, status: "estimated", note: input.note ?? "",
  }).returning();
  await audit(db, { actor, action: "commission_recorded", entity: "commission_events", entityId: e.id, after: { amount, currency: s.s.currency } });
  return e;
}

export async function approveCommission(db: Db, eventId: string, actor: string) {
  const [e] = await db.select().from(commissionEvents).where(eq(commissionEvents.id, eventId));
  if (!e) throw new Error("Commission not found");
  const [s] = e.scheduleId ? await db.select({ s: commissionSchedules, a: referralAgreements }).from(commissionSchedules).innerJoin(referralAgreements, eq(referralAgreements.id, commissionSchedules.agreementId)).where(eq(commissionSchedules.id, e.scheduleId)) : [];
  const [reg] = e.registrationId ? await db.select().from(referralRegistrations).where(eq(referralRegistrations.id, e.registrationId)) : [];
  const blockers = [
    !s && "No schedule", s && s.s.approvalStatus !== "approved" && "Schedule not approved", s && s.a.status !== "active" && "Agreement not active",
    s && s.a.legalReviewStatus !== "approved" && "Agreement legal review not approved", e.registrationId && !(reg && ["approved", "converted"].includes(reg.status)) && "Registration not approved",
  ].filter(Boolean) as string[];
  if (blockers.length) throw new Error(`Cannot approve: ${blockers.join("; ")}`);
  await db.update(commissionEvents).set({ status: "approved", approvedBy: actor, updatedAt: new Date().toISOString() }).where(eq(commissionEvents.id, e.id));
  await audit(db, { actor, action: "commission_approved", entity: "commission_events", entityId: e.id, before: { status: e.status }, after: { status: "approved" } });
}

/** Daily: agreements past their date expire (removing broker access); approved registrations past protection expire. */
export async function expireBrokerRecords(db: Db, now = new Date()) {
  const today = day(now);
  const a = await db.update(brokerProfiles).set({ agreementStatus: "expired", updatedAt: now.toISOString() }).where(and(eq(brokerProfiles.agreementStatus, "signed"), lt(brokerProfiles.agreementExpiresAt, today))).returning({ id: brokerProfiles.id });
  const ra = await db.update(referralAgreements).set({ status: "expired", updatedAt: now.toISOString() }).where(and(eq(referralAgreements.status, "active"), lt(referralAgreements.expiresAt, today))).returning({ id: referralAgreements.id });
  const r = await db.update(referralRegistrations).set({ status: "expired", updatedAt: now.toISOString() }).where(and(eq(referralRegistrations.status, "approved"), lt(referralRegistrations.expiresAt, today))).returning({ id: referralRegistrations.id });
  return { agreements: a.length + ra.length, registrations: r.length };
}
