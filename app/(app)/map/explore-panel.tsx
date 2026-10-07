"use client";

// Atlas contents panel: work objective → project/site context → asset/project types → lifecycle & geography → record types →
// active filters and results. Every control filters the same record set the map draws; evidence layers live in their own
// tab and never change these filters. Counts on type chips are computed from the records matching every OTHER active filter.
import Link from "next/link";
import type { ComponentType } from "react";
import { BatteryCharging, Building2, ChevronsLeft, CircleDot, Droplets, Factory, Flame, Fuel, PlugZap, Recycle, Sun, Trees, Truck, UtilityPole, Users, Waves, Wheat, Wind, X } from "lucide-react";
import { ASSET_TYPES, LIFECYCLE, type MapRecord } from "@/lib/map/discovery";
import { OBJECTIVES, type Objective } from "@/lib/map/objectives";
import styles from "./map.module.css";

const TYPE_ICON: Record<string, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  solar: Sun, wind: Wind, storage: BatteryCharging, solar_storage: BatteryCharging, ev_charging: PlugZap, land_real_estate: Building2, water: Droplets,
  agriculture: Wheat, nature_restoration: Trees, community: Users, industrial_redevelopment: Factory, hydro: Waves, geothermal: Flame, grid: UtilityPole,
  hydrogen: Fuel, waste_to_value: Recycle, transport: Truck, other: CircleDot,
};
export const RECORD_LABEL: Record<string, string> = { projects: "Projects", organizations: "Organizations", deals: "Opportunities", procurement: "Funding, tenders & calls", triggers: "Signals" };
export type Scope = "all" | "view" | "boundary";
export type ContextInfo = { id: string; name: string; stage: string | null; location: string; role: string | null; hasBoundary: boolean; loading: boolean; gaps: string[] } | null;

export function ExplorePanel(p: {
  objective: Objective; setObjective: (id: string) => void; suggestionText: { add: string[]; already: string[]; unavailable: string[] }; applySuggestion: () => void; canApply: boolean;
  projects: { id: string; name: string }[]; contextId: string; setContextId: (id: string) => void; context: ContextInfo; openWorkbench: () => void; unmappedProjects: number;
  typeCounts: Record<string, number>; unclassified: number; types: string[]; toggleType: (t: string) => void;
  lifecycle: string; setLifecycle: (v: string) => void; countries: string[]; country: string; setCountry: (v: string) => void;
  regions: string[]; region: string; setRegion: (v: string) => void; scope: Scope; setScope: (s: Scope) => void;
  recordCounts: Record<string, number>; visible: Record<string, boolean>; toggleRecord: (k: string) => void;
  query: string; clearQuery: () => void; filtered: MapRecord[]; total: number; limit: number; more: () => void;
  onPick: (m: MapRecord) => void; selectedKey: string | null; swatch: (layer: string) => string;
  clearFilters: () => void; fitResults: () => void; canFit: boolean; collapse: () => void; loadNote: string | null;
}) {
  const typeKeys = Object.keys(ASSET_TYPES).filter(k => (p.typeCounts[k] ?? 0) > 0 || p.types.includes(k));
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(p.context ? [{ key: "ctx", label: `Project: ${p.context.name}`, clear: () => p.setContextId("") }] : []),
    ...p.types.map(t => ({ key: `t:${t}`, label: ASSET_TYPES[t] ?? t, clear: () => p.toggleType(t) })),
    ...(p.lifecycle ? [{ key: "lc", label: LIFECYCLE.find(l => l.key === p.lifecycle)?.label ?? p.lifecycle, clear: () => p.setLifecycle("") }] : []),
    ...(p.country ? [{ key: "c", label: p.country, clear: () => p.setCountry("") }] : []),
    ...(p.region ? [{ key: "r", label: p.region, clear: () => p.setRegion("") }] : []),
    ...(p.scope !== "all" ? [{ key: "s", label: p.scope === "view" ? "Current map area" : "Inside selected boundary", clear: () => p.setScope("all") }] : []),
    ...Object.keys(RECORD_LABEL).filter(k => p.visible[k] === false).map(k => ({ key: `h:${k}`, label: `Hiding ${RECORD_LABEL[k].toLowerCase()}`, clear: () => p.toggleRecord(k) })),
    ...(p.query ? [{ key: "q", label: `“${p.query}”`, clear: p.clearQuery }] : []),
  ];
  const byLayer = Object.keys(RECORD_LABEL).map(k => [k, p.filtered.filter(r => r.layer === k).length] as const).filter(([, n]) => n > 0);

  return (
    <>
      <div className={styles.panelHead}>
        <div><h2 className={styles.panelTitle}>Explore projects &amp; opportunities</h2><p className={styles.note}>Connect places, projects and evidence to your next decision.</p></div>
        <button type="button" className={styles.iconBtn} onClick={p.collapse} aria-label="Collapse panel to show more map" title="Collapse panel (L)"><ChevronsLeft size={16} /></button>
      </div>

      <section className={styles.block} aria-labelledby="ex-obj">
        <label className={styles.field} id="ex-obj">Work objective
          <select value={p.objective.id} onChange={e => p.setObjective(e.target.value)}>{OBJECTIVES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </label>
        <p className={styles.note}>{p.objective.note}</p>
        {(p.suggestionText.add.length > 0 || p.suggestionText.unavailable.length > 0) && (
          <div className={styles.suggest}>
            {p.suggestionText.add.length > 0 && <p>Suggested evidence layers: {p.suggestionText.add.join(", ")}. Your enabled layers stay on.</p>}
            {p.suggestionText.unavailable.length > 0 && <p className={styles.caveat}>Not available in this workspace: {p.suggestionText.unavailable.join(", ")}.</p>}
            {p.canApply && <button type="button" className={styles.action} onClick={p.applySuggestion}>Apply suggested layers</button>}
          </div>
        )}
        {p.suggestionText.add.length === 0 && p.suggestionText.already.length > 0 && <p className={styles.note}>Suggested layers already on: {p.suggestionText.already.join(", ")}.</p>}
        {p.objective.actions.length > 0 && <p className={styles.links}>{p.objective.actions.map(a => <Link key={a.href} href={a.href}>{a.label}</Link>)}</p>}
      </section>

      <section className={styles.block}>
        <label className={styles.field}>Project or site
          <select value={p.contextId} onChange={e => p.setContextId(e.target.value)}><option value="">All accessible projects</option>{p.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
        {p.context && (
          <div className={styles.contextCard} aria-live="polite">
            <strong>{p.context.name}</strong>
            <span>{[p.context.stage ?? "Stage not recorded", p.context.location || "Location label not recorded", p.context.role ? `Regenera: ${p.context.role}` : null].filter(Boolean).join(" · ")}</span>
            {p.context.loading ? <span>Loading site record…</span> : p.context.gaps.length > 0 && <span className={styles.caveat}>Gaps: {p.context.gaps.join("; ")}</span>}
            <span className={styles.links}><Link href={`/projects/${p.context.id}`}>Open project</Link><Link href={`/projects/${p.context.id}?tab=place`}>Review site / Place</Link><button type="button" onClick={p.openWorkbench}>Site workbench</button></span>
          </div>
        )}
        {p.unmappedProjects > 0 && <p className={styles.note}>{p.unmappedProjects} project{p.unmappedProjects === 1 ? " has" : "s have"} no recorded location and cannot be placed. <Link href="/projects">Review projects</Link></p>}
      </section>

      <fieldset className={styles.block}>
        <legend className={styles.fieldLabel}>Asset / project type</legend>
        {typeKeys.length === 0 ? <p className={styles.note}>No accessible project has a recorded asset class or technology.</p> : (
          <div className={styles.typeChips}>{typeKeys.map(k => { const Icon = TYPE_ICON[k] ?? CircleDot; return (
            <button key={k} type="button" aria-pressed={p.types.includes(k)} onClick={() => p.toggleType(k)}><Icon size={15} aria-hidden /> {ASSET_TYPES[k]} <small>{p.typeCounts[k] ?? 0}</small></button>); })}</div>
        )}
        <p className={styles.note}>From each project&apos;s recorded asset class and technology; a project can have several. {p.unclassified > 0 ? `${p.unclassified} project${p.unclassified === 1 ? " has" : "s have"} no recorded type and drop out when a type is selected.` : ""}</p>
      </fieldset>

      <section className={styles.block}>
        <div className={styles.pair}>
          <label className={styles.field}>Lifecycle<select value={p.lifecycle} onChange={e => p.setLifecycle(e.target.value)}><option value="">All stages</option>{LIFECYCLE.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
          <label className={styles.field}>Market / country<select value={p.country} onChange={e => p.setCountry(e.target.value)}><option value="">All countries</option>{p.countries.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        </div>
        <div className={styles.pair}>
          <label className={styles.field}>Region<select value={p.region} onChange={e => p.setRegion(e.target.value)} disabled={!p.regions.length}><option value="">{p.regions.length ? "All regions" : "No regions recorded"}</option>{p.regions.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
          <label className={styles.field}>Geography scope<select value={p.scope} onChange={e => p.setScope(e.target.value as Scope)}>
            <option value="all">All accessible locations</option><option value="view">Current map area</option>
            <option value="boundary" disabled={!p.context?.hasBoundary}>Selected project boundary{p.context?.hasBoundary ? "" : " (none recorded)"}</option></select></label>
        </div>
        {p.lifecycle && <p className={styles.note}>Lifecycle applies to projects; other record types are hidden while it is set.</p>}
      </section>

      <fieldset className={styles.block}>
        <legend className={styles.fieldLabel}>Record types</legend>
        <div className={styles.typeChips}>{Object.keys(RECORD_LABEL).map(k => <button key={k} type="button" aria-pressed={p.visible[k] !== false} onClick={() => p.toggleRecord(k)}><span className={styles.swatch} style={{ background: p.swatch(k) }} aria-hidden /> {RECORD_LABEL[k]} <small>{p.recordCounts[k] ?? 0}</small></button>)}</div>
        <p className={styles.note}>Hazards and other external layers are in Evidence layers; they never count as records.</p>
      </fieldset>

      <section className={styles.block} aria-label="Active filters and results">
        {chips.length > 0 && <div className={styles.activeChips}>{chips.map(c => <button key={c.key} type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>{c.label} <X size={12} aria-hidden /></button>)}</div>}
        <div className={styles.resultBar}>
          <p role="status" aria-live="polite"><strong>{p.filtered.length}</strong> matching record{p.filtered.length === 1 ? "" : "s"} of {p.total}{byLayer.length > 1 ? ` · ${byLayer.map(([k, n]) => `${n} ${RECORD_LABEL[k].toLowerCase()}`).join(", ")}` : ""}</p>
          <span><button type="button" onClick={p.clearFilters} disabled={!chips.length}>Clear filters</button><button type="button" className={styles.action} onClick={p.fitResults} disabled={!p.canFit}>Fit results</button></span>
        </div>
        {p.loadNote && <p className={styles.note}>{p.loadNote}</p>}
        {!p.loadNote && p.filtered.length === 0 && <p className={styles.note}>No matching records. Adjust filters, search a place, or review records missing location data.</p>}
        <ul className={styles.directory} aria-label="Matching records">
          {p.filtered.slice(0, p.limit).map(m => <li key={m.key}>
            <button type="button" onClick={() => p.onPick(m)} aria-pressed={p.selectedKey === m.key}>
              <span className={styles.swatch} style={{ background: p.swatch(m.layer) }} aria-hidden />
              <span><strong>{m.label}</strong><small>{RECORD_LABEL[m.layer] ?? m.layer}{m.location ? ` · ${m.location}` : ""}</small></span>
            </button>
          </li>)}
        </ul>
        {p.filtered.length > p.limit && <button className={styles.more} type="button" onClick={p.more}>Show 50 more</button>}
      </section>
    </>
  );
}
