// Country reference for scan geography and filters: ISO 3166 alpha-3 (what organizations.country stores), alpha-2
// (GLEIF filters) and the English name (Apollo location filters). Regions group them for presets. Not exhaustive:
// countries outside the list still work as stored values; they just have no region shortcut.
export type Country = { iso3: string; iso2: string; name: string; region: Region };
export type Region = "north_america" | "central_america_caribbean" | "south_america" | "europe" | "mena" | "africa" | "asia_pacific";

export const REGION_LABELS: Record<Region, string> = {
  north_america: "North America", central_america_caribbean: "Central America & Caribbean", south_america: "South America",
  europe: "Europe", mena: "Middle East & North Africa", africa: "Sub-Saharan Africa", asia_pacific: "Asia-Pacific",
};

const C = (iso3: string, iso2: string, name: string, region: Region): Country => ({ iso3, iso2, name, region });
export const COUNTRIES: Country[] = [
  C("USA", "US", "United States", "north_america"), C("CAN", "CA", "Canada", "north_america"), C("MEX", "MX", "Mexico", "north_america"),
  C("GTM", "GT", "Guatemala", "central_america_caribbean"), C("BLZ", "BZ", "Belize", "central_america_caribbean"), C("HND", "HN", "Honduras", "central_america_caribbean"),
  C("SLV", "SV", "El Salvador", "central_america_caribbean"), C("NIC", "NI", "Nicaragua", "central_america_caribbean"), C("CRI", "CR", "Costa Rica", "central_america_caribbean"),
  C("PAN", "PA", "Panama", "central_america_caribbean"), C("DOM", "DO", "Dominican Republic", "central_america_caribbean"), C("JAM", "JM", "Jamaica", "central_america_caribbean"),
  C("PRI", "PR", "Puerto Rico", "central_america_caribbean"),
  C("COL", "CO", "Colombia", "south_america"), C("PER", "PE", "Peru", "south_america"), C("CHL", "CL", "Chile", "south_america"), C("BRA", "BR", "Brazil", "south_america"),
  C("ARG", "AR", "Argentina", "south_america"), C("ECU", "EC", "Ecuador", "south_america"), C("URY", "UY", "Uruguay", "south_america"), C("PRY", "PY", "Paraguay", "south_america"), C("BOL", "BO", "Bolivia", "south_america"),
  C("GBR", "GB", "United Kingdom", "europe"), C("ESP", "ES", "Spain", "europe"), C("PRT", "PT", "Portugal", "europe"), C("FRA", "FR", "France", "europe"), C("DEU", "DE", "Germany", "europe"),
  C("NLD", "NL", "Netherlands", "europe"), C("ITA", "IT", "Italy", "europe"), C("CHE", "CH", "Switzerland", "europe"), C("IRL", "IE", "Ireland", "europe"), C("SWE", "SE", "Sweden", "europe"),
  C("NOR", "NO", "Norway", "europe"), C("DNK", "DK", "Denmark", "europe"), C("BEL", "BE", "Belgium", "europe"), C("LUX", "LU", "Luxembourg", "europe"), C("AUT", "AT", "Austria", "europe"),
  C("SAU", "SA", "Saudi Arabia", "mena"), C("ARE", "AE", "United Arab Emirates", "mena"), C("QAT", "QA", "Qatar", "mena"), C("OMN", "OM", "Oman", "mena"), C("BHR", "BH", "Bahrain", "mena"),
  C("KWT", "KW", "Kuwait", "mena"), C("EGY", "EG", "Egypt", "mena"), C("MAR", "MA", "Morocco", "mena"), C("JOR", "JO", "Jordan", "mena"),
  C("ZAF", "ZA", "South Africa", "africa"), C("KEN", "KE", "Kenya", "africa"), C("GHA", "GH", "Ghana", "africa"), C("NGA", "NG", "Nigeria", "africa"), C("RWA", "RW", "Rwanda", "africa"), C("ETH", "ET", "Ethiopia", "africa"),
  C("SGP", "SG", "Singapore", "asia_pacific"), C("IDN", "ID", "Indonesia", "asia_pacific"), C("IND", "IN", "India", "asia_pacific"), C("AUS", "AU", "Australia", "asia_pacific"),
  C("PHL", "PH", "Philippines", "asia_pacific"), C("JPN", "JP", "Japan", "asia_pacific"), C("NZL", "NZ", "New Zealand", "asia_pacific"), C("VNM", "VN", "Vietnam", "asia_pacific"),
];

const BY = new Map<string, Country>();
for (const c of COUNTRIES) for (const k of [c.iso3, c.iso2, c.name.toLowerCase()]) BY.set(k.toUpperCase() === k ? k : k.toLowerCase(), c);

/** Resolves ISO3, ISO2 or an English name (any case) to a Country; null when unknown. */
export function country(input: string | null | undefined): Country | null {
  if (!input) return null;
  const t = input.trim();
  return BY.get(t.toUpperCase()) ?? BY.get(t.toLowerCase()) ?? null;
}
export const countryName = (code: string | null | undefined) => country(code)?.name ?? code ?? "";
export const countriesIn = (region: Region) => COUNTRIES.filter(c => c.region === region).map(c => c.iso3);
/** Expands a mix of ISO3 codes and region keys into ISO3 codes. */
export function expandGeography(items: string[]): string[] {
  const out = new Set<string>();
  for (const i of items) {
    if (i in REGION_LABELS) countriesIn(i as Region).forEach(c => out.add(c));
    else { const c = country(i); out.add(c ? c.iso3 : i.toUpperCase()); }
  }
  return [...out];
}
