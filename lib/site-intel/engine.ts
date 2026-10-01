// RUN SITE INTELLIGENCE: a staged pipeline over free sources and Regenera's own records. One stage executes per call
// (the panel drives it while open; the cron tick finishes abandoned runs), so the interface never blocks and each
// stage's results appear as soon as they exist. A failing provider fails only its stage. Screening grade throughout.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { fromUrl } from "geotiff";
import {
  capitalRequirements, communities, communityRights, consentRecords, finModels, fundingPathways, permits, projectJurisdictions, projects, siteIntelRuns,
} from "@/db/schema";
import type { StageFact, StageState } from "@/db/siteintel";
import type { Db } from "@/db";
import { audit } from "@/lib/audit";
import { bboxOf, inside, landCoverComposition, type SiteGeometry } from "@/lib/geo/landcover";
import { nearestInfrastructure } from "@/lib/geo/osm";
import { gbifBiodiversity, nasaPower, usgsSeismic, wbIndicators } from "@/lib/place/adapters";
import { eeStatus } from "@/lib/providers/earth-engine";
import { runEe, type EeAnalysis } from "@/lib/providers/ee-service";
import { aqueductFacts, aqueductForSite, lossFacts, refreshScreening } from "@/lib/data-providers/site";

export const STAGES = [
  ["spatial", "Spatial analysis"], ["energy", "Energy resource"], ["grid", "Grid"], ["water", "Water"], ["ecology", "Ecology"], ["land", "Land & terrain"], ["remote_sensing", "Remote sensing (Earth Engine)"],
  ["infrastructure", "Infrastructure"], ["climate", "Climate & hazards"], ["community", "Community"], ["regulatory", "Regulatory"], ["finance", "Finance relevance"],
] as const;
export type StageKey = (typeof STAGES)[number][0];
type Project = typeof projects.$inferSelect;
type Ctx = { db: Db; p: Project; g: SiteGeometry | null; lat: number; lng: number; fetchImpl?: typeof fetch; env: Record<string, string | undefined> };
class Skip extends Error {}
type Out = { summary: string; facts: StageFact[] };

export function parseGeometry(text: string | null): SiteGeometry | null {
  try { const j = text ? JSON.parse(text) : null; const g = j?.type === "Feature" ? j.geometry : j; return g?.type === "Polygon" || g?.type === "MultiPolygon" ? g : null; } catch { return null; }
}
export function geometryHash(p: Pick<Project, "geometry" | "lat" | "lng">) {
  const s = p.geometry ?? `${p.lat},${p.lng}`;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}
const km = (m: number | null) => (m === null ? "—" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** Relief from the Copernicus DEM GLO-30 (AWS Open Data, COG): elevation range and slope percentiles over the site. */
export async function copernicusRelief(g: SiteGeometry | null, lat: number, lng: number, open: typeof fromUrl = fromUrl) {
  const bb: [number, number, number, number] = g ? bboxOf(g) : [lng - 0.01, lat - 0.01, lng + 0.01, lat + 0.01];
  const la = Math.floor((bb[1] + bb[3]) / 2), lo = Math.floor((bb[0] + bb[2]) / 2);
  const name = `Copernicus_DSM_COG_10_${la < 0 ? "S" : "N"}${String(Math.abs(la)).padStart(2, "0")}_00_${lo < 0 ? "W" : "E"}${String(Math.abs(lo)).padStart(3, "0")}_00_DEM`;
  const clip: [number, number, number, number] = [Math.max(bb[0], lo), Math.max(bb[1], la), Math.min(bb[2], lo + 1), Math.min(bb[3], la + 1)];
  const nx = Math.max(8, Math.min(300, Math.round((clip[2] - clip[0]) * 3600))), ny = Math.max(8, Math.min(300, Math.round((clip[3] - clip[1]) * 3600)));
  const tif = await open(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`);
  const r = await tif.readRasters({ bbox: clip, width: nx, height: ny, interleave: false });
  const z = (r as unknown as ArrayLike<number>[])[0];
  const dx = ((clip[2] - clip[0]) / nx) * 111_320 * Math.cos((lat * Math.PI) / 180), dy = ((clip[3] - clip[1]) / ny) * 110_574;
  const polys = g ? (g.type === "Polygon" ? [g.coordinates] : g.coordinates) : null;
  const elev: number[] = [], slopes: number[] = [];
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    if (polys && !inside(polys, clip[0] + (x + 0.5) * ((clip[2] - clip[0]) / nx), clip[3] - (y + 0.5) * ((clip[3] - clip[1]) / ny))) continue;
    const c = z[y * nx + x]; if (!(c > -500)) continue;
    elev.push(c);
    const gx = (z[y * nx + x + 1] - z[y * nx + x - 1]) / (2 * dx), gy = (z[(y + 1) * nx + x] - z[(y - 1) * nx + x]) / (2 * dy);
    slopes.push(Math.sqrt(gx * gx + gy * gy) * 100);
  }
  if (!elev.length) throw new Error("No DEM cells inside the site");
  slopes.sort((a, b) => a - b);
  const pct = (p: number) => slopes[Math.min(slopes.length - 1, Math.floor((p / 100) * slopes.length))];
  return { min: Math.min(...elev), max: Math.max(...elev), mean: elev.reduce((a, b) => a + b, 0) / elev.length, slopeMedian: pct(50), slopeP95: pct(95), cellM: Math.round(Math.max(dx, dy)), gentlePct: (slopes.filter(s => s <= 5).length / slopes.length) * 100 };
}

const RUNNERS: Record<StageKey, (c: Ctx) => Promise<Out>> = {
  async spatial({ p, g, lat, lng }) {
    const facts: StageFact[] = [{ label: "Centroid", value: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, source: g ? "Project boundary" : "Project point" }];
    if (g) {
      const bb = bboxOf(g);
      const ha = (await import("@turf/turf")).area({ type: "Feature", geometry: g, properties: {} }) / 10_000;
      facts.push({ label: "Area", value: `${ha.toFixed(1)} ha`, source: "Geodesic area of the boundary" }, { label: "Extent", value: `${((bb[2] - bb[0]) * 111.32 * Math.cos((lat * Math.PI) / 180)).toFixed(1)} × ${((bb[3] - bb[1]) * 110.57).toFixed(1)} km`, source: "Bounding box" });
    }
    facts.push({ label: "Jurisdiction", value: [p.municipality, p.subdivision, p.country].filter(Boolean).join(", ") || "Unknown", source: "Project record" });
    return { summary: g ? "Boundary analysed" : "Point only: draw a boundary in Atlas for area-based stages", facts };
  },
  async energy({ db, lat, lng, fetchImpl }) {
    const f = await nasaPower(db, lat, lng, fetchImpl);
    const pick = f.filter(x => x.key === "solar_ghi" || x.key === "wind_10m");
    return { summary: pick.map(x => `${x.label}: ${x.value}`).join(" · ") || "No resource data", facts: pick.map(x => ({ label: x.label, value: x.value, source: `${x.integrationKey} · ${x.observedFor}` })) };
  },
  async grid({ db, lat, lng, fetchImpl }) {
    const r = await nearestInfrastructure(db, lng, lat, fetchImpl);
    const pick = r.items.filter(i => i.key === "transmission" || i.key === "substation");
    return { summary: pick.map(i => `${i.label}: ${i.status === "known" ? km(i.distanceM) : `none mapped within ${km(i.searchedRadiusM)}`}`).join(" · "), facts: pick.map(i => ({ label: i.label, value: i.status === "known" ? `${km(i.distanceM)}${i.name ? ` · ${i.name}` : ""}${i.detail ? ` · ${i.detail}` : ""}` : `None mapped within ${km(i.searchedRadiusM)}`, source: r.source })) };
  },
  async water({ db, lat, lng, fetchImpl }) {
    const [clim, infra] = await Promise.all([nasaPower(db, lat, lng, fetchImpl), nearestInfrastructure(db, lng, lat, fetchImpl)]);
    const precip = clim.find(x => x.key === "precip"), src = infra.items.find(i => i.key === "water_source");
    const facts: StageFact[] = [];
    if (precip) facts.push({ label: precip.label, value: precip.value, source: "NASA POWER climatology" });
    if (src) facts.push({ label: "Nearest river / named water body", value: src.status === "known" ? `${km(src.distanceM)}${src.name ? ` · ${src.name}` : ""}` : `None mapped within ${km(src.searchedRadiusM)}`, source: infra.source });
    facts.push({ label: "Surface-water history", value: "See Atlas layer: JRC surface water occurrence 1984–2021", source: "EC JRC / Google" });
    // WRI Aqueduct (Tier 1, global screening): a failure leaves a visible "unavailable" line, never a guess.
    try { const aq = await aqueductForSite(db, lat, lng, fetchImpl); facts.unshift(...aqueductFacts(aq)); if (!aq.readings.length) facts.push({ label: "Aqueduct water risk", value: "No sub-basin value at this point", source: "WRI Aqueduct 4.0 via Resource Watch", datasetId: "wri.aqueduct.baseline_water_stress" }); }
    catch (e) { facts.push({ label: "Aqueduct water risk", value: `Unavailable: ${(e as Error).message.slice(0, 120)}. Source link: wri.org/aqueduct`, source: "WRI Aqueduct 4.0", datasetId: "wri.aqueduct.baseline_water_stress" }); }
    facts.push({ label: "Diligence requirement", value: "Local hydrological and regulatory diligence required; Aqueduct is not project-level hydrological proof", source: "Regenera evidence policy (Level 1 → 2/3)", kind: "inference" });
    return { summary: facts.slice(0, 2).map(f => `${f.label}: ${f.value}`).join(" · "), facts };
  },
  async ecology({ db, g, lat, lng, fetchImpl, env }) {
    const facts: StageFact[] = [];
    if (g) {
      const c = await landCoverComposition(g);
      facts.push({ label: "Natural cover", value: `${c.naturalHa} ha (${c.naturalPct}%) of ${c.siteHa} ha`, source: c.source }, ...c.classes.slice(0, 4).map(x => ({ label: x.label, value: `${x.ha} ha · ${x.pct}%`, source: c.source })));
      // WRI Global Forest Watch zonal statistics over the boundary (needs a free GFW_API_KEY).
      try { facts.push(...await lossFacts(db, env.GFW_API_KEY, g as { type: "Polygon" | "MultiPolygon"; coordinates: unknown }, fetchImpl)); }
      catch (e) { facts.push({ label: "Tree cover loss (GFW)", value: `Unavailable: ${(e as Error).message.slice(0, 120)}. See the Atlas forest-loss layer.`, source: "WRI Global Forest Watch", datasetId: "wri.gfw.tree_cover_loss" }); }
    }
    const b = await gbifBiodiversity(db, lat, lng, fetchImpl);
    facts.push(...b.map(x => ({ label: x.label, value: x.value, source: "GBIF (aggregate counts)" })));
    return { summary: facts.slice(0, 2).map(f => `${f.label}: ${f.value}`).join(" · "), facts };
  },
  async land({ g, lat, lng }) {
    const r = await copernicusRelief(g, lat, lng);
    return { summary: `Elevation ${Math.round(r.min)}–${Math.round(r.max)} m · slope median ${r.slopeMedian.toFixed(1)}%, P95 ${r.slopeP95.toFixed(1)}%`, facts: [
      { label: "Elevation range", value: `${Math.round(r.min)}–${Math.round(r.max)} m (mean ${Math.round(r.mean)} m)`, source: `Copernicus DEM GLO-30 (~${r.cellM} m cells)` },
      { label: "Slope", value: `median ${r.slopeMedian.toFixed(1)}%, 95th percentile ${r.slopeP95.toFixed(1)}%`, source: "Copernicus DEM GLO-30" },
      { label: "Share of site ≤ 5% slope", value: `${r.gentlePct.toFixed(0)}%`, source: "Copernicus DEM GLO-30 (screening)" },
    ] };
  },
  async remote_sensing({ db, p, g, env, fetchImpl }) {
    const status = eeStatus(env);
    if (!status.connected) throw new Skip(status.reason);
    if (!g) throw new Skip("Needs a site boundary");
    const facts: StageFact[] = [];
    const step = async (a: EeAnalysis, fmt: (r: Record<string, unknown>) => StageFact[]) => { try { facts.push(...fmt((await runEe(db, env, p.id, a, {}, fetchImpl)).result)); } catch (e) { facts.push({ label: a.replace("_", " "), value: `Unavailable: ${(e as Error).message}`, source: "Google Earth Engine" }); } };
    const n = (x: unknown, d = 2) => (typeof x === "number" ? x.toFixed(d) : "—");
    await step("vegetation", r => [{ label: "NDVI (last full year, mean ± sd)", value: `${n(r.ndviMean)} ± ${n(r.ndviStd)}`, source: `Earth Engine · ${r.dataset} · ${r.scaleM} m` }]);
    await step("ndvi_change", r => [{ label: "NDVI change over 5 years", value: typeof r.delta === "number" ? `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(3)}` : "—", source: "Earth Engine · Sentinel-2 SR harmonised" }]);
    await step("surface_water", r => [{ label: "Surface-water occurrence 1984–2021", value: `mean ${n(r.occurrenceMeanPct, 1)}%, max ${n(r.occurrenceMaxPct, 0)}%`, source: `Earth Engine · ${r.dataset}` }]);
    await step("terrain", r => [{ label: "Slope (mean / max)", value: `${n(r.slopeMeanDeg, 1)}° / ${n(r.slopeMaxDeg, 1)}°`, source: `Earth Engine · ${r.dataset}` }]);
    await step("embedding", () => [{ label: "Landscape embedding", value: "Stored for similarity (AlphaEarth annual)", source: "Earth Engine · GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL" }]);
    return { summary: facts.slice(0, 2).map(f => `${f.label}: ${f.value}`).join(" · "), facts };
  },
  async infrastructure({ db, lat, lng, fetchImpl }) {
    const r = await nearestInfrastructure(db, lng, lat, fetchImpl);
    const pick = r.items.filter(i => ["major_road", "road", "rail", "port", "airport", "town", "industrial"].includes(i.key));
    return { summary: pick.filter(i => i.status === "known").slice(0, 3).map(i => `${i.label} ${km(i.distanceM)}`).join(" · ") || "Nothing mapped nearby", facts: pick.map(i => ({ label: i.label, value: i.status === "known" ? `${km(i.distanceM)}${i.name ? ` · ${i.name}` : ""}` : `None mapped within ${km(i.searchedRadiusM)}`, source: r.source })) };
  },
  async climate({ db, lat, lng, fetchImpl }) {
    const [clim, seis] = await Promise.all([nasaPower(db, lat, lng, fetchImpl), usgsSeismic(db, lat, lng, fetchImpl)]);
    const facts = [...clim.filter(x => x.key === "temp_mean"), ...seis].map(x => ({ label: x.label, value: x.value, source: `${x.integrationKey} · ${x.observedFor}` }));
    return { summary: facts.slice(0, 2).map(f => `${f.label}: ${f.value}`).join(" · "), facts };
  },
  async community({ db, p, fetchImpl }) {
    // Counts only from governed records; no knowledge content ever enters site intelligence.
    const [cs, rights, cons] = await Promise.all([
      db.select({ id: communities.id }).from(communities).where(and(eq(communities.projectId, p.id), isNull(communities.deletedAt))),
      db.select({ materiality: communityRights.materiality, resolution: communityRights.resolution }).from(communityRights).where(and(eq(communityRights.projectId, p.id), isNull(communityRights.deletedAt))),
      db.select({ status: consentRecords.status }).from(consentRecords).where(and(eq(consentRecords.projectId, p.id), isNull(consentRecords.deletedAt))),
    ]);
    const facts: StageFact[] = [
      { label: "Communities recorded", value: String(cs.length), source: "Regenera community register" },
      { label: "Rights open (medium or higher)", value: String(rights.filter(r => r.resolution === "open" && r.materiality !== "low").length), source: "Regenera rights register" },
      { label: "Consent records", value: cons.length ? cons.map(c => c.status.replace(/_/g, " ")).join(", ") : "None", source: "Regenera consent records" },
    ];
    if (p.country) { const wb = await wbIndicators(db, p.country, fetchImpl).catch(() => []); facts.push(...wb.filter(x => x.dimension === "human").slice(0, 3).map(x => ({ label: x.label, value: x.value, source: "World Bank indicators (country level)" }))); }
    return { summary: cs.length ? `${cs.length} communities recorded` : "No communities recorded: community screening required", facts };
  },
  async regulatory({ db, p }) {
    const [js, ps] = await Promise.all([db.select({ name: projectJurisdictions.jurisdiction }).from(projectJurisdictions).where(eq(projectJurisdictions.projectId, p.id)), db.select({ status: permits.status }).from(permits).where(eq(permits.projectId, p.id))]);
    const open = ps.filter(x => x.status !== "approved").length;
    return { summary: `${js.length} jurisdiction(s) · ${ps.length} permit(s), ${open} not yet approved`, facts: [{ label: "Jurisdictions mapped", value: js.map(j => j.name).join(", ") || "None", source: "Regenera regulatory register" }, { label: "Permits", value: `${ps.length} recorded, ${open} not yet approved`, source: "Regenera permits register" }] };
  },
  async finance({ db, p }) {
    const [req, paths, [m]] = await Promise.all([
      db.select({ target: capitalRequirements.target, currency: capitalRequirements.currency }).from(capitalRequirements).where(eq(capitalRequirements.projectId, p.id)),
      db.select({ id: fundingPathways.id }).from(fundingPathways).where(eq(fundingPathways.projectId, p.id)),
      db.select({ name: finModels.name, health: finModels.health, summary: finModels.summary }).from(finModels).where(eq(finModels.projectId, p.id)).orderBy(desc(finModels.updatedAt)).limit(1),
    ]);
    return { summary: `${req.length} capital requirement(s) · ${paths.length} funding pathway(s) · model ${m ? `${m.name} (${m.health})` : "none"}`, facts: [
      { label: "Capital requirements", value: req.map(r => `${r.currency ?? ""} ${Math.round(r.target ?? 0).toLocaleString("en-US")}`).join(" · ") || "None", source: "Regenera capital register" },
      { label: "Funding pathways", value: String(paths.length), source: "Regenera funding pathways" },
      { label: "Financial model", value: m ? `${m.name} · health ${m.health}${typeof m.summary.projectIrr === "number" ? ` · project IRR ${m.summary.projectIrr}%` : ""}` : "None", source: "Regenera financial model" },
    ] };
  },
};

export async function startRun(db: Db, projectId: string, actor: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  if (p.lat === null || p.lng === null) { const g = parseGeometry(p.geometry); if (!g) throw new Error("The project has no location: add coordinates or draw a boundary in Atlas"); }
  const [r] = await db.insert(siteIntelRuns).values({ mandateId: p.mandateId, projectId, stages: STAGES.map(([key]) => ({ key, status: "queued" as const })), geometryHash: geometryHash(p), startedBy: actor }).returning();
  await audit(db, { actor, action: "site_intel.start", entity: "project", entityId: projectId, after: { runId: r.id } });
  return r;
}

/** Execute the next queued stage of a run (idempotent under concurrent callers: a running stage is not restarted). */
export async function runNextStage(db: Db, runId: string, fetchImpl?: typeof fetch, env: Record<string, string | undefined> = {}) {
  const [run] = await db.select().from(siteIntelRuns).where(eq(siteIntelRuns.id, runId));
  if (!run) throw new Error("Run not found");
  const stages: StageState[] = [...run.stages];
  const i = stages.findIndex(s => s.status === "queued");
  if (i < 0) return run;
  const [p] = await db.select().from(projects).where(eq(projects.id, run.projectId));
  const g = parseGeometry(p?.geometry ?? null);
  let lat = p?.lat ?? null, lng = p?.lng ?? null;
  if ((lat === null || lng === null) && g) { const bb = bboxOf(g); lat = (bb[1] + bb[3]) / 2; lng = (bb[0] + bb[2]) / 2; }
  stages[i] = { ...stages[i], status: "running", startedAt: new Date().toISOString() };
  await db.update(siteIntelRuns).set({ stages, status: "running", updatedAt: new Date().toISOString() }).where(eq(siteIntelRuns.id, runId));
  try {
    if (!p || lat === null || lng === null) throw new Error("Project location missing");
    const out = await RUNNERS[stages[i].key as StageKey]({ db, p, g, lat, lng, fetchImpl, env });
    stages[i] = { ...stages[i], status: "done", finishedAt: new Date().toISOString(), summary: out.summary, facts: out.facts };
  } catch (e) {
    stages[i] = { ...stages[i], status: e instanceof Skip ? "skipped" : "failed", finishedAt: new Date().toISOString(), ...(e instanceof Skip ? { summary: (e as Error).message } : { error: (e as Error).message.slice(0, 300) }) };
  }
  const remaining = stages.some(s => s.status === "queued");
  const status = remaining ? "running" : stages.some(s => s.status === "failed") ? "partial" : "complete";
  await db.update(siteIntelRuns).set({ stages, status, updatedAt: new Date().toISOString(), finishedAt: remaining ? null : new Date().toISOString() }).where(eq(siteIntelRuns.id, runId));
  // A finished run refreshes the project's screening flags and dataset links (sources, not conclusions).
  if (!remaining) await refreshScreening(db, run.projectId).catch(() => undefined);
  return { ...run, stages, status };
}

/** Cron: continue runs whose panel was closed (stale for > 2 minutes). */
export async function continueAbandonedRuns(db: Db, now = new Date(), maxStages = 6, env: Record<string, string | undefined> = {}) {
  const cutoff = new Date(now.getTime() - 120_000).toISOString();
  const runs = (await db.select().from(siteIntelRuns).where(inArray(siteIntelRuns.status, ["queued", "running"]))).filter(r => r.updatedAt < cutoff);
  let done = 0;
  for (const r of runs) {
    // A stage stuck in "running" (request died) is re-queued once.
    if (r.stages.some(s => s.status === "running")) await db.update(siteIntelRuns).set({ stages: r.stages.map(s => (s.status === "running" ? { ...s, status: "queued" as const } : s)) }).where(eq(siteIntelRuns.id, r.id));
    while (done < maxStages) { const x = await runNextStage(db, r.id, undefined, env); done++; if (!x.stages.some(s => s.status === "queued")) break; }
    if (done >= maxStages) break;
  }
  return { runs: runs.length, stages: done };
}
