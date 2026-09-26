"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Compass, Globe2, Layers, Mountain, Search, X } from "lucide-react";
import type { MapPayload } from "@/lib/map/features";
import { coordinateLabel, discoveryOptions, filterRecords, mapRecords, RECORD_LAYERS, safeWebsite, type MapRecord } from "@/lib/map/discovery";
import { SECTORS, TERRITORIAL_SYSTEMS } from "@/lib/vocab";
import styles from "./map.module.css";
import { DrawPanel, LibraryPanel, SiteContext, useAtlas } from "./atlas-tools";
import { withBase } from "@/lib/base-path";

maplibregl.setWorkerUrl(withBase("/maplibre-gl-worker.js"));

// Regenera tokens (styles/tokens.css) as literal colors for WebGL paint properties.
const C = { fern: "#131b13", ink: "#0d120e", wax: "#efe9dc", pollen: "#c9a84d", reed: "#a9c799", water: "#476b5e", leaf: "#7a8675", ember: "#c8553d", sky: "#7fb7d6" };
const SECTOR_COLORS: [string, string][] = [
  ["energy", C.pollen], ["infrastructure", C.sky], ["land_built_environment", C.reed],
  ["waste_resource_systems", "#c08a5a"], ["water_food_nature", "#5fb3a1"],
];
const TRIGGER_COLORS: [string, string][] = [
  ["capital", C.pollen], ["crisis", C.ember], ["people", "#d9c7f0"], ["project", C.reed], ["regulatory", "#e59f5a"], ["commitment", "#5fb3a1"], ["event", C.wax],
];

type LayerKey = "projects" | "organizations" | "deals" | "triggers" | "procurement" | "hazards";
const LAYER_META: Record<LayerKey, { label: string; swatch: string }> = {
  projects: { label: "Projects", swatch: C.wax },
  triggers: { label: "Triggers (this year)", swatch: C.ember },
  procurement: { label: "Funding, tenders and calls", swatch: C.sky },
  deals: { label: "Opportunities", swatch: C.pollen },
  organizations: { label: "Organizations", swatch: C.reed },
  hazards: { label: "Hazard alerts (GDACS)", swatch: "#e0672f" },
};

type Selected = { layer: LayerKey | "cluster"; props: Record<string, unknown>; lngLat: [number, number] } | null;

function baseStyle(esriKey: string | null): StyleSpecification {
  const imagery = esriKey
    ? { tiles: [`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${esriKey}`], maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }
    : { tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"], maxzoom: 8, attribution: "Imagery: NASA Blue Marble (GIBS)" };
  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sky: {
      "sky-color": "#0b1a2a",
      "horizon-color": "#9cc3e6",
      "fog-color": "#0d120e",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.4,
      "fog-ground-blend": 0.25,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
    },
    sources: {
      imagery: { type: "raster", tileSize: 256, ...imagery },
      dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Terrain: Mapzen / AWS Open Data" },
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap contributors, OpenFreeMap" },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": C.ink } },
      { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.12, "raster-contrast": 0.08, "raster-brightness-max": 0.92, "raster-fade-duration": 250 } },
      { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0d120e", "hillshade-highlight-color": "#efe9dc", "hillshade-accent-color": "#131b13" } },
      { id: "admin-1", type: "line", source: "ofm", "source-layer": "boundary", minzoom: 3.5, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "rgba(239,233,220,0.45)", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 10, 1.2], "line-dasharray": [2, 2] } },
      { id: "admin-0", type: "line", source: "ofm", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": "#f2d25c", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 5, 1.2, 10, 2.2] } },
      { id: "country-labels", type: "symbol", source: "ofm", "source-layer": "place", maxzoom: 7, filter: ["==", ["get", "class"], "country"],
        layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 14], "text-transform": "uppercase", "text-letter-spacing": 0.16, "text-max-width": 8 },
        paint: { "text-color": "#fbf6e8", "text-halo-color": "rgba(13,18,14,0.85)", "text-halo-width": 1.4 } },
      { id: "city-labels", type: "symbol", source: "ofm", "source-layer": "place", minzoom: 4.5, filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 15], "text-anchor": "top", "text-offset": [0, 0.4] },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(13,18,14,0.9)", "text-halo-width": 1.3 } },
    ],
  };
}

function addDataLayers(map: maplibregl.Map) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource("organizations", { type: "geojson", data: empty, cluster: true, clusterRadius: 44, clusterMaxZoom: 9 });
  map.addSource("deals", { type: "geojson", data: empty });
  map.addSource("projects", { type: "geojson", data: empty });
  map.addSource("triggers", { type: "geojson", data: empty });
  map.addSource("procurement", { type: "geojson", data: empty });
  map.addSource("hazards", { type: "geojson", data: empty });

  const sectorColor = ["match", ["get", "sector"], ...SECTOR_COLORS.flat(), C.wax] as unknown as maplibregl.ExpressionSpecification;
  const triggerColor = ["match", ["get", "type"], ...TRIGGER_COLORS.flat(), C.wax] as unknown as maplibregl.ExpressionSpecification;

  map.addLayer({ id: "hazards", type: "circle", source: "hazards", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 8, 11],
    "circle-color": ["match", ["get", "level"], "Red", "#d9412b", "#e59a3a"], "circle-opacity": 0.25,
    "circle-stroke-color": ["match", ["get", "level"], "Red", "#ff6a4d", "#f2b35a"], "circle-stroke-width": 1.5,
  } });
  map.addLayer({ id: "organizations-cluster", type: "circle", source: "organizations", filter: ["has", "point_count"], paint: {
    "circle-color": "rgba(19,27,19,0.82)", "circle-stroke-color": C.reed, "circle-stroke-width": 1.5,
    "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
  } });
  map.addLayer({ id: "organizations-count", type: "symbol", source: "organizations", filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 11 }, paint: { "text-color": C.wax } });
  map.addLayer({ id: "organizations", type: "circle", source: "organizations", filter: ["!", ["has", "point_count"]], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.5, 10, 7], "circle-color": sectorColor,
    "circle-stroke-color": "rgba(13,18,14,0.9)", "circle-stroke-width": 1.2,
  } });
  map.addLayer({ id: "deals", type: "circle", source: "deals", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 13], "circle-color": "rgba(201,168,77,0.12)",
    "circle-stroke-color": C.pollen, "circle-stroke-width": 2.4,
  } });
  // Projects: square-ish marker in wax with a fern ring, drawn above opportunities.
  map.addLayer({ id: "projects", type: "circle", source: "projects", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 10, 12], "circle-color": C.wax,
    "circle-stroke-color": "#173b2a", "circle-stroke-width": 3,
  } });
  map.addLayer({ id: "procurement", type: "circle", source: "procurement", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 10, 8], "circle-color": C.sky,
    "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2,
  } });
  map.addLayer({ id: "triggers-halo", type: "circle", source: "triggers", paint: {
    "circle-radius": 12, "circle-color": triggerColor, "circle-opacity": 0.18, "circle-blur": 0.6,
  } });
  map.addLayer({ id: "triggers", type: "circle", source: "triggers", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 3, ["coalesce", ["get", "urgency"], 3]], 10, ["+", 6, ["coalesce", ["get", "urgency"], 3]]],
    "circle-color": triggerColor, "circle-stroke-color": "#0d120e", "circle-stroke-width": 1.2,
  } });
}

const LAYER_IDS: Record<LayerKey, string[]> = {
  organizations: ["organizations", "organizations-cluster", "organizations-count"],
  projects: ["projects"], deals: ["deals"], triggers: ["triggers", "triggers-halo"], procurement: ["procurement"], hazards: ["hazards"],
};

export default function MapClient({ esriKey }: { esriKey: string | null }) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initialFit = useRef(false);
  const [data, setData] = useState<MapPayload | null>(null);
  const [hazardCount, setHazardCount] = useState(0);
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({ projects: true, triggers: true, procurement: true, deals: true, organizations: true, hazards: true });
  const [terrain3d, setTerrain3d] = useState(false);
  const [globe, setGlobe] = useState(true);
  const [selected, setSelected] = useState<Selected>(null);
  const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(2.15);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hazardError, setHazardError] = useState<string | null>(null);
  const [hazards, setHazards] = useState<FeatureCollection | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"layers" | "directory" | "library" | "draw">("directory");
  const [country, setCountry] = useState("");
  const [sector, setSector] = useState("");
  const [topic, setTopic] = useState("");
  const [limit, setLimit] = useState(50);
  const records = useMemo(() => data ? mapRecords(data) : [], [data]);
  const filtered = useMemo(() => filterRecords(records, { query, country, sector, topic }, visible), [records, query, country, sector, topic, visible]);
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const onSelectProject = useCallback((props: Record<string, unknown>, lngLat: [number, number]) => setSelected({ layer: "projects", props, lngLat }), []);
  const atlas = useAtlas(mapRef, mapReady, onSelectProject);
  const projectChoices = useMemo(() => (data?.projects.features ?? []).map(f => ({ id: String(f.properties.id), name: String(f.properties.name) })), [data]);

  // Load the accessible directory independently of WebGL and basemap availability.
  useEffect(() => {
    const controller = new AbortController();
    fetch(withBase("/api/map/features"), { signal: controller.signal }).then(r => r.ok ? r.json() as Promise<MapPayload> : Promise.reject(new Error(String(r.status))))
      .then(setData).catch(e => { if (!controller.signal.aborted) setLoadError(`Map records could not load (${e.message}). Reload to retry.`); });
    fetch(withBase("/api/map/hazards"), { signal: controller.signal }).then(r => r.ok ? r.json() as Promise<FeatureCollection> : Promise.reject(new Error(String(r.status))))
      .then(d => { setHazards(d); setHazardCount(d.features.length); })
      .catch(() => { if (!controller.signal.aborted) setHazardError("Hazard feed unavailable. This does not mean there are no hazards."); });
    return () => controller.abort();
  }, []);

  // Map lifecycle
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: maplibregl.Map;
    try { map = new maplibregl.Map({
      container: container.current,
      style: baseStyle(esriKey),
      center: [-30, 20],
      zoom: 2.15,
      minZoom: 0.8,
      maxPitch: 80,
      attributionControl: false,
      renderWorldCopies: false,
    }); } catch {
      // Keep directory usable when WebGL is unavailable.
      queueMicrotask(() => setMapError("The map renderer is unavailable. You can still browse records in the directory."));
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("error", () => setMapError("Some map imagery or layers could not load. Record search and the directory remain available."));

    map.on("load", () => {
      addDataLayers(map);
      map.setTerrain(null);
      setMapReady(true);
      for (const layer of ["projects", "organizations", "deals", "triggers", "procurement", "hazards"] as LayerKey[]) {
        const ids = layer === "organizations" ? ["organizations", "organizations-cluster"] : [layer];
        for (const id of ids) {
          map.on("click", id, e => {
            const f = e.features?.[0] as MapGeoJSONFeature | undefined;
            if (!f) return;
            if (f.properties?.cluster) {
              const src = map.getSource("organizations") as GeoJSONSource;
              src.getClusterExpansionZoom(f.properties.cluster_id as number).then(z => map.easeTo({ center: (f.geometry as GeoPoint).coordinates as [number, number], zoom: z + 0.5 }));
              return;
            }
            setSelected({ layer, props: f.properties ?? {}, lngLat: (f.geometry as GeoPoint).coordinates as [number, number] });
          });
          map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
        }
      }
      // Gentle pulse on trigger halos.
      let t0 = performance.now();
      const pulse = (now: number) => {
        if (!mapRef.current || !map.getLayer("triggers-halo")) return;
        const phase = ((now - t0) % 2200) / 2200;
        map.setPaintProperty("triggers-halo", "circle-radius", 8 + phase * 16);
        map.setPaintProperty("triggers-halo", "circle-opacity", 0.28 * (1 - phase));
        requestAnimationFrame(pulse);
      };
      t0 = performance.now();
      if (!reducedMotion()) requestAnimationFrame(pulse);
    });
    map.on("mousemove", e => setCursor({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    map.on("zoomend", () => setZoom(map.getZoom()));
    return () => { map.remove(); mapRef.current = null; };
  }, [esriKey]);

  // The map and directory always use the same filtered records, including opportunity records.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const layer of RECORD_LAYERS) {
      (map.getSource(layer) as GeoJSONSource)?.setData({ type: "FeatureCollection", features: filtered.filter(r => r.layer === layer).map(r => r.feature) });
    }
    if (hazards) (map.getSource("hazards") as GeoJSONSource)?.setData(hazards);
  }, [mapReady, filtered, hazards]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !records.length || initialFit.current) return;
    initialFit.current = true;
    const first = records[0].feature.geometry.coordinates;
    const bounds = records.reduce((b, r) => b.extend(r.feature.geometry.coordinates), new maplibregl.LngLatBounds(first, first));
    map.fitBounds(bounds, { padding: 100, maxZoom: 5, duration: reducedMotion() ? 0 : 1200 });
  }, [mapReady, records]);

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const [key, ids] of Object.entries(LAYER_IDS) as [LayerKey, string[]][]) {
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible[key] ? "visible" : "none");
    }
  }, [visible, data, mapReady]);

  const toggle3d = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = !terrain3d;
    setTerrain3d(next);
    if (next) {
      map.setTerrain({ source: "dem", exaggeration: 1.4 });
      map.easeTo({ pitch: 62, duration: 1400 });
    } else {
      map.easeTo({ pitch: 0, duration: 1000 });
      setTimeout(() => map.setTerrain(null), 1000);
    }
  }, [terrain3d]);

  const toggleProjection = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = !globe;
    setGlobe(next);
    map.setProjection({ type: next ? "globe" : "mercator" });
  }, [globe]);

  const resetNorth = () => mapRef.current?.easeTo({ bearing: 0, pitch: terrain3d ? 62 : 0, duration: 800 });

  const flyTo = (m: MapRecord) => {
    const [lng, lat] = m.feature.geometry.coordinates;
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 8, pitch: terrain3d ? 62 : 0, duration: reducedMotion() ? 0 : 1200 });
    setSelected({ layer: m.layer, props: m.feature.properties, lngLat: [lng, lat] });
  };

  const fitResults = () => {
    if (!filtered.length) return;
    const first = filtered[0].feature.geometry.coordinates;
    const bounds = filtered.reduce((b, r) => b.extend(r.feature.geometry.coordinates), new maplibregl.LngLatBounds(first, first));
    mapRef.current?.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: reducedMotion() ? 0 : 900 });
  };

  const counts: Record<LayerKey, number> = {
    projects: data?.projects.features.length ?? 0,
    organizations: data?.counts.organizations ?? 0,
    deals: data?.deals.features.length ?? 0,
    triggers: data?.triggers.features.length ?? 0,
    procurement: data?.procurement.features.length ?? 0,
    hazards: hazardCount,
  };

  return (
    <div className={styles.stage} data-fullbleed data-selection={selected ? "true" : "false"}>
      <div ref={container} className={styles.map} />

      <div className={styles.searchWrap}>
        <div className={`${styles.glass} ${styles.search}`}>
          <Search size={16} aria-hidden />
          <input value={query} onChange={e => { setQuery(e.target.value); setPanel("directory"); setLimit(50); }} placeholder="Search records, places and topics" aria-label="Search the map" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
        </div>
      </div>

      <aside className={`${styles.glass} ${styles.layers}`} aria-label="Map explorer">
        <div className={styles.panelTabs}>
          <button type="button" aria-pressed={panel === "directory"} onClick={() => setPanel("directory")}>Directory</button>
          <button type="button" aria-pressed={panel === "layers"} onClick={() => setPanel("layers")}>Layers</button>
          <button type="button" aria-pressed={panel === "library"} onClick={() => setPanel("library")}>Library</button>
          <button type="button" aria-pressed={panel === "draw"} onClick={() => setPanel("draw")}>Draw</button>
        </div>
        {panel === "library" && <LibraryPanel atlas={atlas} />}
        {panel === "draw" && <DrawPanel atlas={atlas} projects={projectChoices} />}
        {panel === "directory" && <>
          <div className={styles.filters}>
            <label>Country<select value={country} onChange={e => { setCountry(e.target.value); setLimit(50); }}><option value="">All countries</option>{discoveryOptions(records, "country").map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Sector<select value={sector} onChange={e => { setSector(e.target.value); setLimit(50); }}><option value="">All sectors</option>{discoveryOptions(records, "sector").map(v => <option key={v} value={v}>{SECTORS[v as keyof typeof SECTORS] ?? v.replace(/_/g, " ")}</option>)}</select></label>
            <label>Topic<select value={topic} onChange={e => { setTopic(e.target.value); setLimit(50); }}><option value="">All recorded topics</option>{discoveryOptions(records, "topic").map(v => <option key={v} value={v}>{TERRITORIAL_SYSTEMS[v as keyof typeof TERRITORIAL_SYSTEMS] ?? v.replace(/_/g, " ")}</option>)}</select></label>
          </div>
          <p className={styles.note}>Topics use recorded industries and project systems. Unclassified records remain visible with all filters cleared.</p>
          <div className={styles.panelTabs}>
            <button type="button" onClick={() => { setQuery(""); setCountry(""); setSector(""); setTopic(""); setLimit(50); }}>Clear filters</button>
            <button type="button" disabled={!mapReady || !filtered.length} onClick={fitResults}>Fit results</button>
          </div>
          <p className={styles.note} role="status">{data ? `${filtered.length} of ${records.length} located records · enabled layers` : loadError ? "Records unavailable" : "Loading records…"}</p>
          {data && filtered.length === 0 && <p className={styles.note}>No matching records. Clear filters or enable more layers.</p>}
          <ul className={styles.directory} aria-label="Map records">
            {filtered.slice(0, limit).map(m => <li key={m.key}>
              <button type="button" onClick={() => flyTo(m)} aria-pressed={selected?.layer === m.layer && selected?.props.id === m.feature.properties.id}>
                <span className={styles.swatch} style={{ background: LAYER_META[m.layer].swatch }} aria-hidden />
                <span><strong>{m.label}</strong><small>{LAYER_META[m.layer].label}{m.location ? ` · ${m.location}` : ""}</small></span>
              </button>
            </li>)}
          </ul>
          {filtered.length > limit && <button className={styles.more} type="button" onClick={() => setLimit(n => n + 50)}>Show 50 more</button>}
        </>}
        {panel === "layers" && <>
        <p className={styles.panelTitle}><Layers size={14} aria-hidden /> Layers</p>
        {(Object.keys(LAYER_META) as LayerKey[]).map(k => (
          <label key={k} className={styles.layerRow}>
            <input type="checkbox" checked={visible[k]} onChange={() => setVisible(v => ({ ...v, [k]: !v[k] }))} />
            <span className={styles.swatch} style={{ background: LAYER_META[k].swatch }} />
            <span className={styles.layerLabel}>{LAYER_META[k].label}</span>
            <span className={styles.count}>{counts[k]}</span>
          </label>
        ))}
        <p className={styles.note}>Search and filters apply to records. Hazards are an independent context layer.</p>
        </>}
        {data && (data.counts.unmapped > 0 || data.counts.unmappedProjects > 0) && <p className={styles.note}>{data.counts.unmapped} organizations and {data.counts.unmappedProjects} projects have missing or invalid coordinates. <Link href="/companies">Review organizations</Link> · <Link href="/projects">Review projects</Link></p>}
        <p className={styles.note}>Showing events from {data?.since ?? "this year"} onward.</p>
        {data && <p className={styles.note}>Snapshot {data.generatedAt.slice(0, 16).replace("T", " ")} UTC. Record updates do not imply verification.</p>}
        {!hazards && !hazardError && <p className={styles.note}>Loading hazard context…</p>}
        {loadError && <p className={styles.error} role="alert">{loadError}</p>}
        {hazardError && <p className={styles.error} role="alert">{hazardError}</p>}
        {mapError && <p className={styles.error} role="alert">{mapError}</p>}
      </aside>

      <div className={styles.controls}>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={toggleProjection} aria-pressed={globe} title={globe ? "Flat map" : "Globe"}><Globe2 size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={toggle3d} aria-pressed={terrain3d} title="3D terrain"><Mountain size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={resetNorth} title="Reset north"><Compass size={17} /></button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => mapRef.current?.zoomIn()} title="Zoom in">+</button>
        <button type="button" className={`${styles.glass} ${styles.ctrl}`} onClick={() => mapRef.current?.zoomOut()} title="Zoom out">−</button>
      </div>

      {selected && (
        <aside className={`${styles.glass} ${styles.detail}`} aria-label="Selected item">
          <button type="button" className={styles.close} onClick={() => setSelected(null)} aria-label="Close"><X size={16} /></button>
          <Detail selected={selected} />
          <p className={styles.coords}>{coordinateLabel(selected.lngLat)}</p>
          {Boolean(selected.props.locationBasis) && <p className={styles.note}>{String(selected.props.locationBasis)}</p>}
          {Boolean(selected.props.source) && <p className={styles.note}>Source: {String(selected.props.source)}</p>}
          {Boolean(selected.props.updatedAt) && <p className={styles.note}>Record updated {String(selected.props.updatedAt).slice(0, 10)} · verification is recorded separately.</p>}
        </aside>
      )}

      <div className={`${styles.glass} ${styles.readout}`}>
        <Box size={12} aria-hidden />
        {cursor ? `${Math.abs(cursor.lat).toFixed(4)}°${cursor.lat >= 0 ? "N" : "S"}  ${Math.abs(cursor.lng).toFixed(4)}°${cursor.lng >= 0 ? "E" : "W"}` : "—"}
        <span>z {zoom.toFixed(1)}</span>
        <span>{esriKey ? "Esri World Imagery" : "NASA Blue Marble relief"}</span>
      </div>
    </div>
  );
}

function Detail({ selected }: { selected: NonNullable<Selected> }) {
  const p = selected.props as Record<string, string | number | null>;
  const coords = `${selected.lngLat[1].toFixed(3)}, ${selected.lngLat[0].toFixed(3)}`;
  if (selected.layer === "organizations") return (
    <>
      <p className={styles.kicker}>Organization</p>
      <h3>{p.name}</h3>
      <p className={styles.meta}>{[p.location, p.country].filter(Boolean).join(" · ")}</p>
      {p.sector && <p className={styles.chip}>{String(p.sector).replace(/_/g, " ")}</p>}
      {p.description && <p className={styles.read}>{p.description}</p>}
      {p.topics && <p className={styles.meta}>{String(p.topics).replace(/\|/g, " · ")}</p>}
      <Link className={styles.open} href={`/companies/${p.id}`}>Open record</Link>
      {safeWebsite(p.website) && <a className={styles.open} href={safeWebsite(p.website)!} target="_blank" rel="noreferrer">Website</a>}
    </>
  );
  if (selected.layer === "projects") return (
    <>
      <p className={styles.kicker}>Project · {String(p.stage).replace(/_/g, " ")}</p>
      <h3>{p.name}</h3>
      <p className={styles.meta}>{[p.capacity ? `${p.capacity} ${p.capacityUnit ?? ""}` : null, p.country].filter(Boolean).join(" · ")}</p>
      {p.description && <p className={styles.read}>{p.description}</p>}
      {p.areaKm2 != null && <p className={styles.meta}>Boundary: {(Number(p.areaKm2) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })} ha</p>}
      <Link className={styles.open} href={`/projects/${p.id}`}>Open project</Link>
      <SiteContext projectId={String(p.id)} />
      <div className={styles.links}>
        <Link className={styles.open} href={`/projects/${p.id}?tab=place`}>Place evidence</Link>
        <Link className={styles.open} href={`/projects/${p.id}?tab=partners`}>Partners</Link>
        <Link className={styles.open} href={`/projects/${p.id}?tab=funding`}>Funding</Link>
      </div>
    </>
  );
  if (selected.layer === "deals") return (
    <>
      <p className={styles.kicker}>Opportunity · {String(p.stage).replace(/_/g, " ")}</p>
      <h3>{p.name}</h3>
      <p className={styles.meta}>{p.orgName} · {String(p.engagement).replace(/_/g, " ")}</p>
      <Link className={styles.open} href={`/deals?focus=${p.id}`}>Open opportunity</Link>
    </>
  );
  if (selected.layer === "hazards") return (
    <>
      <p className={styles.kicker}>GDACS {p.level} alert</p>
      <h3>{String(p.title).replace(/^(Red|Orange) alert: /, "")}</h3>
      <p className={styles.meta}>{p.country} · {String(p.date).slice(0, 10)}</p>
      {p.url && <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">GDACS report</a>}
    </>
  );
  return (
    <>
      <p className={styles.kicker}>{selected.layer === "procurement" ? (p.source === "funding" ? `Funding · ${p.type} · closes` : "Tender / EOI") : `Trigger · ${p.type}`} · {p.eventDate}</p>
      <h3>{p.summary}</h3>
      <p className={styles.meta}>{p.orgName}{p.relevance != null ? ` · fit ${p.relevance}/100` : ""}{p.urgency != null ? ` · urgency ${p.urgency}/5` : ""}</p>
      {p.decisionRead && <p className={styles.read}>{p.decisionRead}</p>}
      <div className={styles.links}>
        {p.url && <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">Source</a>}
        {p.orgId && <Link className={styles.open} href={`/companies/${p.orgId}`}>Organization</Link>}
        {p.href && <Link className={styles.open} href={String(p.href)}>Open in Funding</Link>}
      </div>
      <p className={styles.coords}>{coords}</p>
    </>
  );
}
