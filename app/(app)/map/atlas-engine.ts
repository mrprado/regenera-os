// Atlas engine: base style with anchors, basemap switching, catalogue overlays (rasters, OSM vectors, power grid,
// 3D buildings, live feeds, satellites) and generated SDF icons. MapLibre only; no provider keys in here.
import type * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { tileUrl, type OfferedLayer } from "@/lib/map/catalog";

export const A_RASTER = "anchor-raster";
export const A_VECTOR = "anchor-vector";
export const A_FEED = "anchor-feed";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export function baseStyle(): StyleSpecification {
  const anchor = (id: string) => ({ id, type: "background" as const, layout: { visibility: "none" as const }, paint: { "background-color": "#000" } });
  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sky: {
      "sky-color": "#050b12", "horizon-color": "#5f8fb8", "fog-color": "#05080b",
      "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.2,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
    },
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 40] },
    sources: {
      dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Terrain: Mapzen / AWS Open Data" },
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap contributors, OpenFreeMap" },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#030608" } },
      // Tactical vector basemap (hidden unless chosen)
      { id: "tac-land", type: "background", layout: { visibility: "none" }, paint: { "background-color": "#0b1410" } },
      { id: "tac-landcover", type: "fill", source: "ofm", "source-layer": "landcover", layout: { visibility: "none" }, paint: { "fill-color": ["match", ["get", "class"], "wood", "#102419", "forest", "#102419", "grass", "#0f1d15", "ice", "#1b2a33", "sand", "#1c1a12", "#0e1913"], "fill-opacity": 0.9 } },
      { id: "tac-landuse", type: "fill", source: "ofm", "source-layer": "landuse", layout: { visibility: "none" }, paint: { "fill-color": ["match", ["get", "class"], "residential", "#141c18", "industrial", "#1d1a14", "commercial", "#1a1a18", "farmland", "#121a10", "#111914"], "fill-opacity": 0.8 } },
      { id: "tac-water", type: "fill", source: "ofm", "source-layer": "water", layout: { visibility: "none" }, paint: { "fill-color": "#06131d" } },
      { id: "tac-waterway", type: "line", source: "ofm", "source-layer": "waterway", layout: { visibility: "none" }, paint: { "line-color": "#0e2a3a", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2] } },
      { id: "tac-roads", type: "line", source: "ofm", "source-layer": "transportation", layout: { visibility: "none", "line-cap": "round" }, paint: { "line-color": ["match", ["get", "class"], "motorway", "#6b8f76", "trunk", "#5b7b66", "primary", "#4d6a58", "#2c3d33"], "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 5, 0.3, 10, 1, 16, 6] } },
      { id: "tac-buildings", type: "line", source: "ofm", "source-layer": "building", minzoom: 13, layout: { visibility: "none" }, paint: { "line-color": "#3e5a48", "line-width": 0.6 } },
      // Light street / analytical map (hidden unless chosen)
      { id: "lt-land", type: "background", layout: { visibility: "none" }, paint: { "background-color": "#f2efe7" } },
      { id: "lt-landcover", type: "fill", source: "ofm", "source-layer": "landcover", layout: { visibility: "none" }, paint: { "fill-color": ["match", ["get", "class"], ["wood", "forest"], "#d6e3c8", "grass", "#e1ead3", "wetland", "#d4e6de", "sand", "#efe6cf", "ice", "#f4f8fa", "#e6ecd9"], "fill-opacity": 0.8 } },
      { id: "lt-landuse", type: "fill", source: "ofm", "source-layer": "landuse", layout: { visibility: "none" }, paint: { "fill-color": ["match", ["get", "class"], "residential", "#ebe6dc", "industrial", "#e5dfd7", "commercial", "#efe4dc", ["cemetery", "park"], "#d9e7cc", "farmland", "#ecefd9", "#ece8df"], "fill-opacity": 0.7 } },
      { id: "lt-park", type: "fill", source: "ofm", "source-layer": "park", layout: { visibility: "none" }, paint: { "fill-color": "#cfe3bf", "fill-opacity": 0.6 } },
      { id: "lt-water", type: "fill", source: "ofm", "source-layer": "water", layout: { visibility: "none" }, paint: { "fill-color": "#b9d6e8" } },
      { id: "lt-waterway", type: "line", source: "ofm", "source-layer": "waterway", layout: { visibility: "none" }, paint: { "line-color": "#a9cbe0", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 16, 3] } },
      { id: "lt-buildings", type: "fill", source: "ofm", "source-layer": "building", minzoom: 14, layout: { visibility: "none" }, paint: { "fill-color": "#dcd6cb", "fill-outline-color": "#c8c0b3", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 16, 0.9] } },
      { id: "lt-road-casing", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 9, layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]],
        paint: { "line-color": "#cfc6b6", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 9, 0.8, 18, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 20, ["service"], 6, 14]] } },
      { id: "lt-roads", type: "line", source: "ofm", "source-layer": "transportation", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track", "path"]]],
        paint: { "line-color": ["match", ["get", "class"], ["motorway", "trunk"], "#f4c77d", "primary", "#f8dea5", ["path", "track"], "#d8cfbd", "#ffffff"], "line-dasharray": ["match", ["get", "class"], ["path", "track"], ["literal", [2, 1]], ["literal", [1, 0]]],
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 5, ["match", ["get", "class"], ["motorway", "trunk"], 0.8, 0.2], 18, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 17, ["service"], 4.5, ["path", "track"], 1.5, 11]] } },
      { id: "lt-rail", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 8, filter: ["==", ["get", "class"], "rail"], layout: { visibility: "none" }, paint: { "line-color": "#b9b2a6", "line-width": 1.2, "line-dasharray": [3, 2] } },
      { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.3, "hillshade-shadow-color": "#05080b", "hillshade-highlight-color": "#f2f0e9", "hillshade-accent-color": "#161816" } },
      anchor(A_RASTER),
      anchor(A_VECTOR),
      // Hybrid reference layers over imagery (OpenStreetMap via OpenFreeMap): roads, buildings, street names, places,
      // points of interest and house numbers, revealed progressively by zoom so detail appears only where it is legible.
      { id: "hy-roads", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 11, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "class"], ["motorway", "trunk"], "#f7c85c", "primary", "#f3dc8e", "#ffffff"], "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.25, 15, 0.45, 18, 0.35],
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, ["match", ["get", "class"], ["motorway", "trunk"], 1.2, 0.4], 18, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 10, ["service", "track"], 2.5, 6]] } },
      { id: "hy-buildings", type: "line", source: "ofm", "source-layer": "building", minzoom: 16, paint: { "line-color": "rgba(255,255,255,0.45)", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.4, 19, 1.2] } },
      { id: "hy-water-labels", type: "symbol", source: "ofm", "source-layer": "water_name", minzoom: 8,
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12 },
        paint: { "text-color": "#bfe3ff", "text-halo-color": "rgba(3,6,8,0.85)", "text-halo-width": 1.2 } },
      { id: "hy-road-labels", type: "symbol", source: "ofm", "source-layer": "transportation_name", minzoom: 13,
        layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 14], "text-max-angle": 30, "text-padding": 2 },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(3,6,8,0.9)", "text-halo-width": 1.5 } },
      { id: "hy-place-minor", type: "symbol", source: "ofm", "source-layer": "place", minzoom: 10, filter: ["in", ["get", "class"], ["literal", ["village", "suburb", "neighbourhood", "hamlet", "quarter"]]],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 16, 14], "text-transform": "uppercase", "text-letter-spacing": 0.08, "text-max-width": 8 },
        paint: { "text-color": "#f2f0e9", "text-halo-color": "rgba(3,6,8,0.85)", "text-halo-width": 1.3 } },
      { id: "hy-poi", type: "symbol", source: "ofm", "source-layer": "poi", minzoom: 15, filter: ["<=", ["coalesce", ["get", "rank"], 99], ["step", ["zoom"], 5, 16, 15, 17, 60]],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 9, "text-optional": true, "text-padding": 4 },
        paint: { "text-color": "#ffe9b0", "text-halo-color": "rgba(3,6,8,0.9)", "text-halo-width": 1.2 } },
      { id: "hy-housenumbers", type: "symbol", source: "ofm", "source-layer": "housenumber", minzoom: 18,
        layout: { "text-field": ["get", "housenumber"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-padding": 2 },
        paint: { "text-color": "#dfe7e2", "text-halo-color": "rgba(3,6,8,0.9)", "text-halo-width": 1 } },
      { id: "admin-1", type: "line", source: "ofm", "source-layer": "boundary", minzoom: 3.5, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "rgba(242,240,233,0.4)", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 10, 1.2], "line-dasharray": [2, 2] } },
      { id: "admin-0", type: "line", source: "ofm", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "#f2d25c", "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 5, 1.1, 10, 2] } },
      { id: "country-labels", type: "symbol", source: "ofm", "source-layer": "place", maxzoom: 7, filter: ["==", ["get", "class"], "country"],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 14], "text-transform": "uppercase", "text-letter-spacing": 0.22, "text-max-width": 8 },
        paint: { "text-color": "#f2f0e9", "text-halo-color": "rgba(3,6,8,0.85)", "text-halo-width": 1.4 } },
      { id: "city-labels", type: "symbol", source: "ofm", "source-layer": "place", minzoom: 4.5, filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 15], "text-anchor": "top", "text-offset": [0, 0.4] },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(3,6,8,0.9)", "text-halo-width": 1.3 } },
      anchor(A_FEED),
    ] as StyleSpecification["layers"],
  };
}

const TAC = ["tac-land", "tac-landcover", "tac-landuse", "tac-water", "tac-waterway", "tac-roads", "tac-buildings"];
const LT = ["lt-land", "lt-landcover", "lt-landuse", "lt-park", "lt-water", "lt-waterway", "lt-buildings", "lt-road-casing", "lt-roads", "lt-rail"];
const HY_LINES = ["hy-roads", "hy-buildings"];
const HY_TEXT = ["hy-water-labels", "hy-road-labels", "hy-place-minor", "hy-poi", "hy-housenumbers", "country-labels", "city-labels"];

/** Swaps the basemap: raster imagery / topo, the light street map or the dark analytical map, and sets the OSM
 *  reference layers (roads, names, POIs, buildings) on or off and light or dark to suit it. */
export function setBasemap(map: maplibregl.Map, layer: OfferedLayer | undefined, date: string) {
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");
  const tactical = !layer || layer.kind === "osm";
  const light = layer?.kind === "streets";
  const vis = (ids: string[], on: boolean) => { for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
  vis(TAC, tactical);
  vis(LT, light);
  // Imagery hybrid draws road lines over photos; the vector maps draw their own roads, so only labels are added.
  const labels = layer?.labels ?? (tactical ? "on-dark" : undefined);
  vis(HY_LINES, labels === "on-dark" && !tactical);
  vis(HY_TEXT, !!labels);
  // Global imagery (NASA, Sentinel-2) keeps country and city names for orientation; plain satellite and topo stay clean.
  if (!labels && layer?.kind === "raster" && layer.id !== "terrain" && layer.id !== "esri_plain") vis(["country-labels", "city-labels"], true);
  if (layer?.muted && map.getLayer("hy-poi")) map.setLayoutProperty("hy-poi", "visibility", "none");
  const dark = labels !== "on-light";
  for (const id of HY_TEXT) if (map.getLayer(id)) {
    map.setPaintProperty(id, "text-color", dark ? (id === "hy-water-labels" ? "#bfe3ff" : id === "hy-poi" ? "#ffe9b0" : "#ffffff") : (id === "hy-water-labels" ? "#3e6f8e" : id === "hy-poi" ? "#6b5a3a" : "#2b2f2c"));
    map.setPaintProperty(id, "text-halo-color", dark ? "rgba(3,6,8,0.9)" : "rgba(255,255,255,0.92)");
  }
  if (map.getLayer("hillshade")) map.setPaintProperty("hillshade", "hillshade-exaggeration", light ? 0.18 : 0.3);
  if (tactical || light || !layer?.tiles) return;
  map.addSource("basemap", { type: "raster", tiles: [tileUrl(layer, date)], tileSize: 256, maxzoom: layer.maxzoom ?? 18, attribution: layer.attribution });
  map.addLayer({ id: "basemap", type: "raster", source: "basemap", paint: { "raster-fade-duration": 200, "raster-contrast": 0.06, "raster-saturation": -0.05 } }, "hillshade");
}

// ---------- Icons ----------
function icon(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#fff"; c.strokeStyle = "#fff";
  draw(c, size);
  return c.getImageData(0, 0, size, size);
}
export function addIcons(map: maplibregl.Map) {
  if (map.hasImage("plane")) return;
  map.addImage("plane", icon(48, (c, s) => {
    const k = s / 48;
    c.beginPath();
    c.moveTo(24 * k, 3 * k); c.lineTo(27 * k, 16 * k); c.lineTo(44 * k, 26 * k); c.lineTo(44 * k, 30 * k); c.lineTo(27 * k, 25 * k);
    c.lineTo(26 * k, 37 * k); c.lineTo(32 * k, 42 * k); c.lineTo(32 * k, 45 * k); c.lineTo(24 * k, 42.5 * k); c.lineTo(16 * k, 45 * k);
    c.lineTo(16 * k, 42 * k); c.lineTo(22 * k, 37 * k); c.lineTo(21 * k, 25 * k); c.lineTo(4 * k, 30 * k); c.lineTo(4 * k, 26 * k); c.lineTo(21 * k, 16 * k);
    c.closePath(); c.fill();
  }), { sdf: true });
  map.addImage("sat", icon(40, (c, s) => {
    const m = s / 2;
    c.fillRect(m - 5, m - 5, 10, 10);
    c.fillRect(m - 18, m - 3, 10, 6); c.fillRect(m + 8, m - 3, 10, 6);
    c.fillRect(m - 1, m - 8, 2, 3);
  }), { sdf: true });
  map.addImage("storm", icon(56, (c, s) => {
    const m = s / 2; c.lineWidth = 5;
    c.beginPath(); c.arc(m, m, 9, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(m, m, 18, Math.PI * 0.1, Math.PI * 0.75); c.stroke();
    c.beginPath(); c.arc(m, m, 18, Math.PI * 1.1, Math.PI * 1.75); c.stroke();
  }), { sdf: true });
  map.addImage("tri", icon(32, (c, s) => {
    c.beginPath(); c.moveTo(s / 2, 4); c.lineTo(s - 4, s - 5); c.lineTo(4, s - 5); c.closePath(); c.fill();
  }), { sdf: true });
}

// ---------- Overlays ----------
const EVENT_COLORS: [string, string][] = [["wildfires", "#ff5a1f"], ["severeStorms", "#5ad1ff"], ["volcanoes", "#ff3b30"], ["floods", "#4a90ff"], ["seaLakeIce", "#dff6ff"], ["dustHaze", "#c9a27a"], ["drought", "#d9a441"], ["landslides", "#a47551"], ["earthquakes", "#ff8a4c"], ["snow", "#ffffff"], ["tempExtremes", "#ff6f91"], ["manmade", "#b0b0b0"], ["waterColor", "#2fd3b2"]];
const ALT_COLOR: ExpressionSpecification = ["case", ["get", "military"], "#f2b35a", ["get", "ground"], "#9aa8b5",
  ["interpolate", ["linear"], ["coalesce", ["get", "altFt"], 0], 0, "#7fffd4", 10000, "#7fe3ff", 25000, "#6ea8ff", 40000, "#c79bff"]];

/** Layer ids a catalogue overlay adds (for visibility, clicks and detection). */
export function overlayLayerIds(l: OfferedLayer): string[] {
  const p = `ov-${l.id}`;
  if (l.kind === "raster") return [p];
  if (l.kind === "buildings") return [p];
  if (l.kind === "street") return [`${p}-seq`, `${p}-img`];
  if (l.kind === "power") return [`${p}-lines`, `${p}-plants`, `${p}-subs`];
  if (l.kind === "osm") return [`${p}-fill`, `${p}-line`];
  if (l.kind === "satellites") return [`${p}-pt`, `${p}-label`];
  if (l.id === "quakes") return [`${p}-halo`, `${p}-pt`, `${p}-label`];
  if (l.id === "fires") return [`${p}-heat`, `${p}-pt`];
  if (l.id === "events") return [`${p}-track`, `${p}-pt`, `${p}-label`];
  if (l.id === "cyclones") return [`${p}-icon`];
  if (l.id === "flights" || l.id === "military") return [`${p}-icon`, `${p}-label`];
  return [`${p}-pt`];
}
/** Clickable layer ids of an overlay. */
export function clickableIds(l: OfferedLayer): string[] {
  return overlayLayerIds(l).filter(id => /-(pt|icon|plants|subs)$/.test(id));
}

export function addOverlay(map: maplibregl.Map, l: OfferedLayer, date: string) {
  const p = `ov-${l.id}`;
  if (map.getSource(p)) return;
  if (l.kind === "raster") {
    map.addSource(p, { type: "raster", tiles: [tileUrl(l, date)], tileSize: 256, maxzoom: l.maxzoom ?? 12, attribution: l.attribution });
    map.addLayer({ id: p, type: "raster", source: p, paint: { "raster-opacity": l.opacity ?? 0.8, "raster-fade-duration": 250 } }, A_RASTER);
    return;
  }
  if (l.kind === "buildings") {
    map.addSource(p, { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: l.attribution });
    map.addLayer({ id: p, type: "fill-extrusion", source: p, "source-layer": "building", minzoom: 13.5, paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#8fa39a", 60, "#cfd8d2", 200, "#f5efe0"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.85, "fill-extrusion-vertical-gradient": true,
    } }, A_FEED);
    return;
  }
  if (l.kind === "street") {
    // Mapillary coverage: sequences as lines, images as points from z14; clicking an image opens the street-level viewer.
    map.addSource(p, { type: "vector", tiles: [tileUrl(l, date)], minzoom: 6, maxzoom: 14, attribution: l.attribution });
    map.addLayer({ id: `${p}-seq`, type: "line", source: p, "source-layer": "sequence", paint: { "line-color": "#35af6d", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 14, 2.4], "line-opacity": 0.85 } }, A_FEED);
    map.addLayer({ id: `${p}-img`, type: "circle", source: p, "source-layer": "image", minzoom: 15, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2.5, 19, 6], "circle-color": "#35af6d", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } }, A_FEED);
    map.on("click", `${p}-img`, e => {
      const id = e.features?.[0]?.properties?.id;
      if (id) window.open(`https://www.mapillary.com/app/?pKey=${encodeURIComponent(String(id))}&focus=photo`, "_blank", "noopener,noreferrer");
    });
    map.on("mouseenter", `${p}-img`, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", `${p}-img`, () => { map.getCanvas().style.cursor = ""; });
    return;
  }
  if (l.kind === "osm") {
    map.addSource(p, { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: l.attribution });
    const filter: ExpressionSpecification = ["in", ["get", "class"], ["literal", ["national_park", "nature_reserve", "protected_area"]]];
    map.addLayer({ id: `${p}-fill`, type: "fill", source: p, "source-layer": "park", filter, paint: { "fill-color": "#6fbf73", "fill-opacity": 0.16 } }, A_VECTOR);
    map.addLayer({ id: `${p}-line`, type: "line", source: p, "source-layer": "park", filter, paint: { "line-color": "#8fdc8f", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 10, 1.6], "line-dasharray": [3, 1.5] } }, A_VECTOR);
    return;
  }
  if (l.kind === "power") {
    map.addSource(p, { type: "vector", tiles: ["https://openinframap.org/map/power/{z}/{x}/{y}.pbf"], maxzoom: 17, attribution: l.attribution });
    map.addLayer({ id: `${p}-lines`, type: "line", source: p, "source-layer": "power_line", minzoom: 2, paint: {
      "line-color": ["interpolate", ["linear"], ["to-number", ["coalesce", ["get", "voltage"], 0], 0], 0, "#a0a0a0", 100000, "#f2d25c", 220000, "#f2b35a", 380000, "#ff6a4d", 700000, "#ff4fd8"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 8, 1.2, 14, 2.6], "line-opacity": 0.9 } }, A_VECTOR);
    map.addLayer({ id: `${p}-subs`, type: "circle", source: p, "source-layer": "power_substation_point", minzoom: 7, paint: { "circle-radius": 3, "circle-color": "#f2b35a", "circle-stroke-color": "#05080b", "circle-stroke-width": 1 } }, A_VECTOR);
    map.addLayer({ id: `${p}-plants`, type: "circle", source: p, "source-layer": "power_plant_point", minzoom: 4, paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 6],
      "circle-color": ["match", ["get", "source"], "solar", "#f2d25c", "wind", "#9fd3e6", "hydro", "#4a90ff", "nuclear", "#c79bff", "coal", "#6b6b6b", "gas", "#ff8a4c", "oil", "#a47551", "biomass", "#7ac47f", "geothermal", "#ff6f91", "#f2f0e9"],
      "circle-stroke-color": "#05080b", "circle-stroke-width": 1 } }, A_VECTOR);
    return;
  }
  map.addSource(p, { type: "geojson", data: EMPTY });
  if (l.kind === "satellites") {
    map.addLayer({ id: `${p}-pt`, type: "symbol", source: p, layout: { "icon-image": "sat", "icon-size": ["interpolate", ["linear"], ["zoom"], 0, 0.32, 6, 0.5], "icon-allow-overlap": true, "icon-ignore-placement": true }, paint: { "icon-color": l.swatch, "icon-halo-color": "rgba(0,0,0,.6)", "icon-halo-width": 1 } }, A_FEED);
    map.addLayer({ id: `${p}-label`, type: "symbol", source: p, minzoom: 2.5, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true }, paint: { "text-color": l.swatch, "text-halo-color": "rgba(3,6,8,.9)", "text-halo-width": 1.2 } }, A_FEED);
    return;
  }
  if (l.id === "quakes") {
    const age: ExpressionSpecification = ["step", ["get", "ageH"], "#ff3b30", 24, "#ff9f40", 72, "#f2d25c"];
    const r: ExpressionSpecification = ["interpolate", ["exponential", 1.6], ["coalesce", ["get", "mag"], 2.5], 2.5, 3, 5, 9, 7, 22, 9, 40];
    map.addLayer({ id: `${p}-halo`, type: "circle", source: p, filter: ["<", ["get", "ageH"], 24], paint: { "circle-radius": r, "circle-color": age, "circle-opacity": 0.2, "circle-blur": 0.4 } }, A_FEED);
    map.addLayer({ id: `${p}-pt`, type: "circle", source: p, paint: { "circle-radius": r, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": age, "circle-stroke-width": 1.6 } }, A_FEED);
    map.addLayer({ id: `${p}-label`, type: "symbol", source: p, filter: [">=", ["coalesce", ["get", "mag"], 0], 4.5], layout: { "text-field": ["concat", "M", ["to-string", ["get", "mag"]]], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#ffd2b0", "text-halo-color": "rgba(3,6,8,.9)", "text-halo-width": 1.2 } }, A_FEED);
    return;
  }
  if (l.id === "fires") {
    map.addLayer({ id: `${p}-heat`, type: "heatmap", source: p, maxzoom: 7, paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0.2, 50, 1], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 7, 1.6],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 3, 7, 14], "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 7, 0],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "#6b1d00", 0.5, "#ff5a1f", 0.8, "#ffb300", 1, "#fff3b0"],
    } }, A_FEED);
    map.addLayer({ id: `${p}-pt`, type: "circle", source: p, minzoom: 5, paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2, 12, ["interpolate", ["linear"], ["get", "frp"], 0, 4, 200, 12]],
      "circle-color": ["interpolate", ["linear"], ["get", "frp"], 0, "#ffb300", 20, "#ff5a1f", 100, "#ff1f1f"], "circle-blur": 0.35, "circle-opacity": 0.9 } }, A_FEED);
    return;
  }
  if (l.id === "events") {
    const col = ["match", ["get", "category"], ...EVENT_COLORS.flat(), "#c07cff"] as unknown as ExpressionSpecification;
    map.addLayer({ id: `${p}-track`, type: "line", source: p, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": col, "line-width": 1.4, "line-dasharray": [2, 2], "line-opacity": 0.8 } }, A_FEED);
    map.addLayer({ id: `${p}-pt`, type: "symbol", source: p, filter: ["==", ["geometry-type"], "Point"], layout: { "icon-image": "tri", "icon-size": 0.55, "icon-allow-overlap": true }, paint: { "icon-color": col, "icon-halo-color": "rgba(0,0,0,.7)", "icon-halo-width": 1.5 } }, A_FEED);
    map.addLayer({ id: `${p}-label`, type: "symbol", source: p, minzoom: 3, filter: ["==", ["geometry-type"], "Point"], layout: { "text-field": ["get", "title"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 12, "text-optional": true }, paint: { "text-color": "#eadcff", "text-halo-color": "rgba(3,6,8,.9)", "text-halo-width": 1.2 } }, A_FEED);
    return;
  }
  if (l.id === "cyclones") {
    map.addLayer({ id: `${p}-icon`, type: "symbol", source: p, layout: { "icon-image": "storm", "icon-size": ["interpolate", ["linear"], ["coalesce", ["get", "windKt"], 30], 30, 0.55, 130, 1.1], "icon-allow-overlap": true, "icon-rotate": 0,
      "text-field": ["concat", ["get", "name"], "\n", ["get", "classLabel"], " · ", ["to-string", ["coalesce", ["get", "windKt"], "?"]], " kt"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 2.2], "text-anchor": "top" },
      paint: { "icon-color": "#5ad1ff", "icon-halo-color": "rgba(0,0,0,.7)", "icon-halo-width": 1, "text-color": "#bfefff", "text-halo-color": "rgba(3,6,8,.9)", "text-halo-width": 1.3 } }, A_FEED);
    return;
  }
  if (l.id === "flights" || l.id === "military") {
    map.addLayer({ id: `${p}-icon`, type: "symbol", source: p, layout: { "icon-image": "plane", "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 8, 0.5, 14, 0.8], "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-color": ALT_COLOR, "icon-halo-color": "rgba(0,0,0,.65)", "icon-halo-width": 1 } }, A_FEED);
    map.addLayer({ id: `${p}-label`, type: "symbol", source: p, minzoom: 6.5, layout: { "text-field": ["coalesce", ["get", "callsign"], ["get", "reg"], ""], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": ALT_COLOR, "text-halo-color": "rgba(3,6,8,.9)", "text-halo-width": 1.2 } }, A_FEED);
  }
}

export function removeOverlay(map: maplibregl.Map, l: OfferedLayer) {
  for (const id of overlayLayerIds(l)) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(`ov-${l.id}`)) map.removeSource(`ov-${l.id}`);
}

/** Selection highlight + tracked-target trail, drawn above everything. */
export function addTrackLayers(map: maplibregl.Map) {
  if (map.getSource("track")) return;
  map.addSource("track", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "track-line", type: "line", source: "track", filter: ["==", ["geometry-type"], "LineString"], paint: {
    "line-color": ["coalesce", ["get", "color"], "#9dff8a"], "line-width": 1.6, "line-opacity": ["coalesce", ["get", "opacity"], 0.85], "line-dasharray": ["literal", [1, 0]] } });
  map.addLayer({ id: "track-ring", type: "circle", source: "track", filter: ["==", ["geometry-type"], "Point"], paint: {
    "circle-radius": 16, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#9dff8a", "circle-stroke-width": 1.5 } });
}
