// Public capital-provider programmes (financing-program intelligence): who provides project debt, equity, de-risking,
// preparation capital or acquisition appetite for utility-scale solar + storage, and where. Institutions only, from their
// public mandates; no people, no contact details, nothing scraped. Eligibility, ticket sizes and country lists change:
// every entry is a starting point to verify, and matching shows the criteria met or failed, never a score.
// The lanes follow the three-lane capital routing (credit / equity / de-risking) plus preparation and acquisition.

export const LANES = {
  credit: "Credit / structured (senior, mezzanine, project finance)",
  equity: "Equity / anchor (development, construction, platform)",
  derisk: "De-risking (guarantees, political-risk and payment cover)",
  prep: "Project preparation (studies, grants, early development capital)",
  acquisition: "Acquisition (buyers of development-stage or operating projects)",
} as const;
export type Lane = keyof typeof LANES;

/** Region keys used by programmes; a project's ISO3 country resolves to the regions it belongs to. */
export const REGIONS: Record<string, string[]> = {
  AFRICA: ["ZWE", "NAM", "ZAF", "MOZ", "MUS", "TZA", "BWA", "ZMB", "KEN", "NGA", "GHA", "SEN", "EGY", "MAR", "UGA", "RWA", "MWI", "AGO", "CIV", "ETH"],
  SADC: ["ZWE", "NAM", "ZAF", "MOZ", "MUS", "TZA", "BWA", "ZMB", "MWI", "AGO", "LSO", "SWZ", "MDG", "COD", "SYC", "COM"],
  WB6: ["MNE", "SRB", "BIH", "ALB", "MKD", "XKX"],
  EU_NEIGHBOURHOOD: ["MNE", "SRB", "BIH", "ALB", "MKD", "XKX", "UKR", "MDA", "GEO", "TUR", "MAR", "EGY", "TUN", "JOR"],
  EM: ["ZWE", "NAM", "ZAF", "MOZ", "MUS", "TZA", "BWA", "ZMB", "KEN", "NGA", "GHA", "SEN", "EGY", "MAR", "MNE", "MEX", "BRA", "COL", "IND", "IDN", "VNM", "PHL", "PAK", "BGD"],
  OIC: ["MOZ", "EGY", "MAR", "SEN", "NGA", "UGA", "CIV", "TUR", "ALB", "IDN", "PAK", "BGD", "JOR", "TUN"],
};

export type Programme = {
  key: string; name: string; owner: string;
  kind: "mdb" | "dfi" | "fund" | "bank" | "guarantor" | "insurer" | "ipp" | "facility";
  lanes: Lane[];
  /** Region keys (REGIONS) or ISO3 codes. */
  regions: string[];
  instruments: string;
  fit: string;
  url: string;
  /** What to confirm before outreach (status, eligibility, membership). */
  verify?: string;
  shariah?: boolean;
};

export const PROGRAMMES: Programme[] = [
  // ---- Credit / structured ----
  { key: "ifc", name: "IFC infrastructure & renewables (incl. Scaling Solar)", owner: "International Finance Corporation (World Bank Group)", kind: "mdb", lanes: ["credit", "equity"], regions: ["EM"], instruments: "Senior and subordinated loans, equity, blended finance, B-loan syndication", fit: "Private-sector utility-scale solar and storage with a bankable PPA", url: "https://www.ifc.org/en/what-we-do/sector-expertise/infrastructure", verify: "Country exposure limits; Zimbabwe activity is limited" },
  { key: "afdb_ns", name: "AfDB non-sovereign (private sector) operations", owner: "African Development Bank", kind: "mdb", lanes: ["credit", "derisk"], regions: ["AFRICA"], instruments: "Senior and mezzanine loans, partial risk guarantees", fit: "Grid-connected IPPs with credible offtake", url: "https://www.afdb.org/en/topics-and-sectors/sectors/energy-power", verify: "Arrears rules for Zimbabwe" },
  { key: "dbsa", name: "DBSA infrastructure lending", owner: "Development Bank of Southern Africa", kind: "dfi", lanes: ["credit", "prep"], regions: ["SADC"], instruments: "Project finance debt; Project Preparation Facility", fit: "SADC renewable IPPs, including South African programmes", url: "https://www.dbsa.org/", verify: "Cross-border appetite outside South Africa" },
  { key: "tdb", name: "TDB Group project & infrastructure finance", owner: "Eastern and Southern African Trade and Development Bank", kind: "dfi", lanes: ["credit"], regions: ["ZWE", "MUS", "TZA", "MOZ", "ZMB", "KEN", "UGA", "RWA", "MWI", "ETH"], instruments: "Project and corporate loans, trade finance", fit: "Energy projects in member states, including USD-earning offtake", url: "https://www.tdbgroup.org/", verify: "Member-state list and minimum ticket" },
  { key: "afreximbank", name: "Afreximbank project finance", owner: "African Export-Import Bank", kind: "dfi", lanes: ["credit", "derisk"], regions: ["AFRICA"], instruments: "Project finance, guarantees, trade finance", fit: "Export-linked energy (e.g. mining offtake earning hard currency)", url: "https://www.afreximbank.com/" },
  { key: "afc", name: "Africa Finance Corporation", owner: "Africa Finance Corporation", kind: "dfi", lanes: ["credit", "equity", "prep"], regions: ["AFRICA"], instruments: "Debt, equity, project development", fit: "Large-scale power and mining-linked infrastructure", url: "https://www.africafc.org/", verify: "Membership of the project country" },
  { key: "eaaif", name: "Emerging Africa & Asia Infrastructure Fund (PIDG)", owner: "Private Infrastructure Development Group; managed by Ninety One", kind: "fund", lanes: ["credit"], regions: ["AFRICA", "EM"], instruments: "Long-tenor senior and mezzanine debt", fit: "Commercially viable private infrastructure, including solar IPPs", url: "https://www.pidg.org/companies/emerging-africa-asia-infrastructure-fund", verify: "Country eligibility list" },
  { key: "edfi", name: "European DFIs (FMO, Proparco, DEG, Norfund, Swedfund, IFU, Finnfund, BIO, OeEB)", owner: "Association of European Development Finance Institutions members", kind: "dfi", lanes: ["credit", "equity"], regions: ["AFRICA", "EM"], instruments: "Senior and mezzanine debt, equity, co-financing clubs", fit: "Private renewable IPPs with E&S standards (IFC Performance Standards)", url: "https://www.edfi.eu/", verify: "Each DFI's country list and minimum size" },
  { key: "bii", name: "British International Investment", owner: "UK development finance institution", kind: "dfi", lanes: ["credit", "equity"], regions: ["AFRICA", "EM"], instruments: "Debt, equity, platform investments", fit: "Renewable platforms and large IPPs in Africa and South Asia", url: "https://www.bii.co.uk/" },
  { key: "ebrd", name: "EBRD sustainable energy", owner: "European Bank for Reconstruction and Development", kind: "mdb", lanes: ["credit", "equity"], regions: ["WB6", "EU_NEIGHBOURHOOD"], instruments: "Project finance, A/B loans, equity", fit: "Renewables in the Western Balkans, including Montenegro", url: "https://www.ebrd.com/sustainable-energy.html" },
  { key: "eib", name: "EIB Global", owner: "European Investment Bank", kind: "mdb", lanes: ["credit"], regions: ["WB6", "AFRICA"], instruments: "Long-term loans, intermediated credit lines", fit: "Utility-scale renewables and grid", url: "https://www.eib.org/en/projects/topics/energy-natural-resources/index.htm", verify: "Arrears rules for Zimbabwe" },
  { key: "dbn", name: "Development Bank of Namibia", owner: "Development Bank of Namibia", kind: "dfi", lanes: ["credit"], regions: ["NAM"], instruments: "Project finance for Namibian IPPs", fit: "IPPs selling to NamPower or under the Modified Single Buyer market", url: "https://www.dbn.com.na/" },
  { key: "sa_banks", name: "South African project-finance banks (Standard Bank, Nedbank, Absa, RMB)", owner: "Commercial banks", kind: "bank", lanes: ["credit"], regions: ["ZAF", "SADC"], instruments: "Senior project finance, ZAR and USD", fit: "REIPPPP and private-wheeling projects in South Africa; selected SADC deals", url: "https://www.ipp-projects.co.za/", verify: "Each bank's SADC cross-border appetite" },
  { key: "mu_banks", name: "Mauritian banks (MCB, SBM)", owner: "Commercial banks", kind: "bank", lanes: ["credit"], regions: ["MUS"], instruments: "Local-currency and USD project loans", fit: "CEB tender projects (consistent with the 80% local-bank structure stated)", url: "https://www.mcb.mu/" },
  // ---- Equity / anchor ----
  { key: "cfm", name: "Climate Investor One / Two", owner: "Climate Fund Managers", kind: "fund", lanes: ["equity", "prep"], regions: ["EM"], instruments: "Development and construction equity, then refinancing", fit: "Renewables in emerging markets from development to construction", url: "https://climatefundmanagers.com/" },
  { key: "africa50", name: "Africa50", owner: "Africa50 (AfDB-backed)", kind: "fund", lanes: ["equity", "prep"], regions: ["AFRICA"], instruments: "Project development and infrastructure equity", fit: "Large power projects needing development partner and equity", url: "https://www.africa50.com/" },
  { key: "aiim", name: "African Infrastructure Investment Managers", owner: "AIIM (Old Mutual)", kind: "fund", lanes: ["equity", "acquisition"], regions: ["AFRICA"], instruments: "Infrastructure equity, including operating renewables", fit: "Pension-style buyers of contracted African energy assets", url: "https://www.aiimafrica.com/" },
  { key: "infraco", name: "InfraCo Africa (PIDG)", owner: "Private Infrastructure Development Group", kind: "fund", lanes: ["prep", "equity"], regions: ["AFRICA"], instruments: "Early-stage development capital and co-development", fit: "Earlier-stage projects that need a co-developer to reach bankability", url: "https://www.infracoafrica.com/" },
  { key: "icd", name: "ICD (Islamic Development Bank Group private sector)", owner: "Islamic Corporation for the Development of the Private Sector", kind: "mdb", lanes: ["credit", "equity"], regions: ["OIC"], instruments: "Shariah-compliant project finance (ijara, istisna), equity", fit: "Projects in IsDB member countries; Shariah-compliant capital", url: "https://icd-ps.org/", shariah: true },
  // ---- De-risking ----
  { key: "miga", name: "MIGA political-risk insurance", owner: "Multilateral Investment Guarantee Agency (World Bank Group)", kind: "insurer", lanes: ["derisk"], regions: ["EM"], instruments: "Political risk insurance, breach of contract, non-honouring of sovereign obligations", fit: "Cross-border equity and debt into higher-risk jurisdictions", url: "https://www.miga.org/", verify: "Host-country membership and coverage" },
  { key: "ati", name: "African Trade & Investment Development Insurance (ATI)", owner: "ATI", kind: "insurer", lanes: ["derisk"], regions: ["AFRICA"], instruments: "Political risk and credit insurance, liquidity support for IPP payments", fit: "Payment-risk cover for IPPs selling to state utilities", url: "https://www.ati-aca.org/", verify: "Member-state list (determines eligibility)" },
  { key: "guarantco", name: "GuarantCo (PIDG)", owner: "Private Infrastructure Development Group", kind: "guarantor", lanes: ["derisk"], regions: ["AFRICA", "EM"], instruments: "Local-currency credit guarantees", fit: "Unlocking local-bank tranches (e.g. Mauritius, Namibia)", url: "https://guarantco.com/" },
  { key: "iciec", name: "ICIEC", owner: "Islamic Corporation for the Insurance of Investment and Export Credit (IsDB Group)", kind: "insurer", lanes: ["derisk"], regions: ["OIC"], instruments: "Shariah-compliant investment and credit insurance", fit: "De-risking Shariah-compliant investment", url: "https://iciec.isdb.org/", shariah: true },
  { key: "efsd", name: "EU Global Gateway / EFSD+ guarantees", owner: "European Commission", kind: "facility", lanes: ["derisk", "prep"], regions: ["AFRICA", "WB6"], instruments: "Guarantees and blended grants via partner DFIs", fit: "Renewables with an EU partner-DFI lender", url: "https://international-partnerships.ec.europa.eu/policies/global-gateway_en", verify: "Access is through a partner DFI or bank" },
  { key: "dfc", name: "U.S. International Development Finance Corporation", owner: "U.S. Government", kind: "dfi", lanes: ["credit", "derisk", "equity"], regions: ["EM"], instruments: "Loans, political risk insurance, equity", fit: "Large IPPs with U.S. sponsor or strategic interest", url: "https://www.dfc.gov/", verify: "Authority and priorities changed in 2025; confirm current status before outreach" },
  // ---- Preparation ----
  { key: "sefa", name: "Sustainable Energy Fund for Africa (SEFA)", owner: "African Development Bank", kind: "facility", lanes: ["prep"], regions: ["AFRICA"], instruments: "Project-preparation grants, technical assistance, catalytic equity", fit: "Studies and structuring for small-to-mid renewable IPPs", url: "https://www.afdb.org/en/topics-and-sectors/initiatives-partnerships/sustainable-energy-fund-for-africa" },
  { key: "wbif", name: "Western Balkans Investment Framework", owner: "EU, EBRD, EIB and bilateral donors", kind: "facility", lanes: ["prep"], regions: ["WB6"], instruments: "Technical-assistance grants, investment co-financing", fit: "Preparation of renewable projects in Montenegro and the region", url: "https://www.wbif.eu/" },
  // ---- Acquisition / strategic ----
  { key: "globeleq", name: "Globeleq", owner: "IPP owned by British International Investment and Norfund", kind: "ipp", lanes: ["acquisition", "equity"], regions: ["AFRICA"], instruments: "Co-development and acquisition of IPPs", fit: "Buyer or co-developer for African solar + storage IPPs", url: "https://globeleq.com/" },
  { key: "actis", name: "Actis energy infrastructure", owner: "Actis", kind: "fund", lanes: ["acquisition", "equity"], regions: ["EM"], instruments: "Platform equity, acquisition of contracted assets", fit: "Contracted renewable portfolios in emerging markets", url: "https://www.act.is/" },
  { key: "masdar", name: "Masdar", owner: "Abu Dhabi Future Energy Company", kind: "ipp", lanes: ["acquisition", "equity"], regions: ["AFRICA", "EM", "WB6"], instruments: "Equity, co-development, acquisition of utility-scale renewables", fit: "Gulf strategic investor for large solar + storage, including Africa and the Balkans", url: "https://masdar.ae/", verify: "Current country programme and minimum scale" },
  { key: "amea", name: "AMEA Power", owner: "AMEA Power (UAE)", kind: "ipp", lanes: ["acquisition", "equity"], regions: ["AFRICA"], instruments: "Develop-own and co-development of renewable IPPs", fit: "Africa-focused IPP partner for 50-500 MW solar + storage", url: "https://www.ameapower.com/" },
  { key: "etaf", name: "IRENA Energy Transition Accelerator Financing (ETAF)", owner: "IRENA with the Abu Dhabi Fund for Development and partners", kind: "facility", lanes: ["prep", "credit"], regions: ["AFRICA", "EM"], instruments: "Platform matching vetted projects to partner financing", fit: "Renewable projects in developing countries seeking DFI co-financing", url: "https://etafplatform.org/", verify: "Submission windows and eligibility" },
  { key: "scatec", name: "Scatec", owner: "Scatec ASA", kind: "ipp", lanes: ["acquisition", "equity"], regions: ["AFRICA", "EM"], instruments: "Develop-build-own; selective acquisition and partnership", fit: "Strategic partner for large solar + storage with strong offtake", url: "https://scatec.com/" },
];

/** Jurisdiction notes that change the route to capital, from public sources; each is a prompt to verify. */
export const COUNTRY_NOTES: Record<string, string> = {
  ZWE: "Zimbabwe has long-standing arrears to the World Bank, AfDB and EIB, which blocks sovereign-backed lending; private windows, political-risk cover and USD-earning offtake (e.g. mining exporters) with offshore revenue accounts are the usual route. Currency and utility payment record are central diligence items.",
  ZAF: "South Africa: lenders know REIPPPP and private-wheeling structures well; grid connection capacity (notably in the Northern and Western Cape) is the binding constraint and must be evidenced by Eskom.",
  NAM: "Namibia: NamPower offtake or the Modified Single Buyer market; DBN and South African banks are active lenders.",
  MUS: "Mauritius: CEB tender projects; land is scarce and solar yields are lower than mainland southern Africa; local banks are the natural lenders.",
  MOZ: "Mozambique: EDM offtake credit and currency are the key risks; southern sites (Maputo province) avoid the northern security issues. IsDB member (Shariah-compliant capital possible).",
  TZA: "Tanzania: TANESCO offtake; mining-linked energy needs evidence of the resource (e.g. a JORC or NI 43-101 report) and the commodity-payment terms reviewed by counsel.",
  MNE: "Montenegro: EU candidate; EBRD, EIB and WBIF are the main public sources; EPCG is the incumbent utility.",
};

export function regionsOf(iso3: string | null | undefined): string[] {
  if (!iso3) return [];
  const c = iso3.toUpperCase();
  return [c, ...Object.entries(REGIONS).filter(([, list]) => list.includes(c)).map(([k]) => k)];
}

const STAGE_LANES: Record<string, Lane[]> = {
  early: ["prep", "equity", "acquisition", "derisk"],
  development: ["credit", "equity", "derisk", "acquisition", "prep"],
  late: ["credit", "derisk", "acquisition"],
};
const EARLY = new Set(["opportunity", "screening", "diagnostic", "readiness"]);
const LATE = new Set(["diligence", "financial_close", "engineering", "procurement", "construction", "commissioning", "cod", "operations"]);

export type ProgrammeMatch = { programme: Programme; met: string[]; failed: string[]; verify: string[] };

/** Programmes for a project: geography and stage-appropriate lanes as criteria met/failed, plus what to verify. */
export function matchProgrammes(project: { country: string | null; stage: string; capacity: number | null; capacityUnit: string | null }, opts: { shariah?: boolean } = {}): ProgrammeMatch[] {
  const where = regionsOf(project.country);
  const phase = EARLY.has(project.stage) ? "early" : LATE.has(project.stage) ? "late" : "development";
  const wanted = STAGE_LANES[phase];
  return PROGRAMMES.map(p => {
    const met: string[] = [], failed: string[] = [], verify: string[] = [];
    const geo = p.regions.filter(r => where.includes(r));
    if (!project.country) verify.push("Project country not set");
    else if (geo.length) met.push(`Covers ${project.country} (${geo[0]})`);
    else failed.push(`Does not list ${project.country}`);
    const lanes = p.lanes.filter(l => wanted.includes(l));
    if (lanes.length) met.push(`Lane fits a ${phase}-stage project: ${lanes.map(l => LANES[l].split(" (")[0]).join(", ")}`);
    else failed.push(`Lanes (${p.lanes.join(", ")}) are for a different stage`);
    if (opts.shariah && p.shariah) met.push("Shariah-compliant");
    if (p.verify) verify.push(p.verify);
    if (project.country && COUNTRY_NOTES[project.country.toUpperCase()]) verify.push("See the country note");
    return { programme: p, met, failed, verify };
  }).filter(m => !m.failed.some(f => f.startsWith("Does not list")))
    .sort((a, b) => a.failed.length - b.failed.length || b.met.length - a.met.length || a.programme.name.localeCompare(b.programme.name));
}

/** CSV of programmes for import into Network as organizations (institutions only; no people). */
export function programmesCsv(rows: Programme[] = PROGRAMMES) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ["name", "owner", "kind", "lanes", "regions", "instruments", "fit", "website", "verify"];
  return [head.join(","), ...rows.map(p => [p.name, p.owner, p.kind, p.lanes.join("; "), p.regions.join("; "), p.instruments, p.fit, p.url, p.verify ?? ""].map(esc).join(","))].join("\n");
}
