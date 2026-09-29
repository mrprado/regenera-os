import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { landCandidates } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import type { Composition } from "@/lib/geo/landcover";
import { landGate } from "@/lib/natural/engine";
import { INTERVENTIONS, LAND_FLOW, LAND_STAGES, TENURE } from "@/lib/natural/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { landBaselineAction, landDiligenceAction, moveLandAction, updateLandAction } from "../../natural-actions";
import s from "../../projects/natural.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Land candidate" };
const DSTATUS = { open: "Open", in_progress: "In progress", clear: "Clear", issue: "Issue", "n/a": "N/a" } as const;

export default async function LandDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/land/${id}`);
  const sp = await searchParams;
  const [c] = await appDb().select().from(landCandidates).where(and(eq(landCandidates.id, id), mandateCondition(user.scope, landCandidates.mandateId)));
  if (!c) notFound();
  const idx = LAND_FLOW.indexOf(c.stage as (typeof LAND_FLOW)[number]);
  const next = idx >= 0 ? LAND_FLOW[idx + 1] : undefined;
  const block = next ? landGate(c, next) : null;
  const base = c.siteBaseline as (Composition & { at?: string }) | null;
  const mapHref = c.lat !== null && c.lng !== null ? `/map#${c.lat.toFixed(4)},${c.lng.toFixed(4)},12` : "/map";
  return (
    <>
      <PageHeader title={c.name} actions={<Link className="btn" href={mapHref}>Open in Atlas</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub}><Link href="/land">← Land pipeline</Link> · {LAND_STAGES[c.stage]}{c.projectId ? <> · <Link href={`/projects/${c.projectId}`}>Project</Link></> : null}{c.source ? ` · source: ${c.source}` : ""}</p>
      <div className={s.flow}>{LAND_FLOW.map((k, i) => <div key={k} style={{ opacity: i <= idx ? 1 : 0.45 }}><span>{LAND_STAGES[k]}</span><b>{i < idx ? "✓" : i === idx ? "●" : ""}</b></div>)}</div>
      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}>Stage</p>
          {c.stage === "dropped" ? <p className={ui.sub}>Dropped: {c.dropReason}</p> : next ? <>
            {block ? <p className={ui.warn}>Next ({LAND_STAGES[next]}): {block}</p> : null}
            <form action={moveLandAction} className={s.inline}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="stage" value={next} /><button className="btn btn--primary" type="submit" disabled={!!block}>{next === "project" ? "Create project" : `Move to ${LAND_STAGES[next]}`}</button></form>
          </> : <p className={ui.sub}>Converted to a project.</p>}
          {c.stage !== "dropped" && c.stage !== "project" && <form action={moveLandAction} className={s.inline}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="stage" value="dropped" /><label className={s.wide}>Drop reason<input name="dropReason" /></label><button className={ui.miniBtn} type="submit">Drop</button></form>}

          <p className={r.panelTitle} style={{ marginTop: 14 }}>Diligence</p>
          <table className={ui.table}><thead><tr><th>Item</th><th>Status</th><th>Note</th><th /></tr></thead><tbody>
            {c.diligence.map(d => <tr key={d.item}><td>{d.item}</td><td colSpan={3}><form action={landDiligenceAction} className={s.mini}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="item" value={d.item} />
              <select name="status" defaultValue={d.status} aria-label={`${d.item} status`} style={{ color: d.status === "issue" ? "#b0432f" : undefined }}>{Object.entries(DSTATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input name="note" defaultValue={d.note} aria-label={`${d.item} note`} style={{ width: 280 }} /><button className={ui.miniBtn} type="submit">Save</button></form></td></tr>)}
          </tbody></table>
          <form action={landDiligenceAction} className={s.inline}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="open" /><label>Add item<input name="item" required /></label><button className={ui.miniBtn} type="submit">Add</button></form>
        </section>
        <aside>
          <section className={r.panel}><p className={r.panelTitle}><span>Land cover baseline</span><span className={ui.chip}>SCREENING</span></p>
            {base ? <>
              <p className={ui.sub}>{base.source}, {base.siteHa} ha, ~{base.resolutionM} m cells.</p>
              {base.classes.map(x => <div key={x.code} style={{ display: "flex", gap: 8, fontSize: 12.5 }}><i style={{ width: 10, height: 10, borderRadius: 5, background: x.color, marginTop: 4 }} /><span style={{ flex: 1 }}>{x.label}</span><span>{x.ha} ha · {x.pct}%</span></div>)}
              <p>Natural cover <b>{base.naturalHa} ha ({base.naturalPct}%)</b></p><p className={ui.sub}>{base.limitation}</p>
            </> : <p className={ui.sub}>{c.geometry ? "Read the ESA WorldCover composition of the boundary (free, CC BY 4.0)." : "No boundary: add the candidate from an Atlas polygon to read land cover."}</p>}
            {c.geometry && <form action={landBaselineAction}><input type="hidden" name="id" value={c.id} /><button className={ui.miniBtn} type="submit">{base ? "Re-read" : "Read baseline"}</button></form>}
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Details</p>
            <form action={updateLandAction} className={r.form}><input type="hidden" name="id" value={c.id} />
              <label>Name<input name="name" defaultValue={c.name} /></label><label>Country<input name="country" defaultValue={c.country ?? ""} /></label>
              <label>Latitude<input name="lat" defaultValue={c.lat ?? ""} /></label><label>Longitude<input name="lng" defaultValue={c.lng ?? ""} /></label>
              <label>Hectares<input name="hectares" defaultValue={c.hectares ?? ""} /></label><label>Asking price<input name="askingPrice" defaultValue={c.askingPrice ?? ""} /></label><label>Currency<input name="currency" defaultValue={c.currency} maxLength={3} /></label>
              <label>Tenure<select name="tenure" defaultValue={c.tenure}>{Object.entries(TENURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Seller<input name="seller" defaultValue={c.seller} /></label><label>Title status<input name="titleStatus" defaultValue={c.titleStatus} /></label>
              <label>Ecosystem condition<textarea name="ecosystemCondition" rows={2} defaultValue={c.ecosystemCondition} /></label><label>Suitability<textarea name="suitability" rows={2} defaultValue={c.suitability} /></label>
              <label>Option status<input name="optionStatus" defaultValue={c.optionStatus} /></label><label>Option expiry<input name="optionExpiry" type="date" defaultValue={c.optionExpiry ?? ""} /></label>
              <label>Acquisition probability %<input name="probabilityPct" defaultValue={c.probabilityPct ?? ""} /></label>
              <label>Intended intervention<select name="intervention" defaultValue={c.intervention ?? ""}><option value="">—</option>{Object.entries(INTERVENTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Capital required<input name="capitalRequired" defaultValue={c.capitalRequired ?? ""} /></label>
              <label>Notes<textarea name="notes" rows={3} defaultValue={c.notes} /></label>
              <button className="btn" type="submit">Save</button>
            </form>
            <p className={ui.sub}>{c.askingPrice && c.hectares ? `${compactMoney(c.askingPrice / c.hectares, c.currency)}/ha asking` : ""}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
