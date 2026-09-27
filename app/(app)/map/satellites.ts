// Browser-side SGP4 propagation of CelesTrak elements (satellite.js). Positions are computed, not observed.
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from "satellite.js";
import type { Feature, FeatureCollection } from "geojson";
import type { Omm } from "@/lib/map/live";

export type Sat = { id: string; name: string; norad: number; intlId: string; epoch: string; periodMin: number; inclination: number; rec: SatRec };

export function buildSats(elements: Omm[]): Sat[] {
  const out: Sat[] = [];
  for (const e of elements) {
    try {
      const rec = json2satrec(e as never);
      out.push({ id: `sat:${e.NORAD_CAT_ID}`, name: e.OBJECT_NAME, norad: e.NORAD_CAT_ID, intlId: e.OBJECT_ID, epoch: e.EPOCH, periodMin: 1440 / e.MEAN_MOTION, inclination: e.INCLINATION, rec });
    } catch { /* malformed element set: skip */ }
  }
  return out;
}

export type SatPosition = { lng: number; lat: number; altKm: number; speedKms: number };
export function position(s: Sat, when: Date): SatPosition | null {
  const pv = propagate(s.rec, when);
  if (!pv || typeof pv.position !== "object" || !pv.position) return null;
  const g = eciToGeodetic(pv.position, gstime(when));
  const v = pv.velocity && typeof pv.velocity === "object" ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0;
  const lng = degreesLong(g.longitude), lat = degreesLat(g.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat, altKm: g.height, speedKms: v };
}

export function satFeatures(sats: Sat[], when: Date): FeatureCollection {
  const features: Feature[] = [];
  for (const s of sats) {
    const p = position(s, when);
    if (!p) continue;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: s.id, name: s.name, norad: s.norad, altKm: Math.round(p.altKm), speedKms: Math.round(p.speedKms * 100) / 100 } });
  }
  return { type: "FeatureCollection", features };
}

/** Ground track from -past to +ahead minutes, split at the antimeridian. */
export function groundTrack(s: Sat, when: Date, pastMin = 30, aheadMin = 60): Feature[] {
  const segs: number[][][] = [[]];
  for (let m = -pastMin; m <= aheadMin; m += 1) {
    const p = position(s, new Date(when.getTime() + m * 60_000));
    if (!p) continue;
    const seg = segs[segs.length - 1];
    const prev = seg[seg.length - 1];
    if (prev && Math.abs(prev[0] - p.lng) > 180) segs.push([]);
    segs[segs.length - 1].push([p.lng, p.lat]);
  }
  return segs.filter(s => s.length > 1).map(coords => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { color: "#9dff8a", opacity: 0.7 } }));
}
