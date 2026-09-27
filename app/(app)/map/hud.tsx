"use client";

// Atlas HUD: sensor looks (CRT, NVG, FLIR, ironbow thermal, noir), a tactical heads-up display, and a detection
// overlay that boxes what is rendered in view. All screen-space; the data underneath is unchanged.
import type * as maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import styles from "./map.module.css";

export const MODES = [
  { key: "normal", label: "Normal" },
  { key: "crt", label: "CRT" },
  { key: "nvg", label: "NVG" },
  { key: "flir", label: "FLIR" },
  { key: "thermal", label: "Thermal" },
  { key: "noir", label: "Noir" },
] as const;
export type Mode = (typeof MODES)[number]["key"];

/** SVG filters referenced by CSS on the map canvas. */
export function SensorFilters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <defs>
        <filter id="atlas-nvg" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.06 0.22 0.02 0 0  0.30 0.95 0.12 0 0.03  0.06 0.22 0.02 0 0  0 0 0 1 0" />
          <feComponentTransfer><feFuncG type="gamma" amplitude="1.25" exponent="0.72" offset="0" /><feFuncR type="gamma" amplitude="1.1" exponent="0.9" offset="0" /></feComponentTransfer>
        </filter>
        <filter id="atlas-flir" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" />
          <feComponentTransfer><feFuncR type="linear" slope="1.55" intercept="-0.18" /><feFuncG type="linear" slope="1.55" intercept="-0.18" /><feFuncB type="linear" slope="1.55" intercept="-0.18" /></feComponentTransfer>
        </filter>
        <filter id="atlas-thermal" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0 0.18 0.5 0.82 0.98 1 1" />
            <feFuncG type="table" tableValues="0 0 0.04 0.22 0.52 0.82 1" />
            <feFuncB type="table" tableValues="0.02 0.42 0.55 0.24 0.02 0.18 0.9" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
function utc(d: Date) { return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`; }
function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = ((a - d) * 60 - m) * 60;
  return `${d}°${pad(m)}'${s.toFixed(1).padStart(4, "0")}"${v >= 0 ? pos : neg}`;
}
/** Approximate camera altitude from zoom, latitude and viewport height (MapLibre's 36.87° field of view). */
export function cameraAltitudeKm(zoom: number, lat: number, heightPx: number) {
  const mpp = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return (mpp * heightPx * 1.5) / 1000;
}
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export type Telemetry = { lng: number; lat: number; zoom: number; bearing: number; pitch: number; heightPx: number };
export type Target = { kind: string; title: string; lines: [string, string][] } | null;

function readTelemetry(map: maplibregl.Map): Telemetry {
  const c = map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), heightPx: map.getContainer().clientHeight };
}

export function Hud({ map, mode, summary, target, basemap, live }: { map: maplibregl.Map | null; mode: Mode; summary: string[]; target: Target; basemap: string; live: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [telemetry, setTelemetry] = useState<Telemetry>({ lng: 0, lat: 0, zoom: 2, bearing: 0, pitch: 0, heightPx: 800 });
  const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    const onMove = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setTelemetry(readTelemetry(map)); }); };
    const onCursor = (e: maplibregl.MapMouseEvent) => setCursor({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    onMove();
    map.on("move", onMove); map.on("mousemove", onCursor);
    return () => { map.off("move", onMove); map.off("mousemove", onCursor); cancelAnimationFrame(frame); };
  }, [map]);
  const alt = cameraAltitudeKm(telemetry.zoom, telemetry.lat, telemetry.heightPx);
  const heading = ((telemetry.bearing % 360) + 360) % 360;
  const ticks = [];
  const base = Math.floor(heading / 5) * 5;
  for (let k = -12; k <= 12; k++) {
    const deg = base + k * 5;
    const n = ((deg % 360) + 360) % 360;
    const label = n % 45 === 0 ? COMPASS[n / 45] : n % 15 === 0 ? String(n).padStart(3, "0") : "";
    ticks.push(<span key={k} style={{ left: `${50 + (deg - heading) * 0.8}%` }} className={label ? styles.tickMajor : styles.tick}>{label}</span>);
  }
  return (
    <div className={styles.hud} aria-hidden>
      <div className={styles.hudTop}>
        <span className={styles.hudBrand}>REGENERA // ATLAS</span>
        <span>{MODES.find(m => m.key === mode)?.label.toUpperCase()}</span>
        <span>{utc(now)}</span>
        <span>{now.toISOString().slice(0, 10)}</span>
        <span className={live ? styles.hudLive : styles.hudIdle}>{live ? "● LIVE" : "○ STANDBY"}</span>
      </div>
      <div className={styles.reticle}><i /><i /><i /><i /></div>
      <div className={styles.corners}><i /><i /><i /><i /></div>
      <div className={styles.compass}>{ticks}<b /></div>
      <div className={styles.hudLeft}>
        <p>LAT {dms(telemetry.lat, "N", "S")}</p>
        <p>LON {dms(telemetry.lng, "E", "W")}</p>
        <p>ALT {alt >= 10 ? `${Math.round(alt).toLocaleString("en-US")} KM` : `${Math.round(alt * 1000).toLocaleString("en-US")} M`}</p>
        <p>HDG {String(Math.round(heading)).padStart(3, "0")}° · TILT {Math.round(telemetry.pitch)}°</p>
        <p>SRC {basemap.toUpperCase()}</p>
        {cursor && <p>CUR {cursor.lat.toFixed(4)}, {cursor.lng.toFixed(4)}</p>}
      </div>
      <div className={styles.hudRight}>
        {summary.map(s => <p key={s}>{s}</p>)}
      </div>
      {target && (
        <div className={styles.hudTarget}>
          <p className={styles.hudTargetKind}>◎ TRACK · {target.kind.toUpperCase()}</p>
          <p className={styles.hudTargetTitle}>{target.title}</p>
          {target.lines.map(([k, v]) => <p key={k}><span>{k}</span>{v}</p>)}
        </div>
      )}
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number; label: string; color: string };
/** Screen-space boxes and IDs on rendered, identifiable features (throttled; capped for legibility). */
export function Detection({ map, layers, on }: { map: maplibregl.Map | null; layers: { id: string; color: string; size: number; label: (p: Record<string, unknown>) => string }[]; on: boolean }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    if (!map || !on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const compute = () => {
      pending = false;
      const ids = layers.map(l => l.id).filter(id => map.getLayer(id));
      if (!ids.length) { setBoxes([]); return; }
      const feats = map.queryRenderedFeatures(undefined, { layers: ids });
      const seen = new Set<string>();
      const out: Box[] = [];
      for (const f of feats) {
        const spec = layers.find(l => l.id === f.layer.id);
        if (!spec || f.geometry.type !== "Point") continue;
        const key = `${f.layer.id}:${String(f.properties?.id ?? f.id ?? "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const p = map.project([lng, lat]);
        out.push({ x: p.x - spec.size / 2, y: p.y - spec.size / 2, w: spec.size, h: spec.size, label: spec.label(f.properties ?? {}), color: spec.color });
        if (out.length >= 90) break;
      }
      setBoxes(out);
    };
    const schedule = () => { if (pending) return; pending = true; timer = setTimeout(compute, 180); };
    map.on("render", schedule);
    schedule();
    return () => { map.off("render", schedule); clearTimeout(timer); };
  }, [map, layers, on]);
  if (!on) return null;
  return (
    <svg className={styles.detect} aria-hidden>
      {boxes.map((b, i) => (
        <g key={i}>
          <path d={`M${b.x} ${b.y + 5}V${b.y}H${b.x + 5}M${b.x + b.w - 5} ${b.y}H${b.x + b.w}V${b.y + 5}M${b.x + b.w} ${b.y + b.h - 5}V${b.y + b.h}H${b.x + b.w - 5}M${b.x + 5} ${b.y + b.h}H${b.x}V${b.y + b.h - 5}`} stroke={b.color} fill="none" strokeWidth={1.2} />
          <text x={b.x + b.w + 3} y={b.y + 7} fill={b.color}>{b.label}</text>
        </g>
      ))}
    </svg>
  );
}
