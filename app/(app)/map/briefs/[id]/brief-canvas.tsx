"use client";

// Site brief canvas (Atlas Site Diagram Studio, 2D): imagery or analytical basemap, the recorded boundary, distance rings,
// north arrow and scale bar, annotations drawn by content class (measured solid, modeled dashed, conceptual dotted,
// field-observed ringed, open question "?"), click-to-place for new annotations, scenario switching on the same boundary
// and scale, an automatic legend, and a print layout (browser "Save as PDF"). No MapLibre: same tile math as Command.
import { useMemo, useRef, useState } from "react";
import type { BriefAnnotation, BriefScenario } from "@/db/schema";
import { addAnnotationAction, removeAnnotationAction } from "../../../brief-actions";
import s from "./brief.module.css";

const T = 256;
const TILES = {
  imagery: { url: (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, attr: "Imagery: Esri, Maxar, Earthstar Geographics" },
  analytical: { url: (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`, attr: "Esri, HERE, Garmin, © OpenStreetMap" },
};
const wx = (lng: number, z: number) => ((lng + 180) / 360) * T * 2 ** z;
const wy = (lat: number, z: number) => { const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * T * 2 ** z; };
const lngOf = (x: number, z: number) => (x / (T * 2 ** z)) * 360 - 180;
const latOf = (y: number, z: number) => { const n = Math.PI - (2 * Math.PI * y) / (T * 2 ** z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
const mpp = (lat: number, z: number) => (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (T * 2 ** z);

export const CLASS_LABEL = { measured: "Measured", modeled: "Modeled", conceptual: "Conceptual", observed: "Field-observed", unknown: "Open question" } as const;

type Props = {
  briefId: string; editable: boolean; center: { lat: number; lng: number }; zoom: number; rings: number[]; boundary: string | null;
  annotations: BriefAnnotation[]; scenarios: BriefScenario[]; kinds: string[]; kindLabels: Record<string, string>;
};

function boundaryRings(geojson: string | null): [number, number][][] {
  if (!geojson) return [];
  try {
    const j = JSON.parse(geojson) as { type: string; geometry?: { type: string; coordinates: unknown }; coordinates?: unknown };
    const g = (j.type === "Feature" ? j.geometry : j) as { type: string; coordinates: unknown };
    if (g.type === "Polygon") return g.coordinates as [number, number][][];
    if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][]).flat();
    return [];
  } catch { return []; }
}

export function BriefCanvas(p: Props) {
  const W = 880, H = 560;
  const [z, setZ] = useState(p.zoom);
  const [base, setBase] = useState<keyof typeof TILES>("imagery");
  const [scenario, setScenario] = useState<string>("all");
  const [mode, setMode] = useState<"point" | "line">("point");
  const [draft, setDraft] = useState<{ lng: number; lat: number }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const cx = wx(p.center.lng, z), cy = wy(p.center.lat, z), left = cx - W / 2, top = cy - H / 2, n = 2 ** z;
  const X = (lng: number) => wx(lng, z) - left, Y = (lat: number) => wy(lat, z) - top;
  const tiles = useMemo(() => {
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let ty = Math.floor(top / T); ty <= Math.floor((top + H) / T); ty++) for (let tx = Math.floor(left / T); tx <= Math.floor((left + W) / T); tx++) {
      if (ty < 0 || ty >= n) continue;
      out.push({ key: `${z}/${tx}/${ty}`, src: TILES[base].url(z, ((tx % n) + n) % n, ty), x: tx * T - left, y: ty * T - top });
    }
    return out;
  }, [z, left, top, n, base]);
  const visible = p.annotations.filter(a => scenario === "all" || a.scenarioId === null || a.scenarioId === scenario);
  const metres = mpp(p.center.lat, z);
  const scaleM = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].find(m => m / metres >= 80) ?? 20000;
  const used = [...new Set(visible.map(a => a.contentClass))];
  const usedKinds = [...new Set(visible.map(a => a.kind))];

  const onClick = (e: React.MouseEvent) => {
    if (!p.editable) return;
    const r = box.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W, sy = ((e.clientY - r.top) / r.height) * H;
    const pt = { lng: lngOf(sx + left, z), lat: latOf(sy + top, z) };
    setDraft(d => (mode === "point" ? [pt] : [...d, pt]));
  };

  return (
    <div className={s.wrap}>
      <div className={s.toolbar} role="toolbar" aria-label="Diagram controls">
        <label>Basemap <select value={base} onChange={e => setBase(e.target.value as keyof typeof TILES)}><option value="imagery">Imagery</option><option value="analytical">Analytical light</option></select></label>
        <label>Scenario <select value={scenario} onChange={e => setScenario(e.target.value)}><option value="all">All annotations</option>{p.scenarios.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <span className={s.zoom}><button type="button" onClick={() => setZ(v => Math.min(19, v + 1))} aria-label="Zoom in">+</button><button type="button" onClick={() => setZ(v => Math.max(3, v - 1))} aria-label="Zoom out">−</button></span>
        <button type="button" className="btn" onClick={() => window.print()}>Print / save PDF</button>
      </div>
      <div ref={box} className={s.map} style={{ aspectRatio: `${W} / ${H}` }} onClick={onClick} role="img" aria-label="Site diagram. Annotations are listed in the table below the map.">
        <svg viewBox={`0 0 ${W} ${H}`} className={s.svg}>
          {tiles.map(t => <image key={t.key} href={t.src} x={t.x} y={t.y} width={T} height={T} />)}
          {p.rings.map(km => <g key={km}><circle cx={X(p.center.lng)} cy={Y(p.center.lat)} r={(km * 1000) / metres} className={s.ring} /><text x={X(p.center.lng) + (km * 1000) / metres + 4} y={Y(p.center.lat) - 4} className={s.ringLabel}>{km} km</text></g>)}
          {boundaryRings(p.boundary).map((ring, i) => <polygon key={i} points={ring.map(([lng, lat]) => `${X(lng)},${Y(lat)}`).join(" ")} className={s.boundary} />)}
          {visible.map(a => a.geometry.type === "Point"
            ? <g key={a.id} className={s[a.contentClass]}><circle cx={X(a.geometry.coordinates[0])} cy={Y(a.geometry.coordinates[1])} r={7} />{a.contentClass === "unknown" && <text x={X(a.geometry.coordinates[0])} y={Y(a.geometry.coordinates[1]) + 4} className={s.q}>?</text>}<text x={X(a.geometry.coordinates[0]) + 10} y={Y(a.geometry.coordinates[1]) + 4} className={s.label}>{a.label}</text></g>
            : <g key={a.id} className={s[a.contentClass]}><polyline points={a.geometry.coordinates.map(([lng, lat]) => `${X(lng)},${Y(lat)}`).join(" ")} className={s.line} /><text x={X(a.geometry.coordinates[0][0]) + 6} y={Y(a.geometry.coordinates[0][1]) - 6} className={s.label}>{a.label}</text></g>)}
          {draft.length > 0 && (draft.length === 1 ? <circle cx={X(draft[0].lng)} cy={Y(draft[0].lat)} r={7} className={s.draft} /> : <polyline points={draft.map(d => `${X(d.lng)},${Y(d.lat)}`).join(" ")} className={s.draftLine} />)}
          <g transform={`translate(${W - 44}, 30)`} className={s.north} aria-hidden="true"><path d="M0,-18 L8,8 L0,3 L-8,8 Z" /><text y={24} textAnchor="middle">N</text></g>
          <g transform={`translate(16, ${H - 22})`} className={s.scale}><rect width={scaleM / metres} height={5} /><text y={-5}>{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</text></g>
        </svg>
        <span className={s.attr}>{TILES[base].attr}</span>
      </div>

      <div className={s.legend} aria-label="Legend">
        <b>Legend</b>
        {p.boundary && <span><i className={s.swBoundary} /> Recorded boundary</span>}
        {p.rings.length > 0 && <span><i className={s.swRing} /> Distance rings from the site center</span>}
        {(used.length ? used : (Object.keys(CLASS_LABEL) as (keyof typeof CLASS_LABEL)[])).map(c => <span key={c}><i className={`${s.sw} ${s[c]}`} /> {CLASS_LABEL[c]}</span>)}
        {usedKinds.length > 0 && <span className={s.kinds}>Marks: {usedKinds.map(k => p.kindLabels[k] ?? k).join(", ")}</span>}
      </div>

      {p.editable && (
        <form action={addAnnotationAction} className={s.form} onSubmit={() => setTimeout(() => setDraft([]), 0)}>
          <input type="hidden" name="briefId" value={p.briefId} />
          <input type="hidden" name="points" value={JSON.stringify(draft)} />
          <p className={s.hint}>{draft.length === 0 ? `Click the map to place a ${mode === "point" ? "point" : "line (click each vertex)"}.` : `${draft.length} point${draft.length === 1 ? "" : "s"} placed.`} <button type="button" className={s.link} onClick={() => setMode(m => (m === "point" ? "line" : "point"))}>Switch to {mode === "point" ? "line" : "point"}</button>{draft.length > 0 && <> · <button type="button" className={s.link} onClick={() => setDraft([])}>Clear</button></>}</p>
          <label>Marks<select name="kind" required defaultValue="">{<option value="" disabled>Choose</option>}{p.kinds.map(k => <option key={k} value={k}>{p.kindLabels[k] ?? k}</option>)}</select></label>
          <label>Label<input name="label" maxLength={200} /></label>
          <label>Content class<select name="contentClass" defaultValue="conceptual">{Object.entries(CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Scenario<select name="scenarioId" defaultValue={scenario === "all" ? "" : scenario}><option value="">All scenarios</option>{p.scenarios.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className={s.wide}>Evidence (required for measured, modeled or observed)<input name="evidence" placeholder="Survey 2026-05, model run id, site visit notes…" /></label>
          <label className={s.wide}>Source<input name="source" placeholder="URL or record" /></label>
          <label className={s.wide}>Note<input name="note" /></label>
          <button className="btn btn--primary" type="submit" disabled={draft.length === 0}>Add annotation</button>
        </form>
      )}

      <table className={s.table}>
        <caption>Annotations{scenario !== "all" ? ` (${p.scenarios.find(x => x.id === scenario)?.name})` : ""}</caption>
        <thead><tr><th>Mark</th><th>Label</th><th>Content class</th><th>Evidence / source</th><th>Scenario</th><th>By</th>{p.editable && <th />}</tr></thead>
        <tbody>{visible.length === 0 ? <tr><td colSpan={7}>No annotations yet.</td></tr> : visible.map(a => (
          <tr key={a.id}><td>{p.kindLabels[a.kind] ?? a.kind}</td><td>{a.label}{a.note ? <span className={s.sub}>{a.note}</span> : null}</td><td>{CLASS_LABEL[a.contentClass]}</td><td>{a.evidence || "—"}{a.source ? <span className={s.sub}>{a.source}</span> : null}</td>
            <td>{a.scenarioId ? p.scenarios.find(x => x.id === a.scenarioId)?.name ?? a.scenarioId : "All"}</td><td className={s.sub}>{a.by.split("@")[0]}, {a.at.slice(0, 10)}</td>
            {p.editable && <td><form action={removeAnnotationAction}><input type="hidden" name="briefId" value={p.briefId} /><input type="hidden" name="annotationId" value={a.id} /><button className={s.link} type="submit" aria-label={`Remove ${a.label}`}>Remove</button></form></td>}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}
