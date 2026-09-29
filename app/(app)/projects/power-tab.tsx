// Power stack for one project: PPAs with bankability by dimension, grid interconnection, storage (with LCOS),
// revenue stack, and large loads that could take the power (explained fit, nearest and best-fitting first).
import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { finModels, gridConnections, largeLoads, ppas, revenueStreams, storageSpecs } from "@/db/schema";
import type { projects } from "@/db/schema";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { breakeven } from "@/lib/finance/analysis";
import { lcos, matchDims, orderMatches, ppaBankability, revenueStack, summariseBankability } from "@/lib/power/engine";
import { ALLOCATION, BANKABILITY, CHEMISTRIES, LOAD_TYPES, PPA_CONDITIONS, PPA_STATUS, PPA_TYPES, PROFILES, RISKS, STORAGE_SERVICES, STUDY_STAGES, TRISTATE } from "@/lib/power/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { saveGridAction, savePpaAction, saveStorageAction } from "../power-actions";
import s from "./natural.module.css";

type Project = typeof projects.$inferSelect;
type Scope = Parameters<typeof mandateCondition>[0];
const SECTIONS = [["ppa", "PPAs & bankability"], ["stack", "Revenue stack"], ["grid", "Grid interconnection"], ["storage", "Storage"], ["loads", "Loads that could take the power"]] as const;
const COLORS: Record<string, string> = { strong: "#2f7d4f", acceptable: "#5f8f6a", conditional: "#b58a2a", material_issue: "#b0432f", unknown: "#8a8f86", fit: "#2f7d4f", no_fit: "#b0432f" };
const Opts = ({ o }: { o: Record<string, string> }) => <>{Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>;
const P = ({ id }: { id: string }) => <input type="hidden" name="projectId" value={id} />;

export default async function PowerTab({ project, scope, sec }: { project: Project; scope: Scope; sec?: string }) {
  const section = SECTIONS.some(([k]) => k === sec) ? sec! : "ppa";
  return <>
    <nav className={ui.tabs} aria-label="Power sections" style={{ marginTop: 4 }}>{SECTIONS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${section === k ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=power&sec=${k}`}>{l}</Link>)}</nav>
    {section === "ppa" && <Ppas project={project} />}
    {section === "stack" && <Stack project={project} />}
    {section === "grid" && <Grid project={project} />}
    {section === "storage" && <Storage project={project} />}
    {section === "loads" && <Loads project={project} scope={scope} />}
  </>;
}

async function modelContext(project: Project) {
  const [m] = await appDb().select().from(finModels).where(eq(finModels.projectId, project.id)).orderBy(desc(finModels.updatedAt)).limit(1);
  if (!m) return { ctx: { projectCurrency: project.currency }, model: null as null | { name: string; version: number }, breakevenPrice: null as number | null, why: "No financial model" };
  // A breakeven price is only meaningful from a usable model with a contracted energy price of its own.
  const stream = m.definition.revenue.find(s => s.certainty === "contracted" && s.basis === "energy" && s.status !== "placeholder");
  const factor = m.health !== "ERROR" && stream ? (() => { try { return breakeven(m.definition, "price", { metric: "equityNpv", value: 0 }); } catch { return null; } })() : null;
  return {
    ctx: { projectCurrency: m.definition.currency, debtCurrency: m.definition.debt?.currency ?? m.definition.currency, debtTenorYears: m.definition.debt?.tenorYears ?? null },
    model: { name: m.name, version: m.version }, breakevenPrice: factor && stream ? stream.price * factor : null,
    why: m.health === "ERROR" ? "model has errors" : !stream ? "model has no sourced contracted energy price" : factor ? "" : "no breakeven within range",
  };
}

async function Ppas({ project }: { project: Project }) {
  const rows = await appDb().select().from(ppas).where(and(eq(ppas.projectId, project.id), isNull(ppas.deletedAt))).orderBy(desc(ppas.updatedAt));
  const { ctx, model, breakevenPrice, why } = await modelContext(project);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>PPAs</p>
      <p className={ui.sub}>Bankability is assessed per dimension from the recorded terms: Strong, Acceptable, Conditional, Material issue or Unknown, each with its reason. There is no single score.{model ? ` Compared against ${model.name} v${model.version}${breakevenPrice ? `; model breakeven energy price ${breakevenPrice.toFixed(2)} (equity NPV = 0)` : `; price adequacy unknown (${why})`}.` : " No financial model yet: tenor compares against defaults and price adequacy shows Unknown."}</p>
      {rows.length === 0 ? <p className={r.empty}>No PPAs recorded.</p> : rows.map(p => {
        const d = ppaBankability(p, { ...ctx, breakevenPrice }), sum = summariseBankability(d);
        return <article key={p.id} className={s.card}>
          <header><b>{p.name}</b> <span className={ui.chip}>{PPA_TYPES[p.type]}</span> <span className={ui.chip}>{PPA_STATUS[p.status]}</span><span className={ui.sub}> {p.buyerName}{p.contractedMw ? ` · ${p.contractedMw} MW` : ""}{p.price ? ` · ${p.price} ${p.currency}/${p.priceUnit}` : ""}{p.termYears ? ` · ${p.termYears} yrs` : ""}</span></header>
          <div className={s.legend}>{(Object.keys(BANKABILITY) as (keyof typeof BANKABILITY)[]).map(k => <span key={k}><i style={{ background: COLORS[k], height: 8 }} />{BANKABILITY[k]} {sum[k]}</span>)}</div>
          <table className={ui.table}><tbody>{d.map(x => <tr key={x.dimension}><td>{x.dimension}</td><td><b style={{ color: COLORS[x.result] }}>{BANKABILITY[x.result]}</b></td><td className={ui.sub}>{x.why}</td></tr>)}</tbody></table>
          <details><summary className={ui.sub}>Edit terms</summary><PpaForm project={project} p={p} /></details>
        </article>; })}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>New PPA</p><PpaForm project={project} /></section></aside>
  </div>;
}

function PpaForm({ project, p }: { project: Project; p?: typeof ppas.$inferSelect }) {
  return <form action={savePpaAction} className={s.inline}><P id={project.id} />{p && <input type="hidden" name="ppaId" value={p.id} />}
    <label>Name<input name="name" defaultValue={p?.name ?? ""} required /></label><label>Type<select name="type" defaultValue={p?.type ?? "corporate"}><Opts o={PPA_TYPES} /></select></label><label>Status<select name="status" defaultValue={p?.status ?? "prospect"}><Opts o={PPA_STATUS} /></select></label>
    <label>Buyer<input name="buyerName" defaultValue={p?.buyerName ?? ""} /></label><label>Guarantor<input name="guarantorName" defaultValue={p?.guarantorName ?? ""} /></label><label>Generator entity<input name="generatorEntity" defaultValue={p?.generatorEntity ?? ""} /></label>
    <label>Contracted MW<input name="contractedMw" defaultValue={p?.contractedMw ?? ""} /></label><label>Contracted MWh / yr<input name="contractedMwhYear" defaultValue={p?.contractedMwhYear ?? ""} /></label><label>Start<input name="startDate" type="date" defaultValue={p?.startDate ?? ""} /></label><label>Term (years)<input name="termYears" defaultValue={p?.termYears ?? ""} /></label>
    <label>Price / MWh<input name="price" defaultValue={p?.price ?? ""} /></label><label>Escalation %<input name="escalationPct" defaultValue={p?.escalationPct ?? ""} /></label><label>Indexation<input name="indexation" defaultValue={p?.indexation ?? ""} placeholder="CPI, USD FX…" /></label><label>Currency<input name="currency" defaultValue={p?.currency ?? project.currency ?? "USD"} maxLength={3} /></label>
    <label>Delivery node<input name="deliveryNode" defaultValue={p?.deliveryNode ?? ""} /></label><label>Settlement node<input name="settlementNode" defaultValue={p?.settlementNode ?? ""} /></label><label>Profile<select name="profile" defaultValue={p?.profile ?? "unknown"}><Opts o={PROFILES} /></select></label><label>Volume commitment<input name="volumeCommitment" defaultValue={p?.volumeCommitment ?? ""} /></label>
    <fieldset className={s.wide}><legend className={ui.sub}>Risk allocation (who bears it)</legend><div className={s.inline}>{Object.entries(RISKS).map(([k, v]) => <label key={k}>{v}<select name={`risk_${k}`} defaultValue={p?.riskAllocation[k] ?? "unknown"}><Opts o={ALLOCATION} /></select></label>)}</div></fieldset>
    <label>Buyer rating<input name="rating" defaultValue={p?.credit.rating ?? ""} placeholder="BBB+" /></label><label>Agency<input name="ratingAgency" defaultValue={p?.credit.ratingAgency ?? ""} /></label><label>Letter of credit<input name="lc" defaultValue={p?.credit.lc ?? ""} /></label><label>Guarantee<input name="guarantee" defaultValue={p?.credit.guarantee ?? ""} /></label><label>Deposit<input name="deposit" defaultValue={p?.credit.deposit ?? ""} /></label><label>Termination payment<input name="terminationPayment" defaultValue={p?.credit.terminationPayment ?? ""} /></label>
    <label>Lender assignment<select name="assignment" defaultValue={p?.lenderRights.assignment ?? "unknown"}><Opts o={TRISTATE} /></select></label><label>Step-in<select name="stepIn" defaultValue={p?.lenderRights.stepIn ?? "unknown"}><Opts o={TRISTATE} /></select></label><label>Direct agreement<select name="directAgreement" defaultValue={p?.lenderRights.directAgreement ?? "unknown"}><Opts o={TRISTATE} /></select></label>
    <fieldset className={s.wide}><legend className={ui.sub}>Conditions precedent</legend><div className={s.inline}>{PPA_CONDITIONS.map(c => { const cur = p?.conditions.find(x => x.condition === c)?.status ?? "na"; return <label key={c}>{c}<select name={`cond_${c}`} defaultValue={cur}><option value="na">Not a condition</option><option value="open">Open</option><option value="satisfied">Satisfied</option><option value="waived">Waived</option></select></label>; })}</div></fieldset>
    <label>Signed<input name="signedDate" type="date" defaultValue={p?.signedDate ?? ""} /></label><label className={s.wide}>Notes<input name="notes" defaultValue={p?.notes ?? ""} /></label>
    <button className={ui.miniBtn} type="submit">{p ? "Save" : "Add PPA"}</button></form>;
}

async function Stack({ project }: { project: Project }) {
  const [streams, ps] = await Promise.all([appDb().select().from(revenueStreams).where(eq(revenueStreams.projectId, project.id)), appDb().select().from(ppas).where(and(eq(ppas.projectId, project.id), isNull(ppas.deletedAt)))]);
  const st = revenueStack(streams, ps), cur = st.currencies[0] ?? project.currency ?? "USD";
  const pct = (x: number | null) => (x === null ? "—" : `${x.toFixed(0)}%`);
  return <section className={r.panel}>
    <p className={r.panelTitle}>Revenue stack</p>
    <div className={s.strip}>{[["Annual revenue (known)", compactMoney(st.total, cur)], ["Contracted", pct(st.contractedPct)], ["Merchant / uncontracted", pct(st.merchantPct)], ["Largest counterparty", st.topCounterparty ? `${st.topCounterparty.name} · ${st.topCounterparty.pct.toFixed(0)}%` : "—"], ["Concentration (HHI)", st.hhi ? Math.round(st.hhi).toLocaleString("en-US") : "—"], ["Weighted contracted tenor", st.weightedTenor === null ? "—" : `${st.weightedTenor.toFixed(1)} yrs`]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    {st.currencies.length > 1 && <p className={ui.warn}>Several currencies ({st.currencies.join(", ")}): shares add nominal amounts without conversion.</p>}
    {st.unknownRevenueRows > 0 && <p className={ui.sub}>{st.unknownRevenueRows} stream(s) without price or volume are listed but not in the shares.</p>}
    <table className={ui.table}><thead><tr><th>Stream</th><th>Mechanism</th><th>Counterparty</th><th>Annual revenue</th><th>Contracted</th><th>Tenor</th><th>Source</th></tr></thead><tbody>
      {st.rows.map((x, i) => <tr key={i}><td className={ui.primary}>{x.name}</td><td>{x.mechanism.replace(/_/g, " ")}</td><td>{x.counterparty || "—"}</td><td className={ui.num}>{x.annualRevenue === null ? "unknown" : compactMoney(x.annualRevenue, x.currency)}</td><td>{x.contracted ? "Yes" : "No"}</td><td>{x.tenorYears ?? "—"}</td><td className={ui.sub}>{x.source === "ppa" ? "PPA record" : "Revenue stream (Economics)"}</td></tr>)}
    </tbody></table>
    <p className={ui.sub}>Contracted = signed (PPAs: signed, conditions precedent or effective). HHI above 2,500 means highly concentrated counterparties. Add streams on the <Link href={`/projects/${project.id}?tab=economics`}>Economics</Link> tab or PPAs here.</p>
  </section>;
}

async function Grid({ project }: { project: Project }) {
  const [g] = await appDb().select().from(gridConnections).where(eq(gridConnections.projectId, project.id));
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Grid interconnection</p>
      {!g ? <p className={r.empty}>No interconnection record. Grid access is often the binding constraint: record the queue position even when early.</p> :
        <dl className={s.kv}><dt>Operator · POI · voltage</dt><dd>{g.operator || "—"} · {g.poi || "—"} · {g.voltageKv ? `${g.voltageKv} kV` : "—"}</dd><dt>Queue · applied</dt><dd>{g.queueId || "—"} · {g.applicationDate ?? "—"}</dd>
          <dt>Study stage</dt><dd>{STUDY_STAGES[g.studyStage]}</dd><dt>Requested · approved</dt><dd>{g.requestedMw ?? "—"} MW · {g.approvedMw ?? "—"} MW ({g.direction})</dd>
          <dt>Network upgrades · cost</dt><dd>{g.networkUpgrades || "—"} · {g.upgradeCost ? compactMoney(g.upgradeCost, g.currency) : "—"}{g.costAllocation ? ` (${g.costAllocation})` : ""}</dd><dt>Security deposit</dt><dd>{g.securityDeposit ? compactMoney(g.securityDeposit, g.currency) : "—"}</dd>
          <dt>Curtailment · constraints</dt><dd>{g.curtailmentRisk || "—"} · {g.transmissionConstraints || "—"}</dd><dt>Target energisation</dt><dd>{g.targetEnergization ?? "—"}</dd><dt>Dependencies</dt><dd>{g.dependencies || "—"}</dd><dt>Evidence</dt><dd>{g.evidence || "—"}</dd></dl>}
      <p className={ui.sub}>Atlas shows transmission lines and substations from OpenStreetMap (Power grid layer) for siting; queue data is recorded here from the operator.</p>
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>{g ? "Update" : "Record"} interconnection</p>
      <form action={saveGridAction} className={r.form}><P id={project.id} />
        <label>Operator (ISO / utility)<input name="operator" defaultValue={g?.operator ?? ""} /></label><label>Point of interconnection<input name="poi" defaultValue={g?.poi ?? ""} /></label><label>Voltage (kV)<input name="voltageKv" defaultValue={g?.voltageKv ?? ""} /></label>
        <label>Queue ID<input name="queueId" defaultValue={g?.queueId ?? ""} /></label><label>Application date<input name="applicationDate" type="date" defaultValue={g?.applicationDate ?? ""} /></label>
        <label>Study stage<select name="studyStage" defaultValue={g?.studyStage ?? "none"}><Opts o={STUDY_STAGES} /></select></label><label>Direction<select name="direction" defaultValue={g?.direction ?? "injection"}><option value="injection">Injection</option><option value="withdrawal">Withdrawal (load)</option><option value="both">Both</option></select></label>
        <label>Requested MW<input name="requestedMw" defaultValue={g?.requestedMw ?? ""} /></label><label>Approved MW<input name="approvedMw" defaultValue={g?.approvedMw ?? ""} /></label>
        <label>Network upgrades<input name="networkUpgrades" defaultValue={g?.networkUpgrades ?? ""} /></label><label>Upgrade cost<input name="upgradeCost" defaultValue={g?.upgradeCost ?? ""} /></label><label>Cost allocation<input name="costAllocation" defaultValue={g?.costAllocation ?? ""} /></label>
        <label>Security deposit<input name="securityDeposit" defaultValue={g?.securityDeposit ?? ""} /></label><label>Currency<input name="currency" defaultValue={g?.currency ?? project.currency ?? "USD"} maxLength={3} /></label>
        <label>Curtailment risk<input name="curtailmentRisk" defaultValue={g?.curtailmentRisk ?? ""} /></label><label>Transmission constraints<input name="transmissionConstraints" defaultValue={g?.transmissionConstraints ?? ""} /></label>
        <label>Target energisation<input name="targetEnergization" type="date" defaultValue={g?.targetEnergization ?? ""} /></label><label>Dependencies<input name="dependencies" defaultValue={g?.dependencies ?? ""} /></label><label>Evidence<input name="evidence" defaultValue={g?.evidence ?? ""} placeholder="Study report, operator letter" /></label>
        <button className="btn" type="submit">Save</button></form></section></aside>
  </div>;
}

async function Storage({ project }: { project: Project }) {
  const rows = await appDb().select().from(storageSpecs).where(and(eq(storageSpecs.projectId, project.id), isNull(storageSpecs.deletedAt)));
  const x = rows[0];
  const l = x ? lcos(x) : null;
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Storage</p>
      {!x ? <p className={r.empty}>No storage specification.</p> : <>
        <div className={s.strip}>{[["Power / energy", `${x.powerMw} MW / ${x.energyMwh} MWh`], ["Duration", l?.durationHours ? `${l.durationHours.toFixed(1)} h` : "—"], ["Chemistry", CHEMISTRIES[x.chemistry]], ["Round trip", x.roundTripPct ? `${x.roundTripPct}%` : "—"], ["Cycles / yr", x.cyclesPerYear ?? "—"], ["LCOS (screening)", l?.lcos ? `${x.currency} ${l.lcos.toFixed(0)}/MWh` : `needs ${l?.missing.join(", ")}`]].map(([k, v]) => <div key={String(k)}><span>{k}</span><b>{v}</b></div>)}</div>
        <dl className={s.kv}><dt>Degradation · life · warranty</dt><dd>{x.degradationPctYear ?? "—"}%/yr · {x.usefulLifeYears ?? "—"} yrs · {x.warrantyYears ?? "—"} yrs</dd><dt>Augmentation</dt><dd>{x.augmentation.map(a => `year ${a.year}: +${a.mwh} MWh @ ${a.costPerKwh}/kWh`).join(" · ") || "—"}</dd>
          <dt>Thermal · fire · EMS · PCS</dt><dd>{[x.thermalManagement, x.fireSuppression, x.ems, x.pcs].map(v => v || "—").join(" · ")}</dd><dt>CAPEX</dt><dd>{x.capexPerKwh ?? "—"} /kWh + {x.capexPerKw ?? "—"} /kW ({x.costSource || "source not recorded"})</dd>
          <dt>Revenue stack</dt><dd>{x.services.map(v => `${STORAGE_SERVICES[v.service as keyof typeof STORAGE_SERVICES] ?? v.service} ${v.sharePct}%${v.contracted ? " (contracted)" : ""}`).join(" · ") || "—"}</dd></dl>
        <p className={ui.sub}>LCOS = PV(CAPEX + fixed O&amp;M + charging energy + augmentation) ÷ PV(discharged MWh) at 8%, with degradation and augmentation. Screening grade; the financial model governs.</p></>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>{x ? "Update" : "Add"} storage</p>
      <form action={saveStorageAction} className={r.form}><P id={project.id} />{x && <input type="hidden" name="storageId" value={x.id} />}
        <label>Name<input name="name" defaultValue={x?.name ?? "BESS"} /></label><label>Chemistry<select name="chemistry" defaultValue={x?.chemistry ?? "lfp"}><Opts o={CHEMISTRIES} /></select></label>
        <label>Power (MW)<input name="powerMw" defaultValue={x?.powerMw ?? ""} required /></label><label>Energy (MWh)<input name="energyMwh" defaultValue={x?.energyMwh ?? ""} required /></label>
        <label>Cycles / yr<input name="cyclesPerYear" defaultValue={x?.cyclesPerYear ?? ""} /></label><label>Round-trip efficiency %<input name="roundTripPct" defaultValue={x?.roundTripPct ?? ""} /></label><label>Degradation %/yr<input name="degradationPctYear" defaultValue={x?.degradationPctYear ?? ""} /></label>
        <label>Useful life (yrs)<input name="usefulLifeYears" defaultValue={x?.usefulLifeYears ?? ""} /></label><label>Warranty (yrs)<input name="warrantyYears" defaultValue={x?.warrantyYears ?? ""} /></label>
        <label>Augmentation <span className={ui.sub}>year:MWh@cost/kWh</span><input name="augmentation" defaultValue={x?.augmentation.map(a => `${a.year}:${a.mwh}@${a.costPerKwh}`).join(", ") ?? ""} placeholder="10:60@150" /></label>
        <label>CAPEX /kWh<input name="capexPerKwh" defaultValue={x?.capexPerKwh ?? ""} /></label><label>CAPEX /kW<input name="capexPerKw" defaultValue={x?.capexPerKw ?? ""} /></label><label>Fixed O&amp;M /kW-yr<input name="fixedOmPerKwYear" defaultValue={x?.fixedOmPerKwYear ?? ""} /></label><label>Charging cost /MWh<input name="chargingCostPerMwh" defaultValue={x?.chargingCostPerMwh ?? ""} /></label>
        <label>Currency<input name="currency" defaultValue={x?.currency ?? project.currency ?? "USD"} maxLength={3} /></label><label>Cost source<input name="costSource" defaultValue={x?.costSource ?? ""} placeholder="Supplier quote, benchmark with date" /></label>
        <label>Thermal management<input name="thermalManagement" defaultValue={x?.thermalManagement ?? ""} /></label><label>Fire suppression<input name="fireSuppression" defaultValue={x?.fireSuppression ?? ""} /></label><label>EMS<input name="ems" defaultValue={x?.ems ?? ""} /></label><label>PCS / inverters<input name="pcs" defaultValue={x?.pcs ?? ""} /></label>
        <fieldset><legend className={ui.sub}>Revenue stack (% of revenue; tick if contracted)</legend>{Object.entries(STORAGE_SERVICES).map(([k, v]) => { const cur = x?.services.find(sv => sv.service === k); return <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 60px 20px", gap: 4, alignItems: "center" }}><span className={ui.sub}>{v}</span><input name={`svc_${k}`} defaultValue={cur?.sharePct ?? ""} aria-label={`${v} share`} /><input type="checkbox" name={`svcc_${k}`} defaultChecked={cur?.contracted} aria-label={`${v} contracted`} /></div>; })}</fieldset>
        <button className="btn" type="submit">Save</button></form></section></aside>
  </div>;
}

async function Loads({ project, scope }: { project: Project; scope: Scope }) {
  const [loads, [grid]] = await Promise.all([appDb().select().from(largeLoads).where(and(mandateCondition(scope, largeLoads.mandateId), isNull(largeLoads.deletedAt))), appDb().select().from(gridConnections).where(eq(gridConnections.projectId, project.id))]);
  const gen = { id: project.id, name: project.name, lat: project.lat, lng: project.lng, capacity: project.capacity, capacityUnit: project.capacityUnit, assetClass: project.assetClass, country: project.country, stage: project.stage, codYear: grid?.targetEnergization ? Number(grid.targetEnergization.slice(0, 4)) : null };
  const matches = orderMatches(loads.map(l => ({ l, ...matchDims(gen, l, grid) })));
  return <section className={r.panel}>
    <p className={r.panelTitle}>Loads that could take the power</p>
    <p className={ui.sub}>From the large-load registry (<Link href="/power">Power &amp; large loads</Link>). Each dimension is explained; generation estimates use a screening capacity factor when the project has none and are labelled.</p>
    {matches.length === 0 ? <p className={r.empty}>No large loads recorded yet.</p> : <table className={ui.table}><thead><tr><th>Load</th><th>Type · MW</th><th>Distance</th><th>Fit by dimension</th></tr></thead><tbody>
      {matches.slice(0, 30).map(m => <tr key={m.l.id}><td className={ui.primary}><Link href={`/power?load=${m.l.id}`}>{m.l.name}</Link><span className={ui.sub}>{m.l.region}{m.l.country ? ` · ${m.l.country}` : ""}</span></td><td>{LOAD_TYPES[m.l.type]} · {m.l.mw ?? "?"} MW</td><td className={ui.num}>{m.distanceKm === null ? "—" : `${Math.round(m.distanceKm)} km`}</td>
        <td>{m.dims.map(d => <div key={d.dimension} className={ui.sub}><b style={{ color: COLORS[d.result] }}>{d.result.replace("_", " ")}</b> · {d.dimension}: {d.why}</div>)}</td></tr>)}
    </tbody></table>}
  </section>;
}
