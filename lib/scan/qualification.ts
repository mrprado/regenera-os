// Account qualification (phase 15 §8): Discovered → Criteria matched → Human reviewed → Ready for outreach → Engaged →
// Qualified commercial opportunity, plus Disqualified / Parked. Six separate dimensions, each a categorical reading with
// a basis; there is no combined score. The machine (scans) may only set Discovered or Criteria matched; every later
// status is a person's decision with a reason, kept in the history. Qualifying never creates an opportunity by itself.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { accountQualifications, organizations, type DimensionReading, type QualificationStatus } from "@/db/schema";
import { RUBRIC_VERSION } from "./criteria";

export const QUALIFICATION_LABELS: Record<QualificationStatus, string> = {
  discovered: "Discovered", criteria_matched: "Matches criteria", human_reviewed: "Human reviewed", ready_for_outreach: "Ready for outreach",
  engaged: "Engaged", qualified_opportunity: "Qualified commercial opportunity", disqualified: "Disqualified", parked: "Parked",
};
export const DIMENSIONS = {
  accountFit: "Account fit", buyingIntent: "Buying intent / need", relationshipAccess: "Relationship access",
  contactReadiness: "Contact readiness", evidenceConfidence: "Evidence confidence", freshness: "Data freshness",
} as const;
export type DimensionKey = keyof typeof DIMENSIONS;
export const READINGS = { strong: "Strong", partial: "Partial", weak: "Weak", unknown: "Unknown" } as const;

const ORDER: QualificationStatus[] = ["discovered", "criteria_matched", "human_reviewed", "ready_for_outreach", "engaged", "qualified_opportunity"];

export class QualificationError extends Error {}

/** What a person must have recorded before a status is allowed. Returns the unmet requirements. */
export function requirementsFor(to: QualificationStatus, q: { status: QualificationStatus; dimensions: Record<string, DimensionReading> }, reason: string): string[] {
  const out: string[] = [];
  if (!reason.trim()) out.push("A reason is required for every human status change.");
  if (to === "disqualified" || to === "parked") return out;
  const from = ORDER.indexOf(q.status === "disqualified" || q.status === "parked" ? "criteria_matched" : q.status);
  const target = ORDER.indexOf(to);
  if (target > from + 1 && to !== "human_reviewed") out.push(`Move one step at a time: ${QUALIFICATION_LABELS[ORDER[from + 1]]} comes first.`);
  const d = (k: DimensionKey) => q.dimensions[k]?.reading ?? "unknown";
  const human = (k: DimensionKey) => q.dimensions[k] && q.dimensions[k].by && q.dimensions[k].by !== "scan";
  if (to === "ready_for_outreach") {
    if (!human("accountFit") || d("accountFit") === "unknown") out.push("Account fit must be assessed by a person.");
    if (d("contactReadiness") === "unknown" || d("contactReadiness") === "weak") out.push("A usable contact route is needed (contact readiness partial or strong).");
  }
  if (to === "qualified_opportunity") {
    if (!human("buyingIntent") || d("buyingIntent") === "unknown") out.push("Buying intent / need must be evidenced and recorded by a person.");
    if (!human("accountFit") || d("accountFit") === "unknown") out.push("Account fit must be assessed by a person.");
  }
  return out;
}

export async function qualificationFor(db: Db, mandateId: string, orgId: string) {
  const [q] = await db.select().from(accountQualifications).where(and(eq(accountQualifications.mandateId, mandateId), eq(accountQualifications.orgId, orgId)));
  return q ?? null;
}

async function ensureRow(db: Db, mandateId: string, orgId: string) {
  const existing = await qualificationFor(db, mandateId, orgId);
  if (existing) return existing;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.mandateId, mandateId)));
  if (!org) throw new QualificationError("Organization not found in this workspace.");
  const [row] = await db.insert(accountQualifications).values({ mandateId, orgId, status: "discovered", rubricVersion: RUBRIC_VERSION, history: [] }).onConflictDoNothing().returning();
  return row ?? (await qualificationFor(db, mandateId, orgId))!;
}

export async function setQualificationStatus(db: Db, mandateId: string, orgId: string, to: QualificationStatus, by: string, reason: string, now = new Date()) {
  const q = await ensureRow(db, mandateId, orgId);
  const unmet = requirementsFor(to, q, reason);
  if (unmet.length) throw new QualificationError(unmet.join(" "));
  const t = now.toISOString();
  await db.update(accountQualifications).set({
    status: to, reviewedBy: by, reviewedAt: t, updatedAt: t, disqualifyReason: to === "disqualified" ? reason : q.disqualifyReason,
    history: [...q.history, { from: q.status, to, at: t, by, reason }],
  }).where(eq(accountQualifications.id, q.id));
  // The commercial role follows a human decision only: qualified accounts carry the audience's role.
  return { from: q.status, to };
}

export async function setDimension(db: Db, mandateId: string, orgId: string, key: DimensionKey, reading: DimensionReading["reading"], basis: string, by: string, source?: string, now = new Date()) {
  if (!(key in DIMENSIONS)) throw new QualificationError("Unknown dimension.");
  if (!basis.trim() && reading !== "unknown") throw new QualificationError("A basis is required for any reading other than Unknown.");
  const q = await ensureRow(db, mandateId, orgId);
  const t = now.toISOString();
  await db.update(accountQualifications).set({
    dimensions: { ...q.dimensions, [key]: { reading, basis: basis.trim(), by, at: t, ...(source ? { source } : {}) } }, updatedAt: t,
  }).where(eq(accountQualifications.id, q.id));
}

export async function setAccountBrief(db: Db, mandateId: string, orgId: string, brief: { who?: string; decision?: string; whyNow?: string; entryOffer?: string; nextAction?: string }) {
  const q = await ensureRow(db, mandateId, orgId);
  await db.update(accountQualifications).set({ ...brief, updatedAt: new Date().toISOString() }).where(eq(accountQualifications.id, q.id));
}
