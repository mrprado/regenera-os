"use client";

// Atlas tools (master build instruction §18–19): layer library with provenance and import, viewport-clipped layer
// loading, project boundaries, drawing and measuring, site context with Run site intelligence.
import type * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { Feature, FeatureCollection, Position } from "geojson";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import { lineLengthKm, ringAreaKm2 } from "@/lib/geo/geo";
import { createProjectAtAction, deleteLayerAction, importLayerAction, saveBoundaryAction } from "../atlas-actions";
import { runPlaybookOnProjectAction } from "../playbook-actions";
import styles from "./map.module.css";

export type LibraryLayer = { id: string; name: string; category: string; provider: string; sourceDate: string | null; retrievedAt: string; license: string; resolution: string; coverage: string; confidence: string; featureCount: number; isDemo: boolean };
const CAT_COLOR: Record<string, string> = { grid: "#f2b35a", transmission: "#f2b35a", substations: "#e59f5a", water: "#5fa8d3", watersheds: "#4a90b8", water_stress: "#3f7fb0", protected_areas: "#6fbf73", biodiversity: "#7ac47f", land_use: "#c9b27a", parcels: "#d8c79a", roads: "#bbbbbb", ports: "#9aa8b5", communities: "#d9c7f0", regulatory: "#e07a7a", project_area: "#b59a5b", solar: "#f2d25c", wind: "#9fd3e6", agriculture: "#a5c77f", climate: "#e59a3a", topography: "#a38f7a", other: "#f2f0e9" };
const CATEGORIES = Object.keys(CAT_COLOR);

function addLayerFor(map: maplibregl.Map, id: string, color: string) {
  const src = `lib-${id}`;
  if (map.getSource(src)) return;
  map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: `${src}-fill`, type: "fill", source: src, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": 0.18 } });
  map.addLayer({ id: `${src}-line`, type: "line", source: src, filter: ["in", ["geometry-type"], ["literal", ["Polygon", "LineString"]]], paint: { "line-color": color, "line-width": 1.6 } });
  map.addLayer({ id: `${src}-pt`, type: "circle", source: src, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4.5, "circle-color": color, "circle-stroke-color": "#0d1511", "circle-stroke-width": 1 } });
}
function removeLayerFor(map: maplibregl.Map, id: string) {
  const src = `lib-${id}`;
  for (const l of [`${src}-fill`, `${src}-line`, `${src}-pt`]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(src)) map.removeSource(src);
}

export function useAtlas(mapRef: React.MutableRefObject<maplibregl.Map | null>, mapReady: boolean, onSelectProject: (p: Record<string, unknown>, lngLat: [number, number]) => void) {
  const [library, setLibrary] = useState<LibraryLayer[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [draw, setDraw] = useState<"none" | "polygon" | "line">("none");
  const [points, setPoints] = useState<Position[]>([]);
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    fetch(withBase("/api/map/layers")).then(r => (r.ok ? r.json() as Promise<LibraryLayer[]> : [])).then(setLibrary).catch(() => setLibrary([]));
  }, []);

  // Project boundaries + draw sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource("areas")) return;
    map.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": "#b59a5b", "fill-opacity": 0.16 } }, "projects");
    map.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": "#b59a5b", "line-width": 2 } }, "projects");
    map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#f2d25c", "fill-opacity": 0.2 } });
    map.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": "#f2d25c", "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "draw-pt", type: "circle", source: "draw", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#f2d25c" } });
    fetch(withBase("/api/map/areas")).then(r => (r.ok ? r.json() as Promise<FeatureCollection> : null)).then((fc: FeatureCollection | null) => { if (fc) (map.getSource("areas") as GeoJSONSource).setData(fc); }).catch(() => undefined);
    map.on("click", "areas-fill", e => {
      if (drawRef.current !== "none") return;
      const f = e.features?.[0];
      if (f) onSelectProject(f.properties ?? {}, [e.lngLat.lng, e.lngLat.lat]);
    });
    map.on("click", e => { if (drawRef.current !== "none") setPoints(p => [...p, [e.lngLat.lng, e.lngLat.lat]]); });
  }, [mapReady, mapRef, onSelectProject]);

  // Drawn geometry preview.
  useEffect(() => {
    const src = mapRef.current?.getSource("draw") as GeoJSONSource | undefined;
    if (!src) return;
    const feats: Feature[] = points.map(p => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    if (points.length >= 2) feats.push(draw === "polygon" && points.length >= 3
      ? { type: "Feature", geometry: { type: "Polygon", coordinates: [[...points, points[0]]] }, properties: {} }
      : { type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
    src.setData({ type: "FeatureCollection", features: feats });
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = draw === "none" ? "" : "crosshair";
    mapRef.current?.doubleClickZoom[draw === "none" ? "enable" : "disable"]();
  }, [points, draw, mapRef]);

  // Active library layers load only the features in view, and reload on pan/zoom.
  const refresh = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(n => n.toFixed(4)).join(",");
    for (const id of active) {
      fetch(withBase(`/api/map/layers/${id}?bbox=${box}`)).then(r => (r.ok ? r.json() as Promise<FeatureCollection> : null)).then((fc: FeatureCollection | null) => {
        if (fc) (map.getSource(`lib-${id}`) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: fc.features });
      }).catch(() => undefined);
    }
  }, [active, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const l of library) {
      if (active.has(l.id)) addLayerFor(map, l.id, CAT_COLOR[l.category] ?? "#f2f0e9"); else removeLayerFor(map, l.id);
    }
    refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => { clearTimeout(timer); timer = setTimeout(refresh, 350); };
    map.on("moveend", onMove);
    return () => { map.off("moveend", onMove); clearTimeout(timer); };
  }, [active, library, mapReady, mapRef, refresh]);

  const ring = points.length >= 3 ? [...points, points[0]] : null;
  const polygon = ring ? { type: "Polygon" as const, coordinates: [ring] } : null;
  const measure = draw === "polygon" && ring ? `${(ringAreaKm2(ring) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })} ha (${ringAreaKm2(ring).toFixed(2)} km²)` : draw === "line" && points.length >= 2 ? `${lineLengthKm(points).toFixed(2)} km` : null;
  return { library, active, setActive, draw, setDraw, points, setPoints, polygon, measure };
}

export function LibraryPanel({ atlas }: { atlas: ReturnType<typeof useAtlas> }) {
  return (
    <>
      <p className={styles.note}>Imported layers carry their provider, dates, licence, resolution, coverage and confidence. Only features in view are loaded. Layers marked DEMO / SAMPLE are illustrative, not official data.</p>
      {atlas.library.length === 0 && <p className={styles.note}>No imported layers yet.</p>}
      {atlas.library.map(l => (
        <div key={l.id} className={styles.layerRow} style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={atlas.active.has(l.id)} onChange={() => atlas.setActive(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} aria-label={`Show ${l.name}`} />
          <span className={styles.swatch} style={{ background: CAT_COLOR[l.category] ?? "#f2f0e9" }} />
          <span className={styles.layerLabel}>{l.isDemo ? "DEMO / SAMPLE · " : ""}{l.name}
            <small style={{ display: "block", opacity: 0.8 }}>{[l.category.replace(/_/g, " "), l.provider || "provider not recorded", l.sourceDate && `source ${l.sourceDate}`, `retrieved ${l.retrievedAt.slice(0, 10)}`, l.license || "licence not recorded", l.resolution, l.coverage, `confidence ${l.confidence}`, `${l.featureCount} features`].filter(Boolean).join(" · ")}</small>
            <form action={deleteLayerAction} style={{ display: "inline" }}><input type="hidden" name="layerId" value={l.id} /><button type="submit" className={styles.more} style={{ padding: "0 4px" }}>Remove</button></form>
          </span>
        </div>
      ))}
      <details>
        <summary className={styles.note} style={{ cursor: "pointer" }}>Import a layer (GeoJSON, KML, CSV)</summary>
        <form action={importLayerAction} className={styles.filters} style={{ marginTop: 6 }}>
          <label>File<input type="file" name="file" accept=".geojson,.json,.kml,.csv" /></label>
          <label>Or paste GeoJSON<textarea name="geojson" rows={2} /></label>
          <label>Name<input name="name" /></label>
          <label>Category<select name="category" defaultValue="other">{CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></label>
          <label>Provider<input name="provider" placeholder="e.g. CENACE, INEGI, sponsor survey" /></label>
          <label>Source date<input name="sourceDate" type="date" /></label>
          <label>Licence<input name="license" placeholder="e.g. CC BY 4.0, internal" /></label>
          <label>Resolution<input name="resolution" /></label>
          <label>Coverage<input name="coverage" /></label>
          <label>Confidence<select name="confidence" defaultValue="unknown"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unknown">Unknown</option></select></label>
          <button type="submit" className={styles.more}>Import</button>
        </form>
        <p className={styles.note}>Shapefile (zip), KMZ and GeoTIFF: convert to GeoJSON first; direct import is pending.</p>
      </details>
    </>
  );
}

export function DrawPanel({ atlas, projects }: { atlas: ReturnType<typeof useAtlas>; projects: { id: string; name: string }[] }) {
  const json = atlas.polygon ? JSON.stringify({ type: "Feature", geometry: atlas.polygon, properties: {} }) : "";
  const download = () => {
    const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: atlas.polygon, properties: { area: atlas.measure } }] })], { type: "application/geo+json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "site.geojson"; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <div className={styles.panelTabs}>
        <button type="button" aria-pressed={atlas.draw === "polygon"} onClick={() => { atlas.setDraw(d => (d === "polygon" ? "none" : "polygon")); atlas.setPoints([]); }}>Draw site</button>
        <button type="button" aria-pressed={atlas.draw === "line"} onClick={() => { atlas.setDraw(d => (d === "line" ? "none" : "line")); atlas.setPoints([]); }}>Measure</button>
        <button type="button" disabled={!atlas.points.length} onClick={() => atlas.setPoints(p => p.slice(0, -1))}>Undo</button>
        <button type="button" disabled={!atlas.points.length} onClick={() => { atlas.setPoints([]); atlas.setDraw("none"); }}>Clear</button>
      </div>
      <p className={styles.note} role="status">{atlas.draw === "none" ? "Choose Draw site or Measure, then click on the map." : atlas.measure ? `${atlas.draw === "polygon" ? "Area" : "Length"}: ${atlas.measure}` : "Click to add points."}</p>
      {atlas.polygon && (
        <>
          <form action={saveBoundaryAction} className={styles.filters}>
            <input type="hidden" name="geometry" value={json} />
            <label>Save as the boundary of<select name="projectId" required defaultValue=""><option value="" disabled>Choose a project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button type="submit" className={styles.more}>Save boundary</button>
          </form>
          <form action={createProjectAtAction} className={styles.filters}>
            <input type="hidden" name="geometry" value={json} />
            <label>Or create a project here<input name="name" required minLength={2} placeholder="Project name" /></label>
            <button type="submit" className={styles.more}>Create project</button>
          </form>
          <button type="button" className={styles.more} onClick={download}>Export GeoJSON</button>
        </>
      )}
    </>
  );
}

type Site = { project: { id: string; name: string; lat: number | null; lng: number | null; country: string | null; subdivision: string | null }; sections: { name: string; facts: { key: string; label: string; value: string; source: string; tier: number; state: string; retrievedAt: string }[] }[] };

/** Selected site: condition and source by section; gaps say so. Run site intelligence starts the playbook. */
export function SiteContext({ projectId }: { projectId: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(withBase(`/api/map/site?projectId=${projectId}`)).then(r => (r.ok ? r.json() as Promise<Site> : Promise.reject(new Error(String(r.status))))).then(s => { if (live) setSite(s); }).catch(e => { if (live) setError(`Site context unavailable (${e.message}).`); });
    return () => { live = false; };
  }, [projectId]);
  if (error) return <p className={styles.error}>{error}</p>;
  if (!site) return <p className={styles.note}>Loading site context…</p>;
  const any = site.sections.some(s => s.facts.length);
  return (
    <div style={{ marginTop: 8 }}>
      <p className={styles.kicker}>Site intelligence</p>
      {!any && <p className={styles.note}>No place profile yet.</p>}
      {site.sections.map(s => (
        <div key={s.name} style={{ marginBottom: 6 }}>
          <p className={styles.meta} style={{ fontWeight: 600 }}>{s.name}</p>
          {s.facts.length === 0 ? <p className={styles.note}>Unknown: no sourced facts yet.</p> : s.facts.map(f => <p key={f.key} className={styles.note}>{f.label}: {f.value} <span style={{ opacity: 0.7 }}>({f.source}, tier {f.tier}, {f.retrievedAt.slice(0, 10)}{f.state === "stale" ? ", stale" : ""})</span></p>)}
        </div>
      ))}
      <form action={runPlaybookOnProjectAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="key" value="site-intelligence" /><button type="submit" className={styles.open}>Run site intelligence</button></form>
      <Link className={styles.open} href={`/projects/${projectId}?tab=systems`}>Systems</Link>
    </div>
  );
}
