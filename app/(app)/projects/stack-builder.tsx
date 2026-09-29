"use client";

// Interactive capital stack builder (master build instruction §11): edit layers and watch coverage, mix, weighted
// cost and warnings update live; Save posts the whole scenario. Seniority order: most senior at the bottom.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { summarizeStack, type LayerInput } from "@/lib/capital/stack-summary";
import { ASSUMPTION_STATUSES, FAMILY_COLORS, LAYER_STATUSES, STACK_LAYERS, STRUCTURE_STATUSES, type StackLayer } from "@/lib/capital/structure-vocab";
import { saveStructureAction } from "../structure-actions";
import styles from "./stack.module.css";

export type BuilderStructure = { id: string; name: string; currency: string; totalCost: number | null; costSource: string; status: string; notes: string; layers: LayerInput[] };

const money = (n: number | null | undefined, cur: string) => (n == null ? "—" : `${cur} ${n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : Math.round(n)}`);
const toNum = (v: string) => { const s = v.replace(/[^0-9.\-]/g, ""); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

function blank(layer: StackLayer, currency: string): LayerInput {
  return { layer, provider: "", currency, amount: null, pricing: "", ratePct: null, tenorYears: null, amortization: "", security: "", status: "assumption", conditions: "", source: "", assumptionStatus: "assumption" };
}

export default function StackBuilder({ structure }: { structure: BuilderStructure }) {
  const [head, setHead] = useState({ name: structure.name, currency: structure.currency, totalCost: structure.totalCost, costSource: structure.costSource, status: structure.status, notes: structure.notes });
  const [layers, setLayers] = useState<LayerInput[]>(structure.layers);
  const [adding, setAdding] = useState<StackLayer>("sponsor_equity");
  const [open, setOpen] = useState<number | null>(null);
  const summary = useMemo(() => summarizeStack({ currency: head.currency, totalCost: head.totalCost, layers }), [head.currency, head.totalCost, layers]);
  const dirty = JSON.stringify({ head, layers }) !== JSON.stringify({ head: { name: structure.name, currency: structure.currency, totalCost: structure.totalCost, costSource: structure.costSource, status: structure.status, notes: structure.notes }, layers: structure.layers });

  const set = (i: number, patch: Partial<LayerInput>) => setLayers(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => setLayers(ls => { const n = [...ls]; const j = i + d; if (j < 0 || j >= n.length) return ls; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const scale = Math.max(summary.totalCost ?? 0, summary.funded, 1);
  // Bar: most senior at the bottom (render order reversed), gap on top.
  const barLayers = summary.layers.filter(l => l.family !== "support" && (l.amount ?? 0) > 0 && l.currency === head.currency);
  const gap = summary.gap != null && summary.gap > 0 ? summary.gap : 0;

  return (
    <div className={styles.builder}>
      <div className={styles.headGrid}>
        <label>Scenario<input value={head.name} onChange={e => setHead(h => ({ ...h, name: e.target.value }))} maxLength={120} /></label>
        <label>Currency<input value={head.currency} onChange={e => setHead(h => ({ ...h, currency: e.target.value.toUpperCase().slice(0, 3) }))} /></label>
        <label>Total cost (uses of funds)<input inputMode="decimal" value={head.totalCost ?? ""} onChange={e => setHead(h => ({ ...h, totalCost: toNum(e.target.value) }))} placeholder="Not set" /></label>
        <label>Cost source<input value={head.costSource} onChange={e => setHead(h => ({ ...h, costSource: e.target.value }))} placeholder="e.g. EPC budget v2, sponsor model" /></label>
        <label>Status<select value={head.status} onChange={e => setHead(h => ({ ...h, status: e.target.value }))}>{Object.entries(STRUCTURE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>

      <div className={styles.split}>
        <div className={styles.barWrap} aria-label="Capital stack chart">
          <div className={styles.bar}>
            {gap > 0 && <div className={styles.gapSeg} style={{ height: `${(gap / scale) * 100}%` }}><span>Gap {money(gap, head.currency)}</span></div>}
            {[...barLayers].reverse().map((l, i) => (
              <div key={i} className={styles.seg} style={{ height: `${((l.amount ?? 0) / scale) * 100}%`, background: FAMILY_COLORS[l.family] }} title={`${STACK_LAYERS[l.layer].label}${l.provider ? ` · ${l.provider}` : ""}: ${money(l.amount, l.currency)} (${l.pct ?? "?"}%)`} data-assumption={l.assumptionStatus === "assumption"}>
                <span>{STACK_LAYERS[l.layer].label}{l.provider ? ` · ${l.provider}` : ""}</span><b>{l.pct != null ? `${l.pct}%` : ""}</b>
              </div>
            ))}
          </div>
          <p className={styles.axis}>{summary.totalCost ? `Total cost ${money(summary.totalCost, head.currency)}` : "Total cost not set"}</p>
          <p className={styles.legend}>{(["debt", "mezzanine", "equity", "grant"] as const).map(f => <span key={f}><i style={{ background: FAMILY_COLORS[f] }} />{f}</span>)}<span><i className={styles.hatch} />assumption</span></p>
        </div>
        <div>
          <div className={styles.metrics}>
            <div><span>Funded</span><b>{money(summary.funded, head.currency)}</b></div>
            <div><span>Coverage</span><b>{summary.coveragePct != null ? `${summary.coveragePct}%` : "—"}</b></div>
            <div><span>{(summary.gap ?? 0) >= 0 ? "Gap" : "Over"}</span><b>{summary.gap != null ? money(Math.abs(summary.gap), head.currency) : "—"}</b></div>
            <div><span>Debt / equity</span><b>{summary.debtPct != null ? `${summary.debtPct}% / ${summary.equityPct}%` : "—"}</b></div>
            <div><span>Weighted rate</span><b>{summary.weightedRatePct != null ? `${summary.weightedRatePct}%` : "—"}</b><small>{summary.rateCoveragePct != null && summary.weightedRatePct != null ? `over ${summary.rateCoveragePct}% of funding` : "no rates entered"}</small></div>
            <div><span>Committed</span><b>{summary.committedPct != null ? `${summary.committedPct}%` : "—"}</b></div>
          </div>
          {summary.warnings.length > 0 && <ul className={styles.warnings}>{summary.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          <p className={styles.fine}>A screening view, not advice. No structure is labelled compliant or bankable; legal and lender review is recorded separately below.</p>
        </div>
      </div>

      <div className={styles.layers}>
        {layers.length === 0 && <p className={styles.fine}>No layers yet. Add the first one below.</p>}
        {layers.map((l, i) => (
          <div key={i} className={styles.layer} data-open={open === i}>
            <div className={styles.layerRow}>
              <i className={styles.fam} style={{ background: FAMILY_COLORS[STACK_LAYERS[l.layer].family] }} />
              <select value={l.layer} onChange={e => set(i, { layer: e.target.value as StackLayer })} aria-label="Layer">{Object.entries(STACK_LAYERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <input value={l.provider} onChange={e => set(i, { provider: e.target.value })} placeholder="Provider (or TBD)" aria-label="Provider" />
              <input className={styles.amt} inputMode="decimal" value={l.amount ?? ""} onChange={e => set(i, { amount: toNum(e.target.value) })} placeholder="Amount" aria-label="Amount" />
              <input className={styles.cur} value={l.currency} onChange={e => set(i, { currency: e.target.value.toUpperCase().slice(0, 3) })} aria-label="Currency" />
              <span className={styles.pct}>{summary.funded > 0 && l.amount != null && STACK_LAYERS[l.layer].family !== "support" && l.currency === head.currency ? `${Math.round((l.amount / summary.funded) * 1000) / 10}%` : "—"}</span>
              <select value={l.status} onChange={e => set(i, { status: e.target.value })} aria-label="Status">{Object.entries(LAYER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select value={l.assumptionStatus} onChange={e => set(i, { assumptionStatus: e.target.value })} aria-label="Assumption status">{Object.entries(ASSUMPTION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <span className={styles.tools}>
                <button type="button" onClick={() => setOpen(o => (o === i ? null : i))} aria-expanded={open === i}>Terms</button>
                <button type="button" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                <button type="button" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                <button type="button" onClick={() => setLayers(ls => ls.filter((_, j) => j !== i))} aria-label="Remove layer"><Trash2 size={13} /></button>
              </span>
            </div>
            {open === i && (
              <div className={styles.terms}>
                <label>Pricing<input value={l.pricing} onChange={e => set(i, { pricing: e.target.value })} placeholder="e.g. SOFR + 350 bp, 12% preferred return" /></label>
                <label>All-in rate % (for weighting)<input inputMode="decimal" value={l.ratePct ?? ""} onChange={e => set(i, { ratePct: toNum(e.target.value) })} /></label>
                <label>Tenor (years)<input inputMode="decimal" value={l.tenorYears ?? ""} onChange={e => set(i, { tenorYears: toNum(e.target.value) })} /></label>
                <label>Amortization<input value={l.amortization} onChange={e => set(i, { amortization: e.target.value })} placeholder="e.g. sculpted to 1.30x DSCR" /></label>
                <label>Security<input value={l.security} onChange={e => set(i, { security: e.target.value })} /></label>
                <label>Conditions<input value={l.conditions} onChange={e => set(i, { conditions: e.target.value })} placeholder="Conditions precedent, covenants" /></label>
                <label className={styles.wide}>Source<input value={l.source} onChange={e => set(i, { source: e.target.value })} placeholder="Where the terms come from (term sheet, email, market comparable)" /></label>
              </div>
            )}
          </div>
        ))}
        <div className={styles.add}>
          <select value={adding} onChange={e => setAdding(e.target.value as StackLayer)} aria-label="Layer to add">{Object.entries(STACK_LAYERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <button type="button" className="btn" onClick={() => { setLayers(ls => [...ls, blank(adding, head.currency)]); setOpen(layers.length); }}><Plus size={14} /> Add layer</button>
        </div>
      </div>

      <label className={styles.notes}>Notes<textarea rows={2} value={head.notes} onChange={e => setHead(h => ({ ...h, notes: e.target.value }))} /></label>
      <form action={saveStructureAction} className={styles.save}>
        <input type="hidden" name="structureId" value={structure.id} />
        <input type="hidden" name="payload" value={JSON.stringify({ ...head, layers })} />
        <button className="btn btn--primary" type="submit" disabled={!dirty || !head.name.trim() || !/^[A-Z]{3}$/.test(head.currency)}>{dirty ? "Save scenario" : "Saved"}</button>
        {dirty && <button type="button" className="btn" onClick={() => { setHead({ name: structure.name, currency: structure.currency, totalCost: structure.totalCost, costSource: structure.costSource, status: structure.status, notes: structure.notes }); setLayers(structure.layers); }}>Discard changes</button>}
      </form>
    </div>
  );
}
