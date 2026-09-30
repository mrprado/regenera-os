// Atlas data provenance and tiers (hardening prompt §7–9; Atlas prompt §37–40). Every catalogue layer must have an
// entry (tests/unit/atlas.test.ts). Licence and commercial-use terms are not repeated here: they come from the
// integration registry row for the layer's `registry` key, so there is one source of truth.
// Client-safe: no server imports.

export const TIERS = {
  1: { label: "Tier 1 · Global reference", note: "Broad, consistent coverage from an established public or scientific source." },
  2: { label: "Tier 2 · Jurisdiction-specific", note: "Government, utility, cadastral or planning data for a defined area." },
  3: { label: "Tier 3 · Client / project", note: "Private data uploaded for a client or project; visible only in its workspace." },
  4: { label: "Tier 4 · Modelled / derived", note: "Calculated from source data by a stated method; not a direct observation." },
  5: { label: "Tier 5 · Inferred / experimental", note: "Interpretation or classification with known gaps; use as a lead, not a fact." },
} as const;
export type Tier = keyof typeof TIERS;

export const CONFIDENCE = { verified: "Verified", high: "High", moderate: "Moderate", preliminary: "Preliminary", estimated: "Estimated", unknown: "Unknown" } as const;
export type Confidence = keyof typeof CONFIDENCE;

export type Provenance = {
  tier: Tier;
  provider: string;
  sourceUrl: string;
  geography: string;
  resolution: string;
  period: string;
  /** Expected age of the newest data when healthy, in hours; null = static reference or continuous imagery. */
  maxAgeH: number | null;
  confidence: Confidence;
  method?: string;
};

export const PROVENANCE: Record<string, Provenance> = {
  esri: { tier: 1, provider: "Esri World Imagery (Maxar, Airbus and others)", sourceUrl: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9", geography: "Global", resolution: "≈0.3–1 m in many urban areas; 10–15 m elsewhere", period: "Capture dates vary by area (often 1–5 years old)", maxAgeH: null, confidence: "high", method: "Mosaic of commercial and public imagery; capture date differs tile by tile." },
  esri_plain: { tier: 1, provider: "Esri World Imagery", sourceUrl: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9", geography: "Global", resolution: "≈0.3–1 m urban; 10–15 m elsewhere", period: "Capture dates vary by area", maxAgeH: null, confidence: "high" },
  terrain: { tier: 1, provider: "Esri World Topographic Map", sourceUrl: "https://www.arcgis.com/home/item.html?id=7dc6cea0b1764a1f9af2e679f642f0f5", geography: "Global", resolution: "Cartographic, zoom-dependent", period: "Periodic updates", maxAgeH: null, confidence: "high" },
  streets: { tier: 1, provider: "OpenStreetMap via OpenFreeMap", sourceUrl: "https://openfreemap.org", geography: "Global", resolution: "Vector, street level", period: "Weekly build", maxAgeH: 24 * 14, confidence: "moderate", method: "Volunteer-mapped; completeness varies by country." },
  light: { tier: 1, provider: "OpenStreetMap via OpenFreeMap", sourceUrl: "https://openfreemap.org", geography: "Global", resolution: "Vector", period: "Weekly build", maxAgeH: 24 * 14, confidence: "moderate" },
  tactical: { tier: 1, provider: "OpenStreetMap via OpenFreeMap", sourceUrl: "https://openfreemap.org", geography: "Global", resolution: "Vector", period: "Weekly build", maxAgeH: 24 * 14, confidence: "moderate" },
  s2cloudless: { tier: 1, provider: "EOX Sentinel-2 cloudless (Copernicus data)", sourceUrl: "https://s2maps.eu", geography: "Global", resolution: "10 m", period: "2016 mosaic", maxAgeH: null, confidence: "high", method: "Cloud-free composite of 2016 Sentinel-2 scenes." },
  viirs_today: { tier: 1, provider: "NASA GIBS (VIIRS true colour)", sourceUrl: "https://nasa-gibs.github.io/gibs-api-docs/", geography: "Global", resolution: "250–375 m", period: "Previous day", maxAgeH: 48, confidence: "high" },
  blackmarble: { tier: 1, provider: "NASA Black Marble", sourceUrl: "https://blackmarble.gsfc.nasa.gov", geography: "Global", resolution: "500 m", period: "2016", maxAgeH: null, confidence: "high" },
  bluemarble: { tier: 1, provider: "NASA Blue Marble (shaded relief)", sourceUrl: "https://visibleearth.nasa.gov", geography: "Global", resolution: "500 m", period: "Static", maxAgeH: null, confidence: "high" },
  ndvi: { tier: 1, provider: "NASA GIBS (MODIS NDVI)", sourceUrl: "https://nasa-gibs.github.io/gibs-api-docs/", geography: "Global land", resolution: "250 m", period: "8-day composite", maxAgeH: 24 * 16, confidence: "high", method: "Normalised difference vegetation index from MODIS surface reflectance." },
  lst: { tier: 1, provider: "NASA GIBS (MODIS land surface temperature)", sourceUrl: "https://nasa-gibs.github.io/gibs-api-docs/", geography: "Global land", resolution: "1 km", period: "Daily (clear-sky only)", maxAgeH: 72, confidence: "high", method: "Skin temperature, not air temperature; gaps under cloud." },
  nightlights_now: { tier: 1, provider: "NASA Black Marble", sourceUrl: "https://blackmarble.gsfc.nasa.gov", geography: "Global", resolution: "500 m", period: "2016", maxAgeH: null, confidence: "high" },
  quakes: { tier: 1, provider: "USGS Earthquake Hazards Program", sourceUrl: "https://earthquake.usgs.gov/earthquakes/feed/", geography: "Global (M2.5+)", resolution: "Event points", period: "Last 7 days", maxAgeH: 1, confidence: "high" },
  fires: { tier: 1, provider: "NASA FIRMS (VIIRS / MODIS)", sourceUrl: "https://firms.modaps.eosdis.nasa.gov", geography: "Global", resolution: "375 m / 1 km detections", period: "Last 24 h", maxAgeH: 12, confidence: "moderate", method: "Thermal anomaly detections; includes industrial heat sources and misses fires under cloud." },
  events: { tier: 1, provider: "NASA EONET", sourceUrl: "https://eonet.gsfc.nasa.gov", geography: "Global", resolution: "Curated event points", period: "Open events", maxAgeH: 48, confidence: "moderate", method: "Curated from agency sources; not exhaustive." },
  cyclones: { tier: 2, provider: "NOAA National Hurricane Center", sourceUrl: "https://www.nhc.noaa.gov", geography: "Atlantic, eastern and central Pacific basins", resolution: "Storm positions and forecast cones", period: "Active storms", maxAgeH: 12, confidence: "high", method: "Official advisories for NHC basins only; other basins are not covered." },
  flights: { tier: 1, provider: "adsb.lol (community ADS-B receivers)", sourceUrl: "https://adsb.lol", geography: "Global where receivers exist", resolution: "Aircraft positions", period: "Live", maxAgeH: 0.25, confidence: "moderate", method: "Community receiver network; oceans and remote areas have gaps." },
  military: { tier: 5, provider: "adsb.lol (community ADS-B receivers)", sourceUrl: "https://adsb.lol", geography: "Where receivers exist", resolution: "Aircraft positions", period: "Live", maxAgeH: 0.25, confidence: "preliminary", method: "Classification by transponder address ranges and database flags; many military aircraft do not broadcast." },
  sat_eo: { tier: 4, provider: "CelesTrak orbital elements", sourceUrl: "https://celestrak.org", geography: "Global", resolution: "Computed positions", period: "Elements refreshed every 6 h", maxAgeH: 24, confidence: "high", method: "Positions propagated from two-line elements (SGP4); accuracy degrades with element age." },
  sat_weather: { tier: 4, provider: "CelesTrak orbital elements", sourceUrl: "https://celestrak.org", geography: "Global", resolution: "Computed positions", period: "Elements every 6 h", maxAgeH: 24, confidence: "high", method: "SGP4 propagation." },
  sat_stations: { tier: 4, provider: "CelesTrak orbital elements", sourceUrl: "https://celestrak.org", geography: "Global", resolution: "Computed positions", period: "Elements every 6 h", maxAgeH: 24, confidence: "high", method: "SGP4 propagation." },
  sat_gnss: { tier: 4, provider: "CelesTrak orbital elements", sourceUrl: "https://celestrak.org", geography: "Global", resolution: "Computed positions", period: "Elements every 6 h", maxAgeH: 24, confidence: "high", method: "SGP4 propagation." },
  forest_loss: { tier: 1, provider: "Global Forest Watch (Hansen / UMD)", sourceUrl: "https://www.globalforestwatch.org", geography: "Global", resolution: "30 m", period: "2001 to latest annual release", maxAgeH: null, confidence: "moderate", method: "Landsat-based classification of stand-replacing tree cover loss; plantations and fire losses included." },
  surface_water: { tier: 1, provider: "JRC Global Surface Water", sourceUrl: "https://global-surface-water.appspot.com", geography: "Global", resolution: "30 m", period: "1984–2021", maxAgeH: null, confidence: "high", method: "Share of Landsat observations classified as water." },
  protected: { tier: 1, provider: "OpenStreetMap (protected-area tags)", sourceUrl: "https://wiki.openstreetmap.org/wiki/Tag:boundary%3Dprotected_area", geography: "Global, uneven", resolution: "Vector", period: "Weekly build", maxAgeH: 24 * 14, confidence: "preliminary", method: "Volunteer-tagged boundaries. Not the official WDPA register: confirm legal status with the authority." },
  power: { tier: 1, provider: "OpenInfraMap (OpenStreetMap power tags)", sourceUrl: "https://openinframap.org", geography: "Global, uneven", resolution: "Vector (lines, substations, plants)", period: "Daily build", maxAgeH: 24 * 7, confidence: "moderate", method: "Volunteer-mapped infrastructure. Voltage and capacity are often missing; not utility data and says nothing about available capacity." },
  street_imagery: { tier: 1, provider: "Mapillary (contributor photos)", sourceUrl: "https://www.mapillary.com", geography: "Where contributors have driven or walked", resolution: "Street-level photos", period: "Capture dates vary", maxAgeH: null, confidence: "moderate" },
  buildings: { tier: 1, provider: "OpenStreetMap via OpenFreeMap", sourceUrl: "https://openfreemap.org", geography: "Global, uneven", resolution: "Building footprints; heights where tagged", period: "Weekly build", maxAgeH: 24 * 14, confidence: "moderate", method: "Heights default when not tagged." },
  precip: { tier: 1, provider: "NASA GIBS (GPM IMERG)", sourceUrl: "https://gpm.nasa.gov/data/imerg", geography: "Global", resolution: "≈10 km", period: "Daily", maxAgeH: 72, confidence: "moderate", method: "Satellite precipitation estimate, calibrated with gauges in the final run." },
  aerosol: { tier: 1, provider: "NASA GIBS (aerosol optical depth)", sourceUrl: "https://nasa-gibs.github.io/gibs-api-docs/", geography: "Global", resolution: "≈10 km", period: "Daily", maxAgeH: 72, confidence: "moderate" },
};

export const FRESHNESS = { current: "Current", aging: "Aging", stale: "Stale", unavailable: "Unavailable", reference: "Reference (static)", on_demand: "Live on demand (loads when switched on)", not_tracked: "Not tracked" } as const;
export type Freshness = keyof typeof FRESHNESS;

/**
 * Freshness from the provider-call ledger. Only layers served through the Worker have a ledger; browser-loaded tiles
 * with a fixed vintage are "reference", and continuous tile services are "not tracked" rather than guessed.
 */
export function freshnessOf(p: Provenance, served: boolean, lastOk: string | null, lastFail: string | null, now = new Date()): { status: Freshness; ageH: number | null } {
  if (p.maxAgeH === null) return { status: "reference", ageH: null };
  if (!served) return { status: "not_tracked", ageH: null };
  if (!lastOk) return { status: lastFail ? "unavailable" : "not_tracked", ageH: null };
  const ageH = (now.getTime() - Date.parse(lastOk)) / 3_600_000;
  if (lastFail && lastFail > lastOk && ageH > p.maxAgeH) return { status: "unavailable", ageH };
  return { status: ageH <= p.maxAgeH ? "current" : ageH <= p.maxAgeH * 3 ? "aging" : "stale", ageH };
}
