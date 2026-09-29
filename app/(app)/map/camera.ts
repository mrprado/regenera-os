// Central ATLAS camera: every programmatic move goes through here (lat/lng, zoom, heading, tilt), so behaviour and
// reduced-motion handling stay consistent across search, projects, missions, deep links and saved views.
import type * as maplibregl from "maplibre-gl";
import type { Geometry, Position } from "geojson";

export type CameraState = { lat: number; lng: number; zoom: number; heading: number; tilt: number };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ms = (d: number) => (reduced() ? 0 : d);

export function cameraState(map: maplibregl.Map): CameraState {
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: map.getZoom(), heading: map.getBearing(), tilt: map.getPitch() };
}

export function flyToCoordinates(map: maplibregl.Map, lat: number, lng: number, zoom = 15, o: { tilt?: number; heading?: number } = {}) {
  map.flyTo({ center: [lng, lat], zoom, pitch: o.tilt ?? map.getPitch(), bearing: o.heading ?? map.getBearing(), duration: ms(1800), essential: true });
}

function positions(g: Geometry): Position[] {
  switch (g.type) {
    case "Point": return [g.coordinates];
    case "MultiPoint": case "LineString": return g.coordinates;
    case "MultiLineString": case "Polygon": return g.coordinates.flat();
    case "MultiPolygon": return g.coordinates.flat(2);
    case "GeometryCollection": return g.geometries.flatMap(positions);
  }
}

export function geometryBounds(g: Geometry): [[number, number], [number, number]] | null {
  const ps = positions(g);
  if (!ps.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ps) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

/** Fit a site / project geometry with room for the side panels; points get a sensible site zoom. */
export function fitGeometry(map: maplibregl.Map, g: Geometry, o: { padding?: number; maxZoom?: number } = {}) {
  if (g.type === "Point") return flyToCoordinates(map, g.coordinates[1], g.coordinates[0], 15.5);
  const b = geometryBounds(g);
  if (!b) return;
  // Leave room for the side panels, but never more padding than the canvas can give (MapLibre throws otherwise).
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const padding = o.padding ?? { top: Math.round(h * 0.1), bottom: Math.round(h * 0.08), left: Math.round(w * 0.3), right: Math.round(w * 0.36) };
  try { map.fitBounds(b, { padding, maxZoom: o.maxZoom ?? 18, duration: ms(1800) }); }
  catch { map.flyTo({ center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], zoom: 14, duration: ms(1800) }); }
}

export function fitPortfolio(map: maplibregl.Map, points: [number, number][]) {
  if (!points.length) return;
  if (points.length === 1) return flyToCoordinates(map, points[0][1], points[0][0], 12);
  const b = geometryBounds({ type: "MultiPoint", coordinates: points })!;
  map.fitBounds(b, { padding: 120, maxZoom: 9, duration: ms(2000) });
}

export function resetNorth(map: maplibregl.Map) { map.easeTo({ bearing: 0, pitch: 0, duration: ms(800) }); }
