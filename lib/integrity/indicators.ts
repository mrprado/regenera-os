// Impact indicator catalogue (phase 23). Each indicator names its unit and method; references point to recognised
// frameworks (GHG Protocol project accounting, IRIS+ definitions, IFC PS, TNFD) without claiming certification.
// Records distinguish baseline · forecast · target · reported · independently verified.
export type Indicator = { key: string; label: string; unit: string; domain: string; method: string; reference: string };

export const INDICATORS: Indicator[] = [
  { key: "energy_generated", label: "Electricity generated", unit: "MWh/yr", domain: "climate", method: "Metered net export at the point of interconnection", reference: "IRIS+ energy generation" },
  { key: "avoided_emissions", label: "Avoided emissions", unit: "tCO2e/yr", domain: "climate", method: "Project vs baseline scenario with grid emission factor; state boundary and factor source", reference: "GHG Protocol for Project Accounting" },
  { key: "project_emissions", label: "Project emissions (operational)", unit: "tCO2e/yr", domain: "climate", method: "Scope 1 + 2 of the asset", reference: "GHG Protocol Corporate Standard" },
  { key: "habitat_restored", label: "Habitat restored", unit: "ha", domain: "biodiversity", method: "Mapped area meeting the restoration criteria at survey", reference: "IUCN Global Standard for NbS; TNFD" },
  { key: "habitat_conserved", label: "Habitat conserved", unit: "ha", domain: "biodiversity", method: "Area under a legal or contractual protection", reference: "IFC PS6" },
  { key: "land_converted", label: "Natural land converted", unit: "ha", domain: "land", method: "Footprint on land that was natural habitat at baseline", reference: "IFC PS6; TNFD" },
  { key: "water_withdrawal", label: "Water withdrawal", unit: "m3/yr", domain: "water", method: "Metered abstraction by source", reference: "IRIS+ water withdrawal" },
  { key: "water_quality", label: "Water quality (receiving water)", unit: "index", domain: "water", method: "Parameters per permit; state the index", reference: "IFC PS3" },
  { key: "soil_organic_carbon", label: "Soil organic carbon", unit: "t C/ha", domain: "land", method: "Sampled at fixed depth with repeat locations", reference: "FAO GSOC MRV protocol" },
  { key: "waste_diverted", label: "Waste diverted from landfill", unit: "t/yr", domain: "resources", method: "Weighbridge records by stream", reference: "IRIS+ waste diverted" },
  { key: "material_recovered", label: "Material recovered", unit: "t/yr", domain: "resources", method: "Saleable recovered output by material", reference: "IRIS+" },
  { key: "local_jobs", label: "Local jobs", unit: "FTE", domain: "community", method: "Payroll by residence, construction and operation separately", reference: "IRIS+ jobs" },
  { key: "community_benefit", label: "Community benefit paid", unit: "USD/yr", domain: "community", method: "Payments under the benefit-sharing agreement", reference: "IFC PS7" },
  { key: "households_served", label: "Households with new energy access", unit: "households", domain: "community", method: "Connections commissioned and active", reference: "IRIS+ energy access" },
  { key: "incidents", label: "Environmental / social incidents", unit: "count", domain: "governance", method: "Recorded incidents and grievances", reference: "IFC PS1" },
];
export const indicatorByKey = (k: string) => INDICATORS.find(i => i.key === k);
export const IMPACT_KINDS = { baseline: "Baseline", forecast: "Forecast", target: "Target", reported: "Reported", verified: "Independently verified" } as const;
