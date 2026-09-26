import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { playbookRuns } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { playbookWithDefinition } from "@/lib/playbooks/engine";
import { GOVERNANCE_LABEL, RUN_LABEL, SCOPE_LABEL } from "@/lib/playbooks/labels";
import { TOOLS } from "@/lib/playbooks/tools";
import { approveRunAction, correctionAction, runToolAction, setStepAction, verifyRunAction } from "../../../playbook-actions";
import styles from "../../../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbook run" };

const ENTITY_HREF: Record<string, (id: string) => string> = {
  project: id => `/projects/${id}`, organization: id => `/companies/${id}`, capital_opportunity: id => `/capital/opportunities/${id}`, deal: () => "/deals?view=table", document: () => "/documents",
};

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/playbooks");
  const { id } = await params;
  const sp = await searchParams;
  const [run] = await appDb().select().from(playbookRuns).where(and(eq(playbookRuns.id, id), mandateCondition(user.scope, playbookRuns.mandateId)));
  if (!run) notFound();
  const { p, def } = await playbookWithDefinition(appDb(), run.playbookId, run.version);
  const closed = run.status === "completed" || run.status === "cancelled";

  return (
    <>
      <PageHeader title={`${p.name}${run.entityLabel ? ` · ${run.entityLabel}` : ""}`} actions={<><Link className="btn" href={`/playbooks/${p.id}`}>Playbook</Link>{run.entityId && ENTITY_HREF[run.entityType] && <Link className="btn" href={ENTITY_HREF[run.entityType](run.entityId)}>Open {run.entityType.replace("_", " ")}</Link>}</>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6 }}><span className={ui.chip} style={{ color: run.status === "needs_review" ? "#b0432f" : undefined }}>{RUN_LABEL[run.status]}</span> version {run.version} · started by {run.startedBy} {run.createdAt.slice(0, 10)}{run.approvedBy ? ` · approved by ${run.approvedBy}` : ""}</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Steps</p>
            <table className={ui.table}><tbody>{def.steps.map(s => {
              const st = run.steps.find(x => x.key === s.key)!;
              return (
                <tr key={s.key}>
                  <td><b>{s.title}</b> <span className={ui.chip}>{GOVERNANCE_LABEL[s.governance]}</span> <span className={ui.chip} style={{ color: st.status === "failed" ? "#b0432f" : undefined }}>{st.status}</span>
                    {st.note && <span className={ui.sub} style={{ display: "block" }}>{st.note}</span>}
                    {st.by && <span className={ui.sub} style={{ display: "block" }}>{st.by} · {st.at?.slice(0, 16).replace("T", " ")}</span>}</td>
                  <td>{!closed && (
                    <div className={styles.stack} style={{ minWidth: 200 }}>
                      {s.tool && TOOLS[s.tool] && <form action={runToolAction}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="stepKey" value={s.key} /><button className={ui.miniBtn} type="submit" title={TOOLS[s.tool].label}>Run tool</button></form>}
                      {s.governance !== "approval" ? (
                        <form action={setStepAction} className={styles.inline}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="stepKey" value={s.key} />
                          <select name="status" defaultValue={st.status === "todo" ? "done" : st.status} aria-label="Step status"><option value="done">Done</option><option value="skipped">Skipped</option><option value="failed">Failed</option><option value="todo">To do</option></select>
                          <input name="note" placeholder="Note / evidence" aria-label="Note" style={{ width: 130 }} />
                          <button className={ui.miniBtn} type="submit">Set</button></form>
                      ) : <span className={ui.sub}>Completed by approving the run</span>}
                    </div>
                  )}</td>
                </tr>
              );
            })}</tbody></table>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Definition of done</p>
            <form action={verifyRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{def.proof.map(x => {
                const c = run.checks.find(y => y.id === x.id);
                return <li key={x.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
                  <span style={{ color: c?.pass === true ? "var(--water)" : c?.pass === false ? "#b0432f" : undefined }}>{c?.pass === true ? "✓" : c?.pass === false ? "✗" : "○"}</span> {x.text}
                  {x.check.type === "manual" && !closed && <label style={{ marginLeft: 8, fontSize: 12 }}><input type="checkbox" name="confirm" value={x.id} defaultChecked={c?.pass === true} /> I confirm</label>}
                  {c && <span className={ui.sub} style={{ display: "block" }}>{c.detail}</span>}
                </li>;
              })}</ul>
              {!closed && <button className="btn btn--primary" type="submit" style={{ marginTop: 10 }}>Check definition of done</button>}
            </form>
            {run.status === "awaiting_approval" && (isOwner(user.scope) ? <form action={approveRunAction} style={{ marginTop: 8 }}><input type="hidden" name="runId" value={run.id} /><button className="btn" type="submit">Approve</button></form> : <p className={ui.sub}>Waiting for an owner to approve.</p>)}
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Correct this run</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Fix the playbook, not only this output: choose where it failed and whether the fix is one-time or permanent (permanent fixes become a draft version for approval).</p>
            <form action={correctionAction} className={styles.stack}>
              <input type="hidden" name="playbookId" value={p.id} /><input type="hidden" name="runId" value={run.id} />
              <label>What went wrong<textarea name="description" rows={2} required /></label>
              <label>Layer<select name="layer"><option value="process">Process</option><option value="toolbox">Toolbox</option><option value="proof">Proof</option></select></label>
              <label>Fix as<select name="scope">{Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Change<input name="change" placeholder="Rule, tool or check to add" /></label>
              <button className="btn" type="submit">Record correction</button>
            </form>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Rules in force</p>
            {def.rules.length === 0 ? <p className={r.empty}>None.</p> : <ul style={{ margin: "0 0 0 18px", fontSize: 13 }}>{def.rules.map(x => <li key={x.id}>{x.text}</li>)}</ul>}
          </section>
        </aside>
      </div>
    </>
  );
}
