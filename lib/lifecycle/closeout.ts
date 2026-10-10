// Completing an engagement (phase 29D). Completion needs the outcome and the client's acceptance evidence; work still
// open is either finished first or recorded as outstanding with a reason. Economics are reviewed from the records.
// A completed engagement is not an ended relationship: a relationship review is scheduled, a continuation can be
// proposed, and case-study or referral requests are created only when the owner chooses to ask.
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@/db";
import { clientRequests, engagementCloseouts, engagementDeliverables, engagements, invoices, relationshipStatus, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ensureStatus } from "./network";
import { deriveClientRoles } from "./relationships";

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function closeoutCheck(db: Db, engagementId: string) {
  const [dels, reqs, invs] = await Promise.all([
    db.select({ label: engagementDeliverables.label, status: engagementDeliverables.status }).from(engagementDeliverables).where(and(eq(engagementDeliverables.engagementId, engagementId), notInArray(engagementDeliverables.status, ["accepted"]))),
    db.select({ id: clientRequests.id, label: clientRequests.label }).from(clientRequests).where(and(eq(clientRequests.engagementId, engagementId), inArray(clientRequests.status, ["open", "rejected", "submitted"]))),
    db.select().from(invoices).where(and(eq(invoices.engagementId, engagementId), notInArray(invoices.status, ["void", "paid"]))),
  ]);
  return {
    openDeliverables: dels.map(d => `${d.label} (${d.status.replace(/_/g, " ")})`),
    openRequests: reqs,
    unpaidInvoices: invs.map(i => ({ number: i.number, outstanding: Math.round((i.amount - i.paidAmount) * 100) / 100, currency: i.currency, status: i.status })),
  };
}

export async function completeEngagement(db: Db, engagementId: string, input: {
  outcome: string; acceptanceEvidence: string; lessons?: string; continuation?: string; outstandingReason?: string;
  caseStudy?: "not_asked" | "requested" | "granted" | "declined"; askReferral?: boolean; reviewInDays?: number;
}, by: string) {
  const [e] = await db.select().from(engagements).where(eq(engagements.id, engagementId));
  if (!e) throw new Error("Engagement not found");
  if (["complete", "closed"].includes(e.status)) throw new Error("This engagement is already complete.");
  if (!input.outcome.trim()) throw new Error("Record the outcome.");
  if (!input.acceptanceEvidence.trim()) throw new Error("Record the client's acceptance (signed acceptance, email or meeting minutes).");
  const check = await closeoutCheck(db, engagementId);
  const open = [...check.openDeliverables.map(d => `Deliverable: ${d}`), ...check.openRequests.map(r => `Client request: ${r.label}`)];
  if (open.length && !input.outstandingReason?.trim()) throw new Error(`Still open: ${open.join("; ")}. Finish them, or record why the engagement closes with them open.`);
  // Requests still open at closeout are cancelled with the recorded reason; deliverables keep their state.
  for (const r of check.openRequests) await db.update(clientRequests).set({ status: "cancelled", reviewNote: `Closed with the engagement: ${input.outstandingReason}`, updatedAt: new Date().toISOString() }).where(eq(clientRequests.id, r.id));
  const reviewDue = addDays(input.reviewInDays ?? 30);
  await db.insert(engagementCloseouts).values({
    mandateId: e.mandateId, engagementId, outcome: input.outcome, acceptanceEvidence: input.acceptanceEvidence, lessons: input.lessons ?? "", continuation: input.continuation ?? "",
    caseStudy: input.caseStudy ?? "not_asked", referralRequested: !!input.askReferral,
    outstanding: [...open.map(o => `${o} (${input.outstandingReason})`), ...check.unpaidInvoices.map(i => `Invoice ${i.number}: ${i.currency} ${i.outstanding} unpaid`)], reviewDue, createdBy: by,
  });
  await db.update(engagements).set({ status: "complete", endDate: e.endDate ?? new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString() }).where(eq(engagements.id, engagementId));
  if (e.orgId) {
    await deriveClientRoles(db, e.mandateId, e.orgId, by);
    await ensureStatus(db, e.mandateId, "organization", e.orgId, by, e.owner);
    await db.update(relationshipStatus).set({ stage: "active", nextAction: "Relationship review after the engagement", nextActionDue: reviewDue, updatedAt: new Date().toISOString() }).where(and(eq(relationshipStatus.mandateId, e.mandateId), eq(relationshipStatus.entityType, "organization"), eq(relationshipStatus.entityId, e.orgId)));
  }
  const task = (title: string, body: string, due: string) => db.insert(tasks).values({ mandateId: e.mandateId, orgId: e.orgId, dealId: e.dealId, projectId: e.projectId, type: "follow_up", title: `${e.name}: ${title}`, body, dueAt: `${due}T09:00:00.000Z`, owner: e.owner ?? by, workstream: `engagement:${engagementId}` });
  await task("relationship review", `Outcome: ${input.outcome}`, reviewDue);
  if (input.continuation?.trim()) await task("propose continuation", input.continuation, addDays(14));
  if (input.caseStudy === "requested") await task("ask for case-study permission", "Ask the client whether a case study may be published, and on what terms. Nothing is published without written permission.", addDays(7));
  if (input.askReferral) await task("ask for a referral", "Ask whether the client would introduce Regenera to others it could help.", addDays(21));
  for (const i of check.unpaidInvoices) await task(`collect invoice ${i.number}`, `${i.currency} ${i.outstanding} outstanding at completion.`, addDays(7));
  await audit(db, { actor: by, action: "engagement_completed", entity: "engagements", entityId: engagementId, after: { outstanding: open.length, unpaid: check.unpaidInvoices.length } });
  return { reviewDue, outstanding: open, unpaid: check.unpaidInvoices };
}
