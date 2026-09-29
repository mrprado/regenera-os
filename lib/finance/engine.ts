// Financial model records: create from a template, save with a change log (reason required once approved work
// exists), versions, approval and lock (approved cases are immutable), financeability set by a person, and site
// quantities imported from the ATLAS workbench into CAPEX lines (quantities only; unit costs stay the user's).
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { finChanges, finModels, projects, siteFeatures } from "@/db/schema";
import type { FINANCEABILITY, FIN_CASE_TYPES } from "@/db/finance";
import { audit } from "@/lib/audit";
import { diffModels, modelHealth, template, type TemplateKey } from "./analysis";
import { calculate } from "./calc";
import type { ModelDefinition } from "./types";

export function summarize(def: ModelDefinition) {
  const o = calculate(def), h = modelHealth(def, o);
  const r = (x: number | null, d = 2) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
  return {
    health: h.status,
    summary: { totalUses: r(o.uses.total, 0), capex: r(o.uses.capex, 0), debt: r(o.debt, 0), equity: r(o.sources.equity, 0), grants: r(o.sources.grants, 0), minDscr: r(o.minDscr), avgDscr: r(o.avgDscr), llcr: r(o.llcr),
      projectIrr: r(o.projectIrr, 1), equityIrr: r(o.equityIrr, 1), projectNpv: r(o.projectNpv, 0), equityNpv: r(o.equityNpv, 0), moic: r(o.moic), revenueYear1: r(o.revenueYear1, 0), ebitdaYear1: r(o.ebitdaYear1, 0), capexPerMw: r(o.capexPerMw, 0), debtSizedBy: o.debtSizedBy } as Record<string, number | string | null>,
  };
}

export async function createModel(db: Db, input: { projectId: string; name: string; template: TemplateKey; caseType?: (typeof FIN_CASE_TYPES)[number] }, actor: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!p) throw new Error("Project not found");
  const def = template(input.template, p.currency ?? "USD");
  if (def.generation && p.capacity && (p.capacityUnit ?? "").toUpperCase().startsWith("MW")) def.generation.capacityMw = p.capacity; // from the project record
  const s = summarize(def);
  const [row] = await db.insert(finModels).values({ mandateId: p.mandateId, projectId: p.id, name: input.name, template: input.template, caseType: input.caseType ?? "screening", definition: def, summary: s.summary, health: s.health, preparedBy: actor }).returning();
  await audit(db, { actor, action: "fin_model_create", entity: "fin_models", entityId: row.id, after: { template: input.template, name: input.name } });
  return row;
}

export async function saveDefinition(db: Db, modelId: string, def: ModelDefinition, reason: string, actor: string) {
  const [cur] = await db.select().from(finModels).where(eq(finModels.id, modelId));
  if (!cur) throw new Error("Model not found");
  if (cur.status === "locked" || cur.status === "approved" || cur.status === "superseded") throw new Error("This case is approved or locked. Create a new version to change assumptions.");
  const d = diffModels(cur.definition, def);
  if (!d.changes.length) return { changed: 0 };
  if (cur.version > 1 && reason.trim().length < 3) throw new Error("Give a reason for changes to a versioned model");
  const s = summarize(def);
  await db.update(finModels).set({ definition: def, summary: s.summary, health: s.health, updatedAt: new Date().toISOString() }).where(eq(finModels.id, modelId));
  for (const c of d.changes.slice(0, 200)) await db.insert(finChanges).values({ modelId, path: c.key, fromValue: c.from === undefined ? null : JSON.stringify(c.from), toValue: c.to === undefined ? null : JSON.stringify(c.to), reason, actor });
  return { changed: d.changes.length };
}

export async function newVersion(db: Db, modelId: string, name: string, caseType: (typeof FIN_CASE_TYPES)[number] | undefined, actor: string) {
  const [cur] = await db.select().from(finModels).where(eq(finModels.id, modelId));
  if (!cur) throw new Error("Model not found");
  const [latest] = await db.select({ v: finModels.version }).from(finModels).where(eq(finModels.projectId, cur.projectId)).orderBy(desc(finModels.version)).limit(1);
  const [row] = await db.insert(finModels).values({ mandateId: cur.mandateId, projectId: cur.projectId, name, template: cur.template, version: (latest?.v ?? cur.version) + 1, parentId: cur.id, caseType: caseType ?? cur.caseType, definition: cur.definition, summary: cur.summary, health: cur.health, preparedBy: actor }).returning();
  await audit(db, { actor, action: "fin_model_version", entity: "fin_models", entityId: row.id, after: { from: modelId, version: row.version } });
  return row;
}

/** Approve and lock (owner only at the edge). Refused while model health is ERROR. */
export async function approveModel(db: Db, modelId: string, reviewer: string, actor: string) {
  const [cur] = await db.select().from(finModels).where(eq(finModels.id, modelId));
  if (!cur) throw new Error("Model not found");
  if (cur.health === "ERROR") throw new Error("Model health is ERROR: fix the listed issues before approval");
  if (reviewer.trim().length < 3) throw new Error("Name the reviewer");
  const at = new Date().toISOString();
  await db.update(finModels).set({ status: "locked", reviewedBy: reviewer, approvedBy: actor, approvedAt: at, lockedAt: at, updatedAt: at }).where(eq(finModels.id, modelId));
  await audit(db, { actor, action: "fin_model_approve", entity: "fin_models", entityId: modelId, after: { reviewer, summary: cur.summary } });
}

export async function setFinanceability(db: Db, modelId: string, status: (typeof FINANCEABILITY)[number], note: string, actor: string) {
  if (status !== "screening" && note.trim().length < 5) throw new Error("Record the basis for this financeability status (who assessed it, against what)");
  await db.update(finModels).set({ financeability: status, notes: note, updatedAt: new Date().toISOString() }).where(eq(finModels.id, modelId));
  await audit(db, { actor, action: "fin_model_financeability", entity: "fin_models", entityId: modelId, after: { status, note } });
}

/** Site-derived quantities from saved workbench features: road/transmission lengths (km), array/restoration areas (ha). */
export async function siteQuantities(db: Db, projectId: string) {
  const rows = await db.select({ purpose: siteFeatures.purpose, name: siteFeatures.name, measures: siteFeatures.measures, scenario: siteFeatures.scenario, id: siteFeatures.id })
    .from(siteFeatures).where(and(eq(siteFeatures.projectId, projectId)));
  const km = (m: Record<string, number>) => (m.lengthM ?? 0) / 1000;
  const sum = (p: string, f: (m: Record<string, number>) => number) => rows.filter(r => r.purpose === p).reduce((a, r) => a + f(r.measures), 0);
  return {
    roadKm: sum("road", km), transmissionKm: sum("transmission_route", km), pipelineKm: sum("pipeline", km),
    solarHa: sum("solar_array", m => m.areaHa ?? 0), restorationHa: sum("restoration_area", m => m.areaHa ?? 0), conservationHa: sum("conservation_area", m => m.areaHa ?? 0),
    envelopeHa: sum("development_envelope", m => m.areaHa ?? 0), features: rows.length,
  };
}

/** Applies site quantities to matching CAPEX lines (creating them when absent). Unit costs are never set here. */
export function applySiteQuantities(def: ModelDefinition, q: Awaited<ReturnType<typeof siteQuantities>>): ModelDefinition {
  const next: ModelDefinition = JSON.parse(JSON.stringify(def));
  const upsert = (label: string, category: string, quantity: number, unit: string, from: string) => {
    if (!(quantity > 0)) return;
    const line = next.capex.find(l => l.label.toLowerCase().startsWith(label.toLowerCase()));
    if (line) { line.quantity = Math.round(quantity * 100) / 100; line.unit = unit; line.fromSite = from; }
    else next.capex.push({ id: `site_${category}`, category, label, quantity: Math.round(quantity * 100) / 100, unit, unitCost: 0, contingencyPct: 10, fromSite: from, source: "", date: null, owner: null, confidence: "low", status: "placeholder", comment: "Quantity from ATLAS workbench; unit cost required" });
  };
  upsert("Access roads", "civil", q.roadKm, "km", "ATLAS: road features");
  upsert("Interconnection / transmission", "grid", q.transmissionKm, "km", "ATLAS: transmission route");
  upsert("Pipeline", "civil", q.pipelineKm, "km", "ATLAS: pipeline features");
  upsert("Restoration works", "restoration", q.restorationHa, "ha", "ATLAS: restoration areas");
  return next;
}
