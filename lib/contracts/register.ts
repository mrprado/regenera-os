// Agreement register (docs/plans/phase-6.md M3): record any project or third-party agreement, its parties, key terms
// and obligations; lock executed versions; roll recurring obligations forward; alerts and CSV registers.
// The OS organizes and flags. It does not interpret contracts or replace counsel.
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { contractObligations, contractParties, contracts, contractVersions, documentLinks, documents, type KeyTerms } from "@/db/schema";
import { audit } from "@/lib/audit";
import { EXECUTED, REVIEW_TYPES, typeLabel, type Lifecycle } from "./catalog";

const day = (d: Date) => d.toISOString().slice(0, 10);
const omit = <T extends object, K extends keyof T>(o: T, ...drop: K[]) => { const c = { ...o }; for (const k of drop) delete c[k]; return c as Omit<T, K>; };
const addMonths = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return day(d); };

export type RegisterInput = {
  mandateId: string; projectId?: string | null; category: string; contractType: string; title?: string; summary?: string;
  governingLaw?: string | null; forum?: string | null; executionDate?: string | null; effectiveDate?: string | null; endDate?: string | null;
  renewalTerms?: string; value?: number | null; currency?: string; lifecycle?: Lifecycle; keyTerms?: KeyTerms; documentId?: string | null;
  parentContractId?: string | null; parties?: { name: string; role: typeof contractParties.$inferInsert.role; orgId?: string | null; contactId?: string | null }[];
};

/** Registers an agreement. Compensation tied to capital (capital advisory, success fee, referral) flags a review. */
export async function registerContract(db: Db, input: RegisterInput, actor: string, now = new Date()) {
  const lifecycle = input.lifecycle ?? "draft";
  const title = input.title?.trim() || typeLabel(input.category, input.contractType);
  const body = input.summary?.trim() || "";
  const [c] = await db.insert(contracts).values({
    mandateId: input.mandateId, projectId: input.projectId ?? null, kind: "registered", category: input.category, contractType: input.contractType, title, body,
    terms: { currency: input.currency ?? "USD", feeSummary: "", paymentDays: 30, termMonths: null, noticeDays: 30, autoRenew: false, governingLaw: input.governingLaw ?? "", counterparty: { name: "", address: "", signatoryName: "", signatoryTitle: "", signatoryEmail: "" }, regenera: { signatoryName: "", signatoryTitle: "" } },
    status: EXECUTED.includes(lifecycle) ? "signed" : "draft", lifecycle, governingLaw: input.governingLaw ?? null, forum: input.forum ?? null,
    executionDate: input.executionDate ?? null, effectiveDate: input.effectiveDate ?? null, endDate: input.endDate ?? null, renewalTerms: input.renewalTerms ?? "",
    value: input.value ?? null, keyTerms: input.keyTerms ?? {}, documentId: input.documentId ?? null, parentContractId: input.parentContractId ?? null,
    lockedAt: EXECUTED.includes(lifecycle) ? now.toISOString() : null, reviewRequired: REVIEW_TYPES.has(input.contractType), createdBy: actor,
    signedAt: input.executionDate ?? null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }).returning();
  await db.insert(contractVersions).values({ contractId: c.id, version: 1, body, terms: c.terms, note: "Registered", createdBy: actor });
  for (const p of input.parties ?? []) await db.insert(contractParties).values({ contractId: c.id, mandateId: input.mandateId, name: p.name, role: p.role, orgId: p.orgId ?? null, contactId: p.contactId ?? null });
  if (input.documentId) await linkDocument(db, input.documentId, input.mandateId, "contract", c.id);
  await audit(db, { actor, action: "contract_registered", entity: "contracts", entityId: c.id, after: { category: input.category, type: input.contractType, lifecycle } });
  return c;
}

/** Moves a registered agreement through its lifecycle. Reaching an executed state locks the text and key terms. */
export async function setLifecycle(db: Db, id: string, to: Lifecycle, actor: string, now = new Date()) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw new Error("Contract not found");
  if (c.lockedAt && !EXECUTED.includes(to)) throw new Error("An executed agreement cannot go back to a pre-execution state. Register an amendment instead.");
  const lock = EXECUTED.includes(to) && !c.lockedAt;
  await db.update(contracts).set({
    lifecycle: to, ...(lock ? { lockedAt: now.toISOString() } : {}),
    status: to === "terminated" ? "terminated" : to === "expired" || to === "archived" ? "completed" : EXECUTED.includes(to) ? "signed" : to === "signature" ? "sent" : "draft",
    updatedAt: now.toISOString(),
  }).where(eq(contracts.id, id));
  await audit(db, { actor, action: "contract_lifecycle", entity: "contracts", entityId: id, before: { lifecycle: c.lifecycle }, after: { lifecycle: to } });
}

/** Edits key terms and summary. Locked (executed) agreements refuse: changes are amendments. */
export async function updateKeyTerms(db: Db, id: string, patch: { summary?: string; keyTerms?: KeyTerms }, actor: string, note = "") {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw new Error("Contract not found");
  if (c.lockedAt) throw new Error("This agreement is executed and locked. Register an amendment to record changes.");
  const version = c.version + 1;
  await db.update(contracts).set({ body: patch.summary ?? c.body, keyTerms: patch.keyTerms ?? c.keyTerms, version, updatedAt: new Date().toISOString() }).where(eq(contracts.id, id));
  await db.insert(contractVersions).values({ contractId: id, version, body: patch.summary ?? c.body, terms: c.terms, note, createdBy: actor });
  return version;
}

/** Registers an amendment to an executed agreement and marks the original as Amended. */
export async function registerAmendment(db: Db, parentId: string, input: { title?: string; summary: string; executionDate?: string | null; lifecycle?: Lifecycle }, actor: string) {
  const [p] = await db.select().from(contracts).where(eq(contracts.id, parentId));
  if (!p) throw new Error("Contract not found");
  const a = await registerContract(db, {
    mandateId: p.mandateId, projectId: p.projectId, category: p.category ?? "regenera_commercial", contractType: "amendment", title: input.title || `Amendment to ${p.title}`,
    summary: input.summary, executionDate: input.executionDate ?? null, governingLaw: p.governingLaw, forum: p.forum, lifecycle: input.lifecycle ?? "draft", parentContractId: parentId,
  }, actor);
  if (EXECUTED.includes(input.lifecycle ?? "draft")) await db.update(contracts).set({ lifecycle: "amended", updatedAt: new Date().toISOString() }).where(eq(contracts.id, parentId));
  return a;
}

export async function addObligation(db: Db, contractId: string, o: Omit<typeof contractObligations.$inferInsert, "id" | "contractId" | "mandateId" | "projectId">) {
  const [c] = await db.select({ mandateId: contracts.mandateId, projectId: contracts.projectId }).from(contracts).where(eq(contracts.id, contractId));
  if (!c) throw new Error("Contract not found");
  const [row] = await db.insert(contractObligations).values({ ...o, contractId, mandateId: c.mandateId, projectId: c.projectId }).returning();
  return row;
}

const STEP: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Completes an obligation with evidence. A recurring obligation creates its next occurrence. */
export async function completeObligation(db: Db, id: string, input: { status: "done" | "waived" | "missed"; evidence?: string }, actor: string, now = new Date()) {
  const [o] = await db.select().from(contractObligations).where(eq(contractObligations.id, id));
  if (!o) throw new Error("Obligation not found");
  if (input.status === "done" && o.evidenceRequired && !input.evidence?.trim()) throw new Error(`Evidence required: ${o.evidenceRequired}`);
  await db.update(contractObligations).set({ status: input.status, completedAt: now.toISOString(), completionEvidence: input.evidence ?? "", updatedAt: now.toISOString() }).where(eq(contractObligations.id, id));
  await audit(db, { actor, action: `obligation_${input.status}`, entity: "contract_obligations", entityId: id, after: { evidence: input.evidence } });
  if (o.recurrence !== "none" && o.dueDate) {
    const rest = omit(o, "id", "createdAt", "updatedAt", "completedAt", "completionEvidence", "status");
    const [next] = await db.insert(contractObligations).values({ ...rest, dueDate: addMonths(o.dueDate, STEP[o.recurrence]), status: "open" }).returning();
    return next;
  }
  return null;
}

export type ObligationAlerts = {
  due: { id: string; contractId: string; contractTitle: string; obligation: string; responsibleParty: string; dueDate: string; overdue: boolean; riskIfMissed: string }[];
  expiring: { id: string; title: string; endDate: string; lifecycle: string }[];
  reviews: { id: string; title: string }[];
};

/** Obligations due within 14 days or overdue; registered agreements expiring within 90 days; agreements awaiting a compensation review. */
export async function obligationAlerts(db: Db, mandateIds: string[] | null, now = new Date()): Promise<ObligationAlerts> {
  const scope = (col: typeof contracts.mandateId | typeof contractObligations.mandateId) => (mandateIds ? inArray(col, mandateIds.length ? mandateIds : ["-"]) : sql`1 = 1`);
  const today = day(now);
  const in14 = day(new Date(now.getTime() + 14 * 86_400_000));
  const in90 = day(new Date(now.getTime() + 90 * 86_400_000));
  const due = await db.select({ o: contractObligations, title: contracts.title }).from(contractObligations).innerJoin(contracts, eq(contracts.id, contractObligations.contractId))
    .where(and(scope(contractObligations.mandateId), inArray(contractObligations.status, ["open", "in_progress"]), lte(contractObligations.dueDate, in14))).orderBy(asc(contractObligations.dueDate)).limit(40);
  const expiring = await db.select({ id: contracts.id, title: contracts.title, endDate: contracts.endDate, lifecycle: contracts.lifecycle }).from(contracts)
    .where(and(scope(contracts.mandateId), eq(contracts.kind, "registered"), inArray(contracts.lifecycle, ["effective", "active", "amended", "renewal"]), lte(contracts.endDate, in90))).orderBy(asc(contracts.endDate)).limit(20);
  const reviews = await db.select({ id: contracts.id, title: contracts.title }).from(contracts).where(and(scope(contracts.mandateId), eq(contracts.reviewRequired, true))).limit(20);
  return {
    due: due.filter(d => d.o.dueDate).map(d => ({ id: d.o.id, contractId: d.o.contractId, contractTitle: d.title, obligation: d.o.obligation, responsibleParty: d.o.responsibleParty, dueDate: d.o.dueDate!, overdue: d.o.dueDate! < today, riskIfMissed: d.o.riskIfMissed })),
    expiring: expiring.filter(e => e.endDate).map(e => ({ id: e.id, title: e.title, endDate: e.endDate!, lifecycle: e.lifecycle })),
    reviews,
  };
}

export async function linkDocument(db: Db, documentId: string, mandateId: string, entity: string, entityId: string) {
  await db.insert(documentLinks).values({ documentId, mandateId, entity, entityId }).onConflictDoNothing();
}

/** Registers a new document version: the previous version is marked Superseded, never overwritten. */
export async function newDocumentVersion(db: Db, previousId: string, input: { version: string; url?: string | null; status?: typeof documents.$inferInsert.status }, actor: string) {
  const [p] = await db.select().from(documents).where(eq(documents.id, previousId));
  if (!p) throw new Error("Document not found");
  const rest = omit(p, "id", "createdAt", "updatedAt");
  const [d] = await db.insert(documents).values({ ...rest, version: input.version, url: input.url ?? p.url, status: input.status ?? "draft", supersedesId: previousId }).returning();
  await db.update(documents).set({ status: "superseded", updatedAt: new Date().toISOString() }).where(eq(documents.id, previousId));
  const links = await db.select().from(documentLinks).where(eq(documentLinks.documentId, previousId));
  for (const l of links) await linkDocument(db, d.id, l.mandateId, l.entity, l.entityId);
  await audit(db, { actor, action: "document_version", entity: "documents", entityId: d.id, after: { supersedes: previousId, version: input.version } });
  return d;
}

const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map(r => r.map(cell).join(",")).join("\n") + "\n";
