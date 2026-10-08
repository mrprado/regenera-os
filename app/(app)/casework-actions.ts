"use server";

// Phase 20 actions (docs/plans/phase-20-case-study-tooling.md): document extraction, document requests, capital
// providers and routing tags, guardrails, approximate placement, registry checks and portfolio site checks.
import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  capitalProfiles, docExtractions, docRequestItems, docRequests, documents, organizations, placeFacts, projectParties, projects, protectedParties, regulatedProducts,
} from "@/db/schema";
import { REQUEST_ITEM_STATES } from "@/db/casework";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { importProgrammes, ROUTING } from "@/lib/capital/providers";
import { aiConfig } from "@/lib/config";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { applyExtraction, extractFromPdf, findSponsorOrg } from "@/lib/documents/extract";
import { createRequest, REQUEST_TEMPLATES } from "@/lib/documents/requests";
import { addAlias } from "@/lib/ontology/identity";
import { buildPlaceProfile } from "@/lib/place/engine";
import { sponsorProjects } from "@/lib/portfolio/screen";
import { PRECISION } from "@/lib/portfolio/screen";
import { checkCompaniesHouse, companyNumberOf } from "@/lib/registry/companies-house";
import { geocode } from "@/lib/sources/geocode";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 600) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const back = (f: FormData, d: string) => z.string().startsWith("/").catch(d).parse(f.get("back"));

function workspaceOf(scope: Scope, f: FormData) {
  const m = z.string().min(1).parse(f.get("mandateId"));
  if (scope.kind === "user" && !scope.mandateIds.includes(m)) throw new Error("Workspace not available");
  return m;
}
async function scopedOrg(scope: Scope, id: string) {
  const [o] = await appDb().select().from(organizations).where(and(eq(organizations.id, id), mandateCondition(scope, organizations.mandateId)));
  if (!o) throw new Error("Organization not found");
  return o;
}
async function scopedProject(scope: Scope, id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}

// ---------- 1. document extraction ----------
export async function extractDocumentAction(formData: FormData) {
  const file = formData.get("file");
  let to = "/documents/extract";
  await withOsUser(async user => {
    const mandateId = workspaceOf(user.scope, formData);
    if (!(file instanceof File) || !file.size) { to = note(to, "Choose a PDF."); return; }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { to = note(to, "Only PDF files can be read."); return; }
    const ai = aiConfig();
    if (!ai) { to = note(to, "ANTHROPIC_API_KEY is not set."); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let documentId: string | null = null;
    const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
    if (bucket) {
      const key = `documents/${mandateId}/${crypto.randomUUID()}.pdf`;
      await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
      const [d] = await appDb().insert(documents).values({ mandateId, title: file.name.slice(0, 200), category: "corporate", status: "draft", confidentiality: "confidential", r2Key: key, owner: user.email, notes: "Sponsor document uploaded for extraction." }).returning({ id: documents.id });
      documentId = d.id;
    }
    try {
      const r = await extractFromPdf(appDb(), ai, { mandateId, fileName: file.name, bytes, documentId, actor: user.email });
      await audit(appDb(), { actor: user.email, action: "document_extracted", entity: "doc_extractions", entityId: r.id, after: { file: file.name, projects: r.result.projects.length } });
      to = `/documents/extract?id=${r.id}`;
    } catch (e) { to = note(to, `Could not read the document: ${err(e)}`); }
  });
  redirect(to);
}

export async function applyExtractionAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const selected = formData.getAll("project").map(v => Number(v)).filter(Number.isInteger);
  let msg = "";
  await withOsUser(async user => {
    const [ex] = await appDb().select().from(docExtractions).where(and(eq(docExtractions.id, id), mandateCondition(user.scope, docExtractions.mandateId)));
    if (!ex) throw new Error("Not found");
    let sponsorOrgId = zId.safeParse(formData.get("sponsorOrgId")).data ?? null;
    if (!sponsorOrgId && formData.get("linkSponsor") === "on") sponsorOrgId = (await findSponsorOrg(appDb(), ex.mandateId, ex.result?.sponsor?.name))?.id ?? null;
    const r = await applyExtraction(appDb(), { extractionId: id, mandateId: ex.mandateId, selected, sponsorOrgId, actor: user.email, sponsorRole: formData.get("sponsorRole") === "operator" ? "operator" : "sponsor" });
    await audit(appDb(), { actor: user.email, action: "extraction_applied", entity: "doc_extractions", entityId: id, after: r });
    msg = `${r.created} project(s) created, ${r.matched} matched, ${r.claims} figure(s) recorded as source-provided claims.`;
  });
  redirect(note(`/documents/extract?id=${id}`, msg));
}

// ---------- 5. document requests ----------
export async function createRequestAction(formData: FormData) {
  let to = "/documents/requests";
  await withOsUser(async user => {
    const mandateId = workspaceOf(user.scope, formData);
    const template = z.enum(Object.keys(REQUEST_TEMPLATES) as [string, ...string[]]).parse(formData.get("template"));
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null, projectId = zId.safeParse(formData.get("projectId")).data ?? null;
    if (orgId) await scopedOrg(user.scope, orgId);
    if (projectId) await scopedProject(user.scope, projectId);
    const req = await createRequest(appDb(), { mandateId, orgId, projectId, title: str(formData, "title", 200) || REQUEST_TEMPLATES[template].label, template, dueDate: date(formData, "dueDate"), ndaDocumentId: zId.safeParse(formData.get("ndaDocumentId")).data ?? null, actor: user.email });
    to = `/documents/requests/${req.id}`;
  });
  redirect(to);
}

export async function setRequestItemAction(formData: FormData) {
  const id = zId.parse(formData.get("id")), requestId = zId.parse(formData.get("requestId"));
  await withOsUser(async user => {
    const [it] = await appDb().select().from(docRequestItems).where(and(eq(docRequestItems.id, id), mandateCondition(user.scope, docRequestItems.mandateId)));
    if (!it) throw new Error("Not found");
    await appDb().update(docRequestItems).set({ status: z.enum(keys(REQUEST_ITEM_STATES)).parse(formData.get("status")), documentId: zId.safeParse(formData.get("documentId")).data ?? it.documentId, note: str(formData, "note", 400), updatedBy: user.email, updatedAt: new Date().toISOString() }).where(eq(docRequestItems.id, id));
  });
  redirect(`/documents/requests/${requestId}#i-${id}`);
}

export async function closeRequestAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await appDb().update(docRequests).set({ status: formData.get("reopen") === "1" ? "open" : "closed", updatedAt: new Date().toISOString() }).where(and(eq(docRequests.id, id), mandateCondition(user.scope, docRequests.mandateId)));
  });
  redirect(`/documents/requests/${id}`);
}

// ---------- 6. capital providers ----------
export async function importProgrammesAction(formData: FormData) {
  let msg = "";
  await withOsUser(async user => {
    const mandateId = workspaceOf(user.scope, formData);
    const r = await importProgrammes(appDb(), mandateId, user.email);
    await audit(appDb(), { actor: user.email, action: "programmes_imported", entity: "capital_profiles", after: r });
    msg = `${r.created} provider(s) added, ${r.updated} refreshed. Institutions only; nothing was sent.`;
  });
  redirect(note("/capital/providers", msg));
}

export async function setRoutingAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await appDb().update(capitalProfiles).set({
      lane: z.enum(keys(ROUTING.lane)).nullable().catch(null).parse(formData.get("lane") || null), preference: z.enum(keys(ROUTING.preference)).catch("unknown").parse(formData.get("preference")),
      ticketBand: z.enum(keys(ROUTING.ticketBand)).catch("unknown").parse(formData.get("ticketBand")), routingStage: z.enum(keys(ROUTING.routingStage)).catch("new").parse(formData.get("routingStage")),
      updatedAt: new Date().toISOString(),
    }).where(and(eq(capitalProfiles.id, id), mandateCondition(user.scope, capitalProfiles.mandateId)));
  });
  redirect(`/capital/providers#p-${id}`);
}

// ---------- 7. guardrails ----------
export async function addRegulatedProductAction(formData: FormData) {
  await withOsUser(async user => {
    const mandateId = workspaceOf(user.scope, formData);
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
    if (orgId) await scopedOrg(user.scope, orgId);
    const values = { mandateId, orgId, name: z.string().trim().min(3).max(160).parse(formData.get("name")), kind: z.enum(["bond", "shares", "fund", "note", "scheme", "other"]).catch("other").parse(formData.get("kind")), aliases: str(formData, "aliases", 400).split(",").map(s => s.trim()).filter(s => s.length >= 3), note: str(formData, "note", 400), createdBy: user.email };
    await appDb().insert(regulatedProducts).values(values);
    await audit(appDb(), { actor: user.email, action: "regulated_product_added", entity: "regulated_products", after: values });
  }, { owner: true });
  redirect(note("/network/guardrails", "Regulated product recorded. Drafts naming it are held at send."));
}

export async function addProtectedPartyAction(formData: FormData) {
  await withOsUser(async user => {
    const mandateId = workspaceOf(user.scope, formData);
    const orgId = zId.safeParse(formData.get("orgId")).data ?? null;
    if (orgId) await scopedOrg(user.scope, orgId);
    const values = { mandateId, orgId, partyName: z.string().trim().min(2).max(200).parse(formData.get("partyName")), protectedFor: z.string().trim().min(2).max(200).parse(formData.get("protectedFor")), until: date(formData, "until"), agreementDocumentId: zId.safeParse(formData.get("agreementDocumentId")).data ?? null, note: str(formData, "note", 400), createdBy: user.email };
    await appDb().insert(protectedParties).values(values);
    await audit(appDb(), { actor: user.email, action: "protected_party_added", entity: "protected_parties", after: values });
  }, { owner: true });
  redirect(note("/network/guardrails", "Protection recorded. Introductions to this party are blocked until it ends."));
}

export async function removeGuardrailAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const table = formData.get("table") === "product" ? regulatedProducts : protectedParties;
  await withOsUser(async user => {
    await appDb().delete(table).where(and(eq(table.id, id), mandateCondition(user.scope, table.mandateId)));
    await audit(appDb(), { actor: user.email, action: "guardrail_removed", entity: formData.get("table") === "product" ? "regulated_products" : "protected_parties", entityId: id });
  }, { owner: true });
  redirect(note("/network/guardrails", "Removed."));
}

// ---------- 4. approximate placement ----------
export async function placeApproximatelyAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const to = back(formData, `/projects/${projectId}?tab=questions`);
  let msg = "";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const precision = z.enum(keys(PRECISION)).catch("town").parse(formData.get("precision"));
    const lat = Number(formData.get("lat")), lng = Number(formData.get("lng"));
    let point: { lat: number; lng: number; label: string } | null = null;
    if (formData.get("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) point = { lat, lng, label: "coordinates entered" };
    else {
      const q = str(formData, "locality", 200) || [p.municipality, p.subdivision, p.country].filter(Boolean).join(", ");
      if (!q) { msg = "Enter a town or locality."; return; }
      const g = await geocode(appDb(), q);
      if (g === "busy") { msg = "The geocoder is busy; try again in a few seconds."; return; }
      if (!g) { msg = `No place found for "${q}".`; return; }
      point = { lat: g.lat, lng: g.lng, label: `OpenStreetMap: ${g.label}` };
    }
    const source = `${PRECISION[precision]} · ${point.label} · set by ${user.email} on ${new Date().toISOString().slice(0, 10)}`;
    await appDb().update(projects).set({ lat: point.lat, lng: point.lng, locationPrecision: precision, locationSource: source.slice(0, 400), updatedAt: new Date().toISOString() }).where(eq(projects.id, p.id));
    await audit(appDb(), { actor: user.email, action: "project_located", entity: "projects", entityId: p.id, before: { lat: p.lat, lng: p.lng }, after: { lat: point.lat, lng: point.lng, precision } });
    msg = `Placed (${PRECISION[precision].toLowerCase()}). Site checks can now run; results stay marked as screening.`;
  });
  redirect(note(to, msg));
}

// ---------- 3. registry checks ----------
export async function checkRegistryAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  const to = back(formData, `/projects/portfolio?org=${orgId}`);
  let msg = "";
  await withOsUser(async user => {
    const o = await scopedOrg(user.scope, orgId);
    const entered = str(formData, "companyNumber", 20).replace(/\s+/g, "").toUpperCase();
    if (entered) await addAlias(appDb(), { mandateId: o.mandateId, entityType: "organization", entityId: o.id, scheme: "companies_house", value: entered, createdBy: user.email });
    const number = entered || await companyNumberOf(appDb(), o.id);
    if (!number) { msg = "Enter the Companies House number first."; return; }
    try {
      const s = await checkCompaniesHouse(appDb(), (env as unknown as Record<string, string | undefined>).COMPANIES_HOUSE_API_KEY, { mandateId: o.mandateId, orgId: o.id, orgName: o.name, companyNumber: number });
      msg = s.changes.length ? `${s.changes.length} change(s) since the last check.` : "Registry snapshot saved.";
    } catch (e) { msg = err(e); }
  });
  redirect(note(to, msg));
}

// ---------- 2. portfolio site checks ----------
export async function portfolioSiteChecksAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  let msg = "";
  await withOsUser(async user => {
    const o = await scopedOrg(user.scope, orgId);
    const ids = user.scope.kind === "user" ? user.scope.mandateIds : [o.mandateId];
    const located = (await sponsorProjects(appDb(), ids, o)).filter(p => p.lat !== null && p.lng !== null);
    // Projects without the tracking-yield reference first, so repeated runs work through the portfolio.
    const done = located.length ? new Set((await appDb().select({ id: placeFacts.projectId }).from(placeFacts).where(and(inArray(placeFacts.projectId, located.map(p => p.id).slice(0, 90)), eq(placeFacts.key, "pv_specific_yield_tracking")))).map(r => r.id)) : new Set<string>();
    const list = [...located.filter(p => !done.has(p.id)), ...located.filter(p => done.has(p.id))].slice(0, 3);
    if (!list.length) { msg = "No located projects: place them first (approximately is fine)."; return; }
    const results = [];
    for (const p of list) { const r = await buildPlaceProfile(appDb(), p.id); results.push(`${p.name}: ${r.written} value(s)${r.failed.length ? `, ${r.failed.length} source(s) unavailable` : ""}`); }
    msg = `Site checks run for ${list.length} project(s): ${results.join("; ")}. Run again for more.`;
  });
  redirect(note(`/projects/portfolio?org=${orgId}`, msg));
}


// ---------- operator grouping ----------
/** Records an organization as the operator / platform of every project it holds (linked parties, or projects whose
 *  name or description names it), so the Projects list groups them under it. Additive; existing parties are kept. */
export async function recordOperatorAction(formData: FormData) {
  const orgId = zId.parse(formData.get("orgId"));
  let msg = "";
  await withOsUser(async user => {
    const o = await scopedOrg(user.scope, orgId);
    const list = await sponsorProjects(appDb(), user.scope.kind === "user" ? user.scope.mandateIds : [o.mandateId], o);
    let added = 0;
    for (const p of list) {
      const [has] = await appDb().select({ id: projectParties.id }).from(projectParties).where(and(eq(projectParties.projectId, p.id), eq(projectParties.orgId, o.id), eq(projectParties.role, "operator")));
      if (has) continue;
      await appDb().insert(projectParties).values({ mandateId: p.mandateId, projectId: p.id, orgId: o.id, role: "operator", confirmed: "confirmed" });
      added++;
    }
    await audit(appDb(), { actor: user.email, action: "operator_recorded", entity: "organizations", entityId: o.id, after: { projects: list.length, added } });
    msg = `${o.name} recorded as operator of ${list.length} project(s) (${added} newly linked). The Projects list now groups them under ${o.name}.`;
  });
  redirect(note(`/projects/portfolio?org=${orgId}`, msg));
}

// ---------- archive a project ----------
/** Owners archive a project (duplicate, withdrawn, out of scope): hidden from lists, Atlas and screening, never deleted. */
export async function archiveProjectAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  const reason = z.string().trim().min(3, "Say why").max(300).parse(formData.get("reason"));
  let name = "";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    name = p.name;
    const at = new Date().toISOString();
    await appDb().update(projects).set({ archivedAt: at, updatedAt: at }).where(eq(projects.id, p.id));
    await audit(appDb(), { actor: user.email, action: "project_archived", entity: "projects", entityId: p.id, before: { archivedAt: p.archivedAt }, after: { archivedAt: at, reason } });
  }, { owner: true });
  redirect(note("/projects", `${name} archived (${reason}). It is kept and can be restored from the audit record.`));
}
