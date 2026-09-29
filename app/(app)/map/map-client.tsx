"use client";

// Atlas: a 3D globe for spatial intelligence. Regenera records plus registry-gated live layers (quakes, fires,
// events, cyclones, aircraft, satellites, daily Earth observation, forest loss, protected areas, power grid, 3D
// buildings), sensor looks, a tactical HUD, detection boxes, click-to-track, chase cam, missions, orbit and tour,
// share links and keyboard control. The directory, layer library and drawing tools remain.
import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, RasterTileSource } from "maplibre-gl";
import type { Feature, FeatureCollection, Point as GeoPoint } from "geojson";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Compass, Crosshair, Globe2, Keyboard, Mountain, Orbit, Play, Scan, Search, Share2, Square, X } from "lucide-react";
import type { MapPayload } from "@/lib/map/features";
import { discoveryOptions, filterRecords, mapRecords, RECORD_LAYERS, type MapRecord } from "@/lib/map/discovery";
import SavedViews from "./saved-views";
import { decodeView, encodeView, parseCoordinates, productDate, type OfferedLayer } from "@/lib/map/catalog";
import type { Omm } from "@/lib/map/live";
import { SECTORS, TERRITORIAL_SYSTEMS } from "@/lib/vocab";
import { withBase } from "@/lib/base-path";
import styles from "./map.module.css";
import { LibraryPanel, useAtlas } from "./atlas-tools";
import { AnalysisTray, useWorkbench, WorkbenchPanel, type WbMode } from "./workbench";
import { addIcons, addOverlay, addTrackLayers, baseStyle, clickableIds, removeOverlay, setBasemap } from "./atlas-engine";
import { Detection, Hud, MODES, SensorFilters, type Mode, type Target } from "./hud";
import { IntelPanel, MISSIONS, type FeedStatus } from "./intel-panel";
import { Detail, type Selected } from "./detail";
import { buildSats, groundTrack, position, satFeatures, type Sat } from "./satellites";

maplibregl.setWorkerUrl(withBase("/maplibre-gl-worker.js"));

const C = { fern: "#131b13", ink: "#0d120e", wax: "#efe9dc", pollen: "#c9a84d", reed: "#a9c799", ember: "#c8553d", sky: "#7fb7d6" };
const SECTOR_COLORS: [string, string][] = [["energy", C.pollen], ["infrastructure", C.sky], ["land_built_environment", C.reed], ["waste_resource_systems", "#c08a5a"], ["water_food_nature", "#5fb3a1"]];
const TRIGGER_COLORS: [string, string][] = [["capital", C.pollen], ["crisis", C.ember], ["people", "#d9c7f0"], ["project", C.reed], ["regulatory", "#e59f5a"], ["commitment", "#5fb3a1"], ["event", C.wax]];

type LayerKey = "projects" | "organizations" | "deals" | "triggers" | "procurement" | "hazards";
const RECORD_KEYS: LayerKey[] = ["projects", "deals", "organizations", "triggers", "procurement", "hazards"];
const LAYER_META: Record<LayerKey, { label: string; swatch: string }> = {
  projects: { label: "Projects", swatch: C.wax },
  triggers: { label: "Triggers (this year)", swatch: C.ember },
  procurement: { label: "Funding, tenders and calls", swatch: C.sky },
  deals: { label: "Opportunities", swatch: C.pollen },
  organizations: { label: "Organizations", swatch: C.reed },
  hazards: { label: "Hazard alerts (GDACS)", swatch: "#e0672f" },
};
const LAYER_IDS: Record<LayerKey, string[]> = {
  organizations: ["organizations", "organizations-cluster", "organizations-count"],
  projects: ["projects", "projects-glow", "projects-label"], deals: ["deals"], triggers: ["triggers", "triggers-halo"], procurement: ["procurement"], hazards: ["hazards"],
};

function addDataLayers(map: maplibregl.Map) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  for (const s of ["deals", "projects", "triggers", "procurement", "hazards"]) map.addSource(s, { type: "geojson", data: empty });
  map.addSource("organizations", { type: "geojson", data: empty, cluster: true, clusterRadius: 44, clusterMaxZoom: 9 });
  const sectorColor = ["match", ["get", "sector"], ...SECTOR_COLORS.flat(), C.wax] as unknown as maplibregl.ExpressionSpecification;
  const triggerColor = ["match", ["get", "type"], ...TRIGGER_COLORS.flat(), C.wax] as unknown as maplibregl.ExpressionSpecification;
  map.addLayer({ id: "hazards", type: "circle", source: "hazards", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 8, 11], "circle-color": ["match", ["get", "level"], "Red", "#d9412b", "#e59a3a"], "circle-opacity": 0.25, "circle-stroke-color": ["match", ["get", "level"], "Red", "#ff6a4d", "#f2b35a"], "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "organizations-cluster", type: "circle", source: "organizations", filter: ["has", "point_count"], paint: { "circle-color": "rgba(19,27,19,0.82)", "circle-stroke-color": C.reed, "circle-stroke-width": 1.5, "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24] } });
  map.addLayer({ id: "organizations-count", type: "symbol", source: "organizations", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 11 }, paint: { "text-color": C.wax } });
  map.addLayer({ id: "organizations", type: "circle", source: "organizations", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.5, 10, 7], "circle-color": sectorColor, "circle-stroke-color": "rgba(13,18,14,0.9)", "circle-stroke-width": 1.2 } });
  map.addLayer({ id: "deals", type: "circle", source: "deals", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 13], "circle-color": "rgba(201,168,77,0.12)", "circle-stroke-color": C.pollen, "circle-stroke-width": 2.4 } });
  map.addLayer({ id: "projects-glow", type: "circle", source: "projects", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 14, 10, 26], "circle-color": C.pollen, "circle-opacity": 0.16, "circle-blur": 0.8 } });
  map.addLayer({ id: "projects", type: "circle", source: "projects", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 10, 12], "circle-color": C.wax, "circle-stroke-color": "#173b2a", "circle-stroke-width": 3 } });
  map.addLayer({ id: "projects-label", type: "symbol", source: "projects", minzoom: 3.5, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-offset": [0, 1.3], "text-anchor": "top", "text-letter-spacing": 0.04, "text-optional": true }, paint: { "text-color": "#fbf6e8", "text-halo-color": "rgba(3,6,8,.92)", "text-halo-width": 1.5 } });
  map.addLayer({ id: "procurement", type: "circle", source: "procurement", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 10, 8], "circle-color": C.sky, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 } });
  map.addLayer({ id: "triggers-halo", type: "circle", source: "triggers", paint: { "circle-radius": 12, "circle-color": triggerColor, "circle-opacity": 0.18, "circle-blur": 0.6 } });
  map.addLayer({ id: "triggers", type: "circle", source: "triggers", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 3, ["coalesce", ["get", "urgency"], 3]], 10, ["+", 6, ["coalesce", ["get", "urgency"], 3]]], "circle-color": triggerColor, "circle-stroke-color": "#0d120e", "circle-stroke-width": 1.2 } });
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const haversineKm = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
};
/** Runs a style mutation now, or once the style has (re)loaded; returns a cleanup that cancels a pending run. */
function whenStyleReady(map: maplibregl.Map, fn: () => void) {
  try { fn(); return undefined; } catch (e) {
    if (!/not done loading/i.test(String((e as Error).message))) throw e;
    const retry = () => { try { fn(); } catch { /* next styledata retries */ return; } map.off("styledata", retry); };
    map.on("styledata", retry);
    return () => { map.off("styledata", retry); };
  }
}
const TRACKABLE = new Set(["flights", "military", "sat_eo", "sat_weather", "sat_stations", "sat_gnss"]);

/** The Atlas depends on the URL hash, the clock and WebGL: render it on the client only (no hydration mismatch). */
const noopSubscribe = () => () => {};
export default function MapClientGate() {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return mounted ? <MapClient /> : <div className={styles.stage} data-fullbleed data-mode="normal" />;
}

function MapClient() {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [init] = useState(() => decodeView(window.location.hash));
  const initialFit = useRef(init.lat != null);
  const [mapObj, setMapObj] = useState<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [data, setData] = useState<MapPayload | null>(null);
  const [hazards, setHazards] = useState<FeatureCollection | null>(null);
  const [catalog, setCatalog] = useState<OfferedLayer[]>([]);
  const [firmsKey, setFirmsKey] = useState(false);
  const [base, setBase] = useState<string>(init.base ?? "s2cloudless");
  const [overlays, setOverlays] = useState<Set<string>>(() => new Set(init.layers?.filter(l => !RECORD_KEYS.includes(l as LayerKey)) ?? ["quakes", "events", "cyclones"]));
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>(() => {
    const fromHash = init.layers?.filter(l => RECORD_KEYS.includes(l as LayerKey));
    return Object.fromEntries(RECORD_KEYS.map(k => [k, fromHash?.length ? fromHash.includes(k) : true])) as Record<LayerKey, boolean>;
  });
  const [status, setStatus] = useState<Record<string, FeedStatus>>({});
  const [dayOffset, setDayOffset] = useState(0);
  const [mode, setMode] = useState<Mode>((MODES.find(m => m.key === init.mode)?.key) ?? "normal");
  const [hudOn, setHudOn] = useState(true);
  const [detectOn, setDetectOn] = useState(false);
  const [orbitOn, setOrbitOn] = useState(false);
  const [touring, setTouring] = useState(false);
  const [terrain3d, setTerrain3d] = useState(false);
  const [globe, setGlobe] = useState(true);
  const [selected, setSelected] = useState<Selected>(null);
  const [tracked, setTracked] = useState<{ layer: string; id: string; chase: boolean } | null>(() => {
    const [layer, id] = (init.track ?? "").split("|");
    return layer && id && TRACKABLE.has(layer) ? { layer, id, chase: false } : null;
  });
  const [target, setTarget] = useState<Target>(null);
  const [query, setQuery] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"intel" | "directory" | "library" | "workbench" | "none">("intel");
  const [wbMode, setWbMode] = useState<WbMode>("analysis");
  const [wbProject, setWbProject] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [copied, setCopied] = useState(false);
  const [country, setCountry] = useState("");
  const [sector, setSector] = useState("");
  const [topic, setTopic] = useState("");
  const [limit, setLimit] = useState(50);
  const satsRef = useRef<Record<string, Sat[]>>({});
  const feedRef = useRef<Record<string, FeatureCollection>>({});
  const trailRef = useRef<[number, number][]>([]);
  const trackedRef = useRef(tracked);
  useEffect(() => { trackedRef.current = tracked; trailRef.current = []; }, [tracked]);

  const records = useMemo(() => data ? mapRecords(data) : [], [data]);
  const filtered = useMemo(() => filterRecords(records, { query, country, sector, topic }, visible), [records, query, country, sector, topic, visible]);
  const onSelectProject = useCallback((props: Record<string, unknown>, lngLat: [number, number]) => setSelected({ layer: "projects", props, lngLat }), []);
  const atlas = useAtlas(mapRef, mapReady, onSelectProject);
  const wb = useWorkbench(mapObj, wbProject);
  const wbToolRef = useRef(wb.tool);
  useEffect(() => { wbToolRef.current = wb.tool; }, [wb.tool]);
  const projectChoices = useMemo(() => (data?.projects.features ?? []).map(f => ({ id: String(f.properties.id), name: String(f.properties.name) })), [data]);
  const byId = useMemo(() => new Map(catalog.map(l => [l.id, l])), [catalog]);
  const activeOverlays = useMemo(() => catalog.filter(l => l.group !== "basemap" && overlays.has(l.id)), [catalog, overlays]);
  const now = new Date();

  // Records, hazards and the catalogue load independently of WebGL.
  useEffect(() => {
    const controller = new AbortController();
    const get = <T,>(path: string) => fetch(withBase(path), { signal: controller.signal }).then(r => r.ok ? r.json() as Promise<T> : Promise.reject(new Error(String(r.status))));
    get<MapPayload>("/api/map/features").then(setData).catch(e => { if (!controller.signal.aborted) setLoadError(`Map records could not load (${e.message}). Reload to retry.`); });
    get<FeatureCollection>("/api/map/hazards").then(setHazards).catch(() => { if (!controller.signal.aborted) setStatus(s => ({ ...s, hazards: { error: "GDACS alerts unavailable" } })); });
    get<{ layers: OfferedLayer[]; firmsKey: boolean }>("/api/map/catalog").then(c => {
      setCatalog(c.layers); setFirmsKey(c.firmsKey);
      if (!init.base && c.layers.some(l => l.id === "esri")) setBase("esri");
    }).catch(e => { if (!controller.signal.aborted) setMapError(`Layer catalogue unavailable (${e.message}).`); });
    return () => controller.abort();
  }, [init.base]);

  // Map lifecycle
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const v = init;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current, style: baseStyle(),
        center: v.lat != null ? [v.lng!, v.lat] : [-30, 20], zoom: v.zoom ?? 1.9, bearing: v.bearing ?? 0, pitch: v.pitch ?? 0,
        minZoom: 0.6, maxPitch: 85, attributionControl: false, renderWorldCopies: false,
      });
    } catch {
      queueMicrotask(() => setMapError("The map renderer is unavailable. You can still browse records in the directory."));
      return;
    }
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __atlas?: maplibregl.Map }).__atlas = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("error", e => { if (!String(e.error?.message ?? "").includes("tile")) setMapError("Some imagery or layers could not load. Records and the directory remain available."); });
    // Wire layers as soon as the style is parsed (not after every initial tile): the globe becomes interactive sooner.
    let wired = false;
    map.on("style.load", () => {
      if (wired) return;
      wired = true;
      addIcons(map);
      addDataLayers(map);
      addTrackLayers(map);
      for (const layer of ["projects", "organizations", "deals", "triggers", "procurement", "hazards"] as LayerKey[]) {
        const ids = layer === "organizations" ? ["organizations", "organizations-cluster"] : [layer];
        for (const id of ids) {
          map.on("click", id, e => {
            const f = e.features?.[0] as MapGeoJSONFeature | undefined;
            if (!f) return;
            if (f.properties?.cluster) {
              (map.getSource("organizations") as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id as number).then(z => map.easeTo({ center: (f.geometry as GeoPoint).coordinates as [number, number], zoom: z + 0.5 }));
              return;
            }
            if (wbToolRef.current !== "none") return;
            setSelected({ layer, props: f.properties ?? {}, lngLat: (f.geometry as GeoPoint).coordinates as [number, number] });
          });
          map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
        }
      }
      setMapReady(true);
      setMapObj(map);
    });
    map.once("load", () => container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    return () => { map.remove(); mapRef.current = null; setMapObj(null); };
  }, [init]);

  // Animation: trigger pulse, cyclone spin, orbit.
  const orbitRef = useRef(orbitOn);
  useEffect(() => { orbitRef.current = orbitOn; }, [orbitOn]);
  useEffect(() => {
    const map = mapObj;
    if (!map || reducedMotion()) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const phase = ((t - t0) % 2200) / 2200;
      if (map.getLayer("triggers-halo")) { map.setPaintProperty("triggers-halo", "circle-radius", 8 + phase * 16); map.setPaintProperty("triggers-halo", "circle-opacity", 0.28 * (1 - phase)); }
      if (map.getLayer("ov-cyclones-icon")) map.setLayoutProperty("ov-cyclones-icon", "icon-rotate", -((t / 20) % 360));
      if (map.getLayer("ov-quakes-halo")) map.setPaintProperty("ov-quakes-halo", "circle-opacity", 0.1 + 0.2 * (1 - phase));
      if (orbitRef.current && !map.isMoving()) map.setBearing(map.getBearing() + 0.06);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => setOrbitOn(false);
    const el = map.getCanvasContainer();
    el.addEventListener("mousedown", stop); el.addEventListener("wheel", stop, { passive: true }); el.addEventListener("touchstart", stop, { passive: true });
    return () => { cancelAnimationFrame(raf); el.removeEventListener("mousedown", stop); el.removeEventListener("wheel", stop); el.removeEventListener("touchstart", stop); };
  }, [mapObj]);

  // Records → map
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const layer of RECORD_LAYERS) (map.getSource(layer) as GeoJSONSource)?.setData({ type: "FeatureCollection", features: filtered.filter(r => r.layer === layer).map(r => r.feature) });
    if (hazards) (map.getSource("hazards") as GeoJSONSource)?.setData(hazards);
  }, [mapReady, filtered, hazards]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !records.length || initialFit.current) return;
    initialFit.current = true;
    const first = records[0].feature.geometry.coordinates;
    const bounds = records.reduce((b, r) => b.extend(r.feature.geometry.coordinates), new maplibregl.LngLatBounds(first, first));
    map.fitBounds(bounds, { padding: 120, maxZoom: 4.5, duration: reducedMotion() ? 0 : 2200 });
  }, [mapReady, records]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const [key, ids] of Object.entries(LAYER_IDS) as [LayerKey, string[]][]) for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible[key] ? "visible" : "none");
  }, [visible, mapReady]);

  // Basemap
  const baseLayer = byId.get(base);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !catalog.length) return;
    return whenStyleReady(map, () => setBasemap(map, baseLayer, productDate(new Date(), (baseLayer?.lagDays ?? 1) + dayOffset)));
  }, [mapReady, catalog.length, baseLayer, dayOffset]);

  // Overlays: add / remove; daily rasters follow the imagery date.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    return whenStyleReady(map, () => {
      for (const l of catalog) {
        if (l.group === "basemap") continue;
        const on = overlays.has(l.id);
        if (on && !map.getSource(`ov-${l.id}`)) addOverlay(map, l, productDate(new Date(), (l.lagDays ?? 1) + dayOffset));
        else if (!on && map.getSource(`ov-${l.id}`)) removeOverlay(map, l);
        else if (on && l.daily && l.tiles) (map.getSource(`ov-${l.id}`) as RasterTileSource).setTiles([l.tiles.replace("{date}", productDate(new Date(), (l.lagDays ?? 1) + dayOffset))]);
      }
    });
  }, [mapReady, catalog, overlays, dayOffset]);

  // Tracked flight: trail, ring, HUD target, camera lock.
  const onFeed = useCallback((id: string, fc: FeatureCollection) => {
    const t = trackedRef.current;
    const map = mapRef.current;
    if (!t || t.layer !== id || !map) return;
    const f = fc.features.find(x => x.properties?.id === t.id);
    if (!f || f.geometry.type !== "Point") { setTarget(prev => prev ? { ...prev, lines: [["STATUS", "signal lost (last known position shown)"], ...prev.lines.filter(([k]) => k !== "STATUS")] } : prev); return; }
    const c = f.geometry.coordinates as [number, number];
    const p = f.properties ?? {};
    trailRef.current = [...trailRef.current, c].slice(-240);
    const feats: Feature[] = [{ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} }];
    if (trailRef.current.length > 1) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: trailRef.current }, properties: { color: "#7fe3ff" } });
    (map.getSource("track") as GeoJSONSource)?.setData({ type: "FeatureCollection", features: feats });
    setTarget({ kind: p.military ? "military aircraft" : "aircraft", title: String(p.callsign ?? p.reg ?? String(p.id).toUpperCase()), lines: [["TYPE", String(p.type ?? "n/r")], ["ALT", p.ground ? "GROUND" : p.altFt != null ? `${Number(p.altFt).toLocaleString("en-US")} FT` : "N/R"], ["GS", p.speedKt != null ? `${p.speedKt} KT` : "N/R"], ["TRK", `${p.heading}°`], ["SQK", String(p.squawk ?? "N/R")]] });
    map.easeTo(t.chase ? { center: c, bearing: Number(p.heading ?? 0), pitch: 72, zoom: Math.max(map.getZoom(), 10.5), duration: 1400 } : { center: c, duration: 1200 });
  }, []);

  // Live GeoJSON feeds: poll on their cadence (paused while hidden); viewport feeds refetch after moves.
  const feedKey = activeOverlays.filter(l => l.kind === "feed").map(l => l.id).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !feedKey) return;
    const active = feedKey.split(",").map(id => byId.get(id)).filter((l): l is OfferedLayer => !!l);
    const controller = new AbortController();
    const url = (l: OfferedLayer) => {
      if (l.id === "flights") {
        const c = map.getCenter(); const b = map.getBounds();
        const nm = Math.min(250, haversineKm([c.lng, c.lat], [b.getEast(), b.getNorth()]) / 1.852);
        return `/api/map/live/flights?lat=${c.lat.toFixed(2)}&lng=${c.lng.toFixed(2)}&dist=${Math.max(20, Math.round(nm))}`;
      }
      if (l.id === "fires") {
        if (map.getZoom() < 3) return "/api/map/live/fires";
        const b = map.getBounds();
        const box = [Math.max(-180, b.getWest()), Math.max(-90, b.getSouth()), Math.min(180, b.getEast()), Math.min(90, b.getNorth())].map(n => n.toFixed(2)).join(",");
        return `/api/map/live/fires?bbox=${box}`;
      }
      return `/api/map/live/${l.feed}`;
    };
    const load = (l: OfferedLayer) => {
      setStatus(s => ({ ...s, [l.id]: { ...s[l.id], loading: true, error: undefined } }));
      fetch(withBase(url(l)), { signal: controller.signal })
        .then(async r => { if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`); return r.json() as Promise<FeatureCollection & { meta?: { count?: number; shown?: number; source?: string } }>; })
        .then(fc => {
          feedRef.current[l.id] = fc;
          (map.getSource(`ov-${l.id}`) as GeoJSONSource | undefined)?.setData(fc);
          setStatus(s => ({ ...s, [l.id]: { count: fc.meta?.count ?? fc.features.length, shown: fc.meta?.shown, source: fc.meta?.source, updated: new Date().toISOString() } }));
          onFeed(l.id, fc);
        })
        .catch(e => { if (!controller.signal.aborted) setStatus(s => ({ ...s, [l.id]: { error: (e as Error).message } })); });
    };
    // Sources are added by the overlay effect in the same commit; wait a frame so they exist.
    const first = requestAnimationFrame(() => active.forEach(load));
    const timers = active.map(l => setInterval(() => { if (!document.hidden) load(l); }, l.pollMs ?? 60_000));
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => { clearTimeout(debounce); debounce = setTimeout(() => active.filter(l => l.viewport).forEach(load), 900); };
    map.on("moveend", onMove);
    return () => { controller.abort(); cancelAnimationFrame(first); timers.forEach(clearInterval); clearTimeout(debounce); map.off("moveend", onMove); };
  }, [mapReady, feedKey, byId, onFeed]);

  // Satellites: elements once per group, positions every second, tracked satellite ground track and follow.
  const satKey = activeOverlays.filter(l => l.kind === "satellites").map(l => l.id).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !satKey) return;
    const active = satKey.split(",").map(id => byId.get(id)).filter((l): l is OfferedLayer => !!l);
    const controller = new AbortController();
    for (const l of active) {
      if (satsRef.current[l.id]) continue;
      setStatus(s => ({ ...s, [l.id]: { loading: true } }));
      fetch(withBase(`/api/map/live/${l.feed}`), { signal: controller.signal })
        .then(async r => { if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`); return r.json() as Promise<{ elements: Omm[] }>; })
        .then(d => { satsRef.current[l.id] = buildSats(d.elements); setStatus(s => ({ ...s, [l.id]: { count: satsRef.current[l.id].length, source: "CelesTrak + SGP4", updated: new Date().toISOString() } })); })
        .catch(e => { if (!controller.signal.aborted) setStatus(s => ({ ...s, [l.id]: { error: (e as Error).message } })); });
    }
    let lastTrack = 0;
    const tick = () => {
      if (document.hidden) return;
      const when = new Date();
      for (const l of active) {
        const sats = satsRef.current[l.id];
        if (sats) (map.getSource(`ov-${l.id}`) as GeoJSONSource | undefined)?.setData(satFeatures(sats, when));
      }
      const t = trackedRef.current;
      if (t && t.layer.startsWith("sat_")) {
        const s = satsRef.current[t.layer]?.find(x => x.id === t.id);
        const p = s && position(s, when);
        if (s && p) {
          if (when.getTime() - lastTrack > 20_000 || !lastTrack) {
            lastTrack = when.getTime();
            (map.getSource("track") as GeoJSONSource)?.setData({ type: "FeatureCollection", features: [...groundTrack(s, when), { type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: {} }] });
          }
          setTarget({ kind: "satellite", title: s.name, lines: [["NORAD", String(s.norad)], ["ALT", `${Math.round(p.altKm).toLocaleString("en-US")} KM`], ["VEL", `${p.speedKms.toFixed(2)} KM/S`], ["INC", `${s.inclination.toFixed(1)}°`], ["PERIOD", `${s.periodMin.toFixed(1)} MIN`]] });
          map.easeTo({ center: [p.lng, p.lat], duration: 950, easing: x => x });
        }
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => { controller.abort(); clearInterval(timer); };
  }, [mapReady, satKey, byId]);

  // Clicks and hover on catalogue overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const idsFor = () => activeOverlays.flatMap(l => clickableIds(l).map(id => ({ id, layer: l.id }))).filter(x => map.getLayer(x.id))
      .concat(overlays.has("protected") && map.getLayer("ov-protected-fill") ? [{ id: "ov-protected-fill", layer: "protected" }] : []);
    const pick = (point: maplibregl.PointLike) => {
      const ids = idsFor();
      if (!ids.length) return null;
      const p = map.project(map.unproject(point));
      const feats = map.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: ids.map(x => x.id) });
      const f = feats[0];
      return f ? { f, layer: ids.find(x => x.id === f.layer.id)!.layer } : null;
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (atlas.draw !== "none" || wbToolRef.current !== "none") return;
      const recordHit = map.queryRenderedFeatures(e.point, { layers: ["projects", "organizations", "organizations-cluster", "deals", "triggers", "procurement", "hazards"].filter(id => map.getLayer(id)) });
      if (recordHit.length) return;
      const hit = pick(e.point);
      if (!hit) return;
      const g = hit.f.geometry;
      const lngLat: [number, number] = g.type === "Point" ? g.coordinates as [number, number] : [e.lngLat.lng, e.lngLat.lat];
      setSelected({ layer: hit.layer, props: hit.f.properties ?? {}, lngLat });
      (map.getSource("track") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: trackedRef.current ? [] : [{ type: "Feature", geometry: { type: "Point", coordinates: lngLat }, properties: {} }] });
    };
    let raf = 0;
    const onHover = (e: maplibregl.MapMouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (atlas.draw === "none") map.getCanvas().style.cursor = pick(e.point) ? "pointer" : ""; });
    };
    map.on("click", onClick); map.on("mousemove", onHover);
    return () => { map.off("click", onClick); map.off("mousemove", onHover); cancelAnimationFrame(raf); };
  }, [mapReady, activeOverlays, overlays, atlas.draw]);

  // Keep the globe centred in the visible area when the side panel is open.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const wide = window.innerWidth > 820;
    map.easeTo({ padding: { left: wide && panel !== "none" ? 340 : 0, right: wide && selected ? 380 : 0, top: 0, bottom: 0 }, duration: reducedMotion() ? 0 : 500 });
  }, [mapReady, panel, selected]);

  // Share state in the URL hash (replace, not push).
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const c = map.getCenter();
        const layers = [...overlays, ...RECORD_KEYS.filter(k => visible[k])];
        const hash = encodeView({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), base, layers, mode, track: tracked ? `${tracked.layer}|${tracked.id}` : undefined });
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${hash}`);
      }, 500);
    };
    write();
    map.on("moveend", write);
    return () => { map.off("moveend", write); clearTimeout(timer); };
  }, [mapReady, overlays, visible, base, mode, tracked]);

  const toggleOverlay = useCallback((id: string) => setOverlays(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const toggle3d = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setTerrain3d(on => {
      const next = !on;
      if (next) { map.setTerrain({ source: "dem", exaggeration: 1.5 }); map.easeTo({ pitch: 64, duration: 1400 }); }
      else { map.easeTo({ pitch: 0, duration: 1000 }); setTimeout(() => map.setTerrain(null), 1000); }
      return next;
    });
  }, []);
  const toggleProjection = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setGlobe(g => { map.setProjection({ type: g ? "mercator" : "globe" }); return !g; });
  }, []);
  const resetGlobe = useCallback(() => {
    setTracked(null); setTarget(null); setSelected(null);
    mapRef.current?.flyTo({ center: [-30, 20], zoom: 1.7, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 2000 });
  }, []);
  const tilt = () => { const map = mapRef.current; if (map) map.easeTo({ pitch: map.getPitch() > 10 ? 0 : 60, duration: 900 }); };
  const northUp = () => mapRef.current?.easeTo({ bearing: 0, duration: 800 });

  const fitResults = useCallback(() => {
    if (!filtered.length) return;
    const first = filtered[0].feature.geometry.coordinates;
    const bounds = filtered.reduce((b, r) => b.extend(r.feature.geometry.coordinates), new maplibregl.LngLatBounds(first, first));
    mapRef.current?.fitBounds(bounds, { padding: 100, maxZoom: 10, duration: reducedMotion() ? 0 : 1400 });
  }, [filtered]);

  const runMission = useCallback((id: string) => {
    const m = MISSIONS.find(x => x.id === id);
    if (!m) return;
    if (byId.has(m.base) || m.base === "tactical") setBase(byId.has(m.base) ? m.base : base);
    setOverlays(new Set(m.layers.filter(l => byId.has(l))));
    if (m.records) setVisible(Object.fromEntries(RECORD_KEYS.map(k => [k, m.records!.includes(k)])) as Record<LayerKey, boolean>);
    else setVisible(Object.fromEntries(RECORD_KEYS.map(k => [k, false])) as Record<LayerKey, boolean>);
    setMode((m.mode as Mode) ?? "normal");
    if (m.camera === "globe") mapRef.current?.flyTo({ center: [-20, 18], zoom: 1.6, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 2200 });
    if (m.camera === "fit") setTimeout(fitResults, 50);
  }, [byId, base, fitResults]);

  // Cinematic tour of projects: fly, orbit, next.
  useEffect(() => {
    const map = mapRef.current;
    if (!touring || !map) return;
    const list = (data?.projects.features ?? []).filter(f => f.geometry);
    if (!list.length) return;
    let i = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      const f = list[i % list.length]; i += 1;
      setSelected({ layer: "projects", props: f.properties, lngLat: f.geometry.coordinates as [number, number] });
      map.flyTo({ center: f.geometry.coordinates as [number, number], zoom: 12.5, pitch: 66, bearing: (i * 67) % 360, duration: reducedMotion() ? 0 : 6000, essential: true });
      setOrbitOn(true);
      timer = setTimeout(next, 14_000);
    };
    if (!terrain3d) toggle3d();
    next();
    return () => { clearTimeout(timer); setOrbitOn(false); };
  }, [touring]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTrack = (chase: boolean) => {
    if (!selected || !TRACKABLE.has(selected.layer)) return;
    setTracked({ layer: selected.layer, id: String(selected.props.id), chase });
    if (chase && !terrain3d) toggle3d();
    const fc = feedRef.current[selected.layer];
    if (fc) setTimeout(() => onFeed(selected.layer, fc), 0);
  };

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  };

  const search = async () => {
    const map = mapRef.current;
    const q = query.trim();
    setSearchNote(null);
    if (!q || !map) return;
    const c = parseCoordinates(q);
    if (c) { map.flyTo({ center: [c.lng, c.lat], zoom: 12, duration: reducedMotion() ? 0 : 2400 }); return; }
    if (filtered.length) { flyTo(filtered[0]); return; }
    setSearchNote("Searching places…");
    try {
      const r = await fetch(withBase(`/api/map/geocode?q=${encodeURIComponent(q)}`));
      const d = await r.json() as { result?: { lat: number; lng: number; label: string } | null; error?: string };
      if (!r.ok) { setSearchNote(d.error ?? "Place search unavailable"); return; }
      if (!d.result) { setSearchNote("No place or record matched."); return; }
      setSearchNote(d.result.label);
      map.flyTo({ center: [d.result.lng, d.result.lat], zoom: 11, duration: reducedMotion() ? 0 : 2400 });
    } catch { setSearchNote("Place search unavailable"); }
  };

  const flyTo = (m: MapRecord) => {
    const [lng, lat] = m.feature.geometry.coordinates;
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 9, pitch: terrain3d ? 62 : mapRef.current.getPitch(), duration: reducedMotion() ? 0 : 1600 });
    setSelected({ layer: m.layer, props: m.feature.properties, lngLat: [lng, lat] });
  };

  // Keyboard: 1–6 looks · H HUD · D detection · G globe · T terrain · O orbit · P tilt · N north · R reset · / search · Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) { if (e.key === "Escape") el.blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (/^[1-6]$/.test(k)) setMode(MODES[Number(k) - 1].key);
      else if (k === "h") setHudOn(v => !v);
      else if (k === "d") setDetectOn(v => !v);
      else if (k === "g") toggleProjection();
      else if (k === "t") toggle3d();
      else if (k === "o") setOrbitOn(v => !v);
      else if (k === "p") tilt();
      else if (k === "n") northUp();
      else if (k === "r") resetGlobe();
      else if (k === "l") setPanel(p => (p === "none" ? "intel" : "none"));
      else if (k === "?") setShowKeys(v => !v);
      else if (k === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === "escape") { setTouring(false); setOrbitOn(false); setTracked(null); setTarget(null); setSelected(null); setShowKeys(false); }
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle3d, toggleProjection, resetGlobe]);

  const counts: Record<LayerKey, number> = {
    projects: data?.projects.features.length ?? 0, organizations: data?.counts.organizations ?? 0, deals: data?.deals.features.length ?? 0,
    triggers: data?.triggers.features.length ?? 0, procurement: data?.procurement.features.length ?? 0, hazards: hazards?.features.length ?? 0,
  };
  const SHORT: Record<string, string> = { flights: "AC", military: "MIL", quakes: "EQ", fires: "FIRE", events: "EVT", cyclones: "TC", sat_eo: "EO SAT", sat_weather: "WX SAT", sat_stations: "STN", sat_gnss: "GNSS" };
  const summary = [
    `PROJ ${counts.projects} · OPP ${counts.deals} · ORG ${counts.organizations}`,
    ...activeOverlays.filter(l => SHORT[l.id]).map(l => { const s = status[l.id]; return `${SHORT[l.id]} ${s?.error ? "UNAVAIL" : s?.count != null ? s.count.toLocaleString("en-US") : "…"}`; }),
  ];
  const detectLayers = useMemo(() => [
    { id: "ov-flights-icon", color: "#7fe3ff", size: 22, label: (p: Record<string, unknown>) => String(p.callsign ?? p.id ?? "").toUpperCase() },
    { id: "ov-military-icon", color: "#f2b35a", size: 24, label: (p: Record<string, unknown>) => `MIL ${String(p.callsign ?? p.id ?? "").toUpperCase()}` },
    ...["sat_eo", "sat_weather", "sat_stations", "sat_gnss"].map(id => ({ id: `ov-${id}-pt`, color: "#9dff8a", size: 18, label: (p: Record<string, unknown>) => `${p.norad} ${String(p.name ?? "").slice(0, 16)}` })),
    { id: "ov-quakes-pt", color: "#ff9f40", size: 26, label: (p: Record<string, unknown>) => `EQ M${p.mag}` },
    { id: "ov-events-pt", color: "#c07cff", size: 22, label: (p: Record<string, unknown>) => String(p.categoryLabel ?? "EVENT").toUpperCase() },
    { id: "ov-cyclones-icon", color: "#5ad1ff", size: 40, label: (p: Record<string, unknown>) => `TC ${String(p.name ?? "").toUpperCase()}` },
    { id: "projects", color: "#f2d25c", size: 30, label: (p: Record<string, unknown>) => `PROJ ${String(p.name ?? "").toUpperCase().slice(0, 22)}` },
  ], []);
  const live = activeOverlays.some(l => l.kind === "feed" || l.kind === "satellites");
  const baseLabel = baseLayer?.label ?? "Tactical vector";

  return (
    <div className={styles.stage} data-fullbleed data-selection={selected ? "true" : "false"} data-mode={mode}>
      <SensorFilters />
      <div ref={container} className={styles.map} />
      <div className={styles.fx} aria-hidden />
      {hudOn && <Hud map={mapObj} mode={mode} summary={summary} target={target} basemap={baseLabel} live={live} />}
      <Detection map={mapObj} layers={detectLayers} on={detectOn} />
      <AnalysisTray wb={wb} map={mapObj} />

      <div className={styles.searchWrap}>
        <form className={`${styles.glass} ${styles.search}`} onSubmit={e => { e.preventDefault(); void search(); }}>
          <Search size={16} aria-hidden />
          <input ref={searchRef} value={query} onChange={e => { setQuery(e.target.value); setSearchNote(null); if (panel !== "directory") setPanel("directory"); setLimit(50); }} placeholder="Search records, places or lat, lng  ( / )" aria-label="Search the map" />
          {query && <button type="button" onClick={() => { setQuery(""); setSearchNote(null); }} aria-label="Clear search"><X size={14} /></button>}
        </form>
        {searchNote && <p className={`${styles.glass} ${styles.searchNote}`} role="status">{searchNote}</p>}
      </div>
      <SavedViews />

      {panel !== "none" && (
        <aside className={`${styles.glass} ${styles.layers}`} aria-label="Map explorer">
          <div className={styles.panelTabs}>
            {(["intel", "workbench", "directory", "library"] as const).map(p => <button key={p} type="button" aria-pressed={panel === p} onClick={() => setPanel(p)}>{p === "intel" ? "Layers" : p === "workbench" ? "Workbench" : p[0].toUpperCase() + p.slice(1)}</button>)}
          </div>
          {panel === "intel" && (
            <IntelPanel catalog={catalog} base={base} setBase={setBase} overlays={overlays} toggle={toggleOverlay} status={status} firmsKey={firmsKey}
              records={RECORD_KEYS.map(k => ({ key: k, label: LAYER_META[k].label, swatch: LAYER_META[k].swatch, count: counts[k] }))} recordsOn={visible}
              toggleRecord={k => setVisible(v => ({ ...v, [k]: !v[k as LayerKey] }))} dayOffset={dayOffset} setDayOffset={setDayOffset} runMission={runMission} />
          )}
          {panel === "library" && <LibraryPanel atlas={atlas} />}
          {panel === "workbench" && <WorkbenchPanel wb={wb} mode={wbMode} setMode={setWbMode} projects={projectChoices} projectId={wbProject} setProjectId={setWbProject} />}
          {panel === "directory" && <>
            <div className={styles.filters}>
              <label>Country<select value={country} onChange={e => { setCountry(e.target.value); setLimit(50); }}><option value="">All countries</option>{discoveryOptions(records, "country").map(v => <option key={v} value={v}>{v}</option>)}</select></label>
              <label>Sector<select value={sector} onChange={e => { setSector(e.target.value); setLimit(50); }}><option value="">All sectors</option>{discoveryOptions(records, "sector").map(v => <option key={v} value={v}>{SECTORS[v as keyof typeof SECTORS] ?? v.replace(/_/g, " ")}</option>)}</select></label>
              <label>Topic<select value={topic} onChange={e => { setTopic(e.target.value); setLimit(50); }}><option value="">All recorded topics</option>{discoveryOptions(records, "topic").map(v => <option key={v} value={v}>{TERRITORIAL_SYSTEMS[v as keyof typeof TERRITORIAL_SYSTEMS] ?? v.replace(/_/g, " ")}</option>)}</select></label>
            </div>
            <div className={styles.panelTabs}>
              <button type="button" onClick={() => { setQuery(""); setCountry(""); setSector(""); setTopic(""); setLimit(50); }}>Clear filters</button>
              <button type="button" disabled={!mapReady || !filtered.length} onClick={fitResults}>Fit results</button>
            </div>
            <p className={styles.note} role="status">{data ? `${filtered.length} of ${records.length} located records · enabled layers` : loadError ? "Records unavailable" : "Loading records…"}</p>
            {data && filtered.length === 0 && <p className={styles.note}>No matching records. Press Enter to search places, or clear filters.</p>}
            <ul className={styles.directory} aria-label="Map records">
              {filtered.slice(0, limit).map(m => <li key={m.key}>
                <button type="button" onClick={() => flyTo(m)} aria-pressed={selected?.layer === m.layer && selected?.props.id === m.feature.properties.id}>
                  <span className={styles.swatch} style={{ background: LAYER_META[m.layer].swatch }} aria-hidden />
                  <span><strong>{m.label}</strong><small>{LAYER_META[m.layer].label}{m.location ? ` · ${m.location}` : ""}</small></span>
                </button>
              </li>)}
            </ul>
            {filtered.length > limit && <button className={styles.more} type="button" onClick={() => setLimit(n => n + 50)}>Show 50 more</button>}
            {data && (data.counts.unmapped > 0 || data.counts.unmappedProjects > 0) && <p className={styles.note}>{data.counts.unmapped} organizations and {data.counts.unmappedProjects} projects have missing or invalid coordinates. <Link href="/companies">Review organizations</Link> · <Link href="/projects">Review projects</Link></p>}
            {data && <p className={styles.note}>Events from {data.since} onward · snapshot {data.generatedAt.slice(0, 16).replace("T", " ")} UTC. Record updates do not imply verification.</p>}
          </>}
          {loadError && <p className={styles.error} role="alert">{loadError}</p>}
          {mapError && <p className={styles.error} role="alert">{mapError}</p>}
        </aside>
      )}

      <div className={styles.modeBar} role="toolbar" aria-label="Sensor look">
        {MODES.map((m, i) => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)} title={`${m.label} (${i + 1})`}>{m.label}</button>)}
      </div>

      <div className={styles.controls}>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={toggleProjection} aria-pressed={globe} title="Globe / flat (G)"><Globe2 size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={toggle3d} aria-pressed={terrain3d} title="3D terrain (T)"><Mountain size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={tilt} title="Tilt (P)"><Square size={15} style={{ transform: "perspective(20px) rotateX(35deg)" }} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={northUp} title="North up (N)"><Compass size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => setOrbitOn(v => !v)} aria-pressed={orbitOn} title="Orbit (O)"><Orbit size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => setTouring(v => !v)} aria-pressed={touring} disabled={!data?.projects.features.length} title="Tour projects"><Play size={16} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => setDetectOn(v => !v)} aria-pressed={detectOn} title="Detection overlay (D)"><Scan size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => setHudOn(v => !v)} aria-pressed={hudOn} title="HUD (H)"><Crosshair size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={resetGlobe} title="Reset globe (R)"><Globe2 size={13} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => mapRef.current?.zoomIn()} title="Zoom in">+</button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => mapRef.current?.zoomOut()} title="Zoom out">−</button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={share} title="Copy share link"><Share2 size={16} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => setShowKeys(v => !v)} aria-pressed={showKeys} title="Keyboard shortcuts (?)"><Keyboard size={16} /></button>
      </div>
      {copied && <p className={`${styles.glass} ${styles.toast}`} role="status">Link copied: camera, layers, look and tracked target.</p>}
      {showKeys && (
        <div className={`${styles.glass} ${styles.keys}`} role="dialog" aria-label="Keyboard shortcuts">
          <button type="button" className={styles.close} onClick={() => setShowKeys(false)} aria-label="Close"><X size={14} /></button>
          <p className={styles.panelTitle}>Keyboard</p>
          <dl className={styles.facts}>
            {[["1–6", "Normal · CRT · NVG · FLIR · Thermal · Noir"], ["H", "HUD"], ["D", "Detection boxes"], ["G", "Globe / flat"], ["T", "3D terrain"], ["P", "Tilt"], ["N", "North up"], ["O", "Orbit"], ["R", "Reset globe"], ["L", "Hide / show panel"], ["/", "Search"], ["Esc", "Stop tracking, tour and orbit"]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      )}

      {selected && (
        <aside className={`${styles.glass} ${styles.detail}`} aria-label="Selected item">
          <button type="button" className={styles.close} onClick={() => { setSelected(null); if (!tracked) (mapRef.current?.getSource("track") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] }); }} aria-label="Close"><X size={16} /></button>
          <Detail selected={selected} tracked={tracked?.id === String(selected.props.id)} onTrack={() => (tracked?.id === String(selected.props.id) ? (setTracked(null), setTarget(null)) : startTrack(false))} onChase={() => startTrack(true)} />
          <p className={styles.coords}>{selected.lngLat[1].toFixed(4)}, {selected.lngLat[0].toFixed(4)}</p>
          {Boolean(selected.props.locationBasis) && <p className={styles.note}>{String(selected.props.locationBasis)}</p>}
          {Boolean(selected.props.source) && !byId.has(selected.layer) && <p className={styles.note}>Source: {String(selected.props.source)}</p>}
          {Boolean(selected.props.updatedAt) && <p className={styles.note}>Record updated {String(selected.props.updatedAt).slice(0, 10)} · verification is recorded separately.</p>}
        </aside>
      )}

      {!hudOn && (
        <div className={`${styles.glass} ${styles.readout}`}>
          <span>{baseLabel}</span>
          <span>{now.toISOString().slice(0, 10)}</span>
        </div>
      )}
    </div>
  );
}

