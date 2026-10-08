"use client";

// Intel panel: missions (one-click layer stacks), basemaps, live-intelligence layers grouped like an analyst console,
// each with status, count, provenance, licence and caveats; plus the imagery date for daily products.
import { useState } from "react";
import { Info } from "lucide-react";
import { GROUP_LABELS, productDate, type LayerGroup, type OfferedLayer } from "@/lib/map/catalog";
import { CONFIDENCE, FRESHNESS, TIERS } from "@/lib/map/provenance";
import styles from "./map.module.css";

export type FeedStatus = { loading?: boolean; count?: number; shown?: number; updated?: string; error?: string; source?: string };
export type RecordLayer = { key: string; label: string; swatch: string; count: number };

// Saved workspaces (phase 21 Atlas §6): layer configurations and a camera, not separate applications.
export const MISSIONS: { id: string; label: string; hint: string; base: string; layers: string[]; records?: string[]; mode?: string; camera?: "globe" | "fit" }[] = [
  { id: "global_infra", label: "Global Infrastructure", hint: "Registry-listed power plants and the OSM grid on a quiet analytical map", base: "light", layers: ["registry_plants", "power"], records: ["projects"], camera: "globe" },
  { id: "energy_transition", label: "Energy Transition", hint: "Generation by fuel, grid and your energy projects and opportunities", base: "light", layers: ["registry_plants", "power"], records: ["projects", "deals", "procurement"], camera: "globe" },
  { id: "site_scout", label: "Site Scout", hint: "Imagery with grid, protected areas, vegetation, water and buildings; then Screen a site", base: "s2cloudless", layers: ["power", "registry_plants", "protected", "ndvi", "surface_water", "buildings"], records: ["projects"], camera: "fit" },
  { id: "land_ecology", label: "Land & Ecology", hint: "Tree cover loss, protected areas and vegetation", base: "s2cloudless", layers: ["forest_loss", "protected", "ndvi"], records: ["projects"], camera: "fit" },
  { id: "water_intel", label: "Water Intelligence", hint: "Surface-water history and precipitation around projects", base: "light", layers: ["surface_water", "precip"], records: ["projects"], camera: "fit" },
  { id: "hazard_watch", label: "Hazard Watch", hint: "Quakes, fires, storms and events with GDACS alerts", base: "viirs_today", layers: ["quakes", "fires", "events", "cyclones"], records: ["projects", "hazards"], camera: "globe" },
  { id: "project_portfolio", label: "Project Portfolio", hint: "Projects, opportunities and partners on imagery", base: "s2cloudless", layers: [], records: ["projects", "deals", "organizations"], camera: "fit" },
  { id: "capital_opps", label: "Capital Opportunities", hint: "Funding calls and tenders with projects and opportunities", base: "light", layers: [], records: ["projects", "procurement", "deals"], camera: "fit" },
  { id: "capital", label: "Structure capital", hint: "Project, opportunity and funding records; open the project Capital workspace for readiness and raises", base:"light",layers:[],records:["projects","deals","procurement"],camera:"fit" },
  { id:"partners",label:"Find partners",hint:"Organizations and project relationships",base:"light",layers:[],records:["projects","organizations"],camera:"fit" },
  { id: "grid", label: "Power grid & connections", hint: "Screen transmission and generation near projects; verify available capacity, connection rights and queue status separately", base: "light", layers: ["power"], records: ["projects", "organizations"], camera: "fit" },
  { id: "portfolio", label: "Portfolio", hint: "Projects, opportunities and partners on satellite imagery", base: "s2cloudless", layers: [], records: ["projects", "deals", "organizations", "triggers", "procurement"], camera: "fit" },
  { id: "site", label: "Site diligence", hint: "Vegetation, protected areas, grid and buildings around sites", base: "s2cloudless", layers: ["ndvi", "protected", "power", "buildings"], records: ["projects"], camera: "fit" },
  { id: "hazard", label: "Project risk", hint: "Yesterday from orbit with quakes, fires, storms and events", base: "viirs_today", layers: ["quakes", "fires", "events", "cyclones"], records: ["projects", "hazards"], camera: "globe" },
  { id: "energy", label: "Energy development", hint: "Grid infrastructure and project development context", base: "light", layers: ["power"], records: ["projects"], camera: "globe" },
  { id: "forest", label: "Land & nature", hint: "Tree cover loss, vegetation and protected areas", base: "s2cloudless", layers: ["forest_loss", "protected", "fires"], records: ["projects"] },
  { id: "live", label: "Live traffic", hint: "Aircraft, military traffic and crewed spacecraft", base: "tactical", layers: ["flights", "military", "sat_stations"], mode: "nvg" },
  { id: "orbit", label: "Orbital watch", hint: "Earth-observation, weather, navigation satellites and stations", base: "blackmarble", layers: ["sat_eo", "sat_weather", "sat_gnss", "sat_stations"], camera: "globe" },
];

// Analyst layer groups (phase 21 Atlas §3). Catalogue groups map onto them; a few layers are placed by id.
export const ATLAS_GROUPS = ["Energy", "Grid", "Land", "Water", "Ecology", "Climate & hazards", "Infrastructure", "Specialist (movement & space)"] as const;
const BY_ID: Record<string, (typeof ATLAS_GROUPS)[number]> = {
  registry_plants: "Energy", power: "Grid", nightlights_now: "Infrastructure", blackmarble: "Infrastructure", buildings: "Infrastructure", street_imagery: "Infrastructure",
  surface_water: "Water", precip: "Water", forest_loss: "Ecology", protected: "Ecology", ndvi: "Land", lst: "Climate & hazards", aerosol: "Climate & hazards",
};
const BY_GROUP: Partial<Record<LayerGroup, (typeof ATLAS_GROUPS)[number]>> = { infrastructure: "Infrastructure", nature: "Ecology", hazards: "Climate & hazards", weather: "Climate & hazards", earth: "Land", movement: "Specialist (movement & space)", space: "Specialist (movement & space)" };
export const atlasGroupOf = (l: Pick<OfferedLayer, "id" | "group">) => BY_ID[l.id] ?? BY_GROUP[l.group] ?? "Land";

function Row({ l, on, status, onToggle, dated, setOpacity }: { l: OfferedLayer; on: boolean; status?: FeedStatus; onToggle: () => void; dated?: string; setOpacity?: (id: string, v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [opacity, setOp] = useState(l.opacity ?? 0.8);
  const state = !on ? null : status?.error ? "error" : status?.loading ? "loading" : status?.count != null ? "ok" : l.kind === "feed" || l.kind === "satellites" ? "loading" : "ok";
  return (
    <div className={styles.intelRow} data-on={on}>
      <label className={styles.layerRow}>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span className={styles.swatch} style={{ background: l.swatch }} />
        <span className={styles.layerLabel}>{l.label}</span>
        {l.provenance && <span className={styles.tier} title={`Source tier: ${TIERS[l.provenance.tier].label}. Separate from freshness, coverage and fitness for this decision.`} data-tier={l.provenance.tier}>T{l.provenance.tier}</span>}
        {l.freshness && (l.freshness.status === "aging" || l.freshness.status === "stale" || l.freshness.status === "unavailable") && <span className={styles.fresh} data-fresh={l.freshness.status}>{FRESHNESS[l.freshness.status]}</span>}
        <span className={styles.count} data-state={state ?? "off"}>
          {state === "error" ? "unavailable" : state === "loading" ? "…" : on && status?.count != null ? (status.shown != null && status.shown < status.count ? `${status.shown.toLocaleString("en-US")}/${status.count.toLocaleString("en-US")}` : status.count.toLocaleString("en-US")) : on ? "on" : ""}
        </span>
        <button type="button" className={styles.infoBtn} aria-expanded={open} aria-label={`About ${l.label}`} onClick={e => { e.preventDefault(); setOpen(o => !o); }}><Info size={13} /></button>
      </label>
      {on && l.kind === "raster" && setOpacity && <label className={styles.opacityRow}>Opacity <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={e => { const v = Number(e.target.value); setOp(v); setOpacity(l.id, v); }} aria-label={`Opacity of ${l.label}`} /></label>}
      {open && (
        <div className={styles.intelInfo}>
          <p>{l.description}</p>
          {l.legend && <p className={styles.legend}>{l.legend.map(g => <span key={g.color}><i style={{ background: g.color }} />{g.label}</span>)}</p>}
          {l.provenance ? (
            <dl className={styles.prov}>
              <dt>Source tier</dt><dd>{TIERS[l.provenance.tier].label}</dd>
              <dt>Provider</dt><dd><a href={l.provenance.sourceUrl} target="_blank" rel="noreferrer">{l.provenance.provider}</a></dd>
              <dt>Coverage</dt><dd>{l.provenance.geography}</dd>
              <dt>Resolution</dt><dd>{l.provenance.resolution}</dd>
              <dt>Period</dt><dd>{l.provenance.period}{dated ? ` · showing ${dated}` : ""}</dd>
              <dt>Confidence</dt><dd>{CONFIDENCE[l.provenance.confidence]}</dd>
              {l.provenance.method && <><dt>Method</dt><dd>{l.provenance.method}</dd></>}
              <dt>Freshness</dt><dd>{l.freshness ? FRESHNESS[l.freshness.status] : "Not tracked"}{l.freshness?.lastOk ? ` · last successful load ${l.freshness.lastOk.slice(0, 16).replace("T", " ")} UTC` : ""}</dd>
              <dt>Licence</dt><dd>{l.terms ? <>{l.terms.licenseUrl ? <a href={l.terms.licenseUrl} target="_blank" rel="noreferrer">{l.terms.license}</a> : l.terms.license} · commercial use: {l.terms.commercialUse}{l.terms.redistribution ? ` · redistribution: ${l.terms.redistribution}` : ""}</> : l.license}</dd>
              <dt>Attribution</dt><dd>{l.attribution}</dd>
              {l.dataset && <>
                <dt>Source</dt><dd>{l.dataset.provider}{l.dataset.platform ? ` · ${l.dataset.platform}` : ""}</dd>
                <dt>Dataset</dt><dd>{l.dataset.name}{l.dataset.version ? ` · ${l.dataset.version}` : ""}</dd>
                <dt>Analytical role</dt><dd>{l.dataset.role} · evidence level {l.dataset.evidenceLevel} (global screening)</dd>
                {l.dataset.limitation && <><dt>Limitation</dt><dd>{l.dataset.limitation}{l.dataset.localValidation ? ". Local validation required." : ""}</dd></>}
              </>}
            </dl>
          ) : <p className={styles.error}>Provenance unknown: do not rely on this layer for a decision.</p>}
          <p>{[`refresh: ${l.refresh}`, status?.source && `via ${status.source}`, status?.updated && `loaded ${status.updated.slice(11, 16)} UTC`].filter(Boolean).join(" · ")}</p>
          {l.caveat && <p className={styles.caveat}>{l.caveat}</p>}
          {status?.error && <p className={styles.error}>{status.error}. This does not mean there is nothing there.</p>}
        </div>
      )}
    </div>
  );
}

export function IntelPanel({ catalog, base, setBase, overlays, toggle, status, records, recordsOn, toggleRecord, dayOffset, setDayOffset, runMission, firmsKey, setOpacity }: {
  catalog: OfferedLayer[]; base: string; setBase: (id: string) => void; overlays: Set<string>; toggle: (id: string) => void; status: Record<string, FeedStatus>;
  records: RecordLayer[]; recordsOn: Record<string, boolean>; toggleRecord: (k: string) => void; dayOffset: number; setDayOffset: (n: number) => void; runMission: (id: string) => void; firmsKey: boolean; setOpacity?: (id: string, v: number) => void;
}) {
  const [layerQuery,setLayerQuery]=useState("");
  const [activeOnly,setActiveOnly]=useState(false);
  // Diligence groups first; movement and space tracking stay available at the end.
  const daily = catalog.some(l => l.daily && (l.id === base || overlays.has(l.id)));
  const now = new Date();
  return (
    <>
      <h2 className={styles.panelTitle}>Workspaces</h2>
      <div className={styles.missions}>{MISSIONS.filter(m => !["live", "orbit", "capital", "partners", "grid", "portfolio", "site", "hazard", "energy", "forest"].includes(m.id)).map(m => <button key={m.id} type="button" title={m.hint} onClick={() => runMission(m.id)}>{m.label}</button>)}</div>
      <h2 className={styles.panelTitle}>Layers</h2><p className={styles.note}>Each layer shows its source, licence, coverage and freshness (ⓘ). A failed load says unavailable, never “none”.</p>
      {catalog.some(l => l.id === "power") && (
        <label className={styles.gridToggle}><input type="checkbox" checked={overlays.has("power")} onChange={() => toggle("power")} />
          <span><strong>Power grid</strong><small>Transmission lines, substations and plants (OpenStreetMap). Proximity is not available capacity, queue position or connection rights.</small></span>
          <span className={styles.count} data-state={!overlays.has("power") ? "off" : status.power?.error ? "error" : "ok"}>{!overlays.has("power") ? "" : status.power?.error ? "unavailable" : "on"}</span></label>
      )}

      <details className={styles.catalogGroup}><summary>Imagery &amp; map style</summary>
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

      </details>
      {([["Regenera portfolio", ["projects"]], ["Development", ["deals", "organizations", "triggers"]], ["Capital & opportunity", ["procurement"]]] as [string, string[]][]).map(([label, keys]) => (
        <details key={label} className={styles.catalogGroup} open><summary>{label} <span>{records.filter(r => keys.includes(r.key) && recordsOn[r.key]).length} on · {records.filter(r => keys.includes(r.key)).reduce((n, r) => n + r.count, 0)} located records</span></summary>
          {records.filter(r => keys.includes(r.key)).map(r => (
            <label key={r.key} className={styles.layerRow}>
              <input type="checkbox" checked={recordsOn[r.key]} onChange={() => toggleRecord(r.key)} />
              <span className={styles.swatch} style={{ background: r.swatch }} />
              <span className={styles.layerLabel}>{r.label}</span>
              <span className={styles.count}>{r.count}</span>
              <span />
            </label>
          ))}
        </details>
      ))}
      <details className={styles.catalogGroup}><summary>Alerts on the map</summary>
      {records.filter(r => r.key === "hazards").map(r => (
        <label key={r.key} className={styles.layerRow}>
          <input type="checkbox" checked={recordsOn[r.key]} onChange={() => toggleRecord(r.key)} />
          <span className={styles.swatch} style={{ background: r.swatch }} />
          <span className={styles.layerLabel}>{r.label}</span>
          <span className={styles.count}>{r.count}</span>
          <span />
        </label>
      ))}
      <p className={styles.note}>Filter records by type, stage, country and area in Explore.</p></details>

      <label className={styles.catalogSearch}>Find evidence layers<input value={layerQuery} onChange={e=>setLayerQuery(e.target.value)} placeholder="Grid, water, forests, hazards, provider…" /></label><label className={styles.layerRow}><input type="checkbox" checked={activeOnly} onChange={e=>setActiveOnly(e.target.checked)} />Show enabled layers only</label>
      <details className={styles.catalogGroup}><summary>Specialist exploration (aircraft, satellites, sensor looks)</summary><div className={styles.missions}>{MISSIONS.filter(m=>["live","orbit"].includes(m.id)).map(m=><button key={m.id} type="button" title={m.hint} onClick={()=>runMission(m.id)}>{m.label}</button>)}</div></details>
      {ATLAS_GROUPS.map(g => {
        const rows = catalog.filter(l => l.group !== "basemap" && atlasGroupOf(l) === g && (!activeOnly || overlays.has(l.id)) && `${l.label} ${l.description} ${l.provenance?.provider??""}`.toLowerCase().includes(layerQuery.toLowerCase()));
        if (!rows.length) return null;
        return (
          <details key={g} className={styles.catalogGroup} open={!!layerQuery || activeOnly || rows.some(l=>overlays.has(l.id))}><summary>{g} <span>{rows.filter(l=>overlays.has(l.id)).length} active · {rows.length} available</span></summary>
            {rows.map(l => <Row key={l.id} l={l.id === "fires" && firmsKey ? { ...l, description: "NASA FIRMS VIIRS 375 m detections for the view (last 24 h)." } : l} on={overlays.has(l.id)} status={status[l.id]} onToggle={() => toggle(l.id)} setOpacity={setOpacity} dated={l.daily ? productDate(now, (l.lagDays ?? 1) + dayOffset) : undefined} />)}
          </details>
        );
      })}
      <p className={styles.note}>Every layer is registered in Settings → Integrations with its licence and state; disabled or licence-required sources are never loaded. Live positions come from public sources and can lag or have gaps.</p>
    </>
  );
}
