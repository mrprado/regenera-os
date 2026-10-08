// Project 360 tabs added in phase 19: site questions (data fabric), land control, equipment + interconnection queue,
// stakeholders, diligence (gate, data room, sanctions on parties, values by source, permit dependencies) and matches.
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import {
  contacts, equipment, landControls, ontologyMatches, organizations, permitDependencies, permits, placeFacts, projectEquipment, projectParties, projectQueueLinks,
  queueProjects, sanctionsChecks, stakeholders, type projects,
} from "@/db/schema";
import { COUNTRY_NOTES, LANES, matchProgrammes, programmesCsv } from "@/lib/capital/programmes";
import { countryRisk, fmtReading } from "@/lib/fabric/country";
import { PRECISION } from "@/lib/portfolio/screen";
import { placeApproximatelyAction } from "../casework-actions";
import PartnerScanPanel from "./partner-scan";
import { toGwh, yieldCheck } from "@/lib/diligence/yield";
import type { UserScope } from "@/lib/db/scoped";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { dataRoom } from "@/lib/diligence/dataroom";
import { findCandidates } from "@/lib/diligence/matches";
import { answers } from "@/lib/fabric/questions";
import { packFor } from "@/lib/fabric/packs";
import { valuesBySource } from "@/lib/ontology/conflicts";
import { gateOf, PROJECT_GATES } from "@/lib/ontology/states";
import {
  CONFIDENCE, EQUIPMENT_CATEGORIES, EQUIPMENT_STATUS, LAND_CONTROL_TYPES, LEVELS_3, MATCH_KINDS, QUEUE_RELATIONS, RIGHT_STATES, SANCTIONS_REVIEW,
  STAKEHOLDER_CATEGORIES, STAKEHOLDER_POSITIONS, TITLE_EVIDENCE,
} from "@/lib/ontology/taxonomies";
import { PERMIT_STATUSES } from "@/lib/regulatory/vocab";
import { gateState } from "@/lib/sanctions/engine";
import {
  addEquipmentAction, addPermitDependencyAction, decideMatchAction, deleteLandControlAction, linkQueueAction, runQuestionAction, saveLandControlAction,
  saveStakeholderAction, screenAction, setEquipmentStatusAction,
} from "../ontology-actions";

type Project = typeof projects.$inferSelect;
const P = ({ id }: { id: string }) => <input type="hidden" name="projectId" value={id} />;
const Opts = ({ o }: { o: Record<string, string> }) => <>{Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>;
const tone = (good: boolean, bad = false) => (good ? ui.chipReed : bad ? ui.chipEmber : ui.chipMuted);

// ---------- Site questions ----------
export async function QuestionsTab({ project }: { project: Project }) {
  const list = await answers(appDb(), project);
  const pack = packFor(project.country);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Site questions</p>
      <p className={ui.sub}>Ask the question; the OS picks the sources. Each answer shows its provenance and evidence level (L0 discovery → L4 verified professional). Global sources screen; they never stand in for the country&apos;s official sources or project evidence.</p>
      {project.lat === null && <p className={r.empty}>This project has no location yet. Set it on the Place tab or in Atlas, then fetch.</p>}
      {list.map(a => <article key={a.key} id={`q-${a.key}`} className={r.read} style={{ marginTop: 14 }}>
        <header style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}><b>{a.q.label}</b><span className={ui.sub}>{a.q.asks}</span>
          {a.q.live.length > 0 && project.lat !== null && <form action={runQuestionAction} style={{ marginLeft: "auto" }}><P id={project.id} /><input type="hidden" name="question" value={a.key} /><button className={ui.miniBtn} type="submit">Fetch live sources</button></form>}</header>
        {a.facts.length === 0 ? <p className={r.empty}>No values yet{a.q.live.length ? ": fetch live sources" : ": the Place tab builds these when the project has a location"}.</p> :
          <table className={ui.table}><thead><tr><th>Reading</th><th>Value</th><th>Level</th><th>Source</th><th>Retrieved</th></tr></thead><tbody>
            {a.facts.map(f => <tr key={f.key}><td>{f.label}</td><td>{f.value}{f.state === "stale" ? " (stale)" : ""}</td><td><span className={ui.chip}>{f.level}</span></td>
              <td className={ui.sub}>{f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.integrationKey}</a> : f.integrationKey}{f.license ? ` · ${f.license}` : ""}{f.observedFor ? ` · ${f.observedFor}` : ""}</td><td className={ui.sub}>{f.retrievedAt.slice(0, 10)}</td></tr>)}
          </tbody></table>}
        {a.q.caution && <p className={ui.sub}><b>Note:</b> {a.q.caution}</p>}
        <details><summary className={ui.sub}>Source hierarchy, official sources to verify with{a.gaps.length ? ", and what data cannot tell" : ""}</summary>
          <ol className={ui.sub}>{a.q.hierarchy.map(h => <li key={h}>{h}</li>)}</ol>
          {a.verify.length > 0 ? <ul className={ui.sub}>{a.verify.map(v => <li key={v.name}><a href={v.url} target="_blank" rel="noreferrer">{v.name}</a>: {v.covers}{v.integrationKey ? " (connected)" : " (check and record as evidence)"}</li>)}</ul>
            : <p className={ui.sub}>{pack ? `No ${pack.label} source listed for this question yet.` : "No country pack for this project's country yet: verify with the national authority and record the evidence."}</p>}
          {a.gaps.length > 0 && <ul className={ui.sub}>{a.gaps.map(g => <li key={g}>{g}</li>)}</ul>}
        </details>
      </article>)}
    </section>
    <aside><section className={r.panel} id="place"><p className={r.panelTitle}>Location</p>
      <p className={ui.sub}>{project.lat !== null ? <>{project.lat.toFixed(4)}, {project.lng?.toFixed(4)} · {project.locationPrecision ? PRECISION[project.locationPrecision as keyof typeof PRECISION] ?? project.locationPrecision : "precision not recorded"}{project.locationSource ? <><br />{project.locationSource}</> : null}</> : "Not located: site checks, Atlas and yield checks cannot run."}</p>
      <form action={placeApproximatelyAction} className={r.form}><input type="hidden" name="projectId" value={project.id} />
        <label>Town or locality<input name="locality" defaultValue={[project.municipality, project.subdivision, project.country].filter(Boolean).join(", ")} /></label>
        <div className={r.formRow}><label>or latitude<input name="lat" inputMode="decimal" /></label><label>longitude<input name="lng" inputMode="decimal" /></label></div>
        <label>Precision<select name="precision" defaultValue={project.locationPrecision ?? "town"}>{Object.entries(PRECISION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className={ui.miniBtn} type="submit">{project.lat !== null ? "Update location" : "Place approximately"}</button></form>
      <p className={ui.sub}>Approximate placements are labelled on Atlas and in every check. Replace with surveyed coordinates when the sponsor shares them.</p></section>
    <section className={r.panel}><p className={r.panelTitle}>Country pack</p>
      {pack ? <><p>{pack.label}</p><p className={ui.sub}>{Object.values(pack.domains).flat().length} official sources across {Object.keys(pack.domains).length} domains. See <Link href="/intelligence/ontology?tab=packs">all packs</Link>.</p></>
        : <p className={r.empty}>{project.country ? `No pack for ${project.country} yet.` : "Set the project's country."} Packs exist for the US, Mexico, the UK and the EU.</p>}
    </section></aside>
  </div>;
}

// ---------- Land control ----------
export async function LandTab({ project, scope }: { project: Project; scope: UserScope }) {
  const rows = await appDb().select().from(landControls).where(and(eq(landControls.projectId, project.id), mandateCondition(scope, landControls.mandateId)));
  const total = rows.reduce((s, x) => s + (x.areaHa ?? 0), 0);
  const controlled = rows.filter(x => !["none", "loi"].includes(x.controlType)).reduce((s, x) => s + (x.areaHa ?? 0), 0);
  const soon = rows.filter(x => x.expiresOn && x.expiresOn <= new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10));
  const form = (x?: typeof rows[number]) => <form action={saveLandControlAction} className={r.form}><P id={project.id} />{x && <input type="hidden" name="id" value={x.id} />}
    <div className={r.formRow}><label>Parcel reference<input name="parcelRef" defaultValue={x?.parcelRef ?? ""} placeholder="Registry / cadastral ID" /></label><label>Area (ha)<input name="areaHa" defaultValue={x?.areaHa ?? ""} /></label></div>
    <div className={r.formRow}><label>Control<select name="controlType" defaultValue={x?.controlType ?? "none"}><Opts o={LAND_CONTROL_TYPES} /></select></label><label>Counterparty<input name="counterparty" defaultValue={x?.counterparty ?? ""} /></label></div>
    <div className={r.formRow}><label>Term (months)<input name="termMonths" defaultValue={x?.termMonths ?? ""} /></label><label>Extension<input name="extension" defaultValue={x?.extension ?? ""} placeholder="e.g. 2 × 12 months" /></label></div>
    <div className={r.formRow}><label>Starts<input type="date" name="startsOn" defaultValue={x?.startsOn ?? ""} /></label><label>Expires<input type="date" name="expiresOn" defaultValue={x?.expiresOn ?? ""} /></label></div>
    <div className={r.formRow}><label>Title evidence<select name="titleEvidence" defaultValue={x?.titleEvidence ?? "none"}><Opts o={TITLE_EVIDENCE} /></select></label><label>Encumbrances<input name="encumbrances" defaultValue={x?.encumbrances ?? ""} /></label></div>
    <div className={r.formRow}><label>Rights of way<select name="rightsOfWay" defaultValue={x?.rightsOfWay ?? "unknown"}><Opts o={RIGHT_STATES} /></select></label><label>Water rights<select name="waterRights" defaultValue={x?.waterRights ?? "unknown"}><Opts o={RIGHT_STATES} /></select></label></div>
    <div className={r.formRow}><label>Mineral rights<select name="mineralRights" defaultValue={x?.mineralRights ?? "unknown"}><Opts o={RIGHT_STATES} /></select></label><label>Legal confidence<select name="legalConfidence" defaultValue={x?.legalConfidence ?? "low"}><Opts o={CONFIDENCE} /></select></label></div>
    <label>Notes<textarea name="notes" defaultValue={x?.notes ?? ""} /></label><button className="btn" type="submit">{x ? "Save parcel" : "Add parcel"}</button></form>;
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Land control</p>
      <p className={ui.sub}>&quot;Land secured&quot; is never a yes/no: each parcel records what is held, with whom, until when, and on what evidence.</p>
      <div className={ui.stats}><div className={ui.stat}><span>Parcels</span><b>{rows.length}</b></div><div className={ui.stat}><span>Area</span><b>{total.toLocaleString("en-US")} ha</b></div><div className={ui.stat}><span>Under option or better</span><b>{controlled.toLocaleString("en-US")} ha</b></div><div className={ui.stat}><span>Expiring ≤ 6 months</span><b>{soon.length}</b></div></div>
      {rows.length === 0 ? <p className={r.empty}>No parcels recorded.</p> : rows.map(x => <details key={x.id} className={r.read} style={{ marginTop: 12 }}>
        <summary><b>{x.parcelRef || "Parcel"}</b> · {x.areaHa ?? "?"} ha · <span className={`${ui.chip} ${tone(["owned", "lease", "purchase_agreement"].includes(x.controlType), x.controlType === "none")}`}>{LAND_CONTROL_TYPES[x.controlType]}</span>
          {x.counterparty ? ` · ${x.counterparty}` : ""}{x.expiresOn ? ` · expires ${x.expiresOn}` : ""} · title {TITLE_EVIDENCE[x.titleEvidence].toLowerCase()} · rights of way {RIGHT_STATES[x.rightsOfWay].toLowerCase()} · water {RIGHT_STATES[x.waterRights].toLowerCase()} · legal confidence {CONFIDENCE[x.legalConfidence].toLowerCase()}</summary>
        {form(x)}
        <form action={deleteLandControlAction}><P id={project.id} /><input type="hidden" name="id" value={x.id} /><button className={ui.miniBtn} type="submit">Remove (owners)</button></form>
      </details>)}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add a parcel</p>{form()}</section></aside>
  </div>;
}

// ---------- Equipment + interconnection queue ----------
export async function EquipmentTab({ project, scope }: { project: Project; scope: UserScope }) {
  const db = appDb();
  const [rows, library, links] = await Promise.all([
    db.select({ pe: projectEquipment, e: equipment }).from(projectEquipment).innerJoin(equipment, eq(equipment.id, projectEquipment.equipmentId)).where(and(eq(projectEquipment.projectId, project.id), mandateCondition(scope, projectEquipment.mandateId))),
    db.select().from(equipment).where(mandateCondition(scope, equipment.mandateId)).orderBy(equipment.manufacturer).limit(300),
    db.select({ l: projectQueueLinks, q: queueProjects }).from(projectQueueLinks).leftJoin(queueProjects, eq(queueProjects.key, projectQueueLinks.queueKey)).where(and(eq(projectQueueLinks.projectId, project.id), mandateCondition(scope, projectQueueLinks.mandateId))),
  ]);
  const state = (project.subdivision ?? "").trim().toUpperCase();
  const nearby = state.length === 2 ? await db.select().from(queueProjects).where(eq(queueProjects.state, state)).orderBy(desc(queueProjects.mw)).limit(12) : [];
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Equipment</p>
      {rows.length === 0 ? <p className={r.empty}>No equipment recorded. Add modules, inverters, turbines, transformers or process equipment with their manufacturer and lead time.</p> :
        <table className={ui.table}><thead><tr><th>Equipment</th><th>Rating</th><th>Qty</th><th>Origin · lead time · warranty</th><th>Status</th></tr></thead><tbody>
          {rows.map(({ pe, e }) => <tr key={pe.id}><td><b>{e.manufacturer} {e.model}</b><div className={ui.sub}>{EQUIPMENT_CATEGORIES[e.category]}{e.bankable ? " · bankable / tier-1" : ""}{e.certifications ? ` · ${e.certifications}` : ""}</div></td>
            <td className={ui.num}>{e.rating ?? "—"} {e.ratingUnit ?? ""}</td><td className={ui.num}>{pe.quantity ?? "—"}</td><td className={ui.sub}>{e.countryOfOrigin ?? "—"} · {e.leadTimeWeeks ? `${e.leadTimeWeeks} wk` : "—"} · {e.warrantyYears ? `${e.warrantyYears} yr` : "—"}</td>
            <td><form action={setEquipmentStatusAction} style={{ display: "flex", gap: 6 }}><P id={project.id} /><input type="hidden" name="id" value={pe.id} /><select name="status" defaultValue={pe.status}><Opts o={EQUIPMENT_STATUS} /></select><button className={ui.miniBtn} type="submit">Set</button></form></td></tr>)}
        </tbody></table>}
      <p className={r.panelTitle} style={{ marginTop: 28 }}>Interconnection queue</p>
      {links.length === 0 ? <p className={r.empty}>No queue position linked. Public MISO and SPP queues sync daily; other operators are recorded on the Power tab.</p> :
        <table className={ui.table}><thead><tr><th>Position</th><th>Relation</th><th>MW · technology</th><th>Status · study</th><th>POI · county</th></tr></thead><tbody>
          {links.map(({ l, q }) => <tr key={l.id}><td>{l.queueKey}</td><td>{QUEUE_RELATIONS[l.relation]}</td><td>{q ? `${q.mw ?? "?"} MW · ${q.technology}` : "not in latest sync"}</td><td>{q ? `${q.status || "—"} · ${q.studyPhase || "—"}${q.withdrawnDate ? ` · withdrawn ${q.withdrawnDate}` : ""}` : "—"}</td><td>{q ? `${q.poi || "—"} · ${q.county}, ${q.state}` : "—"}</td></tr>)}
        </tbody></table>}
      {nearby.length > 0 && <details><summary className={ui.sub}>Largest public queue positions in {state} ({nearby.length})</summary>
        <table className={ui.table}><tbody>{nearby.map(q => <tr key={q.key}><td>{q.key}</td><td>{q.mw ?? "?"} MW {q.technology}</td><td>{q.status}</td><td>{q.poi}</td><td>
          <form action={linkQueueAction} style={{ display: "flex", gap: 6 }}><P id={project.id} /><input type="hidden" name="queueKey" value={q.key} /><select name="relation" defaultValue="competing"><Opts o={QUEUE_RELATIONS} /></select><button className={ui.miniBtn} type="submit">Link</button></form></td></tr>)}</tbody></table></details>}
    </section>
    <aside>
      <section className={r.panel}><p className={r.panelTitle}>Add equipment</p>
        <form action={addEquipmentAction} className={r.form}><P id={project.id} />
          {library.length > 0 && <label>From the library<select name="equipmentId" defaultValue=""><option value="">New make and model (below)</option>{library.map(e => <option key={e.id} value={e.id}>{e.manufacturer} {e.model} ({EQUIPMENT_CATEGORIES[e.category]})</option>)}</select></label>}
          <label>Category<select name="category" defaultValue="pv_module"><Opts o={EQUIPMENT_CATEGORIES} /></select></label>
          <div className={r.formRow}><label>Manufacturer<input name="manufacturer" /></label><label>Model<input name="model" /></label></div>
          <div className={r.formRow}><label>Rating<input name="rating" /></label><label>Unit<input name="ratingUnit" placeholder="W, kW, MVA, kWh" /></label></div>
          <div className={r.formRow}><label>Country of origin<input name="countryOfOrigin" /></label><label>Lead time (weeks)<input name="leadTimeWeeks" /></label></div>
          <div className={r.formRow}><label>Warranty (years)<input name="warrantyYears" /></label><label>Certifications<input name="certifications" placeholder="IEC 61215, UL 9540" /></label></div>
          <div className={r.formRow}><label>Quantity<input name="quantity" /></label><label>Status<select name="status" defaultValue="considered"><Opts o={EQUIPMENT_STATUS} /></select></label></div>
          <label><span><input type="checkbox" name="bankable" /> Bankable / tier-1</span></label><label>Source<input name="source" placeholder="Datasheet, quotation" /></label>
          <button className="btn" type="submit">Add</button></form></section>
      <section className={r.panel}><p className={r.panelTitle}>Link a queue position</p>
        <form action={linkQueueAction} className={r.form}><P id={project.id} /><label>Queue key<input name="queueKey" placeholder="MISO:J1234 or SPP:GEN-2024-001" /></label><label>Relation<select name="relation"><Opts o={QUEUE_RELATIONS} /></select></label><label>Note<input name="note" /></label><button className="btn" type="submit">Link</button></form></section>
    </aside>
  </div>;
}

// ---------- Stakeholders ----------
export async function StakeholdersTab({ project, scope }: { project: Project; scope: UserScope }) {
  const rows = await appDb().select().from(stakeholders).where(and(eq(stakeholders.projectId, project.id), mandateCondition(scope, stakeholders.mandateId)));
  const order = { high: 0, medium: 1, low: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.influence] - order[b.influence] || order[a.interest] - order[b.interest]);
  const today = new Date().toISOString().slice(0, 10);
  const form = (x?: typeof rows[number]) => <form action={saveStakeholderAction} className={r.form}><P id={project.id} />{x && <input type="hidden" name="id" value={x.id} />}
    <label>Name<input name="name" required defaultValue={x?.name ?? ""} /></label>
    <div className={r.formRow}><label>Category<select name="category" defaultValue={x?.category ?? "other"}><Opts o={STAKEHOLDER_CATEGORIES} /></select></label><label>Relationship to project<input name="relationship" defaultValue={x?.relationship ?? ""} /></label></div>
    <div className={r.formRow}><label>Influence<select name="influence" defaultValue={x?.influence ?? "medium"}><Opts o={LEVELS_3} /></select></label><label>Interest<select name="interest" defaultValue={x?.interest ?? "medium"}><Opts o={LEVELS_3} /></select></label></div>
    <div className={r.formRow}><label>Position<select name="position" defaultValue={x?.position ?? "unknown"}><Opts o={STAKEHOLDER_POSITIONS} /></select></label><label>Last engagement<input type="date" name="lastEngagementAt" defaultValue={x?.lastEngagementAt ?? ""} /></label></div>
    <label><span><input type="checkbox" name="consentRequired" defaultChecked={x?.consentRequired} /> Consent required (e.g. FPIC)</span></label><label><span><input type="checkbox" name="consultationRequired" defaultChecked={x?.consultationRequired} /> Consultation required</span></label>
    <label>Commitments made<textarea name="commitments" defaultValue={x?.commitments ?? ""} /></label>
    <div className={r.formRow}><label>Next action<input name="nextAction" defaultValue={x?.nextAction ?? ""} /></label><label>Due<input type="date" name="nextActionDue" defaultValue={x?.nextActionDue ?? ""} /></label></div>
    <label>Notes<textarea name="notes" defaultValue={x?.notes ?? ""} /></label><button className="btn" type="submit">{x ? "Save" : "Add stakeholder"}</button></form>;
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Stakeholders</p>
      <p className={ui.sub}>Influence, interest and position for everyone the project affects. Communities, Indigenous rights, consent and grievances under their governance rules stay on the <Link href={`/projects/${project.id}?tab=community`}>Community / rights</Link> tab.</p>
      {sorted.length === 0 ? <p className={r.empty}>No stakeholders recorded.</p> :
        <table className={ui.table}><thead><tr><th>Stakeholder</th><th>Influence · interest</th><th>Position</th><th>Consent · consultation</th><th>Next action</th></tr></thead><tbody>
          {sorted.map(x => <tr key={x.id}><td><details><summary><b>{x.name}</b> <span className={ui.sub}>{STAKEHOLDER_CATEGORIES[x.category]}{x.relationship ? ` · ${x.relationship}` : ""}</span></summary>{form(x)}</details></td>
            <td>{LEVELS_3[x.influence]} · {LEVELS_3[x.interest]}</td><td><span className={`${ui.chip} ${tone(x.position === "supportive", x.position === "opposed" || x.position === "concerned")}`}>{STAKEHOLDER_POSITIONS[x.position]}</span></td>
            <td>{x.consentRequired ? "Consent" : "—"} · {x.consultationRequired ? "Consultation" : "—"}</td><td className={x.nextActionDue && x.nextActionDue < today ? ui.chipEmber : undefined}>{x.nextAction || "—"}{x.nextActionDue ? ` (${x.nextActionDue})` : ""}</td></tr>)}
        </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add a stakeholder</p>{form()}</section></aside>
  </div>;
}

// ---------- Diligence ----------
export async function DiligenceTab({ project, scope }: { project: Project; scope: UserScope }) {
  const db = appDb();
  const gate = gateOf(project.stage);
  const [room, fields, parties, permitRows, deps, pv, risk] = await Promise.all([
    dataRoom(db, scope.mandateIds, project.id),
    valuesBySource(db, scope.mandateIds, "project", project.id),
    db.select({ role: projectParties.role, orgId: projectParties.orgId, contactId: projectParties.contactId, orgName: organizations.name, contactName: contacts.fullName }).from(projectParties)
      .leftJoin(organizations, eq(organizations.id, projectParties.orgId)).leftJoin(contacts, eq(contacts.id, projectParties.contactId))
      .where(and(eq(projectParties.projectId, project.id), mandateCondition(scope, projectParties.mandateId))),
    db.select().from(permits).where(and(eq(permits.projectId, project.id), mandateCondition(scope, permits.mandateId))),
    db.select().from(permitDependencies).where(and(eq(permitDependencies.projectId, project.id), mandateCondition(scope, permitDependencies.mandateId))),
    db.select({ key: placeFacts.key, numeric: placeFacts.numeric }).from(placeFacts).where(and(eq(placeFacts.projectId, project.id), inArray(placeFacts.key, ["pv_specific_yield", "pv_specific_yield_tracking"]))),
    countryRisk(db, project.country).catch(() => null),
  ]);
  const energy = fields.find(f => f.field === "annual_energy")?.canonical;
  const capMw = project.capacity && /^mw/i.test(project.capacityUnit ?? "") ? project.capacity : null;
  const yc = capMw && energy ? yieldCheck(capMw, toGwh(energy.value, energy.unit) ?? 0, pv.find(x => x.key === "pv_specific_yield")?.numeric ?? null, pv.find(x => x.key === "pv_specific_yield_tracking")?.numeric ?? null) : null;
  const partyIds = parties.map(p => p.orgId ?? p.contactId).filter((x): x is string => !!x);
  const checks = partyIds.length ? await db.select().from(sanctionsChecks).where(and(inArray(sanctionsChecks.entityId, partyIds.slice(0, 90)), mandateCondition(scope, sanctionsChecks.mandateId))).orderBy(desc(sanctionsChecks.createdAt)) : [];
  const latest = (id: string) => checks.find(c => c.entityId === id) ?? null;
  const permitName = new Map(permitRows.map(p => [p.id, p.name]));
  const blocked = permitRows.filter(p => deps.some(d => d.permitId === p.id && permitRows.find(x => x.id === d.dependsOnId)?.status !== "approved"));
  const filled = room.filter(f => f.state === "filled").length;
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Gate {gate.gate}: {gate.label}</p>
      <p className={ui.sub}>Stage {project.stage.replace(/_/g, " ")}. To pass: {gate.exit}</p>
      <ol className={ui.sub} style={{ display: "flex", gap: 6, flexWrap: "wrap", listStyle: "none", padding: 0 }}>{PROJECT_GATES.map(g => <li key={g.gate} className={`${ui.chip} ${g.gate === gate.gate ? ui.chipReed : g.gate < gate.gate ? "" : ui.chipMuted}`}>{g.gate} {g.label}</li>)}</ol>

      <p className={r.panelTitle} style={{ marginTop: 24 }}>Data room ({filled} of {room.length} folders with a final document)</p>
      <table className={ui.table}><thead><tr><th>Folder</th><th>Final</th><th>Drafts</th><th>Records</th><th></th></tr></thead><tbody>
        {room.map(f => <tr key={f.key}><td>{f.label}</td><td className={ui.num}>{f.final}</td><td className={ui.num}>{f.drafts}</td><td className={ui.sub}>{f.records.join("; ") || "—"}</td><td><span className={`${ui.chip} ${tone(f.state === "filled", f.state === "empty")}`}>{f.state === "filled" ? "Filled" : f.state === "draft_only" ? "Draft / records only" : "Empty"}</span></td></tr>)}
      </tbody></table>
      <p className={ui.sub}>Built from the <Link href="/documents">documents register</Link> (approved or executed = final) and project records. Add documents with this project selected to fill a folder.</p>

      <p className={r.panelTitle} style={{ marginTop: 24 }}>Energy yield check</p>
      {!yc ? <p className={r.empty}>{!capMw ? "Needs capacity in MW." : "Record the stated annual energy as a claim with field annual_energy (unit GWh or MWh) and its source, and build the place profile, to compare it with PVGIS."}</p> :
        <div className={r.read}>
          <span>Stated {yc.statedKwhPerKw.toLocaleString("en-US")} kWh/kW per year · PVGIS fixed {yc.fixed ? Math.round(yc.fixed).toLocaleString("en-US") : "—"} · single-axis tracking {yc.tracking ? Math.round(yc.tracking).toLocaleString("en-US") : "—"}</span>
          <span className={`${ui.chip} ${tone(yc.reading === "consistent_fixed", yc.reading === "above_tracking")}`}>{yc.reading === "above_tracking" ? "Above tracking potential" : yc.reading === "needs_tracking" ? "Needs tracking or DC oversizing" : yc.reading === "below_fixed" ? "Below fixed potential" : yc.reading === "no_reference" ? "No reference yet" : "Consistent with resource"}</span>
          <p className={ui.sub}>{yc.question}</p>
        </div>}

      <p className={r.panelTitle} style={{ marginTop: 24 }}>Values by source</p>
      {fields.length === 0 ? <p className={r.empty}>No field-level claims on this project yet. Claims with a field and value (Overview → claims) appear here source by source.</p> :
        fields.map(f => <div key={f.field} className={r.read} style={{ marginTop: 10 }}>
          <b style={{ color: f.conflict ? "var(--rust, #A45F3F)" : undefined }}>{f.field.replace(/_/g, " ")}{f.conflict ? ": sources disagree" : ""}</b>
          <ul className={ui.sub}>{f.values.map(v => <li key={v.claimId}>{v.value}{v.unit ? ` ${v.unit}` : ""} · {v.status.replace(/_/g, " ")} · {v.sources.join(", ") || "no evidence"}{v.validFrom || v.validTo ? ` · valid ${v.validFrom ?? "…"} to ${v.validTo ?? "…"}` : ""}</li>)}</ul>
          <span className={ui.sub}>Canonical: {f.canonical ? `${f.canonical.value}${f.canonical.unit ? ` ${f.canonical.unit}` : ""}` : "none"}. {f.why} Nothing is overwritten.</span></div>)}

      <p className={r.panelTitle} style={{ marginTop: 24 }}>Permit critical path</p>
      {permitRows.length === 0 ? <p className={r.empty}>No permits recorded. Add them on the <Link href={`/projects/${project.id}?tab=regulatory`}>Regulatory</Link> tab.</p> : <>
        <table className={ui.table}><thead><tr><th>Permit</th><th>Status</th><th>Depends on</th></tr></thead><tbody>
          {permitRows.map(p => { const on = deps.filter(d => d.permitId === p.id); return <tr key={p.id}><td>{p.name}<div className={ui.sub}>{p.authority}</div></td><td>{PERMIT_STATUSES[p.status]}</td>
            <td className={ui.sub}>{on.map(d => permitName.get(d.dependsOnId)).join(", ") || "—"}{blocked.some(b => b.id === p.id) ? " (waiting)" : ""}</td></tr>; })}
        </tbody></table>
        {permitRows.length > 1 && <form action={addPermitDependencyAction} className={r.form} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}><P id={project.id} />
          <label>Permit<select name="permitId">{permitRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>cannot proceed before<select name="dependsOnId">{permitRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className={ui.miniBtn} type="submit">Add dependency</button></form>}
      </>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Sanctions screening of parties</p>
      {parties.length === 0 ? <p className={r.empty}>No project parties yet (Partners tab).</p> : parties.map((p, i) => {
        const id = p.orgId ?? p.contactId; const c = id ? latest(id) : null; const st = gateState(c);
        return <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          <b>{p.orgName ?? p.contactName ?? "—"}</b> <span className={ui.sub}>{p.role}</span><br />
          <span className={`${ui.chip} ${tone(st === "clear" || st === "cleared", st === "pending" || st === "confirmed")}`}>{st === "not_screened" ? "Not screened" : st === "clear" ? "No match" : st === "pending" ? "Possible match: review" : SANCTIONS_REVIEW[st]}</span>
          {c && <span className={ui.sub}> {c.createdAt.slice(0, 10)}</span>}
          {id && <form action={screenAction} style={{ display: "inline" }}><input type="hidden" name="entityType" value={p.orgId ? "organization" : "person"} /><input type="hidden" name="entityId" value={id} /><input type="hidden" name="back" value={`/projects/${project.id}?tab=diligence`} /> <button className={ui.miniBtn} type="submit">Screen now</button></form>}
        </div>;
      })}
      <p className={ui.sub}>OFAC, UK, EU and UN lists. A possible match is a flag for a person: <Link href="/network/sanctions">review it here</Link>.</p>
    </section>
    <section className={r.panel}><p className={r.panelTitle}>Country risk{risk ? `: ${risk.iso3}` : ""}</p>
      {!risk ? <p className={r.empty}>Set the project&apos;s country.</p> : <>
        {risk.note && <p className={ui.sub}>{risk.note}</p>}
        <table className={ui.table}><tbody>{risk.readings.map(x => <tr key={x.code}><td className={ui.sub}>{x.label}</td><td className={ui.num}>{fmtReading(x)}</td></tr>)}</tbody></table>
        <p className={ui.sub}>{risk.source}. Readings, not a rating.</p></>}
    </section></aside>
  </div>;
}

// ---------- Matches ----------
export async function MatchesTab({ project, scope, kind }: { project: Project; scope: UserScope; kind?: string }) {
  const k = (kind && kind in MATCH_KINDS ? kind : "investor") as keyof typeof MATCH_KINDS;
  const db = appDb();
  const [cands, decided] = await Promise.all([
    findCandidates(db, scope.mandateIds, project, k),
    db.select({ m: ontologyMatches, name: organizations.name }).from(ontologyMatches).innerJoin(organizations, eq(organizations.id, ontologyMatches.orgId)).where(and(eq(ontologyMatches.projectId, project.id), mandateCondition(scope, ontologyMatches.mandateId), inArray(ontologyMatches.status, ["shortlisted", "dismissed"]))),
  ]);
  const status = new Map(decided.filter(d => d.m.kind === k).map(d => [d.m.orgId, d.m.status]));
  const programmes = matchProgrammes(project);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Matches: {MATCH_KINDS[k]}</p>
      <nav className={ui.tabs}>{(Object.keys(MATCH_KINDS) as (keyof typeof MATCH_KINDS)[]).map(x => <Link key={x} className={`${ui.tab} ${x === k ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=matches&kind=${x}`}>{MATCH_KINDS[x].replace("Project ↔ ", "")}</Link>)}</nav>
      <p className={ui.sub}>Organizations with a matching role in the network profile or on past projects. Each shows the criteria met, failed and not yet known: no single score. Shortlisting sends nothing.</p>
      {cands.length === 0 ? <p className={r.empty}>No candidates: add network profiles (Network → Profiles) or record parties on other projects.</p> : cands.map(c => <article key={c.orgId} className={r.read} style={{ marginTop: 10 }}>
        <header style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}><Link href={`/companies/${c.orgId}`}><b>{c.name}</b></Link>{status.get(c.orgId) && <span className={ui.chip}>{status.get(c.orgId)}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>{(["shortlisted", "dismissed"] as const).map(s => <form key={s} action={decideMatchAction}><P id={project.id} /><input type="hidden" name="orgId" value={c.orgId} /><input type="hidden" name="kind" value={k} /><input type="hidden" name="status" value={s} /><button className={ui.miniBtn} type="submit">{s === "shortlisted" ? "Shortlist" : "Dismiss"}</button></form>)}</span></header>
        <div className={ui.sub}>{c.met.length > 0 && <>Met: {c.met.join(" · ")}<br /></>}{c.failed.length > 0 && <>Failed: {c.failed.join(" · ")}<br /></>}{c.unknown.length > 0 && <>Not known: {c.unknown.join(" · ")}<br /></>}{c.evidence.length > 0 && <>Evidence: {c.evidence.join("; ")}</>}</div>
      </article>)}
    </section>
    <aside><PartnerScanPanel project={project} /><section className={r.panel}><p className={r.panelTitle}>Elsewhere</p><p className={ui.sub}>Capital matching with private profiles is on the <Link href={`/projects/${project.id}?tab=capital`}>Capital</Link> tab; grants on <Link href={`/projects/${project.id}?tab=funding`}>Funding</Link>.</p></section></aside>
    <section className={r.panel} style={{ gridColumn: "1 / -1" }}>
      <p className={r.panelTitle}>Public capital programmes ({programmes.length})</p>
      <p className={ui.sub}>Institutions whose public mandate covers this country and whose capital lanes fit the project&apos;s stage. Institutions only, no people; every entry lists what to verify before any approach, and outreach stays in the approval queue.</p>
      {project.country && COUNTRY_NOTES[project.country.toUpperCase()] && <p className={r.read}><b>{project.country.toUpperCase()}:</b> {COUNTRY_NOTES[project.country.toUpperCase()]}</p>}
      {programmes.length === 0 ? <p className={r.empty}>{project.country ? "No catalogued programme lists this country yet." : "Set the project's country to match programmes."}</p> :
        <table className={ui.table}><thead><tr><th>Programme</th><th>Lanes</th><th>Instruments</th><th>Criteria</th><th>Verify</th></tr></thead><tbody>
          {programmes.map(m => <tr key={m.programme.key}><td><a href={m.programme.url} target="_blank" rel="noreferrer"><b>{m.programme.name}</b></a><div className={ui.sub}>{m.programme.owner}</div></td>
            <td className={ui.sub}>{m.programme.lanes.map(l => LANES[l].split(" (")[0]).join(", ")}</td><td className={ui.sub}>{m.programme.instruments}</td>
            <td className={ui.sub}>{m.met.join(" · ")}{m.failed.length ? <><br />Failed: {m.failed.join(" · ")}</> : null}</td><td className={ui.sub}>{m.verify.join(" · ") || "—"}</td></tr>)}
        </tbody></table>}
      <p className={ui.sub}><a download={`capital-programmes-${project.country ?? "all"}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(programmesCsv(programmes.map(m => m.programme)))}`}>Download as CSV</a> to import into Network as organizations.</p>
    </section>
  </div>;
}
