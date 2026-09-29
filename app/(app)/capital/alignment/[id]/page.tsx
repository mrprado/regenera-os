import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { finModels, natureAssessments, projects } from "@/db/schema";
import type { NatureItem, PathwayItem } from "@/db/alignment";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { scenarioComparison, tradeoffLines } from "@/lib/alignment/engine";
import { ALIGNMENT, ALIGNMENT_COLORS, DEPENDENCIES, DRIVERS, MATERIALITY, NATURE_RISK, PATHWAYS, PRESSURES, SUBJECT_TYPES } from "@/lib/alignment/vocab";
import type { Composition } from "@/lib/geo/landcover";
import { compactMoney } from "@/lib/projects/labels";
import { addNatureItemAction, classifyAssessmentAction, deleteScenarioAction, removeNatureItemAction, saveScenarioAction, siteBaselineAction } from "../../../alignment-actions";
import s from "../alignment.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nature transition" };

const LISTS = [
  { key: "dependencies", title: "Dependencies", hint: "Which ecosystem services does the activity rely on?", kinds: DEPENDENCIES },
  { key: "impacts", title: "Impacts", hint: "Which pressures on nature does it create? Add a metric where measured.", kinds: PRESSURES },
  { key: "drivers", title: "Financial drivers", hint: "Why is the current model financially attractive? (subsidy, unpriced externality, cheap land …)", kinds: DRIVERS },
] as const;
const fmtPct = (x: number | null, unit = "%") => (x === null ? "—" : `${x > 0 ? "+" : ""}${x}${unit}`);

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/capital/alignment/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [a] = await db.select().from(natureAssessments).where(and(eq(natureAssessments.id, id), mandateCondition(user.scope, natureAssessments.mandateId)));
  if (!a) notFound();
  const [project] = a.projectId ? await db.select({ id: projects.id, name: projects.name, geometry: projects.geometry }).from(projects).where(eq(projects.id, a.projectId)) : [];
  const models = a.projectId ? await db.select({ id: finModels.id, name: finModels.name, version: finModels.version, summary: finModels.summary }).from(finModels).where(eq(finModels.projectId, a.projectId)).orderBy(desc(finModels.updatedAt)) : [];
  const views = await scenarioComparison(db, id);
  const lines = tradeoffLines(views);
  const base = a.siteBaseline as (Composition & { at?: string }) | null;

  return (
    <>
      <PageHeader title={a.name} />
      <Notice text={sp.notice} />
      <p className={ui.sub}><Link href="/capital/alignment?tab=assessments">← Nature transition</Link> · {SUBJECT_TYPES[a.subjectType]}{project ? <> · <Link href={`/projects/${project.id}`}>{project.name}</Link></> : null} · capital covered {compactMoney(a.capitalAmount ?? 0, a.currency)}</p>

      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Alignment</span><span className={ui.chip}><i className={s.dot} style={{ background: ALIGNMENT_COLORS[a.alignment] }} /> {ALIGNMENT[a.alignment]}</span></p>
          {a.alignment !== "unclassified" ? <p className={ui.sub}>Basis ({a.classifiedBy}, {a.classifiedAt?.slice(0, 10)}): {a.alignmentBasis}</p> : <p className={ui.sub}>Unclassified until a person records a classification with its basis.</p>}
          <form action={classifyAssessmentAction} className={s.inline}>
            <input type="hidden" name="assessmentId" value={a.id} />
            <label>Classification<select name="alignment" defaultValue={a.alignment}>{Object.entries(ALIGNMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className={s.wide}>Basis (evidence, mechanism, scope)<textarea name="basis" rows={2} defaultValue={a.alignmentBasis} /></label>
            <button className={ui.miniBtn} type="submit">Record classification</button>
          </form>
        </section>
        <aside><section className={r.panel}>
          <p className={r.panelTitle}><span>Site baseline</span><span className={ui.chip}>SCREENING</span></p>
          {base ? <>
            <p className={ui.sub}>{base.source}, ~{base.resolutionM} m cells, {base.siteHa} ha site{base.at ? `, read ${base.at.slice(0, 10)}` : ""}.</p>
            <div style={{ display: "grid", gap: 3 }}>{base.classes.map(c => <div key={c.code} className={s.lc}><i className={s.dot} style={{ background: c.color }} /><span>{c.label}{c.natural ? "" : ""}</span><span className={ui.num}>{c.ha} ha</span><span className={ui.num}>{c.pct}%</span></div>)}</div>
            <p>Natural cover: <b>{base.naturalHa} ha ({base.naturalPct}%)</b> · cropland + built: {base.convertedHa} ha · water: {base.waterHa} ha</p>
            <p className={ui.sub}>{base.limitation}</p><p className={ui.sub}>{base.attribution}</p>
          </> : <p className={ui.sub}>Land-cover composition of the project boundary from ESA WorldCover 10 m (free, CC BY 4.0).{project && !project.geometry ? " The project has no boundary yet: draw it in Atlas → Workbench." : ""}</p>}
          {a.projectId && <form action={siteBaselineAction}><input type="hidden" name="assessmentId" value={a.id} /><button className={ui.miniBtn} type="submit">{base ? "Re-read baseline" : "Read site baseline"}</button></form>}
        </section></aside>
      </div>

      <div className={s.cols}>
        {LISTS.map(L => <section key={L.key} className={r.panel}>
          <p className={r.panelTitle}>{L.title}</p><p className={ui.sub}>{L.hint}</p>
          <Items list={L.key} items={a[L.key]} kinds={L.kinds} assessmentId={a.id} />
          <form action={addNatureItemAction} className={s.inline}>
            <input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="list" value={L.key} />
            <label>Kind<select name="kind">{Object.entries(L.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Materiality<select name="materiality" defaultValue="unknown">{Object.entries(MATERIALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {L.key === "impacts" && <><label>Metric<input name="metric" placeholder="Habitat converted" /></label><label>Value<input name="value" inputMode="decimal" /></label><label>Unit<input name="unit" placeholder="ha" /></label></>}
            <label className={s.wide}>Description<input name="description" required /></label>
            <label className={s.wide}>Evidence (required)<input name="evidence" required placeholder="Study, dataset, observation or document" /></label>
            <button className={ui.miniBtn} type="submit">Add</button>
          </form>
        </section>)}
        <section className={r.panel}>
          <p className={r.panelTitle}>Transition pathways</p><p className={ui.sub}>What changes could alter the economics? Estimated deltas are inputs, not outputs.</p>
          <ul className={s.items}>{a.pathways.map((p: PathwayItem) => <li key={p.id}><header><b>{PATHWAYS[p.kind as keyof typeof PATHWAYS] ?? p.kind}</b><RemoveBtn list="pathways" itemId={p.id} assessmentId={a.id} /></header><span>{p.description}</span><small>CAPEX {fmtPct(p.capexDeltaPct ?? null)} · impact {fmtPct(p.impactDeltaPct ?? null)} · {p.evidence}</small></li>)}</ul>
          <form action={addNatureItemAction} className={s.inline}>
            <input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="list" value="pathways" />
            <label>Pathway<select name="kind">{Object.entries(PATHWAYS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>CAPEX Δ %<input name="capexDeltaPct" inputMode="decimal" /></label><label>Impact Δ %<input name="impactDeltaPct" inputMode="decimal" /></label>
            <label className={s.wide}>Description<input name="description" required /></label>
            <label className={s.wide}>Evidence / rationale (required)<input name="evidence" required /></label>
            <button className={ui.miniBtn} type="submit">Add</button>
          </form>
        </section>
      </div>

      <section className={r.panel}>
        <p className={r.panelTitle}>Nature-adjusted scenarios</p>
        <p className={ui.sub}>Financial results and nature metrics side by side, never blended into one score. Link a financial model to take CAPEX and IRR from its stored outputs; nature costs are monetised only when a methodology is stated.</p>
        {views.length === 0 ? <p className={r.empty}>No scenarios yet. Start with the conventional configuration as the baseline.</p> : <div className={ui.tableWrap}><table className={`${ui.table} ${s.cmp}`}>
          <thead><tr><th>Scenario</th><th>CAPEX</th><th>Δ</th><th>Project IRR</th><th>Δ</th><th>Habitat loss</th><th>Δ</th><th>Restoration</th><th>Water</th><th>Nature risk</th><th>Monetised nature cost (net)</th><th>Finance</th><th /></tr></thead>
          <tbody>{views.map((v, i) => <tr key={v.id}>
            <td className={ui.primary}>{v.name}<span className={ui.sub}>{i === 0 ? "baseline · " : ""}{v.configuration}{v.fromModel ? " · from model" : ""}</span></td>
            <td className={ui.num}>{v.capexUsed === null ? "—" : compactMoney(v.capexUsed, a.currency)}</td><td className={ui.num}>{fmtPct(v.deltas.capexPct)}</td>
            <td className={ui.num}>{v.irrUsed === null ? "—" : `${v.irrUsed}%`}</td><td className={ui.num}>{fmtPct(v.deltas.irrPp, " pp")}</td>
            <td className={ui.num}>{v.habitatLossHa === null ? "—" : `${v.habitatLossHa} ha`}</td><td className={`${ui.num} ${v.deltas.habitatPct !== null && v.deltas.habitatPct < 0 ? s.good : ""}`}>{fmtPct(v.deltas.habitatPct)}</td>
            <td className={ui.num}>{v.restorationHa ? `${v.restorationHa} ha` : "—"}</td><td className={ui.num}>{v.waterDemandM3 === null ? "—" : `${Math.round(v.waterDemandM3).toLocaleString("en-US")} m³/yr`}</td>
            <td className={v.natureRisk === "high" ? s.bad : undefined}>{NATURE_RISK[v.natureRisk]}</td>
            <td className={ui.num}>{v.natureCostMonetised === null ? <span className={ui.sub}>not monetised</span> : compactMoney(v.natureCostMonetised, a.currency)}</td>
            <td className={ui.sub}>{v.finance || "—"}</td>
            <td><form action={deleteScenarioAction}><input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="scenarioId" value={v.id} /><button className={ui.miniBtn} type="submit" aria-label={`Remove ${v.name}`}>×</button></form></td>
          </tr>)}</tbody></table></div>}
        {lines.length > 0 && <ul>{lines.map(l => <li key={l}>{l}</li>)}</ul>}
        <form action={saveScenarioAction} className={s.inline}>
          <input type="hidden" name="assessmentId" value={a.id} />
          <label>Name<input name="name" required placeholder={views.length ? "Lower-impact configuration" : "Conventional development"} /></label>
          <label>Financial model<select name="finModelId" defaultValue=""><option value="">None: enter CAPEX / IRR</option>{models.map(m => <option key={m.id} value={m.id}>{m.name} v{m.version}{typeof m.summary.projectIrr === "number" ? ` · IRR ${m.summary.projectIrr}%` : ""}</option>)}</select></label>
          <label>CAPEX<input name="capex" inputMode="decimal" /></label><label>Project IRR %<input name="irrPct" inputMode="decimal" /></label>
          <label>Habitat loss (ha)<input name="habitatLossHa" inputMode="decimal" placeholder={base ? `site natural cover ${base.naturalHa}` : ""} /></label><label>Restoration (ha)<input name="restorationHa" inputMode="decimal" /></label>
          <label>Water demand (m³/yr)<input name="waterDemandM3" inputMode="decimal" /></label>
          <label>Nature risk<select name="natureRisk" defaultValue="unknown">{Object.entries(NATURE_RISK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Mitigation cost<input name="mitigationCost" inputMode="decimal" /></label><label>Restoration cost<input name="restorationCost" inputMode="decimal" /></label><label>Transition cost<input name="transitionCost" inputMode="decimal" /></label>
          <label>Environmental liability<input name="environmentalLiability" inputMode="decimal" /></label><label>Natural capital revenue<input name="naturalCapitalRevenue" inputMode="decimal" /></label><label>Avoided risk<input name="avoidedRisk" inputMode="decimal" /></label>
          <label className={s.wide}>Configuration<input name="configuration" placeholder="Layout, technology, footprint" /></label>
          <label className={s.wide}>Valuation methodology (without one, costs are not monetised)<input name="methodology" /></label>
          <label className={s.wide}>Finance potential<input name="finance" placeholder="e.g. Biodiversity finance potential; concessional capital potential" /></label>
          <button className={ui.miniBtn} type="submit">Add scenario</button>
        </form>
      </section>
    </>
  );
}

function Items({ list, items, kinds, assessmentId }: { list: string; items: NatureItem[]; kinds: Record<string, string>; assessmentId: string }) {
  if (!items.length) return <p className={r.empty}>None recorded.</p>;
  return <ul className={s.items}>{items.map(i => <li key={i.id}>
    <header><b>{kinds[i.kind] ?? i.kind} <span className={ui.chip}>{MATERIALITY[i.materiality]}</span></b><RemoveBtn list={list} itemId={i.id} assessmentId={assessmentId} /></header>
    <span>{i.description}{i.metric ? ` · ${i.metric}: ${i.value ?? "—"} ${i.unit ?? ""}` : ""}</span><small>Evidence: {i.evidence}</small>
  </li>)}</ul>;
}

function RemoveBtn({ list, itemId, assessmentId }: { list: string; itemId: string; assessmentId: string }) {
  return <form action={removeNatureItemAction}><input type="hidden" name="assessmentId" value={assessmentId} /><input type="hidden" name="list" value={list} /><input type="hidden" name="itemId" value={itemId} /><button className={ui.miniBtn} type="submit" aria-label="Remove">×</button></form>;
}
