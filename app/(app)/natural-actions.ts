"use server";

// Natural asset operating layer: land pipeline, structure, biological production, ecological design, certification
// & MRV, environmental inventory, environmental offtake, risk transfer and horizons.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  assetHorizons, certDocuments, certifications, creditLots, ecologicalDesigns, envOfftakes, finModels, landCandidates, monitoringPeriods, nurseries, plantingBatches, projects,
  riskTransfers, siteFeatures, species, structureLinks, structureNodes,
} from "@/db/schema";
import type { OfftakeYear, PermanenceScore, SpeciesShare } from "@/db/natural";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { saveDefinition } from "@/lib/finance/engine";
import { landCoverComposition, type SiteGeometry } from "@/lib/geo/landcover";
import { defaultDiligence, moveLand, moveLot, offtakeToRevenueStream, permanenceBuffer, plantsNearSite, recordIssuance } from "@/lib/natural/engine";
import {
  CERT_DOC_TYPES, CERT_STAGES, FUNCTIONAL_GROUPS, INTERVENTIONS, LAND_STAGES, LINK_KINDS, LOT_STATUS, NODE_KINDS, OFFTAKE_KINDS, OFFTAKE_STATUS, PERIOD_STATUS,
  PERMANENCE_FACTORS, PLANTING_STATUS, RISK_TRANSFER, RISK_TRANSFER_STATUS, STANDARDS, TENURE, UNIT_TYPES,
} from "@/lib/natural/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 400) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const cur = (f: FormData) => z.string().regex(/^[A-Z]{3}$/).catch("USD").parse(str(f, "currency", 3).toUpperCase());
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const tab = (projectId: string, sec?: string) => `/projects/${projectId}?tab=natural${sec ? `&sec=${sec}` : ""}`;
type Scope = Parameters<typeof mandateCondition>[0];

async function scopedProject(scope: Scope, id: string) {
  const [p] = await appDb().select().from(projects).where(and(eq(projects.id, id), mandateCondition(scope, projects.mandateId)));
  if (!p) throw new Error("Project not found");
  return p;
}
async function scopedLand(scope: Scope, id: string) {
  const [c] = await appDb().select().from(landCandidates).where(and(eq(landCandidates.id, id), mandateCondition(scope, landCandidates.mandateId)));
  if (!c) throw new Error("Candidate not found");
  return c;
}
async function scopedCert(scope: Scope, id: string) {
  const [c] = await appDb().select().from(certifications).where(and(eq(certifications.id, id), mandateCondition(scope, certifications.mandateId)));
  if (!c) throw new Error("Certification not found");
  return c;
}
function parseGeometry(text: string | null | undefined): SiteGeometry | null {
  try { const j = text ? JSON.parse(text) : null; const g = j?.type === "Feature" ? j.geometry : j; return g?.type === "Polygon" || g?.type === "MultiPolygon" ? g : null; } catch { return null; }
}
function centroid(g: SiteGeometry) {
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
  const n = ring.length || 1;
  return { lng: ring.reduce((a, p) => a + p[0], 0) / n, lat: ring.reduce((a, p) => a + p[1], 0) / n };
}

// ---------- Land pipeline ----------
export async function createLandAction(formData: FormData) {
  let id = "";
  await withOsUser(async user => {
    let geometry: string | null = null, lat = num(formData, "lat"), lng = num(formData, "lng"), hectares = num(formData, "hectares");
    const featureId = zId.safeParse(formData.get("featureId")).data;
    if (featureId) {
      const [f] = await appDb().select().from(siteFeatures).where(and(eq(siteFeatures.id, featureId), mandateCondition(user.scope, siteFeatures.mandateId)));
      if (f) { geometry = f.geometry; const g = parseGeometry(f.geometry); if (g) ({ lat, lng } = centroid(g)); hectares ??= f.measures.areaHa ?? (f.measures.areaM2 ? f.measures.areaM2 / 10_000 : null); }
    }
    const [row] = await appDb().insert(landCandidates).values({
      mandateId: user.scope.mandateIds[0], name: str(formData, "name", 160) || "Unnamed candidate", country: str(formData, "country", 60) || null, subdivision: str(formData, "subdivision", 80) || null,
      lat, lng, geometry, hectares, askingPrice: num(formData, "askingPrice"), currency: cur(formData), tenure: z.enum(keys(TENURE)).catch("unclear").parse(formData.get("tenure")),
      seller: str(formData, "seller", 200), intervention: z.enum(keys(INTERVENTIONS)).nullable().catch(null).parse(formData.get("intervention") || null), capitalRequired: num(formData, "capitalRequired"),
      probabilityPct: num(formData, "probabilityPct"), source: str(formData, "source", 200) || (featureId ? "Atlas workbench" : ""), diligence: defaultDiligence(), owner: user.email,
    }).returning();
    await audit(appDb(), { actor: user.email, action: "land.create", entity: "land_candidate", entityId: row.id, after: { name: row.name } });
    id = row.id;
  });
  redirect(note(`/land/${id}`, "Candidate added to the land pipeline."));
}

export async function updateLandAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedLand(user.scope, id);
    await appDb().update(landCandidates).set({
      name: str(formData, "name", 160) || undefined, hectares: num(formData, "hectares"), askingPrice: num(formData, "askingPrice"), currency: cur(formData),
      tenure: z.enum(keys(TENURE)).catch("unclear").parse(formData.get("tenure")), seller: str(formData, "seller", 200), titleStatus: str(formData, "titleStatus", 400),
      ecosystemCondition: str(formData, "ecosystemCondition", 600), suitability: str(formData, "suitability", 600), optionStatus: str(formData, "optionStatus", 200), optionExpiry: date(formData, "optionExpiry"),
      probabilityPct: num(formData, "probabilityPct"), intervention: z.enum(keys(INTERVENTIONS)).nullable().catch(null).parse(formData.get("intervention") || null), capitalRequired: num(formData, "capitalRequired"),
      lat: num(formData, "lat"), lng: num(formData, "lng"), country: str(formData, "country", 60) || null, notes: str(formData, "notes", 2000), updatedAt: new Date().toISOString(),
    }).where(eq(landCandidates.id, id));
    await audit(appDb(), { actor: user.email, action: "land.update", entity: "land_candidate", entityId: id });
  });
  redirect(note(`/land/${id}`, "Saved."));
}

export async function landDiligenceAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const c = await scopedLand(user.scope, id);
    const item = str(formData, "item", 120);
    const status = z.enum(["open", "in_progress", "clear", "issue", "n/a"]).parse(formData.get("status"));
    const list = c.diligence.some(d => d.item === item) ? c.diligence.map(d => (d.item === item ? { ...d, status, note: str(formData, "note", 400) } : d)) : [...c.diligence, { item, status, note: str(formData, "note", 400) }];
    await appDb().update(landCandidates).set({ diligence: list, updatedAt: new Date().toISOString() }).where(eq(landCandidates.id, id));
    await audit(appDb(), { actor: user.email, action: "land.diligence", entity: "land_candidate", entityId: id, after: { item, status } });
  });
  redirect(note(`/land/${id}`, "Diligence updated."));
}

export async function moveLandAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Stage updated.", to = id;
  await withOsUser(async user => {
    await scopedLand(user.scope, id);
    try {
      const stage = z.enum(keys(LAND_STAGES)).parse(formData.get("stage"));
      const pid = await moveLand(appDb(), id, stage, user.email, str(formData, "dropReason", 400));
      if (stage === "project" && pid) msg = "Project created from the candidate. Its boundary, hectares and capital carry over.";
    } catch (e) { msg = `Not moved: ${(e as Error).message}`; }
    to = id;
  });
  redirect(note(`/land/${to}`, msg));
}

export async function landBaselineAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "";
  await withOsUser(async user => {
    const c = await scopedLand(user.scope, id);
    const g = parseGeometry(c.geometry);
    if (!g) { msg = "Add a boundary (from an Atlas workbench polygon) to read the land-cover baseline."; return; }
    try {
      const b = await landCoverComposition(g);
      await appDb().update(landCandidates).set({ siteBaseline: { ...b, at: new Date().toISOString() }, hectares: c.hectares ?? b.siteHa, updatedAt: new Date().toISOString() }).where(eq(landCandidates.id, id));
      msg = `Land cover read: ${b.naturalHa} ha natural of ${b.siteHa} ha (SCREENING).`;
    } catch (e) { msg = `Baseline failed: ${(e as Error).message}`; }
  });
  redirect(note(`/land/${id}`, msg));
}

// ---------- Structure ----------
export async function addNodeAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const [n] = await appDb().insert(structureNodes).values({ mandateId: p.mandateId, projectId, name: str(formData, "name", 160), kind: z.enum(keys(NODE_KINDS)).parse(formData.get("kind")), jurisdiction: str(formData, "jurisdiction", 60) || null, responsibilities: str(formData, "responsibilities", 600), liabilities: str(formData, "liabilities", 600) }).returning();
    await audit(appDb(), { actor: user.email, action: "structure.node", entity: "structure_node", entityId: n.id, after: { name: n.name, kind: n.kind } });
  });
  redirect(note(tab(projectId, "structure"), "Entity added."));
}

export async function addLinkAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Link added.";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const fromId = zId.parse(formData.get("fromId")), toId = zId.parse(formData.get("toId"));
    if (fromId === toId) { msg = "Pick two different entities."; return; }
    const ns = await appDb().select({ id: structureNodes.id }).from(structureNodes).where(eq(structureNodes.projectId, projectId));
    if (!ns.some(n => n.id === fromId) || !ns.some(n => n.id === toId)) throw new Error("Entities must belong to this project");
    const kind = z.enum(keys(LINK_KINDS)).parse(formData.get("kind"));
    const pct = num(formData, "pct");
    if (kind === "ownership" && (pct === null || pct <= 0 || pct > 100)) { msg = "Ownership needs a percentage between 0 and 100."; return; }
    await appDb().insert(structureLinks).values({ mandateId: p.mandateId, projectId, fromId, toId, kind, pct, amount: num(formData, "amount"), currency: cur(formData), description: str(formData, "description", 300) });
    await audit(appDb(), { actor: user.email, action: "structure.link", entity: "project", entityId: projectId, after: { fromId, toId, kind, pct } });
  });
  redirect(note(tab(projectId, "structure"), msg));
}

export async function deleteStructureAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    const nodeId = zId.safeParse(formData.get("nodeId")).data, linkId = zId.safeParse(formData.get("linkId")).data;
    if (linkId) await appDb().delete(structureLinks).where(and(eq(structureLinks.id, linkId), eq(structureLinks.projectId, projectId)));
    if (nodeId) {
      await appDb().delete(structureLinks).where(and(eq(structureLinks.projectId, projectId), eq(structureLinks.fromId, nodeId)));
      await appDb().delete(structureLinks).where(and(eq(structureLinks.projectId, projectId), eq(structureLinks.toId, nodeId)));
      await appDb().delete(structureNodes).where(and(eq(structureNodes.id, nodeId), eq(structureNodes.projectId, projectId)));
    }
    await audit(appDb(), { actor: user.email, action: "structure.delete", entity: "project", entityId: projectId, before: { nodeId, linkId } });
  });
  redirect(note(tab(projectId, "structure"), "Removed."));
}

export async function saveHorizonsAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const v = { development: num(formData, "development"), financing: num(formData, "financing"), operating: num(formData, "operating"), stewardship: num(formData, "stewardship"), stewardshipPlan: str(formData, "stewardshipPlan", 2000), steward: str(formData, "steward", 200) };
    await appDb().insert(assetHorizons).values({ projectId, mandateId: p.mandateId, ...v }).onConflictDoUpdate({ target: assetHorizons.projectId, set: { ...v, updatedAt: new Date().toISOString() } });
    await audit(appDb(), { actor: user.email, action: "horizons.save", entity: "project", entityId: projectId, after: v });
  });
  redirect(note(tab(projectId, "structure"), "Horizons saved."));
}

// ---------- Production ----------
export async function addSpeciesAction(formData: FormData) {
  const back = str(formData, "back", 200) || "/natural?tab=species";
  await withOsUser(async user => {
    const [s] = await appDb().insert(species).values({
      mandateId: user.scope.mandateIds[0], scientificName: str(formData, "scientificName", 160), commonName: str(formData, "commonName", 160), functionalGroup: z.enum(keys(FUNCTIONAL_GROUPS)).catch("other").parse(formData.get("functionalGroup")),
      native: str(formData, "native", 200), climateTolerance: str(formData, "climateTolerance", 300), soils: str(formData, "soils", 300), uses: str(formData, "uses", 300), rotationYears: num(formData, "rotationYears"), source: str(formData, "source", 300), gbifKey: str(formData, "gbifKey", 20) || null,
    }).returning();
    await audit(appDb(), { actor: user.email, action: "species.create", entity: "species", entityId: s.id, after: { name: s.scientificName } });
  });
  redirect(note(back.startsWith("/") ? back : "/natural?tab=species", "Species added to the catalogue."));
}

export async function addNurseryAction(formData: FormData) {
  await withOsUser(async user => {
    const projectId = zId.safeParse(formData.get("projectId")).data ?? null;
    if (projectId) await scopedProject(user.scope, projectId);
    await appDb().insert(nurseries).values({ mandateId: user.scope.mandateIds[0], name: str(formData, "name", 160), projectId, location: str(formData, "location", 200), capacityPerYear: num(formData, "capacityPerYear"), ownOperated: formData.get("ownOperated") === "on", notes: str(formData, "notes", 600) });
  });
  redirect(note("/natural?tab=production", "Nursery recorded."));
}

export async function addPlantingAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const qty = num(formData, "quantity");
    if (!qty || qty <= 0) throw new Error("Quantity is required");
    await appDb().insert(plantingBatches).values({
      mandateId: p.mandateId, projectId, speciesId: zId.parse(formData.get("speciesId")), nurseryId: zId.safeParse(formData.get("nurseryId")).data ?? null, provenance: str(formData, "provenance", 300),
      quantity: Math.round(qty), areaHa: num(formData, "areaHa"), season: str(formData, "season", 60), plantedDate: date(formData, "plantedDate"), status: z.enum(keys(PLANTING_STATUS)).catch("planned").parse(formData.get("status")),
      unitCost: num(formData, "unitCost"), establishmentCostPerHa: num(formData, "establishmentCostPerHa"), currency: cur(formData), crew: str(formData, "crew", 200), maintenanceCycle: str(formData, "maintenanceCycle", 200),
    });
  });
  redirect(note(tab(projectId, "production"), "Planting batch recorded."));
}

export async function survivalCheckAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Survival check recorded.";
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    const id = zId.parse(formData.get("batchId"));
    const [b] = await appDb().select().from(plantingBatches).where(and(eq(plantingBatches.id, id), eq(plantingBatches.projectId, projectId)));
    if (!b) throw new Error("Batch not found");
    const pct = num(formData, "survivalPct");
    if (pct === null || pct < 0 || pct > 100) { msg = "Survival must be 0–100%."; return; }
    const d = date(formData, "date") ?? new Date().toISOString().slice(0, 10);
    const replace = num(formData, "replacementQty");
    await appDb().update(plantingBatches).set({ survival: [...b.survival, { date: d, survivalPct: pct, note: str(formData, "note", 300) }], replacementQty: b.replacementQty + Math.max(0, Math.round(replace ?? 0)), status: pct < 20 ? "failed" : b.status === "planted" ? "establishing" : b.status, updatedAt: new Date().toISOString() }).where(eq(plantingBatches.id, id));
    await audit(appDb(), { actor: user.email, action: "planting.survival", entity: "planting_batch", entityId: id, after: { date: d, pct } });
  });
  redirect(note(tab(projectId, "production"), msg));
}

// ---------- Ecological design ----------
export async function createDesignAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Design created.";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const factors: Record<string, unknown> = {};
    if (p.lat !== null && p.lng !== null) {
      try { const g = await plantsNearSite(appDb(), p.lat, p.lng, 25); factors.gbifPlants = g.species; factors.gbifNote = g.note; factors.gbifUrl = g.sourceUrl; }
      catch (e) { msg = `Design created; GBIF plant records unavailable (${(e as Error).message}).`; }
    }
    const [d] = await appDb().insert(ecologicalDesigns).values({ mandateId: p.mandateId, projectId, name: str(formData, "name", 160) || "Ecological design", intervention: z.enum(keys(INTERVENTIONS)).parse(formData.get("intervention")), climateScenario: str(formData, "climateScenario", 200), siteFactors: factors, rationale: str(formData, "rationale", 2000), localKnowledge: str(formData, "localKnowledge", 2000), costPerHa: num(formData, "costPerHa") }).returning();
    await audit(appDb(), { actor: user.email, action: "design.create", entity: "ecological_design", entityId: d.id });
  });
  redirect(note(tab(projectId, "design"), msg));
}

export async function designSpeciesAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Species added to the mix.";
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    const id = zId.parse(formData.get("designId"));
    const [d] = await appDb().select().from(ecologicalDesigns).where(and(eq(ecologicalDesigns.id, id), eq(ecologicalDesigns.projectId, projectId)));
    if (!d) throw new Error("Design not found");
    const share = num(formData, "sharePct") ?? 0;
    const rationale = str(formData, "rationale", 400);
    if (!rationale) { msg = "Give the rationale (site fit, function, evidence)."; return; }
    const mix: SpeciesShare[] = [...d.mix.filter(m => m.speciesId !== formData.get("speciesId")), { speciesId: zId.parse(formData.get("speciesId")), sharePct: share, rationale }];
    if (mix.reduce((a, m) => a + m.sharePct, 0) > 100.001) { msg = "Shares exceed 100%."; return; }
    await appDb().update(ecologicalDesigns).set({ mix, status: "draft", updatedAt: new Date().toISOString() }).where(eq(ecologicalDesigns.id, id));
  });
  redirect(note(tab(projectId, "design"), msg));
}

export async function reviewDesignAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Design status updated.";
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    const id = zId.parse(formData.get("designId"));
    const [d] = await appDb().select().from(ecologicalDesigns).where(and(eq(ecologicalDesigns.id, id), eq(ecologicalDesigns.projectId, projectId)));
    if (!d) throw new Error("Design not found");
    const status = z.enum(["draft", "reviewed", "adopted"]).parse(formData.get("status"));
    const evidence = str(formData, "evidence", 1000) || d.evidence;
    if (status !== "draft" && (!d.mix.length || !evidence)) { msg = "A reviewed design needs a species mix and evidence (ecologist review, trials, literature)."; return; }
    await appDb().update(ecologicalDesigns).set({ status, evidence, reviewedBy: status === "draft" ? null : user.email, updatedAt: new Date().toISOString() }).where(eq(ecologicalDesigns.id, id));
    await audit(appDb(), { actor: user.email, action: "design.status", entity: "ecological_design", entityId: id, after: { status } });
  });
  redirect(note(tab(projectId, "design"), msg));
}

// ---------- Certification & MRV ----------
export async function createCertificationAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    const [c] = await appDb().insert(certifications).values({
      mandateId: p.mandateId, projectId, name: str(formData, "name", 160) || p.name, standard: z.enum(keys(STANDARDS)).parse(formData.get("standard")), methodology: str(formData, "methodology", 200),
      registryId: str(formData, "registryId", 60) || null, registryUrl: str(formData, "registryUrl", 400) || null, unitType: z.enum(keys(UNIT_TYPES)).catch("carbon").parse(formData.get("unitType")),
      stage: z.enum(keys(CERT_STAGES)).catch("feasibility").parse(formData.get("stage")), creditingStart: date(formData, "creditingStart"), creditingEnd: date(formData, "creditingEnd"), lifetimeYears: num(formData, "lifetimeYears"),
      validationBody: str(formData, "validationBody", 160), verificationBody: str(formData, "verificationBody", 160), baseline: str(formData, "baseline", 1000), nextVerification: date(formData, "nextVerification"),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "certification.create", entity: "certification", entityId: c.id, after: { standard: c.standard } });
  });
  redirect(note(tab(projectId, "certification"), "Certification record created. The data room below lists the documents each stage expects."));
}

export async function updateCertificationAction(formData: FormData) {
  const id = zId.parse(formData.get("certificationId"));
  let projectId = "";
  await withOsUser(async user => {
    const c = await scopedCert(user.scope, id);
    projectId = c.projectId;
    const stage = z.enum(keys(CERT_STAGES)).catch(c.stage).parse(formData.get("stage"));
    await appDb().update(certifications).set({ stage, registryId: str(formData, "registryId", 60) || null, methodology: str(formData, "methodology", 200), validationBody: str(formData, "validationBody", 160), verificationBody: str(formData, "verificationBody", 160), nextVerification: date(formData, "nextVerification"), baseline: str(formData, "baseline", 1000), updatedAt: new Date().toISOString() }).where(eq(certifications.id, id));
    await audit(appDb(), { actor: user.email, action: "certification.update", entity: "certification", entityId: id, before: { stage: c.stage }, after: { stage } });
  });
  redirect(note(tab(projectId, "certification"), "Certification updated."));
}

export async function permanenceAction(formData: FormData) {
  const id = zId.parse(formData.get("certificationId"));
  let projectId = "", msg = "";
  await withOsUser(async user => {
    const c = await scopedCert(user.scope, id);
    projectId = c.projectId;
    const factors = Object.values(PERMANENCE_FACTORS).flatMap(g => Object.keys(g));
    const scores: PermanenceScore[] = factors.map(f => ({ factor: f, score: num(formData, `score_${f}`) ?? 0, mitigation: str(formData, `mit_${f}`, 300), evidence: str(formData, `ev_${f}`, 300) }));
    const b = permanenceBuffer(scores);
    const override = num(formData, "bufferPct");
    await appDb().update(certifications).set({ permanence: scores, bufferPct: override ?? b.bufferPct, permanenceSource: str(formData, "permanenceSource", 300), updatedAt: new Date().toISOString() }).where(eq(certifications.id, id));
    await audit(appDb(), { actor: user.email, action: "certification.permanence", entity: "certification", entityId: id, after: { rating: b.rating, bufferPct: override ?? b.bufferPct } });
    msg = `Risk rating ${b.rating} → indicative buffer ${b.bufferPct}%${b.eligible ? "" : " (above 60: not eligible under the tool)"}${override !== null ? `; buffer set to ${override}% from the validated report` : ""}.`;
  });
  redirect(note(tab(projectId, "certification"), msg));
}

export async function addCertDocAction(formData: FormData) {
  const id = zId.parse(formData.get("certificationId"));
  let projectId = "";
  await withOsUser(async user => {
    const c = await scopedCert(user.scope, id);
    projectId = c.projectId;
    await appDb().insert(certDocuments).values({ mandateId: c.mandateId, certificationId: id, docType: z.enum(keys(CERT_DOC_TYPES)).parse(formData.get("docType")), title: str(formData, "title", 200) || "Document", version: str(formData, "version", 20) || "1", docDate: date(formData, "docDate"), url: str(formData, "url", 500) || null, status: z.enum(["draft", "final", "registry_published", "superseded"]).catch("draft").parse(formData.get("status")), addedBy: user.email });
    await audit(appDb(), { actor: user.email, action: "certification.document", entity: "certification", entityId: id });
  });
  redirect(note(tab(projectId, "certification"), "Document recorded."));
}

export async function addPeriodAction(formData: FormData) {
  const id = zId.parse(formData.get("certificationId"));
  let projectId = "", msg = "Monitoring period added.";
  await withOsUser(async user => {
    const c = await scopedCert(user.scope, id);
    projectId = c.projectId;
    const start = date(formData, "start"), end = date(formData, "end");
    if (!start || !end || end <= start) { msg = "Give a start and a later end date."; return; }
    const est = num(formData, "estimatedUnits");
    const [p] = await appDb().insert(monitoringPeriods).values({ mandateId: c.mandateId, certificationId: id, start, end, estimatedUnits: est }).returning();
    if (est && est > 0) await appDb().insert(creditLots).values({ mandateId: c.mandateId, certificationId: id, periodId: p.id, vintage: end.slice(0, 4), quantity: est, status: "forecast", history: [{ at: new Date().toISOString(), from: "", to: "forecast", by: user.email, note: "Monitoring period estimate" }] });
  });
  redirect(note(tab(projectId, "certification"), msg));
}

export async function updatePeriodAction(formData: FormData) {
  const id = zId.parse(formData.get("certificationId"));
  let projectId = "", msg = "Period updated.";
  await withOsUser(async user => {
    const c = await scopedCert(user.scope, id);
    projectId = c.projectId;
    const pid = zId.parse(formData.get("periodId"));
    const status = z.enum(keys(PERIOD_STATUS)).parse(formData.get("status"));
    try {
      if (status === "issued") {
        await recordIssuance(appDb(), pid, { issued: num(formData, "issued") ?? 0, buffer: num(formData, "buffer") ?? 0, vintage: str(formData, "vintage", 9), serialStart: str(formData, "serialStart", 120) || undefined, serialEnd: str(formData, "serialEnd", 120) || undefined, date: date(formData, "date") ?? new Date().toISOString().slice(0, 10) }, user.email);
        // Forecast lots for the period are superseded by the issuance.
        const forecast = await appDb().select().from(creditLots).where(and(eq(creditLots.periodId, pid), eq(creditLots.status, "forecast")));
        for (const l of forecast) await moveLot(appDb(), l.id, "cancelled", user.email, { note: "Superseded by issuance" });
        msg = "Issuance recorded: issued units and the buffer contribution are now in the inventory.";
      } else {
        const verified = num(formData, "verifiedUnits");
        if (status === "verified" && verified === null) { msg = "Record the verified units."; return; }
        await appDb().update(monitoringPeriods).set({ status, verifiedUnits: verified, verifier: str(formData, "verifier", 160), reportDate: date(formData, "reportDate"), verifiedDate: status === "verified" ? (date(formData, "date") ?? new Date().toISOString().slice(0, 10)) : null, updatedAt: new Date().toISOString() }).where(and(eq(monitoringPeriods.id, pid), eq(monitoringPeriods.certificationId, id)));
        await audit(appDb(), { actor: user.email, action: "monitoring_period.update", entity: "monitoring_period", entityId: pid, after: { status, verified } });
      }
    } catch (e) { msg = `Not updated: ${(e as Error).message}`; }
  });
  redirect(note(tab(projectId, "certification"), msg));
}

export async function addLotAction(formData: FormData) {
  const id = zId.parse(formData.get("certificationId"));
  let projectId = "";
  await withOsUser(async user => {
    const c = await scopedCert(user.scope, id);
    projectId = c.projectId;
    const q = num(formData, "quantity");
    if (!q || q <= 0) throw new Error("Quantity required");
    await appDb().insert(creditLots).values({ mandateId: c.mandateId, certificationId: id, vintage: str(formData, "vintage", 9), quantity: q, status: "forecast", history: [{ at: new Date().toISOString(), from: "", to: "forecast", by: user.email, note: str(formData, "note", 200) || "Forecast" }] });
  });
  redirect(note(tab(projectId, "inventory"), "Forecast lot added."));
}

export async function moveLotAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Inventory updated.";
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    const lotId = zId.parse(formData.get("lotId"));
    const [l] = await appDb().select({ certificationId: creditLots.certificationId }).from(creditLots).where(eq(creditLots.id, lotId));
    if (!l) throw new Error("Lot not found");
    const [c] = await appDb().select({ projectId: certifications.projectId }).from(certifications).where(eq(certifications.id, l.certificationId));
    if (c?.projectId !== projectId) throw new Error("Lot not in this project");
    try {
      const offtakeId = zId.safeParse(formData.get("offtakeId")).data ?? null;
      await moveLot(appDb(), lotId, z.enum(keys(LOT_STATUS)).parse(formData.get("to")), user.email, { quantity: num(formData, "quantity") ?? undefined, price: num(formData, "price"), offtakeId, serialStart: str(formData, "serialStart", 120) || null, serialEnd: str(formData, "serialEnd", 120) || null, beneficiary: str(formData, "beneficiary", 200) || undefined, note: str(formData, "note", 300) || undefined });
    } catch (e) { msg = `Not moved: ${(e as Error).message}`; }
  });
  redirect(note(tab(projectId, "inventory"), msg));
}

// ---------- Offtake and risk transfer ----------
function parseSchedule(text: string): OfftakeYear[] {
  // "2027:50000, 2028:50000@22" → year:volume[@price]
  return text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(\d{4})\s*[:=]\s*([\d.]+)(?:\s*@\s*([\d.]+))?$/.exec(s);
    if (!m) throw new Error(`Schedule entry "${s}" should look like 2027:50000 or 2027:50000@22`);
    return { year: Number(m[1]), volume: Number(m[2]), price: m[3] ? Number(m[3]) : null };
  }).sort((a, b) => a.year - b.year);
}

export async function saveOfftakeAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "Offtake recorded.";
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    let schedule: OfftakeYear[];
    try { schedule = parseSchedule(str(formData, "schedule", 2000)); } catch (e) { msg = (e as Error).message; return; }
    const [o] = await appDb().insert(envOfftakes).values({
      mandateId: p.mandateId, projectId, certificationId: zId.safeParse(formData.get("certificationId")).data ?? null, name: str(formData, "name", 160) || "Environmental offtake",
      kind: z.enum(keys(OFFTAKE_KINDS)).parse(formData.get("kind")), status: z.enum(keys(OFFTAKE_STATUS)).catch("prospect").parse(formData.get("status")), buyerName: str(formData, "buyerName", 200), unit: str(formData, "unit", 20) || "tCO2e",
      schedule, price: num(formData, "price"), floorPrice: num(formData, "floorPrice"), escalationPct: num(formData, "escalationPct") ?? 0, currency: cur(formData), prepayment: num(formData, "prepayment"), developmentFunding: num(formData, "developmentFunding"),
      performanceConditions: str(formData, "performanceConditions", 1000), certificationDependent: formData.get("certificationDependent") === "on", replacementObligation: str(formData, "replacementObligation", 600), counterpartyRisk: str(formData, "counterpartyRisk", 400), signedDate: date(formData, "signedDate"),
    }).returning();
    await audit(appDb(), { actor: user.email, action: "offtake.create", entity: "env_offtake", entityId: o.id, after: { name: o.name, kind: o.kind } });
  });
  redirect(note(tab(projectId, "offtake"), msg));
}

export async function offtakeToModelAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "";
  await withOsUser(async user => {
    await scopedProject(user.scope, projectId);
    const [o] = await appDb().select().from(envOfftakes).where(and(eq(envOfftakes.id, zId.parse(formData.get("offtakeId"))), eq(envOfftakes.projectId, projectId)));
    const [m] = await appDb().select().from(finModels).where(and(eq(finModels.id, zId.parse(formData.get("modelId"))), eq(finModels.projectId, projectId)));
    if (!o || !m) throw new Error("Offtake or model not found");
    const codYear = num(formData, "codYear");
    if (!codYear) { msg = "Give the calendar year of COD (operating year 1)."; return; }
    const stream = offtakeToRevenueStream(o, codYear);
    const def = { ...m.definition, revenue: [...m.definition.revenue.filter(s => s.id !== stream.id), stream] };
    try { await saveDefinition(appDb(), m.id, def, `Environmental offtake ${o.name} linked`, user.email); msg = `Added to ${m.name} as ${stream.certainty} ${stream.revenueClass?.replace("_", " ")} revenue.`; }
    catch (e) { msg = `Not added: ${(e as Error).message}`; }
  });
  redirect(note(tab(projectId, "offtake"), msg));
}

export async function addRiskTransferAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  await withOsUser(async user => {
    const p = await scopedProject(user.scope, projectId);
    await appDb().insert(riskTransfers).values({ mandateId: p.mandateId, projectId, kind: z.enum(keys(RISK_TRANSFER)).parse(formData.get("kind")), status: z.enum(keys(RISK_TRANSFER_STATUS)).catch("identified").parse(formData.get("status")), provider: str(formData, "provider", 200), coverage: num(formData, "coverage"), premium: num(formData, "premium"), currency: cur(formData), start: date(formData, "start"), end: date(formData, "end"), covers: str(formData, "covers", 600), bankabilityNote: str(formData, "bankabilityNote", 600) });
    await audit(appDb(), { actor: user.email, action: "risk_transfer.create", entity: "project", entityId: projectId });
  });
  redirect(note(tab(projectId, "risk"), "Risk transfer recorded."));
}
