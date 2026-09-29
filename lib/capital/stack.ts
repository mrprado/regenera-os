// Capital stack analysis (pure; used by the builder in the browser and by reports) and the structure engine.
// Nothing here labels a structure compliant or bankable: it reports coverage, mix, weighted cost where rates are
// known, and flags what is still an assumption.
import { and, asc, eq, inArray, ne as sqlNe } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalRequirements, capitalStackLayers, capitalStructures, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { summarizeStack, type LayerInput } from "./stack-summary";
import type { StackLayer } from "./structure-vocab";

export { summarizeStack, type LayerInput, type StackSummary } from "./stack-summary";

// ---------- Engine ----------
export async function structuresForProject(db: Db, projectId: string) {
  const structures = await db.select().from(capitalStructures).where(eq(capitalStructures.projectId, projectId)).orderBy(asc(capitalStructures.createdAt));
  const layers = structures.length ? await db.select().from(capitalStackLayers).where(inArray(capitalStackLayers.structureId, structures.map(s => s.id))).orderBy(asc(capitalStackLayers.sortOrder)) : [];
  return structures.map(s => ({ ...s, layers: layers.filter(l => l.structureId === s.id) }));
}

/** New scenario: from the project's capital requirements when there are any (each becomes a layer marked by its source). */
export async function createStructure(db: Db, projectId: string, name: string, actor: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const [s] = await db.insert(capitalStructures).values({ projectId, mandateId: p.mandateId, name, currency: p.currency ?? "USD", totalCost: p.capex ?? null, costSource: p.capex != null ? "Project record (capex)" : "", createdBy: actor }).returning();
  const reqs = await db.select().from(capitalRequirements).where(eq(capitalRequirements.projectId, projectId));
  const map: Record<string, StackLayer> = {
    sponsor_equity: "sponsor_equity", development_capital: "development_equity", seed: "development_equity", preferred_equity: "preferred_equity", project_equity: "common_equity",
    infrastructure_equity: "common_equity", strategic_equity: "common_equity", senior_debt: "senior_debt", project_finance: "project_finance", private_credit: "senior_debt",
    mezzanine: "mezzanine", bridge: "construction_debt", construction_debt: "construction_debt", bond: "bond", note: "bond", green_bond: "green_bond",
    sustainability_linked: "bond", dfi: "dfi_capital", eca: "eca_finance", government: "grant", green_bank: "senior_debt", guarantee: "guarantee",
    concessional: "blended_finance", catalytic: "catalytic_capital", blended: "blended_finance", grant: "grant", foundation: "pri", climate_finance: "blended_finance",
    nature_finance: "blended_finance", carbon_finance: "common_equity", tax_incentive: "grant",
  };
  let i = 0;
  for (const r of reqs) {
    const layer = map[r.instrument];
    if (!layer) continue;
    await db.insert(capitalStackLayers).values({
      structureId: s.id, mandateId: p.mandateId, layer, provider: "", requirementId: r.id, currency: r.currency, amount: r.target ?? null, pricing: r.economics, tenorYears: null,
      amortization: r.repayment, security: r.security, status: r.status === "committed" ? "committed" : r.status === "closed" ? "closed" : "assumption",
      conditions: "", source: `Capital requirement: ${r.purpose}`, assumptionStatus: "assumption", sortOrder: i++,
    });
  }
  await audit(db, { actor, action: "capital_structure_create", entity: "capital_structures", entityId: s.id, after: { projectId, name, layers: i } });
  return s;
}

/** Copies a structure into a new scenario. */
export async function duplicateStructure(db: Db, structureId: string, name: string, actor: string) {
  const [src] = await db.select().from(capitalStructures).where(eq(capitalStructures.id, structureId));
  if (!src) throw new Error("Structure not found");
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
  const [s] = await db.insert(capitalStructures).values({ ...rest, name, basedOnId: src.id, status: "draft", reviewStatus: "not_reviewed", reviewNote: "", createdBy: actor }).returning();
  const layers = await db.select().from(capitalStackLayers).where(eq(capitalStackLayers.structureId, structureId));
  for (const l of layers) {
    const { id: _lid, createdAt: _lc, updatedAt: _lu, ...lr } = l;
    await db.insert(capitalStackLayers).values({ ...lr, structureId: s.id });
  }
  await audit(db, { actor, action: "capital_structure_duplicate", entity: "capital_structures", entityId: s.id, after: { from: structureId, name } });
  return s;
}

/** Saves the builder's state: header fields and the full ordered layer list (replaces the structure's layers). */
export async function saveStructure(db: Db, structureId: string, header: { name: string; currency: string; totalCost: number | null; costSource: string; status: string; notes: string }, layers: LayerInput[], actor: string) {
  const [s] = await db.select().from(capitalStructures).where(eq(capitalStructures.id, structureId));
  if (!s) throw new Error("Structure not found");
  const now = new Date().toISOString();
  // Any change to the structure resets a previous review: the reviewed version is no longer the one on record.
  await db.update(capitalStructures).set({ ...header, status: header.status as never, reviewStatus: s.reviewStatus === "reviewed" ? "not_reviewed" : s.reviewStatus, updatedAt: now }).where(eq(capitalStructures.id, structureId));
  if (header.status === "preferred") {
    await db.update(capitalStructures).set({ status: "working", updatedAt: now }).where(and(eq(capitalStructures.projectId, s.projectId), eq(capitalStructures.status, "preferred"), sqlNe(capitalStructures.id, structureId)));
  }
  await db.delete(capitalStackLayers).where(eq(capitalStackLayers.structureId, structureId));
  let i = 0;
  for (const l of layers) {
    await db.insert(capitalStackLayers).values({
      structureId, mandateId: s.mandateId, layer: l.layer, provider: l.provider, providerOrgId: l.providerOrgId ?? null, requirementId: l.requirementId ?? null, currency: l.currency,
      amount: l.amount, pricing: l.pricing, ratePct: l.ratePct, tenorYears: l.tenorYears, amortization: l.amortization, security: l.security,
      status: l.status as never, conditions: l.conditions, source: l.source, assumptionStatus: l.assumptionStatus as never, sortOrder: i++,
    });
  }
  const summary = summarizeStack({ currency: header.currency, totalCost: header.totalCost, layers });
  await audit(db, { actor, action: "capital_structure_save", entity: "capital_structures", entityId: structureId, after: { layers: layers.length, funded: summary.funded, gap: summary.gap, status: header.status } });
  return summary;
}

/** Records a review outcome. Review is a record of who looked at it; the OS never calls a structure compliant. */
export async function reviewStructure(db: Db, structureId: string, status: "not_reviewed" | "in_review" | "reviewed", note: string, actor: string) {
  if (status === "reviewed" && note.trim().length < 5) throw new Error("Name the reviewer and scope when recording a review.");
  await db.update(capitalStructures).set({ reviewStatus: status, reviewNote: note, updatedAt: new Date().toISOString() }).where(eq(capitalStructures.id, structureId));
  await audit(db, { actor, action: "capital_structure_review", entity: "capital_structures", entityId: structureId, after: { status, note } });
}

