"use client";

// Atlas: a 3D globe for spatial intelligence. Regenera records plus registry-gated live layers (quakes, fires,
// events, cyclones, aircraft, satellites, daily Earth observation, forest loss, protected areas, power grid, 3D
// buildings), sensor looks, a tactical HUD, detection boxes, click-to-track, chase cam, missions, orbit and tour,
// share links and keyboard control. The directory, layer library and drawing tools remain.
import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, RasterTileSource } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint } from "geojson";
import Link from "next/link";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Compass, Crosshair, Globe2, Keyboard, MapPinPlus, Mountain, Orbit, PanelLeftOpen, PersonStanding, Play, Scan, Search, Share2, SlidersHorizontal, Square, X } from "lucide-react";
import { Inspector, useSiteScreen } from "./inspector";
import type { MapPayload } from "@/lib/map/features";
import { discoveryOptions, filterRecords, mapRecords, RECORD_LAYERS, typeCounts, type AreaGeometry, type Bounds, type MapRecord } from "@/lib/map/discovery";
import { objectiveById, suggestion } from "@/lib/map/objectives";
import { stageLabel } from "@/lib/projects/labels";
import { REGENERA_ROLES } from "@/lib/projects/vocab";
import { ExplorePanel, type ContextInfo, type Scope } from "./explore-panel";
import { fitGeometry, flyToCoordinates } from "./camera";
import SavedViews from "./saved-views";
import type { StreetViewConfig } from "./street-view";
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
import type { Selected } from "./detail";
import { buildSats, groundTrack, position, satFeatures, type Sat } from "./satellites";
import { reportClientError } from "@/components/error-reporter";

// Street-level view is loaded only when opened.
const StreetView = lazy(() => import("./street-view"));

maplibregl.setWorkerUrl(withBase("/maplibre-gl-worker.js"));

const C = { fern: "#141715", ink: "#141715", wax: "#f2f0e9", pollen: "#a45f3f", reed: "#a9c799", ember: "#c8553d", sky: "#7fb7d6" };
const SECTOR_COLORS: [string, string][] = [["energy", C.pollen], ["infrastructure", C.sky], ["land_built_environment", C.reed], ["waste_resource_systems", "#c08a5a"], ["water_food_nature", "#5fb3a1"]];
const TRIGGER_COLORS: [string, string][] = [["capital", C.pollen], ["crisis", C.ember], ["people", "#887298"], ["project", C.reed], ["regulatory", "#A56E42"], ["commitment", "#5fb3a1"], ["event", C.wax]];

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
  projects: ["projects", "projects-glow", "projects-label"], deals: ["deals"], triggers: ["triggers", "triggers-halo"], procurement: ["funding-regions-fill", "funding-regions-line"], hazards: ["hazards"],
};

function addDataLayers(map: maplibregl.Map) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  for (const s of ["deals", "projects", "triggers", "procurement", "hazards"]) map.addSource(s, { type: "geojson", data: empty });
  map.addSource("organizations", { type: "geojson", data: empty, cluster: true, clusterRadius: 44, clusterMaxZoom: 9 });
  const sectorColor = ["match", ["get", "sector"], ...SECTOR_COLORS.flat(), C.wax] as unknown as maplibregl.ExpressionSpecification;
  const triggerColor = ["match", ["get", "type"], ...TRIGGER_COLORS.flat(), C.wax] as unknown as maplibregl.ExpressionSpecification;
  map.addLayer({ id: "hazards", type: "circle", source: "hazards", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 8, 11], "circle-color": ["match", ["get", "level"], "Red", "#d9412b", "#e59a3a"], "circle-opacity": 0.25, "circle-stroke-color": ["match", ["get", "level"], "Red", "#ff6a4d", "#B98236"], "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "organizations-cluster", type: "circle", source: "organizations", filter: ["has", "point_count"], paint: { "circle-color": "rgba(19,27,19,0.82)", "circle-stroke-color": C.reed, "circle-stroke-width": 1.5, "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24] } });
  map.addLayer({ id: "organizations-count", type: "symbol", source: "organizations", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 11 }, paint: { "text-color": C.wax } });
  map.addLayer({ id: "organizations", type: "circle", source: "organizations", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.5, 10, 7], "circle-color": sectorColor, "circle-stroke-color": "rgba(16,32,28,0.9)", "circle-stroke-width": 1.2 } });
  map.addLayer({ id: "deals", type: "circle", source: "deals", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 13], "circle-color": "rgba(217,166,28,0.12)", "circle-stroke-color": C.pollen, "circle-stroke-width": 2.4 } });
  map.addLayer({ id: "projects-glow", type: "circle", source: "projects", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 14, 10, 26], "circle-color": C.pollen, "circle-opacity": 0.16, "circle-blur": 0.8 } });
  map.addLayer({ id: "projects", type: "circle", source: "projects", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 10, 12], "circle-color": ["case", ["==", ["get", "market"], 1], "rgba(0,0,0,0)", C.wax] as unknown as maplibregl.ExpressionSpecification, "circle-stroke-color": ["case", ["==", ["get", "market"], 1], "#7fb7d6", "#173b2a"] as unknown as maplibregl.ExpressionSpecification, "circle-stroke-width": 3, "circle-opacity": ["case", ["==", ["get", "approx"], 1], 0.5, 1], "circle-stroke-opacity": ["case", ["==", ["get", "approx"], 1], 0.5, 1] } });
  map.addLayer({ id: "projects-label", type: "symbol", source: "projects", minzoom: 3.5, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-offset": [0, 1.3], "text-anchor": "top", "text-letter-spacing": 0.04, "text-optional": true }, paint: { "text-color": "#f2f0e9", "text-halo-color": "rgba(3,6,8,.92)", "text-halo-width": 1.5 } });
  // Funding geography is drawn as country regions (Natural Earth admin-0, public domain), never as an invented point.
  map.addSource("funding-regions", { type: "geojson", data: empty });
  map.addLayer({ id: "funding-regions-fill", type: "fill", source: "funding-regions", filter: [">", ["coalesce", ["get", "n"], 0], 0], paint: { "fill-color": C.sky, "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["get", "n"], 0], 1, 0.12, 10, 0.28, 60, 0.45] } });
  map.addLayer({ id: "funding-regions-line", type: "line", source: "funding-regions", filter: [">", ["coalesce", ["get", "n"], 0], 0], paint: { "line-color": "#4f8db5", "line-width": 0.8, "line-opacity": 0.7 } });
  map.addLayer({ id: "procurement", type: "circle", source: "procurement", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 10, 8], "circle-color": C.sky, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 } });
  map.addLayer({ id: "triggers-halo", type: "circle", source: "triggers", paint: { "circle-radius": 12, "circle-color": triggerColor, "circle-opacity": 0.18, "circle-blur": 0.6 } });
  map.addLayer({ id: "triggers", type: "circle", source: "triggers", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 3, ["coalesce", ["get", "urgency"], 3]], 10, ["+", 6, ["coalesce", ["get", "urgency"], 3]]], "circle-color": triggerColor, "circle-stroke-color": "#141715", "circle-stroke-width": 1.2 } });
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
  // Deep link: /map?project=<id> fits the project's site, selects it and opens its intelligence panel.
  const [deepProject] = useState(() => new URLSearchParams(window.location.search).get("project"));
  const initialFit = useRef(true); // Default camera belongs to device location, not portfolio auto-fit.
  const [mapObj, setMapObj] = useState<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [data, setData] = useState<MapPayload | null>(null);
  const [hazards, setHazards] = useState<FeatureCollection | null>(null);
  const [catalog, setCatalog] = useState<OfferedLayer[]>([]);
  const [firmsKey, setFirmsKey] = useState(false);
  const [streetCfg, setStreetCfg] = useState<StreetViewConfig>({ provider: "none", key: "" });
  const [streetAt, setStreetAt] = useState<{ lat: number; lng: number } | null>(null);
  const [base, setBase] = useState<string>(init.base ?? "esri");
  const [overlays, setOverlays] = useState<Set<string>>(() => new Set(init.layers?.filter(l => !RECORD_KEYS.includes(l as LayerKey)) ?? []));
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>(() => {
    const fromHash = init.layers?.filter(l => RECORD_KEYS.includes(l as LayerKey));
    return Object.fromEntries(RECORD_KEYS.map(k => [k, fromHash?.length ? fromHash.includes(k) : true])) as Record<LayerKey, boolean>;
  });
  const [status, setStatus] = useState<Record<string, FeedStatus>>({});
  const [dayOffset, setDayOffset] = useState(0);
  const [mode, setMode] = useState<Mode>((MODES.find(m => m.key === init.mode)?.key) ?? "normal");
  const [hudOn, setHudOn] = useState(false);
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
  const [panel, setPanel] = useState<"intel" | "directory" | "workbench" | "none">("directory");
  const [wbMode, setWbMode] = useState<WbMode>("analysis");
  const [wbProject, setWbProject] = useState(() => new URLSearchParams(window.location.search).get("project") ?? "");
  const [showKeys, setShowKeys] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  useEffect(() => { pickingRef.current = picking; }, [picking]);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const siteScreen = useSiteScreen();
  const startScreen = useCallback((at: [number, number], projectId?: string) => { setPicking(false); void siteScreen.start(at, projectId); }, [siteScreen]);
  const closeInspector = useCallback(() => {
    setSelected(null); siteScreen.clear();
    if (!tracked) (mapRef.current?.getSource("track") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  }, [siteScreen, tracked]);
  const startScreenRef = useRef(startScreen);
  useEffect(() => { startScreenRef.current = startScreen; }, [startScreen]);
  const [copied, setCopied] = useState(false);
  // Business filters and the objective travel in the share link (x=…). They hold keys and record ids only; opening a link
  // still goes through sign-in and workspace membership, so no private record detail is exposed by the URL.
  const [extra] = useState<{ o?: string; p?: string; t?: string[]; lc?: string; c?: string; r?: string; s?: Scope; se?: string; to?: string }>(() => {
    try { const x = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("x"); const v = x ? JSON.parse(x) : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; }
  });
  const [workObjective, setWorkObjective] = useState(() => objectiveById(extra.o ?? "portfolio").id);
  const [assetTypes, setAssetTypes] = useState<string[]>(() => (Array.isArray(extra.t) ? extra.t.filter(x => typeof x === "string") : []));
  const [lifecycle, setLifecycle] = useState(extra.lc ?? "");
  const [region, setRegion] = useState(extra.r ?? "");
  const [scope, setScope] = useState<Scope>(extra.s === "view" || extra.s === "boundary" ? extra.s : "all");
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const [contextId, setContextId] = useState(() => deepProject ?? extra.p ?? "");
  const [contextGeom, setContextGeom] = useState<{ id: string; geometry: AreaGeometry | null; loading: boolean; error?: string } | null>(null);
  const [country, setCountry] = useState(extra.c ?? "");
  const [sector, setSector] = useState(extra.se ?? "");
  const [topic, setTopic] = useState(extra.to ?? "");
  const [limit, setLimit] = useState(50);
  const satsRef = useRef<Record<string, Sat[]>>({});
  const feedRef = useRef<Record<string, FeatureCollection>>({});
  const trailRef = useRef<[number, number][]>([]);
  const trackedRef = useRef(tracked);
  useEffect(() => { trackedRef.current = tracked; trailRef.current = []; }, [tracked]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !deepProject || !data) return;
    let live = true;
    const f = data.projects.features.find(x => String(x.properties.id) === deepProject);
    fetch(withBase(`/api/map/site?projectId=${encodeURIComponent(deepProject)}`)).then(r => (r.ok ? r.json() as Promise<{ project?: { lat: number | null; lng: number | null; geometry: string | null } }> : null)).then(s => {
      if (!live || !s?.project) return;
      let g: Geometry | null = null;
      try { const j = s.project.geometry ? JSON.parse(s.project.geometry) : null; g = j?.type === "Feature" ? j.geometry : j; } catch { g = null; }
      const at: [number, number] | null = f?.geometry ? (f.geometry.coordinates as [number, number]) : s.project.lng != null && s.project.lat != null ? [s.project.lng, s.project.lat] : null;
      if (f && at) setSelected({ layer: "projects", props: f.properties, lngLat: at });
      if (g) fitGeometry(map, g);
      else if (s.project.lat != null && s.project.lng != null) flyToCoordinates(map, s.project.lat, s.project.lng, 15.5);
    }).catch(() => { /* the map stays usable; the record link still works */ });
    return () => { live = false; };
  }, [mapReady, deepProject, data]);

  // ?lat=&lng=&z= opens Atlas at a point (Command map "Open in Atlas" for organizations, which have no project page).
  const [deepPoint] = useState(() => { const q = new URLSearchParams(window.location.search); const lat = Number(q.get("lat")), lng = Number(q.get("lng")); return q.get("lat") && q.get("lng") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng, z: Math.min(18, Math.max(2, Number(q.get("z")) || 10)) } : null; });
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !deepPoint || deepProject) return;
    flyToCoordinates(map, deepPoint.lat, deepPoint.lng, deepPoint.z);
  }, [mapReady, deepPoint, deepProject]);

  const records = useMemo(() => data ? mapRecords(data) : [], [data]);
  // One filter set for map and list. Chip counts use every OTHER active filter (types excluded) so each count is what selecting it adds.
  const baseFilters = useMemo(() => ({ query, country, sector, topic, lifecycle, region, bounds: scope === "view" ? viewBounds : null, boundary: scope === "boundary" && contextGeom?.id === contextId ? contextGeom.geometry : null }), [query, country, sector, topic, lifecycle, region, scope, viewBounds, contextGeom, contextId]);
  const filtered = useMemo(() => filterRecords(records, { ...baseFilters, types: assetTypes }, visible), [records, baseFilters, assetTypes, visible]);
  const typeStats = useMemo(() => typeCounts(filterRecords(records, baseFilters, visible)), [records, baseFilters, visible]);
  const recordCounts = useMemo(() => { const all = filterRecords(records, { ...baseFilters, types: assetTypes }, {}); return Object.fromEntries(RECORD_LAYERS.map(l => [l, all.filter(r => r.layer === l).length])); }, [records, baseFilters, assetTypes]);
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
    get<{ layers: OfferedLayer[]; firmsKey: boolean; streetView?: StreetViewConfig }>("/api/map/catalog").then(c => {
      setCatalog(c.layers); setFirmsKey(c.firmsKey); if (c.streetView) setStreetCfg(c.streetView);
      if (!init.base) setBase(c.layers.some(l => l.id === "esri") ? "esri" : c.layers.some(l => l.id === "light") ? "light" : c.layers.find(l => l.group === "basemap")?.id ?? "tactical");
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
        center: v.lat != null ? [v.lng!, v.lat] : [-30, 20], zoom: v.zoom ?? 2.6, bearing: v.bearing ?? 0, pitch: v.pitch ?? 0,
        minZoom: 0.6, maxPitch: 85, attributionControl: false, renderWorldCopies: false,
      });
    } catch (e) {
      reportClientError("map", `Map renderer unavailable: ${(e as Error)?.message ?? e}`, (e as Error)?.stack ?? "");
      queueMicrotask(() => setMapError("The map renderer is unavailable. You can still browse records in the directory."));
      return;
    }
    mapRef.current = map;
    let locationCancelled=false;
    let userMoved=false;
    const markUserMove=(event:{originalEvent?:unknown})=>{if(event.originalEvent)userMoved=true;};
    map.on('movestart',markUserMove);
    const params=new URLSearchParams(window.location.search);
    if(!params.has('project')&&!params.has('lat')){
      if(navigator.geolocation)navigator.geolocation.getCurrentPosition(position=>{
        if(locationCancelled||userMoved)return;
        const center:[number,number]=[position.coords.longitude,position.coords.latitude];
        const locate=()=>{if(!locationCancelled&&!userMoved)map.easeTo({center,zoom:2.6,pitch:0,bearing:0,duration:reducedMotion()?0:900});};
        if(map.isStyleLoaded())locate();else map.once('load',locate);
      },()=>{if(!locationCancelled){setSearchNote('Location unavailable. Search a place or allow browser location access to center Atlas near you.');setTimeout(()=>setSearchNote(n=>n==='Location unavailable. Search a place or allow browser location access to center Atlas near you.'?null:n),8000);}},{enableHighAccuracy:false,maximumAge:60000,timeout:10000});
      else queueMicrotask(()=>setSearchNote('Device location is unavailable. Search a place to center Atlas.'));
    }

    if (process.env.NODE_ENV !== "production") (window as unknown as { __atlas?: maplibregl.Map }).__atlas = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // Every map error is reported (Settings → Jobs → Browser errors) so production-only failures are visible.
    map.on("error", e => { const m = String(e.error?.message ?? e.error ?? "map error"); reportClientError("map", m.slice(0, 400), (e.error as { stack?: string } | undefined)?.stack ?? ""); if (!m.includes("tile")) setMapError("Some imagery or layers could not load. Records and the directory remain available."); });
    map.on("webglcontextlost", () => reportClientError("map", "WebGL context lost"));
    // Wire layers as soon as the style is parsed (not after every initial tile): the globe becomes interactive sooner.
    let wired = false;
    map.on("style.load", () => {
      if (wired) return;
      wired = true;
      addIcons(map);
      addDataLayers(map);
      addTrackLayers(map);
      map.on("click", "funding-regions-fill", e => {
        const f = e.features?.[0];
        if (!f || wbToolRef.current !== "none" || pickingRef.current) return;
        if (map.queryRenderedFeatures(e.point, { layers: ["projects", "organizations", "deals", "triggers", "hazards"].filter(id => map.getLayer(id)) }).length) return;
        setSelected({ layer: "funding_region", props: f.properties ?? {}, lngLat: [e.lngLat.lng, e.lngLat.lat] });
      });
      map.on("mouseenter", "funding-regions-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "funding-regions-fill", () => { map.getCanvas().style.cursor = ""; });
      for (const layer of ["projects", "organizations", "deals", "triggers", "hazards"] as LayerKey[]) {
        const ids = layer === "organizations" ? ["organizations", "organizations-cluster"] : [layer];
        for (const id of ids) {
          map.on("click", id, e => {
            const f = e.features?.[0] as MapGeoJSONFeature | undefined;
            if (!f) return;
            if (f.properties?.cluster) {
              (map.getSource("organizations") as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id as number).then(z => map.easeTo({ center: (f.geometry as GeoPoint).coordinates as [number, number], zoom: z + 0.5 }));
              return;
            }
            if (wbToolRef.current !== "none" || pickingRef.current) return;
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
    // Site pick tool: the next click anywhere becomes a site screen. Cursor coordinates feed the status bar.
    map.on("click", e => { if (pickingRef.current) startScreenRef.current([e.lngLat.lng, e.lngLat.lat]); });
    let cursorRaf = 0;
    map.on("mousemove", e => { if (cursorRaf) return; cursorRaf = requestAnimationFrame(() => { cursorRaf = 0; setCursor([e.lngLat.lng, e.lngLat.lat]); }); });
    return () => { locationCancelled=true;map.off("movestart",markUserMove);map.remove(); mapRef.current = null; setMapObj(null); };
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

  // Funding regions: country polygons carry the count of open / forthcoming calls that list the country.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !data) return;
    let live = true;
    fetch(withBase("/geo/countries-110m.json")).then(r => r.json() as Promise<FeatureCollection>).then(fc => {
      if (!live) return;
      const by = data.fundingByCountry ?? {};
      (map.getSource("funding-regions") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: fc.features.map(f => {
        const iso = String(f.properties?.iso3 ?? "");
        return { ...f, properties: { ...f.properties, n: by[iso]?.n ?? 0, items: JSON.stringify(by[iso]?.items ?? []) } };
      }) });
    }).catch(() => setStatus(s => ({ ...s, procurement: { error: "Country boundaries unavailable" } })));
    return () => { live = false; };
  }, [mapReady, data]);

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
      if (l.id === "registry_plants") {
        const b = map.getBounds();
        const box = [Math.max(-180, b.getWest()), Math.max(-90, b.getSouth()), Math.min(180, b.getEast()), Math.min(90, b.getNorth())].map(n => n.toFixed(2)).join(",");
        return `/api/map/live/plants?bbox=${box}&z=${map.getZoom().toFixed(1)}`;
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
      if (atlas.draw !== "none" || wbToolRef.current !== "none" || pickingRef.current) return;
      const recordHit = map.queryRenderedFeatures(e.point, { layers: ["projects", "organizations", "organizations-cluster", "deals", "triggers", "funding-regions-fill", "hazards"].filter(id => map.getLayer(id)) });
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
    map.easeTo({ padding: { left: wide && panel !== "none" ? 380 : 0, right: wide && selected ? 380 : 0, top: 0, bottom: 0 }, duration: reducedMotion() ? 0 : 500 });
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
        const x = { o: workObjective, p: contextId || undefined, t: assetTypes.length ? assetTypes : undefined, lc: lifecycle || undefined, c: country || undefined, r: region || undefined, s: scope !== "all" ? scope : undefined, se: sector || undefined, to: topic || undefined };
        const hash = `${encodeView({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), base, layers, mode, track: tracked ? `${tracked.layer}|${tracked.id}` : undefined })}&x=${encodeURIComponent(JSON.stringify(x))}`;
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${hash}`);
      }, 500);
    };
    write();
    map.on("moveend", write);
    return () => { map.off("moveend", write); clearTimeout(timer); };
  }, [mapReady, overlays, visible, base, mode, tracked, workObjective, contextId, assetTypes, lifecycle, country, region, scope, sector, topic]);

  // Current map area: follows the camera after each move while that scope is active.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || scope !== "view") return;
    const read = () => { const b = map.getBounds(); setViewBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }); };
    read();
    map.on("moveend", read);
    return () => { map.off("moveend", read); };
  }, [mapReady, scope]);

  // Project / site context: load its recorded site (point and boundary), carry it into the workbench, fit when chosen here.
  const contextChosen = useRef(false);
  useEffect(() => {
    if (!contextId) return;
    let live = true;
    fetch(withBase(`/api/map/site?projectId=${encodeURIComponent(contextId)}`)).then(r => (r.ok ? r.json() as Promise<{ project?: { lat: number | null; lng: number | null; geometry: string | null } }> : Promise.reject(new Error(String(r.status))))).then(s => {
      if (!live) return;
      let g: Geometry | null = null;
      try { const j = s.project?.geometry ? JSON.parse(s.project.geometry) : null; g = j?.type === "Feature" ? j.geometry : j; } catch { g = null; }
      const area = g && (g.type === "Polygon" || g.type === "MultiPolygon") ? (g as AreaGeometry) : null;
      setContextGeom({ id: contextId, geometry: area, loading: false });
      const map = mapRef.current;
      if (map && contextChosen.current) {
        if (g) fitGeometry(map, g);
        else if (s.project?.lat != null && s.project.lng != null) flyToCoordinates(map, s.project.lat, s.project.lng, 14);
      }
    }).catch(e => { if (live) setContextGeom({ id: contextId, geometry: null, loading: false, error: (e as Error).message }); });
    return () => { live = false; };
  }, [contextId]);

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
    mapRef.current?.flyTo({ center: [-30, 20], zoom: 2.6, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 2000 });
  }, []);
  const tilt = () => { const map = mapRef.current; if (map) map.easeTo({ pitch: map.getPitch() > 10 ? 0 : 60, duration: 900 }); };
  const northUp = () => mapRef.current?.easeTo({ bearing: 0, duration: 800 });

  const fitResults = useCallback(() => {
    if (!filtered.length) return;
    const first = filtered[0].feature.geometry.coordinates;
    const bounds = filtered.reduce((b, r) => b.extend(r.feature.geometry.coordinates), new maplibregl.LngLatBounds(first, first));
    mapRef.current?.fitBounds(bounds, { padding: 100, maxZoom: 10, duration: reducedMotion() ? 0 : 1400 });
  }, [filtered]);

  const objective = objectiveById(workObjective);
  const offered = useMemo(() => new Set(catalog.map(l => l.id)), [catalog]);
  const sug = suggestion(objective, offered, overlays);
  const nameOf = (id: string) => byId.get(id)?.label ?? id;
  const suggestionText = { add: sug.add.map(nameOf), already: sug.already.map(nameOf), unavailable: sug.unavailable };
  const canApply = sug.add.length > 0 || (!!sug.base && sug.base !== base) || objective.records.some(k => visible[k as LayerKey] === false);
  // Adds the objective's layers and record types; never removes what the person enabled.
  const applySuggestion = () => {
    setOverlays(cur => new Set([...cur, ...sug.add]));
    if (sug.base) setBase(sug.base);
    setVisible(v => ({ ...v, ...Object.fromEntries(objective.records.map(k => [k, true])) }) as Record<LayerKey, boolean>);
  };
  const clearFilters = () => { setQuery(""); setCountry(""); setRegion(""); setSector(""); setTopic(""); setAssetTypes([]); setLifecycle(""); setScope("all"); setContextId(""); setVisible(v => ({ ...v, ...Object.fromEntries(RECORD_LAYERS.map(k => [k, true])) }) as Record<LayerKey, boolean>); setLimit(50); };
  const ctxGeom = contextGeom?.id === contextId ? contextGeom : contextId ? { id: contextId, geometry: null, loading: true } : null;
  const ctxFeature = contextId ? data?.projects.features.find(f => String(f.properties.id) === contextId) : undefined;
  const contextInfo: ContextInfo = contextId ? (() => {
    const p = ctxFeature?.properties ?? {};
    const gaps = [!ctxFeature ? "location not recorded (cannot be placed on the map)" : null, ctxGeom && !ctxGeom.loading && !ctxGeom.geometry ? "no site boundary recorded" : null,
      ctxGeom && "error" in ctxGeom && ctxGeom.error ? `site record unavailable (${ctxGeom.error})` : null, ctxFeature && !p.assetClass && !p.technology ? "asset type not recorded" : null].filter(Boolean) as string[];
    return { id: contextId, name: String(p.name ?? projectChoices.find(x => x.id === contextId)?.name ?? "Selected project"), stage: p.stage ? stageLabel(String(p.stage)) : null,
      location: [p.location, p.country].filter(Boolean).join(", "), role: p.regeneraRole ? REGENERA_ROLES[p.regeneraRole as keyof typeof REGENERA_ROLES] ?? String(p.regeneraRole) : null,
      hasBoundary: !!ctxGeom?.geometry, loading: !!ctxGeom?.loading, gaps };
  })() : null;

  const runMission = useCallback((id: string) => {
    const m = MISSIONS.find(x => x.id === id);
    if (!m) return;
    if (byId.has(m.base) || m.base === "tactical") setBase(byId.has(m.base) ? m.base : base);
    setOverlays(new Set(m.layers.filter(l => byId.has(l))));
    if (m.records) setVisible(Object.fromEntries(RECORD_KEYS.map(k => [k, m.records!.includes(k)])) as Record<LayerKey, boolean>);
    else setVisible(Object.fromEntries(RECORD_KEYS.map(k => [k, false])) as Record<LayerKey, boolean>);
    setMode((m.mode as Mode) ?? "normal");
    if (m.camera === "globe") mapRef.current?.flyTo({ center: [-20, 18], zoom: 1.6, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 2200 });
    if (m.camera === "fit") {
      const matches=records.filter(r=>(!m.records || m.records.includes(r.layer)) && (!country || r.country===country));
      if(matches.length){const first=matches[0].feature.geometry.coordinates;const bounds=matches.reduce((b,r)=>b.extend(r.feature.geometry.coordinates),new maplibregl.LngLatBounds(first,first));mapRef.current?.fitBounds(bounds,{padding:{left:380,right:60,top:90,bottom:80},maxZoom:11,duration:reducedMotion()?0:900});}
      else setSearchNote("No located records for this objective in the selected market. Search a site or place to begin.");
    }
  }, [byId, base, records,country]);

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
      else if (k === "v") { const c = mapRef.current?.getCenter(); if (c) setStreetAt(at => (at ? null : { lat: c.lat, lng: c.lng })); }
      else if (k === "o") setOrbitOn(v => !v);
      else if (k === "p") tilt();
      else if (k === "n") northUp();
      else if (k === "r") resetGlobe();
      else if (k === "l") setPanel(p => (p === "none" ? "intel" : "none"));
      else if (k === "?") setShowKeys(v => !v);
      else if (k === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === "s") setPicking(v => !v);
      else if (k === "escape") { setPicking(false); setShowDisplay(false); setTouring(false); setOrbitOn(false); setTracked(null); setTarget(null); setSelected(null); setShowKeys(false); }
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
    { id: "ov-military-icon", color: "#B98236", size: 24, label: (p: Record<string, unknown>) => `MIL ${String(p.callsign ?? p.id ?? "").toUpperCase()}` },
    ...["sat_eo", "sat_weather", "sat_stations", "sat_gnss"].map(id => ({ id: `ov-${id}-pt`, color: "#9dff8a", size: 18, label: (p: Record<string, unknown>) => `${p.norad} ${String(p.name ?? "").slice(0, 16)}` })),
    { id: "ov-quakes-pt", color: "#ff9f40", size: 26, label: (p: Record<string, unknown>) => `EQ M${p.mag}` },
    { id: "ov-events-pt", color: "#c07cff", size: 22, label: (p: Record<string, unknown>) => String(p.categoryLabel ?? "EVENT").toUpperCase() },
    { id: "ov-cyclones-icon", color: "#5ad1ff", size: 40, label: (p: Record<string, unknown>) => `TC ${String(p.name ?? "").toUpperCase()}` },
    { id: "projects", color: "#B9943F", size: 30, label: (p: Record<string, unknown>) => `PROJ ${String(p.name ?? "").toUpperCase().slice(0, 22)}` },
  ], []);
  const live = activeOverlays.some(l => l.kind === "feed" || l.kind === "satellites");
  const baseLabel = baseLayer?.label ?? "Tactical vector";

  return (
    <div className={styles.stage} data-fullbleed data-selection={selected || siteScreen.screen ? "true" : "false"} data-mode={mode} data-picking={picking ? "true" : "false"} data-panel={panel}>
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
        {searchNote && <p className={`${styles.glass} ${styles.searchNote}`} role="status">{searchNote} <button type="button" className={styles.noteClose} onClick={() => setSearchNote(null)} aria-label="Dismiss message"><X size={13} aria-hidden /></button></p>}
      </div>
      <SavedViews />
      {streetAt && <Suspense fallback={null}><StreetView lat={streetAt.lat} lng={streetAt.lng} config={streetCfg} onClose={() => setStreetAt(null)} /></Suspense>}

      {panel === "none" && <button type="button" className={styles.reopen} onClick={() => setPanel("directory")} aria-label="Open the explore panel"><PanelLeftOpen size={16} aria-hidden /> Explore</button>}
      {panel !== "none" && (
        <aside className={`${styles.glass} ${styles.layers}`} aria-label="Map explorer">
          <div className={styles.panelTabs} role="tablist" aria-label="Panel sections">
            {(["directory", "intel", "workbench"] as const).map(p => <button key={p} type="button" role="tab" aria-selected={panel === p} onClick={() => setPanel(p)}>{p === "directory" ? "Explore" : p === "intel" ? `Layers${activeOverlays.length ? ` (${activeOverlays.length})` : ""}` : "Analyze"}</button>)}
            <button type="button" className={styles.iconBtn} onClick={() => setPanel("none")} aria-label="Collapse panel"><X size={14} /></button>
          </div>
          {panel === "intel" && (
            <IntelPanel catalog={catalog} base={base} setBase={setBase} overlays={overlays} toggle={toggleOverlay} status={status} firmsKey={firmsKey}
              records={RECORD_KEYS.map(k => ({ key: k, label: LAYER_META[k].label, swatch: LAYER_META[k].swatch, count: counts[k] }))} recordsOn={visible}
              toggleRecord={k => setVisible(v => ({ ...v, [k]: !v[k as LayerKey] }))} dayOffset={dayOffset} setDayOffset={setDayOffset} runMission={runMission}
              setOpacity={(id, v) => { const m = mapRef.current; if (m?.getLayer(`ov-${id}`) && m.getLayer(`ov-${id}`)?.type === "raster") m.setPaintProperty(`ov-${id}`, "raster-opacity", v); }} />
          )}
          {panel === "workbench" && <>
            <div className={styles.analyzeHead}>
              <button type="button" className={styles.action} aria-pressed={picking} onClick={() => setPicking(v => !v)}><MapPinPlus size={14} aria-hidden /> {picking ? "Click the map to screen a site… (Esc cancels)" : "Screen a site (S)"}</button>
              <p className={styles.note}>Pick any point: Atlas saves a site record, runs grid, water, ecology, terrain, hazards, capital and partner screening, and saves a preliminary assessment.</p>
            </div>
            <WorkbenchPanel wb={wb} mode={wbMode} setMode={setWbMode} projects={projectChoices} projectId={wbProject} setProjectId={setWbProject} />
            <details className={styles.catalogGroup}><summary>Drawing, import &amp; saved shapes</summary><LibraryPanel atlas={atlas} /></details>
          </>}
          {panel === "directory" && <ExplorePanel
            objective={objective} setObjective={setWorkObjective} suggestionText={suggestionText} applySuggestion={applySuggestion} canApply={canApply}
            projects={projectChoices} contextId={contextId} setContextId={id => { contextChosen.current = true; setContextId(id); if (id) setWbProject(id); else if (scope === "boundary") setScope("all"); setLimit(50); }} context={contextInfo} openWorkbench={() => setPanel("workbench")} unmappedProjects={data?.counts.unmappedProjects ?? 0}
            typeCounts={typeStats.counts} unclassified={typeStats.unclassified} types={assetTypes} toggleType={t => { setAssetTypes(a => (a.includes(t) ? a.filter(x => x !== t) : [...a, t])); setLimit(50); }}
            lifecycle={lifecycle} setLifecycle={v => { setLifecycle(v); setLimit(50); }} countries={discoveryOptions(records, "country")} country={country} setCountry={v => { setCountry(v); setRegion(""); setLimit(50); }}
            regions={discoveryOptions(country ? records.filter(r => r.country === country) : records, "region")} region={region} setRegion={v => { setRegion(v); setLimit(50); }} scope={scope} setScope={s => { setScope(s); setLimit(50); }}
            recordCounts={recordCounts} visible={visible} toggleRecord={k => setVisible(v => ({ ...v, [k]: !v[k as LayerKey] }))}
            query={query} clearQuery={() => setQuery("")} filtered={filtered} total={records.length} limit={limit} more={() => setLimit(n => n + 50)}
            onPick={flyTo} selectedKey={selected ? `${selected.layer}:${String(selected.props.kind ?? "")}:${String(selected.props.source ?? "")}:${String(selected.props.id)}` : null} swatch={l => LAYER_META[l as LayerKey]?.swatch ?? "#999"}
            clearFilters={clearFilters} fitResults={fitResults} canFit={mapReady && filtered.length > 0} collapse={() => setPanel("none")}
            loadNote={data ? null : loadError ? "Records unavailable." : "Loading records…"} />}
          {panel === "directory" && <>
            <details className={styles.catalogGroup}><summary>More filters: sector and territorial system</summary><div className={styles.filters}>
              <label>Sector<select value={sector} onChange={e => { setSector(e.target.value); setLimit(50); }}><option value="">All sectors</option>{discoveryOptions(records, "sector").map(v => <option key={v} value={v}>{SECTORS[v as keyof typeof SECTORS] ?? v.replace(/_/g, " ")}</option>)}</select></label>
              <label>Territorial system<select value={topic} onChange={e => { setTopic(e.target.value); setLimit(50); }}><option value="">All recorded systems</option>{discoveryOptions(records, "topic").map(v => <option key={v} value={v}>{TERRITORIAL_SYSTEMS[v as keyof typeof TERRITORIAL_SYSTEMS] ?? v.replace(/_/g, " ")}</option>)}</select></label>
            </div></details>
            {data && data.counts.unmapped > 0 && <p className={styles.note}>{data.counts.unmapped} organizations have missing or invalid coordinates. <Link href="/companies">Review organizations</Link></p>}
            {data && <p className={styles.note}>Events from {data.since} onward · snapshot {data.generatedAt.slice(0, 16).replace("T", " ")} UTC. Record updates do not imply verification.</p>}
          </>}
          {loadError && <p className={styles.error} role="alert">{loadError}</p>}
          {mapError && <p className={styles.error} role="alert">{mapError}</p>}
        </aside>
      )}

      {/* Grouped toolbar: navigation · analysis · view & save. Sensor looks, HUD, detection, orbit and tour live in Display. */}
      <div className={styles.controls} role="toolbar" aria-label="Map tools">
        <div className={styles.toolGroup} aria-label="Navigation">
          <button type="button" className={styles.ctrl} onClick={() => mapRef.current?.zoomIn()} title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" className={styles.ctrl} onClick={() => mapRef.current?.zoomOut()} title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" className={styles.ctrl} onClick={northUp} title="North up (N)" aria-label="North up"><Compass size={16} /></button>
          <button type="button" className={styles.ctrl} onClick={toggleProjection} aria-pressed={globe} title="Globe / flat (G)" aria-label="Globe or flat projection"><Globe2 size={16} /></button>
          <button type="button" className={styles.ctrl} onClick={toggle3d} aria-pressed={terrain3d} title="3D terrain (T)" aria-label="3D terrain"><Mountain size={16} /></button>
        </div>
        <div className={styles.toolGroup} aria-label="Analysis">
          <button type="button" className={styles.ctrl} onClick={() => { setPicking(v => !v); setPanel("workbench"); }} aria-pressed={picking} title="Screen a site (S)" aria-label="Screen a site"><MapPinPlus size={16} /></button>
          <button type="button" className={styles.ctrl} onClick={() => setPanel(p => (p === "intel" ? "none" : "intel"))} aria-pressed={panel === "intel"} title="Layers and basemaps" aria-label="Layers and basemaps"><SlidersHorizontal size={16} style={{ transform: "rotate(90deg)" }} /></button>
        </div>
        <div className={styles.toolGroup} aria-label="View and save">
          <button type="button" className={styles.ctrl} onClick={() => { const c = mapRef.current?.getCenter(); if (c) setStreetAt({ lat: c.lat, lng: c.lng }); }} aria-pressed={!!streetAt} title="Street view at the centre (V)" aria-label="Street view"><PersonStanding size={16} /></button>
          <button type="button" className={styles.ctrl} onClick={share} title="Copy share link" aria-label="Copy share link"><Share2 size={16} /></button>
          <button type="button" className={styles.ctrl} onClick={() => setShowDisplay(v => !v)} aria-pressed={showDisplay} title="Display settings" aria-label="Display settings"><SlidersHorizontal size={16} /></button>
        </div>
      </div>
      {showDisplay && (
        <div className={`${styles.glass} ${styles.displayMenu}`} role="dialog" aria-label="Display settings">
          <button type="button" className={styles.close} onClick={() => setShowDisplay(false)} aria-label="Close"><X size={14} /></button>
          <p className={styles.panelTitle}>Display</p>
          <p className={styles.fieldLabel}>Look</p>
          <div className={styles.modeChoices}>{MODES.map((m, i) => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)} title={`${m.label} (${i + 1})`}>{m.label}</button>)}</div>
          <div className={styles.displayToggles}>
            <button type="button" aria-pressed={hudOn} onClick={() => setHudOn(v => !v)}><Crosshair size={14} /> HUD (H)</button>
            <button type="button" aria-pressed={detectOn} onClick={() => setDetectOn(v => !v)}><Scan size={14} /> Detection boxes (D)</button>
            <button type="button" aria-pressed={orbitOn} onClick={() => setOrbitOn(v => !v)}><Orbit size={14} /> Orbit (O)</button>
            <button type="button" aria-pressed={touring} disabled={!data?.projects.features.length} onClick={() => setTouring(v => !v)}><Play size={14} /> Tour projects</button>
            <button type="button" onClick={tilt}><Square size={13} /> Tilt (P)</button>
            <button type="button" onClick={resetGlobe}><Globe2 size={14} /> Reset globe (R)</button>
            <button type="button" aria-pressed={showKeys} onClick={() => setShowKeys(v => !v)}><Keyboard size={14} /> Keyboard (?)</button>
          </div>
        </div>
      )}
      {picking && <p className={`${styles.glass} ${styles.pickHint}`} role="status">Click anywhere on the map to screen that location as a site · Esc to cancel</p>}
      {copied && <p className={`${styles.glass} ${styles.toast}`} role="status">Link copied: camera, layers, look and tracked target.</p>}
      {showKeys && (
        <div className={`${styles.glass} ${styles.keys}`} role="dialog" aria-label="Keyboard shortcuts">
          <button type="button" className={styles.close} onClick={() => setShowKeys(false)} aria-label="Close"><X size={14} /></button>
          <p className={styles.panelTitle}>Keyboard</p>
          <dl className={styles.facts}>
            {[["1–6", "Normal · CRT · NVG · FLIR · Thermal · Noir"], ["H", "HUD"], ["D", "Detection boxes"], ["G", "Globe / flat"], ["T", "3D terrain"], ["V", "Street view at the crosshair"], ["P", "Tilt"], ["N", "North up"], ["O", "Orbit"], ["R", "Reset globe"], ["L", "Hide / show panel"], ["/", "Search"], ["Esc", "Stop tracking, tour and orbit"]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      )}

      {(selected || siteScreen.screen) && (() => {
        const id = String(selected?.props.id ?? "");
        const links: [string, string][] = !selected ? [] : selected.layer === "projects" ? [["Open project", `/projects/${id}`], ["Risk & evidence", `/projects/${id}?tab=risk`], ["Capital", `/projects/${id}?tab=capital`]]
          : selected.layer === "organizations" ? [["Open organization", `/companies/${id}`]]
          : selected.layer === "deals" ? [["Open opportunity", `/deals/${id}`]]
          : selected.layer === "triggers" ? [["Open signal", `/triggers/${id}`]]
          : selected.layer === "procurement" && typeof selected.props.href === "string" ? [["Open funding record", selected.props.href]] : [];
        return <Inspector key={siteScreen.screen ? "screen" : `sel:${selected?.layer}:${id}`} selected={selected} screen={siteScreen.screen} links={links} onScreen={startScreen}
          onClose={closeInspector}
          tracked={!!selected && tracked?.id === String(selected.props.id)} onTrack={() => { if (!selected) return; if (tracked?.id === String(selected.props.id)) { setTracked(null); setTarget(null); } else startTrack(false); }} onChase={() => startTrack(true)}
          extra={selected?.layer === "projects" ? <p className={styles.links}><button type="button" onClick={() => { setWbProject(id); setContextId(id); setPanel("workbench"); }}>Open site workbench</button></p> : null} />;
      })()}

      {!hudOn && (
        <div className={styles.statusBar} role="status" aria-label="Map status">
          <span>{baseLabel}</span>
          {activeOverlays.map(l => { const st = status[l.id]; const state = st?.error ? "error" : st?.loading ? "loading" : "ok"; return <span key={l.id} data-state={state} title={st?.error ?? st?.source ?? l.attribution}>{l.label}{st?.error ? " · unavailable" : st?.loading ? " · loading" : st?.count != null ? ` · ${(st.shown ?? st.count).toLocaleString("en-US")}` : ""}</span>; })}
          {data && <span title="Record snapshot">records {data.generatedAt.slice(11, 16)} UTC</span>}
          {cursor && <span className={styles.coordsLive}>{cursor[1].toFixed(4)}, {cursor[0].toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
}

