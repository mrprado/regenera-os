import Link from "next/link";
import { and, asc, desc, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { gridConnections, largeLoads, projects, storageSpecs } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { matchDims, orderMatches, powerStrategies } from "@/lib/power/engine";
import { CONFIDENCE, DATA_CENTER_TYPES, LOAD_STAGES, LOAD_TYPES, PROCUREMENT, REDUNDANCY } from "@/lib/power/vocab";
import { saveLoadAction } from "../power-actions";
import s from "../projects/natural.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Power & large loads" };
const COLORS: Record<string, string> = { fit: "#2f7d4f", conditional: "#b58a2a", no_fit: "#b0432f", unknown: "#8a8f86" };
const GEN = new Set(["solar", "wind", "hydro", "geothermal", "storage", "grid", "hydrogen"]);

export default async function PowerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/power");
  const sp = await searchParams;
  const db = appDb();
  const [loads, projs, grids, stores] = await Promise.all([
    db.select().from(largeLoads).where(and(mandateCondition(user.scope, largeLoads.mandateId), isNull(largeLoads.deletedAt))).orderBy(desc(largeLoads.mw)),
    db.select().from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
    db.select().from(gridConnections).where(mandateCondition(user.scope, gridConnections.mandateId)),
    db.select().from(storageSpecs).where(and(mandateCondition(user.scope, storageSpecs.mandateId), isNull(storageSpecs.deletedAt))),
  ]);
  const sel = loads.find(l => l.id === sp.load) ?? null;
  const gens = projs.filter(p => (p.assetClass && GEN.has(p.assetClass)) || p.sector === "energy");
  const matches = sel ? orderMatches(gens.map(p => { const g = grids.find(x => x.projectId === p.id); return { p, g, bess: stores.filter(x => x.projectId === p.id), ...matchDims({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, capacity: p.capacity, capacityUnit: p.capacityUnit, assetClass: p.assetClass, country: p.country, stage: p.stage, codYear: g?.targetEnergization ? Number(g.targetEnergization.slice(0, 4)) : null }, sel, g) }; })) : [];
  const strategies = sel ? powerStrategies(sel) : [];
  const dcMw = loads.filter(l => (DATA_CENTER_TYPES as readonly string[]).includes(l.type)).reduce((a, l) => a + (l.mw ?? 0), 0);
  return (
    <>
      <PageHeader title="Power & large loads" count={loads.length} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>Generation ↔ storage ↔ grid ↔ large load. Record data centers, AI compute, fabs, mining, hydrogen, desalination and industrial loads with their power needs; the OS matches them to generation projects in both directions and explains each dimension. Loads come from sources you record (announcements, filings, conversations) with their confidence; nothing is scraped or invented.</p>
      <div className={s.strip}>{[["Large loads", loads.length], ["Data-center MW recorded", Math.round(dcMw).toLocaleString("en-US")], ["Generation / storage projects", gens.length], ["Projects with grid records", grids.length], ["Storage specs", stores.length]].map(([k, v]) => <div key={String(k)}><span>{k}</span><b>{v}</b></div>)}</div>
      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}>Large-load registry</p>
          {loads.length === 0 ? <p className={r.empty}>No loads recorded yet.</p> : <table className={ui.table}><thead><tr><th>Load</th><th>Type</th><th>Stage</th><th>MW</th><th>Load factor</th><th>Renewable target</th><th>Energisation</th><th>Source · confidence</th></tr></thead><tbody>
            {loads.map(l => <tr key={l.id} style={l.id === sel?.id ? { background: "var(--paper-2, #f2f0e9)" } : undefined}><td className={ui.primary}><Link href={`/power?load=${l.id}`}>{l.name}</Link>{l.isDemo === "yes" ? <span className={ui.chip}> DEMO</span> : null}<span className={ui.sub}>{[l.region, l.country].filter(Boolean).join(" · ")}</span></td><td>{LOAD_TYPES[l.type]}</td><td>{LOAD_STAGES[l.stage]}</td><td className={ui.num}>{l.mw ?? "—"}</td><td className={ui.num}>{l.loadFactorPct === null ? "—" : `${l.loadFactorPct}%`}</td><td className={ui.num}>{l.renewableTargetPct === null ? "—" : `${l.renewableTargetPct}%`}</td><td>{l.energizationDate ?? "—"}</td><td className={ui.sub}>{l.sourceUrl ? <a href={l.sourceUrl} target="_blank" rel="noreferrer">{l.source || "source"}</a> : l.source || "—"} · {CONFIDENCE[l.confidence]}</td></tr>)}
          </tbody></table>}

          {sel && <>
            <p className={r.panelTitle} style={{ marginTop: 16 }}>Generation that could serve {sel.name}</p>
            {matches.length === 0 ? <p className={r.empty}>No generation or storage projects recorded.</p> : <table className={ui.table}><thead><tr><th>Project</th><th>Distance</th><th>Fit by dimension</th></tr></thead><tbody>
              {matches.slice(0, 25).map(m => <tr key={m.p.id}><td className={ui.primary}><Link href={`/projects/${m.p.id}?tab=power`}>{m.p.name}</Link><span className={ui.sub}>{m.p.assetClass ?? m.p.sector ?? ""}{m.p.capacity ? ` · ${m.p.capacity} ${m.p.capacityUnit ?? ""}` : ""}{m.bess.length ? ` · BESS ${m.bess.map(b => `${b.powerMw} MW/${b.energyMwh} MWh`).join(", ")}` : ""}</span></td><td className={ui.num}>{m.distanceKm === null ? "—" : `${Math.round(m.distanceKm)} km`}</td>
                <td>{m.dims.map(d => <div key={d.dimension} className={ui.sub}><b style={{ color: COLORS[d.result] }}>{d.result.replace("_", " ")}</b> · {d.dimension}: {d.why}</div>)}</td></tr>)}
            </tbody></table>}
            <p className={r.panelTitle} style={{ marginTop: 16 }}>Power-supply strategies (screening)</p>
            <p className={ui.sub}>Indicative sizing with the formula shown; not a design. Real configurations need 8760-hour load and resource modelling, grid studies and site data. Grid availability comes from the interconnection record when one exists.</p>
            {strategies.length === 0 ? <p className={r.empty}>Record the load&apos;s MW to size strategies.</p> : <div className={s.cols3}>{strategies.map(x => <div key={x.name} className={s.card}><b>{x.name}</b>{x.lines.map(l => <span key={l}>{l}</span>)}{x.caveats.map(c => <span key={c} className={ui.sub}>⚠ {c}</span>)}</div>)}</div>}
          </>}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>{sel ? "Edit load" : "Record a large load"}</p>
          <form action={saveLoadAction} className={r.form}>{sel && <input type="hidden" name="loadId" value={sel.id} />}
            <label>Name<input name="name" required defaultValue={sel?.name ?? ""} placeholder="DEMO — 300 MW AI campus, Arizona" /></label>
            <label>Type<select name="type" defaultValue={sel?.type ?? "hyperscaler"}>{Object.entries(LOAD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Stage<select name="stage" defaultValue={sel?.stage ?? "prospect"}>{Object.entries(LOAD_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Country<input name="country" defaultValue={sel?.country ?? ""} /></label><label>Region<input name="region" defaultValue={sel?.region ?? ""} /></label>
            <label>Latitude<input name="lat" defaultValue={sel?.lat ?? ""} /></label><label>Longitude<input name="lng" defaultValue={sel?.lng ?? ""} /></label>
            <label>MW<input name="mw" defaultValue={sel?.mw ?? ""} /></label><label>MWh / yr<input name="mwhYear" defaultValue={sel?.mwhYear ?? ""} /></label><label>Load factor %<input name="loadFactorPct" defaultValue={sel?.loadFactorPct ?? ""} /></label>
            <label>Redundancy<select name="redundancy" defaultValue={sel?.redundancy ?? "unknown"}>{Object.entries(REDUNDANCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Uptime %<input name="uptimePct" defaultValue={sel?.uptimePct ?? ""} /></label>
            <label>Renewable target %<input name="renewableTargetPct" defaultValue={sel?.renewableTargetPct ?? ""} /></label><label>Carbon target<input name="carbonTarget" defaultValue={sel?.carbonTarget ?? ""} /></label><label>Energisation date<input name="energizationDate" type="date" defaultValue={sel?.energizationDate ?? ""} /></label>
            <fieldset style={{ border: 0, padding: 0 }}><legend className={ui.sub}>Procurement routes</legend>{Object.entries(PROCUREMENT).map(([k, v]) => <label key={k} style={{ display: "flex", gap: 6, fontWeight: 400 }}><input type="checkbox" name="procurement" value={k} defaultChecked={sel?.procurement.includes(k)} style={{ width: "auto" }} />{v}</label>)}</fieldset>
            <label>Ramp profile<input name="ramp" defaultValue={sel?.ramp ?? ""} placeholder="100 MW 2028, +100 MW/yr" /></label><label>Water / cooling needs<input name="waterNeeds" defaultValue={sel?.waterNeeds ?? ""} /></label>
            <label>Source<input name="source" defaultValue={sel?.source ?? ""} placeholder="Press release, filing, conversation" /></label><label>Source URL<input name="sourceUrl" type="url" defaultValue={sel?.sourceUrl ?? ""} /></label>
            <label>Confidence<select name="confidence" defaultValue={sel?.confidence ?? "unknown"}>{Object.entries(CONFIDENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>As of<input name="asOf" type="date" defaultValue={sel?.asOf ?? ""} /></label>
            <label>Notes<textarea name="notes" rows={2} defaultValue={sel?.notes ?? ""} /></label>
            <button className="btn btn--primary" type="submit">Save</button>
          </form>
          {sel && <p className={ui.sub}><Link href="/power">New load</Link></p>}</section></aside>
      </div>
    </>
  );
}
