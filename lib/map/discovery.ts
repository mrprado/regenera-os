/** Shared map/directory filtering. It derives views of canonical records, never new entities. */
// Relative with the extension: this module also runs under plain Node (tests/map-discovery.node.test.mjs).
import { country as resolveCountry } from "../scan/countries.ts";
export const RECORD_LAYERS = ["projects", "organizations", "deals", "triggers", "procurement"] as const;
export type RecordLayer = (typeof RECORD_LAYERS)[number];
export type MapPoint = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number | null>;
};
export type MapRecord = { key: string; layer: RecordLayer; feature: MapPoint; label: string; location: string; topics: string[]; country: string | null };

/** One country name per record for filtering: the stored code or name (ISO3, ISO2 or English), else the last part of the
 *  location text ("Monterrey, Mexico"). Records with neither have no country and are only reachable unfiltered. */
export function recordCountry(p: Record<string, string | number | null>): string | null {
  const direct = resolveCountry(typeof p.country === "string" ? p.country : null);
  if (direct) return direct.name;
  if (typeof p.country === "string" && p.country.trim()) return p.country.trim();
  const loc = typeof p.location === "string" ? p.location.split(/[,·]/).map(x => x.trim()).filter(Boolean) : [];
  for (let i = loc.length - 1; i >= 0; i--) { const c = resolveCountry(loc[i]); if (c) return c.name; }
  return null;
}
export type Bounds = { west: number; south: number; east: number; north: number };
export type AreaGeometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
export type DiscoveryFilters = {
  query: string; country: string; sector: string; topic: string; stage?: string; assetClass?: string; assetClasses?: string[];
  /** Asset / project types (ASSET_TYPES keys): a record matches when it has ANY selected type (union within the dimension). */
  types?: string[];
  /** LIFECYCLE key; applies to project records only (other record kinds have different status systems). */
  lifecycle?: string;
  /** Recorded region (project subdivision). */
  region?: string;
  /** Current map area; west > east means the area crosses the antimeridian. */
  bounds?: Bounds | null;
  /** A real recorded or drawn boundary; records are kept when their point lies inside. */
  boundary?: AreaGeometry | null;
};

/** Asset / project types shown as Atlas chips. Derived only from the recorded asset class and the recorded technology field,
 *  never from a project name; a project can carry several (solar + storage). Other record kinds have no asset type. */
export const ASSET_TYPES: Record<string, string> = {
  solar: "Solar", wind: "Wind", storage: "Storage / BESS", solar_storage: "Solar + Storage", ev_charging: "EV Charging",
  land_real_estate: "Land & Real Estate", water: "Water", agriculture: "Agriculture", nature_restoration: "Nature & Restoration",
  community: "Community Development", industrial_redevelopment: "Industrial Redevelopment", hydro: "Hydro", geothermal: "Geothermal",
  grid: "Grid & transmission", hydrogen: "Hydrogen & fuels", waste_to_value: "Waste to value", transport: "Transport & logistics", other: "Other recorded type",
};
const CLASS_TO_TYPE: Record<string, string> = {
  solar: "solar", wind: "wind", storage: "storage", real_estate: "land_real_estate", mixed_use: "land_real_estate", water_infrastructure: "water",
  agriculture: "agriculture", nature_based: "nature_restoration", industrial: "industrial_redevelopment", hydro: "hydro", geothermal: "geothermal",
  grid: "grid", hydrogen: "hydrogen", waste_to_value: "waste_to_value", transport: "transport", other: "other",
};
export function assetTypesOf(p: Record<string, string | number | null>): string[] {
  const out = new Set<string>();
  const cls = typeof p.assetClass === "string" ? CLASS_TO_TYPE[p.assetClass] : undefined;
  if (cls) out.add(cls);
  const tech = typeof p.technology === "string" ? p.technology.toLowerCase() : "";
  if (/solar|photovolt|\bpv\b/.test(tech)) out.add("solar");
  if (/\bwind\b/.test(tech)) out.add("wind");
  if (/\bbess\b|batter|storage/.test(tech)) out.add("storage");
  if (/\bev\b|charging|charger/.test(tech)) out.add("ev_charging");
  if (out.has("solar") && out.has("storage")) out.add("solar_storage");
  return [...out];
}

/** Atlas lifecycle labels mapped onto the canonical project stages (every stored stage keeps its value). */
export const LIFECYCLE: { key: string; label: string; stages: string[] }[] = [
  { key: "identified", label: "Identified", stages: ["opportunity"] },
  { key: "screening", label: "Screening", stages: ["screening", "diagnostic"] },
  { key: "rights_feasibility", label: "Rights & Feasibility", stages: ["readiness"] },
  { key: "development", label: "Development", stages: ["development", "structuring", "capital_alignment", "diligence", "financial_close"] },
  { key: "construction", label: "Construction", stages: ["engineering", "procurement", "construction", "commissioning"] },
  { key: "operating", label: "Operating", stages: ["cod", "operations"] },
  { key: "redevelopment", label: "Redevelopment", stages: ["repowering"] },
  { key: "exited", label: "Exited", stages: ["exit", "decommissioning"] },
];
export const lifecycleOf = (stage: unknown) => LIFECYCLE.find(l => l.stages.includes(String(stage ?? "")))?.key ?? null;

/** Point in the current map area. Handles the antimeridian (west > east) and a view wider than the world. */
export function inBounds([lng, lat]: [number, number], b: Bounds): boolean {
  if (lat < b.south || lat > b.north) return false;
  if (b.east - b.west >= 360) return true;
  const w = ((b.west + 540) % 360) - 180, e = ((b.east + 540) % 360) - 180;
  return w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
}

/** Point in a Polygon / MultiPolygon (ray casting; holes excluded). */
export function pointInArea([x, y]: [number, number], g: AreaGeometry): boolean {
  const ring = (r: number[][]) => { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
  const poly = (p: number[][][]) => p.length > 0 && ring(p[0]) && !p.slice(1).some(ring);
  return g.type === "Polygon" ? poly(g.coordinates) : g.coordinates.some(poly);
}

export function validCoordinates(lng: unknown, lat: unknown): boolean {
  return typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180
    && typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90;
}

export function coordinateLabel([lng, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? "S" : "N"} · ${Math.abs(lng).toFixed(3)}° ${lng < 0 ? "W" : "E"}`;
}

export function safeWebsite(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function mapRecords(data: Record<RecordLayer, { features: MapPoint[] }>): MapRecord[] {
  return RECORD_LAYERS.flatMap(layer => data[layer].features.filter(f => validCoordinates(...f.geometry.coordinates)).map(feature => {
    const p = feature.properties;
    const topics = String(p.topics ?? "").split("|").map(t => t.trim()).filter(Boolean);
    return {
      key: `${layer}:${p.kind ?? ""}:${p.source ?? ""}:${p.id}`, layer, feature,
      label: String(p.name ?? p.summary ?? "Untitled record"),
      location: [p.location, p.country].filter(Boolean).join(" · "),
      topics, country: recordCountry(p),
    };
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export function filterRecords(records: MapRecord[], filters: DiscoveryFilters, visible: Partial<Record<RecordLayer, boolean>>): MapRecord[] {
  const words = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return records.filter(r => {
    const p = r.feature.properties;
    const haystack = [r.label, r.location, p.orgName, p.description, p.sector, p.assetClass, ...r.topics].filter(Boolean).join(" ").replace(/_/g, " ").toLocaleLowerCase();
    return visible[r.layer] !== false
      && (!filters.country || r.country === (resolveCountry(filters.country)?.name ?? filters.country))
      && (!filters.sector || p.sector === filters.sector)
      && (!filters.topic || r.topics.includes(filters.topic))
      && (!filters.stage || p.stage === filters.stage || p.status === filters.stage)
      && (!filters.assetClass || p.assetClass === filters.assetClass)
      && (!filters.assetClasses?.length || filters.assetClasses.includes(String(p.assetClass ?? "")))
      && (!filters.types?.length || assetTypesOf(p).some(t => filters.types!.includes(t)))
      && (!filters.lifecycle || (r.layer === "projects" && lifecycleOf(p.stage) === filters.lifecycle))
      && (!filters.region || p.region === filters.region)
      && (!filters.bounds || inBounds(r.feature.geometry.coordinates, filters.bounds))
      && (!filters.boundary || pointInArea(r.feature.geometry.coordinates, filters.boundary))
      && words.every(word => haystack.includes(word));
  });
}

export function discoveryOptions(records: MapRecord[], field: "country" | "sector" | "topic" | "stage" | "assetClass" | "region"): string[] {
  return [...new Set(records.flatMap(r => field === "topic" ? r.topics : field === "country" ? [r.country ?? ""] : [String(field === "stage" ? r.feature.properties.stage ?? r.feature.properties.status ?? "" : r.feature.properties[field] ?? "")]).filter(Boolean))].sort();
}

/** Counts per asset type among the given records (pass the records matching every OTHER active filter, so a chip's count is
 *  what selecting it would add). Also returns how many projects have no recorded type. */
export function typeCounts(records: MapRecord[]): { counts: Record<string, number>; unclassified: number } {
  const counts: Record<string, number> = {};
  let unclassified = 0;
  for (const r of records) {
    if (r.layer !== "projects") continue;
    const t = assetTypesOf(r.feature.properties);
    if (!t.length) unclassified++;
    for (const k of t) counts[k] = (counts[k] ?? 0) + 1;
  }
  return { counts, unclassified };
}
