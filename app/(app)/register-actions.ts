"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { contractObligations, contractParties, contracts, documents, organizations, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { CONFIDENTIALITY, CONTRACT_CATEGORIES, DOCUMENT_CATEGORIES, DOCUMENT_STATUSES, LIFECYCLE, OBLIGATION_CATEGORIES, RECURRENCE } from "@/lib/contracts/catalog";
import { addObligation, completeObligation, linkDocument, newDocumentVersion, registerAmendment, registerContract, setLifecycle, updateKeyTerms } from "@/lib/contracts/register";
import { appDb, mandateCondition } from "@/lib/db/scoped";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null;
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const url = (f: FormData, k: string) => z.string().url().safeParse(str(f, k, 1000)).data ?? null;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const KEY_TERMS = ["conditionsPrecedent", "conditionsSubsequent", "representations", "covenants", "reporting", "deliverables", "performance", "insurance", "security", "guarantees", "indemnities", "liabilityCap", "liquidatedDamages", "termination", "defaults", "changeControl", "assignment", "confidentiality", "disputeResolution", "notices", "paymentTerms"] as const;

async function scopedContract(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [c] = await appDb().select().from(contracts).where(and(eq(contracts.id, id), mandateCondition(scope, contracts.mandateId)));
  if (!c) throw new Error("Contract not found");
  return c;
}

export async function registerContractAction(formData: FormData) {
  const [category, contractType] = str(formData, "type").split(":");
  if (!CONTRACT_CATEGORIES[category]?.types[contractType]) redirect(note("/contracts?tab=register", "Choose the agreement type."));
  let target = "/contracts?tab=register";
  await withOsUser(async user => {
    const projectId = zId.safeParse(formData.get("projectId")).data ?? null;
    let mandateId = user.scope.mandateIds[0];
    if (projectId) {
      const [p] = await appDb().select({ mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
      if (!p) throw new Error("Project not found");
      mandateId = p.mandateId;
    }
    const counterpartyId = zId.safeParse(formData.get("counterpartyOrgId")).data ?? null;
    const [cp] = counterpartyId ? await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.id, counterpartyId), mandateCondition(user.scope, organizations.mandateId))) : [];
    const docUrl = url(formData, "documentUrl");
    let documentId: string | null = null;
    if (docUrl) {
      const [d] = await appDb().insert(documents).values({ mandateId, title: str(formData, "title", 200) || CONTRACT_CATEGORIES[category].types[contractType], category: category === "land" ? "land" : category === "financing" || category === "equity" || category === "bonds" ? "financial" : category === "procurement" ? "epc" : "legal", url: docUrl, projectId, counterpartyOrgId: cp?.id ?? null, owner: user.email, status: "executed" }).returning();
      documentId = d.id;
    }
    const c = await registerContract(appDb(), {
      mandateId, projectId, category, contractType, title: str(formData, "title", 200), summary: str(formData, "summary", 8000), governingLaw: opt(formData, "governingLaw", 120),
      forum: opt(formData, "forum", 200), executionDate: date(formData, "executionDate"), effectiveDate: date(formData, "effectiveDate"), endDate: date(formData, "endDate"),
      renewalTerms: str(formData, "renewalTerms", 1000), value: num(formData, "value"), currency: (str(formData, "currency", 8) || "USD").toUpperCase(),
      lifecycle: (keys(LIFECYCLE) as string[]).includes(str(formData, "lifecycle")) ? str(formData, "lifecycle") as keyof typeof LIFECYCLE : "draft", documentId,
      parties: cp ? [{ name: cp.name, role: "counterparty", orgId: cp.id }] : [],
    }, user.email);
    target = note(`/contracts/${c.id}`, c.reviewRequired ? "Registered. COMPENSATION / REGULATORY REVIEW REQUIRED: this type can involve compensation tied to capital." : "Agreement registered. Add its obligations with the clause each comes from.");
  });
  redirect(target);
}

export async function lifecycleAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const to = z.enum(keys(LIFECYCLE)).parse(formData.get("lifecycle"));
  let msg = `Now ${LIFECYCLE[to].toLowerCase()}.`;
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    try { await setLifecycle(appDb(), id, to, user.email); } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function keyTermsAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Saved.";
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    const keyTerms = Object.fromEntries(KEY_TERMS.map(k => [k, str(formData, k, 2000)]).filter(([, v]) => v));
    try { msg = `Saved as version ${await updateKeyTerms(appDb(), id, { summary: str(formData, "summary", 8000), keyTerms }, user.email, str(formData, "note", 200))}.`; } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function amendmentAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const summary = z.string().trim().min(3).max(8000).parse(formData.get("summary"));
  let target = `/contracts/${id}`;
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    const a = await registerAmendment(appDb(), id, { title: str(formData, "title", 200), summary, executionDate: date(formData, "executionDate"), lifecycle: date(formData, "executionDate") ? "effective" : "draft" }, user.email);
    target = note(`/contracts/${a.id}`, "Amendment registered and linked to the original.");
  });
  redirect(target);
}

export async function addContractPartyAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const role = z.enum(["party", "counterparty", "guarantor", "agent", "beneficiary", "signatory", "key_contact"]).parse(formData.get("role"));
  await withOsUser(async user => {
    const c = await scopedContract(user.scope, id);
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
    const [org] = orgId ? await appDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)) : [];
    const name = str(formData, "name", 200) || org?.name;
    if (!name) throw new Error("Name or organization required");
    await appDb().insert(contractParties).values({ contractId: id, mandateId: c.mandateId, orgId, name, role });
  });
  redirect(note(`/contracts/${id}`, "Party added."));
}

export async function addObligationAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const obligation = z.string().trim().min(3).max(1000).parse(formData.get("obligation"));
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    await addObligation(appDb(), id, {
      obligation, responsibleParty: str(formData, "responsibleParty", 120) || "Not set", category: z.enum(keys(OBLIGATION_CATEGORIES)).catch("other").parse(formData.get("category")),
      dueDate: date(formData, "dueDate"), recurrence: z.enum(keys(RECURRENCE)).catch("none").parse(formData.get("recurrence")), evidenceRequired: str(formData, "evidenceRequired", 500),
      owner: opt(formData, "owner", 120), sourceClause: str(formData, "sourceClause", 500), riskIfMissed: str(formData, "riskIfMissed", 500),
    });
  });
  redirect(note(`/contracts/${id}`, "Obligation added. Due and overdue obligations appear on Today."));
}

export async function completeObligationAction(formData: FormData) {
  const oid = zId.parse(formData.get("obligationId"));
  const status = z.enum(["done", "waived", "missed"]).parse(formData.get("status"));
  let contractId = "";
  let msg = "Recorded.";
  await withOsUser(async user => {
    const [o] = await appDb().select().from(contractObligations).where(and(eq(contractObligations.id, oid), mandateCondition(user.scope, contractObligations.mandateId)));
    if (!o) throw new Error("Not found");
    contractId = o.contractId;
    try { const next = await completeObligation(appDb(), oid, { status, evidence: str(formData, "evidence", 1000) }, user.email); msg = next ? `Recorded. Next occurrence due ${next.dueDate}.` : "Recorded."; } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${contractId}`, msg));
}

export async function contractReviewedAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const conclusion = z.string().trim().min(5).max(2000).parse(formData.get("conclusion"));
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    await appDb().update(contracts).set({ reviewRequired: false, counselReviewedAt: new Date().toISOString(), counselReviewedBy: user.email, updatedAt: new Date().toISOString() }).where(eq(contracts.id, id));
    await audit(appDb(), { actor: user.email, action: "contract_compensation_reviewed", entity: "contracts", entityId: id, after: { conclusion } });
  }, { owner: true });
  redirect(note(`/contracts/${id}`, "Review recorded."));
}

// ---------- documents ----------

export async function addDocumentAction(formData: FormData) {
  const title = z.string().trim().min(2).max(200).parse(formData.get("title"));
  const category = z.enum(keys(DOCUMENT_CATEGORIES)).parse(formData.get("category"));
  const back = z.string().startsWith("/").catch("/documents").parse(formData.get("back"));
  await withOsUser(async user => {
    const projectId = zId.safeParse(formData.get("projectId")).data ?? null;
    const [p] = projectId ? await appDb().select({ mandateId: projects.mandateId }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId))) : [];
    const mandateId = p?.mandateId ?? user.scope.mandateIds[0];
    const [d] = await appDb().insert(documents).values({
      mandateId, title, category, version: str(formData, "version", 40) || "1", status: z.enum(keys(DOCUMENT_STATUSES)).catch("draft").parse(formData.get("status")),
      confidentiality: z.enum(keys(CONFIDENTIALITY)).catch("confidential").parse(formData.get("confidentiality")), owner: user.email, projectId,
      counterpartyOrgId: zId.safeParse(formData.get("counterpartyOrgId")).data ?? null, effectiveDate: date(formData, "effectiveDate"), expiryDate: date(formData, "expiryDate"),
      url: url(formData, "url"), notes: str(formData, "notes", 2000),
    }).returning();
    if (projectId) await linkDocument(appDb(), d.id, mandateId, "project", projectId);
    const contractId = zId.safeParse(formData.get("contractId")).data;
    if (contractId) await linkDocument(appDb(), d.id, mandateId, "contract", contractId);
    await audit(appDb(), { actor: user.email, action: "document_registered", entity: "documents", entityId: d.id });
  });
  redirect(note(back, "Document registered."));
}

export async function documentVersionAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const version = z.string().trim().min(1).max(40).parse(formData.get("version"));
  await withOsUser(async user => {
    const [d] = await appDb().select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), mandateCondition(user.scope, documents.mandateId)));
    if (!d) throw new Error("Not found");
    await newDocumentVersion(appDb(), id, { version, url: url(formData, "url") }, user.email);
  });
  redirect(note("/documents", `Version ${version} registered; the previous version is kept as Superseded.`));
}
