// Capital stack analysis (pure, client-safe): coverage, mix, weighted cost where rates are known, and what is still
// an assumption. Nothing here labels a structure compliant or bankable.
import { STACK_LAYERS, type StackFamily, type StackLayer } from "./structure-vocab";

export type LayerInput = {
  id?: string; layer: StackLayer; provider: string; providerOrgId?: string | null; requirementId?: string | null; currency: string; amount: number | null;
  pricing: string; ratePct: number | null; tenorYears: number | null; amortization: string; security: string; status: string; conditions: string; source: string; assumptionStatus: string;
};

export type StackSummary = {
  currency: string;
  totalCost: number | null;
  funded: number;                       // layers that fund (guarantees excluded)
  gap: number | null;                   // totalCost − funded (negative = over-subscribed)
  coveragePct: number | null;
  byFamily: Record<StackFamily, number>;
  debtPct: number | null; equityPct: number | null;
  weightedRatePct: number | null;       // over layers with a known rate, share of amount covered by those rates
  rateCoveragePct: number | null;
  committedPct: number | null;          // committed or closed share of the funded amount
  layers: (LayerInput & { pct: number | null; family: StackFamily; rank: number })[];
  warnings: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeStack(input: { currency: string; totalCost: number | null; layers: LayerInput[] }): StackSummary {
  const warnings: string[] = [];
  const byFamily: Record<StackFamily, number> = { debt: 0, mezzanine: 0, equity: 0, grant: 0, support: 0 };
  const funding = input.layers.filter(l => STACK_LAYERS[l.layer].family !== "support");
  for (const l of input.layers) {
    if (l.currency !== input.currency) warnings.push(`${STACK_LAYERS[l.layer].label}${l.provider ? ` (${l.provider})` : ""} is in ${l.currency}; totals assume ${input.currency} and do not convert.`);
    if (l.amount == null) warnings.push(`${STACK_LAYERS[l.layer].label}${l.provider ? ` (${l.provider})` : ""} has no amount.`);
    byFamily[STACK_LAYERS[l.layer].family] += l.amount ?? 0;
  }
  const funded = funding.reduce((s, l) => s + (l.currency === input.currency ? l.amount ?? 0 : 0), 0);
  const gap = input.totalCost != null ? input.totalCost - funded : null;
  if (input.totalCost == null) warnings.push("Total cost (uses of funds) not set: coverage cannot be computed.");
  else if (gap! > 0.005 * input.totalCost) warnings.push(`Funding gap of ${Math.round(gap!).toLocaleString("en-US")} ${input.currency}.`);
  else if (gap! < -0.005 * input.totalCost) warnings.push(`Over-subscribed by ${Math.round(-gap!).toLocaleString("en-US")} ${input.currency}.`);
  const rated = funding.filter(l => l.ratePct != null && l.amount != null && l.currency === input.currency);
  const ratedAmt = rated.reduce((s, l) => s + l.amount!, 0);
  const weightedRatePct = ratedAmt > 0 ? Math.round((rated.reduce((s, l) => s + l.amount! * l.ratePct!, 0) / ratedAmt) * 100) / 100 : null;
  const committed = funding.filter(l => (l.status === "committed" || l.status === "closed") && l.currency === input.currency).reduce((s, l) => s + (l.amount ?? 0), 0);
  const unsourced = input.layers.filter(l => l.assumptionStatus === "assumption").length;
  if (unsourced) warnings.push(`${unsourced} of ${input.layers.length} layers are unsourced assumptions.`);
  if (byFamily.equity === 0 && funding.length) warnings.push("No equity layer: lenders normally require sponsor equity at risk.");
  const debtShare = funded > 0 ? (byFamily.debt / funded) * 100 : null;
  if (debtShare != null && debtShare > 85) warnings.push(`Debt is ${r1(debtShare)}% of funding: above typical project-finance gearing (70–80%). Check with lenders.`);
  const layers = [...input.layers]
    .map(l => ({ ...l, family: STACK_LAYERS[l.layer].family, rank: STACK_LAYERS[l.layer].rank, pct: funded > 0 && l.amount != null && STACK_LAYERS[l.layer].family !== "support" ? r1((l.amount / funded) * 100) : null }))
    .sort((a, b) => a.rank - b.rank);
  return {
    currency: input.currency, totalCost: input.totalCost, funded, gap, coveragePct: input.totalCost ? r1((funded / input.totalCost) * 100) : null,
    byFamily, debtPct: debtShare != null ? r1(debtShare) : null, equityPct: funded > 0 ? r1((byFamily.equity / funded) * 100) : null,
    weightedRatePct, rateCoveragePct: funded > 0 ? r1((ratedAmt / funded) * 100) : null, committedPct: funded > 0 ? r1((committed / funded) * 100) : null,
    layers, warnings,
  };
}

