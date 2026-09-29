import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalRequirements, fundingPathways } from "@/db/schema";
import { appDb, type Scope } from "@/lib/db/scoped";
import { pathwayProgress } from "@/lib/capital/pathways";
import { ELIGIBILITY_STATES, PATHWAY_SOURCES, PATHWAY_STATUSES } from "@/lib/capital/structure-vocab";
import { compactMoney } from "@/lib/projects/labels";
import { fundingForProject } from "@/lib/projects/queries";
import { addStepAction, createPathwayAction, deletePathwayAction, setPathwayEligibilityAction, setPathwayStatusAction, toggleStepAction } from "../structure-actions";
import styles from "./stack.module.css";

type Pathway = typeof fundingPathways.$inferSelect;

/** One pathway card: status, eligibility (separate from fit), steps, deadline. Shared by the project tab and /capital/funding-pathways. */
export function PathwayCard({ p, back, projectName }: { p: Pathway; back: string; projectName?: string }) {
  const prog = pathwayProgress(p.steps);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>
        <span>{p.name}{projectName ? <> · <Link href={`/projects/${p.projectId}?tab=pathways`}>{projectName}</Link></> : null}</span>
        <span className={ui.chip}>{PATHWAY_STATUSES[p.status]}</span>
      </p>
      <dl className={r.kv}>
        <dt>Source</dt><dd>{PATHWAY_SOURCES[p.sourceType]}{p.provider ? ` · ${p.provider}` : ""}</dd>
        <dt>Amount</dt><dd>{p.amount != null ? compactMoney(p.amount, p.currency) : "Not set"}</dd>
        <dt>Deadline</dt><dd>{p.deadline ? <span style={{ color: p.deadline < today ? "#c8553d" : undefined }}>{p.deadline}</span> : "None recorded"}</dd>
        <dt>Eligibility</dt><dd>{ELIGIBILITY_STATES[p.eligibility]}{p.eligibilitySource ? ` · source: ${p.eligibilitySource}` : ""}{p.eligibilityNotes ? ` · ${p.eligibilityNotes}` : ""}</dd>
        <dt>Owner</dt><dd>{p.owner ?? "Unassigned"}</dd>
      </dl>
      <div className={styles.progress} aria-label={`${prog.done} of ${prog.total} steps done`}><i style={{ width: `${prog.pct}%` }} /></div>
      <ul className={styles.steps}>
        {p.steps.map(s => (
          <li key={s.id} data-done={s.done}>
            <form action={toggleStepAction}><input type="hidden" name="pathwayId" value={p.id} /><input type="hidden" name="stepId" value={s.id} /><input type="hidden" name="back" value={back} /><button type="submit" aria-label={s.done ? `Reopen ${s.label}` : `Mark ${s.label} done`}>{s.done ? "✓" : ""}</button></form>
            <span>{s.label}</span>{s.due && <small className={ui.sub} style={{ color: !s.done && s.due < today ? "#c8553d" : undefined }}>{s.due}</small>}
          </li>
        ))}
      </ul>
      <details style={{ marginTop: 8 }}>
        <summary className={ui.sub}>Update status, eligibility or steps</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <form action={setPathwayStatusAction} className={styles.add}>
            <input type="hidden" name="pathwayId" value={p.id} /><input type="hidden" name="back" value={back} />
            <select name="status" defaultValue={p.status} aria-label="Status">{Object.entries(PATHWAY_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className={ui.miniBtn} type="submit">Set status</button>
          </form>
          <form action={setPathwayEligibilityAction} className={styles.add}>
            <input type="hidden" name="pathwayId" value={p.id} /><input type="hidden" name="back" value={back} />
            <select name="eligibility" defaultValue={p.eligibility} aria-label="Eligibility">{Object.entries(ELIGIBILITY_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="source" defaultValue={p.eligibilitySource} placeholder="Source (required for confirmed)" aria-label="Eligibility source" />
            <input name="notes" defaultValue={p.eligibilityNotes} placeholder="Criteria checked" aria-label="Eligibility notes" />
            <button className={ui.miniBtn} type="submit">Record eligibility</button>
          </form>
          <form action={addStepAction} className={styles.add}>
            <input type="hidden" name="pathwayId" value={p.id} /><input type="hidden" name="back" value={back} />
            <input name="label" placeholder="New step" required aria-label="Step" /><input name="due" type="date" aria-label="Due" />
            <button className={ui.miniBtn} type="submit">Add step</button>
          </form>
          <form action={deletePathwayAction}><input type="hidden" name="pathwayId" value={p.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Remove pathway</button></form>
        </div>
      </details>
    </section>
  );
}

/** Funding pathways (§10): routes to specific capital sources, eligibility separate from fit. */
export default async function PathwaysTab({ project, scope }: { project: { id: string; currency: string | null; country: string | null; sector: string | null }; scope: Scope }) {
  const [rows, reqs, calls] = await Promise.all([
    appDb().select().from(fundingPathways).where(eq(fundingPathways.projectId, project.id)).orderBy(asc(fundingPathways.deadline), asc(fundingPathways.createdAt)),
    appDb().select({ id: capitalRequirements.id, purpose: capitalRequirements.purpose }).from(capitalRequirements).where(eq(capitalRequirements.projectId, project.id)),
    fundingForProject(scope, project),
  ]);
  const back = `/projects/${project.id}?tab=pathways`;
  return (
    <div className={r.grid}>
      <div>
        {rows.length === 0 && <section className={r.panel}><p className={r.empty}>No funding pathways yet. A pathway is a route to one source of capital (a grant call, a DFI, an ECA, a green bond …) with its eligibility screen, steps and deadline.</p></section>}
        {rows.map(p => <PathwayCard key={p.id} p={p} back={back} />)}
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a pathway</p>
          <form action={createPathwayAction} className={r.form}>
            <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="back" value={back} />
            <label>Name<input name="name" required placeholder="e.g. IFC senior loan, Horizon Europe call" /></label>
            <label>Source type<select name="sourceType" defaultValue="dfi">{Object.entries(PATHWAY_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Provider<input name="provider" /></label>
            <label>Amount<input name="amount" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} /></label>
            <label>Deadline<input name="deadline" type="date" /></label>
            {reqs.length > 0 && <label>For requirement<select name="requirementId" defaultValue=""><option value="">None</option>{reqs.map(q => <option key={q.id} value={q.id}>{q.purpose}</option>)}</select></label>}
            {calls.length > 0 && <label>Funding call (from Funding radar)<select name="fundingOpportunityId" defaultValue=""><option value="">None</option>{calls.map(c => <option key={c.id} value={c.id}>{c.title.slice(0, 80)}{c.deadline ? ` · ${c.deadline}` : ""}</option>)}</select></label>}
            <label>Notes<textarea name="notes" rows={2} /></label>
            <button className="btn btn--primary" type="submit">Add pathway</button>
          </form>
          <p className={ui.sub}>Steps start from a generic process for the source type; edit them to the programme&apos;s actual rules. <Link href="/capital/funding-pathways">All pathways</Link></p>
        </section>
      </aside>
    </div>
  );
}
