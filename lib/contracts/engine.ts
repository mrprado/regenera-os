// Contracts per engagement (docs/plans/phase-5.md part E): create from a deal or partner, edit with versions,
// send and sign with guardrails, milestones, and alerts for signatures, renewals and payments due.
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, contractMilestones, contracts, contractVersions, deals, mandates, organizations, partners, type ContractTerms } from "@/db/schema";
import { audit } from "@/lib/audit";
import { advanceDeal } from "@/lib/crm/deals";
import { TIER_FEE } from "@/lib/crm/partners";
import type { FEE_TYPES } from "@/lib/vocab";
import { CONTRACT_KIND_LABEL, counselRequired, feeSummary, openGaps, renderContract, TO_CONFIRM, type ContractKind, type EngagementKey } from "./templates";

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000));
const addMonths = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return day(d); };
const num = (v?: string) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

export const REGENERA_SIGNATORY = { signatoryName: "Alan Prado", signatoryTitle: "Founder" };

type CreateInput = { mandateId: string; kind: ContractKind; dealId?: string | null; partnerId?: string | null; actor: string; now?: Date };

/** Drafts a contract from a deal (engagement letter, SOW, NDA, amendment) or a partner (referral agreement). */
export async function createContract(db: Db, input: CreateInput) {
  const now = input.now ?? new Date();
  const [mandate] = await db.select({ type: mandates.type }).from(mandates).where(eq(mandates.id, input.mandateId));
  const [deal] = input.dealId ? await db.select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.mandateId, input.mandateId))) : [];
  const [partner] = input.partnerId ? await db.select().from(partners).where(and(eq(partners.id, input.partnerId), eq(partners.mandateId, input.mandateId))) : [];
  if (input.kind === "referral_agreement" ? !partner : !deal) throw new Error(input.kind === "referral_agreement" ? "Partner not found" : "Deal not found");

  const orgId = deal?.orgId ?? partner?.orgId ?? null;
  const [org] = orgId ? await db.select({ name: organizations.name, location: organizations.location }).from(organizations).where(eq(organizations.id, orgId)) : [];
  const [contact] = deal?.contactId ? await db.select({ fullName: contacts.fullName, title: contacts.title, email: contacts.email }).from(contacts).where(eq(contacts.id, deal.contactId)) : [];

  const engagement = (deal?.engagement ?? "diagnostic") as EngagementKey;
  const feeType = (deal?.feeType ?? "one_time") as keyof typeof FEE_TYPES;
  const currency = "USD";
  const terms: ContractTerms = {
    currency,
    feeSummary: input.kind === "referral_agreement"
      ? `${Math.round((TIER_FEE[partner!.tier] ?? 0.1) * 100)}% (${partner!.tier} tier)`
      : feeSummary(feeType, deal?.feeTerms ?? {}, currency),
    paymentDays: 30,
    termMonths: engagement === "development_office" || engagement === "governance_monitoring" || feeType === "monthly_retainer" ? 12 : input.kind === "nda" ? 24 : null,
    noticeDays: 30,
    autoRenew: feeType === "monthly_retainer",
    governingLaw: TO_CONFIRM,
    counterparty: {
      name: org?.name ?? partner?.organization ?? partner?.name ?? TO_CONFIRM,
      address: org?.location ?? "",
      signatoryName: contact?.fullName ?? (partner ? partner.name : ""),
      signatoryTitle: contact?.title ?? "",
      signatoryEmail: contact?.email ?? partner?.email ?? "",
    },
    regenera: REGENERA_SIGNATORY,
  };
  const project = deal?.name ?? TO_CONFIRM;
  const body = renderContract({ kind: input.kind, engagement, feeType, project, terms, effectiveDate: null, today: day(now) });
  const title = input.kind === "referral_agreement" ? `${CONTRACT_KIND_LABEL[input.kind]}: ${terms.counterparty.name}` : `${CONTRACT_KIND_LABEL[input.kind]}: ${deal!.name}`;
  const value = input.kind === "engagement_letter" || input.kind === "sow"
    ? deal?.valueEstimate ?? num(deal?.feeTerms?.flatFee) ?? (deal?.monthlyValue ? deal.monthlyValue * (terms.termMonths ?? 12) : null)
    : null;

  const [row] = await db.insert(contracts).values({
    mandateId: input.mandateId, dealId: deal?.id ?? null, orgId, kind: input.kind, engagement: deal ? engagement : null, title, body, terms, value,
    counselRequired: counselRequired({ kind: input.kind, feeType, engagement, mandateType: mandate?.type }), createdBy: input.actor,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }).returning();
  await db.insert(contractVersions).values({ contractId: row.id, version: 1, body, terms, note: "Drafted from template", createdBy: input.actor });
  if (deal) await db.insert(activities).values({ mandateId: input.mandateId, dealId: deal.id, orgId, type: "note", detail: `Contract drafted: ${title}`, source: "manual", actor: input.actor });
  await audit(db, { actor: input.actor, action: "contract_created", entity: "contracts", entityId: row.id, after: { kind: input.kind, dealId: deal?.id, partnerId: partner?.id } });
  return row;
}

type Editable = { title?: string; body?: string; terms?: ContractTerms; value?: number | null; effectiveDate?: string | null; endDate?: string | null; signedCopyUrl?: string | null };

/** Saves an edit. Body or terms changes create a new version; a signed contract is changed by an amendment instead. */
export async function updateContract(db: Db, id: string, patch: Editable, actor: string, note = "") {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw new Error("Contract not found");
  const textChanged = (patch.body !== undefined && patch.body !== c.body) || (patch.terms !== undefined && JSON.stringify(patch.terms) !== JSON.stringify(c.terms));
  if (textChanged && c.status !== "draft") throw new Error("Only drafts can be edited. Draft an amendment for a sent or signed contract.");
  const version = textChanged ? c.version + 1 : c.version;
  await db.update(contracts).set({ ...patch, version, updatedAt: new Date().toISOString() }).where(eq(contracts.id, id));
  if (textChanged) await db.insert(contractVersions).values({ contractId: id, version, body: patch.body ?? c.body, terms: patch.terms ?? c.terms, note, createdBy: actor });
  return version;
}

/** Rebuilds a draft's text from its template and current terms. Manual text edits are replaced (a version is kept). */
export async function regenerateBody(db: Db, id: string, actor: string, now = new Date()) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw new Error("Contract not found");
  if (c.kind === "registered") throw new Error("Registered agreements are not generated from a template.");
  const [deal] = c.dealId ? await db.select({ name: deals.name, feeType: deals.feeType }).from(deals).where(eq(deals.id, c.dealId)) : [];
  const body = renderContract({
    kind: c.kind, engagement: (c.engagement ?? "diagnostic") as EngagementKey, feeType: (deal?.feeType ?? "one_time") as keyof typeof FEE_TYPES,
    project: deal?.name ?? TO_CONFIRM, terms: c.terms, effectiveDate: c.effectiveDate, today: day(now),
  });
  return updateContract(db, id, { body }, actor, "Rebuilt from template and terms");
}

export async function recordCounselReview(db: Db, id: string, actor: string, now = new Date()) {
  await db.update(contracts).set({ counselReviewedAt: now.toISOString(), counselReviewedBy: actor, updatedAt: now.toISOString() }).where(eq(contracts.id, id));
  await audit(db, { actor, action: "contract_counsel_reviewed", entity: "contracts", entityId: id });
}

/** Why a contract cannot be sent yet, or null when it can. */
export function sendBlockers(c: { status: string; body: string; counselRequired: boolean; counselReviewedAt: string | null }) {
  const out: string[] = [];
  if (c.status !== "draft") out.push("Only drafts can be marked sent.");
  if (c.counselRequired && !c.counselReviewedAt) out.push("Counsel review is required first (success fee, equity, capital work or an investment mandate).");
  const gaps = openGaps(c.body);
  if (gaps) out.push(`${gaps} ${TO_CONFIRM} gap${gaps === 1 ? "" : "s"} left in the text.`);
  if (c.body.includes("Template: review by counsel is required")) out.push("Remove the template note at the top.");
  return out.length ? out : null;
}

export async function markSent(db: Db, id: string, actor: string, now = new Date()) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw new Error("Contract not found");
  const blockers = sendBlockers(c);
  if (blockers) throw new Error(blockers.join(" "));
  await db.update(contracts).set({ status: "sent", lifecycle: "signature", sentAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(contracts.id, id));
  if (c.dealId) await advanceDeal(db, { mandateId: c.mandateId, orgId: c.orgId, contactId: null, dealId: c.dealId, to: "proposal", actor, source: "manual", reason: `${c.title} sent`, now });
  await audit(db, { actor, action: "contract_sent", entity: "contracts", entityId: id });
}

/** Records the signature. Sets effective and end dates, and moves the deal to Signed. */
export async function markSigned(db: Db, id: string, input: { signedAt: string; signedCopyUrl?: string | null; effectiveDate?: string | null }, actor: string, now = new Date()) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw new Error("Contract not found");
  if (c.status !== "sent" && c.status !== "draft") throw new Error("This contract is already signed or closed.");
  if (c.counselRequired && !c.counselReviewedAt) throw new Error("Counsel review is required before signing.");
  const effectiveDate = input.effectiveDate || c.effectiveDate || input.signedAt;
  const endDate = c.endDate ?? (c.terms.termMonths ? addDays(addMonths(effectiveDate, c.terms.termMonths), -1) : null);
  await db.update(contracts).set({
    status: "signed", lifecycle: "active", lockedAt: now.toISOString(), executionDate: input.signedAt, signedAt: input.signedAt, effectiveDate, endDate, signedCopyUrl: input.signedCopyUrl ?? c.signedCopyUrl,
    sentAt: c.sentAt ?? now.toISOString(), updatedAt: now.toISOString(),
  }).where(eq(contracts.id, id));
  if (c.dealId && (c.kind === "engagement_letter" || c.kind === "sow")) {
    await advanceDeal(db, { mandateId: c.mandateId, orgId: c.orgId, contactId: null, dealId: c.dealId, to: "signed", actor, source: "manual", reason: `${c.title} signed ${input.signedAt}`, now });
  }
  await audit(db, { actor, action: "contract_signed", entity: "contracts", entityId: id, after: { signedAt: input.signedAt, endDate } });
  return { effectiveDate, endDate };
}

export async function closeContract(db: Db, id: string, to: "completed" | "terminated", actor: string, now = new Date()) {
  await db.update(contracts).set({ status: to, lifecycle: to === "completed" ? "expired" : "terminated", updatedAt: now.toISOString() }).where(eq(contracts.id, id));
  await audit(db, { actor, action: `contract_${to}`, entity: "contracts", entityId: id });
}

export async function addMilestone(db: Db, contractId: string, m: { title: string; dueDate: string | null; amount: number | null }) {
  const [c] = await db.select({ mandateId: contracts.mandateId, terms: contracts.terms }).from(contracts).where(eq(contracts.id, contractId));
  if (!c) throw new Error("Contract not found");
  await db.insert(contractMilestones).values({ contractId, mandateId: c.mandateId, title: m.title, dueDate: m.dueDate, amount: m.amount, currency: c.terms.currency });
}

export async function setMilestoneStatus(db: Db, id: string, status: "pending" | "invoiced" | "paid" | "waived", now = new Date()) {
  const today = day(now);
  await db.update(contractMilestones).set({
    status, updatedAt: now.toISOString(),
    ...(status === "invoiced" ? { invoicedAt: today } : {}), ...(status === "paid" ? { paidAt: today } : {}),
  }).where(eq(contractMilestones.id, id));
}

/** Monthly retainers: one milestone per month of the term, from the effective date. */
export async function scheduleRetainer(db: Db, contractId: string, monthly: number) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c?.effectiveDate) throw new Error("Set the effective date (sign the contract) first.");
  const months = c.terms.termMonths ?? 12;
  for (let i = 0; i < months; i++) await addMilestone(db, contractId, { title: `Retainer, month ${i + 1}`, dueDate: addMonths(c.effectiveDate, i), amount: monthly });
  return months;
}

export type ContractAlerts = {
  awaitingSignature: { id: string; title: string; sentAt: string; days: number }[];
  renewals: { id: string; title: string; endDate: string; noticeBy: string; autoRenew: boolean }[];
  milestonesDue: { id: string; contractId: string; title: string; contractTitle: string; dueDate: string; amount: number | null; currency: string; overdue: boolean }[];
};

/** Signatures waiting over 7 days, renewals within 45 days of their notice date, milestones due within 7 days. */
export async function contractAlerts(db: Db, mandateIds: string[] | null, now = new Date()): Promise<ContractAlerts> {
  const today = day(now);
  const inScope = <T extends typeof contracts.mandateId | typeof contractMilestones.mandateId>(col: T) => (mandateIds ? inArray(col, mandateIds.length ? mandateIds : ["-"]) : sql`1 = 1`);
  const sent = await db.select().from(contracts).where(and(inScope(contracts.mandateId), eq(contracts.status, "sent")));
  const signed = await db.select().from(contracts).where(and(inScope(contracts.mandateId), eq(contracts.status, "signed"), lte(contracts.endDate, addDays(today, 90))));
  const due = await db.select({ m: contractMilestones, contractTitle: contracts.title }).from(contractMilestones)
    .innerJoin(contracts, eq(contracts.id, contractMilestones.contractId))
    .where(and(inScope(contractMilestones.mandateId), inArray(contractMilestones.status, ["pending", "invoiced"]), lte(contractMilestones.dueDate, addDays(today, 7))))
    .orderBy(asc(contractMilestones.dueDate));
  const daysSince = (iso: string) => Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  return {
    awaitingSignature: sent.filter(c => c.sentAt && daysSince(c.sentAt) >= 7).map(c => ({ id: c.id, title: c.title, sentAt: c.sentAt!.slice(0, 10), days: daysSince(c.sentAt!) })),
    renewals: signed.filter(c => c.endDate).map(c => ({ id: c.id, title: c.title, endDate: c.endDate!, noticeBy: addDays(c.endDate!, -c.terms.noticeDays), autoRenew: c.terms.autoRenew }))
      .filter(r => r.noticeBy <= addDays(today, 45)),
    milestonesDue: due.filter(d => d.m.dueDate).map(d => ({ id: d.m.id, contractId: d.m.contractId, title: d.m.title, contractTitle: d.contractTitle, dueDate: d.m.dueDate!, amount: d.m.amount, currency: d.m.currency, overdue: d.m.dueDate! < today })),
  };
}
