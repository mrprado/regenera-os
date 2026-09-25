// Regulatory engine (docs/plans/phase-6.md M4). Records requirements, permits and reviews with their evidence and
// reviewer; surfaces what is expiring, overdue for verification or waiting for counsel. Never a compliance verdict.
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { permits, projects, regulatoryReviews, requirements } from "@/db/schema";
import { audit } from "@/lib/audit";
import { REVIEW_SUBJECTS, REVIEW_TOPICS, STANDARD_CHECKLISTS, type REQUIREMENT_STATUSES } from "./vocab";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Seeds a lender / investor standard as Unknown requirements on the lender track. Idempotent per title. */
export async function seedChecklist(db: Db, projectId: string, key: keyof typeof STANDARD_CHECKLISTS, actor: string) {
  const list = STANDARD_CHECKLISTS[key];
  if (!list) throw new Error("Unknown checklist");
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const existing = new Set((await db.select({ title: requirements.title }).from(requirements).where(and(eq(requirements.projectId, projectId), eq(requirements.standard, key)))).map(r => r.title));
  const fresh = list.items.filter(t => !existing.has(t));
  for (const title of fresh) {
    await db.insert(requirements).values({ projectId, mandateId: p.mandateId, track: "lender_standard", domain: key === "ifc_ehs" ? "lender_other" : "lender_es", standard: key, title, source: list.label, sourceTier: 2 });
  }
  if (fresh.length) await audit(db, { actor, action: "regulatory_checklist_seeded", entity: "projects", entityId: projectId, after: { checklist: key, added: fresh.length } });
  return fresh.length;
}

/** Status changes that assert something (approved, not applicable) need evidence and a reviewer. */
export async function setRequirementStatus(db: Db, id: string, input: { status: keyof typeof REQUIREMENT_STATUSES; evidence?: string; reviewer?: string; nextVerification?: string | null }, actor: string, now = new Date()) {
  const [r] = await db.select().from(requirements).where(eq(requirements.id, id));
  if (!r) throw new Error("Requirement not found");
  const asserts = input.status === "approved" || input.status === "not_applicable";
  if (asserts && (!input.evidence?.trim() || !input.reviewer?.trim())) throw new Error("Approved and Not applicable need the evidence and who reviewed it.");
  await db.update(requirements).set({
    status: input.status, ...(input.evidence !== undefined ? { evidence: input.evidence } : {}), ...(input.reviewer ? { reviewer: input.reviewer, reviewedAt: now.toISOString() } : {}),
    ...(input.nextVerification !== undefined ? { nextVerification: input.nextVerification } : {}), updatedAt: now.toISOString(),
  }).where(eq(requirements.id, id));
  await audit(db, { actor, action: "requirement_status", entity: "requirements", entityId: id, before: { status: r.status }, after: { status: input.status, reviewer: input.reviewer, evidence: input.evidence } });
}

export async function updatePermit(db: Db, id: string, patch: { status?: typeof permits.$inferSelect.status; submittedAt?: string | null; approvedAt?: string | null; expiresAt?: string | null; conditions?: string; reference?: string }, actor: string, now = new Date()) {
  const [p] = await db.select().from(permits).where(eq(permits.id, id));
  if (!p) throw new Error("Permit not found");
  if (patch.status === "approved" && !(patch.approvedAt ?? p.approvedAt)) throw new Error("Record the approval date.");
  await db.update(permits).set({
    ...patch, ...(patch.status === "submitted" && !p.submittedAt && !patch.submittedAt ? { submittedAt: day(now) } : {}), updatedAt: now.toISOString(),
  }).where(eq(permits.id, id));
  await audit(db, { actor, action: "permit_updated", entity: "permits", entityId: id, before: { status: p.status, expiresAt: p.expiresAt }, after: patch });
}

export type ReviewInput = {
  mandateId: string; subjectType: keyof typeof REVIEW_SUBJECTS; subjectId: string; topic: keyof typeof REVIEW_TOPICS; jurisdiction?: string | null;
  conclusion: typeof regulatoryReviews.$inferInsert.conclusion; conditions?: string; reviewer: string; reviewerRole: string; reviewedAt: string; evidence: string; validUntil?: string | null;
};

/** Records a review. Reviewer, their role and the evidence are mandatory: a conclusion without them is not recorded. */
export async function recordReview(db: Db, input: ReviewInput, actor: string) {
  if (!input.reviewer.trim() || !input.reviewerRole.trim() || !input.evidence.trim()) throw new Error("A review needs the reviewer, their role and the evidence.");
  if (input.conclusion === "permitted_with_conditions" && !input.conditions?.trim()) throw new Error("Record the conditions.");
  const [row] = await db.insert(regulatoryReviews).values({ ...input, recordedBy: actor }).returning();
  await audit(db, { actor, action: "regulatory_review", entity: input.subjectType, entityId: input.subjectId, after: { topic: input.topic, conclusion: input.conclusion, reviewer: input.reviewer, validUntil: input.validUntil } });
  return row;
}

export type RegulatoryAlerts = {
  permitsExpiring: { id: string; projectId: string; project: string; name: string; expiresAt: string; expired: boolean }[];
  verificationsDue: { id: string; projectId: string; project: string; title: string; nextVerification: string }[];
  counselReview: { id: string; projectId: string; project: string; title: string }[];
};

/** For Today: permits expiring within 90 days (or expired while approved), requirements due for re-verification, and those waiting for counsel. */
export async function regulatoryAlerts(db: Db, mandateIds: string[] | null, now = new Date()): Promise<RegulatoryAlerts> {
  const scope = (col: typeof permits.mandateId | typeof requirements.mandateId) => (mandateIds ? inArray(col, mandateIds.length ? mandateIds : ["-"]) : sql`1 = 1`);
  const today = day(now);
  const in90 = day(new Date(now.getTime() + 90 * 86_400_000));
  const exp = await db.select({ p: permits, project: projects.name }).from(permits).innerJoin(projects, eq(projects.id, permits.projectId))
    .where(and(scope(permits.mandateId), inArray(permits.status, ["approved", "renewal", "expired"]), lte(permits.expiresAt, in90))).orderBy(asc(permits.expiresAt)).limit(30);
  const ver = await db.select({ r: requirements, project: projects.name }).from(requirements).innerJoin(projects, eq(projects.id, requirements.projectId))
    .where(and(scope(requirements.mandateId), lte(requirements.nextVerification, today))).orderBy(asc(requirements.nextVerification)).limit(30);
  const counsel = await db.select({ r: requirements, project: projects.name }).from(requirements).innerJoin(projects, eq(projects.id, requirements.projectId))
    .where(and(scope(requirements.mandateId), eq(requirements.status, "counsel_review"))).limit(30);
  return {
    permitsExpiring: exp.filter(x => x.p.expiresAt).map(x => ({ id: x.p.id, projectId: x.p.projectId, project: x.project, name: x.p.name, expiresAt: x.p.expiresAt!, expired: x.p.expiresAt! < today })),
    verificationsDue: ver.map(x => ({ id: x.r.id, projectId: x.r.projectId, project: x.project, title: x.r.title, nextVerification: x.r.nextVerification! })),
    counselReview: counsel.map(x => ({ id: x.r.id, projectId: x.r.projectId, project: x.project, title: x.r.title })),
  };
}

/** Daily: approved permits past their expiry become Expired (and are audited). */
export async function expirePermits(db: Db, now = new Date()) {
  const r = await db.update(permits).set({ status: "expired", updatedAt: now.toISOString() })
    .where(and(eq(permits.status, "approved"), lt(permits.expiresAt, day(now)))).returning({ id: permits.id });
  for (const p of r) await audit(db, { actor: "system", action: "permit_expired", entity: "permits", entityId: p.id });
  return r.length;
}
