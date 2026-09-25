import { asc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { risks } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { IMPACT, LIKELIHOOD, RESIDUAL, RISK_CATEGORIES, RISK_STATUSES } from "@/lib/projects/vocab";
import { addRiskAction, updateRiskAction } from "../project-actions";
import styles from "./projects.module.css";

const SCORE: Record<string, number> = { rare: 1, unlikely: 2, possible: 3, likely: 4, almost_certain: 5, low: 1, medium: 2, high: 3, severe: 4 };

/** Risk register: what may happen, how likely, how bad, who owns the mitigation, what would trigger it. */
export default async function RiskTab({ projectId }: { projectId: string }) {
  const rows = await appDb().select().from(risks).where(eq(risks.projectId, projectId)).orderBy(asc(risks.status));
  const sorted = [...rows].sort((a, b) => SCORE[b.likelihood] * SCORE[b.impact] - SCORE[a.likelihood] * SCORE[a.impact]);
  return (
    <div className={r.grid}>
      <section className={r.panel}>
        <p className={r.panelTitle}>Risk register</p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Ordered by likelihood × impact. A risk may happen; a constraint is blocking now (Constraints tab).</p>
        {sorted.length === 0 ? <p className={r.empty}>No risks recorded.</p> : (
          <table className={ui.table}><tbody>{sorted.map(x => (
            <tr key={x.id}>
              <td><b>{RISK_CATEGORIES[x.category]}</b> · {LIKELIHOOD[x.likelihood]} / {IMPACT[x.impact]}
                <span style={{ display: "block" }}>{x.description}</span>
                <span className={ui.sub}>{[x.mitigation && `Mitigation: ${x.mitigation}`, x.owner && `Owner: ${x.owner}`, x.trigger && `Trigger: ${x.trigger}`, x.evidence && `Evidence: ${x.evidence}`, `Residual: ${RESIDUAL[x.residual]}`].filter(Boolean).join(" · ")}</span></td>
              <td>
                <form action={updateRiskAction} className={styles.inline}>
                  <input type="hidden" name="riskId" value={x.id} />
                  <select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(RISK_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <select name="residual" defaultValue={x.residual} aria-label="Residual">{Object.entries(RESIDUAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <button className={ui.miniBtn} type="submit">Set</button>
                </form>
              </td>
            </tr>
          ))}</tbody></table>
        )}
      </section>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a risk</p>
          <form action={addRiskAction} className={styles.stack}>
            <input type="hidden" name="id" value={projectId} />
            <label>Category<select name="category" required>{Object.entries(RISK_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Description<textarea name="description" required minLength={3} rows={3} /></label>
            <label>Likelihood<select name="likelihood" defaultValue="possible">{Object.entries(LIKELIHOOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Impact<select name="impact" defaultValue="medium">{Object.entries(IMPACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Mitigation<input name="mitigation" /></label>
            <label>Owner<input name="owner" /></label>
            <label>Trigger<input name="trigger" placeholder="What would tell us it is happening" /></label>
            <label>Evidence<input name="evidence" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
