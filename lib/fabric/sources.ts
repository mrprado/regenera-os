// Data fabric source records (phase 19 part B). The integration registry (lib/integrations/registry) holds licence and
// access terms; this overlay adds what the fabric needs to choose a source: provider family, domain, evidence level,
// resolution, update frequency, authority and the ontology entity a record maps to. Users ask questions; providers stay
// visible in the provenance under every answer.
import { INTEGRATIONS, type IntegrationSeed } from "@/lib/integrations/registry";
import type { EntityType } from "@/lib/ontology/entities";
import type { EvidenceLevel } from "@/lib/ontology/taxonomies";

export const FAMILIES = {
  nasa: "NASA", copernicus: "Copernicus / ESA / JRC", usgs: "USGS", noaa: "NOAA", wri: "WRI", world_bank: "World Bank Group", fao: "FAO",
  doe_nrel: "DOE / NREL / EIA", epa: "US EPA", osm: "OpenStreetMap", gbif: "GBIF", isric: "ISRIC", climate_trace: "Climate TRACE",
  system_operators: "Grid system operators", sanctions: "Sanctions lists", corporate: "Corporate registries", funding: "Funding & procurement",
  economics: "Economics & trade", signals: "News & signals", research: "Research", commercial: "Commercial services", other: "Other",
} as const;
export type Family = keyof typeof FAMILIES;

export const DOMAINS = {
  geography: "Basemap & geography", earth_observation: "Earth observation", energy: "Energy assets", grid: "Grid & markets", resource: "Renewable resource",
  land: "Land & parcels", water: "Water", ecology: "Ecology & biodiversity", soils: "Agriculture & soils", climate: "Climate & hazards",
  infrastructure: "Infrastructure", population: "Population & communities", economy: "Economics & trade", counterparty: "Companies & counterparties",
  funding: "Funding & procurement", emissions: "Emissions & carbon", regulation: "Regulation", signals: "News & signals", other: "Other",
} as const;
export type Domain = keyof typeof DOMAINS;

export type SourceMeta = { family: Family; domain: Domain; level: EvidenceLevel; spatial: string; temporal: string; update: string; mapsTo: EntityType; authority: "global" | "national" | "operator" | "discovery" };

const M = (family: Family, domain: Domain, level: EvidenceLevel, mapsTo: EntityType, spatial: string, temporal: string, update: string, authority: SourceMeta["authority"] = "global"): SourceMeta => ({ family, domain, level, mapsTo, spatial, temporal, update, authority });

export const SOURCE_META: Record<string, SourceMeta> = {
  gleif: M("corporate", "counterparty", 2, "organization", "Entity", "Current", "Daily", "national"),
  edgar: M("corporate", "counterparty", 2, "organization", "Entity", "Filings", "Daily", "national"),
  companies_house: M("corporate", "counterparty", 2, "organization", "Entity", "Current", "Daily", "national"),
  opencorporates: M("corporate", "counterparty", 1, "organization", "Entity", "Current", "Varies"),
  wikidata: M("other", "counterparty", 0, "organization", "Entity", "Current", "Continuous", "discovery"),
  gdelt: M("signals", "signals", 0, "signal", "Article", "15 minutes", "Continuous", "discovery"),
  gdacs: M("copernicus", "climate", 1, "signal", "Event", "Near real time", "Hourly"),
  ted: M("funding", "funding", 2, "signal", "Notice", "Daily", "Daily", "national"),
  eu_funding: M("funding", "funding", 2, "signal", "Call", "Daily", "Daily", "national"),
  worldbank: M("world_bank", "funding", 2, "signal", "Notice", "Daily", "Daily", "national"),
  grants_gov: M("funding", "funding", 2, "signal", "Opportunity", "Daily", "Daily", "national"),
  uk_contracts: M("funding", "funding", 2, "signal", "Notice", "Daily", "Daily", "national"),
  usaspending: M("funding", "funding", 2, "transaction", "Award", "Daily", "Daily", "national"),
  sam_gov: M("funding", "funding", 2, "signal", "Notice", "Daily", "Daily", "national"),
  nominatim: M("osm", "geography", 0, "site", "Address", "Current", "Continuous", "discovery"),
  natural_earth: M("other", "geography", 1, "site", "1:10m–1:110m", "Static", "Occasional"),
  esri: M("commercial", "earth_observation", 1, "observation", "Sub-metre to 15 m", "Mosaic", "Periodic"),
  nasa_power: M("nasa", "resource", 1, "observation", "0.5° × 0.625°", "Climatology", "Monthly"),
  nasa_firms: M("nasa", "climate", 1, "observation", "375 m (VIIRS)", "Near real time", "3 hours"),
  nasa_firms_public: M("nasa", "climate", 1, "observation", "375 m (VIIRS)", "Near real time", "3 hours"),
  nasa_gibs: M("nasa", "earth_observation", 1, "observation", "250 m–1 km", "Daily", "Daily"),
  nasa_eonet: M("nasa", "climate", 1, "signal", "Event", "Near real time", "Daily"),
  wb_indicators: M("world_bank", "economy", 1, "observation", "Country", "Annual", "Annual"),
  overpass: M("osm", "infrastructure", 0, "infrastructure_asset", "Feature", "Current", "Continuous", "discovery"),
  openinframap: M("osm", "grid", 0, "infrastructure_asset", "Feature", "Current", "Continuous", "discovery"),
  openfreemap: M("osm", "geography", 0, "site", "Vector tiles", "Current", "Weekly", "discovery"),
  usgs_quakes: M("usgs", "climate", 1, "observation", "Event", "Real time", "Minutes"),
  usgs_water: M("usgs", "water", 2, "observation", "Gauge", "15 minutes", "Continuous", "national"),
  gbif: M("gbif", "ecology", 1, "observation", "Occurrence", "Historical", "Continuous"),
  epa_envirofacts: M("epa", "regulation", 2, "infrastructure_asset", "Facility", "Varies", "Varies", "national"),
  openalex: M("research", "other", 0, "document", "Work", "Current", "Daily", "discovery"),
  crossref: M("research", "other", 0, "document", "Work", "Current", "Daily", "discovery"),
  eurostat: M("economics", "economy", 1, "observation", "NUTS region", "Annual / monthly", "Varies"),
  faostat: M("fao", "soils", 1, "observation", "Country", "Annual", "Annual"),
  nrel: M("doe_nrel", "resource", 2, "observation", "4 km (NSRDB)", "Hourly / TMY", "Annual", "national"),
  eia: M("doe_nrel", "energy", 2, "infrastructure_asset", "Plant / BA", "Monthly / hourly", "Monthly", "national"),
  fred: M("economics", "economy", 1, "observation", "Series", "Daily–annual", "Varies"),
  copernicus: M("copernicus", "earth_observation", 1, "observation", "10–60 m", "5-day revisit", "Daily"),
  copernicus_stac: M("copernicus", "earth_observation", 1, "observation", "10–60 m", "5-day revisit", "Daily"),
  gfw: M("wri", "ecology", 1, "observation", "30 m", "Annual + weekly alerts", "Weekly"),
  gfw_tiles: M("wri", "ecology", 1, "observation", "30 m", "Annual", "Annual"),
  resource_watch: M("wri", "water", 1, "observation", "Sub-basin", "Baseline + projections", "Occasional"),
  openaq: M("other", "climate", 1, "observation", "Station", "Hourly", "Hourly"),
  entsoe: M("system_operators", "grid", 2, "observation", "Bidding zone", "Hourly", "Hourly", "operator"),
  ercot: M("system_operators", "grid", 2, "observation", "Zone / node", "5 minutes", "Continuous", "operator"),
  caiso: M("system_operators", "grid", 2, "observation", "Node", "5 minutes", "Continuous", "operator"),
  pjm: M("system_operators", "grid", 2, "observation", "Node", "Hourly", "Continuous", "operator"),
  miso_queue: M("system_operators", "grid", 2, "infrastructure_asset", "Queue position", "Current", "Daily", "operator"),
  spp_queue: M("system_operators", "grid", 2, "infrastructure_asset", "Queue position", "Current", "Daily", "operator"),
  comtrade: M("economics", "economy", 1, "observation", "Country pair", "Annual / monthly", "Monthly"),
  irena_ember: M("economics", "energy", 1, "observation", "Country", "Annual / monthly", "Monthly"),
  wdpa: M("other", "ecology", 1, "observation", "Polygon", "Monthly", "Monthly"),
  ibat: M("other", "ecology", 1, "observation", "Polygon", "Quarterly", "Quarterly"),
  pvgis: M("copernicus", "resource", 1, "observation", "~5 km (SARAH)", "2005–2023", "Occasional"),
  noaa_cdo: M("noaa", "climate", 2, "observation", "Station", "Daily", "Daily", "national"),
  noaa_nhc: M("noaa", "climate", 2, "signal", "Storm", "6 hours", "Continuous", "national"),
  imf: M("economics", "economy", 1, "observation", "Country", "Monthly / annual", "Monthly"),
  soilgrids: M("isric", "soils", 1, "observation", "250 m", "Static", "Occasional"),
  esa_worldcover: M("copernicus", "land", 1, "observation", "10 m", "2020, 2021", "Static"),
  jrc_gsw: M("copernicus", "water", 1, "observation", "30 m", "1984–2021", "Occasional"),
  aws_terrain: M("other", "geography", 1, "observation", "~30 m", "Static", "Static"),
  eox_s2cloudless: M("copernicus", "earth_observation", 1, "observation", "10 m", "Annual mosaic", "Annual"),
  frankfurter: M("economics", "economy", 1, "observation", "Currency", "Daily", "Daily"),
  ofac_sdn: M("sanctions", "counterparty", 2, "organization", "Name", "Current", "Weekly", "national"),
  uk_sanctions: M("sanctions", "counterparty", 2, "organization", "Name", "Current", "Weekly", "national"),
  eu_sanctions: M("sanctions", "counterparty", 2, "organization", "Name", "Current", "Weekly", "national"),
  un_sanctions: M("sanctions", "counterparty", 2, "organization", "Name", "Current", "Weekly", "national"),
  climate_trace: M("climate_trace", "emissions", 1, "infrastructure_asset", "Asset", "Annual / monthly", "Monthly"),
  electricity_maps: M("system_operators", "grid", 1, "observation", "Grid zone", "Hourly", "Hourly"),
  gem: M("other", "energy", 1, "infrastructure_asset", "Asset", "Semi-annual", "Semi-annual"),
  overture: M("other", "geography", 0, "infrastructure_asset", "Feature", "Monthly release", "Monthly", "discovery"),
  geonames: M("other", "geography", 1, "site", "Place", "Current", "Daily"),
};

const CATEGORY_DOMAIN: [RegExp, Domain][] = [[/corporate|filing/i, "counterparty"], [/hazard|climate|weather/i, "climate"], [/fund|procure|tender|grant/i, "funding"], [/water/i, "water"], [/ecolog|biodiv|nature|forest/i, "ecology"], [/grid|power|energy/i, "energy"], [/map|geo|imagery/i, "geography"], [/econom|finance|trade/i, "economy"]];

/** Every registered integration with its fabric record (explicit overlay, or a conservative default). */
export function sourceRecords(): (IntegrationSeed & SourceMeta)[] {
  return INTEGRATIONS.map(i => ({ ...i, ...(SOURCE_META[i.key] ?? { family: "other" as Family, domain: CATEGORY_DOMAIN.find(([re]) => re.test(i.category))?.[1] ?? "other", level: 1 as EvidenceLevel, spatial: "—", temporal: "—", update: i.refresh, mapsTo: "observation" as EntityType, authority: "global" as const }) }));
}

export function familyGroups() {
  const recs = sourceRecords();
  return (Object.keys(FAMILIES) as Family[]).map(f => ({ family: f, label: FAMILIES[f], sources: recs.filter(r => r.family === f) })).filter(g => g.sources.length);
}
