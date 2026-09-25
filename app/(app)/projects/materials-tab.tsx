import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { boqItems, epds } from "@/db/schema";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import type { OsUser } from "@/lib/auth";
import { embodiedCarbon } from "@/lib/procurement/logic";
import { CIRCULARITY, LCA_STAGES, MATERIAL_CATEGORIES, TRANSPORT_MODES, type LcaStage } from "@/lib/procurement/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { addBoqItemAction, updateBoqItemAction } from "../procurement-actions";
import styles from "./projects.module.css";

const t = (kg: number) => `${(kg / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} t`;
const STATUS: Record<string, string> = { no_epd: "No EPD: not computed", unit_mismatch: "EPD unit differs: not computed", no_quantity: "No quantity" };

/** Bill of quantities with cost, lead time, origin, circularity and embodied carbon from published EPDs only. */
export default async function MaterialsTab({ project, scope }: { project: { id: string; currency: string | null }; scope: OsUser["scope"] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [items, library] = await Promise.all([
    appDb().select().from(boqItems).where(eq(boqItems.projectId, project.id)).orderBy(asc(boqItems.category), asc(boqItems.material)),
    appDb().select().from(epds).where(mandateCondition(scope, epds.mandateId)).orderBy(asc(epds.product)),
  ]);
  const carbon = embodiedCarbon(items, library, today);
  const line = new Map(carbon.lines.map(l => [l.id, l]));
  const cost = new Map<string, number>();
  for (const i of items) if (i.quantity !== null && i.unitCost !== null) cost.set(i.currency, (cost.get(i.currency) ?? 0) + i.quantity * i.unitCost);
  const longest = items.filter(i => i.leadTimeWeeks !== null).sort((a, b) => b.leadTimeWeeks! - a.leadTimeWeeks!).slice(0, 3);

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Embodied carbon</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Computed only from published EPDs whose declared unit matches the quantity. Items without EPD data are gaps, not estimates.</p>
          <div className={styles.metrics}>
            <div className={styles.metric}><span>Upfront (A1–A5)</span><b>{t(carbon.upfrontTonnes * 1000)} CO₂e</b></div>
            {(Object.keys(LCA_STAGES) as LcaStage[]).filter(s => carbon.totals[s] !== undefined).map(s => <div key={s} className={styles.metric}><span>{LCA_STAGES[s]}</span><b>{t(carbon.totals[s]!)}</b></div>)}
            <div className={styles.metric}><span>EPD coverage</span><b>{Math.round(carbon.coverage * 100)}% of items</b></div>
            {[...cost].map(([cur, v]) => <div key={cur} className={styles.metric}><span>Material cost</span><b>{compactMoney(v, cur)}</b></div>)}
          </div>
          {longest.length > 0 && <p className={ui.sub}>Longest lead times: {longest.map(i => `${i.material} ${i.leadTimeWeeks} weeks`).join(" · ")}.</p>}
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Bill of quantities</p>
          {items.length === 0 ? <p className={r.empty}>No materials recorded. Start with the carbon- and cost-heavy items (steel, concrete, modules, batteries, cables).</p> : (
            <table className={ui.table}><tbody>{items.map(i => {
              const l = line.get(i.id)!;
              const e = library.find(x => x.id === i.epdId);
              const kg = Object.values(l.kg).reduce((a, b) => a + (b ?? 0), 0);
              return (
                <tr key={i.id}>
                  <td><b>{i.material}</b> · {MATERIAL_CATEGORIES[i.category]}{i.specification ? ` · ${i.specification}` : ""}
                    <span className={ui.sub} style={{ display: "block" }}>{[i.quantity !== null && `${i.quantity.toLocaleString("en-US")} ${i.unit ?? ""}`, i.unitCost !== null && i.quantity !== null && compactMoney(i.unitCost * i.quantity, i.currency),
                      i.manufacturer, i.supplier && `via ${i.supplier}`, i.origin && `from ${i.origin}${i.distanceKm ? ` (${i.distanceKm.toLocaleString("en-US")} km${i.transportMode ? ` ${TRANSPORT_MODES[i.transportMode].toLowerCase()}` : ""})` : ""}`,
                      i.leadTimeWeeks !== null && `${i.leadTimeWeeks} weeks lead`, i.recycledPct !== null && `${i.recycledPct}% recycled`, i.biobasedPct !== null && `${i.biobasedPct}% bio-based`,
                      i.serviceLifeYears && `${i.serviceLifeYears}-year life`, `circularity: ${CIRCULARITY[i.circularity]}`, i.designForDisassembly && "designed for disassembly", i.endOfLife && `end of life: ${i.endOfLife}`,
                      i.hazards && `hazards: ${i.hazards}`, i.certification].filter(Boolean).join(" · ")}</span>
                    <span className={ui.sub} style={{ display: "block", color: l.status === "computed" ? undefined : "#b0432f" }}>
                      {l.status === "computed" ? `${t(kg)} CO₂e from ${e?.manufacturer} ${e?.product} EPD${e?.registrationNumber ? ` (${e.registrationNumber})` : ""}${l.expiredEpd ? " · EPD expired: replace it" : ""}` : STATUS[l.status]}</span></td>
                  <td>
                    <form action={updateBoqItemAction} className={styles.stack} style={{ minWidth: 190 }}>
                      <input type="hidden" name="itemId" value={i.id} />
                      <select name="epdId" defaultValue={i.epdId ?? ""} aria-label="EPD"><option value="">No EPD</option>{library.map(x => <option key={x.id} value={x.id}>{x.manufacturer} · {x.product} (per {x.declaredUnit})</option>)}</select>
                      <select name="circularity" defaultValue={i.circularity} aria-label="Circularity">{Object.entries(CIRCULARITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <button className={ui.miniBtn} type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}</tbody></table>
          )}
          <p className={ui.sub}>EPDs live in the <Link href="/network?tab=epds">EPD library</Link>: add them there from the published declaration.</p>
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a material</p>
          <form action={addBoqItemAction} className={styles.stack}>
            <input type="hidden" name="id" value={project.id} />
            <label>Material<input name="material" required minLength={2} placeholder="e.g. Reinforcing steel" /></label>
            <label>Category<select name="category" defaultValue="other">{Object.entries(MATERIAL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Specification<input name="specification" /></label>
            <label>Quantity<input name="quantity" inputMode="decimal" /></label>
            <label>Unit<input name="unit" placeholder="t, m³, unit, kWp" /></label>
            <label>Unit cost<input name="unitCost" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} /></label>
            <label>Manufacturer<input name="manufacturer" /></label>
            <label>Supplier<input name="supplier" /></label>
            <label>Origin country<input name="origin" /></label>
            <label>Distance to site (km)<input name="distanceKm" inputMode="decimal" /></label>
            <label>Transport<select name="transportMode" defaultValue=""><option value="">Not set</option>{Object.entries(TRANSPORT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Lead time (weeks)<input name="leadTimeWeeks" inputMode="decimal" /></label>
            <label>Recycled content (%)<input name="recycledPct" inputMode="decimal" /></label>
            <label>Bio-based content (%)<input name="biobasedPct" inputMode="decimal" /></label>
            <label>EPD<select name="epdId" defaultValue=""><option value="">None yet</option>{library.map(x => <option key={x.id} value={x.id}>{x.manufacturer} · {x.product} (per {x.declaredUnit})</option>)}</select></label>
            <label>Service life (years)<input name="serviceLifeYears" inputMode="decimal" /></label>
            <label>Circularity<select name="circularity" defaultValue="unknown">{Object.entries(CIRCULARITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="designForDisassembly" /> Designed for disassembly</label>
            <label>End of life<input name="endOfLife" placeholder="Take-back, recycling route …" /></label>
            <label>Hazards / toxicity<input name="hazards" /></label>
            <label>Certification<input name="certification" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
