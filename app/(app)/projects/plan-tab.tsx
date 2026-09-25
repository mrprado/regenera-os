import { asc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contractObligations, decisions } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { projectPlan } from "@/lib/delivery/engine";
import { DECISION_STATUSES, MILESTONE_CATEGORIES, MILESTONE_STATUSES } from "@/lib/delivery/vocab";
import { addDecisionAction, addMilestoneAction, recordDecisionAction, updateMilestoneAction } from "../delivery-actions";
import styles from "./projects.module.css";

const DAY = 86_400_000;
const d = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** Plan: milestones with dependencies (critical path and forecast against due dates) and the decision log. */
export default async function PlanTab({ projectId }: { projectId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [{ milestones, cpm }, log] = await Promise.all([
    projectPlan(appDb(), projectId, today),
    appDb().select().from(decisions).where(eq(decisions.projectId, projectId)).orderBy(asc(decisions.status), asc(decisions.dueDate)),
  ]);
  const obligationIds = milestones.map(m => m.obligationId).filter((x): x is string => !!x);
  const obligations = obligationIds.length ? await appDb().select({ id: contractObligations.id, status: contractObligations.status }).from(contractObligations).where(inArray(contractObligations.id, obligationIds)) : [];
  const live = milestones.filter(m => m.status !== "cancelled" && cpm.nodes.get(m.id) && !cpm.nodes.get(m.id)!.cycle);
  const ordered = [...live].sort((a, b) => cpm.nodes.get(a.id)!.start.localeCompare(cpm.nodes.get(b.id)!.start) || cpm.nodes.get(a.id)!.finish.localeCompare(cpm.nodes.get(b.id)!.finish));
  const span = live.length ? {
    from: Math.min(...live.map(m => d(cpm.nodes.get(m.id)!.start))),
    to: Math.max(...live.map(m => Math.max(d(cpm.nodes.get(m.id)!.finish), m.dueDate ? d(m.dueDate) : 0))) + DAY,
  } : null;
  const pos = (s: string) => (span ? ((d(s) - span.from) / (span.to - span.from)) * 100 : 0);
  const name = (id: string) => milestones.find(m => m.id === id)?.name ?? "?";
  const late = live.filter(m => cpm.nodes.get(m.id)!.lateDays > 0 || cpm.nodes.get(m.id)!.overdue);

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Milestones and critical path</span>{cpm.finish && <span className={ui.sub}>Forecast finish {cpm.finish}</span>}</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Each milestone has the work it needs (days) once its dependencies are done. Remaining work starts today; red bars have no slack. The vertical tick is the committed due date.</p>
          {milestones.length === 0 ? <p className={r.empty}>No milestones yet. Start with the ones contracts and permits impose (for example &quot;PPA condition: permits by 15 November&quot;), then what they depend on.</p> : (
            <>
              {late.length > 0 && <p className={styles.flag}>{late.length} milestone{late.length === 1 ? "" : "s"} overdue or forecast after the due date.</p>}
              {span && (
                <div className={styles.gantt}>
                  {ordered.map(m => {
                    const n = cpm.nodes.get(m.id)!;
                    const left = pos(n.start), width = Math.max(0.6, pos(n.finish) - left);
                    return (
                      <div key={m.id} className={styles.gRow}>
                        <span title={m.name}>{m.isTarget ? "◆ " : ""}{m.name}</span>
                        <div className={styles.gTrack}>
                          <i className={`${styles.gBar} ${m.status === "done" ? styles.gDone : n.critical ? styles.gCrit : ""}`} style={{ left: `${left}%`, width: `${width}%` }} />
                          {m.dueDate && <i className={styles.gDue} style={{ left: `${Math.min(99.5, pos(m.dueDate))}%` }} title={`Due ${m.dueDate}`} />}
                        </div>
                      </div>
                    );
                  })}
                  <div className={styles.gRow}><span /><div className={ui.sub} style={{ display: "flex", justifyContent: "space-between" }}><span>{new Date(span.from).toISOString().slice(0, 10)}</span><span>{new Date(span.to - DAY).toISOString().slice(0, 10)}</span></div></div>
                </div>
              )}
              {cpm.cycles.length > 0 && <p className={styles.flag}>Dependency loop between: {cpm.cycles.map(name).join(", ")}. Fix the dependencies.</p>}
              <table className={ui.table}><tbody>{milestones.map(m => {
                const n = cpm.nodes.get(m.id);
                const ob = m.obligationId ? obligations.find(o => o.id === m.obligationId) : null;
                return (
                  <tr key={m.id}>
                    <td><b>{m.name}</b>{n?.critical ? <span className={ui.chip} style={{ marginLeft: 6, color: "#b0432f" }}>Critical</span> : null}
                      <span className={ui.sub} style={{ display: "block" }}>{[MILESTONE_CATEGORIES[m.category], `${m.durationDays} days of work`, m.dueDate && `due ${m.dueDate}`, n && m.status !== "done" && `forecast ${n.finish}`,
                        n && n.slackDays > 0 && m.status !== "done" && `${n.slackDays} days slack`, n?.lateDays && `${n.lateDays} days late`, n?.overdue && "overdue",
                        m.status === "done" && `done ${m.completedAt}`, m.owner && `owner ${m.owner}`, m.evidence && `evidence: ${m.evidence}`, ob && `obligation ${ob.status}`,
                        m.dependsOn.length && `after ${m.dependsOn.map(name).join(", ")}`].filter(Boolean).join(" · ")}</span></td>
                    <td>
                      <form action={updateMilestoneAction} className={styles.inline}>
                        <input type="hidden" name="milestoneId" value={m.id} />
                        <select name="status" defaultValue={m.status} aria-label="Status">{Object.entries(MILESTONE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        <input name="durationDays" defaultValue={m.durationDays} inputMode="numeric" aria-label="Days of work" style={{ width: 56 }} />
                        <input name="dueDate" type="date" defaultValue={m.dueDate ?? ""} aria-label="Due" />
                        <button className={ui.miniBtn} type="submit">Set</button>
                      </form>
                      {milestones.length > 1 && (
                        <details><summary className={ui.sub}>Depends on</summary>
                          <form action={updateMilestoneAction} className={styles.stack} style={{ marginTop: 4 }}>
                            <input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="depsSubmitted" value="1" />
                            <div className={styles.checks}>{milestones.filter(x => x.id !== m.id).map(x => <label key={x.id}><input type="checkbox" name="dependsOn" value={x.id} defaultChecked={m.dependsOn.includes(x.id)} />{x.name}</label>)}</div>
                            <button className={ui.miniBtn} type="submit">Save dependencies</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody></table>
            </>
          )}
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Decision log</p>
          {log.length === 0 ? <p className={r.empty}>No decisions logged. Record the choice, the options considered, who decided and why, so the reasoning survives the team.</p> : (
            <table className={ui.table}><tbody>{log.map(x => (
              <tr key={x.id}>
                <td><b>{x.title}</b> <span className={ui.chip}>{DECISION_STATUSES[x.status]}</span>
                  {x.context && <span style={{ display: "block" }}>{x.context}</span>}
                  <span className={ui.sub}>{[x.options && `Options: ${x.options}`, x.decision && `Decision: ${x.decision}`, x.rationale && `Why: ${x.rationale}`, x.decidedBy && `by ${x.decidedBy}${x.decidedAt ? ` on ${x.decidedAt}` : ""}`,
                    x.status === "open" && x.dueDate && `needed by ${x.dueDate}${x.dueDate < today ? " (overdue)" : ""}`, x.evidence && `Evidence: ${x.evidence}`].filter(Boolean).join(" · ")}</span></td>
                <td>
                  <details><summary className={ui.sub}>Record</summary>
                    <form action={recordDecisionAction} className={styles.stack} style={{ marginTop: 4, minWidth: 220 }}>
                      <input type="hidden" name="decisionId" value={x.id} />
                      <select name="status" defaultValue={x.status === "open" ? "decided" : x.status} aria-label="Status">{Object.entries(DECISION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <textarea name="decision" rows={2} placeholder="What was decided" defaultValue={x.decision} aria-label="Decision" />
                      <input name="rationale" placeholder="Why" defaultValue={x.rationale} aria-label="Rationale" />
                      <input name="decidedBy" placeholder="Decided by" defaultValue={x.decidedBy ?? ""} aria-label="Decided by" />
                      <input name="evidence" placeholder="Evidence (minutes, memo)" defaultValue={x.evidence} aria-label="Evidence" />
                      <button className={ui.miniBtn} type="submit">Save</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a milestone</p>
          <form action={addMilestoneAction} className={styles.stack}>
            <input type="hidden" name="id" value={projectId} />
            <label>Name<input name="name" required minLength={2} placeholder="e.g. Interconnection agreement signed" /></label>
            <label>Category<select name="category" defaultValue="other">{Object.entries(MILESTONE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Days of work once unblocked<input name="durationDays" inputMode="numeric" defaultValue="30" /></label>
            <label>Due date (committed or contractual)<input name="dueDate" type="date" /></label>
            {milestones.length > 0 && <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className={ui.sub}>Depends on</legend><div className={styles.checks}>{milestones.filter(m => m.status !== "cancelled").map(m => <label key={m.id}><input type="checkbox" name="dependsOn" value={m.id} />{m.name}</label>)}</div></fieldset>}
            <label>Owner<input name="owner" /></label>
            <label>Evidence<input name="evidence" placeholder="e.g. PPA clause 7.2" /></label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="isTarget" /> Key target (financial close, COD …)</label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Log a decision</p>
          <form action={addDecisionAction} className={styles.stack}>
            <input type="hidden" name="id" value={projectId} />
            <label>Decision needed<input name="title" required minLength={3} placeholder="e.g. Choose the EPC shortlist" /></label>
            <label>Context<textarea name="context" rows={2} /></label>
            <label>Options considered<textarea name="options" rows={2} /></label>
            <label>Needed by<input name="dueDate" type="date" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
