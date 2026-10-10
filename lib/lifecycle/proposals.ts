// Versioned commercial proposals (phase 29A). A draft version can be edited; once sent it is frozen (content hash) and any
// change becomes a new version. Accepting a version locks it as the agreed scope. Recording the agreement creates the
// contract (registered, executed), the engagement (from the accepted version, never from later edits), the delivery
// plan from the template, and moves the opportunity to Signed. Draft services cannot go out on a sent proposal.
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, engagements, offerProposals, offerProposalVersions, services, type ProposalDeliverable, type ProposalPayment } from "@/db/schema";
import { audit } from "@/lib/audit";
import { engagementConflicts } from "@/lib/commercial/engine";
import { registerContract } from "@/lib/contracts/register";
import { instantiateTemplate } from "./delivery";
import { commercialStageOf, recordStage, setDealStage } from "./pipeline";
import { deriveClientRoles } from "./relationships";
import type { FeeStructure } from "./vocab";

type Version = typeof offerProposalVersions.$inferSelect;
export type VersionInput = {
  serviceIds?: string[]; summary?: string; scope?: string; deliverables?: ProposalDeliverable[]; assumptions?: string; exclusions?: string; timeline?: string; responsibilities?: string;
  feeStructure?: FeeStructure; currency?: string; fee?: number | null; monthlyFee?: number | null; months?: number | null; hourlyRate?: number | null; estimatedHours?: number | null;
  paymentSchedule?: ProposalPayment[]; validUntil?: string | null; templateId?: string | null;
};
const CONTENT: (keyof VersionInput)[] = ["serviceIds", "summary", "scope", "deliverables", "assumptions", "exclusions", "timeline", "responsibilities", "feeStructure", "currency", "fee", "monthlyFee", "months", "hourlyRate", "estimatedHours", "paymentSchedule", "validUntil", "templateId"];

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const versionContent = (v: Partial<Version>) => JSON.stringify(CONTENT.map(k => [k, (v as Record<string, unknown>)[k] ?? null]));
/** Total fee the version commits the client to (one currency), or null when hourly with no estimate. */
export function versionTotal(v: Pick<Version, "feeStructure" | "fee" | "monthlyFee" | "months" | "hourlyRate" | "estimatedHours" | "paymentSchedule">) {
  if (v.feeStructure === "retainer") return v.monthlyFee != null && v.months != null ? v.monthlyFee * v.months + (v.fee ?? 0) : null;
  if (v.feeStructure === "hourly") return v.hourlyRate != null && v.estimatedHours != null ? v.hourlyRate * v.estimatedHours : null;
  if (v.feeStructure === "milestone") return v.paymentSchedule.length ? v.paymentSchedule.reduce((a, p) => a + p.amount, 0) : v.fee ?? null;
  return v.fee ?? null;
}

export async function createProposal(db: Db, input: { dealId: string; title: string; owner?: string | null } & VersionInput, by: string) {
  const [deal] = await db.select().from(deals).where(eq(deals.id, input.dealId));
  if (!deal) throw new Error("Opportunity not found");
  const [p] = await db.insert(offerProposals).values({ mandateId: deal.mandateId, dealId: deal.id, orgId: deal.orgId, projectId: deal.projectId, title: input.title, owner: input.owner ?? by, createdBy: by }).returning();
  await db.insert(offerProposalVersions).values({ mandateId: deal.mandateId, proposalId: p.id, version: 1, ...pick(input), createdBy: by });
  await audit(db, { actor: by, action: "proposal_created", entity: "offer_proposals", entityId: p.id, after: { dealId: deal.id } });
  return p;
}
const pick = (i: VersionInput) => Object.fromEntries(CONTENT.filter(k => i[k] !== undefined).map(k => [k, i[k]])) as Partial<typeof offerProposalVersions.$inferInsert>;

export async function versions(db: Db, proposalId: string) {
  return db.select().from(offerProposalVersions).where(eq(offerProposalVersions.proposalId, proposalId)).orderBy(desc(offerProposalVersions.version));
}

/** Edits the latest draft, or starts a new draft version copied from the latest when that one is no longer a draft. */
export async function saveVersion(db: Db, proposalId: string, patch: VersionInput, by: string) {
  const [p] = await db.select().from(offerProposals).where(eq(offerProposals.id, proposalId));
  if (!p) throw new Error("Proposal not found");
  if (["withdrawn", "expired"].includes(p.status)) throw new Error(`This proposal is ${p.status}.`);
  const [latest] = await versions(db, proposalId);
  if (latest.status === "draft") {
    await db.update(offerProposalVersions).set(pick(patch)).where(eq(offerProposalVersions.id, latest.id));
    return { ...latest, ...pick(patch) } as Version;
  }
  const copy = Object.fromEntries(CONTENT.map(k => [k, (latest as Record<string, unknown>)[k]])) as VersionInput;
  const [v] = await db.insert(offerProposalVersions).values({ mandateId: p.mandateId, proposalId, version: latest.version + 1, ...pick({ ...copy, ...patch }), createdBy: by }).returning();
  await db.update(offerProposals).set({ currentVersion: v.version, status: p.status === "accepted" ? "accepted" : "draft", updatedAt: new Date().toISOString() }).where(eq(offerProposals.id, proposalId));
  await audit(db, { actor: by, action: "proposal_new_version", entity: "offer_proposals", entityId: proposalId, after: { version: v.version, base: latest.version } });
  return v;
}

/** What stops a version being sent. */
export async function sendBlockers(db: Db, v: Version) {
  const out: string[] = [];
  if (!v.scope.trim()) out.push("Write the scope.");
  if (!v.deliverables.length) out.push("List at least one deliverable.");
  if (versionTotal(v) == null) out.push("Set the fee for the chosen fee structure.");
  if (!v.validUntil) out.push("Set how long the proposal is valid.");
  if (v.serviceIds.length) {
    const svc = await db.select({ name: services.name, offerStatus: services.offerStatus }).from(services).where(inArray(services.id, v.serviceIds));
    for (const s of svc) if (s.offerStatus !== "approved") out.push(`"${s.name}" is a draft service; approve the offer before it goes to a client.`);
  }
  return out;
}

/** Freezes the latest draft version and records that it was sent (by the owner, outside the OS or via an approved message). */
export async function sendVersion(db: Db, proposalId: string, by: string, now = new Date()) {
  const [latest] = await versions(db, proposalId);
  if (!latest || latest.status !== "draft") throw new Error("There is no draft version to send.");
  const blockers = await sendBlockers(db, latest);
  if (blockers.length) throw new Error(blockers.join(" "));
  const t = now.toISOString();
  await db.update(offerProposalVersions).set({ status: "superseded" }).where(and(eq(offerProposalVersions.proposalId, proposalId), eq(offerProposalVersions.status, "sent")));
  await db.update(offerProposalVersions).set({ status: "sent", sentAt: t, sentBy: by, contentHash: await sha256(versionContent(latest)) }).where(eq(offerProposalVersions.id, latest.id));
  await db.update(offerProposals).set({ status: "sent", currentVersion: latest.version, updatedAt: t }).where(eq(offerProposals.id, proposalId));
  await audit(db, { actor: by, action: "proposal_sent", entity: "offer_proposals", entityId: proposalId, after: { version: latest.version } });
}

/** Records the client's decision on a sent version. Acceptance needs evidence (signed acceptance, email, minutes). */
export async function decideVersion(db: Db, versionId: string, decision: "accepted" | "declined", input: { decidedBy: string; evidence: string }, by: string, now = new Date()) {
  const [v] = await db.select().from(offerProposalVersions).where(eq(offerProposalVersions.id, versionId));
  if (!v) throw new Error("Version not found");
  if (v.status !== "sent") throw new Error("Only the sent version can be accepted or declined.");
  if (v.validUntil && v.validUntil < now.toISOString().slice(0, 10) && decision === "accepted") throw new Error(`This version expired on ${v.validUntil}; send a new version.`);
  if (!input.evidence.trim() || !input.decidedBy.trim()) throw new Error("Record who decided and the evidence.");
  if (v.contentHash && v.contentHash !== await sha256(versionContent(v))) throw new Error("The sent text has changed since it was sent; it cannot be accepted.");
  const t = now.toISOString();
  await db.update(offerProposalVersions).set({ status: decision, decidedAt: t, decidedBy: input.decidedBy, decisionEvidence: input.evidence }).where(eq(offerProposalVersions.id, versionId));
  await db.update(offerProposals).set({ status: decision, acceptedVersionId: decision === "accepted" ? v.id : null, updatedAt: t }).where(eq(offerProposals.id, v.proposalId));
  await audit(db, { actor: by, action: `proposal_${decision}`, entity: "offer_proposals", entityId: v.proposalId, after: { version: v.version, decidedBy: input.decidedBy } });
}

/** Records the agreement on the accepted version: contract, engagement, delivery plan, Signed. Idempotent per proposal. */
export async function recordAgreement(db: Db, proposalId: string, input: { executionDate: string; evidence: string; documentId?: string | null; startDate?: string | null; templateId?: string | null }, by: string) {
  const [p] = await db.select().from(offerProposals).where(eq(offerProposals.id, proposalId));
  if (!p) throw new Error("Proposal not found");
  if (p.engagementId) return { proposal: p, engagementId: p.engagementId, contractId: p.contractId! };
  if (!p.acceptedVersionId) throw new Error("No accepted version: record the client's acceptance first.");
  if (!input.evidence.trim()) throw new Error("Record the signed agreement evidence (signed copy, e-signature reference or documented confirmation).");
  const [v] = await db.select().from(offerProposalVersions).where(eq(offerProposalVersions.id, p.acceptedVersionId));
  const [deal] = await db.select().from(deals).where(eq(deals.id, p.dealId));
  const total = versionTotal(v);
  const contract = await registerContract(db, {
    mandateId: p.mandateId, projectId: p.projectId, category: "regenera_commercial", contractType: "advisory", title: `${p.title} (v${v.version})`,
    summary: `Agreed scope: proposal version ${v.version} accepted by ${v.decidedBy} on ${v.decidedAt?.slice(0, 10)}. Evidence: ${input.evidence}\n\n${v.scope}`,
    executionDate: input.executionDate, effectiveDate: input.startDate ?? input.executionDate, value: total, currency: v.currency, lifecycle: "effective", documentId: input.documentId ?? null,
  }, by);
  const schedule = v.paymentSchedule.map(x => ({ id: crypto.randomUUID(), label: `${x.label} (${x.trigger})`, amount: x.amount, due: null }));
  const [e] = await db.insert(engagements).values({
    mandateId: p.mandateId, name: p.title, orgId: p.orgId, projectId: p.projectId, dealId: p.dealId, contractId: contract.id, status: "contracting",
    source: deal?.source ?? "", scope: v.scope, assumptions: v.assumptions, exclusions: v.exclusions, clientResponsibilities: v.responsibilities,
    workstreams: v.serviceIds.length ? (await db.select({ key: services.key }).from(services).where(inArray(services.id, v.serviceIds))).map(s => s.key) : [],
    paymentSchedule: schedule, currency: v.currency, fee: v.feeStructure === "retainer" ? v.fee ?? 0 : total ?? 0, monthlyFee: v.monthlyFee ?? 0, months: v.months ?? 0,
    billingType: v.feeStructure === "retainer" ? "monthly_retainer" : v.feeStructure === "milestone" ? "milestone" : v.feeStructure === "hourly" ? "time_materials" : "fixed",
    startDate: input.startDate ?? null, owner: p.owner ?? by, proposalId: p.id, acceptedVersionId: v.id,
  }).returning();
  const conflicts = await engagementConflicts(db, e);
  await db.update(engagements).set({ conflictStatus: conflicts.status, conflictNote: conflicts.issues.map(i => i.detail).join("; ") }).where(eq(engagements.id, e.id));
  const templateId = input.templateId ?? v.templateId;
  if (templateId) await instantiateTemplate(db, e.id, templateId, input.startDate ?? input.executionDate, by);
  await db.update(offerProposals).set({ contractId: contract.id, engagementId: e.id, updatedAt: new Date().toISOString() }).where(eq(offerProposals.id, p.id));
  // Other open versions of this proposal can no longer be accepted.
  await db.update(offerProposalVersions).set({ status: "superseded" }).where(and(eq(offerProposalVersions.proposalId, p.id), ne(offerProposalVersions.id, v.id), inArray(offerProposalVersions.status, ["draft", "sent"])));
  if (deal) {
    const from = commercialStageOf(deal);
    await setDealStage(db, deal, "signed", by);
    await recordStage(db, { mandateId: deal.mandateId, pipeline: "commercial", entityType: "deal", entityId: deal.id, from, to: "signed", reason: `Agreement recorded on proposal v${v.version}`, evidence: input.evidence, by });
  }
  if (p.orgId) await deriveClientRoles(db, p.mandateId, p.orgId, by);
  await audit(db, { actor: by, action: "agreement_recorded", entity: "offer_proposals", entityId: p.id, after: { contractId: contract.id, engagementId: e.id, version: v.version } });
  return { proposal: p, engagementId: e.id, contractId: contract.id };
}
