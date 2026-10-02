/** Shared map/directory filtering. It derives views of canonical records, never new entities. */
import { country as resolveCountry } from "@/lib/scan/countries";
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
export type DiscoveryFilters = { query: string; country: string; sector: string; topic: string };

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
      && (!filters.country || r.country === filters.country)
      && (!filters.sector || p.sector === filters.sector)
      && (!filters.topic || r.topics.includes(filters.topic))
      && words.every(word => haystack.includes(word));
  });
}

export function discoveryOptions(records: MapRecord[], field: "country" | "sector" | "topic"): string[] {
  return [...new Set(records.flatMap(r => field === "topic" ? r.topics : field === "country" ? [r.country ?? ""] : [String(r.feature.properties[field] ?? "")]).filter(Boolean))].sort();
}
