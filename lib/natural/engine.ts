// Natural asset operating engine. Land pipeline gates, environmental inventory ledger (forward-only, audited, splits),
// issuance from monitoring periods, permanence buffer (indicative), offtake schedules into the financial model,
// offtake coverage against expected issuance, certification data-room completeness, structure graph layout, and
// plant species recorded near a site (GBIF) as input to ecological design. Nothing here certifies anything.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { certDocuments, creditLots, envOfftakes, landCandidates, monitoringPeriods, projects, structureLinks, structureNodes } from "@/db/schema";
import type { DiligenceItem, LotEvent, PermanenceScore } from "@/db/natural";
import type { Db } from "@/db";
import { audit } from "@/lib/audit";
import type { RevenueStream } from "@/lib/finance/types";
import { createProject } from "@/lib/projects/engine";
import { fetchJson } from "@/lib/sources/http";
import { CERT_DOC_EXPECTED, CERT_STAGES, LAND_DILIGENCE, LAND_FLOW, LOT_FLOW, NODE_KINDS, type LAND_STAGES, type LOT_STATUS } from "./vocab";

type Land = typeof landCandidates.$inferSelect;
type Lot = typeof creditLots.$inferSelect;
type Offtake = typeof envOfftakes.$inferSelect;

// ---------- Land pipeline ----------
export const defaultDiligence = (): DiligenceItem[] => LAND_DILIGENCE.map(item => ({ item, status: "open", note: "" }));

/** Gate for moving a land candidate: forward along the funnel only (drop any time, with a reason). */
export function landGate(c: Pick<Land, "stage" | "diligence" | "hectares" | "geometry" | "lat">, to: keyof typeof LAND_STAGES, dropReason?: string): string | null {
  if (to === "dropped") return dropReason?.trim() ? null : "Give a reason for dropping the candidate";
  if (c.stage === "dropped") return "Dropped candidates are closed; add a new candidate to revisit";
  const from = LAND_FLOW.indexOf(c.stage as (typeof LAND_FLOW)[number]), target = LAND_FLOW.indexOf(to as (typeof LAND_FLOW)[number]);
  if (target <= from) return "Land stages only move forward";
  if (target >= LAND_FLOW.indexOf("screening") && !c.geometry && c.lat === null) return "Add a location or boundary before screening";
  if (target >= LAND_FLOW.indexOf("option") && !c.diligence.some(d => d.status !== "open")) return "Start diligence before taking an option";
  const blocking = c.diligence.filter(d => d.status === "open" || d.status === "in_progress" || d.status === "issue");
  if (target >= LAND_FLOW.indexOf("acquisition") && blocking.length) return `Diligence must be clear (or n/a) before acquisition: ${blocking.map(d => d.item).join(", ")}`;
  if (target >= LAND_FLOW.indexOf("acquisition") && !c.hectares) return "Record the hectares before acquisition";
  return null;
}

export async function moveLand(db: Db, id: string, to: keyof typeof LAND_STAGES, actor: string, dropReason?: string) {
  const [c] = await db.select().from(landCandidates).where(eq(landCandidates.id, id));
  if (!c) throw new Error("Candidate not found");
  const why = landGate(c, to, dropReason);
  if (why) throw new Error(why);
  let projectId = c.projectId;
  if (to === "project" && !projectId) {
    const p = await createProject(db, { mandateId: c.mandateId, name: c.name }, actor);
    await db.update(projects).set({ country: c.country, subdivision: c.subdivision, lat: c.lat, lng: c.lng, geometry: c.geometry, capacity: c.hectares, capacityUnit: "ha", capex: c.capitalRequired, currency: c.currency, description: `From the land pipeline. Intended intervention: ${c.intervention ?? "not set"}.` }).where(eq(projects.id, p.id));
    projectId = p.id;
  }
  await db.update(landCandidates).set({ stage: to, dropReason: to === "dropped" ? dropReason!.trim() : c.dropReason, projectId, updatedAt: new Date().toISOString() }).where(eq(landCandidates.id, id));
  await audit(db, { actor, action: "land.stage", entity: "land_candidate", entityId: id, before: { stage: c.stage }, after: { stage: to, projectId } });
  return projectId;
}

export function landFunnel(rows: Land[]) {
  return LAND_FLOW.map(stage => {
    const xs = rows.filter(r => r.stage === stage);
    return { stage, count: xs.length, hectares: xs.reduce((a, r) => a + (r.hectares ?? 0), 0), capital: xs.reduce((a, r) => a + (r.capitalRequired ?? 0), 0), weighted: xs.reduce((a, r) => a + (r.capitalRequired ?? 0) * (r.probabilityPct ?? 0) / 100, 0) };
  });
}

// ---------- Environmental inventory ledger ----------
const rank = (s: string) => LOT_FLOW.indexOf(s as (typeof LOT_FLOW)[number]);

/** Move all or part of a lot forward. Partial moves split the lot; the history travels with both parts. */
export async function moveLot(db: Db, lotId: string, to: keyof typeof LOT_STATUS, actor: string, o: { quantity?: number; price?: number | null; buyerOrgId?: string | null; offtakeId?: string | null; serialStart?: string | null; serialEnd?: string | null; date?: string; beneficiary?: string; note?: string } = {}) {
  const [lot] = await db.select().from(creditLots).where(eq(creditLots.id, lotId));
  if (!lot) throw new Error("Lot not found");
  if (lot.status === "retired" || lot.status === "cancelled") throw new Error("Retired and cancelled units are final");
  if (to === "buffer") { if (lot.status !== "issued") throw new Error("Only issued units go to the buffer pool"); }
  else if (to === "cancelled") { if (!o.note?.trim()) throw new Error("Give the reason for a cancellation (e.g. reversal)"); }
  else if (lot.status === "buffer") throw new Error("Buffer units stay in the pool unless cancelled");
  else if (rank(to) <= rank(lot.status)) throw new Error("Inventory only moves forward");
  if ((to === "contracted" || to === "delivered") && !(o.offtakeId ?? lot.offtakeId) && !(o.buyerOrgId ?? lot.buyerOrgId)) throw new Error("Link a buyer or an offtake before contracting or delivering");
  if (rank(to) >= rank("issued") && rank(lot.status) < rank("verified") && to !== "cancelled") throw new Error("Units must be verified before issuance");
  if (to === "retired" && !o.beneficiary?.trim() && !lot.retirementBeneficiary) throw new Error("Record the retirement beneficiary");
  const qty = o.quantity ?? lot.quantity;
  if (!(qty > 0) || qty > lot.quantity + 1e-9) throw new Error(`Quantity must be between 0 and ${lot.quantity}`);
  const ev: LotEvent = { at: new Date().toISOString(), from: lot.status, to, by: actor, note: o.note };
  const patch = {
    status: to, price: o.price ?? lot.price, buyerOrgId: o.buyerOrgId ?? lot.buyerOrgId, offtakeId: o.offtakeId ?? lot.offtakeId,
    serialStart: o.serialStart ?? lot.serialStart, serialEnd: o.serialEnd ?? lot.serialEnd,
    deliveredDate: to === "delivered" ? (o.date ?? ev.at.slice(0, 10)) : lot.deliveredDate, retiredDate: to === "retired" ? (o.date ?? ev.at.slice(0, 10)) : lot.retiredDate,
    retirementBeneficiary: o.beneficiary ?? lot.retirementBeneficiary, updatedAt: ev.at,
  };
  let movedId = lot.id;
  if (qty < lot.quantity) {
    await db.update(creditLots).set({ quantity: lot.quantity - qty, updatedAt: ev.at }).where(eq(creditLots.id, lot.id));
    const [n] = await db.insert(creditLots).values({ ...lot, id: undefined, ...patch, quantity: qty, parentId: lot.id, history: [...lot.history, ev], createdAt: undefined }).returning();
    movedId = n.id;
  } else {
    await db.update(creditLots).set({ ...patch, history: [...lot.history, ev] }).where(eq(creditLots.id, lot.id));
  }
  await audit(db, { actor, action: "credit_lot.move", entity: "credit_lot", entityId: movedId, before: { status: lot.status, quantity: lot.quantity }, after: { status: to, quantity: qty } });
  return movedId;
}

/** Record an issuance on a verified monitoring period: issued units and the buffer contribution become lots. */
export async function recordIssuance(db: Db, periodId: string, input: { issued: number; buffer: number; vintage: string; serialStart?: string; serialEnd?: string; date: string }, actor: string) {
  const [p] = await db.select().from(monitoringPeriods).where(eq(monitoringPeriods.id, periodId));
  if (!p) throw new Error("Monitoring period not found");
  if (p.status !== "verified") throw new Error("Only a verified monitoring period can be issued");
  if (p.verifiedUnits !== null && input.issued + input.buffer > p.verifiedUnits + 1e-6) throw new Error(`Issued plus buffer exceeds verified units (${p.verifiedUnits})`);
  const ev = (to: string): LotEvent => ({ at: new Date().toISOString(), from: "verified", to, by: actor, note: "Issuance" });
  const base = { mandateId: p.mandateId, certificationId: p.certificationId, periodId, vintage: input.vintage };
  await db.insert(creditLots).values([
    { ...base, quantity: input.issued, status: "issued", serialStart: input.serialStart ?? null, serialEnd: input.serialEnd ?? null, history: [ev("issued")] },
    ...(input.buffer > 0 ? [{ ...base, quantity: input.buffer, status: "buffer" as const, history: [ev("buffer")] }] : []),
  ]);
  await db.update(monitoringPeriods).set({ status: "issued", issuedUnits: input.issued, bufferUnits: input.buffer, issuanceDate: input.date, updatedAt: new Date().toISOString() }).where(eq(monitoringPeriods.id, periodId));
  await audit(db, { actor, action: "monitoring_period.issue", entity: "monitoring_period", entityId: periodId, after: input });
}

export function inventorySummary(lots: Lot[]) {
  const by: Record<string, number> = {};
  for (const l of lots) by[l.status] = (by[l.status] ?? 0) + l.quantity;
  const expected = (by.forecast ?? 0) + (by.validated ?? 0) + (by.verified ?? 0);
  const onHand = (by.issued ?? 0) + (by.available ?? 0);
  const sold = lots.filter(l => (l.status === "contracted" || l.status === "delivered" || l.status === "retired") && l.price !== null);
  const soldQty = sold.reduce((a, l) => a + l.quantity, 0);
  return { by, expected, onHand, committed: (by.contracted ?? 0), delivered: (by.delivered ?? 0) + (by.retired ?? 0), buffer: by.buffer ?? 0, avgPrice: soldQty ? sold.reduce((a, l) => a + l.quantity * (l.price ?? 0), 0) / soldQty : null };
}

// ---------- Permanence ----------
/** Indicative buffer after the VCS AFOLU Non-Permanence Risk Tool: risk rating = internal + external + natural scores,
 *  buffer = rating with a 10% floor; a rating above 60 fails. The validated risk report always governs. */
export function permanenceBuffer(scores: PermanenceScore[]) {
  const total = scores.reduce((a, s) => a + (Number.isFinite(s.score) ? s.score : 0), 0);
  return { rating: Math.round(total * 10) / 10, bufferPct: Math.max(10, Math.round(total * 10) / 10), eligible: total <= 60 };
}

// ---------- Environmental offtake ----------
export function offtakeRevenue(o: Pick<Offtake, "schedule" | "price" | "floorPrice" | "escalationPct" | "prepayment">) {
  const first = o.schedule.length ? Math.min(...o.schedule.map(s => s.year)) : 0;
  const rows = o.schedule.map(s => {
    const base = s.price ?? o.price ?? o.floorPrice ?? 0;
    const price = Math.max(o.floorPrice ?? 0, base * (1 + o.escalationPct / 100) ** (s.year - first));
    return { year: s.year, volume: s.volume, price, revenue: s.volume * price };
  });
  return { rows, total: rows.reduce((a, r) => a + r.revenue, 0), volume: rows.reduce((a, r) => a + r.volume, 0), prepayment: o.prepayment ?? 0 };
}

/** A contracted environmental revenue stream for the financial model (operating year 1 = codYear). */
export function offtakeToRevenueStream(o: Offtake, codYear: number): RevenueStream {
  const r = offtakeRevenue(o);
  const years = r.rows.map(x => x.year);
  const start = years.length ? Math.min(...years) : codYear;
  const avgVol = r.rows.length ? r.volume / r.rows.length : 0;
  const signed = o.status === "signed" || o.status === "delivering";
  return {
    id: `offtake-${o.id}`, label: o.name, type: o.kind, certainty: signed ? "contracted" : "forecast", revenueClass: signed ? "contracted_environmental" : "variable_environmental",
    basis: "fixed", annualVolume: Math.round(avgVol), unit: o.unit, price: r.rows[0]?.price ?? o.price ?? 0, escalationPct: o.escalationPct,
    startYear: Math.max(1, start - codYear + 1), termYears: r.rows.length, tailPrice: 0, shareOfGeneration: 0,
    source: `Environmental offtake: ${o.name}${o.buyerName ? ` (${o.buyerName})` : ""}`, date: o.signedDate, owner: null, confidence: signed ? "moderate" : "low", status: signed ? "supported" : "preliminary",
    comment: o.certificationDependent ? "Depends on certification and issuance; see permanence buffer and replacement obligations." : undefined,
  };
}

/** Contracted volume by year against expected issuance (forecast + validated + verified + on hand, by vintage). */
export function offtakeCoverage(offtakes: Offtake[], lots: Lot[]) {
  const years = new Map<number, { contracted: number; expected: number }>();
  for (const o of offtakes) if (o.status !== "terminated" && o.status !== "prospect") for (const s of o.schedule) { const y = years.get(s.year) ?? { contracted: 0, expected: 0 }; y.contracted += s.volume; years.set(s.year, y); }
  for (const l of lots) if (["forecast", "validated", "verified", "issued", "available"].includes(l.status)) { const yr = Number(l.vintage.slice(0, 4)); if (!yr) continue; const y = years.get(yr) ?? { contracted: 0, expected: 0 }; y.expected += l.quantity; years.set(yr, y); }
  return [...years].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v, gap: v.expected - v.contracted }));
}

// ---------- Certification data room ----------
export function dataRoom(stage: keyof typeof CERT_STAGES, docs: Pick<typeof certDocuments.$inferSelect, "docType" | "status">[]) {
  const order = Object.keys(CERT_STAGES) as (keyof typeof CERT_STAGES)[];
  const idx = order.indexOf(stage);
  const expected = new Set<string>();
  for (const [s, types] of Object.entries(CERT_DOC_EXPECTED)) if (order.indexOf(s as keyof typeof CERT_STAGES) <= idx) types.forEach(t => expected.add(t));
  const have = new Set(docs.filter(d => d.status !== "superseded").map(d => d.docType));
  return { expected: [...expected], missing: [...expected].filter(t => !have.has(t as never)) };
}

// ---------- Structure graph ----------
const ROW: Record<keyof typeof NODE_KINDS, number> = { investor: 0, lender: 0, insurer: 0, client: 0, holdco: 1, manager: 1, project_spv: 2, land_spv: 2, opco: 2, nursery: 2, asset: 3, offtaker: 3, community: 3, other: 3 };
export function structureLayout(nodes: (typeof structureNodes.$inferSelect)[], width = 900) {
  const rows = new Map<number, typeof nodes>();
  for (const n of nodes) { const r = ROW[n.kind]; rows.set(r, [...(rows.get(r) ?? []), n]); }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [r, ns] of rows) ns.forEach((n, i) => pos.set(n.id, { x: Math.round(((i + 1) * width) / (ns.length + 1)), y: 50 + r * 120 }));
  return { pos, height: 50 + Math.max(0, ...rows.keys()) * 120 + 60 };
}

export async function projectStructure(db: Db, projectId: string) {
  const [nodes, links] = await Promise.all([db.select().from(structureNodes).where(eq(structureNodes.projectId, projectId)), db.select().from(structureLinks).where(eq(structureLinks.projectId, projectId))]);
  return { nodes, links };
}

// ---------- Species recorded near a site (GBIF, keyless) ----------
const zFacet = z.object({ count: z.number(), facets: z.array(z.object({ counts: z.array(z.object({ name: z.string(), count: z.number() })) })).optional() });
const zSpecies = z.object({ key: z.number(), scientificName: z.string().optional(), canonicalName: z.string().optional(), family: z.string().optional(), vernacularName: z.string().optional() }).passthrough();
/** Plant species most recorded within ~11 km: a candidate list for ecological design and local-knowledge review. */
export async function plantsNearSite(db: Db, lat: number, lng: number, limit = 30, fetchImpl?: typeof fetch) {
  const d = 0.1, r3 = (x: number) => Math.round(x * 1000) / 1000;
  const box = `decimalLatitude=${r3(lat - d)},${r3(lat + d)}&decimalLongitude=${r3(lng - d)},${r3(lng + d)}`;
  const f = await fetchJson(db, { provider: "gbif", endpoint: "plant_facet", url: `https://api.gbif.org/v1/occurrence/search?${box}&kingdomKey=6&taxonRank=SPECIES&limit=0&facet=speciesKey&facetLimit=${limit}`, schema: zFacet, cacheKey: `plants:${box}:${limit}`, cacheTtlMs: 90 * 86_400_000, staleOnError: true, fetchImpl });
  const counts = f.facets?.[0]?.counts ?? [];
  const out: { key: string; name: string; family: string; records: number }[] = [];
  for (const c of counts) {
    const s = await fetchJson(db, { provider: "gbif", endpoint: "species", url: `https://api.gbif.org/v1/species/${encodeURIComponent(c.name)}`, schema: zSpecies, cacheKey: `sp:${c.name}`, cacheTtlMs: 365 * 86_400_000, staleOnError: true, fetchImpl }).catch(() => null);
    out.push({ key: c.name, name: s?.canonicalName ?? s?.scientificName ?? c.name, family: s?.family ?? "", records: c.count });
  }
  return { total: f.count, species: out, sourceUrl: `https://www.gbif.org/occurrence/search?${box}&taxon_key=6`, note: "Recorded occurrences (presence-only, observer-biased; includes planted and introduced species). A candidate list for review by an ecologist, not a design." };
}

export async function lotsForCertifications(db: Db, certIds: string[]) {
  return certIds.length ? db.select().from(creditLots).where(inArray(creditLots.certificationId, certIds)) : [];
}
export async function offtakesForProject(db: Db, projectId: string) {
  return db.select().from(envOfftakes).where(and(eq(envOfftakes.projectId, projectId)));
}
