import { asc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { esIssues, insurancePolicies, risks } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { ES_FRAMEWORKS, ES_STATUSES, ES_TOPICS, INSURANCE_PHASES, INSURANCE_STATUSES, INSURANCE_TYPES, MITIGATION_STEPS } from "@/lib/delivery/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { IMPACT, LIKELIHOOD, RESIDUAL, RISK_CATEGORIES, RISK_STATUSES, SEVERITIES } from "@/lib/projects/vocab";
import { addEsIssueAction, addInsuranceAction, updateEsIssueAction, updateInsuranceAction } from "../delivery-actions";
import { addRiskAction, updateRiskAction } from "../project-actions";
import styles from "./projects.module.css";

const SCORE: Record<string, number> = { rare: 1, unlikely: 2, possible: 3, likely: 4, almost_certain: 5, low: 1, medium: 2, high: 3, severe: 4 };
const SEV: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const red = (s: string) => (s === "critical" || s === "high" ? "#b0432f" : undefined);

/** Risk register (what may happen, how likely, how bad, who owns the mitigation, what would trigger it), environmental
 * and social issues against host law or lender standards with the mitigation hierarchy, and insurance. */
export default async function RiskTab({ projectId, currency }: { projectId: string; currency: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows, es, ins] = await Promise.all([
    appDb().select().from(risks).where(eq(risks.projectId, projectId)).orderBy(asc(risks.status)),
    appDb().select().from(esIssues).where(eq(esIssues.projectId, projectId)),
    appDb().select().from(insurancePolicies).where(eq(insurancePolicies.projectId, projectId)).orderBy(asc(insurancePolicies.phase)),
  ]);
  const sorted = [...rows].sort((a, b) => SCORE[b.likelihood] * SCORE[b.impact] - SCORE[a.likelihood] * SCORE[a.impact]);
  es.sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || SEV[a.severity] - SEV[b.severity]);
  return (
    <div className={r.grid}>
      <div>
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

        <section className={r.panel}>
          <p className={r.panelTitle}>Environmental and social</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Each issue names the standard it is judged against: host-country law is the permission to build; IFC PS, WB ESF and Equator are what lenders require. Mitigation follows avoid, minimize, restore, offset.</p>
          {es.length === 0 ? <p className={r.empty}>No E&amp;S issues recorded.</p> : (
            <table className={ui.table}><tbody>{es.map(x => (
              <tr key={x.id}>
                <td><b>{ES_TOPICS[x.topic]}</b> · <span style={{ color: red(x.severity) }}>{SEVERITIES[x.severity]}</span> · {ES_FRAMEWORKS[x.framework]}{x.reference ? ` (${x.reference})` : ""}
                  <span style={{ display: "block" }}>{x.description}</span>
                  <span className={ui.sub}>{[`Mitigation: ${MITIGATION_STEPS[x.mitigationStep]}${x.mitigation ? `, ${x.mitigation}` : ""}`, x.owner && `Owner: ${x.owner}`, x.dueDate && `Due ${x.dueDate}${x.dueDate < today && x.status !== "closed" ? " (overdue)" : ""}`, x.evidence && `Evidence: ${x.evidence}`].filter(Boolean).join(" · ")}</span></td>
                <td>
                  <form action={updateEsIssueAction} className={styles.inline}>
                    <input type="hidden" name="issueId" value={x.id} />
                    <select name="mitigationStep" defaultValue={x.mitigationStep} aria-label="Mitigation step">{Object.entries(MITIGATION_STEPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(ES_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className={ui.miniBtn} type="submit">Set</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Insurance</p>
          {ins.length === 0 ? <p className={r.empty}>No insurance lines. Record what lenders and contracts require (CAR, DSU, liability …) before construction; bound policies appear on Today 60 days before they expire.</p> : (
            <table className={ui.table}><tbody>{ins.map(x => (
              <tr key={x.id}>
                <td><b>{INSURANCE_TYPES[x.type]}</b> · {INSURANCE_PHASES[x.phase]}
                  <span className={ui.sub} style={{ display: "block" }}>{[x.insurer, x.broker && `broker ${x.broker}`, x.coverageLimit !== null && `limit ${compactMoney(x.coverageLimit, x.currency)}`, x.deductible !== null && `deductible ${compactMoney(x.deductible, x.currency)}`,
                    x.premium !== null && `premium ${compactMoney(x.premium, x.currency)}`, x.startsAt && `from ${x.startsAt}`, x.expiresAt && `to ${x.expiresAt}`, x.lenderRequirement && `required by: ${x.lenderRequirement}`].filter(Boolean).join(" · ")}</span></td>
                <td>
                  <form action={updateInsuranceAction} className={styles.inline}>
                    <input type="hidden" name="policyId" value={x.id} />
                    <select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(INSURANCE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="expiresAt" type="date" defaultValue={x.expiresAt ?? ""} aria-label="Expires" />
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
        <details className={r.panel}>
          <summary className={r.panelTitle} style={{ cursor: "pointer" }}>Add an E&amp;S issue</summary>
          <form action={addEsIssueAction} className={styles.stack} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={projectId} />
            <label>Topic<select name="topic" required>{Object.entries(ES_TOPICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Description<textarea name="description" required minLength={3} rows={3} /></label>
            <label>Judged against<select name="framework" defaultValue="host_law">{Object.entries(ES_FRAMEWORKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Reference<input name="reference" placeholder="e.g. IFC PS6 para 16" /></label>
            <label>Severity<select name="severity" defaultValue="medium">{Object.entries(SEVERITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Mitigation step<select name="mitigationStep" defaultValue="none">{Object.entries(MITIGATION_STEPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Mitigation<input name="mitigation" /></label>
            <label>Owner<input name="owner" /></label>
            <label>Due<input name="dueDate" type="date" /></label>
            <label>Evidence<input name="evidence" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </details>
        <details className={r.panel}>
          <summary className={r.panelTitle} style={{ cursor: "pointer" }}>Add an insurance line</summary>
          <form action={addInsuranceAction} className={styles.stack} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={projectId} />
            <label>Cover<select name="type" required>{Object.entries(INSURANCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Phase<select name="phase" defaultValue="construction">{Object.entries(INSURANCE_PHASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Status<select name="status" defaultValue="required">{Object.entries(INSURANCE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Insurer<input name="insurer" /></label>
            <label>Broker<input name="broker" /></label>
            <label>Limit<input name="coverageLimit" inputMode="decimal" /></label>
            <label>Deductible<input name="deductible" inputMode="decimal" /></label>
            <label>Premium<input name="premium" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={currency} /></label>
            <label>Starts<input name="startsAt" type="date" /></label>
            <label>Expires<input name="expiresAt" type="date" /></label>
            <label>Required by<input name="lenderRequirement" placeholder="e.g. Senior facility term sheet §12" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </details>
      </aside>
    </div>
  );
}
