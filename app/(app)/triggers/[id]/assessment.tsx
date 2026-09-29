// Signal assessment: interpretation, relevance per dimension (derived from Regenera's records or rated by a person,
// each with reason / evidence / confidence), related objects, actions with outcomes, and the learning note.
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalProfiles, projects, signalAssessments } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { ACTION_STATUS, RATINGS, RELEVANCE_DIMENSIONS, SIGNAL_ACTIONS, SIGNAL_TYPES } from "@/lib/intelligence/vocab";
import { addSignalActionAction, assessSignalAction, rateDimensionAction, saveInterpretationAction, updateSignalActionAction } from "../../intelligence-actions";
import s from "../../projects/natural.module.css";

const COLORS: Record<string, string> = { high: "#2f7d4f", conditional: "#b58a2a", low: "#8a8f86", none: "#8a8f86", unknown: "#b8b3a7" };

export default async function Assessment({ triggerId }: { triggerId: string }) {
  const [a] = await appDb().select().from(signalAssessments).where(eq(signalAssessments.triggerId, triggerId));
  if (!a) return <section className={r.panel}><p className={r.panelTitle}>Regenera relevance</p>
    <p className={ui.sub}>Interpret the signal and rate its relevance per dimension (capital, project, geography, relationship, service …) from Regenera&apos;s own records. No single score.</p>
    <form action={assessSignalAction}><input type="hidden" name="triggerId" value={triggerId} /><button className="btn" type="submit">Assess this signal</button></form></section>;
  const [projs, profs] = await Promise.all([
    a.related.projectIds.length ? appDb().select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, a.related.projectIds)) : [],
    a.related.profileIds.length ? appDb().select({ id: capitalProfiles.id, name: capitalProfiles.name }).from(capitalProfiles).where(inArray(capitalProfiles.id, a.related.profileIds)) : [],
  ]);
  const ids = () => <><input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="triggerId" value={triggerId} /></>;
  return <section className={r.panel}>
    <p className={r.panelTitle}><span>Regenera relevance</span><span className={ui.chip}>{SIGNAL_TYPES[a.signalType]}</span></p>
    <table className={ui.table}><tbody>{(Object.keys(RELEVANCE_DIMENSIONS) as (keyof typeof RELEVANCE_DIMENSIONS)[]).map(k => { const x = a.relevance.find(v => v.dimension === k); return <tr key={k}>
      <td>{RELEVANCE_DIMENSIONS[k]}</td><td><b style={{ color: COLORS[x?.rating ?? "unknown"] }}>{RATINGS[(x?.rating ?? "unknown") as keyof typeof RATINGS]}</b></td>
      <td className={ui.sub}>{x?.reason}{x?.evidence ? ` · ${x.evidence}` : ""}{x ? ` · ${x.confidence} confidence · ${x.by}` : ""}</td>
      <td><details><summary className={ui.sub}>rate</summary><form action={rateDimensionAction} className={s.mini}>{ids()}<input type="hidden" name="dimension" value={k} />
        <select name="rating" defaultValue={x?.rating ?? "unknown"} aria-label="Rating">{Object.entries(RATINGS).map(([rk, v]) => <option key={rk} value={rk}>{v}</option>)}</select><input name="reason" placeholder="reason" required aria-label="Reason" /><input name="evidence" placeholder="evidence" aria-label="Evidence" /><button className={ui.miniBtn} type="submit">Save</button></form></details></td></tr>; })}</tbody></table>
    <form action={assessSignalAction}><input type="hidden" name="triggerId" value={triggerId} /><button className={ui.miniBtn} type="submit">Re-derive from records (keeps your ratings)</button></form>

    <p className={r.panelTitle} style={{ marginTop: 12 }}>Related</p>
    <p className={ui.sub}>Projects: {projs.map(p => <Link key={p.id} href={`/projects/${p.id}`} style={{ marginRight: 8 }}>{p.name}</Link>)}{projs.length ? null : "—"} · Capital profiles: {profs.map(p => <Link key={p.id} href={`/capital/partners/${p.id}`} style={{ marginRight: 8 }}>{p.name}</Link>)}{profs.length ? null : "—"} · Services: {a.related.services.join(", ") || "—"}</p>

    <details><summary className={r.panelTitle}>Interpretation</summary>
      <form action={saveInterpretationAction} className={s.inline}>{ids()}
        <label>Signal type<select name="signalType" defaultValue={a.signalType}>{Object.entries(SIGNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Sector<input name="sector" defaultValue={a.classification.sector ?? ""} /></label><label>Technology<input name="technology" defaultValue={a.classification.technology ?? ""} /></label><label>Transaction type<input name="transactionType" defaultValue={a.classification.transactionType ?? ""} /></label>
        <label>Capital type<input name="capitalType" defaultValue={a.classification.capitalType ?? ""} /></label><label>Project stage<input name="projectStage" defaultValue={a.classification.projectStage ?? ""} /></label><label>Geography<input name="geography" defaultValue={a.classification.geography ?? ""} /></label>
        <label className={s.wide}>What changed<input name="whatChanged" defaultValue={a.interpretation.whatChanged ?? ""} /></label><label className={s.wide}>Why it matters<input name="whyItMatters" defaultValue={a.interpretation.whyItMatters ?? ""} /></label>
        <label>Affected sectors<input name="affectedSectors" defaultValue={a.interpretation.affectedSectors ?? ""} /></label><label>Affected geographies<input name="affectedGeographies" defaultValue={a.interpretation.affectedGeographies ?? ""} /></label>
        <label className={s.wide}>Implications<input name="implications" defaultValue={a.interpretation.implications ?? ""} /></label><label className={s.wide}>Policy relevance<input name="policyRelevance" defaultValue={a.classification.policyRelevance ?? ""} /></label>
        <button className={ui.miniBtn} type="submit">Save</button></form></details>

    <p className={r.panelTitle} style={{ marginTop: 12 }}>Actions → outcomes</p>
    {a.actions.length === 0 ? <p className={r.empty}>No actions yet.</p> : <table className={ui.table}><tbody>{a.actions.map(x => <tr key={x.id}><td>{SIGNAL_ACTIONS[x.action as keyof typeof SIGNAL_ACTIONS] ?? x.action}<span className={ui.sub}>{x.note}{x.owner ? ` · ${x.owner}` : ""}</span></td>
      <td><form action={updateSignalActionAction} className={s.mini}>{ids()}<input type="hidden" name="actionId" value={x.id} /><select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="outcome" defaultValue={x.outcome} placeholder="outcome" aria-label="Outcome" /><button className={ui.miniBtn} type="submit">Save</button></form></td></tr>)}</tbody></table>}
    <form action={addSignalActionAction} className={s.inline}>{ids()}<label>Action<select name="action">{Object.entries(SIGNAL_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Owner<input name="owner" /></label><label className={s.wide}>Note<input name="note" /></label><button className={ui.miniBtn} type="submit">Add action</button></form>
    <form action={updateSignalActionAction} className={s.inline}>{ids()}<input type="hidden" name="actionId" value="" /><input type="hidden" name="status" value="proposed" /><label className={s.wide}>Learning (what this changed in Regenera&apos;s knowledge)<input name="learning" defaultValue={a.learning} /></label><button className={ui.miniBtn} type="submit">Save learning</button></form>
  </section>;
}
