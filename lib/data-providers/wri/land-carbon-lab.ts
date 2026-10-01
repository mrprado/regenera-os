// Land & Carbon Lab (WRI). Its land-conversion and tree-cover datasets are served by the Global Forest Watch Data API
// (same key, same adapter: ./global-forest-watch.ts); restoration and removals layers are downloads. The LAND
// TRANSITION panel is assembled from those readings plus Regenera's land-cover composition; every line keeps its
// source and a missing reading stays "Not available".
export type LandTransitionInputs = {
  currentSystem: string | null; lossTotalHa: number | null; lossRecentHa: number | null; recentFrom: number | null; naturalPct: number | null;
  primaryForestHa: number | null; carbonNote: string | null; restorationNote: string | null; constraints: string[];
};

export function landTransition(x: LandTransitionInputs) {
  const na = "Not available";
  return {
    currentSystem: x.currentSystem ?? na,
    historicalTrend: x.lossTotalHa === null ? na : `${x.lossTotalHa} ha tree cover loss since 2001`,
    observedConversion: x.lossRecentHa === null ? na : x.lossRecentHa > 0 ? `${x.lossRecentHa} ha lost since ${x.recentFrom}` : `No loss detected since ${x.recentFrom}`,
    ecologicalSignificance: x.primaryForestHa ? `${x.primaryForestHa} ha primary forest intersects` : x.naturalPct !== null ? `${x.naturalPct}% natural cover` : na,
    carbonRelevance: x.carbonNote ?? na,
    restorationPotential: x.restorationNote ?? na,
    developmentConstraints: x.constraints.length ? x.constraints.join("; ") : "None recorded",
    landUseConflicts: x.lossRecentHa && x.lossRecentHa > 0 ? "Recent conversion: check tenure, deforestation-free commitments of offtakers and lenders" : na,
  };
}
