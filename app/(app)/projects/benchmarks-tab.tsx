// Benchmarks and data checks for one project: each derivable metric compared with local / regional / scale / global
// sets (normalised, with provenance), deviations raised as questions, contradictions listed source by source, and
// the option to contribute the project's own figure back as a Regenera benchmark.
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import type { projects } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { compareValue, contradictions, projectMetrics } from "@/lib/benchmarks/engine";
import { METRICS } from "@/lib/benchmarks/vocab";
import { contributeProjectAction } from "../benchmark-actions";
import s from "./natural.module.css";

type Project = typeof projects.$inferSelect;
const FLAG: Record<string, [string, string]> = { material_above: ["MATERIAL ABOVE-BENCHMARK", "#b0432f"], above: ["Above median", "#b58a2a"], within: ["Within range", "#2f7d4f"], below: ["Below median", "#b58a2a"], material_below: ["MATERIAL BELOW-BENCHMARK", "#b0432f"], insufficient: ["Insufficient benchmarks (<3)", "#8a8f86"] };

export default async function BenchmarksTab({ project, mandateIds }: { project: Project; mandateIds: string[] }) {
  const db = appDb(), year = new Date().getUTCFullYear();
  const [metrics, conflicts] = await Promise.all([projectMetrics(db, project.id), contradictions(db, project.id)]);
  const comps = await Promise.all(metrics.map(m => compareValue(db, mandateIds, { technology: m.technology, metric: m.metric, value: m.value, currency: m.currency, year, country: project.country, scaleValue: m.scaleValue }).then(c => ({ m, c })).catch(e => ({ m, c: null, err: (e as Error).message }))));
  const f = (x: number | null, money: boolean) => (x === null ? "—" : money ? `USD ${Math.round(x).toLocaleString("en-US")}` : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Benchmarks</p>
      {metrics.length === 0 ? <p className={r.empty}>Nothing to benchmark yet: record CAPEX with capacity in MW or ha, a financial model, or a storage specification.</p> : comps.map(({ m, c }, i) => { const money = METRICS[m.metric]?.kind.startsWith("money") ?? false; return <article key={i} className={s.card}>
        <header><b>{METRICS[m.metric]?.label ?? m.metric}</b> <span className={ui.chip}>{m.technology}</span><span className={ui.sub}> {m.currency ?? ""} {m.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} {METRICS[m.metric]?.unit} · from {m.from}</span>{c && <span className={ui.chip} style={{ color: FLAG[c.flag][1] }}>{FLAG[c.flag][0]}</span>}</header>
        {c ? <>
          {c.valueNotes.length > 0 && <span className={ui.sub}>{c.valueNotes.join(" · ")}</span>}
          <table className={ui.table}><thead><tr><th>Set</th><th>n</th><th>P10</th><th>Median</th><th>P90</th><th>Project percentile</th></tr></thead><tbody>
            {c.sets.map(x => <tr key={x.name}><td>{x.name}</td><td className={ui.num}>{x.n}</td><td className={ui.num}>{f(x.p10, money)}</td><td className={ui.num}>{f(x.median, money)}</td><td className={ui.num}>{f(x.p90, money)}</td><td className={ui.num}>{x.percentile === null ? "—" : `P${x.percentile}`}</td></tr>)}
          </tbody></table>
          {c.question && <p className={ui.warn}>{c.question}</p>}
          {c.sources.length > 0 && <details><summary className={ui.sub}>Sources ({c.sources.length}) and normalisation</summary><ul className={ui.sub}>{c.sources.map(n => <li key={n.id}>{n.b.source}{n.b.sourceDate ? ` (${n.b.sourceDate})` : ""}: {n.b.currency} {n.b.value.toLocaleString("en-US")} → {f(n.usd, money)}{n.notes.length ? ` [${n.notes.join("; ")}]` : ""}</li>)}</ul></details>}
        </> : <p className={ui.warn}>Comparison failed; try again later.</p>}
        <form action={contributeProjectAction}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="metric" value={m.metric} /><input type="hidden" name="from" value={m.from} /><button className={ui.miniBtn} type="submit">Add this figure to Regenera benchmarks</button></form>
      </article>; })}
      <p className={ui.sub}>Library: <Link href="/benchmarks">Technology & cost benchmarks</Link>.</p>
    </section>
    <aside><section className={r.panel}>
      <p className={r.panelTitle}>Data consistency</p>
      <p className={ui.sub}>The same fact from different sources, side by side. Conflicts are flagged, never silently resolved.</p>
      {conflicts.length === 0 ? <p className={r.empty}>Only one source per fact so far.</p> : conflicts.map(c => <div key={c.fact} className={s.card}>
        <b style={{ color: c.material ? "#b0432f" : undefined }}>{c.fact}{c.material ? ": material conflict" : ""}</b>
        {c.values.map(v => <span key={v.source} className={ui.sub}>{v.source}: {v.currency && v.currency !== "MW" ? `${v.currency} ` : ""}{v.value.toLocaleString("en-US")}{v.currency === "MW" ? " MW" : ""}</span>)}
        <span className={ui.sub}>Spread {c.spreadPct}% · {c.note}</span></div>)}
    </section></aside>
  </div>;
}
