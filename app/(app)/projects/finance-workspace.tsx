"use client";

// Financials workspace: assumption register (every input with source, date, confidence and status), live
// deterministic calculation, institutional outputs, cash flow, debt and sources & uses, sensitivities, stress cases,
// breakevens, value bridge, health checks and version comparison. Saving records every change with a reason;
// approved or locked cases are read-only.
import { useMemo, useState } from "react";
import { breakeven, diffModels, modelHealth, oneWay, stressCases, twoWay, valueBridge } from "@/lib/finance/analysis";
import { calculate, CONVENTIONS } from "@/lib/finance/calc";
import type { AssumptionStatus, CapexLine, Certainty, Confidence, DevCostLine, ModelDefinition, OpexLine, Provenance, RevenueStream } from "@/lib/finance/types";
import { saveModelAction } from "../finance-actions";
import styles from "./finance.module.css";

type Version = { id: string; name: string; version: number; status: string; caseType: string; definition: ModelDefinition; parentId: string | null };

const STATUSES: AssumptionStatus[] = ["verified", "supported", "preliminary", "placeholder", "speculative"];
const CONF: Confidence[] = ["high", "moderate", "low"];
const CERT: Certainty[] = ["contracted", "forecast", "merchant", "speculative"];
const uid = () => Math.random().toString(36).slice(2, 9);
const blankProv = (): Provenance => ({ source: "", date: null, owner: null, confidence: "low", status: "placeholder" });

function fmtMoney(v: number | null | undefined, cur: string, preliminary: boolean) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  const n = a >= 1e9 ? `${(a / 1e9).toFixed(preliminary ? 1 : 2)}bn` : a >= 1e6 ? `${(a / 1e6).toFixed(preliminary ? 1 : 2)}m` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0);
  return `${preliminary ? "≈ " : ""}${s}${cur} ${n}`;
}
const pct = (v: number | null | undefined, prelim: boolean) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${prelim ? "≈ " : ""}${v.toFixed(prelim ? 0 : 1)}%`);
const x2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
const num = (s: string) => { const n = Number(s.replace(/[, ]/g, "")); return Number.isFinite(n) ? n : 0; };

function ProvCells<T extends Provenance>({ row, set, readOnly }: { row: T; set: (p: Partial<Provenance>) => void; readOnly: boolean }) {
  return (<>
    <td><input className={styles.src} value={row.source} onChange={e => set({ source: e.target.value })} placeholder="source" disabled={readOnly} aria-label="Source" /></td>
    <td><input className={styles.date} type="date" value={row.date ?? ""} onChange={e => set({ date: e.target.value || null })} disabled={readOnly} aria-label="Date" /></td>
    <td><select value={row.confidence} onChange={e => set({ confidence: e.target.value as Confidence })} disabled={readOnly} aria-label="Confidence">{CONF.map(c => <option key={c}>{c}</option>)}</select></td>
    <td><select value={row.status} onChange={e => set({ status: e.target.value as AssumptionStatus })} disabled={readOnly} aria-label="Status" data-status={row.status}>{STATUSES.map(c => <option key={c}>{c}</option>)}</select></td>
  </>);
}

export default function FinanceWorkspace({ modelId, name, status, readOnly, initial, versions, currency }: { modelId: string; name: string; status: string; readOnly: boolean; initial: ModelDefinition; versions: Version[]; currency: string }) {
  const [def, setDef] = useState<ModelDefinition>(initial);
  const [tab, setTab] = useState<"summary" | "assumptions" | "cashflow" | "debt" | "sensitivity" | "stress" | "versions">("summary");
  const [reason, setReason] = useState("");
  const [swing, setSwing] = useState(10);
  const [compareTo, setCompareTo] = useState(versions.find(v => v.id !== modelId)?.id ?? "");
  const o = useMemo(() => calculate(def), [def]);
  const health = useMemo(() => modelHealth(def, o), [def, o]);
  const prelim = health.issues.some(i => i.code === "placeholders") || [...def.capex, ...def.revenue].some(x => x.status === "preliminary" || x.status === "placeholder");
  const dirty = JSON.stringify(def) !== JSON.stringify(initial);
  const cur = def.currency || currency;
  const up = (patch: Partial<ModelDefinition>) => setDef(d => ({ ...d, ...patch }));
  const rowSet = <K extends "capex" | "opex" | "revenue" | "development">(key: K, i: number, patch: Partial<ModelDefinition[K][number]>) => setDef(d => ({ ...d, [key]: (d[key] as unknown[]).map((r, j) => (j === i ? { ...(r as object), ...patch } : r)) }));
  const rowDel = (key: "capex" | "opex" | "revenue" | "development", i: number) => setDef(d => ({ ...d, [key]: (d[key] as unknown[]).filter((_, j) => j !== i) }));
  const ops = o.periods.filter(p => p.phase === "operations");
  const y1 = ops[0]?.revenueByCertainty;
  const certTotal = y1 ? Object.values(y1).reduce((a, b) => a + b, 0) : 0;

  const tornado = useMemo(() => (tab === "sensitivity" ? oneWay(def, swing) : null), [tab, def, swing]);
  const grid = useMemo(() => (tab === "sensitivity" ? twoWay(def, "price", "capex") : null), [tab, def]);
  const stress = useMemo(() => (tab === "stress" ? stressCases(def) : null), [tab, def]);
  const be = useMemo(() => {
    if (tab !== "stress") return null;
    const r = (k: number | null) => (k === null ? "not reached within 0.05×–5×" : `${((k - 1) * 100).toFixed(1)}% vs base`);
    return [
      { label: `Price at which equity IRR = hurdle (${def.equityHurdlePct}%)`, value: r(breakeven(def, "price", { metric: "equityIrr", value: def.equityHurdlePct })) },
      { label: "CAPEX at which equity IRR = hurdle", value: r(breakeven(def, "capex", { metric: "equityIrr", value: def.equityHurdlePct })) },
      { label: "Generation / volume at which equity IRR = hurdle", value: r(breakeven(def, "yield", { metric: "equityIrr", value: def.equityHurdlePct })) },
      { label: "Price at which project NPV = 0", value: r(breakeven(def, "price", { metric: "projectIrr", value: def.discountRatePct })) },
    ];
  }, [tab, def]);
  const other = versions.find(v => v.id === compareTo);
  const diff = useMemo(() => (tab === "versions" && other ? diffModels(other.definition, def) : null), [tab, other, def]);
  const bridge = useMemo(() => (def.stageDiscountRates.length ? valueBridge(def, o) : []), [def, o]);

  const csv = () => {
    const rows: (string | number)[][] = [["Year", "Phase", "Revenue", "Contracted", "Forecast", "Merchant", "Speculative", "OPEX", "EBITDA", "Tax", "CFADS", "Debt service", "DSCR", "Distributions", "Equity flow", "Project flow"],
      ...o.periods.map(p => [p.year, p.phase, p.revenue, p.revenueByCertainty.contracted, p.revenueByCertainty.forecast, p.revenueByCertainty.merchant, p.revenueByCertainty.speculative, p.opex, p.ebitda, p.tax, p.cfads, p.debtService, p.dscr ?? "", p.distributions, p.equityFlow, p.projectFlow])];
    const text = [`# ${name}; ${CONVENTIONS}; basis ${def.basis}; currency ${cur}; health ${health.status}`, ...rows.map(r => r.map(c => (typeof c === "number" ? c.toFixed(2) : c)).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `${name.replace(/\W+/g, "-")}-cashflow.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.ws}>
      <div className={styles.strip}>
        {[["Total uses", fmtMoney(o.uses.total, cur, prelim)], ["CAPEX / MW", o.capexPerMw ? fmtMoney(o.capexPerMw, cur, prelim) : "—"], ["Equity", fmtMoney(o.sources.equity, cur, prelim)], ["Debt", fmtMoney(o.debt, cur, prelim)], ["Min DSCR", x2(o.minDscr)], ["LLCR", x2(o.llcr)], ["Project IRR", pct(o.projectIrr, prelim)], ["Equity IRR", pct(o.equityIrr, prelim)], ["Equity NPV", fmtMoney(o.equityNpv, cur, prelim)], ["MOIC", o.moic ? `${o.moic.toFixed(2)}x` : "—"]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <p className={styles.meta}>{def.basis.toUpperCase()} · {cur} · debt {o.debtSizedBy || "none"} · health <b data-health={health.status}>{health.status}</b> · {o.converged ? `converged in ${o.iterations} iterations` : "NOT CONVERGED"} · {status}{prelim ? " · PRELIMINARY: placeholder or preliminary inputs, shown with ≈ and reduced precision" : ""}</p>

      <nav className={styles.tabs}>{(["summary", "assumptions", "cashflow", "debt", "sensitivity", "stress", "versions"] as const).map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "cashflow" ? "Cash flow" : t === "debt" ? "Debt, sources & uses" : t === "stress" ? "Stress & breakeven" : t[0].toUpperCase() + t.slice(1)}</button>)}</nav>

      {tab === "summary" && <div className={styles.cols}>
        <section>
          <h4>Model health</h4>
          {health.issues.length === 0 ? <p className={styles.ok}>PASS: no issues found.</p> : <ul className={styles.issues}>{health.issues.map(i => <li key={i.code} data-level={i.level}><b>{i.level === "error" ? "ERROR" : "REVIEW"}</b> {i.message}</li>)}</ul>}
          <h4>Revenue certainty, year 1</h4>
          {certTotal > 0 && y1 ? <div className={styles.certBar}>{CERT.map(c => y1[c] > 0 && <span key={c} data-cert={c} style={{ width: `${(y1[c] / certTotal) * 100}%` }} title={`${c}: ${fmtMoney(y1[c], cur, prelim)}`}>{c} {((y1[c] / certTotal) * 100).toFixed(0)}%</span>)}</div> : <p className={styles.meta}>No year-1 revenue.</p>}
          <p className={styles.meta}>Speculative revenue is {def.includeSpeculative ? <b className={styles.warn}>INCLUDED (not a base case)</b> : "excluded from this case"}.</p>
          <h4>Assumptions lacking evidence</h4>
          <ul className={styles.issues}>{[...def.capex, ...def.revenue, ...def.opex].filter(a => !a.source || a.status === "placeholder").slice(0, 12).map(a => <li key={a.id} data-level="review">{a.label}: {a.status === "placeholder" ? "placeholder" : "no source"}</li>)}</ul>
        </section>
        <section>
          <h4>Sources and uses</h4>
          <table className={styles.t}><tbody>
            {[["CAPEX (incl. contingency)", o.uses.capex], ["Development cost remaining", o.uses.development], ["Interest during construction", o.uses.idc], ["Financing fees", o.uses.fees], ["DSRA funding", o.uses.dsra]].map(([k, v]) => <tr key={k as string}><td>{k}</td><td>{fmtMoney(v as number, cur, prelim)}</td></tr>)}
            <tr className={styles.total}><td>Total uses</td><td>{fmtMoney(o.uses.total, cur, prelim)}</td></tr>
            <tr><td>Debt</td><td>{fmtMoney(o.sources.debt, cur, prelim)} ({o.uses.total ? ((o.sources.debt / o.uses.total) * 100).toFixed(0) : 0}%)</td></tr>
            <tr><td>Grants</td><td>{fmtMoney(o.sources.grants, cur, prelim)}</td></tr>
            <tr><td>Equity</td><td>{fmtMoney(o.sources.equity, cur, prelim)}</td></tr>
            <tr className={styles.total}><td>Total sources</td><td>{fmtMoney(o.sources.total, cur, prelim)} {Math.abs(o.sources.total - o.uses.total) < 1 ? "✓ = uses" : "≠ uses"}</td></tr>
          </tbody></table>
          {bridge.length > 0 && <><h4>Value bridge (your stage discount rates)</h4><table className={styles.t}><tbody>{bridge.map(b => <tr key={b.stage}><td>{b.stage} @ {b.ratePct}%</td><td>{fmtMoney(b.value, cur, prelim)}</td><td>{b.uplift === null ? "" : `+${fmtMoney(b.uplift, cur, prelim)}`}</td></tr>)}</tbody></table></>}
          <p className={styles.meta}>{CONVENTIONS}</p>
        </section>
      </div>}

      {tab === "assumptions" && <div className={styles.assump}>
        <section><h4>General</h4><div className={styles.grid}>
          <label>Currency<input value={def.currency} onChange={e => up({ currency: e.target.value.toUpperCase().slice(0, 3) })} disabled={readOnly} /></label>
          <label>Basis<select value={def.basis} onChange={e => up({ basis: e.target.value as "nominal" | "real" })} disabled={readOnly}><option value="nominal">Nominal</option><option value="real">Real</option></select></label>
          <label>Construction (months)<input value={def.constructionMonths} onChange={e => up({ constructionMonths: num(e.target.value) })} disabled={readOnly} /></label>
          <label>COD delay (months)<input value={def.codDelayMonths} onChange={e => up({ codDelayMonths: num(e.target.value) })} disabled={readOnly} /></label>
          <label>Operating life (years)<input value={def.operatingYears} onChange={e => up({ operatingYears: num(e.target.value) })} disabled={readOnly} /></label>
          <label>Project discount rate %<input value={def.discountRatePct} onChange={e => up({ discountRatePct: num(e.target.value) })} disabled={readOnly} /></label>
          <label>Equity hurdle %<input value={def.equityHurdlePct} onChange={e => up({ equityHurdlePct: num(e.target.value) })} disabled={readOnly} /></label>
          <label>Residual value<input value={def.residualValue} onChange={e => up({ residualValue: num(e.target.value) })} disabled={readOnly} /></label>
          <label>Decommissioning / restoration<input value={def.decommissioning} onChange={e => up({ decommissioning: num(e.target.value) })} disabled={readOnly} /></label>
          <label className={styles.check}><input type="checkbox" checked={def.includeSpeculative} onChange={e => up({ includeSpeculative: e.target.checked })} disabled={readOnly} /> Include speculative revenue (scenario only)</label>
        </div></section>

        {def.generation && <section><h4>Generation</h4><div className={styles.grid}>
          {([["capacityMw", "Capacity (MW)"], ["capacityFactorPct", "Capacity factor %"], ["availabilityPct", "Availability %"], ["degradationPct", "Degradation %/yr"], ["curtailmentPct", "Curtailment %"], ["lossesPct", "Losses %"], ["p75Factor", "P75 factor"], ["p90Factor", "P90 factor"]] as const).map(([k, l]) => <label key={k}>{l}<input value={def.generation![k]} onChange={e => up({ generation: { ...def.generation!, [k]: num(e.target.value) } })} disabled={readOnly} /></label>)}
          <label>Case<select value={def.generation.pCase} onChange={e => up({ generation: { ...def.generation!, pCase: e.target.value as "P50" } })} disabled={readOnly}><option>P50</option><option>P75</option><option>P90</option></select></label>
          <label>Source<input value={def.generation.source} onChange={e => up({ generation: { ...def.generation!, source: e.target.value } })} placeholder="Energy yield assessment" disabled={readOnly} /></label>
        </div></section>}

        <section><h4>CAPEX</h4>
          <table className={styles.t}><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit cost</th><th>Cont. %</th><th>Subtotal</th><th>Source</th><th>Date</th><th>Conf.</th><th>Status</th><th /></tr></thead><tbody>
            {def.capex.map((l, i) => <tr key={l.id}>
              <td><input value={l.label} onChange={e => rowSet("capex", i, { label: e.target.value } as Partial<CapexLine>)} disabled={readOnly} />{l.fromSite && <small className={styles.site}>{l.fromSite}</small>}</td>
              <td><input className={styles.n} value={l.quantity} onChange={e => rowSet("capex", i, { quantity: num(e.target.value) } as Partial<CapexLine>)} disabled={readOnly} /></td>
              <td><input className={styles.u} value={l.unit} onChange={e => rowSet("capex", i, { unit: e.target.value } as Partial<CapexLine>)} disabled={readOnly} /></td>
              <td><input className={styles.n} value={l.unitCost} onChange={e => rowSet("capex", i, { unitCost: num(e.target.value) } as Partial<CapexLine>)} disabled={readOnly} /></td>
              <td><input className={styles.u} value={l.contingencyPct} onChange={e => rowSet("capex", i, { contingencyPct: num(e.target.value) } as Partial<CapexLine>)} disabled={readOnly} /></td>
              <td className={styles.num}>{fmtMoney(l.quantity * l.unitCost * (1 + l.contingencyPct / 100), cur, false)}</td>
              <ProvCells row={l} set={p => rowSet("capex", i, p as Partial<CapexLine>)} readOnly={readOnly} />
              <td>{!readOnly && <button type="button" onClick={() => rowDel("capex", i)} aria-label="Remove">×</button>}</td></tr>)}
          </tbody></table>
          {!readOnly && <button type="button" className={styles.add} onClick={() => up({ capex: [...def.capex, { id: uid(), category: "other", label: "New item", quantity: 1, unit: "lot", unitCost: 0, contingencyPct: 0, ...blankProv() }] })}>Add CAPEX line</button>}
        </section>

        <section><h4>Development budget (pre-construction)</h4>
          <table className={styles.t}><thead><tr><th>Item</th><th>Budget</th><th>Committed</th><th>Spent</th><th>Remaining</th><th>Gate</th><th>Source</th><th>Date</th><th>Conf.</th><th>Status</th><th /></tr></thead><tbody>
            {def.development.map((l, i) => <tr key={l.id}>
              <td><input value={l.label} onChange={e => rowSet("development", i, { label: e.target.value } as Partial<DevCostLine>)} disabled={readOnly} /></td>
              {(["budget", "committed", "spent"] as const).map(k => <td key={k}><input className={styles.n} value={l[k]} onChange={e => rowSet("development", i, { [k]: num(e.target.value) } as Partial<DevCostLine>)} disabled={readOnly} /></td>)}
              <td className={styles.num}>{fmtMoney(Math.max(0, l.budget - l.spent), cur, false)}</td>
              <td><input className={styles.u} value={l.gate ?? ""} onChange={e => rowSet("development", i, { gate: e.target.value } as Partial<DevCostLine>)} disabled={readOnly} placeholder="G2" /></td>
              <ProvCells row={l} set={p => rowSet("development", i, p as Partial<DevCostLine>)} readOnly={readOnly} />
              <td>{!readOnly && <button type="button" onClick={() => rowDel("development", i)} aria-label="Remove">×</button>}</td></tr>)}
          </tbody></table>
          {!readOnly && <button type="button" className={styles.add} onClick={() => up({ development: [...def.development, { id: uid(), category: "studies", label: "New item", budget: 0, committed: 0, spent: 0, gate: null, ...blankProv() }] })}>Add development cost</button>}
        </section>

        <section><h4>Revenue</h4>
          <table className={styles.t}><thead><tr><th>Stream</th><th>Certainty</th><th>Basis</th><th>Volume / share %</th><th>Price</th><th>Esc. %</th><th>Start yr</th><th>Term yrs</th><th>Tail price</th><th>Source</th><th>Date</th><th>Conf.</th><th>Status</th><th /></tr></thead><tbody>
            {def.revenue.map((s, i) => <tr key={s.id} data-cert={s.certainty}>
              <td><input value={s.label} onChange={e => rowSet("revenue", i, { label: e.target.value } as Partial<RevenueStream>)} disabled={readOnly} /></td>
              <td><select value={s.certainty} onChange={e => rowSet("revenue", i, { certainty: e.target.value as Certainty } as Partial<RevenueStream>)} disabled={readOnly}>{CERT.map(c => <option key={c}>{c}</option>)}</select></td>
              <td><select value={s.basis} onChange={e => rowSet("revenue", i, { basis: e.target.value as "energy" } as Partial<RevenueStream>)} disabled={readOnly}><option value="energy">energy</option><option value="fixed">fixed volume</option></select></td>
              <td><input className={styles.n} value={s.basis === "energy" ? s.shareOfGeneration : s.annualVolume} onChange={e => rowSet("revenue", i, (s.basis === "energy" ? { shareOfGeneration: num(e.target.value) } : { annualVolume: num(e.target.value) }) as Partial<RevenueStream>)} disabled={readOnly} /></td>
              {(["price", "escalationPct", "startYear", "termYears", "tailPrice"] as const).map(k => <td key={k}><input className={k === "price" || k === "tailPrice" ? styles.n : styles.u} value={s[k]} onChange={e => rowSet("revenue", i, { [k]: num(e.target.value) } as Partial<RevenueStream>)} disabled={readOnly} /></td>)}
              <ProvCells row={s} set={p => rowSet("revenue", i, p as Partial<RevenueStream>)} readOnly={readOnly} />
              <td>{!readOnly && <button type="button" onClick={() => rowDel("revenue", i)} aria-label="Remove">×</button>}</td></tr>)}
          </tbody></table>
          {!readOnly && <button type="button" className={styles.add} onClick={() => up({ revenue: [...def.revenue, { id: uid(), label: "New stream", type: "other", certainty: "forecast", basis: "fixed", annualVolume: 0, unit: "units", price: 0, escalationPct: 0, startYear: 1, termYears: 0, tailPrice: 0, shareOfGeneration: 0, ...blankProv() }] })}>Add revenue stream</button>}
          <p className={styles.meta}>Contracted means a signed contract; speculative streams never enter a base case. Energy streams sell a share of net generation.</p>
        </section>

        <section><h4>OPEX</h4>
          <table className={styles.t}><thead><tr><th>Item</th><th>Kind</th><th>Amount</th><th>Esc. %</th><th>Source</th><th>Date</th><th>Conf.</th><th>Status</th><th /></tr></thead><tbody>
            {def.opex.map((l, i) => <tr key={l.id}>
              <td><input value={l.label} onChange={e => rowSet("opex", i, { label: e.target.value } as Partial<OpexLine>)} disabled={readOnly} /></td>
              <td><select value={l.kind} onChange={e => rowSet("opex", i, { kind: e.target.value as "fixed" } as Partial<OpexLine>)} disabled={readOnly}><option value="fixed">fixed / yr</option><option value="per_mwh">per MWh</option><option value="pct_revenue">% of revenue</option></select></td>
              <td><input className={styles.n} value={l.amount} onChange={e => rowSet("opex", i, { amount: num(e.target.value) } as Partial<OpexLine>)} disabled={readOnly} /></td>
              <td><input className={styles.u} value={l.escalationPct} onChange={e => rowSet("opex", i, { escalationPct: num(e.target.value) } as Partial<OpexLine>)} disabled={readOnly} /></td>
              <ProvCells row={l} set={p => rowSet("opex", i, p as Partial<OpexLine>)} readOnly={readOnly} />
              <td>{!readOnly && <button type="button" onClick={() => rowDel("opex", i)} aria-label="Remove">×</button>}</td></tr>)}
          </tbody></table>
          {!readOnly && <button type="button" className={styles.add} onClick={() => up({ opex: [...def.opex, { id: uid(), label: "New cost", kind: "fixed", amount: 0, escalationPct: 2, ...blankProv() }] })}>Add OPEX line</button>}
        </section>

        <section><h4>Debt</h4>
          {!def.debt ? <button type="button" className={styles.add} disabled={readOnly} onClick={() => up({ debt: { name: "Senior debt", sizing: "dscr", targetDscr: 1.3, maxGearingPct: 70, amount: 0, ratePct: 0, tenorYears: 15, profile: "sculpted", upfrontFeePct: 0, dsraMonths: 6, lockupDscr: 1.1, currency: def.currency, ...blankProv() } })}>Add senior debt</button> : <div className={styles.grid}>
            <label>Sizing<select value={def.debt.sizing} onChange={e => up({ debt: { ...def.debt!, sizing: e.target.value as "dscr" } })} disabled={readOnly}><option value="dscr">DSCR (capped by gearing)</option><option value="gearing">Gearing</option><option value="amount">Fixed amount</option></select></label>
            <label>Profile<select value={def.debt.profile} onChange={e => up({ debt: { ...def.debt!, profile: e.target.value as "sculpted" } })} disabled={readOnly}><option value="sculpted">Sculpted</option><option value="annuity">Annuity</option><option value="straight">Straight-line</option><option value="bullet">Bullet</option></select></label>
            {([["targetDscr", "Target DSCR x"], ["maxGearingPct", "Max gearing %"], ["amount", "Amount (fixed)"], ["ratePct", "All-in rate %"], ["tenorYears", "Tenor (years)"], ["upfrontFeePct", "Upfront fee %"], ["dsraMonths", "DSRA (months)"], ["lockupDscr", "Lock-up DSCR x"]] as const).map(([k, l]) => <label key={k}>{l}<input value={def.debt![k]} onChange={e => up({ debt: { ...def.debt!, [k]: num(e.target.value) } })} disabled={readOnly} /></label>)}
            <label>Debt currency<input value={def.debt.currency} onChange={e => up({ debt: { ...def.debt!, currency: e.target.value.toUpperCase().slice(0, 3) } })} disabled={readOnly} /></label>
            <label>Source<input value={def.debt.source} onChange={e => up({ debt: { ...def.debt!, source: e.target.value } })} placeholder="Indicative term sheet" disabled={readOnly} /></label>
            {!readOnly && <button type="button" className={styles.add} onClick={() => up({ debt: null })}>Remove debt</button>}
          </div>}
        </section>

        <section><h4>Tax and value bridge</h4><div className={styles.grid}>
          <label>Tax rate %<input value={def.tax.ratePct} onChange={e => up({ tax: { ...def.tax, ratePct: num(e.target.value) } })} disabled={readOnly} /></label>
          <label>Depreciation (years, straight-line)<input value={def.tax.depreciationYears} onChange={e => up({ tax: { ...def.tax, depreciationYears: num(e.target.value) } })} disabled={readOnly} /></label>
          <label className={styles.check}><input type="checkbox" checked={def.tax.lossCarryforward} onChange={e => up({ tax: { ...def.tax, lossCarryforward: e.target.checked } })} disabled={readOnly} /> Loss carry-forward</label>
          <label className={styles.check}><input type="checkbox" checked={def.tax.interestDeductible} onChange={e => up({ tax: { ...def.tax, interestDeductible: e.target.checked } })} disabled={readOnly} /> Interest deductible</label>
          <label>Tax source<input value={def.tax.source} onChange={e => up({ tax: { ...def.tax, source: e.target.value } })} placeholder="Tax adviser memo" disabled={readOnly} /></label>
          <label className={styles.wide}>Stage discount rates for the value bridge (stage:rate, …)<input defaultValue={def.stageDiscountRates.map(s => `${s.stage}:${s.ratePct}`).join(", ")} onBlur={e => up({ stageDiscountRates: e.target.value.split(",").map(x => x.split(":")).filter(p => p.length === 2 && p[0].trim()).map(([s, r]) => ({ stage: s.trim(), ratePct: num(r) })) })} placeholder="Concept:25, Permitted:18, PPA secured:14, RTB:11, Operating:8" disabled={readOnly} /></label>
        </div></section>
      </div>}

      {tab === "cashflow" && <section>
        <div className={styles.scroll}><table className={styles.t}><thead><tr><th>Year</th>{o.periods.map(p => <th key={p.year} data-phase={p.phase}>{p.year}{p.phase === "construction" ? " C" : ""}</th>)}</tr></thead><tbody>
          {([["Revenue", p => p.revenue], ["· contracted", p => p.revenueByCertainty.contracted], ["· forecast", p => p.revenueByCertainty.forecast], ["· merchant", p => p.revenueByCertainty.merchant], ["· speculative", p => p.revenueByCertainty.speculative], ["OPEX", p => -p.opex], ["EBITDA", p => p.ebitda], ["Tax", p => -p.tax], ["CFADS", p => p.cfads], ["Debt service", p => -p.debtService], ["DSCR", p => p.dscr], ["Distributions", p => p.distributions], ["Equity flow", p => p.equityFlow], ["Project flow", p => p.projectFlow]] as [string, (p: (typeof o.periods)[number]) => number | null][]).map(([k, f]) => <tr key={k} className={/EBITDA|CFADS|Equity flow/.test(k) ? styles.total : undefined}><td>{k}</td>{o.periods.map(p => { const v = f(p); return <td key={p.year} className={styles.num}>{v === null ? "" : k === "DSCR" ? v.toFixed(2) : Math.abs(v) < 0.5 ? "–" : (v / 1000).toFixed(0)}</td>; })}</tr>)}
        </tbody></table></div>
        <p className={styles.meta}>Thousands of {cur}. {CONVENTIONS} Lock-up years: {ops.filter(p => p.lockedUp).map(p => p.year).join(", ") || "none"}.</p>
        <button type="button" className={styles.add} onClick={csv}>Export cash flow (CSV)</button>
      </section>}

      {tab === "debt" && <section>
        {!def.debt ? <p className={styles.meta}>No debt in this case.</p> : <div className={styles.scroll}><table className={styles.t}><thead><tr><th>Op. year</th><th>Opening</th><th>Interest</th><th>Principal</th><th>Debt service</th><th>Closing</th><th>CFADS</th><th>DSCR</th><th>DSRA flow</th></tr></thead><tbody>
          {ops.filter(p => p.debtOpening > 0.5 || p.debtService > 0.5).map((p, i) => <tr key={p.year}><td>{i + 1}</td><td className={styles.num}>{(p.debtOpening / 1000).toFixed(0)}</td><td className={styles.num}>{(p.interest / 1000).toFixed(0)}</td><td className={styles.num}>{(p.principal / 1000).toFixed(0)}</td><td className={styles.num}>{(p.debtService / 1000).toFixed(0)}</td><td className={styles.num}>{(p.debtClosing / 1000).toFixed(0)}</td><td className={styles.num}>{(p.cfads / 1000).toFixed(0)}</td><td className={styles.num} data-low={p.dscr !== null && def.debt!.lockupDscr > 0 && p.dscr < def.debt!.lockupDscr}>{p.dscr?.toFixed(2) ?? ""}</td><td className={styles.num}>{p.dsraFlow ? (p.dsraFlow / 1000).toFixed(0) : ""}</td></tr>)}
        </tbody></table></div>}
        <p className={styles.meta}>Debt {fmtMoney(o.debt, cur, prelim)} sized by {o.debtSizedBy}; IDC {fmtMoney(o.uses.idc, cur, prelim)}; fees {fmtMoney(o.uses.fees, cur, prelim)}; DSRA {fmtMoney(o.uses.dsra, cur, prelim)}; min/avg DSCR {x2(o.minDscr)} / {x2(o.avgDscr)}; LLCR {x2(o.llcr)}; PLCR {x2(o.plcr)}. Thousands of {cur}.</p>
      </section>}

      {tab === "sensitivity" && tornado && grid && <section className={styles.cols}>
        <div>
          <h4>Tornado: equity IRR, ±<select value={swing} onChange={e => setSwing(Number(e.target.value))}>{[5, 10, 20].map(v => <option key={v} value={v}>{v}%</option>)}</select></h4>
          {(() => { const base = tornado.base.equityIrr ?? 0; const max = Math.max(1, ...tornado.rows.flatMap(r => [Math.abs((r.low.equityIrr ?? base) - base), Math.abs((r.high.equityIrr ?? base) - base)])); return (
            <svg className={styles.tornado} viewBox={`0 0 420 ${tornado.rows.length * 26 + 20}`}>
              <line x1={260} x2={260} y1={0} y2={tornado.rows.length * 26 + 6} stroke="currentColor" strokeOpacity={0.4} />
              {tornado.rows.map((r, i) => { const lo = (r.low.equityIrr ?? base) - base, hi = (r.high.equityIrr ?? base) - base; const s = 150 / max; return <g key={r.key} transform={`translate(0 ${i * 26 + 4})`}>
                <text x={0} y={14}>{r.label}</text>
                <rect x={Math.min(260, 260 + lo * s)} y={3} width={Math.abs(lo * s)} height={14} data-dir="low" />
                <rect x={Math.min(260, 260 + hi * s)} y={3} width={Math.abs(hi * s)} height={14} data-dir="high" />
              </g>; })}
              <text x={262} y={tornado.rows.length * 26 + 18}>base {base.toFixed(1)}%</text>
            </svg>); })()}
          <p className={styles.meta}>Ranked by impact. Dark bars: −{swing}%; light bars: +{swing}%.</p>
        </div>
        <div>
          <h4>Equity IRR: price × CAPEX</h4>
          <table className={styles.t}><thead><tr><th>price ↓ / CAPEX →</th>{grid.steps.map(s => <th key={s}>{s > 0 ? "+" : ""}{s}%</th>)}</tr></thead><tbody>{grid.grid.map((row, i) => <tr key={i}><td>{grid.steps[i] > 0 ? "+" : ""}{grid.steps[i]}%</td>{row.map((v, j) => <td key={j} className={styles.num} data-below={v !== null && v < def.equityHurdlePct}>{v === null ? "—" : `${v.toFixed(1)}%`}</td>)}</tr>)}</tbody></table>
          <p className={styles.meta}>Cells below the {def.equityHurdlePct}% hurdle are marked.</p>
        </div>
      </section>}

      {tab === "stress" && stress && be && <section className={styles.cols}>
        <div><h4>Stress cases</h4><table className={styles.t}><thead><tr><th>Case</th><th>Equity IRR</th><th>Min DSCR</th><th>Debt serviced</th><th>Covenant</th></tr></thead><tbody>
          {stress.map(s => <tr key={s.key}><td>{s.label}</td><td className={styles.num}>{s.equityIrr === null ? "—" : `${s.equityIrr.toFixed(1)}%`}</td><td className={styles.num}>{x2(s.minDscr)}</td><td>{s.debtServiced ? "yes" : <b className={styles.warn}>NO</b>}</td><td>{s.covenantBreach ? <b className={styles.warn}>breach</b> : "ok"}</td></tr>)}
        </tbody></table></div>
        <div><h4>Breakevens</h4><table className={styles.t}><tbody>{be.map(b => <tr key={b.label}><td>{b.label}</td><td>{b.value}</td></tr>)}</tbody></table>
          <p className={styles.meta}>Each breakeven moves one driver across all streams or lines, holding everything else.</p></div>
      </section>}

      {tab === "versions" && <section>
        <table className={styles.t}><thead><tr><th>Version</th><th>Name</th><th>Case</th><th>Status</th></tr></thead><tbody>{versions.map(v => <tr key={v.id} data-current={v.id === modelId}><td>V{v.version}</td><td>{v.name}</td><td>{v.caseType}</td><td>{v.status}</td></tr>)}</tbody></table>
        {versions.length > 1 && <><label className={styles.inline}>Compare this case against <select value={compareTo} onChange={e => setCompareTo(e.target.value)}>{versions.filter(v => v.id !== modelId).map(v => <option key={v.id} value={v.id}>V{v.version} {v.name}</option>)}</select></label>
          {diff && <><p>Equity IRR {diff.from === null ? "—" : `${diff.from.toFixed(1)}%`} → {diff.to === null ? "—" : `${diff.to.toFixed(1)}%`}</p>
            <table className={styles.t}><thead><tr><th>Driver block</th><th>Equity IRR contribution</th></tr></thead><tbody>{diff.attribution.map(a => <tr key={a.block}><td>{a.block}</td><td className={styles.num}>{a.delta === null ? "—" : `${a.delta > 0 ? "+" : ""}${a.delta.toFixed(2)} pts`}</td></tr>)}</tbody></table>
            <details><summary>{diff.changes.length} changed inputs</summary><table className={styles.t}><tbody>{diff.changes.slice(0, 200).map(c => <tr key={c.key}><td>{c.key}</td><td>{JSON.stringify(c.from)}</td><td>→ {JSON.stringify(c.to)}</td></tr>)}</tbody></table></details></>}</>}
      </section>}

      {!readOnly && <form action={saveModelAction} className={styles.save}>
        <input type="hidden" name="modelId" value={modelId} /><input type="hidden" name="definition" value={JSON.stringify(def)} />
        <input name="reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for the change (recorded with each changed input)" aria-label="Reason" />
        <button className="btn btn--primary" type="submit" disabled={!dirty}>{dirty ? "Save changes" : "Saved"}</button>
        {dirty && <button type="button" className="btn" onClick={() => setDef(initial)}>Discard</button>}
      </form>}
      {readOnly && <p className={styles.meta}>This case is {status}: read-only. Create a new version to change assumptions.</p>}
    </div>
  );
}
