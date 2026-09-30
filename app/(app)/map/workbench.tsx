"use client";

// ATLAS workbench: drawing, measurement and screening-grade geoprocessing on the live map.
// - Terrain analyses (contours, slope and elevation thresholds, cut/fill, profiles, watersheds, site hydrology,
//   viewshed, line of sight) run in the browser on decoded terrain tiles (lib/geo/dem.ts).
// - Vector and OSM analyses (nearest infrastructure, constraints, development envelope, exports) run on the server
//   (/api/spatial/*).
// - Every result keeps its datasets, parameters, grade and limitation, and is recorded as an auditable analysis run.
// - The operation history is reversible (undo, hide, save as a typed project feature).
import type * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contourLines, cutFill, delineateWatershed, demLimitation, elevationProfile, fillDepressions, flowAccumulation, flowDirection, drainageLines, lineOfSight, maskPolygons, polygonMask, slopeAspect, stats, viewshed, type DemGrid } from "@/lib/geo/dem";
import { bearingDistance, buffer, circle, destination, measure, quantities, rectangle } from "@/lib/geo/ops";
import { parseAnyCoordinate, toUtm } from "@/lib/geo/crs";
import { bboxOf } from "@/lib/geo/geo";
import { withBase } from "@/lib/base-path";
import { createProjectAtAction, saveBoundaryAction } from "../atlas-actions";
import { loadDem } from "./dem-client";
import styles from "./map.module.css";

export type WbMode = "analysis" | "design" | "compare" | "monitor";
type Tool = "none" | "point" | "line" | "polygon" | "rectangle" | "circle" | "observe";
type Grade = "SCREENING" | "PRELIMINARY" | "VALIDATED" | "ENGINEERING" | "CLIENT-PROVIDED";
export type Op = {
  id: string; title: string; kind: string; features: Feature[]; visible: boolean; grade: Grade; limitation: string;
  summary: [string, string][]; analysisId?: string; profile?: ReturnType<typeof elevationProfile>; table?: { head: string[]; rows: (string | number)[][] };
};
type Project = { id: string; name: string };

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const uid = () => Math.random().toString(36).slice(2, 10);
const f1 = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "—");
const feat = (geometry: Geometry, properties: Record<string, unknown> = {}): Feature => ({ type: "Feature", geometry, properties });

const RESULT_COLORS: [string, string][] = [["contour", "#d9b45a"], ["mask", "#7ac47f"], ["watershed", "#4a90ff"], ["drainage", "#5ad1ff"], ["ponding", "#2f6fd6"], ["viewshed", "#f2d25c"], ["envelope", "#6fbf73"], ["excluded", "#e0672f"], ["constraint", "#e07a7a"], ["nearest", "#b6633e"], ["buffer", "#b59a5b"], ["design", "#f2f0e9"], ["observation", "#ff8a4c"], ["sight", "#ffffff"], ["sketch", "#f2d25c"]];
const DESIGN_KINDS = { solar_array: "Solar array", battery_storage: "Battery storage", substation: "Substation", building: "Building", road: "Access road", transmission_route: "Transmission route", water_infrastructure: "Water infrastructure", conservation_area: "Conservation set-aside", restoration_area: "Restoration zone", buffer: "Buffer", custom: "Custom" } as const;
const DESIGN_COLORS: Record<string, string> = { solar_array: "#1f4e79", battery_storage: "#8a5cff", substation: "#f2b35a", building: "#c0c0c0", road: "#a47551", transmission_route: "#ff6a4d", water_infrastructure: "#4a90ff", conservation_area: "#2e8b57", restoration_area: "#9acd32", buffer: "#b59a5b", custom: "#f2f0e9" };
const OSM_CONSTRAINTS: { key: string; label: string; kind: "hard" | "soft"; bufferM: number }[] = [
  { key: "protected", label: "Protected areas (OSM)", kind: "hard", bufferM: 0 },
  { key: "wetland", label: "Wetlands", kind: "hard", bufferM: 30 },
  { key: "water_body", label: "Water bodies", kind: "hard", bufferM: 30 },
  { key: "watercourse", label: "Watercourses", kind: "hard", bufferM: 50 },
  { key: "settlement", label: "Settlements and buildings", kind: "hard", bufferM: 100 },
  { key: "road", label: "Roads", kind: "hard", bufferM: 15 },
  { key: "power_line", label: "Power lines (easement)", kind: "hard", bufferM: 30 },
  { key: "forest", label: "Forest / woodland", kind: "soft", bufferM: 0 },
  { key: "farmland", label: "Farmland", kind: "soft", bufferM: 0 },
];

export function useWorkbench(map: maplibregl.Map | null, projectId: string) {
  const [tool, setTool] = useState<Tool>("none");
  const [sketch, setSketch] = useState<Position[]>([]);
  const [active, setActive] = useState<Feature | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [designKind, setDesignKind] = useState<keyof typeof DESIGN_KINDS>("solar_array");
  const [cursor, setCursor] = useState<Position | null>(null);
  const [pendingObservation, setPendingObservation] = useState<Position | null>(null);
  const toolRef = useRef(tool); useEffect(() => { toolRef.current = tool; }, [tool]);
  const sketchRef = useRef(sketch); useEffect(() => { sketchRef.current = sketch; }, [sketch]);
  const designRef = useRef<string | null>(null);

  // Layers
  useEffect(() => {
    if (!map || map.getSource("wb-results")) return;
    map.addSource("wb-results", { type: "geojson", data: EMPTY });
    map.addSource("wb-active", { type: "geojson", data: EMPTY });
    map.addSource("wb-sketch", { type: "geojson", data: EMPTY });
    const color = ["coalesce", ["get", "color"], ["match", ["get", "kind"], ...RESULT_COLORS.flat(), "#f2f0e9"]] as unknown as maplibregl.ExpressionSpecification;
    map.addLayer({ id: "wb-res-fill", type: "fill", source: "wb-results", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": ["coalesce", ["get", "opacity"], 0.28] } });
    map.addLayer({ id: "wb-res-line", type: "line", source: "wb-results", filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]], paint: {
      "line-color": color, "line-width": ["case", ["==", ["get", "kind"], "contour"], ["case", ["get", "major"], 1.6, 0.7], ["==", ["get", "kind"], "drainage"], ["interpolate", ["linear"], ["coalesce", ["get", "acc"], 1], 1, 0.6, 2000, 3], 1.6] } });
    map.addLayer({ id: "wb-res-label", type: "symbol", source: "wb-results", filter: ["all", ["==", ["get", "kind"], "contour"], ["get", "major"]], layout: { "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "elevation"]], " m"], "text-font": ["Noto Sans Regular"], "text-size": 10, "symbol-spacing": 280 }, paint: { "text-color": "#f2f0e9", "text-halo-color": "rgba(3,6,8,.9)", "text-halo-width": 1.2 } });
    map.addLayer({ id: "wb-res-pt", type: "circle", source: "wb-results", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": color, "circle-stroke-color": "#05080b", "circle-stroke-width": 1.2 } });
    map.addLayer({ id: "wb-active-fill", type: "fill", source: "wb-active", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#b6633e", "fill-opacity": 0.08 } });
    map.addLayer({ id: "wb-active-line", type: "line", source: "wb-active", paint: { "line-color": "#b6633e", "line-width": 2.4 } });
    map.addLayer({ id: "wb-active-pt", type: "circle", source: "wb-active", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#b6633e", "circle-stroke-width": 2.4 } });
    map.addLayer({ id: "wb-sketch-line", type: "line", source: "wb-sketch", paint: { "line-color": "#f2d25c", "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "wb-sketch-pt", type: "circle", source: "wb-sketch", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#f2d25c" } });
  }, [map]);

  // Results → map (flatten multi-geometries so filters by geometry type work)
  useEffect(() => {
    const src = map?.getSource("wb-results") as GeoJSONSource | undefined;
    if (!src) return;
    const features: Feature[] = [];
    for (const op of ops) if (op.visible) for (const f of op.features) {
      const g = f.geometry; if (!g) continue;
      if (g.type === "MultiPolygon") g.coordinates.forEach(c => features.push(feat({ type: "Polygon", coordinates: c }, f.properties ?? {})));
      else if (g.type === "MultiLineString") g.coordinates.forEach(c => features.push(feat({ type: "LineString", coordinates: c }, f.properties ?? {})));
      else features.push(f);
    }
    src.setData({ type: "FeatureCollection", features });
  }, [ops, map]);

  useEffect(() => { (map?.getSource("wb-active") as GeoJSONSource | undefined)?.setData(active ? { type: "FeatureCollection", features: [active] } : EMPTY); }, [active, map]);

  // Sketch preview
  const previewGeometry = useCallback((pts: Position[], t: Tool, hover: Position | null): Feature[] => {
    const all = hover ? [...pts, hover] : pts;
    const out: Feature[] = pts.map(p => feat({ type: "Point", coordinates: p }));
    if (t === "rectangle" && all.length >= 2) out.push(rectangle(all[0], all[1]));
    else if (t === "circle" && all.length >= 2) out.push(circle(all[0], bearingDistance(all[0], all[1]).distanceM));
    else if (t === "polygon" && all.length >= 3) out.push(feat({ type: "LineString", coordinates: [...all, all[0]] }));
    else if (all.length >= 2) out.push(feat({ type: "LineString", coordinates: all }));
    return out;
  }, []);
  useEffect(() => { (map?.getSource("wb-sketch") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: tool === "none" ? [] : previewGeometry(sketch, tool, cursor) }); }, [sketch, tool, cursor, map, previewGeometry]);

  const finish = useCallback((pts: Position[] = sketchRef.current, t: Tool = toolRef.current) => {
    let f: Feature | null = null;
    if (t === "point" && pts.length >= 1) f = feat({ type: "Point", coordinates: pts[0] });
    else if (t === "line" && pts.length >= 2) f = feat({ type: "LineString", coordinates: pts });
    else if (t === "polygon" && pts.length >= 3) f = feat({ type: "Polygon", coordinates: [[...pts, pts[0]]] });
    else if (t === "rectangle" && pts.length >= 2) f = rectangle(pts[0], pts[1]);
    else if (t === "circle" && pts.length >= 2) f = circle(pts[0], bearingDistance(pts[0], pts[1]).distanceM);
    if (!f) return;
    if (designRef.current) {
      const kind = designRef.current;
      f.properties = { kind: "design", designKind: kind, color: DESIGN_COLORS[kind], name: DESIGN_KINDS[kind as keyof typeof DESIGN_KINDS] };
      setOps(o => [...o, { id: uid(), title: `Design: ${DESIGN_KINDS[kind as keyof typeof DESIGN_KINDS]}`, kind: "design", features: [f!], visible: true, grade: "SCREENING", limitation: "Sketched component: screening quantities only, not a layout or EPC design.", summary: Object.entries(measure(f.geometry!) as Record<string, number>).filter(([k]) => /areaHa|lengthM|perimeterM/.test(k)).map(([k, v]) => [k, f1(v)]) }]);
    } else setActive(f);
    setSketch([]);
    if (t !== "point" || designRef.current) setTool(designRef.current ? t : "none");
    else setTool("none");
  }, []);

  // Map interaction while a tool is active
  useEffect(() => {
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const t = toolRef.current; if (t === "none") return;
      const p: Position = [e.lngLat.lng, e.lngLat.lat];
      if (t === "observe") { setPendingObservation(p); setTool("none"); return; }
      const next = [...sketchRef.current, p];
      if (t === "point" || ((t === "rectangle" || t === "circle") && next.length === 2)) { finish(next, t); return; }
      setSketch(next);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => { if (toolRef.current === "line" || toolRef.current === "polygon") { e.preventDefault(); finish(); } };
    const onMove = (e: maplibregl.MapMouseEvent) => { if (toolRef.current !== "none") setCursor([e.lngLat.lng, e.lngLat.lat]); };
    const onKey = (e: KeyboardEvent) => { if (toolRef.current === "none") return; if (e.key === "Enter") finish(); if (e.key === "Backspace" && !(e.target as HTMLElement)?.closest?.("input,textarea")) setSketch(s => s.slice(0, -1)); };
    map.on("click", onClick); map.on("dblclick", onDbl); map.on("mousemove", onMove); window.addEventListener("keydown", onKey);
    map.getCanvas().style.cursor = tool === "none" ? "" : "crosshair";
    map.doubleClickZoom[tool === "line" || tool === "polygon" ? "disable" : "enable"]();
    return () => { map.off("click", onClick); map.off("dblclick", onDbl); map.off("mousemove", onMove); window.removeEventListener("keydown", onKey); };
  }, [map, tool, finish]);

  const startTool = (t: Tool, design: string | null = null) => { designRef.current = design; setSketch([]); setTool(t); setError(null); };
  const addVertex = (p: Position) => { if (tool === "none") { setActive(feat({ type: "Point", coordinates: p })); map?.flyTo({ center: p as [number, number], zoom: Math.max(map.getZoom(), 13) }); return; } setSketch(s => [...s, p]); };

  const record = useCallback(async (op: Op, params: Record<string, unknown>, datasets: { source: string; resolution: string }[], results: Record<string, unknown>, geometry?: unknown) => {
    try {
      const r = await fetch(withBase("/api/spatial/analyses"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId || null, kind: op.kind, title: op.title, params, datasets, results, limitation: op.limitation, grade: op.grade.toLowerCase().replace("-", "_"), geometry }) });
      if (r.ok) { const { id } = await r.json() as { id: string }; setOps(o => o.map(x => (x.id === op.id ? { ...x, analysisId: id } : x))); }
    } catch { /* recording failure does not remove the on-screen result */ }
  }, [projectId]);

  const push = (op: Op) => setOps(o => [...o, op]);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return { tool, startTool, sketch, setSketch, finish, active, setActive, ops, setOps, busy, error, setError, run, push, record, addVertex, designKind, setDesignKind, pendingObservation, setPendingObservation };
}
export type Workbench = ReturnType<typeof useWorkbench>;

// ---------- helpers for analyses ----------
const bboxOfFeature = (f: Feature, padFrac = 0.08): [number, number, number, number] => {
  const b = bboxOf(f.geometry!)!;
  const dx = Math.max(b[2] - b[0], 0.002) * padFrac, dy = Math.max(b[3] - b[1], 0.002) * padFrac;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
};
const aroundPoint = (p: Position, radiusKm: number): [number, number, number, number] => {
  const dLat = radiusKm / 111.32, dLng = radiusKm / (111.32 * Math.cos((p[1] * Math.PI) / 180));
  return [p[0] - dLng, p[1] - dLat, p[0] + dLng, p[1] + dLat];
};
const polygonRings = (f: Feature): Position[][] | null => (f.geometry?.type === "Polygon" ? f.geometry.coordinates : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates[0] : null);
const centroidOf = (f: Feature): Position => { const b = bboxOf(f.geometry!)!; return f.geometry!.type === "Point" ? (f.geometry as { coordinates: Position }).coordinates : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
const ds = (g: DemGrid) => [{ source: g.source, resolution: `~${Math.round(g.resolutionM)} m (terrain tiles z${g.zoom})` }];

export function WorkbenchPanel({ wb, mode, setMode, projects, projectId, setProjectId }: { wb: Workbench; mode: WbMode; setMode: (m: WbMode) => void; projects: Project[]; projectId: string; setProjectId: (id: string) => void }) {
  const [coord, setCoord] = useState("");
  const [bd, setBd] = useState("");
  const [interval, setInterval] = useState(5);
  const [maxSlope, setMaxSlope] = useState(5);
  const [elMin, setElMin] = useState("");
  const [elMax, setElMax] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [obsHeight, setObsHeight] = useState(2);
  const [targetHeight, setTargetHeight] = useState(0);
  const [bufferM, setBufferM] = useState(500);
  const [cfTarget, setCfTarget] = useState("");
  const [constraints, setConstraints] = useState(() => OSM_CONSTRAINTS.map(c => ({ ...c, on: c.kind === "hard" })));
  const [haPerMw, setHaPerMw] = useState({ low: 1.2, high: 2.0 });
  const [unitCosts, setUnitCosts] = useState<Record<string, { value: string; unit: string; source: string }>>({});
  const [scenario, setScenario] = useState("Scenario A");
  const [savePurpose, setSavePurpose] = useState("project_boundary");
  const [compare, setCompare] = useState<{ id: string; title: string; kind: string; createdAt: string; results: Record<string, unknown>; grade: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [obs, setObs] = useState({ category: "observation", note: "", mediaUrl: "", confidence: "medium" });
  const [observations, setObservations] = useState<FeatureCollection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const a = wb.active;
  const aType = a?.geometry?.type ?? null;
  const isArea = aType === "Polygon" || aType === "MultiPolygon";
  const isLine = aType === "LineString";
  const isPoint = aType === "Point";
  const m = a?.geometry ? (measure(a.geometry) as Record<string, number>) : null;
  const envelopeOp = [...wb.ops].reverse().find(o => o.kind === "developable_area");
  const nearestOp = [...wb.ops].reverse().find(o => o.kind === "nearest_infrastructure");
  const designOps = wb.ops.filter(o => o.kind === "design");
  const q = useMemo(() => quantities(designOps.flatMap(o => o.features.map(f => ({ kind: String(f.properties?.designKind ?? "custom"), geometry: f.geometry! })))), [designOps]);

  // ---- analyses ----
  const terrain = () => wb.run("Loading terrain", async () => {
    if (!a || !isArea) throw new Error("Draw or select an area first");
    const g = await loadDem(bboxOfFeature(a));
    const rings = polygonRings(a)!;
    const mask = polygonMask(g, rings);
    const { slopePct, aspect } = slopeAspect(g);
    const el = stats(g.values, mask), sl = stats(slopePct, mask);
    const inSite = Array.from(slopePct).filter((v, i) => mask[i] && Number.isFinite(v)).sort((x, y) => x - y);
    const p95 = inSite.length ? inSite[Math.floor(inSite.length * 0.95)] : NaN;
    const flat = Array.from(mask).reduce((n, v, i) => n + (v && slopePct[i] < 5 ? 1 : 0), 0);
    const south = Array.from(mask).reduce((n, v, i) => n + (v && aspect[i] >= 135 && aspect[i] <= 225 ? 1 : 0), 0);
    const cl = contourLines(g, interval, 5);
    const op: Op = { id: uid(), title: `Terrain and ${interval} m contours`, kind: "terrain", visible: true, grade: "SCREENING", limitation: `${demLimitation(g)} Contours cover the site's bounding box.`,
      features: cl.features.map(f => ({ ...f, properties: { ...f.properties, kind: "contour" } })),
      summary: [["Elevation", `${f1(el.min, 0)}–${f1(el.max, 0)} m (mean ${f1(el.mean, 0)})`], ["Slope", `mean ${f1(sl.mean)} %, 95th percentile ${f1(p95)} % (max ${f1(sl.max)} %, may include tile artefacts)`], ["Area under 5 % slope", `${f1((flat / Math.max(1, el.count)) * 100, 0)} %`], ["South-facing (135–225°)", `${f1((south / Math.max(1, el.count)) * 100, 0)} %`], ["Contour levels", `${cl.features.length} (major every ${interval * 5} m)`], ["Cells", `${g.width}×${g.height}`]] };
    wb.push(op);
    await wb.record(op, { interval, bbox: [g.west, g.south, g.east, g.north] }, ds(g), { elevation: el, slope: { ...sl, p95 }, flatSharePct: (flat / Math.max(1, el.count)) * 100, contourLevels: cl.features.length });
  });

  const threshold = () => wb.run("Filtering terrain", async () => {
    if (!a || !isArea) throw new Error("Draw or select an area first");
    const g = await loadDem(bboxOfFeature(a));
    const site = polygonMask(g, polygonRings(a)!);
    const { slopePct } = slopeAspect(g);
    const lo = elMin === "" ? -Infinity : Number(elMin), hi = elMax === "" ? Infinity : Number(elMax);
    const mask = new Uint8Array(site.length).map((_, i) => (site[i] && slopePct[i] < maxSlope && g.values[i] >= lo && g.values[i] <= hi ? 1 : 0));
    const res = maskPolygons(g, mask);
    const siteHa = (m?.areaHa ?? 0);
    const op: Op = { id: uid(), title: `Slope < ${maxSlope} %${elMin || elMax ? `, elevation ${elMin || "…"}–${elMax || "…"} m` : ""}`, kind: "slope_filter", visible: true, grade: "SCREENING", limitation: demLimitation(g),
      features: [feat(res.geometry, { kind: "mask" })], summary: [["Area meeting criteria", `${f1(res.areaHa)} ha`], ["Share of site", siteHa ? `${f1((res.areaHa / siteHa) * 100, 0)} %` : "—"]] };
    wb.push(op);
    await wb.record(op, { maxSlopePct: maxSlope, elevationMin: elMin || null, elevationMax: elMax || null }, ds(g), { areaHa: res.areaHa }, res.geometry);
  });

  const earthworks = () => wb.run("Computing cut and fill", async () => {
    if (!a || !isArea) throw new Error("Draw or select an area first");
    const g = await loadDem(bboxOfFeature(a));
    const r = cutFill(g, polygonMask(g, polygonRings(a)!), cfTarget === "" ? undefined : Number(cfTarget));
    const op: Op = { id: uid(), title: `Cut/fill to ${f1(r.targetElevation, 1)} m platform`, kind: "cut_fill", visible: false, grade: "SCREENING", limitation: `${demLimitation(g)} Level-platform screening; no swell/shrink, benching or drainage design.`, features: [], summary: [["Platform", `${f1(r.targetElevation, 1)} m`], ["Cut", `${f1(r.cutM3, 0)} m³`], ["Fill", `${f1(r.fillM3, 0)} m³`], ["Net", `${f1(r.netM3, 0)} m³`], ["Area", `${f1(r.areaHa)} ha`]] };
    wb.push(op); await wb.record(op, { targetElevation: r.targetElevation }, ds(g), r);
  });

  const profile = () => wb.run("Building profile", async () => {
    if (!a || !isLine) throw new Error("Draw or select a line first");
    const g = await loadDem(bboxOfFeature(a, 0.15));
    const p = elevationProfile(g, (a.geometry as { coordinates: Position[] }).coordinates as [number, number][], 240);
    const op: Op = { id: uid(), title: `Elevation profile (${f1(p.lengthM / 1000, 2)} km)`, kind: "profile", visible: false, grade: "SCREENING", limitation: demLimitation(g), features: [], profile: p,
      summary: [["Length", `${f1(p.lengthM / 1000, 2)} km`], ["Elevation", `${f1(p.minElevation, 0)}–${f1(p.maxElevation, 0)} m`], ["Gain / loss", `${f1(p.gainM, 0)} / ${f1(p.lossM, 0)} m`], ["Average slope", `${f1(p.averageSlopePct)} %`], ["Maximum slope", `${f1(p.maxSlopePct)} %`]] };
    wb.push(op); await wb.record(op, { line: (a.geometry as { coordinates: Position[] }).coordinates }, ds(g), { lengthM: p.lengthM, minElevation: p.minElevation, maxElevation: p.maxElevation, gainM: p.gainM, lossM: p.lossM, averageSlopePct: p.averageSlopePct, maxSlopePct: p.maxSlopePct });
  });

  const watershed = () => wb.run("Delineating watershed", async () => {
    if (!a || !isPoint) throw new Error("Place a pour point first (Point tool)");
    const p = (a.geometry as { coordinates: Position }).coordinates;
    const g = await loadDem(aroundPoint(p, radiusKm), 360);
    const w = delineateWatershed(g, p as [number, number]);
    const op: Op = { id: uid(), title: `Watershed at ${p[1].toFixed(4)}, ${p[0].toFixed(4)}`, kind: "watershed", visible: true, grade: "SCREENING",
      limitation: `${demLimitation(g)} D8 flow on a depression-filled DEM.${w.truncated ? " The catchment reaches the analysis window edge: it is TRUNCATED; enlarge the radius." : ""}`,
      features: [feat(w.geometry, { kind: "watershed" }), ...w.drainage.map(l => feat({ type: "LineString", coordinates: l }, { kind: "drainage" })), feat({ type: "Point", coordinates: w.outlet }, { kind: "nearest", name: "Snapped outlet" })],
      summary: [["Catchment area", `${f1(w.areaHa)} ha (${f1(w.areaHa / 100, 2)} km²)`], ["Elevation range", `${f1(w.elevation.min, 0)}–${f1(w.elevation.max, 0)} m`], ["Window", `${radiusKm} km radius`], ["Complete", w.truncated ? "No: truncated at window edge" : "Yes, within window"]] };
    wb.push(op); await wb.record(op, { pourPoint: p, radiusKm }, ds(g), { areaHa: w.areaHa, elevation: w.elevation, truncated: w.truncated, outlet: w.outlet }, w.geometry);
  });

  const siteHydrology = () => wb.run("Running site hydrology", async () => {
    if (!a || !isArea) throw new Error("Draw or select an area first");
    const g = await loadDem(bboxOfFeature(a, 0.3), 320);
    const site = polygonMask(g, polygonRings(a)!);
    const filled = fillDepressions(g, 0); const dir = flowDirection(g, filled); const acc = flowAccumulation(g, filled, dir);
    const ponding = new Uint8Array(site.length).map((_, i) => (site[i] && filled[i] - g.values[i] > 0.3 ? 1 : 0));
    const pond = maskPolygons(g, ponding, 1);
    const threshold = Math.max(25, Math.round(g.width * g.height * 0.002));
    const lines = drainageLines(g, dir, acc, threshold).filter((_, i) => i < 3000);
    const upstreamIn = (() => { let n = 0; for (let i = 0; i < site.length; i++) if (!site[i] && acc[i] > threshold) n++; return n; })();
    const op: Op = { id: uid(), title: "Site hydrology (drainage and ponding)", kind: "hydrology", visible: true, grade: "SCREENING", limitation: `${demLimitation(g)} Screening only: no rainfall-runoff model, soils or culverts. Commission a hydrological study before design.`,
      features: [...lines.map(l => feat({ type: "LineString", coordinates: l }, { kind: "drainage" })), feat(pond.geometry, { kind: "ponding", opacity: 0.45 })],
      summary: [["Potential ponding (depressions > 0.3 m)", `${f1(pond.areaHa, 2)} ha`], ["Drainage lines shown", `${lines.length} segments (≥ ${threshold} upstream cells)`], ["Channelised flow outside the site", upstreamIn > 0 ? "Yes: upstream dependencies exist" : "Not detected at this resolution"]] };
    wb.push(op); await wb.record(op, { accumulationThreshold: threshold }, ds(g), { pondingHa: pond.areaHa, drainageSegments: lines.length });
  });

  const visibility = () => wb.run("Computing viewshed", async () => {
    if (!a || !isPoint) throw new Error("Place an observer first (Point tool)");
    const p = (a.geometry as { coordinates: Position }).coordinates;
    const g = await loadDem(aroundPoint(p, radiusKm), 300);
    const v = viewshed(g, p as [number, number], obsHeight, targetHeight);
    const op: Op = { id: uid(), title: `Viewshed (${obsHeight} m observer, ${radiusKm} km)`, kind: "viewshed", visible: true, grade: "SCREENING", limitation: `${demLimitation(g)} Bare earth: vegetation and buildings are not modelled; no earth curvature or refraction correction.`,
      features: [feat(v.geometry, { kind: "viewshed" })], summary: [["Visible area", `${f1(v.areaHa)} ha`], ["Observer ground", `${f1(v.observerElevation, 0)} m`], ["Target height", `${targetHeight} m`]] };
    wb.push(op); await wb.record(op, { observer: p, observerHeightM: obsHeight, targetHeightM: targetHeight, radiusKm }, ds(g), { visibleHa: v.areaHa }, v.geometry);
  });

  const sight = () => wb.run("Checking line of sight", async () => {
    if (!a || !isLine) throw new Error("Draw a two-point line first");
    const c = (a.geometry as { coordinates: Position[] }).coordinates; const A = c[0] as [number, number], B = c[c.length - 1] as [number, number];
    const g = await loadDem(bboxOfFeature(a, 0.2));
    const r = lineOfSight(g, A, B, obsHeight, targetHeight);
    const op: Op = { id: uid(), title: `Line of sight: ${r.visible ? "clear" : "blocked"}`, kind: "line_of_sight", visible: true, grade: "SCREENING", limitation: `${demLimitation(g)} Bare earth only.`,
      features: [feat({ type: "LineString", coordinates: [A, B] }, { kind: "sight", color: r.visible ? "#9dff8a" : "#ff6a4d" }), ...(r.blockedAt ? [feat({ type: "Point", coordinates: r.blockedAt }, { kind: "excluded", name: "Blocked" })] : [])],
      summary: [["Result", r.visible ? "Clear" : `Blocked ${f1((r.blockedDistanceM ?? 0) / 1000, 2)} km from A`], ["Heights", `A ${obsHeight} m, B ${targetHeight} m`], ["Distance", `${f1(bearingDistance(A, B).distanceM / 1000, 2)} km`]] };
    wb.push(op); await wb.record(op, { a: A, b: B, heightA: obsHeight, heightB: targetHeight }, ds(g), r);
  });

  const nearestInfra = () => wb.run("Finding nearest infrastructure", async () => {
    if (!a) throw new Error("Draw or select a site or point first");
    const p = centroidOf(a);
    const r = await fetch(withBase("/api/spatial/nearest"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lng: p[0], lat: p[1], projectId: projectId || null }) });
    const d = await r.json() as { items?: { key: string; label: string; status: string; distanceM: number | null; name: string | null; detail: string | null; at: Position | null; searchedRadiusM: number }[]; source?: string; analysisId?: string; error?: string };
    if (!r.ok || !d.items) throw new Error(d.error ?? "Nearest infrastructure unavailable");
    wb.push({ id: uid(), title: "Nearest infrastructure", kind: "nearest_infrastructure", visible: true, grade: "PRELIMINARY", analysisId: d.analysisId, limitation: `${d.source}. Grid capacity is never inferred: status KNOWN means mapped in OSM, UNKNOWN means none mapped within the search radius.`,
      features: d.items.filter(i => i.at).flatMap(i => [feat({ type: "Point", coordinates: i.at! }, { kind: "nearest", name: i.label }), feat({ type: "LineString", coordinates: [p, i.at!] }, { kind: "nearest", opacity: 0.4 })]),
      summary: [], table: { head: ["Infrastructure", "Distance", "Name / detail", "Status"], rows: d.items.map(i => [i.label, i.distanceM != null ? `${f1(i.distanceM / 1000, 1)} km` : `none within ${i.searchedRadiusM / 1000} km`, [i.name, i.detail].filter(Boolean).join(" · ") || "—", i.status === "known" ? "KNOWN (mapped)" : "UNKNOWN"]) } });
  });

  const envelope = () => wb.run("Screening constraints", async () => {
    if (!a || !isArea) throw new Error("Draw or select an area first");
    const custom = wb.ops.filter(o => o.kind === "design" && /conservation_area|buffer|custom/.test(String(o.features[0]?.properties?.designKind))).map(o => ({ label: o.title, kind: "hard", geometry: o.features[0].geometry, bufferM: 0 }));
    const r = await fetch(withBase("/api/spatial/developable-area"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: a.geometry, projectId: projectId || null, constraints: constraints.filter(c => c.on).map(c => ({ key: c.key, kind: c.kind, bufferM: c.bufferM })), custom }) });
    const d = await r.json() as { siteHa: number; hardExcludedHa: number; softHa: number; netHa: number; envelope: Feature | null; soft: Feature | null; byConstraint: { label: string; kind: string; overlapHa: number }[]; analysisId?: string; error?: string };
    if (!r.ok) throw new Error(d.error ?? "Constraint screening unavailable");
    wb.push({ id: uid(), title: `Development envelope: ${f1(d.netHa)} ha net`, kind: "developable_area", visible: true, grade: "SCREENING", analysisId: d.analysisId,
      limitation: "SCREENING: OSM constraints are community-mapped, not legal boundaries; buffers are your assumptions. Confirm with title, survey and regulatory review.",
      features: [...(d.envelope ? [{ ...d.envelope, properties: { kind: "envelope" } }] : []), ...(d.soft ? [{ ...d.soft, properties: { kind: "constraint", opacity: 0.35 } }] : [])],
      summary: [["Total site", `${f1(d.siteHa)} ha`], ["Hard exclusions", `− ${f1(d.hardExcludedHa)} ha`], ["Net developable", `${f1(d.netHa)} ha`], ["Soft constraints inside envelope", `${f1(d.softHa)} ha`]],
      table: { head: ["Constraint", "Type", "Overlap"], rows: d.byConstraint.map(c => [c.label, c.kind.toUpperCase(), `${f1(c.overlapHa, 2)} ha`]) } });
  });

  const makeBuffer = () => { if (!a?.geometry) return; const b = buffer(a.geometry, bufferM); if (!b) return; wb.push({ id: uid(), title: `Buffer ${bufferM} m`, kind: "buffer", visible: true, grade: "SCREENING", limitation: "Geodesic buffer (WGS84).", features: [{ ...b, properties: { kind: "buffer" } }], summary: [["Area", `${f1((measure(b.geometry) as { areaHa: number }).areaHa)} ha`]] }); };

  const exportOps = async (format: string, list = wb.ops.filter(o => o.visible && o.features.length)) => {
    const features = list.flatMap(o => o.features.map(f => ({ ...f, properties: { ...(f.properties ?? {}), analysis: o.title, grade: o.grade } })));
    if (!features.length) { wb.setError("Nothing to export: run an analysis or draw something first"); return; }
    const r = await fetch(withBase("/api/spatial/export"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format, featureCollection: { type: "FeatureCollection", features }, title: list.length === 1 ? list[0].title : "Regenera ATLAS workbench", source: [...new Set(list.map(o => o.limitation.split(".")[0]))].join(" | ").slice(0, 390), grade: [...new Set(list.map(o => o.grade))].join("/") }) });
    if (!r.ok) { wb.setError((await r.json().catch(() => ({ error: "Export failed" })) as { error: string }).error); return; }
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const el = document.createElement("a"); el.href = url; el.download = (r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]) ?? `export.${format}`; el.click(); URL.revokeObjectURL(url);
  };

  const saveFeature = async (geometry: Geometry, purpose: string, name: string, analysisId?: string, sc?: string) => {
    const r = await fetch(withBase("/api/spatial/features"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId || null, purpose, name, geometry, sourceAnalysisId: analysisId ?? null, scenario: sc ?? "" }) });
    const d = await r.json() as { id?: string; error?: string };
    setNotice(r.ok ? `Saved as ${purpose.replace(/_/g, " ")}${projectId ? " on the project" : ""}.` : d.error ?? "Save failed");
  };

  const loadCompare = async () => {
    const r = await fetch(withBase(`/api/spatial/analyses${projectId ? `?projectId=${projectId}` : ""}`));
    setCompare(r.ok ? await r.json() : []);
  };
  const loadObservations = async () => {
    const r = await fetch(withBase(`/api/spatial/observations${projectId ? `?projectId=${projectId}` : ""}`));
    if (r.ok) { const fc = await r.json() as FeatureCollection; setObservations(fc); wb.setOps(o => [...o.filter(x => x.kind !== "observations"), { id: "observations", title: `Field observations (${fc.features.length})`, kind: "observations", visible: true, grade: "PRELIMINARY", limitation: "Field observations as recorded by the observer.", features: fc.features.map(f => ({ ...f, properties: { ...f.properties, kind: "observation" } })), summary: [] }]); }
  };
  const saveObservation = async () => {
    const p = wb.pendingObservation; if (!p) return;
    const r = await fetch(withBase("/api/spatial/observations"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId || null, lng: p[0], lat: p[1], category: obs.category, note: obs.note, mediaUrl: obs.mediaUrl || null, confidence: obs.confidence }) });
    const d = await r.json() as { error?: string };
    if (!r.ok) { wb.setError(d.error ?? "Observation not saved"); return; }
    wb.setPendingObservation(null); setObs({ category: "observation", note: "", mediaUrl: "", confidence: "medium" }); await loadObservations();
  };
  const convert = async (id: string, to: "task" | "risk") => {
    const r = await fetch(withBase("/api/spatial/observations-convert"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, to }) });
    const d = await r.json() as { ref?: string; error?: string };
    setNotice(r.ok ? `Created ${d.ref?.split(":")[0]} from the observation.` : d.error ?? "Conversion failed"); await loadObservations();
  };

  const toolBtn = (t: Tool, label: string, design: string | null = null) => <button type="button" aria-pressed={wb.tool === t} onClick={() => (wb.tool === t ? wb.startTool("none") : wb.startTool(t, design))}>{label}</button>;
  const geomJson = a?.geometry && isArea ? JSON.stringify({ type: "Feature", geometry: a.geometry, properties: {} }) : "";
  const netHa = envelopeOp ? Number(envelopeOp.summary.find(s => s[0] === "Net developable")?.[1].replace(/[^0-9.]/g, "")) : m?.areaHa;
  const gridKm = nearestOp?.table?.rows.find(r => r[0] === "Substation")?.[1];

  return (
    <div className={styles.wb}>
      <div className={styles.panelTabs} role="tablist" aria-label="Workbench mode">
        {(["analysis", "design", "compare", "monitor"] as const).map(k => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{k === "analysis" ? "Site analysis" : k[0].toUpperCase() + k.slice(1)}</button>)}
      </div>
      <label className={styles.wbField}>Project context<select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">None (analysis only)</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>

      {(mode === "analysis" || mode === "design") && <>
        <p className={styles.panelTitle}>Draw</p>
        <div className={styles.wbTools}>
          {toolBtn("point", "Point")}{toolBtn("line", "Line")}{toolBtn("polygon", "Polygon")}{toolBtn("rectangle", "Rectangle")}{toolBtn("circle", "Circle")}
          {wb.tool !== "none" && <><button type="button" onClick={() => wb.finish()}>Finish</button><button type="button" disabled={!wb.sketch.length} onClick={() => wb.setSketch(s => s.slice(0, -1))}>Undo point</button><button type="button" onClick={() => wb.startTool("none")}>Cancel</button></>}
        </div>
        <p className={styles.note}>{wb.tool === "none" ? "Choose a tool. Lines and polygons: click vertices, double-click or Enter to finish, Backspace removes the last vertex." : wb.tool === "rectangle" || wb.tool === "circle" ? "Click two points (corner to corner, or centre then edge)." : `Drawing ${wb.tool}: ${wb.sketch.length} point(s).`}</p>
        <form className={styles.wbInline} onSubmit={e => { e.preventDefault(); const p = parseAnyCoordinate(coord); if (!p) { wb.setError("Coordinate not recognised (decimal, DMS or UTM like 14N 486000 2148000)"); return; } wb.addVertex(p); setCoord(""); }}>
          <input value={coord} onChange={e => setCoord(e.target.value)} placeholder="Lat, lng · DMS · UTM" aria-label="Coordinate entry" /><button type="submit">Add</button>
        </form>
        <form className={styles.wbInline} onSubmit={e => { e.preventDefault(); const [b, dst] = bd.split(/[\s,]+/).map(Number); const last = wb.sketch[wb.sketch.length - 1]; if (!last || !Number.isFinite(b) || !(dst > 0)) { wb.setError("Start a line or polygon, then enter bearing (°) and distance (m)"); return; } wb.setSketch(s => [...s, destination(last, b, dst)]); setBd(""); }}>
          <input value={bd} onChange={e => setBd(e.target.value)} placeholder="Bearing° distance m (from last vertex)" aria-label="Bearing and distance" /><button type="submit">Add</button>
        </form>
      </>}

      {a && m && (mode === "analysis" || mode === "design") && (
        <div className={styles.wbCard}>
          <p className={styles.kicker}>Active {aType?.replace("MultiPolygon", "area").replace("Polygon", "area").toLowerCase()}</p>
          <dl className={styles.facts}>
            {m.areaHa !== undefined && <><div><dt>Area</dt><dd>{f1(m.areaHa, 2)} ha · {f1(m.areaAcres, 1)} ac · {f1(m.areaKm2, 3)} km²</dd></div><div><dt>Perimeter</dt><dd>{f1(m.perimeterM / 1000, 3)} km</dd></div></>}
            {m.lengthM !== undefined && <div><dt>Length</dt><dd>{f1(m.lengthM / 1000, 3)} km · {f1(m.lengthMi, 3)} mi</dd></div>}
            {isLine && (a.geometry as { coordinates: Position[] }).coordinates.length === 2 && (() => { const c = (a.geometry as { coordinates: Position[] }).coordinates; const r = bearingDistance(c[0], c[1]); return <div><dt>Bearing</dt><dd>{f1(r.bearing, 1)}°</dd></div>; })()}
            {isPoint && (() => { const p = (a.geometry as { coordinates: Position }).coordinates; const u = toUtm(p[0], p[1]); return <><div><dt>WGS84</dt><dd>{p[1].toFixed(6)}, {p[0].toFixed(6)}</dd></div><div><dt>UTM</dt><dd>{u.label}</dd></div></>; })()}
          </dl>
          <div className={styles.wbInline}>
            <select value={savePurpose} onChange={e => setSavePurpose(e.target.value)} aria-label="Save as">{["project_boundary", "parcel", "development_envelope", "conservation_area", "solar_array", "building", "road", "transmission_route", "pipeline", "water_infrastructure", "restoration_area", "survey_area", "exclusion_zone", "custom"].map(p => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}</select>
            <button type="button" onClick={() => void saveFeature(a.geometry!, savePurpose, savePurpose.replace(/_/g, " "))}>Save</button>
            <button type="button" onClick={() => wb.setActive(null)}>Clear</button>
          </div>
          {isArea && <div className={styles.wbInline}>
            {projectId && <form action={saveBoundaryAction}><input type="hidden" name="geometry" value={geomJson} /><input type="hidden" name="projectId" value={projectId} /><button type="submit">Set as project boundary</button></form>}
            <form action={createProjectAtAction} className={styles.wbInline}><input type="hidden" name="geometry" value={geomJson} /><input name="name" required minLength={2} placeholder="New project name" aria-label="New project name" /><button type="submit">Create project</button></form>
          </div>}
        </div>
      )}

      {mode === "analysis" && <>
        <p className={styles.panelTitle}>Analyze</p>
        <details className={styles.wbGroup} open={isArea}><summary>Terrain {isArea ? "" : "· needs an area"}</summary>
          <label className={styles.wbField}>Contour interval<select value={interval} onChange={e => setInterval(Number(e.target.value))}>{[0.5, 1, 2, 5, 10, 20, 50].map(v => <option key={v} value={v}>{v} m</option>)}</select></label>
          <p className={styles.note}>Source DEM is ~30 m (SRTM class): intervals below ~5 m show interpolation, not surveyed detail.</p>
          <button type="button" className={styles.more} disabled={!isArea || !!wb.busy} onClick={terrain}>Terrain summary + contours</button>
          <div className={styles.wbInline}><label>Slope &lt;<input type="number" value={maxSlope} min={0} max={100} step={0.5} onChange={e => setMaxSlope(Number(e.target.value))} /> %</label><label>Elev.<input value={elMin} onChange={e => setElMin(e.target.value)} placeholder="min" /></label><label><input value={elMax} onChange={e => setElMax(e.target.value)} placeholder="max" /> m</label></div>
          <button type="button" className={styles.more} disabled={!isArea || !!wb.busy} onClick={threshold}>Find land meeting criteria</button>
          <div className={styles.wbInline}><label>Platform<input value={cfTarget} onChange={e => setCfTarget(e.target.value)} placeholder="mean" /> m</label><button type="button" className={styles.more} disabled={!isArea || !!wb.busy} onClick={earthworks}>Cut / fill</button></div>
        </details>
        <details className={styles.wbGroup}><summary>Profile and visibility</summary>
          <button type="button" className={styles.more} disabled={!isLine || !!wb.busy} onClick={profile}>Elevation profile {isLine ? "" : "(draw a line)"}</button>
          <div className={styles.wbInline}><label>Observer<input type="number" value={obsHeight} min={0} max={300} onChange={e => setObsHeight(Number(e.target.value))} /> m</label><label>Target<input type="number" value={targetHeight} min={0} max={300} onChange={e => setTargetHeight(Number(e.target.value))} /> m</label><label>Radius<select value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))}>{[1, 2, 5, 10, 20].map(v => <option key={v} value={v}>{v} km</option>)}</select></label></div>
          <button type="button" className={styles.more} disabled={!isPoint || !!wb.busy} onClick={visibility}>Viewshed {isPoint ? "" : "(place a point)"}</button>
          <button type="button" className={styles.more} disabled={!isLine || !!wb.busy} onClick={sight}>Line of sight (line A→B)</button>
        </details>
        <details className={styles.wbGroup}><summary>Hydrology</summary>
          <button type="button" className={styles.more} disabled={!isPoint || !!wb.busy} onClick={watershed}>Delineate watershed from point</button>
          <button type="button" className={styles.more} disabled={!isArea || !!wb.busy} onClick={siteHydrology}>Run site hydrology</button>
          <p className={styles.note}>Water balance, flood depth and recharge need climate and soil data that is not connected yet (planned).</p>
        </details>
        <details className={styles.wbGroup}><summary>Constraints and developable area</summary>
          {constraints.map((c, i) => (
            <div key={c.key} className={styles.wbConstraint}>
              <input type="checkbox" checked={c.on} onChange={() => setConstraints(cs => cs.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} aria-label={c.label} />
              <span>{c.label}</span>
              <select value={c.kind} onChange={e => setConstraints(cs => cs.map((x, j) => (j === i ? { ...x, kind: e.target.value as "hard" | "soft" } : x)))} aria-label={`${c.label} type`}><option value="hard">hard</option><option value="soft">soft</option></select>
              <input type="number" min={0} max={5000} value={c.bufferM} onChange={e => setConstraints(cs => cs.map((x, j) => (j === i ? { ...x, bufferM: Number(e.target.value) } : x)))} aria-label={`${c.label} buffer (m)`} /><small>m</small>
            </div>
          ))}
          <p className={styles.note}>Design objects of type Conservation, Buffer or Custom are subtracted as hard exclusions. Buffers are your assumptions.</p>
          <button type="button" className={styles.more} disabled={!isArea || !!wb.busy} onClick={envelope}>Compute development envelope</button>
          <div className={styles.wbInline}><label>Buffer<input type="number" value={bufferM} min={1} max={100000} onChange={e => setBufferM(Number(e.target.value))} /> m</label><button type="button" className={styles.more} disabled={!a} onClick={makeBuffer}>Buffer active</button></div>
        </details>
        <details className={styles.wbGroup}><summary>Infrastructure and solar screening</summary>
          <button type="button" className={styles.more} disabled={!a || !!wb.busy} onClick={nearestInfra}>Nearest infrastructure</button>
          <p className={styles.note}>Solar capacity range from the net area. Land-use density is your assumption: edit it to your layout or technology.</p>
          <div className={styles.wbInline}><label>ha/MWp<input type="number" step={0.1} min={0.3} value={haPerMw.low} onChange={e => setHaPerMw(h => ({ ...h, low: Number(e.target.value) }))} /></label><label>to<input type="number" step={0.1} min={0.3} value={haPerMw.high} onChange={e => setHaPerMw(h => ({ ...h, high: Number(e.target.value) }))} /></label></div>
          {netHa ? <p className={styles.note}><b>{f1(netHa / haPerMw.high, 0)}–{f1(netHa / haPerMw.low, 0)} MWp</b> on {f1(netHa)} ha {envelopeOp ? "net developable" : "(whole site: run the envelope first)"}{gridKm ? ` · substation ${gridKm}` : ""}. SCREENING: assumption {haPerMw.low}–{haPerMw.high} ha/MWp, not a layout.</p> : <p className={styles.note}>Draw a site to estimate.</p>}
          <p className={styles.note}>Wind and hydro screening: PLANNED (needs wind and flow resource data).</p>
        </details>
        <details className={styles.wbGroup}><summary>Field observation</summary>
          <button type="button" className={styles.more} onClick={() => wb.startTool("observe")}>{wb.tool === "observe" ? "Click the map…" : "Place observation"}</button>
          {wb.pendingObservation && <form className={styles.filters} onSubmit={e => { e.preventDefault(); void saveObservation(); }}>
            <p className={styles.note}>{wb.pendingObservation[1].toFixed(5)}, {wb.pendingObservation[0].toFixed(5)}</p>
            <label>Category<select value={obs.category} onChange={e => setObs(o => ({ ...o, category: e.target.value }))}>{["observation", "issue", "access", "water", "vegetation", "soil", "infrastructure", "community", "hazard", "sample", "photo_point", "other"].map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></label>
            <label>Note<textarea rows={2} value={obs.note} onChange={e => setObs(o => ({ ...o, note: e.target.value }))} required minLength={2} /></label>
            <label>Photo / media link<input value={obs.mediaUrl} onChange={e => setObs(o => ({ ...o, mediaUrl: e.target.value }))} placeholder="https://… (Drive, data room)" /></label>
            <label>Confidence<select value={obs.confidence} onChange={e => setObs(o => ({ ...o, confidence: e.target.value }))}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <button type="submit" className={styles.more}>Save observation</button>
          </form>}
        </details>
      </>}

      {mode === "design" && <>
        <p className={styles.panelTitle}>Design objects</p>
        <label className={styles.wbField}>Scenario<input value={scenario} onChange={e => setScenario(e.target.value)} /></label>
        <div className={styles.wbInline}>
          <select value={wb.designKind} onChange={e => wb.setDesignKind(e.target.value as keyof typeof DESIGN_KINDS)} aria-label="Component">{Object.entries(DESIGN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button type="button" onClick={() => wb.startTool(/road|transmission/.test(wb.designKind) ? "line" : wb.designKind === "substation" ? "rectangle" : "polygon", wb.designKind)}>Draw</button>
        </div>
        {Object.keys(q).length === 0 ? <p className={styles.note}>Sketch components to get screening quantities.</p> : (
          <table className={styles.wbTable}><thead><tr><th>Component</th><th>Qty</th><th>Area / length</th><th>Unit cost</th><th>Cost</th></tr></thead>
            <tbody>{Object.entries(q).map(([k, v]) => {
              const linear = /road|transmission/.test(k); const qty = linear ? v.lengthM / 1000 : v.areaHa; const u = unitCosts[k];
              const cost = u && u.value !== "" && Number.isFinite(Number(u.value)) ? Number(u.value) * qty : null;
              return <tr key={k}><td>{DESIGN_KINDS[k as keyof typeof DESIGN_KINDS] ?? k}</td><td>{v.count}</td><td>{linear ? `${f1(qty, 2)} km` : `${f1(qty, 2)} ha`}{k === "solar_array" ? ` · fence ${f1(v.perimeterM / 1000, 2)} km` : ""}</td>
                <td><input className={styles.wbCost} value={u?.value ?? ""} onChange={e => setUnitCosts(c => ({ ...c, [k]: { value: e.target.value, unit: linear ? "per km" : "per ha", source: c[k]?.source ?? "" } }))} placeholder={linear ? "/km" : "/ha"} aria-label={`${k} unit cost`} />
                  <input className={styles.wbCost} value={u?.source ?? ""} onChange={e => setUnitCosts(c => ({ ...c, [k]: { value: c[k]?.value ?? "", unit: linear ? "per km" : "per ha", source: e.target.value } }))} placeholder="source" aria-label={`${k} cost source`} /></td>
                <td>{cost != null ? f1(cost, 0) : "—"}</td></tr>;
            })}</tbody></table>
        )}
        <p className={styles.note}>Unit costs are your inputs with their source; nothing is pre-filled. Quantities are screening only.</p>
        <button type="button" className={styles.more} disabled={!designOps.length} onClick={() => designOps.forEach(o => o.features.forEach(f => void saveFeature(f.geometry!, String(f.properties?.designKind === "solar_array" ? "solar_array" : f.properties?.designKind ?? "custom"), String(f.properties?.name ?? "Design object"), undefined, scenario)))}>Save design to project ({scenario})</button>
      </>}

      {mode === "compare" && <>
        <p className={styles.panelTitle}>Compare saved analyses</p>
        <button type="button" className={styles.more} onClick={loadCompare}>Load analyses{projectId ? " for this project" : ""}</button>
        {compare && (compare.length === 0 ? <p className={styles.note}>No saved analyses yet.</p> : <>
          {compare.slice(0, 40).map(c => <label key={c.id} className={styles.wbConstraint}><input type="checkbox" checked={picked.has(c.id)} disabled={!picked.has(c.id) && picked.size >= 10} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} /><span>{c.title}<small> · {c.createdAt.slice(0, 16).replace("T", " ")}</small></span></label>)}
          {picked.size >= 2 && (() => {
            const rows = compare.filter(c => picked.has(c.id));
            const keys = [...new Set(rows.flatMap(r => Object.entries(r.results).filter(([, v]) => typeof v === "number").map(([k]) => k)))];
            return <table className={styles.wbTable}><thead><tr><th>Metric</th>{rows.map(r => <th key={r.id}>{r.title.slice(0, 28)}</th>)}</tr></thead><tbody>{keys.map(k => <tr key={k}><td>{k}</td>{rows.map(r => <td key={r.id}>{typeof r.results[k] === "number" ? f1(r.results[k] as number, 2) : "—"}</td>)}</tr>)}</tbody></table>;
          })()}
        </>)}
        <p className={styles.note}>Imagery swipe between years needs the satellite archive integration (PLANNED); use the imagery date slider in Layers meanwhile.</p>
      </>}

      {mode === "monitor" && <>
        <p className={styles.panelTitle}>Monitoring</p>
        <p className={styles.note}>Draw the monitoring boundary as an area and save it as &quot;survey area&quot;. Satellite change detection (clearing, recovery, water, construction) requires AlphaEarth / Earth Engine: NOT CONNECTED (credential required, see Settings → Integrations).</p>
        <button type="button" className={styles.more} onClick={loadObservations}>Show field observations</button>
        {observations && observations.features.slice(0, 50).map(f => { const p = f.properties as { id: string; category: string; note: string; observer: string; observedAt: string; convertedTo: string | null; mediaUrl: string | null }; return (
          <div key={p.id} className={styles.wbCard}><p className={styles.kicker}>{p.category.replace(/_/g, " ")} · {p.observedAt.slice(0, 10)} · {p.observer}</p><p className={styles.note}>{p.note}{p.mediaUrl ? <> · <a href={p.mediaUrl} target="_blank" rel="noreferrer">media</a></> : null}</p>
            {p.convertedTo ? <p className={styles.note}>Converted to {p.convertedTo.split(":")[0]}</p> : <div className={styles.wbInline}><button type="button" onClick={() => void convert(p.id, "task")}>Create task</button><button type="button" disabled={!projectId} onClick={() => void convert(p.id, "risk")}>Create risk</button></div>}</div>
        ); })}
      </>}

      {wb.busy && <p className={styles.note} role="status">● {wb.busy}…</p>}
      {wb.error && <p className={styles.error} role="alert">{wb.error}</p>}
      {notice && <p className={styles.note} role="status">{notice}</p>}

      <p className={styles.panelTitle}>Operation history</p>
      {wb.ops.length === 0 ? <p className={styles.note}>Each analysis appears here with its grade, datasets and limitation. Results are recorded for audit.</p> : (
        <ol className={styles.wbHistory}>
          {wb.ops.map((o, i) => (
            <li key={o.id}>
              <div className={styles.wbHistHead}>
                <span>{i + 1}. {o.title}</span>
                <span className={styles.grade} data-grade={o.grade}>{o.grade}</span>
              </div>
              {o.summary.length > 0 && <dl className={styles.facts}>{o.summary.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
              {o.table && <table className={styles.wbTable}><thead><tr>{o.table.head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{o.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>}
              <p className={styles.caveat}>{o.limitation}</p>
              <div className={styles.wbInline}>
                {o.features.length > 0 && <button type="button" onClick={() => wb.setOps(ops => ops.map(x => (x.id === o.id ? { ...x, visible: !x.visible } : x)))}>{o.visible ? "Hide" : "Show"}</button>}
                {o.features.some(f => /Polygon/.test(f.geometry?.type ?? "")) && <button type="button" onClick={() => { const f = o.features.find(ff => /Polygon/.test(ff.geometry?.type ?? "")); if (f) wb.setActive({ ...f, properties: {} }); }}>Use as active</button>}
                {o.features.some(f => /Polygon/.test(f.geometry?.type ?? "")) && <button type="button" onClick={() => { const f = o.features.find(ff => /Polygon/.test(ff.geometry?.type ?? "")); if (f) void saveFeature(f.geometry!, o.kind === "developable_area" ? "development_envelope" : o.kind === "watershed" ? "survey_area" : "custom", o.title, o.analysisId); }}>Save</button>}
                {o.features.length > 0 && <button type="button" onClick={() => void exportOps("geojson", [o])}>GeoJSON</button>}
                {o.kind === "terrain" && <button type="button" onClick={() => void exportOps("dxf-utm", [o])}>DXF (UTM)</button>}
                {o.profile && <button type="button" onClick={() => { const csv = ["distance_m,elevation_m,lat,lng", ...o.profile!.points.map(p => `${p.distanceM.toFixed(1)},${p.elevation.toFixed(1)},${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)].join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const el = document.createElement("a"); el.href = url; el.download = "profile.csv"; el.click(); URL.revokeObjectURL(url); }}>Profile CSV</button>}
                {o.analysisId && <small className={styles.note}>recorded</small>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {wb.ops.length > 0 && <div className={styles.wbInline}>
        <button type="button" onClick={() => wb.setOps(o => o.slice(0, -1))}>Undo last</button>
        <button type="button" onClick={() => wb.setOps([])}>Clear all</button>
        <select defaultValue="" onChange={e => { if (e.target.value) void exportOps(e.target.value); e.target.value = ""; }} aria-label="Export visible results"><option value="">Export visible…</option><option value="geojson">GeoJSON</option><option value="kml">KML</option><option value="csv">CSV</option><option value="dxf">DXF (WGS84)</option><option value="dxf-utm">DXF (UTM metres)</option></select>
      </div>}
    </div>
  );
}

/** Bottom analysis tray: the latest elevation profile as a chart (map stays visible above). */
export function AnalysisTray({ wb, map }: { wb: Workbench; map: maplibregl.Map | null }) {
  const op = [...wb.ops].reverse().find(o => o.profile);
  const [hover, setHover] = useState<number | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    if (!map || !op?.profile || hover === null) return;
    const p = op.profile.points[hover];
    (map.getSource("wb-sketch") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [feat({ type: "Point", coordinates: [p.lng, p.lat] })] });
  }, [hover, map, op]);
  if (!op?.profile || closed === op.id) return null;
  const pr = op.profile, W = 720, H = 150, pad = 34;
  const valid = pr.points.filter(p => Number.isFinite(p.elevation));
  const min = pr.minElevation, max = Math.max(pr.maxElevation, min + 1);
  const x = (d: number) => pad + (d / pr.lengthM) * (W - pad * 2), y = (e: number) => H - 20 - ((e - min) / (max - min)) * (H - 40);
  const path = valid.map((p, i) => `${i ? "L" : "M"}${x(p.distanceM).toFixed(1)},${y(p.elevation).toFixed(1)}`).join("");
  const hp = hover !== null ? pr.points[hover] : null;
  return (
    <div className={styles.tray} role="region" aria-label="Elevation profile">
      <div className={styles.trayHead}><b>{op.title}</b><span>{op.summary.map(([k, v]) => `${k} ${v}`).join(" · ")}</span><button type="button" onClick={() => setClosed(op.id)} aria-label="Close tray">×</button></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const d = (((e.clientX - r.left) / r.width) * W - pad) / (W - pad * 2) * pr.lengthM; setHover(Math.max(0, Math.min(pr.points.length - 1, Math.round((d / pr.lengthM) * (pr.points.length - 1))))); }}>
        <path d={`${path}L${x(pr.lengthM)},${H - 20}L${x(0)},${H - 20}Z`} fill="rgba(182,99,62,.18)" />
        <path d={path} fill="none" stroke="#b6633e" strokeWidth={1.6} />
        <text x={4} y={y(max) + 4}>{Math.round(max)} m</text><text x={4} y={y(min)}>{Math.round(min)} m</text>
        <text x={W - pad} y={H - 4} textAnchor="end">{(pr.lengthM / 1000).toFixed(2)} km</text>
        {hp && Number.isFinite(hp.elevation) && <><line x1={x(hp.distanceM)} x2={x(hp.distanceM)} y1={10} y2={H - 20} stroke="#f2f0e9" strokeDasharray="3 3" /><text x={Math.min(W - 120, x(hp.distanceM) + 6)} y={18}>{(hp.distanceM / 1000).toFixed(2)} km · {hp.elevation.toFixed(0)} m</text></>}
      </svg>
      <p className={styles.caveat}>{op.limitation}</p>
    </div>
  );
}

export type { Polygon };
