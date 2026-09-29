// Project finance model definition (financial modeling and underwriting extension). A model is data: every material
// input is an assumption with provenance, and the calculation (lib/finance/calc.ts) is deterministic and reproducible.

export type Certainty = "contracted" | "forecast" | "merchant" | "speculative";
export type AssumptionStatus = "verified" | "supported" | "preliminary" | "placeholder" | "speculative";
export type Confidence = "high" | "moderate" | "low";

/** Provenance carried by every material input. */
export type Provenance = { source: string; date: string | null; owner: string | null; confidence: Confidence; status: AssumptionStatus; comment?: string; evidenceId?: string | null };
export const NO_PROVENANCE: Provenance = { source: "", date: null, owner: null, confidence: "low", status: "placeholder" };

export type CapexLine = { id: string; category: string; label: string; quantity: number; unit: string; unitCost: number; contingencyPct: number; fromSite?: string | null } & Provenance;
export type DevCostLine = { id: string; category: string; label: string; budget: number; committed: number; spent: number; gate?: string | null } & Provenance;
export type OpexLine = { id: string; label: string; kind: "fixed" | "per_mwh" | "pct_revenue"; amount: number; escalationPct: number } & Provenance;
/** Environmental value should enhance a viable project, not be the whole model: revenues are classed so underwriting
 *  can see what share rests on primary operations versus contracted or variable environmental attributes.
 *  Non-cash environmental value (habitat, resilience, recharge) never enters the cash flow; see nature scenarios. */
export type RevenueClass = "primary_operating" | "contracted_environmental" | "variable_environmental";
export const REVENUE_CLASSES: Record<RevenueClass, string> = { primary_operating: "Primary operating revenue", contracted_environmental: "Contracted environmental revenue", variable_environmental: "Variable environmental revenue" };
export type RevenueStream = {
  id: string; label: string; type: string; certainty: Certainty; revenueClass?: RevenueClass;
  basis: "energy" | "fixed";             // energy: volume from the generation block; fixed: annual volume
  annualVolume: number; unit: string;    // for fixed basis (e.g. t CO2e, m³, units)
  price: number; escalationPct: number;
  startYear: number;                     // operating year (1 = first year after COD)
  termYears: number;                     // contract term; after it the merchant tail price applies (0 = none)
  tailPrice: number; shareOfGeneration: number; // share of net generation sold under this stream (energy basis), 0–100
} & Provenance;
export type Generation = { capacityMw: number; capacityFactorPct: number; availabilityPct: number; degradationPct: number; curtailmentPct: number; lossesPct: number; pCase: "P50" | "P75" | "P90"; p75Factor: number; p90Factor: number } & Provenance;
export type DebtTranche = {
  name: string; sizing: "dscr" | "gearing" | "amount"; targetDscr: number; maxGearingPct: number; amount: number;
  ratePct: number; tenorYears: number; profile: "sculpted" | "annuity" | "straight" | "bullet"; upfrontFeePct: number; dsraMonths: number;
  lockupDscr: number; currency: string;
} & Provenance;
export type TaxBlock = { ratePct: number; depreciationYears: number; lossCarryforward: boolean; interestDeductible: boolean } & Provenance;

export type ModelDefinition = {
  currency: string; basis: "nominal" | "real";
  constructionMonths: number; operatingYears: number; codDelayMonths: number;
  capex: CapexLine[]; development: DevCostLine[]; opex: OpexLine[]; revenue: RevenueStream[];
  generation: Generation | null; debt: DebtTranche | null; grants: { label: string; amount: number; provenance: Provenance }[];
  tax: TaxBlock; discountRatePct: number; equityHurdlePct: number; residualValue: number; decommissioning: number;
  includeSpeculative: boolean;           // never true in a base case; allowed in a named scenario
  stageDiscountRates: { stage: string; ratePct: number }[]; // value bridge inputs (user-set)
};

export type PeriodRow = {
  year: number; phase: "construction" | "operations"; capex: number; revenue: number; revenueByCertainty: Record<Certainty, number>; generationMwh: number;
  opex: number; ebitda: number; depreciation: number; interest: number; taxableIncome: number; tax: number; cfads: number;
  debtDraw: number; debtOpening: number; principal: number; debtService: number; debtClosing: number; dscr: number | null;
  dsraFlow: number; distributions: number; lockedUp: boolean; equityFlow: number; projectFlow: number;
};

export type ModelOutputs = {
  periods: PeriodRow[];
  uses: { capex: number; development: number; idc: number; fees: number; dsra: number; total: number };
  sources: { debt: number; grants: number; equity: number; total: number };
  debt: number; debtSizedBy: string; minDscr: number | null; avgDscr: number | null; llcr: number | null; plcr: number | null;
  projectIrr: number | null; equityIrr: number | null; projectNpv: number; equityNpv: number; moic: number | null; paybackYears: number | null;
  capexPerMw: number | null; ebitdaYear1: number; revenueYear1: number; iterations: number; converged: boolean;
};
