import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalFlows, incentives, natureAssessments, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { capitalAlignment, flowSummary, incentiveEvidenceGaps } from "@/lib/alignment/engine";
import { ALIGNMENT, ALIGNMENT_COLORS, CAPITAL_ROLES, FLOW_SECTORS, INCENTIVE_CLASS, INCENTIVE_SECTORS, MECHANISMS, REDIRECTABLE, SUBJECT_TYPES, type Alignment } from "@/lib/alignment/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { createAssessmentAction, saveFlowAction, saveIncentiveAction } from "../../alignment-actions";
import s from "./alignment.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital alignment" };

const TABS = [["overview", "Capital alignment"], ["assessments", "Nature transition"], ["flows", "Financial flows"], ["incentives", "Subsidies & incentives"]] as const;
const ORDER: Alignment[] = ["nature_positive", "transition", "neutral", "potentially_negative", "unclassified"];
const INC_COLORS: Record<keyof typeof INCENTIVE_CLASS, string> = { nature_positive: ALIGNMENT_COLORS.nature_positive, transitional: ALIGNMENT_COLORS.transition, neutral: ALIGNMENT_COLORS.neutral, potentially_negative: ALIGNMENT_COLORS.potentially_negative, unclassified: ALIGNMENT_COLORS.unclassified };

export default async function AlignmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capital/alignment");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const db = appDb();

  return (
    <>
      <PageHeader title="Capital alignment" />
      <Notice text={sp.notice} />
      <p className={ui.notice}>How capital moves through land and living systems: nature-positive, transition, neutral or potentially nature-negative. People classify, always with a stated basis and evidence; the OS never scores, and no composite ESG score exists. Financial cash flow and environmental value are kept separate; nature impacts are monetised only where a methodology is stated.</p>
      <nav className={ui.tabs} aria-label="Alignment sections">
        {TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/capital/alignment${k === "overview" ? "" : `?tab=${k}`}`}>{l}</Link>)}
        <Link className={ui.tab} href="/capital">Capital partners</Link>
      </nav>
      {tab === "overview" && <Overview mandateIds={user.scope.mandateIds} />}
      {tab === "assessments" && <Assessments scope={user.scope} />}
      {tab === "flows" && <Flows scope={user.scope} system={sp.system} />}
      {tab === "incentives" && <Incentives scope={user.scope} country={sp.country} />}
    </>
  );
}

async function Overview({ mandateIds }: { mandateIds: string[] }) {
  const t = await capitalAlignment(appDb(), mandateIds);
  const pct = (x: number) => (t.total ? (x / t.total) * 100 : 0);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Portfolio capital by alignment</span><span className={ui.sub}>{t.currency}{t.mixedCurrency ? " · other currencies excluded from totals" : ""}</span></p>
      <div className={s.strip}>
        {ORDER.map(k => <div key={k}><span><i className={s.dot} style={{ background: ALIGNMENT_COLORS[k] }} />{ALIGNMENT[k]}</span><b>{compactMoney(t.byAlignment[k], t.currency)}</b></div>)}
        <div><span><i className={s.dot} style={{ background: "#7a2e21" }} />Material nature risk</span><b>{compactMoney(t.materialRisk, t.currency)}</b></div>
      </div>
      <div className={s.bar} aria-hidden>{ORDER.map(k => <i key={k} style={{ width: `${pct(t.byAlignment[k])}%`, background: ALIGNMENT_COLORS[k] }} />)}</div>
      <p className={ui.sub}>Material nature risk = capital in assessments with a high-materiality dependency or impact, or a scenario rated high nature risk. Projects without an assessment count as Unclassified at their CAPEX.</p>
      {t.rows.length === 0 ? <p className={r.empty}>No projects with CAPEX and no assessments yet.</p> : (
        <table className={ui.table}><thead><tr><th>Project / subject</th><th>Alignment</th><th>Capital</th><th>Material risk</th><th /></tr></thead><tbody>
          {t.rows.slice(0, 60).map((x, i) => <tr key={x.assessmentId ?? x.projectId ?? i}>
            <td className={ui.primary}>{x.projectId ? <Link href={`/projects/${x.projectId}`}>{x.name}</Link> : x.name}</td>
            <td><span className={ui.chip}><i className={s.dot} style={{ background: ALIGNMENT_COLORS[x.alignment] }} /> {ALIGNMENT[x.alignment]}</span></td>
            <td className={ui.num}>{compactMoney(x.amount, x.currency)}</td><td>{x.material ? <span className={s.bad}>Yes</span> : "—"}</td>
            <td>{x.assessmentId ? <Link href={`/capital/alignment/${x.assessmentId}`}>Evidence</Link> : <form action={createAssessmentAction}><input type="hidden" name="projectId" value={x.projectId ?? ""} /><input type="hidden" name="subjectType" value="project" /><button className={ui.miniBtn} type="submit">Assess</button></form>}</td>
          </tr>)}
        </tbody></table>)}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Where capital can come from</p>
      <p className={ui.sub}>Types of capital by role (a map of the market, not a classification of any provider).</p>
      <p><b>Nature-positive capital</b></p><p className={ui.sub}>{CAPITAL_ROLES.positive.join(" · ")}</p>
      <p><b>Transition / nature-neutralising capital</b></p><p className={ui.sub}>{CAPITAL_ROLES.transition.join(" · ")}</p>
      <p className={ui.sub}>Context: UNEP&apos;s State of Finance for Nature 2026 estimates roughly 30:1 between flows into nature-negative activities and nature-based solutions; redirecting existing flows matters as much as mobilising new ones.</p>
    </section></aside>
  </div>;
}

async function Assessments({ scope }: { scope: Parameters<typeof mandateCondition>[0] }) {
  const db = appDb();
  const [rows, projs] = await Promise.all([
    db.select().from(natureAssessments).where(mandateCondition(scope, natureAssessments.mandateId)).orderBy(desc(natureAssessments.updatedAt)),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
  ]);
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}>Nature transition assessments</p>
      <p className={ui.sub}>Current state → dependencies → impacts → financial flows → policy / subsidy drivers → transition options → capital reallocation → outcome.</p>
      {rows.length === 0 ? <p className={r.empty}>No assessments yet.</p> : <table className={ui.table}><thead><tr><th>Assessment</th><th>Subject</th><th>Alignment</th><th>Dependencies</th><th>Impacts</th><th>Drivers</th><th>Pathways</th><th>Capital</th></tr></thead><tbody>
        {rows.map(a => <tr key={a.id}><td className={ui.primary}><Link href={`/capital/alignment/${a.id}`}>{a.name}</Link></td><td>{SUBJECT_TYPES[a.subjectType]}</td>
          <td><span className={ui.chip}><i className={s.dot} style={{ background: ALIGNMENT_COLORS[a.alignment] }} /> {ALIGNMENT[a.alignment]}</span></td>
          <td className={ui.num}>{a.dependencies.length}</td><td className={ui.num}>{a.impacts.length}{a.impacts.some(i => i.materiality === "high") ? <span className={s.bad}> · high</span> : null}</td><td className={ui.num}>{a.drivers.length}</td><td className={ui.num}>{a.pathways.length}</td><td className={ui.num}>{compactMoney(a.capitalAmount ?? 0, a.currency)}</td></tr>)}
      </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>New assessment</p>
      <form action={createAssessmentAction} className={r.form}>
        <label>Subject<select name="subjectType" defaultValue="project">{Object.entries(SUBJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Project<select name="projectId" defaultValue=""><option value="">None (company, portfolio, system …)</option>{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Name<input name="name" placeholder="Defaults to the project name" /></label>
        <label>Capital covered<input name="capitalAmount" inputMode="decimal" placeholder="Defaults to project CAPEX" /></label>
        <label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label>
        <button className="btn btn--primary" type="submit">Create</button>
      </form></section></aside>
  </div>;
}

async function Flows({ scope, system }: { scope: Parameters<typeof mandateCondition>[0]; system?: string }) {
  const all = await appDb().select().from(capitalFlows).where(mandateCondition(scope, capitalFlows.mandateId)).orderBy(asc(capitalFlows.system));
  const systems = [...new Set(all.map(f => f.system))];
  const current = system && systems.includes(system) ? system : systems[0];
  const rows = all.filter(f => f.system === current);
  const sum = flowSummary(rows);
  const max = Math.max(1, ...sum.bySector.map(([, v]) => v));
  const cur = sum.currencies[0] ?? "USD";
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Financial flows into {current ?? "a system"}</span>
        {systems.length > 1 && <span className={ui.sub}>{systems.map(x => <Link key={x} href={`/capital/alignment?tab=flows&system=${encodeURIComponent(x)}`} style={{ marginLeft: 8, fontWeight: x === current ? 600 : 400 }}>{x}</Link>)}</span>}</p>
      {rows.length === 0 ? <p className={r.empty}>Record the capital flowing into a watershed, region or landscape (budgets, disclosures, loan books, subsidies, investment programmes), each with its source.</p> : <>
        {sum.currencies.length > 1 && <p className={ui.warn}>Several currencies recorded ({sum.currencies.join(", ")}); bars add nominal amounts.</p>}
        <div className={s.rows}>{sum.bySector.map(([sec, v]) => {
          const parts = ORDER.map(k => [k, rows.filter(f => f.sector === sec && f.alignment === k).reduce((a, f) => a + f.amount, 0)] as const);
          return <div key={sec} className={s.row}><span>{FLOW_SECTORS[sec as keyof typeof FLOW_SECTORS]}</span><span className={s.track} style={{ width: `${(v / max) * 100}%` }}>{parts.map(([k, x]) => <i key={k} style={{ width: `${(x / v) * 100}%`, background: ALIGNMENT_COLORS[k] }} title={`${ALIGNMENT[k]}: ${compactMoney(x, cur)}`} />)}</span><b>{compactMoney(v, cur)}</b></div>;
        })}</div>
        <p className={r.panelTitle}>Nature alignment</p>
        <div className={s.rows}>{ORDER.map(k => { const v = sum.byAlignment.get(k) ?? 0; return <div key={k} className={s.row}><span><i className={s.dot} style={{ background: ALIGNMENT_COLORS[k] }} /> {ALIGNMENT[k]}</span><span className={s.track} style={{ width: `${(v / Math.max(1, sum.total)) * 100}%` }}><i style={{ width: "100%", background: ALIGNMENT_COLORS[k] }} /></span><b>{compactMoney(v, cur)}</b></div>; })}</div>
        <p>Realistically redirectable: <b>{compactMoney(sum.redirectable, cur)}</b>; partly: <b>{compactMoney(sum.partly, cur)}</b> of {compactMoney(sum.total, cur)}.</p>
        <table className={ui.table}><thead><tr><th>Sector</th><th>Flow</th><th>Amount</th><th>Year</th><th>Alignment · basis</th><th>Redirectable</th><th>Source</th></tr></thead><tbody>
          {rows.map(f => <tr key={f.id}><td>{FLOW_SECTORS[f.sector]}</td><td>{f.description}</td><td className={ui.num}>{compactMoney(f.amount, f.currency)}</td><td>{f.year ?? "—"}</td><td className={ui.sub}>{ALIGNMENT[f.alignment]}{f.alignmentBasis ? ` · ${f.alignmentBasis}` : ""}</td><td>{REDIRECTABLE[f.redirectable]}</td><td className={ui.sub}>{f.source}</td></tr>)}
        </tbody></table>
      </>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Record a flow</p>
      <form action={saveFlowAction} className={r.form}>
        <label>System (watershed, region, landscape)<input name="system" required defaultValue={current ?? ""} list="systems" /></label>
        <datalist id="systems">{systems.map(x => <option key={x} value={x} />)}</datalist>
        <label>Sector<select name="sector">{Object.entries(FLOW_SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Description<input name="description" placeholder="e.g. Irrigation subsidy, state programme" /></label>
        <label>Amount (per year)<input name="amount" required inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label><label>Year<input name="year" placeholder="2025" /></label>
        <label>Alignment<select name="alignment" defaultValue="unclassified">{ORDER.map(k => <option key={k} value={k}>{ALIGNMENT[k]}</option>)}</select></label>
        <label>Basis for alignment<textarea name="alignmentBasis" rows={2} placeholder="Required unless Unclassified" /></label>
        <label>Redirectable<select name="redirectable" defaultValue="unknown">{Object.entries(REDIRECTABLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Source<input name="source" required placeholder="Budget line, disclosure, study, estimate method" /></label>
        <button className="btn" type="submit">Record</button>
      </form></section></aside>
  </div>;
}

async function Incentives({ scope, country }: { scope: Parameters<typeof mandateCondition>[0]; country?: string }) {
  const all = await appDb().select().from(incentives).where(mandateCondition(scope, incentives.mandateId)).orderBy(asc(incentives.country), asc(incentives.sector));
  const countries = [...new Set(all.map(i => i.country))];
  const rows = country ? all.filter(i => i.country === country) : all;
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Subsidy and incentive intelligence</span><span className={ui.sub}><Link href="/capital/alignment?tab=incentives">All</Link>{countries.map(c => <Link key={c} href={`/capital/alignment?tab=incentives&country=${encodeURIComponent(c)}`} style={{ marginLeft: 8, fontWeight: c === country ? 600 : 400 }}>{c}</Link>)}</span></p>
      <p className={ui.sub}>A classification other than Unclassified needs the full chain: policy, mechanism, beneficiary, economic effect and environmental evidence. Research, not legal advice.</p>
      {rows.length === 0 ? <p className={r.empty}>No incentives recorded.</p> : <table className={ui.table}><thead><tr><th>Incentive</th><th>Where</th><th>Sector · mechanism</th><th>Beneficiary</th><th>Economic effect</th><th>Environmental evidence</th><th>Value / yr</th><th>Classification</th></tr></thead><tbody>
        {rows.map(i => { const gaps = incentiveEvidenceGaps(i); return <tr key={i.id}>
          <td className={ui.primary}>{i.sourceUrl ? <a href={i.sourceUrl} target="_blank" rel="noreferrer">{i.name}</a> : i.name}<span className={ui.sub}>{i.policyRef}{i.asOf ? ` · as of ${i.asOf}` : ""}</span></td>
          <td>{i.country}{i.subdivision ? ` · ${i.subdivision}` : ""}</td><td className={ui.sub}>{INCENTIVE_SECTORS[i.sector]} · {MECHANISMS[i.mechanism]}</td><td className={ui.sub}>{i.beneficiary || "—"}</td><td className={ui.sub}>{i.economicEffect || "—"}</td><td className={ui.sub}>{i.environmentalEvidence || "—"}</td>
          <td className={ui.num}>{i.annualValue ? compactMoney(i.annualValue, i.currency) : "—"}</td>
          <td><span className={ui.chip}><i className={s.dot} style={{ background: INC_COLORS[i.classification] }} /> {INCENTIVE_CLASS[i.classification]}</span>{gaps.length ? <span className={ui.sub}>missing: {gaps.join(", ")}</span> : null}</td>
        </tr>; })}
      </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Record an incentive</p>
      <form action={saveIncentiveAction} className={r.form}>
        <label>Name<input name="name" required placeholder="e.g. Agricultural electricity tariff 9-CU" /></label>
        <label>Country<input name="country" required placeholder="MEX" /></label><label>Subdivision<input name="subdivision" /></label>
        <label>Sector<select name="sector">{Object.entries(INCENTIVE_SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Mechanism<select name="mechanism">{Object.entries(MECHANISMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Policy reference<input name="policyRef" placeholder="Law, decree, programme rules" /></label><label>Source URL<input name="sourceUrl" type="url" /></label><label>As of<input name="asOf" type="date" /></label>
        <label>Beneficiary<input name="beneficiary" /></label>
        <label>Economic effect<textarea name="economicEffect" rows={2} placeholder="How it changes the economics of the activity" /></label>
        <label>Environmental evidence<textarea name="environmentalEvidence" rows={2} placeholder="Studies or data on the ecological effect" /></label>
        <label>Annual value<input name="annualValue" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label>
        <label>Classification<select name="classification" defaultValue="unclassified">{Object.entries(INCENTIVE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="btn" type="submit">Record</button>
      </form></section></aside>
  </div>;
}
