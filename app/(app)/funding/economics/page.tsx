import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { engagements, practiceScenarios, services, teamMembers, timeEntries } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal, mandateCondition } from "@/lib/db/scoped";
import { plannedVsActual, runScenario, SCENARIO_FIELDS, SCENARIO_TEMPLATES } from "@/lib/funding/origination";
import { FUNDING_LINES } from "@/lib/funding/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { saveScenarioAction } from "../../funding-origination-actions";
import f from "../funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funding practice economics" };

const TARGETS: [string, string][] = [["Funding diagnostics", "≈ 60–70% gross margin"], ["Application strategy", "≈ 50–65%"], ["Post-award", "≈ 50–65%"], ["OS", "higher software margin once mature"]];

export default async function EconomicsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/funding");
  if (!isInternal(user.scope)) notFound();
  const sp = await searchParams;
  const [scenarios, engs, svc, members] = await Promise.all([
    appDb().select().from(practiceScenarios).where(mandateCondition(user.scope, practiceScenarios.mandateId)).orderBy(desc(practiceScenarios.updatedAt)),
    appDb().select().from(engagements).where(and(mandateCondition(user.scope, engagements.mandateId), isNotNull(engagements.fundingLine))),
    appDb().select().from(services).where(and(mandateCondition(user.scope, services.mandateId), eq(services.family, "funding"))),
    appDb().select().from(teamMembers).where(mandateCondition(user.scope, teamMembers.mandateId)),
  ]);
  const current = scenarios.find(s => s.id === sp.scenario) ?? null;
  const tier = (sp.tier as "lean" | "base" | "scale" | undefined) ?? "base";
  const inputs = current?.inputs ?? SCENARIO_TEMPLATES[tier in SCENARIO_TEMPLATES ? tier : "base"];
  const out = runScenario(inputs);
  const time = engs.length ? await appDb().select().from(timeEntries).where(inArray(timeEntries.engagementId, engs.map(e => e.id).slice(0, 90))) : [];
  const rates = new Map(members.filter(m => m.costRate != null).flatMap(m => [[(m.email ?? m.name).toLowerCase(), m.costRate!], [m.name.toLowerCase(), m.costRate!]] as [string, number][]));
  const actual = engs.map(e => ({ e, x: plannedVsActual({ fee: e.fee + e.monthlyFee * e.months, budget: e.budgetLines, time: time.filter(t => t.engagementId === e.id), rates, otherCost: e.expectedExternalCost }) }));
  const byLine = new Map<string, { n: number; fee: number; gp: number }>();
  for (const a of actual) { const k = a.e.fundingLine ?? "other"; const v = byLine.get(k) ?? { n: 0, fee: 0, gp: 0 }; v.n++; v.fee += a.x.actual.fee; v.gp += a.x.actual.grossProfit; byLine.set(k, v); }
  return (
    <>
      <PageHeader title="Funding practice economics" actions={<Link className="btn" href="/funding">Funding</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Internal planning. Regenera Funding is public &amp; blended finance advisory (funding + structuring + consortium + capital stack + implementation), not commodity grant writing. Scenario outputs are <b>illustrative</b> unless a person designates one a forecast. Nothing here is Regenera&apos;s actual financial performance.</p>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Actual funding engagements (by line)</span><Link href="/commercial?tab=engagements">Engagements</Link></p>
        {byLine.size === 0 ? <p className={r.empty}>No engagements carry a funding line yet. Diagnostics proposed from funding prospects are tagged automatically.</p> : (
          <table className={ui.table}><thead><tr><th>Line</th><th className={ui.num}>Engagements</th><th className={ui.num}>Fees</th><th className={ui.num}>Gross profit (actual hours × rates)</th><th className={ui.num}>Margin</th></tr></thead>
            <tbody>{[...byLine.entries()].map(([k, v]) => <tr key={k}><td>{FUNDING_LINES[k as keyof typeof FUNDING_LINES] ?? k}</td><td className={ui.num}>{v.n}</td><td className={ui.num}>{compactMoney(v.fee, "USD")}</td><td className={ui.num}>{compactMoney(v.gp, "USD")}</td><td className={ui.num}>{v.fee ? `${Math.round((v.gp / v.fee) * 1000) / 10}%` : "—"}</td></tr>)}</tbody></table>
        )}
        {actual.some(a => a.x.unratedPeople.length) && <p className={f.warn} style={{ fontSize: 12.5 }}>Some logged hours have no cost rate ({[...new Set(actual.flatMap(a => a.x.unratedPeople))].slice(0, 6).join(", ")}); margins are overstated until rates are set in <Link href="/capacity?tab=team">Capacity</Link>.</p>}
      </section>

      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Scenario planner</span>{current?.illustrative !== false ? <span className={f.illustrative}>Illustrative model</span> : <span className={ui.chip}>Forecast · {current.designatedBy}</span>}</p>
          <nav className={ui.tabs} style={{ marginTop: 0 }} aria-label="Templates">
            {(["lean", "base", "scale"] as const).map(t => <Link key={t} className={`${ui.tab} ${!current && tier === t ? ui.tabActive : ""}`} href={`/funding/economics?tier=${t}`}>{t === "lean" ? "Lean · founder + contractors" : t === "base" ? "Base · small core team" : "Scale · dedicated practice"}</Link>)}
            {scenarios.map(s => <Link key={s.id} className={`${ui.tab} ${current?.id === s.id ? ui.tabActive : ""}`} href={`/funding/economics?scenario=${s.id}`}>{s.name}</Link>)}
          </nav>
          <form action={saveScenarioAction} className={f.grid3}>
            {current && <input type="hidden" name="id" value={current.id} />}
            <input type="hidden" name="tier" value={current?.tier ?? tier} />
            <label className={f.full}>Name<input name="name" defaultValue={current?.name ?? ""} placeholder={`${tier} scenario`} /></label>
            {SCENARIO_FIELDS.map(fl => <label key={fl.key}>{fl.label}<input name={fl.key} defaultValue={inputs[fl.key] ?? 0} inputMode="decimal" /></label>)}
            <label className={f.full}>Notes<input name="notes" defaultValue={current?.notes ?? ""} /></label>
            <label className={`${f.full} ${f.inline}`}><input type="checkbox" name="forecast" defaultChecked={current ? !current.illustrative : false} /> Designate as a forecast (a person owns it; otherwise it stays illustrative)</label>
            <div><button className="btn btn--primary" type="submit">{current ? "Save scenario" : "Save as a scenario"}</button></div>
          </form>
        </section>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Outputs (per year)</p>
            <div className={f.econ}>
              <div><b>{compactMoney(out.revenue, "USD")}</b><span>Revenue</span></div><div><b>{compactMoney(out.directCost, "USD")}</b><span>Direct cost</span></div>
              <div><b>{compactMoney(out.grossProfit, "USD")}</b><span>Gross profit</span></div><div><b>{out.grossMarginPct ?? "—"}%</b><span>Gross margin</span></div>
              <div><b>{compactMoney(out.operatingProfit, "USD")}</b><span>After overhead</span></div><div><b>{out.fteNeeded ?? "—"}</b><span>Delivery FTE needed</span></div>
              <div><b>{out.utilizationPct ?? "—"}%</b><span>Core utilization</span></div><div><b>{out.revenuePerFte ? compactMoney(out.revenuePerFte, "USD") : "—"}</b><span>Revenue / FTE</span></div>
              <div><b>{out.gpPerFte ? compactMoney(out.gpPerFte, "USD") : "—"}</b><span>GP / delivery FTE</span></div><div><b>{out.breakEvenRevenue ? compactMoney(out.breakEvenRevenue, "USD") : "—"}</b><span>Break-even revenue</span></div>
            </div>
            <table className={ui.table}><thead><tr><th>Service line</th><th className={ui.num}>Revenue</th><th className={ui.num}>Hours</th></tr></thead>
              <tbody>{out.lines.map(l => <tr key={l.line}><td>{FUNDING_LINES[l.line]}</td><td className={ui.num}>{compactMoney(l.revenue, "USD")}</td><td className={ui.num}>{l.hours.toLocaleString("en-US")}</td></tr>)}</tbody></table>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Margin targets (planning ranges, not accounting)</p>
            <dl className={r.kv}>{TARGETS.flatMap(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`}>{v}</dd>])}</dl>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Funding service catalogue</span><Link href="/commercial?tab=services">Edit</Link></p>
            {svc.length === 0 ? <p className={r.empty}>Seeded on first use in Services &amp; pricing.</p> : (
              <table className={ui.table}><tbody>{svc.map(s => <tr key={s.id}><td>{s.name}</td><td className={ui.num}>{compactMoney(s.bandLow ?? 0, s.currency)}–{s.bandHigh ? compactMoney(s.bandHigh, s.currency) : "+"}{s.perMonth ? "/mo" : ""}</td><td className={ui.num}>{s.targetMarginPct}%</td></tr>)}</tbody></table>
            )}
            <p className={ui.sub}>Default fees are fixed, milestone or retainer. Contingent fees on public funding need legal / program review.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
