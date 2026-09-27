"use client";

// Intel panel: missions (one-click layer stacks), basemaps, live-intelligence layers grouped like an analyst console,
// each with status, count, provenance, licence and caveats; plus the imagery date for daily products.
import { useState } from "react";
import { Info } from "lucide-react";
import { GROUP_LABELS, productDate, type LayerGroup, type OfferedLayer } from "@/lib/map/catalog";
import styles from "./map.module.css";

export type FeedStatus = { loading?: boolean; count?: number; shown?: number; updated?: string; error?: string; source?: string };
export type RecordLayer = { key: string; label: string; swatch: string; count: number };

export const MISSIONS: { id: string; label: string; hint: string; base: string; layers: string[]; records?: string[]; mode?: string; camera?: "globe" | "fit" }[] = [
  { id: "portfolio", label: "Portfolio", hint: "Projects, opportunities and partners on satellite imagery", base: "s2cloudless", layers: [], records: ["projects", "deals", "organizations", "triggers", "procurement"], camera: "fit" },
  { id: "site", label: "Site scout", hint: "Vegetation, protected areas, grid and buildings around sites", base: "s2cloudless", layers: ["ndvi", "protected", "power", "buildings"], records: ["projects"], camera: "fit" },
  { id: "hazard", label: "Hazard watch", hint: "Yesterday from orbit with quakes, fires, storms and events", base: "viirs_today", layers: ["quakes", "fires", "events", "cyclones"], records: ["projects", "hazards"], camera: "globe" },
  { id: "energy", label: "Energy transition", hint: "Night lights, power grid and plants, land heat", base: "blackmarble", layers: ["power"], records: ["projects"], camera: "globe" },
  { id: "forest", label: "Forest and land", hint: "Tree cover loss, vegetation and protected areas", base: "s2cloudless", layers: ["forest_loss", "protected", "fires"], records: ["projects"] },
  { id: "live", label: "Live traffic", hint: "Aircraft, military traffic and crewed spacecraft", base: "tactical", layers: ["flights", "military", "sat_stations"], mode: "nvg" },
  { id: "orbit", label: "Orbital watch", hint: "Earth-observation, weather, navigation satellites and stations", base: "blackmarble", layers: ["sat_eo", "sat_weather", "sat_gnss", "sat_stations"], camera: "globe" },
];

function Row({ l, on, status, onToggle, dated }: { l: OfferedLayer; on: boolean; status?: FeedStatus; onToggle: () => void; dated?: string }) {
  const [open, setOpen] = useState(false);
  const state = !on ? null : status?.error ? "error" : status?.loading ? "loading" : status?.count != null ? "ok" : l.kind === "feed" || l.kind === "satellites" ? "loading" : "ok";
  return (
    <div className={styles.intelRow} data-on={on}>
      <label className={styles.layerRow}>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span className={styles.swatch} style={{ background: l.swatch }} />
        <span className={styles.layerLabel}>{l.label}</span>
        <span className={styles.count} data-state={state ?? "off"}>
          {state === "error" ? "unavailable" : state === "loading" ? "…" : on && status?.count != null ? (status.shown != null && status.shown < status.count ? `${status.shown.toLocaleString("en-US")}/${status.count.toLocaleString("en-US")}` : status.count.toLocaleString("en-US")) : on ? "on" : ""}
        </span>
        <button type="button" className={styles.infoBtn} aria-expanded={open} aria-label={`About ${l.label}`} onClick={e => { e.preventDefault(); setOpen(o => !o); }}><Info size={13} /></button>
      </label>
      {open && (
        <div className={styles.intelInfo}>
          <p>{l.description}</p>
          {l.legend && <p className={styles.legend}>{l.legend.map(g => <span key={g.color}><i style={{ background: g.color }} />{g.label}</span>)}</p>}
          <p>{[l.attribution, l.license, `refresh: ${l.refresh}`, dated && `date: ${dated}`, status?.source && `via ${status.source}`, status?.updated && `loaded ${status.updated.slice(11, 16)} UTC`].filter(Boolean).join(" · ")}</p>
          {l.caveat && <p className={styles.caveat}>{l.caveat}</p>}
          {status?.error && <p className={styles.error}>{status.error}. This does not mean there is nothing there.</p>}
        </div>
      )}
    </div>
  );
}

export function IntelPanel({ catalog, base, setBase, overlays, toggle, status, records, recordsOn, toggleRecord, dayOffset, setDayOffset, runMission, firmsKey }: {
  catalog: OfferedLayer[]; base: string; setBase: (id: string) => void; overlays: Set<string>; toggle: (id: string) => void; status: Record<string, FeedStatus>;
  records: RecordLayer[]; recordsOn: Record<string, boolean>; toggleRecord: (k: string) => void; dayOffset: number; setDayOffset: (n: number) => void; runMission: (id: string) => void; firmsKey: boolean;
}) {
  const groups = (Object.keys(GROUP_LABELS) as LayerGroup[]).filter(g => g !== "basemap");
  const daily = catalog.some(l => l.daily && (l.id === base || overlays.has(l.id)));
  const now = new Date();
  return (
    <>
      <p className={styles.panelTitle}>Missions</p>
      <div className={styles.missions}>
        {MISSIONS.map(m => <button key={m.id} type="button" title={m.hint} onClick={() => runMission(m.id)}>{m.label}</button>)}
      </div>

      <p className={styles.panelTitle}>Basemap</p>
      <div className={styles.basemaps}>
        {catalog.filter(l => l.group === "basemap").map(l => (
          <button key={l.id} type="button" aria-pressed={base === l.id} onClick={() => setBase(l.id)} title={`${l.description} ${l.attribution}`}>
            <span style={{ background: l.swatch }} />{l.label}
          </button>
        ))}
      </div>
      {daily && (
        <label className={styles.dateRow}>
          <span>Imagery date {productDate(now, 1 + dayOffset)}</span>
          <input type="range" min={0} max={30} value={dayOffset} onChange={e => setDayOffset(Number(e.target.value))} aria-label="Days back for daily imagery" />
        </label>
      )}

      <p className={styles.panelTitle}>Regenera records</p>
      {records.map(r => (
        <label key={r.key} className={styles.layerRow}>
          <input type="checkbox" checked={recordsOn[r.key]} onChange={() => toggleRecord(r.key)} />
          <span className={styles.swatch} style={{ background: r.swatch }} />
          <span className={styles.layerLabel}>{r.label}</span>
          <span className={styles.count}>{r.count}</span>
          <span />
        </label>
      ))}

      {groups.map(g => {
        const rows = catalog.filter(l => l.group === g);
        if (!rows.length) return null;
        return (
          <div key={g}>
            <p className={styles.panelTitle}>{GROUP_LABELS[g]}</p>
            {rows.map(l => <Row key={l.id} l={l.id === "fires" && firmsKey ? { ...l, description: "NASA FIRMS VIIRS 375 m detections for the view (last 24 h)." } : l} on={overlays.has(l.id)} status={status[l.id]} onToggle={() => toggle(l.id)} dated={l.daily ? productDate(now, (l.lagDays ?? 1) + dayOffset) : undefined} />)}
          </div>
        );
      })}
      <p className={styles.note}>Every layer is registered in Settings → Integrations with its licence and state; disabled or licence-required sources are never loaded. Live positions come from public sources and can lag or have gaps.</p>
    </>
  );
}
