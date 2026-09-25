import { asc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { designPackages, engineeringRequirements, studies } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { studyGaps } from "@/lib/delivery/engine";
import { DESIGN_STAGES, DESIGN_STATUSES, DISCIPLINES, ENG_REQ_STATUSES, STUDY_STATUSES, STUDY_TYPES } from "@/lib/delivery/vocab";
import { compactMoney } from "@/lib/projects/labels";
import {
  addDesignPackageAction, addEngineeringRequirementAction, addStudyAction, updateDesignPackageAction, updateEngineeringRequirementAction, updateStudyAction,
} from "../delivery-actions";
import styles from "./projects.module.css";

/** Engineering (master spec XVI): studies, design packages by stage and discipline, and the codes and standards that
 * apply. The OS records who confirmed what; it never certifies engineering compliance. */
export default async function EngineeringTab({ project }: { project: { id: string; assetClass: string | null; stage: string; currency: string | null; country: string | null } }) {
  const [st, dp, er] = await Promise.all([
    appDb().select().from(studies).where(eq(studies.projectId, project.id)).orderBy(asc(studies.type)),
    appDb().select().from(designPackages).where(eq(designPackages.projectId, project.id)).orderBy(asc(designPackages.discipline)),
    appDb().select().from(engineeringRequirements).where(eq(engineeringRequirements.projectId, project.id)).orderBy(asc(engineeringRequirements.discipline)),
  ]);
  const gaps = studyGaps(project, st);
  const stageKeys = Object.keys(DESIGN_STAGES) as (keyof typeof DESIGN_STAGES)[];
  const latest = new Map<string, (typeof dp)[number]>();
  for (const x of dp) if (x.status !== "superseded") {
    const cur = latest.get(x.discipline);
    if (!cur || stageKeys.indexOf(x.stage) > stageKeys.indexOf(cur.stage)) latest.set(x.discipline, x);
  }

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Studies</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>
            Expected for this asset class{gaps.due ? "" : " (flagged on Today from Development)"}: {gaps.expected.map(t => STUDY_TYPES[t]).join(", ")}.
            {gaps.missing.length ? <> <span className={styles.flag}>Missing: {gaps.missing.map(t => STUDY_TYPES[t]).join(", ")}.</span></> : " All expected studies are started or received."}
            {gaps.pending.length ? ` Under way: ${gaps.pending.map(t => STUDY_TYPES[t]).join(", ")}.` : ""}
          </p>
          {st.length === 0 ? <p className={r.empty}>No studies recorded.</p> : (
            <table className={ui.table}><tbody>{st.map(s => (
              <tr key={s.id}>
                <td><b>{STUDY_TYPES[s.type]}</b>{s.title ? ` · ${s.title}` : ""}
                  <span className={ui.sub} style={{ display: "block" }}>{[s.provider, s.cost !== null && compactMoney(s.cost, s.currency), s.dueDate && `due ${s.dueDate}`, s.completedAt && `received ${s.completedAt}`, s.reviewer && `reviewed by ${s.reviewer}${s.reviewedAt ? ` ${s.reviewedAt}` : ""}`].filter(Boolean).join(" · ")}</span>
                  {s.findings && <span style={{ display: "block", fontSize: 12.5 }}>{s.findings}</span>}</td>
                <td>
                  <form action={updateStudyAction} className={styles.stack} style={{ minWidth: 200 }}>
                    <input type="hidden" name="studyId" value={s.id} />
                    <select name="status" defaultValue={s.status} aria-label="Status">{Object.entries(STUDY_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="reviewer" defaultValue={s.reviewer ?? ""} placeholder="Reviewer (needed to accept)" aria-label="Reviewer" />
                    <input name="findings" placeholder="Key findings" aria-label="Findings" />
                    <button className={ui.miniBtn} type="submit">Update</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Design maturity</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Latest package by discipline: {latest.size ? [...latest.values()].map(x => `${DISCIPLINES[x.discipline]} ${DESIGN_STAGES[x.stage]}`).join(" · ") : "none yet"}.</p>
          {dp.length > 0 && (
            <table className={ui.table}><tbody>{dp.map(x => (
              <tr key={x.id}>
                <td><b>{DISCIPLINES[x.discipline]}</b> · {DESIGN_STAGES[x.stage]}
                  <span className={ui.sub} style={{ display: "block" }}>{[DESIGN_STATUSES[x.status], x.engineer, x.issuedAt && `issued ${x.issuedAt}`, x.approvedBy && `approved by ${x.approvedBy}`, x.notes].filter(Boolean).join(" · ")}</span></td>
                <td>
                  <form action={updateDesignPackageAction} className={styles.inline}>
                    <input type="hidden" name="packageId" value={x.id} />
                    <select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(DESIGN_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="approvedBy" defaultValue={x.approvedBy ?? ""} placeholder="Engineer of record" aria-label="Approved by" style={{ width: 130 }} />
                    <button className={ui.miniBtn} type="submit">Set</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Codes and standards</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Which codes apply, where they come from and who confirmed them. &quot;Confirmed&quot; means the engineer of record said so; the OS does not certify compliance.</p>
          {er.length === 0 ? <p className={r.empty}>No codes recorded.</p> : (
            <table className={ui.table}><tbody>{er.map(x => (
              <tr key={x.id}>
                <td><b>{x.standard}</b>{x.version ? ` (${x.version})` : ""} · {DISCIPLINES[x.discipline]}
                  <span className={ui.sub} style={{ display: "block" }}>{[x.jurisdiction, x.authority, x.source && `source: ${x.source}`, x.effectiveDate && `effective ${x.effectiveDate}`, x.lastVerified && `last verified ${x.lastVerified}`, x.reviewer && `by ${x.reviewer}`].filter(Boolean).join(" · ")}</span></td>
                <td>
                  <form action={updateEngineeringRequirementAction} className={styles.inline}>
                    <input type="hidden" name="reqId" value={x.id} />
                    <select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(ENG_REQ_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="reviewer" defaultValue={x.reviewer ?? ""} placeholder="Reviewer" aria-label="Reviewer" style={{ width: 120 }} />
                    <button className={ui.miniBtn} type="submit">Set</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a study</p>
          <form action={addStudyAction} className={styles.stack}>
            <input type="hidden" name="id" value={project.id} />
            <label>Type<select name="type" required defaultValue={gaps.missing[0] ?? "survey"}>{Object.entries(STUDY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Title<input name="title" /></label>
            <label>Status<select name="status" defaultValue="scoping">{Object.entries(STUDY_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Provider<input name="provider" /></label>
            <label>Cost<input name="cost" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} /></label>
            <label>Due<input name="dueDate" type="date" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a design package</p>
          <form action={addDesignPackageAction} className={styles.stack}>
            <input type="hidden" name="id" value={project.id} />
            <label>Discipline<select name="discipline" required>{Object.entries(DISCIPLINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Stage<select name="stage" required>{Object.entries(DESIGN_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Status<select name="status" defaultValue="planned">{Object.entries(DESIGN_STATUSES).filter(([k]) => k !== "approved").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Engineer<input name="engineer" /></label>
            <label>Notes<input name="notes" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a code or standard</p>
          <form action={addEngineeringRequirementAction} className={styles.stack}>
            <input type="hidden" name="id" value={project.id} />
            <label>Discipline<select name="discipline" required>{Object.entries(DISCIPLINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Code / standard<input name="standard" required placeholder="e.g. IEC 62446-1, NOM-001-SEDE-2012" /></label>
            <label>Version<input name="version" /></label>
            <label>Jurisdiction<input name="jurisdiction" defaultValue={project.country ?? ""} /></label>
            <label>Authority<input name="authority" /></label>
            <label>Source<input name="source" placeholder="Where it is published" /></label>
            <label>Effective<input name="effectiveDate" type="date" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
