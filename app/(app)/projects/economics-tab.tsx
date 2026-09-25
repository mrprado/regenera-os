import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { economicCases, revenueStreams } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { revenueFromStreams } from "@/lib/economics/engine";
import { sensitivity } from "@/lib/economics/model";
import { BOUNDARY, CASE_KINDS, DEFAULT_INPUTS, INPUT_FIELDS, REVENUE_MECHANISMS, REVENUE_STATUSES, type CaseInputs, type CaseOutputs } from "@/lib/economics/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { addRevenueStreamAction, deleteCaseAction, saveCaseAction, updateCaseAction, updateRevenueStreamAction } from "../delivery-actions";
import styles from "./projects.module.css";

const pc = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const xx = (x: number | null) => (x === null ? "n/a" : `${x.toFixed(2)}x`);

function Metrics({ o, cur }: { o: CaseOutputs; cur: string }) {
  return (
    <div className={styles.metrics}>
      <div className={styles.metric}><span>Project IRR</span><b>{pc(o.projectIrr)}</b></div>
      <div className={styles.metric}><span>Equity IRR</span><b>{pc(o.equityIrr)}</b></div>
      <div className={styles.metric}><span>NPV (project)</span><b>{compactMoney(o.npv, cur)}</b></div>
      <div className={styles.metric}><span>Min / avg DSCR</span><b>{xx(o.minDscr)} / {xx(o.avgDscr)}</b></div>
      <div className={styles.metric}><span>LLCR</span><b>{xx(o.llcr)}</b></div>
      <div className={styles.metric}><span>Payback</span><b>{o.paybackYears === null ? "n/a" : `${o.paybackYears.toFixed(1)} yrs`}</b></div>
      <div className={styles.metric}><span>Debt ({o.debtSizedBy === "dscr" ? "DSCR-sized" : o.debtSizedBy === "gearing" ? "gearing cap" : "none"})</span><b>{compactMoney(o.debt, cur)}</b></div>
      <div className={styles.metric}><span>Equity</span><b>{compactMoney(o.equity, cur)}</b></div>
      <div className={styles.metric}><span>EBITDA year 1</span><b>{compactMoney(o.ebitdaYear1, cur)}</b></div>
    </div>
  );
}

function InputsForm({ inputs, projectId, caseId }: { inputs: CaseInputs; projectId: string; caseId?: string }) {
  return (
    <form action={caseId ? updateCaseAction : saveCaseAction} className={styles.grid2}>
      {caseId ? <input type="hidden" name="caseId" value={caseId} /> : <>
        <input type="hidden" name="id" value={projectId} />
        <label>Name<input name="name" defaultValue="Base case" /></label>
        <label>Kind<select name="kind" defaultValue="base">{Object.entries(CASE_KINDS).filter(([k]) => k === "base" || k === "custom").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Currency<input name="currency" defaultValue={inputs.currency} /></label>
        <label>Source of assumptions<input name="source" placeholder="e.g. Sponsor model v3, 2026-09" /></label>
      </>}
      {INPUT_FIELDS.map(f => <label key={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ` (${inputs.currency})`}<input name={f.key} inputMode="decimal" defaultValue={String(inputs[f.key])} required={f.key === "capex"} /></label>)}
      <button className="btn btn--primary" type="submit">{caseId ? "Recalculate" : "Save and run"}</button>
    </form>
  );
}

/** Commercial and economics (master spec XXI–XXII): revenue mechanisms and screening cases with sensitivities. */
export default async function EconomicsTab({ project, caseId }: { project: { id: string; capex: number | null; currency: string | null }; caseId?: string }) {
  const [streams, cases] = await Promise.all([
    appDb().select().from(revenueStreams).where(eq(revenueStreams.projectId, project.id)).orderBy(asc(revenueStreams.createdAt)),
    appDb().select().from(economicCases).where(eq(economicCases.projectId, project.id)).orderBy(asc(economicCases.createdAt)),
  ]);
  const currency = project.currency ?? "USD";
  const rev = revenueFromStreams(streams, currency);
  const selected = cases.find(c => c.id === caseId) ?? cases.find(c => c.kind === "base") ?? cases[0];
  const family = selected ? cases.filter(c => c.id === (selected.baseCaseId ?? selected.id) || c.baseCaseId === (selected.baseCaseId ?? selected.id)) : [];
  const sens = selected ? sensitivity(selected.inputs) : [];
  const starter: CaseInputs = { ...DEFAULT_INPUTS, currency, capex: project.capex ?? 0, revenueYear1: Math.round(rev.total), opexYear1: 0 };

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Screening economics</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>{BOUNDARY}</p>
          {cases.length === 0 ? <p className={r.empty}>No case yet. Add revenue streams, then save a base case: the downside and upside are derived from it with documented shocks.</p> : (
            <>
              <nav className={ui.tabs} aria-label="Cases" style={{ marginBottom: 8 }}>
                {cases.map(c => <Link key={c.id} className={`${ui.tab} ${c.id === selected?.id ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=economics&case=${c.id}`}>{c.name}</Link>)}
              </nav>
              {selected && selected.outputs && (
                <>
                  <p className={ui.sub}>{CASE_KINDS[selected.kind]}{selected.source ? ` · ${selected.source}` : ""}{selected.preparedBy ? ` · ${selected.preparedBy}, ${selected.updatedAt.slice(0, 10)}` : ""}</p>
                  <Metrics o={selected.outputs} cur={selected.inputs.currency} />
                  {selected.outputs.notes.map(n => <p key={n} className={ui.sub}>{n}</p>)}
                  {family.length > 1 && (
                    <table className={ui.table}>
                      <thead><tr><th>Case</th><th className={ui.num}>Project IRR</th><th className={ui.num}>Equity IRR</th><th className={ui.num}>Min DSCR</th><th className={ui.num}>NPV</th></tr></thead>
                      <tbody>{family.map(c => c.outputs && <tr key={c.id}><td>{CASE_KINDS[c.kind]}</td><td className={ui.num}>{pc(c.outputs.projectIrr)}</td><td className={ui.num}>{pc(c.outputs.equityIrr)}</td><td className={ui.num}>{xx(c.outputs.minDscr)}</td><td className={ui.num}>{compactMoney(c.outputs.npv, c.inputs.currency)}</td></tr>)}</tbody>
                    </table>
                  )}
                  <details style={{ marginTop: 8 }}><summary className={ui.sub}>Annual cash flows</summary>
                    <div style={{ overflowX: "auto" }}>
                      <table className={ui.table}>
                        <thead><tr><th>Year</th><th className={ui.num}>Revenue</th><th className={ui.num}>OPEX</th><th className={ui.num}>EBITDA</th><th className={ui.num}>Tax</th><th className={ui.num}>CFADS</th><th className={ui.num}>Debt service</th><th className={ui.num}>DSCR</th></tr></thead>
                        <tbody>{selected.outputs.years.map(y => <tr key={y.year}><td>{y.year}</td>{[y.revenue, y.opex, y.ebitda, y.tax, y.cfads, y.debtService].map((v, i) => <td key={i} className={ui.num}>{compactMoney(v, selected.inputs.currency)}</td>)}<td className={ui.num}>{xx(y.dscr)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </>
          )}
        </section>

        {selected && sens.length > 0 && (
          <section className={r.panel}>
            <p className={r.panelTitle}>Sensitivities on {selected.name}</p>
            <table className={ui.table}>
              <thead><tr><th>Variable</th><th>Low</th><th className={ui.num}>Equity IRR</th><th className={ui.num}>Min DSCR</th><th>High</th><th className={ui.num}>Equity IRR</th><th className={ui.num}>Min DSCR</th></tr></thead>
              <tbody>{sens.map(s => <tr key={s.key}><td>{s.key}</td><td>{s.lowLabel}</td><td className={ui.num}>{pc(s.lowIrr)}</td><td className={ui.num}>{xx(s.lowDscr)}</td><td>{s.highLabel}</td><td className={ui.num}>{pc(s.highIrr)}</td><td className={ui.num}>{xx(s.highDscr)}</td></tr>)}</tbody>
            </table>
          </section>
        )}

        <section className={r.panel}>
          <p className={r.panelTitle}>Revenue mechanisms</p>
          {streams.length === 0 ? <p className={r.empty}>No revenue streams. Record each mechanism (PPA, offtake, tipping fee, credits …) with the counterparty&apos;s terms.</p> : (
            <table className={ui.table}><tbody>{streams.map(s => (
              <tr key={s.id}>
                <td><b>{REVENUE_MECHANISMS[s.mechanism]}</b>{s.name ? ` · ${s.name}` : ""}{s.counterparty ? ` · ${s.counterparty}` : ""}
                  <span className={ui.sub} style={{ display: "block" }}>{[s.unitPrice !== null && `${s.currency} ${s.unitPrice}/${s.unit ?? "unit"}`, s.annualVolume !== null && `${s.annualVolume.toLocaleString("en-US")} ${s.unit ?? "units"} a year`,
                    s.unitPrice !== null && s.annualVolume !== null && `= ${compactMoney(s.unitPrice * s.annualVolume, s.currency)} a year`, s.tenorYears && `${s.tenorYears} years`, s.escalationPct !== null && `${s.escalationPct}%/yr`, s.indexation,
                    s.counterpartyCredit && `credit: ${s.counterpartyCredit}`, s.paymentSecurity && `security: ${s.paymentSecurity}`, s.termination && `termination: ${s.termination}`].filter(Boolean).join(" · ")}</span></td>
                <td>
                  <form action={updateRevenueStreamAction} className={styles.inline}>
                    <input type="hidden" name="streamId" value={s.id} />
                    <select name="status" defaultValue={s.status} aria-label="Status">{Object.entries(REVENUE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className={ui.miniBtn} type="submit">Set</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
          <p className={ui.sub}>Year-1 revenue from streams in {currency}: {compactMoney(rev.total, currency)}{rev.skipped.length ? ` (not included: ${rev.skipped.join("; ")})` : ""}.</p>
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>{selected && !selected.baseCaseId ? `Edit ${selected.name}` : "New case"}</p>
          {selected && !selected.baseCaseId ? (
            <>
              <InputsForm inputs={selected.inputs} projectId={project.id} caseId={selected.id} />
              <form action={deleteCaseAction} style={{ marginTop: 8 }}><input type="hidden" name="caseId" value={selected.id} /><button className={ui.miniBtn} type="submit">Remove this case{selected.kind === "base" ? " and its scenarios" : ""}</button></form>
              <details style={{ marginTop: 10 }}><summary className={ui.sub}>Start another case</summary><InputsForm inputs={starter} projectId={project.id} /></details>
            </>
          ) : selected ? <p className={ui.sub}>This case is derived from its base case. Edit the base case; the downside and upside follow.</p> : <InputsForm inputs={starter} projectId={project.id} />}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a revenue stream</p>
          <form action={addRevenueStreamAction} className={styles.stack}>
            <input type="hidden" name="id" value={project.id} />
            <label>Mechanism<select name="mechanism" required>{Object.entries(REVENUE_MECHANISMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Name<input name="name" placeholder="e.g. 15-year corporate PPA" /></label>
            <label>Counterparty<input name="counterparty" /></label>
            <label>Price per unit<input name="unitPrice" inputMode="decimal" /></label>
            <label>Unit<input name="unit" placeholder="MWh, m³, t, month" /></label>
            <label>Annual volume<input name="annualVolume" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={currency} /></label>
            <label>Escalation (% a year)<input name="escalationPct" inputMode="decimal" /></label>
            <label>Indexation<input name="indexation" placeholder="e.g. US CPI, capped 3%" /></label>
            <label>Tenor (years)<input name="tenorYears" inputMode="decimal" /></label>
            <label>Counterparty credit<input name="counterpartyCredit" placeholder="Rating, guarantor" /></label>
            <label>Payment security<input name="paymentSecurity" placeholder="LC, escrow, guarantee" /></label>
            <label>Termination<input name="termination" /></label>
            <label>Status<select name="status" defaultValue="indicative">{Object.entries(REVENUE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
