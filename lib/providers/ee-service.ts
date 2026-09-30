// Earth Engine service: cached, project-scoped analyses and landscape similarity. ATLAS → Regenera API → this service
// → Earth Engine → normalised result → ee_results / site_embeddings → panel. The browser never talks to Earth Engine.
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { eeResults, projects, siteEmbeddings } from "@/db/schema";
import type { Db } from "@/db";
import { cosine, eeConfig, ndviChange, siteEmbedding, surfaceWater, terrain, vegetation, type SiteGeometry } from "./earth-engine";
import { geometryHash, parseGeometry } from "@/lib/site-intel/engine";

export const EE_ANALYSIS_VERSION = "2026-09-29.1";
export type EeAnalysis = "vegetation" | "ndvi_change" | "surface_water" | "terrain" | "embedding";

async function projectGeometry(db: Db, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const g = parseGeometry(p.geometry);
  if (!g) throw new Error("Earth Engine analyses need a site boundary: draw one in Atlas → Workbench");
  return { p, g: g as SiteGeometry, hash: geometryHash(p) };
}

/** Run (or return the cached result of) one analysis over the project's exact boundary. */
export async function runEe(db: Db, env: Record<string, string | undefined>, projectId: string, analysis: EeAnalysis, params: { year?: number } = {}, fetchImpl?: typeof fetch) {
  const cfg = eeConfig(env);
  if (!cfg) throw new Error("Earth Engine is NOT CONNECTED");
  const { p, g, hash } = await projectGeometry(db, projectId);
  const y = params.year ?? new Date().getUTCFullYear() - 1;
  const key = JSON.stringify({ y });
  const [hit] = await db.select().from(eeResults).where(and(eq(eeResults.projectId, projectId), eq(eeResults.analysis, analysis), eq(eeResults.geometryHash, hash), eq(eeResults.params, key), eq(eeResults.analysisVersion, EE_ANALYSIS_VERSION))).orderBy(desc(eeResults.generatedAt)).limit(1);
  if (hit && (!hit.expiresAt || hit.expiresAt > new Date().toISOString())) return { cached: true, result: hit.result, generatedAt: hit.generatedAt };
  let result: Record<string, unknown>;
  if (analysis === "vegetation") result = await vegetation(cfg, g, `${y}-01-01`, `${y + 1}-01-01`, fetchImpl);
  else if (analysis === "ndvi_change") result = await ndviChange(cfg, g, [`${y - 5}-01-01`, `${y - 4}-01-01`], [`${y}-01-01`, `${y + 1}-01-01`], fetchImpl);
  else if (analysis === "surface_water") result = await surfaceWater(cfg, g, fetchImpl);
  else if (analysis === "terrain") result = await terrain(cfg, g, fetchImpl);
  else {
    const e = await siteEmbedding(cfg, g, y, fetchImpl);
    await db.insert(siteEmbeddings).values({ mandateId: p.mandateId, projectId, year: String(y), source: e.dataset, vector: e.vector, geometryHash: hash, analysisVersion: EE_ANALYSIS_VERSION });
    result = { year: y, dataset: e.dataset, scaleM: e.scaleM, stored: true };
  }
  const dataset = String((result as { dataset?: string }).dataset ?? "");
  await db.insert(eeResults).values({ mandateId: p.mandateId, projectId, analysis, params: key, geometryHash: hash, analysisVersion: EE_ANALYSIS_VERSION, result, dataset, scaleM: String((result as { scaleM?: number }).scaleM ?? ""), expiresAt: analysis === "embedding" || analysis === "terrain" ? null : new Date(Date.now() + 180 * 86_400_000).toISOString() });
  return { cached: false, result, generatedAt: new Date().toISOString() };
}

export type Similar = { projectId: string; name: string; similarity: number; year: string };
/** Comparable landscapes: cosine similarity of site embeddings for the same year. One signal, never a verdict. */
export async function similarSites(db: Db, mandateIds: string[], projectId: string, limit = 5): Promise<{ year: string | null; items: Similar[] }> {
  const [mine] = await db.select().from(siteEmbeddings).where(eq(siteEmbeddings.projectId, projectId)).orderBy(desc(siteEmbeddings.generatedAt)).limit(1);
  if (!mine) return { year: null, items: [] };
  const others = await db.select().from(siteEmbeddings).where(and(inArray(siteEmbeddings.mandateId, mandateIds), eq(siteEmbeddings.year, mine.year), ne(siteEmbeddings.projectId, projectId)));
  const latest = new Map<string, (typeof others)[number]>();
  for (const o of others) { const c = latest.get(o.projectId); if (!c || o.generatedAt > c.generatedAt) latest.set(o.projectId, o); }
  const names = latest.size ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, [...latest.keys()])) : [];
  const items = [...latest.values()].map(o => ({ projectId: o.projectId, name: names.find(n => n.id === o.projectId)?.name ?? "—", similarity: cosine(mine.vector, o.vector), year: o.year })).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  return { year: mine.year, items };
}

/** Plain-language reading of a similarity value (bands are screening conventions, stated as such). */
export function similarityLabel(s: number) {
  return s >= 0.95 ? "very similar landscape signature" : s >= 0.85 ? "similar landscape signature" : s >= 0.7 ? "partly similar" : "different landscape";
}
