"use client";

// RUN SITE INTELLIGENCE: starts a run, then drives it one stage per request so the page stays interactive and each
// stage's results appear the moment they exist. Leaving the page is safe: the cron tick finishes the run.
import { useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import type { StageState } from "@/db/siteintel";
import s from "./site-intel.module.css";

const LABELS: Record<string, string> = { spatial: "Spatial analysis", energy: "Energy resource", grid: "Grid", water: "Water", ecology: "Ecology", land: "Land & terrain", infrastructure: "Infrastructure", climate: "Climate & hazards", community: "Community", regulatory: "Regulatory", finance: "Finance relevance" };
type Run = { id: string; status: string; stages: StageState[]; createdAt?: string };

export default function SiteIntelPanel({ projectId, initial, stale }: { projectId: string; initial: Run | null; stale: boolean }) {
  const [run, setRun] = useState<Run | null>(initial);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const driving = useRef(false);

  async function drive(id: string) {
    if (driving.current) return;
    driving.current = true;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await fetch(withBase(`/api/site-intel/${id}`), { method: "POST" });
        if (!r.ok) { setError("A step failed to run; the job queue will retry it."); break; }
        const j = (await r.json()) as Run & { busy?: boolean };
        setRun(j);
        if (!j.stages.some(x => x.status === "queued")) break;
        if (j.busy) await new Promise(res => setTimeout(res, 2000));
      }
    } finally { driving.current = false; }
  }

  useEffect(() => {
    // Resume a run that is still in progress when the panel mounts.
    if (initial && initial.stages.some(x => x.status === "queued")) void drive(initial.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError("");
    const r = await fetch(withBase("/api/site-intel"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId }) });
    const j = (await r.json()) as Run & { error?: string };
    if (!r.ok) { setError(j.error ?? "Could not start"); return; }
    setRun(j);
    void drive(j.id);
  }

  const busy = !!run?.stages.some(x => x.status === "queued" || x.status === "running");
  const done = run?.stages.filter(x => x.status === "done" || x.status === "failed").length ?? 0;
  return (
    <section className={s.panel}>
      <header className={s.head}>
        <div><b>Site intelligence</b><span className={s.sub}>{run ? `${run.status === "complete" ? "Complete" : run.status === "partial" ? "Complete with gaps" : `Running · ${done}/${run.stages.length}`}${run.createdAt ? ` · started ${run.createdAt.slice(0, 16).replace("T", " ")}` : ""}` : "Not run yet"}{stale && run && !busy ? " · the site changed since this run" : ""}</span></div>
        <button className="btn btn--primary" type="button" onClick={start} disabled={busy}>{busy ? "Running…" : run ? "Run again" : "Run site intelligence"}</button>
      </header>
      {error && <p className={s.err}>{error}</p>}
      {run && <div className={s.bar} aria-hidden><i style={{ width: `${(done / run.stages.length) * 100}%` }} /></div>}
      {run && <ol className={s.stages}>{run.stages.map(x => (
        <li key={x.key} className={s[x.status]}>
          <button type="button" className={s.row} onClick={() => setOpen(open === x.key ? null : x.key)} aria-expanded={open === x.key} disabled={!x.facts?.length && !x.error}>
            <span className={s.dot} />
            <span className={s.name}>{LABELS[x.key] ?? x.key}</span>
            <span className={s.sum}>{x.status === "queued" ? "Queued" : x.status === "running" ? "Analysing…" : x.status === "failed" ? `Unavailable: ${x.error}` : x.summary}</span>
          </button>
          {open === x.key && x.facts && <dl className={s.facts}>{x.facts.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}<small>{f.source}</small></dd></div>)}</dl>}
        </li>))}</ol>}
      <p className={s.sub}>Screening grade from free public sources (NASA POWER, OpenStreetMap, ESA WorldCover, GBIF, Copernicus DEM, USGS, World Bank) and Regenera&apos;s own records. Community stages report counts only; governed knowledge never enters this analysis.</p>
    </section>
  );
}
