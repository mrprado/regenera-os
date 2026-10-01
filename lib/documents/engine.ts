// Document generation (master build instruction §27–30): fill a template or build a report, keep every version,
// approve legal review, render branded PDF or DOCX, and route signature through an e-sign provider interface.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { esignEnvelopes, generatedDocuments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { contractPdf } from "@/lib/contracts/pdf";
import { docxFromMarkdown } from "./docx";
import { fillTemplate, openPlaceholders, TEMPLATES } from "./library";
import { reportMarkdown } from "./reports";
import { commercialMarkdown } from "./commercial";

export const DRAFT_MARK = "DRAFT — COUNSEL REVIEW REQUIRED";
type Doc = typeof generatedDocuments.$inferSelect;

export async function generateDocument(db: Db, input: { mandateId: string; templateKey: string; entityType?: string | null; entityId?: string | null; values?: Record<string, string> }, actor: string, today = new Date().toISOString().slice(0, 10)) {
  const t = TEMPLATES.find(x => x.key === input.templateKey);
  if (!t) throw new Error("Unknown template");
  let title = t.name, body: string;
  if (t.group === "Reports" || t.group === "Commercial") {
    if (!input.entityId) throw new Error(`${t.name} needs a ${t.entity}`);
    const r = t.group === "Commercial" ? await commercialMarkdown(db, t.key, input.entityId, today) : await reportMarkdown(db, t.key, input.entityId, today);
    if (!r) throw new Error("Nothing to report on");
    title = r.title; body = r.md;
  } else {
    body = fillTemplate(t, input.values ?? {});
    title = `${t.name}${input.values?.counterparty ? `: ${input.values.counterparty}` : input.values?.project ? `: ${input.values.project}` : ""}`;
  }
  if (t.legal) body = `> ${DRAFT_MARK}\n\n${body}`;
  const [d] = await db.insert(generatedDocuments).values({
    mandateId: input.mandateId, templateKey: t.key, title, entityType: input.entityType ?? null, entityId: input.entityId ?? null, values: input.values ?? {}, body,
    legal: t.legal, legalReviewStatus: t.legal ? "pending" : "not_required", createdBy: actor,
  }).returning();
  await audit(db, { actor, action: "document_generated", entity: "generated_documents", entityId: d.id, after: { template: t.key, title } });
  return d;
}

/** A new version from edited values; the previous one is kept, and legal review starts again. */
export async function newVersion(db: Db, id: string, values: Record<string, string>, actor: string) {
  const [prev] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, id));
  if (!prev) throw new Error("Document not found");
  const [signed] = await db.select({ id: esignEnvelopes.id }).from(esignEnvelopes).where(and(eq(esignEnvelopes.generatedId, id), eq(esignEnvelopes.status, "completed")));
  const t = TEMPLATES.find(x => x.key === prev.templateKey)!;
  const d = await generateDocument(db, { mandateId: prev.mandateId, templateKey: prev.templateKey, entityType: prev.entityType, entityId: prev.entityId, values: { ...prev.values, ...values } }, actor);
  await db.update(generatedDocuments).set({ version: prev.version + 1, previousId: prev.id }).where(eq(generatedDocuments.id, d.id));
  return { ...d, version: prev.version + 1, previousId: prev.id, signedPrevious: !!signed, legal: t.legal };
}

/** Records counsel's approval. Refused while placeholders remain open. */
export async function approveLegal(db: Db, id: string, reviewer: string, actor: string, now = new Date()) {
  const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, id));
  if (!d) throw new Error("Document not found");
  if (!d.legal) throw new Error("Not a legal document");
  const open = openPlaceholders(d.body);
  if (open.length) throw new Error(`Complete the open items first: ${open.join(", ")}`);
  if (!reviewer.trim()) throw new Error("Name the reviewing counsel");
  await db.update(generatedDocuments).set({ legalReviewStatus: "approved", reviewedBy: reviewer.trim(), reviewedAt: now.toISOString(), body: d.body.replace(`> ${DRAFT_MARK}\n\n`, `> Counsel reviewed: ${reviewer.trim()}, ${now.toISOString().slice(0, 10)}. Version ${d.version}.\n\n`) }).where(eq(generatedDocuments.id, id));
  await audit(db, { actor, action: "legal_review_approved", entity: "generated_documents", entityId: id, after: { reviewer } });
}

export async function renderDocument(d: Doc, format: "pdf" | "docx") {
  const meta = {
    kicker: d.legal ? (d.legalReviewStatus === "approved" ? "Counsel-reviewed document" : "Template for counsel review") : "Regenera report",
    shortTitle: d.title, status: d.legal ? (d.legalReviewStatus === "approved" ? `Approved v${d.version}` : `Draft v${d.version}`) : `v${d.version}`,
    date: d.createdAt.slice(0, 10), watermark: d.legal && d.legalReviewStatus !== "approved" ? DRAFT_MARK : undefined, code: d.id.slice(0, 8).toUpperCase(),
  };
  return format === "pdf" ? contractPdf(d.body, meta) : docxFromMarkdown(d.body, meta);
}

// ---------- E-signature (§30): provider interface, mock provider, adapters awaiting credentials ----------
export type Recipient = { name: string; email: string; role: string };
export interface ESignProvider {
  key: string;
  createEnvelope(db: Db, doc: Doc, recipients: Recipient[], actor: string): Promise<string>;
  send(db: Db, envelopeId: string, actor: string): Promise<void>;
  getStatus(db: Db, envelopeId: string): Promise<string>;
}

async function pushEvent(db: Db, id: string, event: string, by: string, patch: Partial<typeof esignEnvelopes.$inferInsert> = {}) {
  const [e] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, id));
  if (!e) throw new Error("Envelope not found");
  await db.update(esignEnvelopes).set({ ...patch, events: [...e.events, { at: new Date().toISOString(), event, by }], updatedAt: new Date().toISOString() }).where(eq(esignEnvelopes.id, id));
}

/** Development / demo provider: nothing leaves the OS; a person marks each signature. */
export const MockESignProvider: ESignProvider & { recordSignature(db: Db, envelopeId: string, email: string, actor: string): Promise<void> } = {
  key: "mock",
  async createEnvelope(db, doc, recipients, actor) {
    const [e] = await db.insert(esignEnvelopes).values({ mandateId: doc.mandateId, generatedId: doc.id, provider: "mock", recipients: recipients.map(r => ({ ...r, signedAt: null })), createdBy: actor }).returning({ id: esignEnvelopes.id });
    await pushEvent(db, e.id, "created", actor);
    return e.id;
  },
  async send(db, id, actor) { await pushEvent(db, id, "sent (mock: nothing emailed)", actor, { status: "sent" }); },
  async getStatus(db, id) { const [e] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, id)); return e?.status ?? "unknown"; },
  async recordSignature(db, id, email, actor) {
    const [e] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, id));
    if (!e || e.status !== "sent") throw new Error("Envelope is not out for signature");
    const recipients = e.recipients.map(r => (r.email === email ? { ...r, signedAt: new Date().toISOString() } : r));
    const done = recipients.every(r => r.signedAt);
    await pushEvent(db, id, `signed by ${email}`, actor, { recipients, status: done ? "completed" : "sent" });
  },
};

const credentialOnly = (key: string, envVar: string): ESignProvider => ({
  key,
  createEnvelope: async () => { throw new Error(`${key}: integration ready, credential required (${envVar}); use the mock provider or upload the signed PDF`); },
  send: async () => { throw new Error(`${key}: not configured`); },
  getStatus: async () => "not configured",
});
export const ESIGN_PROVIDERS: Record<string, ESignProvider> = { mock: MockESignProvider, docusign: credentialOnly("docusign", "DOCUSIGN_CLIENT_ID"), dropbox_sign: credentialOnly("dropbox_sign", "DROPBOX_SIGN_API_KEY") };

/** Sending for signature: legal documents need counsel's approval and no open placeholders. */
export async function startSignature(db: Db, docId: string, recipients: Recipient[], providerKey: string, actor: string) {
  const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, docId));
  if (!d) throw new Error("Document not found");
  if (d.legal && d.legalReviewStatus !== "approved") throw new Error("Counsel review must be approved before signature");
  if (openPlaceholders(d.body).length) throw new Error("Complete every [TO CONFIRM] item first");
  if (!recipients.length) throw new Error("Add at least one signer");
  const p = ESIGN_PROVIDERS[providerKey] ?? MockESignProvider;
  const id = await p.createEnvelope(db, d, recipients, actor);
  await p.send(db, id, actor);
  return id;
}

/** Universal fallback: record the signed PDF's location (Drive, data room). The envelope is closed as completed. */
export async function recordSignedUpload(db: Db, docId: string, url: string, actor: string) {
  if (!/^https:\/\//.test(url)) throw new Error("Use an https link to the signed PDF");
  const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, docId));
  if (!d) throw new Error("Document not found");
  const [e] = await db.insert(esignEnvelopes).values({ mandateId: d.mandateId, generatedId: d.id, provider: "upload", status: "completed", recipients: [], signedDocumentUrl: url, events: [{ at: new Date().toISOString(), event: "signed PDF recorded", by: actor }], createdBy: actor }).returning({ id: esignEnvelopes.id });
  await audit(db, { actor, action: "signed_document_recorded", entity: "generated_documents", entityId: d.id, after: { envelope: e.id } });
  return e.id;
}

export async function documentHistory(db: Db, mandateIds: string[], limit = 100) {
  return db.select().from(generatedDocuments).where(inArray(generatedDocuments.mandateId, mandateIds.length ? mandateIds : ["-"])).orderBy(desc(generatedDocuments.createdAt)).limit(limit);
}
