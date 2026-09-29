// Technology library and cost-benchmark vocabulary. Metrics carry their unit kind so normalisation knows whether a
// value is money (currency + base year), money per unit, or a physical ratio. Client-safe.

export const TECH_CATEGORIES = { energy: "Energy", storage: "Storage", waste: "Waste", water: "Water", agriculture: "Agriculture", forestry: "Forestry", built: "Built environment", mining: "Mining", nature: "Nature", digital: "Digital infrastructure" } as const;
export const MATURITY = { research: "Research (TRL 1–3)", pilot: "Pilot (TRL 4–6)", demonstration: "Demonstration (TRL 7–8)", early_commercial: "Early commercial (TRL 9)", mature: "Mature / bankable" } as const;
export const SOURCE_QUALITY = { primary: "Primary (contract, bid, audited)", official: "Official statistics / regulator", research: "Research body (e.g. NREL, IRENA, IEA)", secondary: "Secondary (press, broker)", estimate: "Estimate", regenera: "Regenera project record" } as const;
export const BENCH_CONFIDENCE = { high: "High", moderate: "Moderate", low: "Low" } as const;
export const PRICE_BASIS = { nominal: "Nominal", real: "Real (base-year prices)" } as const;

export type MetricKind = "money_per_unit" | "money" | "ratio" | "physical";
export const METRICS: Record<string, { label: string; unit: string; kind: MetricKind; tech: string[] }> = {
  capex_per_mwac: { label: "CAPEX per MWac", unit: "per MWac", kind: "money_per_unit", tech: ["solar", "wind", "hydro", "geothermal", "gas", "nuclear"] },
  capex_per_mwdc: { label: "CAPEX per MWdc", unit: "per MWdc", kind: "money_per_unit", tech: ["solar"] },
  capex_per_kwh: { label: "CAPEX per kWh", unit: "per kWh", kind: "money_per_unit", tech: ["bess"] },
  capex_per_kw: { label: "CAPEX per kW", unit: "per kW", kind: "money_per_unit", tech: ["bess", "gas", "nuclear", "hydrogen"] },
  opex_per_kw_yr: { label: "Fixed O&M per kW-yr", unit: "per kW-yr", kind: "money_per_unit", tech: ["solar", "wind", "bess", "gas", "geothermal"] },
  lcoe: { label: "LCOE", unit: "per MWh", kind: "money_per_unit", tech: ["solar", "wind", "hydro", "geothermal", "gas", "nuclear"] },
  lcos: { label: "LCOS", unit: "per MWh", kind: "money_per_unit", tech: ["bess"] },
  lcoh: { label: "LCOH", unit: "per kg H2", kind: "money_per_unit", tech: ["hydrogen"] },
  capacity_factor: { label: "Capacity factor", unit: "%", kind: "ratio", tech: ["solar", "wind", "hydro", "geothermal", "gas"] },
  round_trip: { label: "Round-trip efficiency", unit: "%", kind: "ratio", tech: ["bess"] },
  specific_yield: { label: "Specific yield", unit: "kWh/kWp-yr", kind: "physical", tech: ["solar"] },
  capex_per_m3_day: { label: "CAPEX per m³/day capacity", unit: "per m³/day", kind: "money_per_unit", tech: ["desalination", "wastewater", "water_treatment"] },
  cost_per_m3: { label: "Levelised cost per m³", unit: "per m³", kind: "money_per_unit", tech: ["desalination", "wastewater", "water_treatment"] },
  kwh_per_m3: { label: "Energy per m³", unit: "kWh/m³", kind: "physical", tech: ["desalination", "wastewater"] },
  capex_per_tpa: { label: "CAPEX per t/yr capacity", unit: "per t/yr", kind: "money_per_unit", tech: ["anaerobic_digestion", "pyrolysis", "gasification", "recycling", "rdf"] },
  gate_fee: { label: "Gate fee", unit: "per t", kind: "money_per_unit", tech: ["anaerobic_digestion", "pyrolysis", "gasification", "rdf", "recycling"] },
  cost_per_ha: { label: "Cost per ha", unit: "per ha", kind: "money_per_unit", tech: ["restoration", "agroforestry", "regenerative_ag", "forestry", "conservation"] },
  establishment_per_ha: { label: "Establishment cost per ha", unit: "per ha", kind: "money_per_unit", tech: ["forestry", "agroforestry", "restoration"] },
  carbon_price: { label: "Carbon price", unit: "per tCO2e", kind: "money_per_unit", tech: ["forestry", "restoration", "conservation", "biochar"] },
  capex_per_mw_it: { label: "CAPEX per MW IT load", unit: "per MW IT", kind: "money_per_unit", tech: ["data_center"] },
  pue: { label: "PUE", unit: "ratio", kind: "physical", tech: ["data_center"] },
  capex_per_sqft: { label: "Construction cost per sq ft", unit: "per sq ft", kind: "money_per_unit", tech: ["real_estate"] },
};

/** ISO 4217 → ISO3 country for World Bank official exchange-rate fallback (currencies the ECB does not publish). */
export const CURRENCY_COUNTRY: Record<string, string> = {
  KES: "KEN", NGN: "NGA", GHS: "GHA", TZS: "TZA", UGX: "UGA", ETB: "ETH", ZMW: "ZMB", RWF: "RWA", XOF: "SEN", XAF: "CMR", MAD: "MAR", EGP: "EGY", COP: "COL", PEN: "PER", CLP: "CHL",
  ARS: "ARG", BOB: "BOL", PYG: "PRY", UYU: "URY", CRC: "CRI", GTQ: "GTM", HNL: "HND", DOP: "DOM", JMD: "JAM", BZD: "BLZ", VND: "VNM", PKR: "PAK", BDT: "BGD", LKR: "LKA", NPR: "NPL",
  SAR: "SAU", AED: "ARE", QAR: "QAT", KZT: "KAZ", UAH: "UKR", NZD: "NZL",
};
