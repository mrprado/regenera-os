// Jurisdiction packs: the official (L2) sources for a country, activated for a workspace only when it has a project
// there. Global sources screen; a pack names who to verify with. "connected" sources have a working connector;
// "reference" sources are official portals a person checks and records as evidence.

export type PackSource = { name: string; covers: string; url: string; integrationKey?: string };
export type Pack = { key: string; label: string; countries: string[]; domains: Record<string, PackSource[]> };

export const PACKS: Pack[] = [
  {
    key: "us", label: "United States", countries: ["USA", "US", "United States", "United States of America"],
    domains: {
      grid: [
        { name: "EIA Open Data", covers: "Plants, generators, generation, balancing authorities", url: "https://www.eia.gov/opendata/", integrationKey: "eia" },
        { name: "MISO / SPP interconnection queues", covers: "Queue positions, study phase, withdrawals", url: "https://www.misoenergy.org/planning/resource-utilization/GI_Queue/", integrationKey: "miso_queue" },
        { name: "CAISO OASIS, ERCOT, PJM Data Miner", covers: "Load, prices (LMP), outages", url: "https://oasis.caiso.com/", integrationKey: "caiso" },
        { name: "FERC eLibrary", covers: "Interconnection agreements, tariffs, orders", url: "https://elibrary.ferc.gov/" },
      ],
      resource: [{ name: "NREL NSRDB / PVWatts / WIND Toolkit", covers: "Solar and wind resource, production estimates", url: "https://developer.nrel.gov/", integrationKey: "nrel" }],
      water: [{ name: "USGS Water Data", covers: "Stream gauges, groundwater", url: "https://waterdata.usgs.gov/", integrationKey: "usgs_water" }, { name: "FEMA Flood Map Service Center", covers: "Flood zones (NFHL)", url: "https://msc.fema.gov/" }],
      land: [{ name: "County parcel and assessor portals", covers: "Parcels, ownership, zoning", url: "https://www.usgs.gov/" }, { name: "USDA SSURGO (Web Soil Survey)", covers: "Detailed soils (replaces SoilGrids in the US)", url: "https://websoilsurvey.nrcs.usda.gov/" }],
      ecology: [{ name: "USFWS IPaC", covers: "Listed species and critical habitat", url: "https://ipac.ecosphere.fws.gov/" }, { name: "PAD-US", covers: "Protected areas", url: "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview" }],
      regulation: [{ name: "EPA Envirofacts / ECHO", covers: "Regulated facilities, permits, enforcement", url: "https://enviro.epa.gov/", integrationKey: "epa_envirofacts" }],
      counterparty: [{ name: "SEC EDGAR", covers: "Filings, financials", url: "https://www.sec.gov/edgar", integrationKey: "edgar" }, { name: "OFAC SDN", covers: "Sanctions", url: "https://sanctionslist.ofac.treas.gov/", integrationKey: "ofac_sdn" }],
      funding: [{ name: "Grants.gov, SAM.gov, USAspending", covers: "Grants, tenders, federal awards", url: "https://www.usaspending.gov/", integrationKey: "grants_gov" }],
    },
  },
  {
    key: "mx", label: "Mexico", countries: ["MEX", "MX", "Mexico", "México"],
    domains: {
      grid: [
        { name: "CENACE", covers: "System operation, interconnection studies, market prices (MEM)", url: "https://www.cenace.gob.mx/" },
        { name: "SENER (PRODESEN)", covers: "National electricity development programme, planned lines", url: "https://www.gob.mx/sener" },
        { name: "CNE (formerly CRE)", covers: "Generation permits and licences", url: "https://www.gob.mx/cne" },
      ],
      land: [{ name: "RAN (Registro Agrario Nacional)", covers: "Ejido and communal land, agrarian rights", url: "https://www.gob.mx/ran" }, { name: "State public property registries (RPP)", covers: "Private titles, liens", url: "https://www.gob.mx/" }, { name: "INEGI", covers: "Cadastre-adjacent geography, land use, census", url: "https://www.inegi.org.mx/" }],
      water: [{ name: "CONAGUA", covers: "Water concessions (REPDA), aquifer availability", url: "https://www.gob.mx/conagua" }],
      ecology: [{ name: "CONANP", covers: "Natural protected areas", url: "https://www.gob.mx/conanp" }, { name: "SEMARNAT", covers: "Environmental impact (MIA) approvals", url: "https://www.gob.mx/semarnat" }, { name: "CONAFOR", covers: "Forest inventory and land-use change", url: "https://www.gob.mx/conafor" }],
      regulation: [{ name: "Diario Oficial de la Federación", covers: "Regulation and policy changes", url: "https://www.dof.gob.mx/" }],
    },
  },
  {
    key: "gb", label: "United Kingdom", countries: ["GBR", "GB", "UK", "United Kingdom"],
    domains: {
      grid: [{ name: "NESO data portal", covers: "Transmission, connections register, balancing", url: "https://www.neso.energy/data-portal" }, { name: "DNO embedded capacity registers", covers: "Distribution connections", url: "https://www.energynetworks.org/" }],
      land: [{ name: "HM Land Registry", covers: "Title, INSPIRE index polygons", url: "https://www.gov.uk/government/organisations/land-registry" }, { name: "Local planning portals", covers: "Planning applications and decisions", url: "https://www.planningportal.co.uk/" }],
      water: [{ name: "Environment Agency", covers: "Flood maps, abstraction licences", url: "https://environment.data.gov.uk/" }],
      ecology: [{ name: "Natural England / MAGIC", covers: "SSSI, protected sites, habitats", url: "https://magic.defra.gov.uk/" }],
      counterparty: [{ name: "Companies House", covers: "Companies, officers, PSC (beneficial owners)", url: "https://find-and-update.company-information.service.gov.uk/", integrationKey: "companies_house" }, { name: "UK Sanctions List", covers: "Sanctions", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list", integrationKey: "uk_sanctions" }],
      funding: [{ name: "Contracts Finder / Find a Tender", covers: "Public procurement", url: "https://www.contractsfinder.service.gov.uk/", integrationKey: "uk_contracts" }],
    },
  },
  {
    key: "za", label: "Southern Africa", countries: ["ZAF", "ZA", "South Africa", "NAM", "NA", "Namibia", "BWA", "BW", "Botswana", "MOZ", "MZ", "Mozambique", "ZMB", "ZM", "Zambia", "ZWE", "ZW", "Zimbabwe", "LSO", "Lesotho", "SWZ", "Eswatini", "MWI", "Malawi"],
    domains: {
      grid: [{ name: "Eskom / NTCSA grid connection capacity assessment (GCCA)", covers: "Transmission capacity by supply area", url: "https://www.ntcsa.co.za/" }, { name: "SAPP (Southern African Power Pool)", covers: "Regional market and interconnectors", url: "https://www.sapp.co.zw/" }, { name: "World Bank EnergyData.info", covers: "Country power plants, grid and planning datasets", url: "https://energydata.info/", integrationKey: "energydata" }],
      regulation: [{ name: "NERSA", covers: "Generation licences and tariffs (South Africa)", url: "https://www.nersa.org.za/" }, { name: "DFFE environmental authorisation (SAHRIS / EIA)", covers: "EIA decisions and screening tool", url: "https://screening.environment.gov.za/" }, { name: "IPPPO (REIPPPP bid windows)", covers: "Procurement rounds and preferred bidders", url: "https://www.ipp-projects.co.za/" }],
      land: [{ name: "Deeds Office (DeedsWeb)", covers: "Title and ownership (South Africa)", url: "https://deedsweb.dalrrd.gov.za/" }, { name: "Communal land and traditional authority records", covers: "Customary tenure: verify with the authority and community", url: "https://www.dalrrd.gov.za/" }],
      ecology: [{ name: "SANBI BGIS", covers: "Critical biodiversity areas, ecosystem threat status", url: "https://bgis.sanbi.org/" }],
      water: [{ name: "DWS water use licences", covers: "Licensing and catchment status", url: "https://www.dws.gov.za/" }],
      funding: [{ name: "National Treasury eTenders (OCDS)", covers: "Tenders and awards", url: "https://www.etenders.gov.za/", integrationKey: "za_etenders" }],
    },
  },
  {
    key: "nz", label: "New Zealand", countries: ["NZL", "NZ", "New Zealand", "Aotearoa"],
    domains: {
      grid: [{ name: "Transpower connection queue and grid data", covers: "Transmission connections and capacity", url: "https://www.transpower.co.nz/" }, { name: "Electricity Authority EMI", covers: "Market data, generation, prices", url: "https://www.emi.ea.govt.nz/" }],
      land: [{ name: "LINZ Data Service", covers: "Parcels, titles (with Landonline), topography", url: "https://data.linz.govt.nz/" }, { name: "Māori Land Court (Māori Land Online)", covers: "Māori freehold land and owners: engage through the trusts and hapū", url: "https://www.maorilandcourt.govt.nz/" }],
      regulation: [{ name: "Fast-track Approvals / Environmental Protection Authority", covers: "Consents and decisions", url: "https://www.epa.govt.nz/" }, { name: "Regional council consents", covers: "Resource consents under the RMA", url: "https://www.lgnz.co.nz/" }],
      ecology: [{ name: "DOC public conservation land", covers: "Protected areas", url: "https://www.doc.govt.nz/" }],
    },
  },
  {
    key: "in", label: "India", countries: ["IND", "IN", "India"],
    domains: {
      grid: [{ name: "CEA (Central Electricity Authority)", covers: "Installed capacity, transmission plans", url: "https://cea.nic.in/" }, { name: "CTUIL connectivity", covers: "ISTS connectivity applications and grants", url: "https://www.ctuil.in/" }, { name: "Grid-India", covers: "System operation and reports", url: "https://grid-india.in/" }],
      regulation: [{ name: "CERC / state ERCs", covers: "Tariffs and regulations", url: "https://cercind.gov.in/" }, { name: "PARIVESH", covers: "Environment, forest and wildlife clearances", url: "https://parivesh.nic.in/" }],
      land: [{ name: "State land records (Bhulekh / DILRMP)", covers: "Records of rights", url: "https://dilrmp.gov.in/" }],
      funding: [{ name: "SECI / CPPP tenders", covers: "Renewable auctions and public procurement", url: "https://eprocure.gov.in/" }],
    },
  },
  {
    key: "eu", label: "European Union", countries: ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"],
    domains: {
      grid: [{ name: "ENTSO-E Transparency Platform", covers: "Load, generation, prices, cross-border flows", url: "https://transparency.entsoe.eu/", integrationKey: "entsoe" }],
      ecology: [{ name: "Natura 2000 (EEA)", covers: "Protected sites", url: "https://natura2000.eea.europa.eu/" }],
      funding: [{ name: "EU Funding & Tenders, TED", covers: "Grants and tenders", url: "https://ec.europa.eu/info/funding-tenders/", integrationKey: "eu_funding" }],
      counterparty: [{ name: "EU financial sanctions", covers: "Sanctions", url: "https://data.europa.eu/", integrationKey: "eu_sanctions" }],
    },
  },
];

const norm = (s: string) => s.trim().toLowerCase();

/** The pack for a stored project country (ISO3, ISO2 or name). */
export function packFor(country: string | null | undefined): Pack | null {
  if (!country) return null;
  const c = norm(country);
  return PACKS.find(p => p.countries.some(x => norm(x) === c)) ?? null;
}

/** Packs active for a workspace: one per country where it has a project. */
export function activePacks(countries: (string | null)[]) {
  const out = new Map<string, { pack: Pack; projects: number }>();
  for (const c of countries) { const p = packFor(c); if (p) out.set(p.key, { pack: p, projects: (out.get(p.key)?.projects ?? 0) + 1 }); }
  return [...out.values()];
}
