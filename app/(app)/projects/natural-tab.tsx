// Natural asset operating layer for one project: structure and horizons, biological production, ecological design,
// certification & MRV, environmental inventory, environmental offtake, and risk transfer.
import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import {
  assetHorizons, certDocuments, certifications, creditLots, ecologicalDesigns, envOfftakes, finModels, monitoringPeriods, nurseries, plantingBatches, riskTransfers, species,
} from "@/db/schema";
import type { projects } from "@/db/schema";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { dataRoom, inventorySummary, offtakeCoverage, offtakeRevenue, permanenceBuffer, projectStructure, structureLayout } from "@/lib/natural/engine";
import {
  CERT_DOC_TYPES, CERT_STAGES, FUNCTIONAL_GROUPS, HORIZON_DEFAULTS, HORIZONS, INTERVENTIONS, LINK_KINDS, LOT_FLOW, LOT_STATUS, NODE_KINDS, OFFTAKE_KINDS, OFFTAKE_STATUS,
  PERIOD_STATUS, PERMANENCE_FACTORS, PLANTING_STATUS, RISK_TRANSFER, RISK_TRANSFER_STATUS, STANDARDS, UNIT_TYPES,
} from "@/lib/natural/vocab";
import { compactMoney } from "@/lib/projects/labels";
import {
  addCertDocAction, addLinkAction, addLotAction, addNodeAction, addPeriodAction, addPlantingAction, addRiskTransferAction, createCertificationAction, createDesignAction,
  deleteStructureAction, designSpeciesAction, moveLotAction, offtakeToModelAction, permanenceAction, reviewDesignAction, saveHorizonsAction, saveOfftakeAction, survivalCheckAction,
  updateCertificationAction, updatePeriodAction,
} from "../natural-actions";
import s from "./natural.module.css";

type Project = typeof projects.$inferSelect;
type Scope = Parameters<typeof mandateCondition>[0];
const SECTIONS = [["structure", "Structure & horizons"], ["production", "Production"], ["design", "Ecological design"], ["certification", "Certification & MRV"], ["inventory", "Inventory"], ["offtake", "Environmental offtake"], ["risk", "Risk transfer"]] as const;
const n0 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : Math.round(x).toLocaleString("en-US"));
const LINK_COLORS: Record<string, string> = { ownership: "#2f4a3a", contract: "#6b9fb8", cash_flow: "#c9a227", service: "#8a8f86", liability: "#b0432f", land_right: "#6fa36f" };

export default async function NaturalTab({ project, scope, sec }: { project: Project; scope: Scope; sec?: string }) {
  const section = SECTIONS.some(([k]) => k === sec) ? sec! : "structure";
  return <>
    <nav className={ui.tabs} aria-label="Natural asset sections" style={{ marginTop: 4 }}>
      {SECTIONS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${section === k ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=natural&sec=${k}`}>{l}</Link>)}
    </nav>
    {section === "structure" && <Structure project={project} />}
    {section === "production" && <Production project={project} scope={scope} />}
    {section === "design" && <Design project={project} scope={scope} />}
    {section === "certification" && <Certification project={project} />}
    {section === "inventory" && <Inventory project={project} />}
    {section === "offtake" && <Offtake project={project} />}
    {section === "risk" && <Risk project={project} />}
  </>;
}

async function Structure({ project }: { project: Project }) {
  const { nodes, links } = await projectStructure(appDb(), project.id);
  const [h] = await appDb().select().from(assetHorizons).where(eq(assetHorizons.projectId, project.id));
  const W = 900, { pos, height } = structureLayout(nodes, W);
  const name = new Map(nodes.map(n => [n.id, n.name]));
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Asset → operating company → land / project SPVs → HoldCo → investors</p>
      {nodes.length === 0 ? <p className={r.empty}>No entities yet. Add the natural asset, operating company, nursery, land and project SPVs, HoldCo and investors, then link them by ownership, contract, cash flow, service, liability or land right.</p> : (
        <svg viewBox={`0 0 ${W} ${height}`} className={s.graph} role="img" aria-label="Structure graph">
          <defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#8a8f86" /></marker></defs>
          {links.map(l => { const a = pos.get(l.fromId), b = pos.get(l.toId); if (!a || !b) return null; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; return <g key={l.id}>
            <line x1={a.x} y1={a.y + 18} x2={b.x} y2={b.y - 18} stroke={LINK_COLORS[l.kind]} strokeWidth={l.kind === "ownership" ? 2.2 : 1.4} strokeDasharray={l.kind === "contract" || l.kind === "service" ? "5 4" : undefined} markerEnd="url(#arr)" />
            <text x={mx + 4} y={my} className={s.edgeLabel}>{LINK_KINDS[l.kind]}{l.pct !== null ? ` ${l.pct}%` : ""}{l.amount ? ` · ${compactMoney(l.amount, l.currency ?? "USD")}` : ""}</text>
          </g>; })}
          {nodes.map(n => { const p = pos.get(n.id)!; return <g key={n.id}><rect x={p.x - 82} y={p.y - 18} width={164} height={36} rx={6} className={s.node} data-kind={n.kind} /><text x={p.x} y={p.y - 2} textAnchor="middle" className={s.nodeName}>{n.name.slice(0, 26)}</text><text x={p.x} y={p.y + 12} textAnchor="middle" className={s.nodeKind}>{NODE_KINDS[n.kind]}{n.jurisdiction ? ` · ${n.jurisdiction}` : ""}</text></g>; })}
        </svg>)}
      <div className={s.legend}>{Object.entries(LINK_KINDS).map(([k, v]) => <span key={k}><i style={{ background: LINK_COLORS[k] }} />{v}</span>)}</div>
      {links.length > 0 && <table className={ui.table}><thead><tr><th>From</th><th>Link</th><th>To</th><th>Detail</th><th /></tr></thead><tbody>
        {links.map(l => <tr key={l.id}><td>{name.get(l.fromId)}</td><td>{LINK_KINDS[l.kind]}{l.pct !== null ? ` ${l.pct}%` : ""}</td><td>{name.get(l.toId)}</td><td className={ui.sub}>{l.description}{l.amount ? ` · ${compactMoney(l.amount, l.currency ?? "USD")}` : ""}</td><td><Del projectId={project.id} linkId={l.id} /></td></tr>)}
      </tbody></table>}
      {nodes.length > 0 && <table className={ui.table}><thead><tr><th>Entity</th><th>Role</th><th>Responsibilities</th><th>Liabilities</th><th /></tr></thead><tbody>
        {nodes.map(n => <tr key={n.id}><td className={ui.primary}>{n.name}</td><td>{NODE_KINDS[n.kind]}{n.jurisdiction ? ` · ${n.jurisdiction}` : ""}</td><td className={ui.sub}>{n.responsibilities || "—"}</td><td className={ui.sub}>{n.liabilities || "—"}</td><td><Del projectId={project.id} nodeId={n.id} /></td></tr>)}
      </tbody></table>}
    </section>
    <aside>
      <section className={r.panel}><p className={r.panelTitle}>Add entity</p>
        <form action={addNodeAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
          <label>Name<input name="name" required /></label>
          <label>Role<select name="kind">{Object.entries(NODE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Jurisdiction<input name="jurisdiction" /></label><label>Responsibilities<input name="responsibilities" /></label><label>Liabilities<input name="liabilities" /></label>
          <button className="btn" type="submit">Add</button></form></section>
      {nodes.length > 1 && <section className={r.panel}><p className={r.panelTitle}>Link entities</p>
        <form action={addLinkAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
          <label>From<select name="fromId">{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
          <label>Link<select name="kind">{Object.entries(LINK_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>To<select name="toId">{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
          <label>Ownership %<input name="pct" inputMode="decimal" /></label><label>Amount<input name="amount" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} maxLength={3} /></label>
          <label>Description<input name="description" placeholder="e.g. Forest management agreement; timber proceeds" /></label>
          <button className="btn" type="submit">Link</button></form></section>}
      <section className={r.panel}><p className={r.panelTitle}>Horizons (years)</p>
        <p className={ui.sub}>Natural assets outlive investment cycles: plan each horizon explicitly.</p>
        <form action={saveHorizonsAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
          {(Object.keys(HORIZONS) as (keyof typeof HORIZONS)[]).map(k => <label key={k}>{HORIZONS[k]} <span className={ui.sub}>(typical {HORIZON_DEFAULTS[k][0]}–{HORIZON_DEFAULTS[k][1]}{k === "operating" || k === "stewardship" ? "+" : ""})</span><input name={k} inputMode="numeric" defaultValue={h?.[k] ?? ""} /></label>)}
          <label>Steward (who holds long-term responsibility)<input name="steward" defaultValue={h?.steward ?? ""} /></label>
          <label>Stewardship plan<textarea name="stewardshipPlan" rows={3} defaultValue={h?.stewardshipPlan ?? ""} placeholder="Succession, endowment, easement, community governance" /></label>
          <button className="btn" type="submit">Save</button></form></section>
    </aside>
  </div>;
}

function Del({ projectId, nodeId, linkId }: { projectId: string; nodeId?: string; linkId?: string }) {
  return <form action={deleteStructureAction}><input type="hidden" name="projectId" value={projectId} />{nodeId && <input type="hidden" name="nodeId" value={nodeId} />}{linkId && <input type="hidden" name="linkId" value={linkId} />}<button className={ui.miniBtn} type="submit" aria-label="Remove">×</button></form>;
}

async function Production({ project, scope }: { project: Project; scope: Scope }) {
  const db = appDb();
  const [batches, sp, ns] = await Promise.all([
    db.select().from(plantingBatches).where(eq(plantingBatches.projectId, project.id)).orderBy(desc(plantingBatches.createdAt)),
    db.select().from(species).where(mandateCondition(scope, species.mandateId)).orderBy(asc(species.scientificName)),
    db.select().from(nurseries).where(mandateCondition(scope, nurseries.mandateId)).orderBy(asc(nurseries.name)),
  ]);
  const spName = new Map(sp.map(x => [x.id, x.scientificName]));
  const total = batches.reduce((a, b) => a + b.quantity, 0), area = batches.reduce((a, b) => a + (b.areaHa ?? 0), 0);
  const last = (b: (typeof batches)[number]) => b.survival.at(-1)?.survivalPct ?? null;
  const planted = batches.filter(b => last(b) !== null);
  const survivalW = planted.length ? planted.reduce((a, b) => a + b.quantity * (last(b) ?? 0), 0) / planted.reduce((a, b) => a + b.quantity, 0) : null;
  const cost = batches.reduce((a, b) => a + (b.unitCost ?? 0) * b.quantity + (b.establishmentCostPerHa ?? 0) * (b.areaHa ?? 0), 0);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Planting inventory</p>
      <div className={s.strip}><div><span>Plants</span><b>{n0(total)}</b></div><div><span>Area</span><b>{n0(area)} ha</b></div><div><span>Survival (weighted, latest)</span><b>{survivalW === null ? "—" : `${Math.round(survivalW)}%`}</b></div><div><span>Replacements</span><b>{n0(batches.reduce((a, b) => a + b.replacementQty, 0))}</b></div><div><span>Establishment cost</span><b>{compactMoney(cost, project.currency ?? "USD")}</b></div></div>
      {batches.length === 0 ? <p className={r.empty}>No planting batches yet.</p> : <table className={ui.table}><thead><tr><th>Species</th><th>Provenance · nursery</th><th>Qty</th><th>Area</th><th>Season / date</th><th>Status</th><th>Survival</th><th>Survival check</th></tr></thead><tbody>
        {batches.map(b => <tr key={b.id}><td className={ui.primary}><i>{spName.get(b.speciesId) ?? "—"}</i></td><td className={ui.sub}>{b.provenance || "—"}{b.nurseryId ? ` · ${ns.find(x => x.id === b.nurseryId)?.name ?? ""}` : ""}</td><td className={ui.num}>{n0(b.quantity)}</td><td className={ui.num}>{b.areaHa ?? "—"}</td><td>{b.season || b.plantedDate || "—"}</td><td><span className={ui.chip}>{PLANTING_STATUS[b.status]}</span></td>
          <td className={ui.sub}>{b.survival.map(c => `${c.date}: ${c.survivalPct}%`).join(" · ") || "—"}</td>
          <td><form action={survivalCheckAction} className={s.mini}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="batchId" value={b.id} /><input name="date" type="date" aria-label="Date" /><input name="survivalPct" placeholder="%" aria-label="Survival %" /><input name="replacementQty" placeholder="replace" aria-label="Replacements" /><button className={ui.miniBtn} type="submit">Add</button></form></td></tr>)}
      </tbody></table>}
      <p className={ui.sub}>Species catalogue and nurseries are shared across projects: <Link href="/natural?tab=species">Species</Link> · <Link href="/natural?tab=production">Nurseries</Link>.</p>
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Record a planting batch</p>
      {sp.length === 0 ? <p className={r.empty}>Add species to the catalogue first (<Link href="/natural?tab=species">Species</Link>).</p> : <form action={addPlantingAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
        <label>Species<select name="speciesId">{sp.map(x => <option key={x.id} value={x.id}>{x.scientificName}{x.commonName ? ` (${x.commonName})` : ""}</option>)}</select></label>
        <label>Nursery<select name="nurseryId" defaultValue=""><option value="">—</option>{ns.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Provenance / seed source<input name="provenance" /></label>
        <label>Quantity<input name="quantity" required inputMode="numeric" /></label><label>Area (ha)<input name="areaHa" inputMode="decimal" /></label>
        <label>Season / window<input name="season" placeholder="Rainy season 2027" /></label><label>Planted date<input name="plantedDate" type="date" /></label>
        <label>Status<select name="status" defaultValue="planned">{Object.entries(PLANTING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Unit cost (per plant)<input name="unitCost" inputMode="decimal" /></label><label>Establishment cost / ha<input name="establishmentCostPerHa" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} maxLength={3} /></label>
        <label>Crew<input name="crew" /></label><label>Maintenance cycle<input name="maintenanceCycle" placeholder="Weeding 3×/yr for 3 years" /></label>
        <button className="btn" type="submit">Record</button></form>}
    </section></aside>
  </div>;
}

async function Design({ project, scope }: { project: Project; scope: Scope }) {
  const db = appDb();
  const [designs, sp] = await Promise.all([
    db.select().from(ecologicalDesigns).where(eq(ecologicalDesigns.projectId, project.id)).orderBy(desc(ecologicalDesigns.updatedAt)),
    db.select().from(species).where(mandateCondition(scope, species.mandateId)).orderBy(asc(species.scientificName)),
  ]);
  const spById = new Map(sp.map(x => [x.id, x]));
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Species-to-site / intervention fit</p>
      <p className={ui.sub}>What ecological intervention fits this exact site, which species or community, why, and under what climate scenario. Inputs: soils, water and terrain (Atlas Workbench), land cover (ESA WorldCover baseline in Capital alignment), plants recorded near the site (GBIF), local ecological knowledge and implementation cost. The OS assembles evidence; an ecologist decides.</p>
      {designs.length === 0 ? <p className={r.empty}>No designs yet.</p> : designs.map(d => {
        const plants = (d.siteFactors.gbifPlants as { key: string; name: string; family: string; records: number }[] | undefined) ?? [];
        const shareSum = d.mix.reduce((a, m) => a + m.sharePct, 0);
        return <article key={d.id} className={s.card}>
          <header><b>{d.name}</b> <span className={ui.chip}>{INTERVENTIONS[d.intervention]}</span> <span className={ui.chip}>{d.status}</span>{d.reviewedBy ? <span className={ui.sub}> reviewed by {d.reviewedBy}</span> : null}</header>
          <p className={ui.sub}>{d.climateScenario ? `Climate scenario: ${d.climateScenario}. ` : ""}{d.costPerHa ? `Implementation ≈ ${compactMoney(d.costPerHa, project.currency ?? "USD")}/ha. ` : ""}{d.rationale}</p>
          {d.localKnowledge && <p className={ui.sub}>Local knowledge: {d.localKnowledge}</p>}
          <table className={ui.table}><thead><tr><th>Species</th><th>Group</th><th>Share</th><th>Rationale</th></tr></thead><tbody>
            {d.mix.map(m => { const x = spById.get(m.speciesId); return <tr key={m.speciesId}><td><i>{x?.scientificName ?? "—"}</i></td><td>{x ? FUNCTIONAL_GROUPS[x.functionalGroup] : ""}</td><td className={ui.num}>{m.sharePct}%</td><td className={ui.sub}>{m.rationale}</td></tr>; })}
            {d.mix.length > 0 && <tr><td colSpan={2} className={ui.sub}>Total</td><td className={ui.num}>{shareSum}%</td><td /></tr>}
          </tbody></table>
          {sp.length > 0 && <form action={designSpeciesAction} className={s.inline}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="designId" value={d.id} />
            <label>Species<select name="speciesId">{sp.map(x => <option key={x.id} value={x.id}>{x.scientificName}</option>)}</select></label><label>Share %<input name="sharePct" inputMode="decimal" /></label>
            <label className={s.wide}>Rationale<input name="rationale" required placeholder="Site fit, function, climate resilience, evidence" /></label><button className={ui.miniBtn} type="submit">Add to mix</button></form>}
          <form action={reviewDesignAction} className={s.inline}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="designId" value={d.id} />
            <label className={s.wide}>Evidence<input name="evidence" defaultValue={d.evidence} placeholder="Ecologist review, trial plots, literature" /></label>
            <label>Status<select name="status" defaultValue={d.status}><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="adopted">Adopted</option></select></label><button className={ui.miniBtn} type="submit">Save</button></form>
          {plants.length > 0 && <details><summary className={ui.sub}>Plants most recorded within ~11 km (GBIF, {plants.length})</summary>
            <p className={ui.sub}>{String(d.siteFactors.gbifNote ?? "")} <a href={String(d.siteFactors.gbifUrl ?? "https://www.gbif.org")} target="_blank" rel="noreferrer">GBIF</a></p>
            <div className={s.plants}>{plants.map(p => <span key={p.key}><i>{p.name}</i> <small>{p.family} · {p.records}</small></span>)}</div></details>}
        </article>; })}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>New design</p>
      <form action={createDesignAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
        <label>Name<input name="name" placeholder="Productive permanent forest, mixed native" /></label>
        <label>Intervention<select name="intervention">{Object.entries(INTERVENTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Climate scenario<input name="climateScenario" placeholder="e.g. SSP2-4.5, 2050" /></label>
        <label>Rationale<textarea name="rationale" rows={3} /></label><label>Local ecological knowledge<textarea name="localKnowledge" rows={2} /></label>
        <label>Implementation cost / ha<input name="costPerHa" inputMode="decimal" /></label>
        <button className="btn" type="submit">Create{project.lat !== null ? " (reads GBIF plants near the site)" : ""}</button></form></section></aside>
  </div>;
}

async function Certification({ project }: { project: Project }) {
  const db = appDb();
  const certs = await db.select().from(certifications).where(eq(certifications.projectId, project.id)).orderBy(asc(certifications.createdAt));
  const ids = certs.map(c => c.id);
  const [docs, periods] = ids.length ? await Promise.all([db.select().from(certDocuments).where(inArray(certDocuments.certificationId, ids)).orderBy(desc(certDocuments.docDate)), db.select().from(monitoringPeriods).where(inArray(monitoringPeriods.certificationId, ids)).orderBy(asc(monitoringPeriods.start))]) : [[], []];
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Certification & MRV</p>
      <p className={ui.sub}>The OS keeps the record (methodology, registry, bodies, periods, documents, buffer); it never states that a project is certified, validated or verified unless a document from the body or registry is recorded.</p>
      {certs.length === 0 ? <p className={r.empty}>No certification records.</p> : certs.map(c => {
        const cd = docs.filter(d => d.certificationId === c.id), room = dataRoom(c.stage, cd), ps = periods.filter(p => p.certificationId === c.id), pb = permanenceBuffer(c.permanence);
        return <article key={c.id} className={s.card}>
          <header><b>{c.name}</b> <span className={ui.chip}>{STANDARDS[c.standard]}</span> <span className={ui.chip}>{CERT_STAGES[c.stage]}</span>{c.registryId ? <span className={ui.sub}> registry ID {c.registryUrl ? <a href={c.registryUrl} target="_blank" rel="noreferrer">{c.registryId}</a> : c.registryId}</span> : null}</header>
          <dl className={s.kv}><dt>Methodology</dt><dd>{c.methodology || "—"}</dd><dt>Units</dt><dd>{UNIT_TYPES[c.unitType]}</dd><dt>Crediting period</dt><dd>{c.creditingStart ?? "—"} → {c.creditingEnd ?? "—"}{c.lifetimeYears ? ` · project life ${c.lifetimeYears} years` : ""}</dd>
            <dt>Validation / verification body</dt><dd>{c.validationBody || "—"} / {c.verificationBody || "—"}</dd><dt>Next verification</dt><dd>{c.nextVerification ?? "—"}</dd><dt>Buffer</dt><dd>{c.bufferPct === null ? "—" : `${c.bufferPct}%`}{c.permanence.length ? ` (tool rating ${pb.rating}${pb.eligible ? "" : ", above 60"})` : ""}{c.permanenceSource ? ` · ${c.permanenceSource}` : ""}</dd><dt>Baseline</dt><dd>{c.baseline || "—"}</dd></dl>
          <form action={updateCertificationAction} className={s.inline}><input type="hidden" name="certificationId" value={c.id} />
            <label>Stage<select name="stage" defaultValue={c.stage}>{Object.entries(CERT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Registry ID<input name="registryId" defaultValue={c.registryId ?? ""} /></label>
            <label>Methodology<input name="methodology" defaultValue={c.methodology} /></label><label>Validation body<input name="validationBody" defaultValue={c.validationBody} /></label><label>Verification body<input name="verificationBody" defaultValue={c.verificationBody} /></label>
            <label>Next verification<input name="nextVerification" type="date" defaultValue={c.nextVerification ?? ""} /></label><label className={s.wide}>Baseline<input name="baseline" defaultValue={c.baseline} /></label><button className={ui.miniBtn} type="submit">Save</button></form>

          <p className={r.panelTitle} style={{ marginTop: 12 }}><span>Data room</span><span className={ui.sub}>{room.expected.length - room.missing.length}/{room.expected.length} expected documents for this stage</span></p>
          {room.missing.length > 0 && <p className={ui.warn}>Missing: {room.missing.map(t => CERT_DOC_TYPES[t as keyof typeof CERT_DOC_TYPES]).join(", ")}</p>}
          {cd.length > 0 && <table className={ui.table}><thead><tr><th>Document</th><th>Type</th><th>Version</th><th>Date</th><th>Status</th></tr></thead><tbody>{cd.map(d => <tr key={d.id}><td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title}</td><td className={ui.sub}>{CERT_DOC_TYPES[d.docType]}</td><td>{d.version}</td><td>{d.docDate ?? "—"}</td><td>{d.status.replace("_", " ")}</td></tr>)}</tbody></table>}
          <form action={addCertDocAction} className={s.inline}><input type="hidden" name="certificationId" value={c.id} />
            <label>Type<select name="docType">{Object.entries(CERT_DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Title<input name="title" required /></label><label>Version<input name="version" defaultValue="1" /></label><label>Date<input name="docDate" type="date" /></label>
            <label>Status<select name="status" defaultValue="final"><option value="draft">Draft</option><option value="final">Final</option><option value="registry_published">Registry published</option><option value="superseded">Superseded</option></select></label><label className={s.wide}>Link (registry, Drive or Documents)<input name="url" type="url" /></label><button className={ui.miniBtn} type="submit">Add document</button></form>

          <p className={r.panelTitle} style={{ marginTop: 12 }}>Monitoring periods</p>
          {ps.length > 0 && <table className={ui.table}><thead><tr><th>Period</th><th>Status</th><th>Estimated</th><th>Verified</th><th>Buffer</th><th>Issued</th><th>Verifier</th><th>Update</th></tr></thead><tbody>
            {ps.map(p => <tr key={p.id}><td>{p.start} → {p.end}</td><td><span className={ui.chip}>{PERIOD_STATUS[p.status]}</span></td><td className={ui.num}>{n0(p.estimatedUnits)}</td><td className={ui.num}>{n0(p.verifiedUnits)}</td><td className={ui.num}>{n0(p.bufferUnits)}</td><td className={ui.num}>{n0(p.issuedUnits)}</td><td className={ui.sub}>{p.verifier || "—"}</td>
              <td>{p.status !== "issued" && <form action={updatePeriodAction} className={s.mini}><input type="hidden" name="certificationId" value={c.id} /><input type="hidden" name="periodId" value={p.id} />
                {p.status === "verified" ? <><input type="hidden" name="status" value="issued" /><input name="issued" placeholder="issued" aria-label="Issued units" /><input name="buffer" placeholder="buffer" aria-label="Buffer units" defaultValue={c.bufferPct && p.verifiedUnits ? Math.round(p.verifiedUnits * c.bufferPct / 100) : ""} /><input name="vintage" placeholder="vintage" aria-label="Vintage" defaultValue={p.end.slice(0, 4)} /><input name="serialStart" placeholder="serial from" aria-label="Serial start" /><input name="date" type="date" aria-label="Issuance date" /><button className={ui.miniBtn} type="submit">Record issuance</button></>
                  : <><select name="status" defaultValue={p.status} aria-label="Status">{Object.entries(PERIOD_STATUS).filter(([k]) => k !== "issued").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="verifiedUnits" placeholder="verified units" aria-label="Verified units" /><input name="verifier" placeholder="verifier" aria-label="Verifier" /><input name="date" type="date" aria-label="Date" /><button className={ui.miniBtn} type="submit">Save</button></>}
              </form>}</td></tr>)}
          </tbody></table>}
          <form action={addPeriodAction} className={s.inline}><input type="hidden" name="certificationId" value={c.id} /><label>Start<input name="start" type="date" required /></label><label>End<input name="end" type="date" required /></label><label>Estimated units<input name="estimatedUnits" inputMode="decimal" /></label><button className={ui.miniBtn} type="submit">Add period</button></form>

          <details style={{ marginTop: 10 }}><summary className={r.panelTitle}>Permanence / reversal risk</summary>
            <p className={ui.sub}>Scores follow the structure of the VCS AFOLU Non-Permanence Risk Tool (internal, external, natural). The indicative buffer is the total rating with a 10% floor; the rating in the validated risk report governs; enter it as the buffer to override.</p>
            <form action={permanenceAction} className={s.perm}><input type="hidden" name="certificationId" value={c.id} />
              {Object.entries(PERMANENCE_FACTORS).map(([g, fs]) => <fieldset key={g}><legend>{g[0].toUpperCase() + g.slice(1)} risk</legend>{Object.entries(fs).map(([k, v]) => { const cur = c.permanence.find(x => x.factor === k); return <div key={k} className={s.permRow}><span>{v}</span><input name={`score_${k}`} defaultValue={cur?.score ?? ""} placeholder="score" aria-label={`${v} score`} /><input name={`mit_${k}`} defaultValue={cur?.mitigation ?? ""} placeholder="mitigation" aria-label={`${v} mitigation`} /><input name={`ev_${k}`} defaultValue={cur?.evidence ?? ""} placeholder="evidence" aria-label={`${v} evidence`} /></div>; })}</fieldset>)}
              <div className={s.inline}><label>Buffer % from validated report<input name="bufferPct" inputMode="decimal" defaultValue={c.permanenceSource && c.bufferPct !== null ? c.bufferPct : ""} /></label><label className={s.wide}>Source<input name="permanenceSource" defaultValue={c.permanenceSource} placeholder="e.g. Non-permanence risk report v2, validated 2026-03" /></label><button className={ui.miniBtn} type="submit">Save risk</button></div>
            </form></details>
        </article>; })}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>New certification record</p>
      <form action={createCertificationAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
        <label>Name<input name="name" placeholder={project.name} /></label>
        <label>Standard<select name="standard">{Object.entries(STANDARDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Methodology<input name="methodology" placeholder="e.g. VM0047" /></label>
        <label>Units<select name="unitType">{Object.entries(UNIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Stage<select name="stage" defaultValue="feasibility">{Object.entries(CERT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Registry ID<input name="registryId" /></label><label>Registry URL<input name="registryUrl" type="url" /></label>
        <label>Crediting start<input name="creditingStart" type="date" /></label><label>Crediting end<input name="creditingEnd" type="date" /></label><label>Project life (years)<input name="lifetimeYears" inputMode="numeric" placeholder="100" /></label>
        <label>Validation body<input name="validationBody" /></label><label>Verification body<input name="verificationBody" /></label>
        <button className="btn" type="submit">Create</button></form></section></aside>
  </div>;
}

async function Inventory({ project }: { project: Project }) {
  const db = appDb();
  const certs = await db.select().from(certifications).where(eq(certifications.projectId, project.id));
  const lots = certs.length ? await db.select().from(creditLots).where(inArray(creditLots.certificationId, certs.map(c => c.id))).orderBy(asc(creditLots.vintage), asc(creditLots.createdAt)) : [];
  const offs = await db.select().from(envOfftakes).where(eq(envOfftakes.projectId, project.id));
  const sum = inventorySummary(lots), cov = offtakeCoverage(offs, lots);
  const live = lots.filter(l => l.status !== "cancelled");
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Environmental inventory ledger</p>
      <p className={ui.sub}>Forecast → Validated → Verified → Issued → Available → Contracted → Delivered → Retired. Units only move forward; a partial move splits the lot; every move is audited. Buffer units are held for reversals.</p>
      <div className={s.flow}>{LOT_FLOW.map(k => <div key={k}><span>{LOT_STATUS[k]}</span><b>{n0(sum.by[k] ?? 0)}</b></div>)}<div><span>Buffer pool</span><b>{n0(sum.buffer)}</b></div></div>
      <p className={ui.sub}>Expected future issuance {n0(sum.expected)} · on hand {n0(sum.onHand)} · contracted {n0(sum.committed)} · delivered or retired {n0(sum.delivered)}{sum.avgPrice !== null ? ` · average sold price ${sum.avgPrice.toFixed(2)}` : ""}</p>
      {live.length === 0 ? <p className={r.empty}>No inventory. Monitoring-period estimates create forecast lots; issuances create issued and buffer lots.</p> : <table className={ui.table}><thead><tr><th>Vintage</th><th>Certification</th><th>Quantity</th><th>Status</th><th>Serials</th><th>Price</th><th>Offtake / beneficiary</th><th>Move</th></tr></thead><tbody>
        {live.map(l => { const nexts = l.status === "retired" || l.status === "buffer" ? [] : LOT_FLOW.slice(LOT_FLOW.indexOf(l.status as (typeof LOT_FLOW)[number]) + 1); return <tr key={l.id}>
          <td>{l.vintage}</td><td className={ui.sub}>{certs.find(c => c.id === l.certificationId)?.name}</td><td className={ui.num}>{n0(l.quantity)}</td><td><span className={ui.chip}>{LOT_STATUS[l.status]}</span></td>
          <td className={ui.sub}>{l.serialStart ? `${l.serialStart}${l.serialEnd ? ` – ${l.serialEnd}` : ""}` : "—"}</td><td className={ui.num}>{l.price ?? "—"}</td><td className={ui.sub}>{offs.find(o => o.id === l.offtakeId)?.name ?? ""}{l.retirementBeneficiary ? ` · ${l.retirementBeneficiary}` : ""}</td>
          <td>{nexts.length > 0 && <form action={moveLotAction} className={s.mini}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="lotId" value={l.id} />
            <select name="to" aria-label="Move to">{nexts.map(k => <option key={k} value={k}>{LOT_STATUS[k]}</option>)}{l.status === "issued" && <option value="buffer">Buffer pool</option>}</select>
            <input name="quantity" placeholder={`qty ≤ ${n0(l.quantity)}`} aria-label="Quantity" /><input name="price" placeholder="price" aria-label="Price" />
            {offs.length > 0 && <select name="offtakeId" defaultValue={l.offtakeId ?? ""} aria-label="Offtake"><option value="">offtake…</option>{offs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
            <input name="beneficiary" placeholder="retire for" aria-label="Retirement beneficiary" /><button className={ui.miniBtn} type="submit">Move</button></form>}</td></tr>; })}
      </tbody></table>}
      {cov.length > 0 && <><p className={r.panelTitle} style={{ marginTop: 12 }}>Offtake coverage by year</p>
        <table className={ui.table}><thead><tr><th>Year</th><th>Contracted</th><th>Expected + on hand</th><th>Gap</th></tr></thead><tbody>{cov.map(c => <tr key={c.year}><td>{c.year}</td><td className={ui.num}>{n0(c.contracted)}</td><td className={ui.num}>{n0(c.expected)}</td><td className={ui.num} style={{ color: c.gap < 0 ? "#b0432f" : undefined }}>{n0(c.gap)}</td></tr>)}</tbody></table>
        <p className={ui.sub}>A negative gap means contracted delivery exceeds expected units: check replacement obligations and the buffer.</p></>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add forecast lot</p>
      {certs.length === 0 ? <p className={r.empty}>Create a certification record first.</p> : <form action={addLotAction} className={r.form}>
        <label>Certification<select name="certificationId">{certs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Vintage<input name="vintage" required placeholder="2027" /></label><label>Quantity<input name="quantity" required inputMode="decimal" /></label><label>Basis<input name="note" placeholder="e.g. Model v3 growth curve" /></label>
        <button className="btn" type="submit">Add</button></form>}
    </section></aside>
  </div>;
}

async function Offtake({ project }: { project: Project }) {
  const db = appDb();
  const [offs, certs, models] = await Promise.all([
    db.select().from(envOfftakes).where(eq(envOfftakes.projectId, project.id)).orderBy(desc(envOfftakes.createdAt)),
    db.select({ id: certifications.id, name: certifications.name }).from(certifications).where(eq(certifications.projectId, project.id)),
    db.select({ id: finModels.id, name: finModels.name, version: finModels.version, status: finModels.status }).from(finModels).where(and(eq(finModels.projectId, project.id))).orderBy(desc(finModels.updatedAt)),
  ]);
  const editable = models.filter(m => m.status === "draft" || m.status === "in_review");
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Environmental offtake</p>
      <p className={ui.sub}>Carbon forward and spot sales, biodiversity offtakes where markets exist, watershed / PES payments, conservation agreements and other contracted attributes, alongside PPAs and commodity offtakes. Environmental value should strengthen a viable project, not be the whole business model; the financial model classes these revenues separately.</p>
      {offs.length === 0 ? <p className={r.empty}>No environmental offtakes.</p> : offs.map(o => { const rv = offtakeRevenue(o); return <article key={o.id} className={s.card}>
        <header><b>{o.name}</b> <span className={ui.chip}>{OFFTAKE_KINDS[o.kind]}</span> <span className={ui.chip}>{OFFTAKE_STATUS[o.status]}</span>{o.buyerName ? <span className={ui.sub}> buyer {o.buyerName}</span> : null}</header>
        <dl className={s.kv}><dt>Volume · years</dt><dd>{n0(rv.volume)} {o.unit} over {rv.rows.length} year(s){rv.rows.length ? ` (${rv.rows[0].year}–${rv.rows.at(-1)!.year})` : ""}</dd>
          <dt>Price · floor · escalation</dt><dd>{o.price ?? "—"} · {o.floorPrice ?? "—"} · {o.escalationPct}%/yr ({o.currency})</dd><dt>Contract value</dt><dd>{compactMoney(rv.total, o.currency)}</dd>
          <dt>Prepayment · development funding</dt><dd>{o.prepayment ? compactMoney(o.prepayment, o.currency) : "—"} · {o.developmentFunding ? compactMoney(o.developmentFunding, o.currency) : "—"}</dd>
          <dt>Performance conditions</dt><dd>{o.performanceConditions || "—"}</dd><dt>Certification dependence</dt><dd>{o.certificationDependent ? "Yes: delivery depends on certification and issuance" : "No"}</dd>
          <dt>Replacement obligation</dt><dd>{o.replacementObligation || "—"}</dd><dt>Counterparty risk</dt><dd>{o.counterpartyRisk || "—"}</dd></dl>
        {editable.length > 0 && <form action={offtakeToModelAction} className={s.inline}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="offtakeId" value={o.id} />
          <label>Financial model<select name="modelId">{editable.map(m => <option key={m.id} value={m.id}>{m.name} v{m.version}</option>)}</select></label><label>COD calendar year<input name="codYear" inputMode="numeric" placeholder="2027" /></label>
          <button className={ui.miniBtn} type="submit">Add to model as revenue</button></form>}
      </article>; })}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Record an offtake</p>
      <form action={saveOfftakeAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
        <label>Name<input name="name" required /></label>
        <label>Kind<select name="kind">{Object.entries(OFFTAKE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Status<select name="status" defaultValue="prospect">{Object.entries(OFFTAKE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Buyer<input name="buyerName" /></label>
        {certs.length > 0 && <label>Certification<select name="certificationId" defaultValue=""><option value="">—</option>{certs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label>Unit<input name="unit" defaultValue="tCO2e" /></label>
        <label>Delivery schedule <span className={ui.sub}>year:volume[@price], comma-separated</span><textarea name="schedule" rows={2} placeholder="2028:20000, 2029:20000, 2030:25000@24" /></label>
        <label>Price<input name="price" inputMode="decimal" /></label><label>Floor price<input name="floorPrice" inputMode="decimal" /></label><label>Escalation %/yr<input name="escalationPct" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} maxLength={3} /></label>
        <label>Prepayment<input name="prepayment" inputMode="decimal" /></label><label>Development funding<input name="developmentFunding" inputMode="decimal" /></label>
        <label>Performance conditions<textarea name="performanceConditions" rows={2} /></label><label className={s.check}><input type="checkbox" name="certificationDependent" defaultChecked /> Depends on certification</label>
        <label>Replacement obligation<input name="replacementObligation" placeholder="e.g. Replace shortfall from buffer or other vintages" /></label><label>Counterparty risk<input name="counterpartyRisk" /></label><label>Signed<input name="signedDate" type="date" /></label>
        <button className="btn" type="submit">Record</button></form></section></aside>
  </div>;
}

async function Risk({ project }: { project: Project }) {
  const rows = await appDb().select().from(riskTransfers).where(eq(riskTransfers.projectId, project.id)).orderBy(asc(riskTransfers.kind));
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Risk capital / risk transfer</p>
      <p className={ui.sub}>Insurance and guarantees change bankability: record what is identified, quoted or bound, what it covers, and why it matters to lenders.</p>
      {rows.length === 0 ? <p className={r.empty}>No risk-transfer instruments recorded.</p> : <table className={ui.table}><thead><tr><th>Instrument</th><th>Provider</th><th>Status</th><th>Coverage</th><th>Premium</th><th>Term</th><th>Covers · bankability</th></tr></thead><tbody>
        {rows.map(x => <tr key={x.id}><td className={ui.primary}>{RISK_TRANSFER[x.kind]}</td><td>{x.provider || "—"}</td><td><span className={ui.chip}>{RISK_TRANSFER_STATUS[x.status]}</span></td><td className={ui.num}>{x.coverage ? compactMoney(x.coverage, x.currency) : "—"}</td><td className={ui.num}>{x.premium ? compactMoney(x.premium, x.currency) : "—"}</td><td>{x.start ?? "—"} → {x.end ?? "—"}</td><td className={ui.sub}>{[x.covers, x.bankabilityNote].filter(Boolean).join(" · ")}</td></tr>)}
      </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add instrument</p>
      <form action={addRiskTransferAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
        <label>Instrument<select name="kind">{Object.entries(RISK_TRANSFER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Status<select name="status" defaultValue="identified">{Object.entries(RISK_TRANSFER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Provider<input name="provider" /></label><label>Coverage<input name="coverage" inputMode="decimal" /></label><label>Premium<input name="premium" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} maxLength={3} /></label>
        <label>Start<input name="start" type="date" /></label><label>End<input name="end" type="date" /></label>
        <label>Covers<input name="covers" placeholder="e.g. Delivery shortfall of forward-sold credits" /></label><label>Bankability note<input name="bankabilityNote" /></label>
        <button className="btn" type="submit">Add</button></form></section></aside>
  </div>;
}
