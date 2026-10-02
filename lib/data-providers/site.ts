// WRI and institutional data inside site intelligence and project screening. Reads carry dataset ids so flags,
// the Environmental & Spatial Screening tab, exports and AI answers cite the same record.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { communities, datasets, projectDatasetLinks, projectScreeningFlags, projects, siteIntelRuns } from "@/db/schema";
import type { StageFact } from "@/db/siteintel";
import { audit } from "@/lib/audit";
import { SCREENING_FLAGS, screeningFlags, type ScreeningInputs } from "./evidence";
import { aqueductAt, resolveAqueduct } from "./wri/aqueduct";
import { treeCoverLoss } from "./wri/global-forest-watch";
import type { RwDataset } from "./wri/resource-watch";

/** Aqueduct baseline at a point, resolving (and remembering) the Resource Watch dataset first. */
export async function aqueductForSite(db: Db, lat: number, lng: number, fetchImpl?: typeof fetch) {
  const id = "wri.aqueduct.baseline_water_stress";
  const [row] = await db.select({ ref: datasets.resolvedRef }).from(datasets).where(eq(datasets.id, id));
  let ds: RwDataset | null = row?.ref ? JSON.parse(row.ref) : null;
  if (!ds) {
    ds = await resolveAqueduct(db, "aqueduct baseline water stress", fetchImpl);
    if (!ds) throw new Error("Aqueduct dataset not found in the Resource Watch catalogue");
    await db.update(datasets).set({ resolvedRef: JSON.stringify(ds), providerUpdatedAt: ds.updatedAt }).where(eq(datasets.id, id));
  }
  const r = await aqueductAt(db, ds, lat, lng, fetchImpl);
  const now = new Date().toISOString();
  await db.update(datasets).set({ lastSuccessAt: now, lastSyncedAt: now, connection: "connected", failures: 0, lastError: null }).where(eq(datasets.id, id));
  return { ...r, dataset: ds };
}

export function aqueductFacts(r: Awaited<ReturnType<typeof aqueductForSite>>): StageFact[] {
  return r.readings.map(x => ({ label: `${x.label} (Aqueduct 4.0)`, value: x.categoryLabel ?? (x.score !== null ? `score ${x.score.toFixed(1)} of 5` : "no value"), source: `WRI Aqueduct 4.0 via Resource Watch · sub-basin${r.basin ? ` ${r.basin}` : ""} · global screening`, datasetId: "wri.aqueduct.baseline_water_stress", data: { indicator: x.indicator, category: x.category } }));
}

export async function lossFacts(db: Db, apiKey: string | undefined, geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown }, fetchImpl?: typeof fetch): Promise<StageFact[]> {
  const l = await treeCoverLoss(db, apiKey, geometry, fetchImpl);
  const now = new Date().toISOString();
  await db.update(datasets).set({ lastSuccessAt: now, lastSyncedAt: now, connection: "connected", failures: 0, lastError: null }).where(eq(datasets.id, "wri.gfw.tree_cover_loss"));
  return [
    { label: "Tree cover loss since 2001 (≥30% canopy)", value: `${l.totalHa} ha`, source: "Hansen/UMD via Global Forest Watch Data API · 30 m", datasetId: "wri.gfw.tree_cover_loss", data: { totalHa: l.totalHa, recentHa: l.recentHa, recentFrom: l.recentFrom } },
    { label: `Tree cover loss since ${l.recentFrom}`, value: `${l.recentHa} ha${l.lastYear ? ` (latest year ${l.lastYear})` : ""}`, source: "Global Forest Watch", datasetId: "wri.gfw.tree_cover_loss" },
  ];
}

const num = (s: string | undefined) => { const m = s?.match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

/** Latest run's facts → screening inputs (machine-readable `data` first, then labelled text). */
export function inputsFromFacts(facts: StageFact[], communityCount: number): ScreeningInputs {
  const aq = facts.filter(f => f.datasetId === "wri.aqueduct.baseline_water_stress" && f.data).map(f => ({ indicator: String(f.data!.indicator), category: typeof f.data!.category === "number" ? (f.data!.category as number) : null, categoryLabel: f.value }));
  const lossF = facts.find(f => f.datasetId === "wri.gfw.tree_cover_loss" && f.data?.totalHa !== undefined);
  const tx = facts.find(f => /transmission/i.test(f.label));
  const natural = facts.find(f => f.label === "Natural cover");
  const access = facts.find(f => /access to electricity/i.test(f.label));
  const quakes = facts.find(f => /earthquake/i.test(f.label));
  const flood = aq.find(a => a.indicator === "rfr");
  return {
    aqueduct: aq, loss: lossF ? { totalHa: Number(lossF.data!.totalHa), recentHa: Number(lossF.data!.recentHa), recentFrom: Number(lossF.data!.recentFrom) } : null,
    naturalPct: natural ? num(natural.value.match(/\((\d+(\.\d+)?)%\)/)?.[1]) : null,
    transmissionMapped: tx ? !/none mapped/i.test(tx.value) : undefined, transmissionKm: tx && !/none mapped/i.test(tx.value) ? (/\bm\b/.test(tx.value.split("·")[0]) && !/km/.test(tx.value.split("·")[0]) ? (num(tx.value) ?? 0) / 1000 : num(tx.value)) : null,
    electricityAccessPct: access ? num(access.value) : null, communities: communityCount, seismicEvents: quakes ? num(quakes.value) : null, floodCategory: flood?.category ?? null,
  };
}

/** Recompute a project's screening flags and dataset links from its latest completed run. Reviewed flags keep their review. */
export async function refreshScreening(db: Db, projectId: string, actor = "system:screening") {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  if (!p) return { flags: 0 };
  const [run] = await db.select().from(siteIntelRuns).where(and(eq(siteIntelRuns.projectId, projectId), inArray(siteIntelRuns.status, ["complete", "partial"]))).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  if (!run) return { flags: 0 };
  const facts = run.stages.flatMap(s => s.facts ?? []);
  const cs = await db.select({ id: communities.id }).from(communities).where(and(eq(communities.projectId, projectId), isNull(communities.deletedAt)));
  const drafts = screeningFlags(inputsFromFacts(facts, cs.length));
  const existing = await db.select().from(projectScreeningFlags).where(eq(projectScreeningFlags.projectId, projectId));
  for (const f of drafts) {
    const prev = existing.find(e => e.flag === f.flag);
    const diligence = SCREENING_FLAGS[f.flag].diligence;
    if (prev) await db.update(projectScreeningFlags).set({ observed: f.observed, implication: f.implication, datasetId: f.datasetId, value: f.value, diligence, updatedAt: new Date().toISOString() }).where(eq(projectScreeningFlags.id, prev.id));
    else await db.insert(projectScreeningFlags).values({ mandateId: p.mandateId, projectId, flag: f.flag, observed: f.observed, implication: f.implication, diligence, datasetId: f.datasetId, value: f.value, evidenceLevel: f.evidenceLevel });
  }
  // Flags whose observation no longer holds are closed as dismissed by the system, with the reason.
  for (const e of existing.filter(e => !drafts.some(d => d.flag === e.flag) && e.status === "open")) await db.update(projectScreeningFlags).set({ status: "dismissed", reviewNote: "Not observed in the latest site intelligence run", reviewedBy: actor, updatedAt: new Date().toISOString() }).where(eq(projectScreeningFlags.id, e.id));
  const used = [...new Set(facts.map(f => f.datasetId).filter((x): x is string => !!x))];
  for (const d of used) await db.insert(projectDatasetLinks).values({ mandateId: p.mandateId, projectId, datasetId: d }).onConflictDoNothing();
  await audit(db, { actor, action: "screening_refresh", entity: "projects", entityId: projectId, after: { flags: drafts.map(d => d.flag) } });
  return { flags: drafts.length };
}

/** §11 Default dataset links for a new project (screening role), so its tab lists the applicable WRI sources. */
export const DEFAULT_PROJECT_DATASETS = ["wri.aqueduct.baseline_water_stress", "wri.aqueduct.riverine_flood", "wri.gfw.tree_cover_loss", "wri.lcl.land_cover_change", "wri.eae.energy_access", "nasa.power", "osm.infrastructure", "wb.wdi"];
export async function linkDefaultDatasets(db: Db, projectId: string, mandateId: string) {
  for (const d of DEFAULT_PROJECT_DATASETS) await db.insert(projectDatasetLinks).values({ mandateId, projectId, datasetId: d }).onConflictDoNothing();
}
