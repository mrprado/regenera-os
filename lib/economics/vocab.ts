// Commercial and economics vocabulary (docs/master-spec.md parts XXI–XXII).

export const REVENUE_MECHANISMS = {
  ppa: "PPA", offtake: "Offtake", tolling: "Tolling", concession: "Concession", feedstock: "Feedstock supply",
  tipping_fee: "Tipping fee", lease: "Lease", product_sale: "Product sale", availability: "Availability payment",
  environmental_credit: "Environmental credit", merchant: "Merchant", other: "Other",
} as const;
export const REVENUE_STATUSES = { indicative: "Indicative", in_negotiation: "In negotiation", term_sheet: "Term sheet", signed: "Signed", lost: "Lost" } as const;
export const CASE_KINDS = { base: "Base", downside: "Downside", upside: "Upside", custom: "Custom" } as const;

export type CaseInputs = {
  currency: string;
  capex: number;
  materialSharePct: number;     // share of CAPEX that is materials and equipment (for the material-cost sensitivity)
  constructionMonths: number;
  codDelayMonths: number;
  lifeYears: number;
  revenueYear1: number;         // contracted + merchant revenue in year 1 at P50 yield, model currency
  revenueEscalationPct: number;
  yieldPct: number;             // resource / yield vs P50 (100 = P50)
  degradationPct: number;       // a year
  fxShockPct: number;           // loss of value of revenue against the model currency (0 = none)
  carbonTonnes: number;         // credits a year
  carbonPrice: number;
  opexYear1: number;
  opexEscalationPct: number;
  gearingPct: number;           // maximum debt as % of CAPEX
  interestRatePct: number;
  debtTenorYears: number;
  targetDscr: number;
  taxRatePct: number;
  discountRatePct: number;
};

export type CaseYear = { year: number; revenue: number; opex: number; ebitda: number; tax: number; cfads: number; debtService: number; dscr: number | null };
export type CaseOutputs = {
  projectIrr: number | null; equityIrr: number | null; npv: number; minDscr: number | null; avgDscr: number | null; llcr: number | null;
  paybackYears: number | null; debt: number; equity: number; debtSizedBy: "dscr" | "gearing" | "none"; ebitdaYear1: number;
  years: CaseYear[]; notes: string[];
};

export const INPUT_FIELDS: { key: keyof CaseInputs; label: string; unit?: string }[] = [
  { key: "capex", label: "CAPEX" }, { key: "materialSharePct", label: "Materials and equipment share of CAPEX", unit: "%" },
  { key: "constructionMonths", label: "Construction period", unit: "months" }, { key: "codDelayMonths", label: "COD delay", unit: "months" },
  { key: "lifeYears", label: "Operating life", unit: "years" }, { key: "revenueYear1", label: "Revenue, year 1 (P50)" },
  { key: "revenueEscalationPct", label: "Revenue escalation", unit: "% a year" }, { key: "yieldPct", label: "Yield / resource vs P50", unit: "%" },
  { key: "degradationPct", label: "Degradation", unit: "% a year" }, { key: "fxShockPct", label: "FX loss on revenue", unit: "%" },
  { key: "carbonTonnes", label: "Carbon credits", unit: "t a year" }, { key: "carbonPrice", label: "Carbon price", unit: "per t" },
  { key: "opexYear1", label: "OPEX, year 1" }, { key: "opexEscalationPct", label: "OPEX escalation", unit: "% a year" },
  { key: "gearingPct", label: "Maximum gearing", unit: "% of CAPEX" }, { key: "interestRatePct", label: "Interest rate", unit: "%" },
  { key: "debtTenorYears", label: "Debt tenor", unit: "years" }, { key: "targetDscr", label: "Target DSCR", unit: "x" },
  { key: "taxRatePct", label: "Tax rate", unit: "%" }, { key: "discountRatePct", label: "Discount rate", unit: "%" },
];

export const DEFAULT_INPUTS: Omit<CaseInputs, "currency" | "capex" | "revenueYear1" | "opexYear1"> = {
  materialSharePct: 50, constructionMonths: 12, codDelayMonths: 0, lifeYears: 25, revenueEscalationPct: 2, yieldPct: 100,
  degradationPct: 0, fxShockPct: 0, carbonTonnes: 0, carbonPrice: 0, opexEscalationPct: 2.5, gearingPct: 70, interestRatePct: 8,
  debtTenorYears: 15, targetDscr: 1.3, taxRatePct: 30, discountRatePct: 10,
};

export const BOUNDARY = "Indicative screening model: annual periods, CAPEX at the start, tax without interest shield, no reserve accounts, fees or IDC. It is not a bankable financial model; the financial adviser and model auditor own that.";
