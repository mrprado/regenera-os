// Pure procurement logic (docs/plans/phase-6.md M9): weighted bid evaluation, embodied carbon from EPDs only, and
// matching the builders/suppliers network to a project. No I/O.
import { CRITERIA, DEFAULT_WEIGHTS, LCA_STAGES, type Criterion, type LcaStage } from "./vocab";

type BidLike = { id: string; bidder: string; status: string; price: number | null; currency: string; scores: Partial<Record<Criterion, number>> };
export type Evaluated = { id: string; bidder: string; total: number; byCriterion: Partial<Record<Criterion, number>>; missing: Criterion[]; rank: number };

export const effectiveWeights = (w: Partial<Record<Criterion, number>>) => ({ ...DEFAULT_WEIGHTS, ...w }) as Record<Criterion, number>;

/** Weighted score out of 10. Cost is 10 × lowest price ÷ price (same currency only); other criteria are the scores the
 * evaluators entered; an unscored criterion counts as 0 and is listed, so a gap cannot quietly help a bid. */
export function evaluateBids(bids: BidLike[], weights: Partial<Record<Criterion, number>>): { ranked: Evaluated[]; notes: string[] } {
  const w = effectiveWeights(weights);
  const notes: string[] = [];
  const live = bids.filter(b => !["invited", "declined", "withdrawn"].includes(b.status));
  const currencies = new Set(live.filter(b => b.price !== null).map(b => b.currency));
  if (currencies.size > 1) notes.push(`Bids are in several currencies (${[...currencies].join(", ")}); cost is not scored automatically until they are normalized.`);
  const priced = live.filter(b => b.price !== null && b.price > 0);
  const minPrice = currencies.size === 1 && priced.length ? Math.min(...priced.map(b => b.price!)) : null;
  if (live.length === 1) notes.push("Only one bid: no competitive tension. Consider re-tendering or benchmarking the price.");
  const totalWeight = (Object.keys(CRITERIA) as Criterion[]).reduce((s, c) => s + Math.max(0, w[c]), 0) || 1;

  const scored = live.map(b => {
    const byCriterion: Partial<Record<Criterion, number>> = {};
    const missing: Criterion[] = [];
    let sum = 0;
    for (const c of Object.keys(CRITERIA) as Criterion[]) {
      if (!w[c]) continue;
      const s = c === "cost" ? (b.scores.cost ?? (minPrice !== null && b.price ? (10 * minPrice) / b.price : undefined)) : b.scores[c];
      if (s === undefined || s === null || !Number.isFinite(s)) { missing.push(c); continue; }
      const clamped = Math.max(0, Math.min(10, s));
      byCriterion[c] = clamped;
      sum += clamped * w[c];
    }
    return { id: b.id, bidder: b.bidder, total: sum / totalWeight, byCriterion, missing, rank: 0 };
  }).sort((a, b) => b.total - a.total);
  scored.forEach((s, i) => { s.rank = i + 1; });
  return { ranked: scored, notes };
}

const UNIT_ALIASES: Record<string, string> = { tonne: "t", tonnes: "t", ton: "t", tons: "t", t: "t", kg: "kg", "m³": "m3", m3: "m3", "m²": "m2", m2: "m2", m: "m", unit: "unit", units: "unit", pc: "unit", pcs: "unit", kwp: "kwp", kwh: "kwh", mwh: "mwh" };
export const normUnit = (u: string | null | undefined) => { const k = (u ?? "").trim().toLowerCase().replace(/\s+/g, ""); return UNIT_ALIASES[k] ?? k; };

type EpdLike = { id: string; declaredUnit: string; gwp: Partial<Record<LcaStage, number>>; validUntil: string | null; product: string; manufacturer: string };
type ItemLike = { id: string; material: string; quantity: number | null; unit: string | null; epdId: string | null };
export type CarbonLine = { id: string; material: string; status: "computed" | "no_epd" | "unit_mismatch" | "no_quantity"; kg: Partial<Record<LcaStage, number>>; expiredEpd: boolean };

/** Embodied carbon by EN 15804 stage, computed only where an item has a quantity and an EPD in the same unit. Items
 * without EPD data are listed as gaps, never estimated. */
export function embodiedCarbon(items: ItemLike[], epdRows: EpdLike[], today: string) {
  const byId = new Map(epdRows.map(e => [e.id, e]));
  const lines: CarbonLine[] = items.map(i => {
    const e = i.epdId ? byId.get(i.epdId) : undefined;
    if (!e) return { id: i.id, material: i.material, status: "no_epd", kg: {}, expiredEpd: false };
    if (i.quantity === null || !(i.quantity > 0)) return { id: i.id, material: i.material, status: "no_quantity", kg: {}, expiredEpd: false };
    if (normUnit(i.unit) !== normUnit(e.declaredUnit)) return { id: i.id, material: i.material, status: "unit_mismatch", kg: {}, expiredEpd: false };
    const kg: Partial<Record<LcaStage, number>> = {};
    for (const s of Object.keys(LCA_STAGES) as LcaStage[]) if (typeof e.gwp[s] === "number") kg[s] = e.gwp[s]! * i.quantity;
    return { id: i.id, material: i.material, status: "computed", kg, expiredEpd: !!e.validUntil && e.validUntil < today };
  });
  const totals: Partial<Record<LcaStage, number>> = {};
  for (const l of lines) for (const [s, v] of Object.entries(l.kg) as [LcaStage, number][]) totals[s] = (totals[s] ?? 0) + v;
  const upfront = (totals.a1a3 ?? 0) + (totals.a4 ?? 0) + (totals.a5 ?? 0);
  return { lines, totals, upfrontTonnes: upfront / 1000, coverage: items.length ? lines.filter(l => l.status === "computed").length / items.length : 0 };
}

type ProfileLike = { id: string; orgId: string; roles: string[]; assetClasses: string[]; jurisdictions: string[]; minProjectSize: number | null; maxProjectSize: number | null; bankable: boolean; completedAssets: number | null };
type ProjectLike = { assetClass: string | null; country: string | null; capex: number | null };
export type NetworkMatch = { profileId: string; orgId: string; score: number; reasons: string[]; gaps: string[] };

/** Who can build or supply this project: asset class is required when both sides state it; jurisdiction, size and
 * bankability add to the score. Reasons and gaps are explicit. */
export function matchNetwork(project: ProjectLike, profiles: ProfileLike[], role?: string): NetworkMatch[] {
  const country = (project.country ?? "").trim().toLowerCase();
  const out: NetworkMatch[] = [];
  for (const p of profiles) {
    if (role && !p.roles.includes(role)) continue;
    const reasons: string[] = [], gaps: string[] = [];
    let score = 0;
    if (project.assetClass && p.assetClasses.length) {
      if (!p.assetClasses.includes(project.assetClass)) continue;
      reasons.push("Builds this asset class"); score += 3;
    } else gaps.push("Asset-class experience not recorded");
    if (country && p.jurisdictions.length) {
      if (p.jurisdictions.some(j => j.trim().toLowerCase() === country)) { reasons.push("Present / licensed in the project country"); score += 3; }
      else gaps.push("Not recorded as present in the project country");
    } else gaps.push("Jurisdictions not recorded");
    if (project.capex !== null && (p.minProjectSize !== null || p.maxProjectSize !== null)) {
      const okMin = p.minProjectSize === null || project.capex >= p.minProjectSize, okMax = p.maxProjectSize === null || project.capex <= p.maxProjectSize;
      if (okMin && okMax) { reasons.push("Project size in range"); score += 2; } else gaps.push("Project size outside their range");
    }
    if (p.bankable) { reasons.push("Lender-accepted (bankable)"); score += 1; }
    if ((p.completedAssets ?? 0) > 0) { reasons.push(`${p.completedAssets} completed assets`); score += Math.min(1, (p.completedAssets ?? 0) / 10); }
    out.push({ profileId: p.id, orgId: p.orgId, score, reasons, gaps });
  }
  return out.sort((a, b) => b.score - a.score);
}
