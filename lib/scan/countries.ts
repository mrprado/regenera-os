// Country reference for scan geography and filters: every ISO 3166-1 country and territory, with alpha-3 (what
// organizations.country stores), alpha-2 (GLEIF filters) and the English short name (Apollo location filters).
// Regions group them for presets and the picker. GCC is a group inside the Middle East & North Africa: the two are not
// interchangeable. A region is a search shortcut, not a claim that any provider covers every country in it.
export type Region = "north_america" | "central_america_caribbean" | "south_america" | "europe" | "mena" | "africa" | "asia_pacific" | "remote";
/** Selectable geography groups: the eight regions plus GCC (a subset of MENA). */
export type GeoGroup = Region | "gcc";
export type Country = { iso3: string; iso2: string; name: string; region: Region };

export const REGION_LABELS: Record<GeoGroup, string> = {
  north_america: "North America", central_america_caribbean: "Central America & Caribbean", south_america: "South America",
  europe: "Europe", mena: "Middle East & North Africa (MENA)", gcc: "Gulf Cooperation Council (GCC)", africa: "Sub-Saharan Africa",
  asia_pacific: "Asia-Pacific (incl. South & Central Asia)", remote: "Antarctica & remote territories",
};
/** GCC member states. Also in MENA; selecting MENA includes them, selecting GCC does not include the rest of MENA. */
export const GCC = ["SAU", "ARE", "QAT", "OMN", "BHR", "KWT"];

// [iso3, iso2, name] per region. Names are the common English short names; formal and local names are aliases below.
const DATA: Record<Region, [string, string, string][]> = {
  north_america: [["USA", "US", "United States"], ["CAN", "CA", "Canada"], ["MEX", "MX", "Mexico"], ["GRL", "GL", "Greenland"], ["BMU", "BM", "Bermuda"], ["SPM", "PM", "Saint Pierre and Miquelon"]],
  central_america_caribbean: [
    ["GTM", "GT", "Guatemala"], ["BLZ", "BZ", "Belize"], ["HND", "HN", "Honduras"], ["SLV", "SV", "El Salvador"], ["NIC", "NI", "Nicaragua"], ["CRI", "CR", "Costa Rica"], ["PAN", "PA", "Panama"],
    ["CUB", "CU", "Cuba"], ["HTI", "HT", "Haiti"], ["DOM", "DO", "Dominican Republic"], ["JAM", "JM", "Jamaica"], ["PRI", "PR", "Puerto Rico"], ["BHS", "BS", "Bahamas"], ["BRB", "BB", "Barbados"],
    ["TTO", "TT", "Trinidad and Tobago"], ["GRD", "GD", "Grenada"], ["LCA", "LC", "Saint Lucia"], ["VCT", "VC", "Saint Vincent and the Grenadines"], ["ATG", "AG", "Antigua and Barbuda"],
    ["KNA", "KN", "Saint Kitts and Nevis"], ["DMA", "DM", "Dominica"], ["ABW", "AW", "Aruba"], ["CUW", "CW", "Curaçao"], ["SXM", "SX", "Sint Maarten"], ["BES", "BQ", "Caribbean Netherlands"],
    ["VGB", "VG", "British Virgin Islands"], ["VIR", "VI", "US Virgin Islands"], ["CYM", "KY", "Cayman Islands"], ["TCA", "TC", "Turks and Caicos Islands"], ["AIA", "AI", "Anguilla"],
    ["MSR", "MS", "Montserrat"], ["GLP", "GP", "Guadeloupe"], ["MTQ", "MQ", "Martinique"], ["BLM", "BL", "Saint Barthélemy"], ["MAF", "MF", "Saint Martin"],
  ],
  south_america: [
    ["ARG", "AR", "Argentina"], ["BOL", "BO", "Bolivia"], ["BRA", "BR", "Brazil"], ["CHL", "CL", "Chile"], ["COL", "CO", "Colombia"], ["ECU", "EC", "Ecuador"], ["GUY", "GY", "Guyana"],
    ["PRY", "PY", "Paraguay"], ["PER", "PE", "Peru"], ["SUR", "SR", "Suriname"], ["URY", "UY", "Uruguay"], ["VEN", "VE", "Venezuela"], ["GUF", "GF", "French Guiana"], ["FLK", "FK", "Falkland Islands"],
  ],
  europe: [
    ["ALB", "AL", "Albania"], ["AND", "AD", "Andorra"], ["AUT", "AT", "Austria"], ["BLR", "BY", "Belarus"], ["BEL", "BE", "Belgium"], ["BIH", "BA", "Bosnia and Herzegovina"], ["BGR", "BG", "Bulgaria"],
    ["HRV", "HR", "Croatia"], ["CYP", "CY", "Cyprus"], ["CZE", "CZ", "Czechia"], ["DNK", "DK", "Denmark"], ["EST", "EE", "Estonia"], ["FIN", "FI", "Finland"], ["FRA", "FR", "France"],
    ["DEU", "DE", "Germany"], ["GRC", "GR", "Greece"], ["HUN", "HU", "Hungary"], ["ISL", "IS", "Iceland"], ["IRL", "IE", "Ireland"], ["ITA", "IT", "Italy"], ["XKX", "XK", "Kosovo"],
    ["LVA", "LV", "Latvia"], ["LIE", "LI", "Liechtenstein"], ["LTU", "LT", "Lithuania"], ["LUX", "LU", "Luxembourg"], ["MLT", "MT", "Malta"], ["MDA", "MD", "Moldova"], ["MCO", "MC", "Monaco"],
    ["MNE", "ME", "Montenegro"], ["NLD", "NL", "Netherlands"], ["MKD", "MK", "North Macedonia"], ["NOR", "NO", "Norway"], ["POL", "PL", "Poland"], ["PRT", "PT", "Portugal"], ["ROU", "RO", "Romania"],
    ["RUS", "RU", "Russia"], ["SMR", "SM", "San Marino"], ["SRB", "RS", "Serbia"], ["SVK", "SK", "Slovakia"], ["SVN", "SI", "Slovenia"], ["ESP", "ES", "Spain"], ["SWE", "SE", "Sweden"],
    ["CHE", "CH", "Switzerland"], ["TUR", "TR", "Turkey"], ["UKR", "UA", "Ukraine"], ["GBR", "GB", "United Kingdom"], ["VAT", "VA", "Vatican City"], ["FRO", "FO", "Faroe Islands"],
    ["GIB", "GI", "Gibraltar"], ["GGY", "GG", "Guernsey"], ["JEY", "JE", "Jersey"], ["IMN", "IM", "Isle of Man"], ["ALA", "AX", "Åland Islands"], ["SJM", "SJ", "Svalbard and Jan Mayen"],
  ],
  mena: [
    ["DZA", "DZ", "Algeria"], ["BHR", "BH", "Bahrain"], ["EGY", "EG", "Egypt"], ["IRN", "IR", "Iran"], ["IRQ", "IQ", "Iraq"], ["ISR", "IL", "Israel"], ["JOR", "JO", "Jordan"], ["KWT", "KW", "Kuwait"],
    ["LBN", "LB", "Lebanon"], ["LBY", "LY", "Libya"], ["MAR", "MA", "Morocco"], ["OMN", "OM", "Oman"], ["PSE", "PS", "Palestine"], ["QAT", "QA", "Qatar"], ["SAU", "SA", "Saudi Arabia"],
    ["SYR", "SY", "Syria"], ["TUN", "TN", "Tunisia"], ["ARE", "AE", "United Arab Emirates"], ["YEM", "YE", "Yemen"], ["ESH", "EH", "Western Sahara"],
  ],
  africa: [
    ["AGO", "AO", "Angola"], ["BEN", "BJ", "Benin"], ["BWA", "BW", "Botswana"], ["BFA", "BF", "Burkina Faso"], ["BDI", "BI", "Burundi"], ["CPV", "CV", "Cabo Verde"], ["CMR", "CM", "Cameroon"],
    ["CAF", "CF", "Central African Republic"], ["TCD", "TD", "Chad"], ["COM", "KM", "Comoros"], ["COD", "CD", "Democratic Republic of the Congo"], ["COG", "CG", "Republic of the Congo"],
    ["CIV", "CI", "Côte d'Ivoire"], ["DJI", "DJ", "Djibouti"], ["GNQ", "GQ", "Equatorial Guinea"], ["ERI", "ER", "Eritrea"], ["SWZ", "SZ", "Eswatini"], ["ETH", "ET", "Ethiopia"], ["GAB", "GA", "Gabon"],
    ["GMB", "GM", "Gambia"], ["GHA", "GH", "Ghana"], ["GIN", "GN", "Guinea"], ["GNB", "GW", "Guinea-Bissau"], ["KEN", "KE", "Kenya"], ["LSO", "LS", "Lesotho"], ["LBR", "LR", "Liberia"],
    ["MDG", "MG", "Madagascar"], ["MWI", "MW", "Malawi"], ["MLI", "ML", "Mali"], ["MRT", "MR", "Mauritania"], ["MUS", "MU", "Mauritius"], ["MOZ", "MZ", "Mozambique"], ["NAM", "NA", "Namibia"],
    ["NER", "NE", "Niger"], ["NGA", "NG", "Nigeria"], ["RWA", "RW", "Rwanda"], ["STP", "ST", "São Tomé and Príncipe"], ["SEN", "SN", "Senegal"], ["SYC", "SC", "Seychelles"], ["SLE", "SL", "Sierra Leone"],
    ["SOM", "SO", "Somalia"], ["ZAF", "ZA", "South Africa"], ["SSD", "SS", "South Sudan"], ["SDN", "SD", "Sudan"], ["TZA", "TZ", "Tanzania"], ["TGO", "TG", "Togo"], ["UGA", "UG", "Uganda"],
    ["ZMB", "ZM", "Zambia"], ["ZWE", "ZW", "Zimbabwe"], ["REU", "RE", "Réunion"], ["MYT", "YT", "Mayotte"], ["SHN", "SH", "Saint Helena"],
  ],
  asia_pacific: [
    ["AFG", "AF", "Afghanistan"], ["ARM", "AM", "Armenia"], ["AZE", "AZ", "Azerbaijan"], ["GEO", "GE", "Georgia"], ["KAZ", "KZ", "Kazakhstan"], ["KGZ", "KG", "Kyrgyzstan"], ["TJK", "TJ", "Tajikistan"],
    ["TKM", "TM", "Turkmenistan"], ["UZB", "UZ", "Uzbekistan"], ["BGD", "BD", "Bangladesh"], ["BTN", "BT", "Bhutan"], ["IND", "IN", "India"], ["MDV", "MV", "Maldives"], ["NPL", "NP", "Nepal"],
    ["PAK", "PK", "Pakistan"], ["LKA", "LK", "Sri Lanka"], ["BRN", "BN", "Brunei"], ["KHM", "KH", "Cambodia"], ["IDN", "ID", "Indonesia"], ["LAO", "LA", "Laos"], ["MYS", "MY", "Malaysia"],
    ["MMR", "MM", "Myanmar"], ["PHL", "PH", "Philippines"], ["SGP", "SG", "Singapore"], ["THA", "TH", "Thailand"], ["TLS", "TL", "Timor-Leste"], ["VNM", "VN", "Vietnam"], ["CHN", "CN", "China"],
    ["HKG", "HK", "Hong Kong"], ["MAC", "MO", "Macao"], ["MNG", "MN", "Mongolia"], ["PRK", "KP", "North Korea"], ["KOR", "KR", "South Korea"], ["JPN", "JP", "Japan"], ["TWN", "TW", "Taiwan"],
    ["AUS", "AU", "Australia"], ["NZL", "NZ", "New Zealand"], ["PNG", "PG", "Papua New Guinea"], ["FJI", "FJ", "Fiji"], ["SLB", "SB", "Solomon Islands"], ["VUT", "VU", "Vanuatu"], ["WSM", "WS", "Samoa"],
    ["TON", "TO", "Tonga"], ["KIR", "KI", "Kiribati"], ["TUV", "TV", "Tuvalu"], ["NRU", "NR", "Nauru"], ["FSM", "FM", "Micronesia"], ["MHL", "MH", "Marshall Islands"], ["PLW", "PW", "Palau"],
    ["NCL", "NC", "New Caledonia"], ["PYF", "PF", "French Polynesia"], ["GUM", "GU", "Guam"], ["ASM", "AS", "American Samoa"], ["MNP", "MP", "Northern Mariana Islands"], ["COK", "CK", "Cook Islands"],
    ["NIU", "NU", "Niue"], ["TKL", "TK", "Tokelau"], ["WLF", "WF", "Wallis and Futuna"], ["NFK", "NF", "Norfolk Island"], ["PCN", "PN", "Pitcairn Islands"], ["CXR", "CX", "Christmas Island"],
    ["CCK", "CC", "Cocos (Keeling) Islands"], ["IOT", "IO", "British Indian Ocean Territory"], ["UMI", "UM", "US Minor Outlying Islands"],
  ],
  remote: [["ATA", "AQ", "Antarctica"], ["BVT", "BV", "Bouvet Island"], ["HMD", "HM", "Heard Island and McDonald Islands"], ["SGS", "GS", "South Georgia and the South Sandwich Islands"], ["ATF", "TF", "French Southern Territories"]],
};

export const COUNTRIES: Country[] = (Object.entries(DATA) as [Region, [string, string, string][]][])
  .flatMap(([region, rows]) => rows.map(([iso3, iso2, name]) => ({ iso3, iso2, name, region })));

/** Formal names, local spellings and abbreviations providers use. Keys are matched after normalize(). */
const ALIASES: Record<string, string> = {
  "united states of america": "USA", "us": "USA", "usa": "USA", "u s": "USA", "u s a": "USA", "america": "USA", "estados unidos": "USA", "eeuu": "USA",
  "uk": "GBR", "u k": "GBR", "great britain": "GBR", "britain": "GBR", "england": "GBR", "scotland": "GBR", "wales": "GBR", "northern ireland": "GBR", "united kingdom of great britain and northern ireland": "GBR",
  "uae": "ARE", "u a e": "ARE", "emirates": "ARE", "emiratos arabes unidos": "ARE", "dubai": "ARE", "abu dhabi": "ARE",
  "ksa": "SAU", "kingdom of saudi arabia": "SAU", "arabia saudita": "SAU",
  "russian federation": "RUS", "republic of korea": "KOR", "korea republic of": "KOR", "korea": "KOR", "democratic people's republic of korea": "PRK", "dprk": "PRK",
  "iran islamic republic of": "IRN", "islamic republic of iran": "IRN", "viet nam": "VNM", "lao pdr": "LAO", "lao people's democratic republic": "LAO", "syrian arab republic": "SYR",
  "united republic of tanzania": "TZA", "tanzania united republic of": "TZA", "plurinational state of bolivia": "BOL", "bolivia plurinational state of": "BOL",
  "venezuela bolivarian republic of": "VEN", "bolivarian republic of venezuela": "VEN", "republic of moldova": "MDA", "moldova republic of": "MDA", "czech republic": "CZE",
  "turkiye": "TUR", "ivory coast": "CIV", "cote d'ivoire": "CIV", "cote divoire": "CIV", "cape verde": "CPV", "swaziland": "SWZ", "burma": "MMR",
  "drc": "COD", "dr congo": "COD", "congo kinshasa": "COD", "congo democratic republic of the": "COD", "congo the democratic republic of the": "COD",
  "congo": "COG", "congo brazzaville": "COG", "republic of congo": "COG", "macedonia": "MKD", "state of palestine": "PSE", "palestinian territories": "PSE",
  "hong kong sar": "HKG", "macau": "MAC", "macao sar": "MAC", "holland": "NLD", "the netherlands": "NLD", "east timor": "TLS", "micronesia federated states of": "FSM",
  "brunei darussalam": "BRN", "the bahamas": "BHS", "the gambia": "GMB", "holy see": "VAT", "vatican": "VAT", "taiwan province of china": "TWN",
  "mexico": "MEX", "méxico": "MEX", "brasil": "BRA", "espana": "ESP", "deutschland": "DEU", "perú": "PER", "panamá": "PAN", "republica dominicana": "DOM",
  "sao tome and principe": "STP", "curacao": "CUW", "reunion": "REU", "saint barthelemy": "BLM", "aland islands": "ALA",
  "united states virgin islands": "VIR", "virgin islands british": "VGB", "virgin islands u s": "VIR", "bonaire": "BES", "falkland islands (malvinas)": "FLK",
};

/** Lowercase, accents and dots removed, "the " dropped, whitespace collapsed: "U.S.A." → "u s a", "México" → "mexico". */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ`]/g, "'").toLowerCase().replace(/\./g, " ").replace(/[,()]/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
}

const BY_CODE = new Map<string, Country>();
const BY_NAME = new Map<string, Country>();
for (const c of COUNTRIES) { BY_CODE.set(c.iso3, c); BY_CODE.set(c.iso2, c); BY_NAME.set(normalize(c.name), c); }
for (const [alias, iso3] of Object.entries(ALIASES)) BY_NAME.set(normalize(alias), BY_CODE.get(iso3)!);

/** Resolves ISO3, ISO2, an English name, a formal name or a common alias (any case or accents) to a Country; null when unknown. */
export function country(input: string | null | undefined): Country | null {
  if (!input) return null;
  const t = input.trim();
  if (/^[A-Za-z]{2,3}$/.test(t)) { const byCode = BY_CODE.get(t.toUpperCase()); if (byCode) return byCode; }
  return BY_NAME.get(normalize(t)) ?? null;
}
export const countryName = (code: string | null | undefined) => country(code)?.name ?? code ?? "";
export const isGeoGroup = (g: string): g is GeoGroup => g in REGION_LABELS;
export const countriesIn = (group: GeoGroup) => (group === "gcc" ? [...GCC] : COUNTRIES.filter(c => c.region === group).map(c => c.iso3));
export const geoLabel = (g: string) => (isGeoGroup(g) ? REGION_LABELS[g] : countryName(g));

/** Expands a mix of country codes/names and region keys into ISO3 codes. Unresolved entries are kept as given
 *  (upper-cased) so a stored value outside the reference is never silently dropped. Empty means worldwide. */
export function expandGeography(items: string[]): string[] {
  const out = new Set<string>();
  for (const i of items) {
    if (isGeoGroup(i)) countriesIn(i).forEach(c => out.add(c));
    else { const c = country(i); out.add(c ? c.iso3 : i.trim().toUpperCase()); }
  }
  return [...out];
}

/** Parses free-text geography (comma, semicolon or newline separated; never split on spaces, so "United States" stays
 *  one entry) into canonical ISO3 codes and region keys. Unknown entries are returned, not dropped or guessed. */
export function parseGeography(text: string): { geography: string[]; unknown: string[] } {
  const geography: string[] = [], unknown: string[] = [];
  for (const raw of text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const key = normalize(raw).replace(/[ &-]+/g, "_");
    const group = (Object.keys(REGION_LABELS) as GeoGroup[]).find(g => g === key || normalize(REGION_LABELS[g]) === normalize(raw));
    if (group) { if (!geography.includes(group)) geography.push(group); continue; }
    const c = country(raw);
    if (c) { if (!geography.includes(c.iso3)) geography.push(c.iso3); } else unknown.push(raw);
  }
  return { geography, unknown };
}
