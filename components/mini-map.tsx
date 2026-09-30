"use client";

// Command map (phase 10; Atlas §54): a small situational map without the Atlas engine. Keyless Esri dark-gray raster
// tiles in Web Mercator, drag to pan, wheel or buttons to zoom, clustered project points, click for a preview with
// Open project / Open in Atlas. No MapLibre here: heavy Atlas libraries stay inside the map route (tested).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import s from "./mini-map.module.css";

export type MiniPoint = { id: string; name: string; lat: number; lng: number; stage: string; sub?: string; alert?: boolean };

const T = 256;
const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
const wx = (lng: number, z: number) => ((lng + 180) / 360) * T * 2 ** z;
const wy = (lat: number, z: number) => { const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * T * 2 ** z; };

function fit(points: MiniPoint[], w: number, h: number) {
  if (!points.length) return { z: 2, cx: wx(-40, 2), cy: wy(20, 2) };
  for (let z = 10; z >= 1; z--) {
    const xs = points.map(p => wx(p.lng, z)), ys = points.map(p => wy(p.lat, z));
    const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
    if (dx < w * 0.7 && dy < h * 0.7) return { z, cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 };
  }
  return { z: 1, cx: wx(0, 1), cy: wy(10, 1) };
}

export default function MiniMap({ points, height = 320 }: { points: MiniPoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  const [view, setView] = useState(() => fit(points, 520, height));
  const [sel, setSel] = useState<MiniPoint | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { z, cx, cy } = view;
  const left = cx - w / 2, top = cy - height / 2, n = 2 ** z;
  const tiles = useMemo(() => {
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let ty = Math.floor(top / T); ty <= Math.floor((top + height) / T); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left / T); tx <= Math.floor((left + w) / T); tx++) {
        const wrapped = ((tx % n) + n) % n;
        out.push({ key: `${z}/${tx}/${ty}`, src: TILE(z, wrapped, ty), x: tx * T - left, y: ty * T - top });
      }
    }
    return out;
  }, [z, left, top, w, height, n]);

  // Clusters: points closer than 26 px at this zoom merge; a cluster click zooms in on it.
  const clusters = useMemo(() => {
    const cs: { x: number; y: number; items: MiniPoint[] }[] = [];
    for (const p of points) {
      const x = wx(p.lng, z) - left, y = wy(p.lat, z) - top;
      const c = cs.find(k => Math.hypot(k.x - x, k.y - y) < 26);
      if (c) { c.items.push(p); c.x = (c.x * (c.items.length - 1) + x) / c.items.length; c.y = (c.y * (c.items.length - 1) + y) / c.items.length; } else cs.push({ x, y, items: [p] });
    }
    return cs;
  }, [points, z, left, top]);

  const zoomAt = (dz: number, px = w / 2, py = height / 2) => setView(v => {
    const nz = Math.max(1, Math.min(14, v.z + dz));
    if (nz === v.z) return v;
    const f = 2 ** (nz - v.z), ax = v.cx - w / 2 + px, ay = v.cy - height / 2 + py;
    return { z: nz, cx: ax * f - px + w / 2, cy: ay * f - py + height / 2 };
  });

  return (
    <div className={s.wrap}>
      <div ref={box} className={s.map} style={{ height }}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx, cy, moved: false }; }}
        onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; setView(v => ({ ...v, cx: d.cx - dx, cy: d.cy - dy })); }}
        onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
        onWheel={e => { const r = box.current!.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); }}
        role="region" aria-label="Project map">
        {tiles.map(t => <img key={t.key} src={t.src} alt="" draggable={false} className={s.tile} style={{ transform: `translate(${t.x}px, ${t.y}px)` }} />)}
        {clusters.map((c, i) => c.items.length > 1
          ? <button key={i} type="button" className={s.cluster} style={{ transform: `translate(${c.x - 14}px, ${c.y - 14}px)` }} aria-label={`${c.items.length} projects`}
              onClick={() => { if (!drag.current?.moved) zoomAt(2, c.x, c.y); }}>{c.items.length}</button>
          : <button key={c.items[0].id} type="button" className={`${s.dot} ${c.items[0].alert ? s.alert : ""} ${sel?.id === c.items[0].id ? s.sel : ""}`} style={{ transform: `translate(${c.x - 6}px, ${c.y - 6}px)` }}
              aria-label={c.items[0].name} title={c.items[0].name} onClick={() => { if (!drag.current?.moved) setSel(c.items[0]); }} />)}
        <div className={s.zoom}><button type="button" onClick={() => zoomAt(1)} aria-label="Zoom in">+</button><button type="button" onClick={() => zoomAt(-1)} aria-label="Zoom out">−</button></div>
        <span className={s.attr}>Esri, HERE, Garmin, © OpenStreetMap</span>
        {points.length === 0 && <p className={s.empty}>No projects with a location yet.</p>}
      </div>
      {sel && (
        <div className={s.preview}>
          <div><b>{sel.name}</b><span>{[sel.stage, sel.sub].filter(Boolean).join(" · ")}</span>{sel.alert && <span className={s.flag}>Needs attention</span>}</div>
          <div className={s.actions}><Link href={`/projects/${sel.id}`}>Open project</Link><Link href={`/map?project=${sel.id}`}>Open in Atlas</Link><button type="button" onClick={() => setSel(null)} aria-label="Close">×</button></div>
        </div>
      )}
    </div>
  );
}
