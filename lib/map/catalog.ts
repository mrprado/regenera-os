// Atlas layer catalogue: every basemap and live-intelligence layer on the globe, with its registry key, attribution,
// licence and refresh. Client-safe (no server imports). /api/map/catalog filters it by the integration registry and
// by configured keys before the browser sees it, so a disabled or licence-required source never loads.

export type LayerGroup = "basemap" | "earth" | "hazards" | "movement" | "space" | "nature" | "infrastructure" | "weather";
export type LayerKind = "raster" | "feed" | "osm" | "power" | "buildings" | "satellites" | "street";

export type CatalogLayer = {
  id: string;
  group: LayerGroup;
  label: string;
  description: string;
  registry: string;
  attribution: string;
  license: string;
  refresh: string;
  kind: LayerKind;
  /** Raster template: {z}/{x}/{y}, optional {date} (YYYY-MM-DD, UTC) for daily products. */
  tiles?: string;
  daily?: boolean;
  /** Days behind today for the most recent complete product (GIBS daily ≈ 1). */
  lagDays?: number;
  maxzoom?: number;
  minzoom?: number;
  opacity?: number;
  /** Live feed served by /api/map/live/[feed]. */
  feed?: string;
  /** Feed is fetched for the current view (bbox / centre) rather than globally. */
  viewport?: boolean;
  pollMs?: number;
  /** Server-only: env var that must be set for the layer to be offered. */
  needsEnv?: string;
  /** Server-only: when this env var is set, `keyedTiles` (with {key}) replaces the keyless `tiles`. */
  keyEnv?: string;
  keyedTiles?: string;
  swatch: string;
  legend?: { color: string; label: string }[];
  caveat?: string;
};

export const GROUP_LABELS: Record<LayerGroup, string> = {
  basemap: "Basemap",
  earth: "Earth observation",
  hazards: "Hazards and events",
  movement: "Movement",
  space: "Space",
  nature: "Nature and land",
  infrastructure: "Infrastructure",
  weather: "Weather and air",
};

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const GIBS_ATTR = "Imagery: NASA EOSDIS GIBS";

export const CATALOG: CatalogLayer[] = [
  // Basemaps (one at a time)
  { id: "esri", group: "basemap", label: "Satellite HD", description: "Esri World Imagery (Maxar, Airbus, national programmes): 0.3–0.5 m in most cities, building-level at close zoom. Street names and buildings are drawn over it.", registry: "esri", attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community", license: "Esri terms of use (set ESRI_API_KEY from a free ArcGIS Location Platform account for production use)", refresh: "Periodic (dates vary by area)", kind: "raster", tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", keyEnv: "ESRI_API_KEY", keyedTiles: "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token={key}", maxzoom: 19, swatch: "#4b6b4f" },
  { id: "s2cloudless", group: "basemap", label: "Sentinel-2 cloudless", description: "Cloud-free 10 m mosaic of the whole Earth (2016).", registry: "eox_s2cloudless", attribution: "Sentinel-2 cloudless by EOX (Copernicus Sentinel data 2016)", license: "CC BY 4.0", refresh: "Static (2016)", kind: "raster", tiles: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg", maxzoom: 15, swatch: "#5b7a52" },
  { id: "viirs_today", group: "basemap", label: "Yesterday from orbit", description: "VIIRS true colour: the planet as it looked yesterday, clouds and smoke included.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Daily", kind: "raster", tiles: `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, daily: true, lagDays: 1, maxzoom: 9, swatch: "#7fa3c4" },
  { id: "blackmarble", group: "basemap", label: "Earth at night", description: "VIIRS Black Marble night lights: settlement, industry and energy use.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Static (2016)", kind: "raster", tiles: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, maxzoom: 8, swatch: "#d9b45a" },
  { id: "bluemarble", group: "basemap", label: "Blue Marble relief", description: "NASA Blue Marble with shaded relief and bathymetry.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Static", kind: "raster", tiles: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, maxzoom: 8, swatch: "#3d6f94" },
  { id: "tactical", group: "basemap", label: "Tactical vector", description: "Dark OpenStreetMap vector map: water, land cover, roads and buildings.", registry: "openfreemap", attribution: "© OpenStreetMap contributors, OpenFreeMap", license: "ODbL", refresh: "Weekly", kind: "osm", swatch: "#1d2a22" },

  // Earth observation overlays
  { id: "ndvi", group: "earth", label: "Vegetation (NDVI, 8-day)", description: "MODIS vegetation index: green is dense, healthy vegetation; brown is bare or stressed land.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "8-day composite", kind: "raster", tiles: `${GIBS}/MODIS_Terra_NDVI_8Day/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`, daily: true, lagDays: 2, maxzoom: 9, opacity: 0.75, swatch: "#6fbf4a", legend: [{ color: "#8c510a", label: "Bare" }, { color: "#d9ef8b", label: "Sparse" }, { color: "#1a9850", label: "Dense" }] },
  { id: "lst", group: "earth", label: "Land surface temperature (day)", description: "MODIS thermal infrared: heat islands, drought stress and cooling potential.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Daily", kind: "raster", tiles: `${GIBS}/MODIS_Terra_Land_Surface_Temp_Day/default/{date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, daily: true, lagDays: 2, maxzoom: 7, opacity: 0.7, swatch: "#e0672f", legend: [{ color: "#2c7bb6", label: "Cool" }, { color: "#ffffbf", label: "" }, { color: "#d7191c", label: "Hot" }] },
  { id: "nightlights_now", group: "earth", label: "Night lights (overlay)", description: "Black Marble as an overlay: where people, industry and grids are.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Static (2016)", kind: "raster", tiles: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, maxzoom: 8, opacity: 0.55, swatch: "#f2d25c" },

  // Hazards and events
  { id: "quakes", group: "hazards", label: "Earthquakes (M2.5+, 7 days)", description: "USGS global catalogue. Size by magnitude, colour by age.", registry: "usgs_quakes", attribution: "Source: USGS", license: "Public domain", refresh: "Every 5 min", kind: "feed", feed: "quakes", pollMs: 300_000, swatch: "#ff8a4c", legend: [{ color: "#ff3b30", label: "< 24 h" }, { color: "#ff9f40", label: "< 3 days" }, { color: "#f2d25c", label: "Older" }] },
  { id: "fires", group: "hazards", label: "Active fires (24 h)", description: "NASA FIRMS thermal detections. VIIRS 375 m for the view with a FIRMS key; MODIS global otherwise.", registry: "nasa_firms_public", attribution: "NASA FIRMS", license: "NASA open data", refresh: "Every 3 h", kind: "feed", feed: "fires", viewport: true, pollMs: 900_000, swatch: "#ff5a1f", caveat: "A thermal anomaly is not always a wildfire (flares, industry, burning fields)." },
  { id: "events", group: "hazards", label: "Natural events (EONET)", description: "Open storms, wildfires, volcanoes, floods, dust and ice tracked by NASA.", registry: "nasa_eonet", attribution: "Source: NASA EONET", license: "NASA open data", refresh: "Hourly", kind: "feed", feed: "events", pollMs: 1_800_000, swatch: "#c07cff" },
  { id: "cyclones", group: "hazards", label: "Tropical cyclones", description: "NHC active storms with position, intensity and movement.", registry: "noaa_nhc", attribution: "Source: NOAA NHC", license: "Public domain", refresh: "Every 30 min", kind: "feed", feed: "cyclones", pollMs: 1_800_000, swatch: "#5ad1ff", caveat: "Atlantic and eastern/central Pacific; other basins appear in GDACS alerts." },

  // Movement
  { id: "flights", group: "movement", label: "Live aircraft", description: "ADS-B positions within 250 nm of the view centre, refreshed every 15 s.", registry: "adsb_lol", attribution: "Aircraft data: adsb.lol (ODbL)", license: "ODbL", refresh: "Every 15 s", kind: "feed", feed: "flights", viewport: true, pollMs: 15_000, swatch: "#7fe3ff", caveat: "Community receivers: gaps in coverage are not absence of aircraft." },
  { id: "military", group: "movement", label: "Military aircraft", description: "Aircraft flagged military by adsb.lol, worldwide.", registry: "adsb_lol", attribution: "Aircraft data: adsb.lol (ODbL)", license: "ODbL", refresh: "Every 30 s", kind: "feed", feed: "military", pollMs: 30_000, swatch: "#f2b35a" },

  // Space
  { id: "sat_eo", group: "space", label: "Earth-observation satellites", description: "Sentinel, Landsat and other imaging satellites with live ground tracks.", registry: "celestrak", attribution: "Orbital data: CelesTrak", license: "Free use with credit", refresh: "Elements every 6 h; positions every second", kind: "satellites", feed: "sat:resource", swatch: "#9dff8a", caveat: "Positions are SGP4 propagations, not observations." },
  { id: "sat_weather", group: "space", label: "Weather satellites", description: "GOES, Meteosat, NOAA, Himawari and others.", registry: "celestrak", attribution: "Orbital data: CelesTrak", license: "Free use with credit", refresh: "Elements every 6 h", kind: "satellites", feed: "sat:weather", swatch: "#6ec8ff" },
  { id: "sat_stations", group: "space", label: "Space stations", description: "ISS, Tiangong and crewed vehicles.", registry: "celestrak", attribution: "Orbital data: CelesTrak", license: "Free use with credit", refresh: "Elements every 6 h", kind: "satellites", feed: "sat:stations", swatch: "#ffffff" },
  { id: "sat_gnss", group: "space", label: "Navigation (GNSS)", description: "GPS, Galileo, GLONASS and BeiDou.", registry: "celestrak", attribution: "Orbital data: CelesTrak", license: "Free use with credit", refresh: "Elements every 6 h", kind: "satellites", feed: "sat:gnss", swatch: "#ffd36e" },

  // Nature and land
  { id: "forest_loss", group: "nature", label: "Tree cover loss (2001–latest)", description: "Hansen/UMD annual forest loss at 30 m. Pink is loss.", registry: "gfw_tiles", attribution: "Hansen/UMD/Google/USGS/NASA via Global Forest Watch", license: "CC BY 4.0", refresh: "Annual", kind: "raster", tiles: "https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.12/dynamic/{z}/{x}/{y}.png", maxzoom: 12, opacity: 0.9, swatch: "#ff4f9a" },
  { id: "surface_water", group: "nature", label: "Surface water occurrence (1984–2021)", description: "JRC Global Surface Water: how often each 30 m pixel was water over 38 years. Floodplains, reservoirs, lost wetlands.", registry: "jrc_gsw", attribution: "EC JRC/Google", license: "Free and open", refresh: "Static (2021)", kind: "raster", tiles: "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png", maxzoom: 13, opacity: 0.85, swatch: "#4f7cff", legend: [{ color: "#ffb3b3", label: "Rarely" }, { color: "#0000ff", label: "Permanent" }] },
  { id: "protected", group: "nature", label: "Protected areas (OSM)", description: "National parks, nature reserves and protected areas mapped in OpenStreetMap.", registry: "openfreemap", attribution: "© OpenStreetMap contributors", license: "ODbL", refresh: "Weekly", kind: "osm", swatch: "#6fbf73", caveat: "Community-mapped. The WDPA needs a commercial licence (registry: wdpa)." },

  // Infrastructure
  { id: "power", group: "infrastructure", label: "Power grid", description: "Transmission lines, substations and power plants from OpenStreetMap.", registry: "openinframap", attribution: "Open Infrastructure Map, © OpenStreetMap contributors", license: "ODbL", refresh: "Daily", kind: "power", swatch: "#f2b35a", caveat: "Community-mapped: incomplete by nature." },
  { id: "street_imagery", group: "infrastructure", label: "Street-level imagery (Mapillary)", description: "Crowd-sourced street-level photos (Meta Mapillary): green lines show where imagery exists; click one to open the street view.", registry: "mapillary", attribution: "Street imagery © Mapillary contributors (CC BY-SA)", license: "CC BY-SA 4.0 imagery; free API token", refresh: "Continuous", kind: "street", tiles: "https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token={key}", needsEnv: "MAPILLARY_TOKEN", maxzoom: 14, swatch: "#35af6d", caveat: "Coverage depends on contributors; strongest in cities and along main roads." },
  { id: "buildings", group: "infrastructure", label: "3D buildings", description: "Extruded OpenStreetMap buildings from zoom 14.", registry: "openfreemap", attribution: "© OpenStreetMap contributors, OpenFreeMap", license: "ODbL", refresh: "Weekly", kind: "buildings", swatch: "#cfd8d2" },

  // Weather and air
  { id: "precip", group: "weather", label: "Precipitation (IMERG)", description: "NASA GPM half-hourly precipitation rate, daily mosaic.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Daily", kind: "raster", tiles: `${GIBS}/IMERG_Precipitation_Rate/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, daily: true, lagDays: 1, maxzoom: 6, opacity: 0.8, swatch: "#4aa3ff" },
  { id: "aerosol", group: "weather", label: "Aerosol (smoke, dust)", description: "MODIS aerosol optical depth: smoke plumes, dust and haze.", registry: "nasa_gibs", attribution: GIBS_ATTR, license: "NASA open data", refresh: "Daily", kind: "raster", tiles: `${GIBS}/MODIS_Terra_Aerosol/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, daily: true, lagDays: 1, maxzoom: 6, opacity: 0.7, swatch: "#c9a27a" },
];

export const BASEMAPS = CATALOG.filter(l => l.group === "basemap");
export const OVERLAYS = CATALOG.filter(l => l.group !== "basemap");

/** UTC date string `days` before `now`, for daily products. */
export function productDate(now: Date, days: number) {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Resolves a raster template for a date and (server-injected) key. */
export function tileUrl(layer: Pick<CatalogLayer, "tiles">, date: string, key = "") {
  return (layer.tiles ?? "").replace("{date}", date).replace("{key}", encodeURIComponent(key));
}

/** Catalogue as offered to the browser: registry-allowed, key present, key injected server-side. */
export type OfferedLayer = Omit<CatalogLayer, "needsEnv" | "keyEnv" | "keyedTiles">;
export function offerCatalog(states: Map<string, string>, env: Record<string, string | undefined>): OfferedLayer[] {
  return CATALOG.filter(l => {
    const state = states.get(l.registry);
    if (state === "disabled" || state === "license_required") return false;
    if (l.needsEnv && !env[l.needsEnv]) return false;
    return true;
  }).map(({ needsEnv, keyEnv, keyedTiles, ...l }) => {
    if (keyEnv && keyedTiles && env[keyEnv]) return { ...l, tiles: keyedTiles.replace("{key}", encodeURIComponent(env[keyEnv]!)) };
    return needsEnv && l.tiles ? { ...l, tiles: l.tiles.replace("{key}", encodeURIComponent(env[needsEnv] ?? "")) } : l;
  });
}

/** Share state: camera, basemap, overlays, sensor mode and tracked target, serialised in the URL hash. */
export type AtlasView = { lng: number; lat: number; zoom: number; bearing: number; pitch: number; base: string; layers: string[]; mode: string; track?: string };
export function encodeView(v: AtlasView) {
  const parts = [`c=${v.lat.toFixed(4)},${v.lng.toFixed(4)},${v.zoom.toFixed(2)},${Math.round(v.bearing)},${Math.round(v.pitch)}`, `b=${v.base}`, `m=${v.mode}`];
  if (v.layers.length) parts.push(`l=${v.layers.join(",")}`);
  if (v.track) parts.push(`t=${encodeURIComponent(v.track)}`);
  return parts.join("&");
}
export function decodeView(hash: string): Partial<AtlasView> {
  const out: Partial<AtlasView> = {};
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const c = params.get("c")?.split(",").map(Number);
  if (c && c.length >= 3 && c.slice(0, 3).every(Number.isFinite) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180) {
    out.lat = c[0]; out.lng = c[1]; out.zoom = Math.min(22, Math.max(0, c[2]));
    out.bearing = Number.isFinite(c[3]) ? c[3] : 0; out.pitch = Number.isFinite(c[4]) ? Math.min(85, Math.max(0, c[4])) : 0;
  }
  const ids = new Set(CATALOG.map(l => l.id));
  const b = params.get("b"); if (b && ids.has(b)) out.base = b;
  const m = params.get("m"); if (m && /^[a-z]{2,8}$/.test(m)) out.mode = m;
  const l = params.get("l"); if (l) out.layers = l.split(",").filter(id => ids.has(id) || /^(projects|organizations|deals|triggers|procurement|hazards)$/.test(id));
  const t = params.get("t"); if (t) out.track = t.slice(0, 80);
  return out;
}

/** Parses "19.43, -99.13", "19.43 N 99.13 W" or "-99.13,19.43" style coordinates (lat first when ambiguous). */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const s = input.trim().toUpperCase();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/);
  if (!m) return null;
  let a = Number(m[1]); let b = Number(m[3]);
  if (m[2] === "S") a = -Math.abs(a);
  if (m[4] === "W") b = -Math.abs(b);
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}
