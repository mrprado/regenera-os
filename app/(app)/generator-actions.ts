"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { brokerProfiles, deals, generatedDocuments, objectives, organizations, projects } from "@/db/schema";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { approveLegal, generateDocument, MockESignProvider, newVersion, recordSignedUpload, renderDocument, startSignature } from "@/lib/documents/engine";
import { audit } from "@/lib/audit";
import { getAccessToken } from "@/lib/google/accounts";
import { googleConfig } from "@/lib/google/config";
import { DRIVE_FOLDER, uploadToDrive } from "@/lib/google/drive";
import { TEMPLATES } from "@/lib/documents/library";

const zId = z.string().uuid();
const str = (f: FormData, k: string, max = 4000) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedDoc(scope: Scope, id: string) {
  const [d] = await appDb().select().from(generatedDocuments).where(and(eq(generatedDocuments.id, id), mandateCondition(scope, generatedDocuments.mandateId)));
  if (!d) throw new Error("Document not found");
  return d;
}

/** The entity a template binds to must be in the user's scope; returns its mandate. */
async function entityMandate(scope: Scope, type: string, id: string) {
  const t = type === "project" ? projects : type === "organization" ? organizations : type === "broker" ? brokerProfiles : type === "deal" ? deals : type === "objective" ? objectives : null;
  if (!t) throw new Error("Unknown entity");
  const [r] = await appDb().select({ m: t.mandateId }).from(t).where(and(eq(t.id, id), mandateCondition(scope, t.mandateId)));
  if (!r) throw new Error("Not found");
  return r.m;
}

export async function generateAction(formData: FormData) {
  const key = z.string().parse(formData.get("templateKey"));
  let target = "/documents/generator";
  await withOsUser(async user => {
    const t = TEMPLATES.find(x => x.key === key);
    if (!t) throw new Error("Unknown template");
    const entityId = str(formData, "entityId", 60) || null;
    const mandateId = entityId ? await entityMandate(user.scope, t.entity, entityId) : user.scope.mandateIds[0];
    const values = Object.fromEntries(t.fields.map(f => [f.key, str(formData, `f_${f.key}`)]).filter(([, v]) => v));
    const d = await generateDocument(appDb(), { mandateId, templateKey: key, entityType: entityId ? t.entity : null, entityId, values }, user.email);
    target = `/documents/generator/${d.id}`;
  });
  redirect(target);
}

export async function newVersionAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let target = "/documents/generator";
  await withOsUser(async user => {
    const d = await scopedDoc(user.scope, id);
    const t = TEMPLATES.find(x => x.key === d.templateKey)!;
    const values = Object.fromEntries(t.fields.map(f => [f.key, str(formData, `f_${f.key}`)]));
    const v = await newVersion(appDb(), id, values, user.email);
    target = note(`/documents/generator/${v.id}`, `Version ${v.version} created; version ${v.version - 1} is kept.${v.legal ? " Legal review starts again." : ""}`);
  });
  redirect(target);
}

export async function approveLegalAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await scopedDoc(user.scope, id); await approveLegal(appDb(), id, str(formData, "reviewer", 200), user.email); }, { owner: true });
  redirect(note(`/documents/generator/${id}`, "Counsel approval recorded."));
}

export async function signatureAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedDoc(user.scope, id);
    const recipients = str(formData, "signers", 2000).split("\n").map(l => l.split(",").map(x => x.trim())).filter(p => p[1] && /@/.test(p[1])).map(([name, email, role]) => ({ name, email, role: role || "Signer" }));
    await startSignature(appDb(), id, recipients, str(formData, "provider", 30) || "mock", user.email);
  }, { owner: true });
  redirect(note(`/documents/generator/${id}`, "Sent for signature (mock provider: nothing was emailed; record each signature below)."));
}

export async function recordSignatureAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await scopedDoc(user.scope, id); await MockESignProvider.recordSignature(appDb(), zId.parse(formData.get("envelopeId")), str(formData, "email", 254), user.email); }, { owner: true });
  redirect(note(`/documents/generator/${id}`, "Signature recorded."));
}

export async function signedUploadAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await scopedDoc(user.scope, id); await recordSignedUpload(appDb(), id, str(formData, "url", 1000), user.email); });
  redirect(note(`/documents/generator/${id}`, "Signed PDF recorded; the document is now read-only (edits create a new version)."));
}

/** Saves a generated document (PDF or DOCX) to the "Regenera OS" folder of the connected Google Workspace Drive. Audited like
 *  a download; legal drafts keep their counsel-review watermark. Nothing is shared or sent. */
export async function saveToDriveAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const format = formData.get("format") === "docx" ? "docx" : "pdf";
  let msg = "";
  try {
    await withOsUser(async user => {
      const d = await scopedDoc(user.scope, id);
      const cfg = googleConfig();
      if (!cfg) throw new Error("Google is not configured for this workspace (Settings → Connections).");
      const { accessToken } = await getAccessToken(appDb(), cfg, "primary");
      const bytes = await renderDocument(d, format);
      const name = `${d.title.replace(/[^\w\s-]/g, "").replace(/[\s-]+/g, "-").slice(0, 80)}-v${d.version}.${format}`;
      const f = await uploadToDrive(accessToken, { name, mimeType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: bytes as Uint8Array });
      await audit(appDb(), { actor: user.email, action: "generated_document_drive_save", entity: "generated_documents", entityId: d.id, after: { format, driveFileId: f.id } });
      msg = `Saved to Google Drive → ${DRIVE_FOLDER}/${name}${f.webViewLink ? ` (${f.webViewLink})` : ""}`;
    });
  } catch (e) { msg = `Not saved to Drive: ${(e as Error).message}`; }
  redirect(note(`/documents/generator/${id}`, msg));
}
