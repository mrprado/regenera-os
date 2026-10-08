"use client";

// Right intelligence inspector (phase 21 Atlas §2D): opens on selection, tabs shown only when they have content.
// Overview is the layer-specific detail; Spatial, Evidence, Capital and Actions are generic; a site screen runs here
// and its stages stream in, each saved by the site-intelligence engine (nothing here is client-only state).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import { Detail, type Selected } from "./detail";
import styles from "./map.module.css";

type Stage = { key: string; status: string; summary?: string; error?: string; facts?: { label: string; value: string; source: string; kind?: string; data?: Record<string, unknown> }[] };
export type Screen = { projectId: string | null; runId: string | null; stages: Stage[]; error?: string; busy: boolean };

const EVIDENCE: Record<string, string> = {
  power: "OSM-mapped (community). Not registry-listed, not a modeled corridor, not utility-confirmed.",
  registry_plants: "Registry-listed (WRI Global Power Plant Database v1.3, 2021). Not utility-confirmed.",
  projects: "Regenera record. Figures are as recorded; claims carry their own evidence status. Hollow blue markers are public-pipeline projects (World Bank), not Regenera mandates.",
  organizations: "Regenera Network record (identity enrichment from GLEIF / Wikidata where linked).",
  procurement: "Funding or tender record as published by the source; eligibility and deadline need confirmation.",
  triggers: "Signal from a public source; not independent verification of the event.",
  hazards: "GDACS alert (modelled impact estimate).",
};

const STAGE_LABEL: Record<string, string> = {
  spatial: "Spatial", energy: "Energy resource", grid: "Grid", water: "Water", ecology: "Ecology", land: "Land & terrain", remote_sensing: "Remote sensing",
  infrastructure: "Infrastructure", climate: "Climate & hazards", community: "Community", regulatory: "Regulatory", finance: "Finance", capital: "Capital & opportunities", partners: "Partners", assessment: "Saved assessment",
};

export function useSiteScreen() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const drive = async (runId: string) => {
    for (let i = 0; i < 40 && live.current; i++) {
      const r = await fetch(withBase(`/api/site-intel/${runId}`), { method: "POST" }).catch(() => null);
      if (!r?.ok) { setScreen(s => s && { ...s, busy: false, error: "A stage could not run; the background job will finish it." }); return; }
      const d = await r.json() as { stages: Stage[]; busy?: boolean };
      setScreen(s => s && { ...s, stages: d.stages });
      if (!d.stages.some(x => x.status === "queued" || x.status === "running")) break;
      if (d.busy) await new Promise(res => setTimeout(res, 1500));
    }
    setScreen(s => s && { ...s, busy: false });
  };
  const start = async (at: [number, number], projectId?: string) => {
    setScreen({ projectId: projectId ?? null, runId: null, stages: [], busy: true });
    const r = await fetch(withBase("/api/atlas/screen"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lng: at[0], lat: at[1], projectId }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) as { projectId?: string; runId?: string; stages?: Stage[]; error?: string } : { error: "Network error" };
    if (!r?.ok || !d.runId) { setScreen({ projectId: d.projectId ?? null, runId: null, stages: [], busy: false, error: d.error ?? "Could not start the screen" }); return; }
    setScreen({ projectId: d.projectId ?? null, runId: d.runId, stages: d.stages ?? [], busy: true });
    await drive(d.runId);
  };
  return { screen, start, clear: () => setScreen(null) };
}

function ScreenView({ screen }: { screen: Screen }) {
  const done = screen.stages.filter(s => s.status === "done").length;
  const doc = screen.stages.find(s => s.key === "assessment")?.facts?.find(f => f.data?.documentId)?.data?.documentId as string | undefined;
  return (
    <div className={styles.screen}>
      <p className={styles.kicker}>Site screen {screen.busy ? `· running ${done}/${screen.stages.length || "…"}` : "· finished"}</p>
      {screen.error && <p className={styles.error} role="alert">{screen.error}</p>}
      <ol className={styles.stageList}>
        {screen.stages.map(s => (
          <li key={s.key} data-status={s.status}>
            <b>{STAGE_LABEL[s.key] ?? s.key}</b> <span>{s.status === "done" ? s.summary : s.status === "failed" ? `unavailable: ${s.error ?? ""}` : s.status === "skipped" ? s.summary ?? "skipped" : s.status}</span>
            {s.status === "done" && (s.facts?.length ?? 0) > 0 && <details><summary>{s.facts!.length} facts</summary><ul>{s.facts!.slice(0, 12).map((f, i) => <li key={i}>{f.label}: {f.value} <small>({f.source}{f.kind ? ` · ${f.kind}` : ""})</small></li>)}</ul></details>}
          </li>
        ))}
      </ol>
      <p className={styles.links}>
        {screen.projectId && <Link href={`/projects/${screen.projectId}`}>Open the site record</Link>}
        {screen.projectId && <Link href={`/projects/${screen.projectId}?tab=capital`}>Capital & partner scans</Link>}
        {doc && <a href={withBase(`/api/documents/generated/${doc}`)} target="_blank" rel="noreferrer">Saved assessment</a>}
      </p>
      <p className={styles.note}>Screening grade. Proximity to a line or substation is not available interconnection capacity. Each stage is saved on the site record with its sources.</p>
    </div>
  );
}

type Tab = "overview" | "spatial" | "evidence" | "capital" | "actions" | "screen";

export function Inspector({ selected, onClose, tracked, onTrack, onChase, screen, onScreen, links, extra }: {
  selected: Selected; onClose: () => void; tracked: boolean; onTrack: () => void; onChase: () => void;
  screen: Screen | null; onScreen: (at: [number, number], projectId?: string) => void; links: [string, string][]; extra?: React.ReactNode;
}) {
  // The parent keys this component by "screen vs selection", so a new screen opens on its tab without an effect.
  const [tab, setTab] = useState<Tab>(screen ? "screen" : "overview");
  if (!selected && !screen) return null;
  const p = selected?.props ?? {};
  const isProject = selected?.layer === "projects";
  const tabs: [Tab, string][] = [
    ...(selected ? [["overview", "Overview"], ["spatial", "Spatial"], ["evidence", "Evidence"]] as [Tab, string][] : []),
    ...(isProject ? [["capital", "Capital"]] as [Tab, string][] : []),
    ...(selected ? [["actions", "Actions"]] as [Tab, string][] : []),
    ...(screen ? [["screen", "Site screen"]] as [Tab, string][] : []),
  ];
  const id = String(p.id ?? "");
  return (
    <aside className={`${styles.glass} ${styles.detail} ${styles.inspector}`} aria-label="Intelligence inspector">
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close inspector">×</button>
      <div className={styles.inspectorTabs} role="tablist">{tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div>
      {tab === "overview" && selected && <><Detail selected={selected} tracked={tracked} onTrack={onTrack} onChase={onChase} />{extra}</>}
      {tab === "spatial" && selected && (
        <dl className={styles.facts}>
          <div><dt>Coordinates</dt><dd>{selected.lngLat[1].toFixed(5)}, {selected.lngLat[0].toFixed(5)}</dd></div>
          {Boolean(p.locationBasis) && <div><dt>Location basis</dt><dd>{String(p.locationBasis)}</dd></div>}
          {Boolean(p.country) && <div><dt>Country</dt><dd>{String(p.country)}</dd></div>}
          <div><dt>Context</dt><dd>Run a site screen for grid distance, water, ecology, terrain, hazards, capital and partners at this point.</dd></div>
        </dl>
      )}
      {tab === "evidence" && selected && (
        <dl className={styles.facts}>
          <div><dt>Evidence class</dt><dd>{EVIDENCE[selected.layer] ?? "Catalogue layer: see its provenance in Layers."}</dd></div>
          {Boolean(p.source) && <div><dt>Source</dt><dd>{String(p.source)}</dd></div>}
          {Boolean(p.sourceOfRecord) && <div><dt>Cited by registry</dt><dd>{String(p.sourceOfRecord)}</dd></div>}
          {Boolean(p.updatedAt ?? p.retrievedAt) && <div><dt>Updated</dt><dd>{String(p.updatedAt ?? p.retrievedAt).slice(0, 10)}</dd></div>}
          {Boolean(p.vintage) && <div><dt>Dataset</dt><dd>{String(p.vintage)}</dd></div>}
        </dl>
      )}
      {tab === "capital" && isProject && (
        <p className={styles.links}><Link href={`/projects/${id}?tab=capital`}>Capital tab</Link><Link href={`/projects/${id}?tab=matches`}>Matches</Link><Link href={`/capital/providers?project=${id}`}>Capital providers</Link></p>
      )}
      {tab === "actions" && selected && (
        <>
          <p className={styles.links}>{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</p>
          <button type="button" className={styles.action} onClick={() => onScreen(selected.lngLat, isProject ? id : undefined)}>{isProject ? "Run site screen for this project" : "Screen this location as a site"}</button>
          <p className={styles.note}>A screen saves a site record (or reuses this project), runs every stage and saves a preliminary assessment with a review task. Nothing is sent or committed.</p>
        </>
      )}
      {tab === "screen" && screen && <ScreenView screen={screen} />}
    </aside>
  );
}
