// Document → records (phase 20 §1). A sponsor PDF is read by Claude into proposed projects and figures with page
// numbers; nothing is written to projects until a person applies the proposal. Applied figures become claims with
// status source_provided and document evidence (page), so the source conflicts view and the yield check can use them.
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/db";
import { claimEvidence, claims, docExtractions, organizations, projectParties, projects } from "@/db/schema";
import type { Extraction, ExtractedProject } from "@/db/casework";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { normalizeAlias } from "@/lib/ontology/identity";

export const zExtraction = z.object({
  sponsor: z.object({ name: z.string(), country: z.string().nullable() }).nullable(),
  projects: z.array(z.object({
    name: z.string(), country: z.string().nullable(), locality: z.string().nullable(), capacityMw: z.number().nullable(), annualGwh: z.number().nullable(),
    storage: z.string().nullable(), tariff: z.string().nullable(), capexUsd: z.number().nullable(), financing: z.string().nullable(), offtake: z.string().nullable(),
    status: z.string().nullable(), page: z.number().int().nullable(),
  })).max(80),
  statements: z.array(z.object({ statement: z.string(), page: z.number().int().nullable() })).max(12),
});

export const MAX_PDF_BYTES = 30 * 1024 * 1024;

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Reads a PDF and stores the proposal. Throws on budget or output errors (the caller shows them). */
export async function extractFromPdf(db: Db, ai: AiConfig, x: { mandateId: string; fileName: string; bytes: Uint8Array; documentId: string | null; actor: string }) {
  if (x.bytes.length > MAX_PDF_BYTES) throw new Error("PDF is larger than 30 MB: split it and upload the project pages.");
  const [row] = await db.insert(docExtractions).values({ mandateId: x.mandateId, documentId: x.documentId, fileName: x.fileName, status: "ready", createdBy: x.actor }).returning();
  try {
    const result = await runStructured(db, ai, "documents.extract_projects", [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(x.bytes) }, title: x.fileName },
      { type: "text", text: `Extract the sponsor, its projects and its key statements from "${x.fileName}".` },
    ], zExtraction, { entity: "doc_extraction", entityId: row.id });
    await db.update(docExtractions).set({ result, updatedAt: new Date().toISOString() }).where(eq(docExtractions.id, row.id));
    return { id: row.id, result };
  } catch (e) {
    await db.update(docExtractions).set({ status: "failed", error: (e as Error).message.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(docExtractions.id, row.id));
    throw e;
  }
}

const FIELDS: { key: keyof ExtractedProject; field: string; unit: string | null; label: string }[] = [
  { key: "capacityMw", field: "capacity", unit: "MW", label: "Capacity" },
  { key: "annualGwh", field: "annual_energy", unit: "GWh", label: "Annual energy" },
  { key: "capexUsd", field: "capex", unit: "USD", label: "Capital cost" },
  { key: "tariff", field: "tariff", unit: null, label: "Tariff" },
  { key: "storage", field: "storage", unit: null, label: "Storage" },
  { key: "financing", field: "financing", unit: null, label: "Financing" },
  { key: "offtake", field: "offtake", unit: null, label: "Offtake" },
  { key: "status", field: "status", unit: null, label: "Status" },
];

/** Applies selected projects: matches existing projects by normalized name, else creates them (stage opportunity);
 *  links the sponsor as a party; writes every stated figure as a source_provided claim with document evidence. */
export async function applyExtraction(db: Db, x: { extractionId: string; mandateId: string; selected: number[]; sponsorOrgId: string | null; actor: string; sponsorRole?: "sponsor" | "operator" }) {
  const role = x.sponsorRole ?? "sponsor";
  const [ex] = await db.select().from(docExtractions).where(and(eq(docExtractions.id, x.extractionId), eq(docExtractions.mandateId, x.mandateId)));
  if (!ex?.result) throw new Error("Extraction not found");
  const existing = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.mandateId, x.mandateId));
  const byName = new Map(existing.map(p => [normalizeAlias("name", p.name), p.id]));
  let created = 0, matched = 0, claimCount = 0;
  for (const i of x.selected) {
    const p = (ex.result as Extraction).projects[i];
    if (!p) continue;
    let projectId = byName.get(normalizeAlias("name", p.name));
    if (projectId) matched++;
    else {
      const [row] = await db.insert(projects).values({
        mandateId: x.mandateId, name: p.name.slice(0, 200), country: p.country?.toUpperCase().slice(0, 3) ?? null, municipality: p.locality, capacity: p.capacityMw, capacityUnit: p.capacityMw ? "MW" : null,
        capex: p.capexUsd, currency: p.capexUsd ? "USD" : null, assetClass: null, technology: null, originationSource: `Document: ${ex.fileName}`,
        description: `From ${ex.fileName}${p.page ? `, page ${p.page}` : ""} (sponsor-stated, unverified).`,
      }).returning({ id: projects.id });
      projectId = row.id; byName.set(normalizeAlias("name", p.name), row.id); created++;
    }
    if (x.sponsorOrgId) {
      const [has] = await db.select({ id: projectParties.id }).from(projectParties).where(and(eq(projectParties.projectId, projectId), eq(projectParties.orgId, x.sponsorOrgId), eq(projectParties.role, role)));
      if (!has) await db.insert(projectParties).values({ mandateId: x.mandateId, projectId, orgId: x.sponsorOrgId, role, confirmed: "proposed" });
    }
    for (const f of FIELDS) {
      const v = p[f.key];
      if (v === null || v === undefined || v === "") continue;
      const [c] = await db.insert(claims).values({ mandateId: x.mandateId, entityType: "project", entityId: projectId, statement: `${f.label} as stated in ${ex.fileName}: ${v}${f.unit ? ` ${f.unit}` : ""}`, claimType: f.field === "status" ? "fact" : "metric", field: f.field, value: String(v), unit: f.unit, status: "source_provided", createdBy: x.actor }).returning({ id: claims.id });
      await db.insert(claimEvidence).values({ claimId: c.id, provider: "sponsor document", documentId: ex.documentId, documentPage: p.page ? String(p.page) : null, excerpt: `${f.label}: ${v}`, method: "document", confidence: "low", addedBy: x.actor });
      claimCount++;
    }
  }
  await db.update(docExtractions).set({ status: "applied", appliedBy: x.actor, appliedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(docExtractions.id, ex.id));
  return { created, matched, claims: claimCount };
}

/** Finds the sponsor organization by normalized name in the workspace (null when not recorded). */
export async function findSponsorOrg(db: Db, mandateId: string, name: string | null | undefined) {
  if (!name) return null;
  const n = normalizeAlias("name", name);
  const rows = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.mandateId, mandateId));
  return rows.find(r => normalizeAlias("name", r.name) === n) ?? null;
}
