// Integrity panel (phase 23): the current policy decision with its seven readings, rule outcomes, findings and the
// evidence still outstanding; owner override with a reason; redesign scenarios; impact records; stewardship obligations;
// and the country's EnergyData.info datasets to pull into diligence.
import { and, desc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { DECISION_STATES, impactRecords, integrityFindings, policyDecisions, projects, redesignScenarios, stewardshipObligations } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { energyDatasets, type EnergyDataset } from "@/lib/fabric/energydata";
import { IMPACT_KINDS, INDICATORS, indicatorByKey } from "@/lib/integrity/indicators";
import { CLASSIFICATION_LABEL, DECISION_STATE_LABEL } from "@/lib/integrity/policy";
import { countryName } from "@/lib/scan/countries";
import {
  addImpactRecordAction, addObligationAction, completeObligationAction, decideRedesignAction, generateRedesignAction, overrideIntegrityAction, screenIntegrityAction,
} from "../integrity-actions";
import styles from "./projects.module.css";

const STATE_TONE: Record<string, string> = { eligible: "var(--positive)", conditionally_eligible: "var(--positive)", insufficient_evidence: "var(--steel)", enhanced_due_diligence: "var(--warning)", redesign_required: "var(--warning)", human_review: "var(--critical)", excluded: "var(--critical)" };
const OBLIGATION_KINDS = { monitoring: "Monitoring", reporting: "Reporting", benefit_sharing: "Benefit sharing", conservation: "Conservation", maintenance: "Maintenance", verification: "Verification" } as const;
const PROVENANCE: Record<string, string> = { verified: "verified", official: "official source", third_party: "third-party data", regenera_model: "Regenera model", user_claim: "user claim", ai_hypothesis: "AI hypothesis", missing: "missing" };

export default async function IntegrityPanel({ projectId, owner }: { projectId: string; owner: boolean }) {
  const db = appDb();
  const back = `/projects/${projectId}?tab=capital#integrity`;
  const [[d], [p]] = await Promise.all([
    db.select().from(policyDecisions).where(and(eq(policyDecisions.projectId, projectId), eq(policyDecisions.current, true))).limit(1),
    db.select({ country: projects.country }).from(projects).where(eq(projects.id, projectId)),
  ]);
  const [findings, history, scenarios, impacts, obligations] = await Promise.all([
    d ? db.select().from(integrityFindings).where(eq(integrityFindings.decisionId, d.id)) : Promise.resolve([]),
    db.select({ id: policyDecisions.id, state: policyDecisions.state, v: policyDecisions.policyVersion, at: policyDecisions.createdAt, by: policyDecisions.decidedBy }).from(policyDecisions).where(eq(policyDecisions.projectId, projectId)).orderBy(desc(policyDecisions.createdAt)).limit(6),
    db.select().from(redesignScenarios).where(eq(redesignScenarios.projectId, projectId)).orderBy(desc(redesignScenarios.version)).limit(6),
    db.select().from(impactRecords).where(eq(impactRecords.projectId, projectId)).orderBy(desc(impactRecords.createdAt)).limit(40),
    db.select().from(stewardshipObligations).where(eq(stewardshipObligations.projectId, projectId)).orderBy(stewardshipObligations.dueAt).limit(40),
  ]);
  const cname = countryName(p?.country);
  let datasets: EnergyDataset[] = [];
  let datasetsErr = "";
  if (cname) { try { datasets = (await energyDatasets(db, cname)).slice(0, 6); } catch (e) { datasetsErr = (e as Error).message.slice(0, 120); } }
  const latestV = scenarios[0]?.version;
  const current = scenarios.filter(s => s.version === latestV);

  return (
    <section className={r.panel} id="integrity">
      <p className={r.panelTitle}><span>Integrity screening</span>{d && <span className={ui.chip} style={{ color: STATE_TONE[d.state] }}>{DECISION_STATE_LABEL[d.state]}</span>}</p>
      {!d ? <p className={r.empty}>Not screened yet. The scheduled screening runs every two hours; screen now to see the decision.</p> : <>
        <p><b>{CLASSIFICATION_LABEL[d.classification]}</b> <span className={ui.sub} style={{ display: "inline" }}>· policy v{d.policyVersion} · confidence {d.confidence} · by {d.decidedBy} · {d.createdAt.slice(0, 10)}{d.nextReviewAt ? ` · review ${d.nextReviewAt.slice(0, 10)}` : ""}</span></p>
        <table className={ui.table}><tbody>{d.readings.map(x => <tr key={x.key}><td>{x.label}</td><td><b>{x.value}</b></td><td className={ui.wrap}><span className={ui.sub}>{x.basis}</span></td></tr>)}</tbody></table>
        <p className={ui.sub}>Readings sit side by side; none is blended into another. Commercial inputs (fees, returns) are not read by the integrity rules.</p>
        <details><summary className={ui.sub}>Rule outcomes ({d.rules.length})</summary>
          <table className={ui.table}><tbody>{d.rules.map((x, i) => <tr key={i}><td>{x.rule.replace(/_/g, " ")}</td><td>{x.outcome}</td><td className={ui.wrap}><span className={ui.sub}>{x.basis}{x.evidence ? ` · ${x.evidence}` : ""}</span></td></tr>)}</tbody></table>
        </details>
        {findings.length > 0 && <>
          <p className={ui.sub} style={{ marginTop: 8 }}><b>Findings</b></p>
          <ul className={r.timeline}>{findings.map(f => <li key={f.id}><span className={r.when}>{f.kind}</span><span>{f.text}<span className={ui.sub}>{f.domain} · {PROVENANCE[f.provenance]}{f.source ? ` · ${f.source}` : ""}</span></span></li>)}</ul>
        </>}
        {d.outstanding.length > 0 && <><p className={ui.sub}><b>Evidence outstanding</b></p><ul>{d.outstanding.map((x, i) => <li key={i} className={ui.sub}>{x}</li>)}</ul></>}
        {d.remediation.length > 0 && <><p className={ui.sub}><b>Remediation path</b></p><ul>{d.remediation.map((x, i) => <li key={i} className={ui.sub}>{x}</li>)}</ul></>}
        {d.overrides.length > 0 && <p className={ui.sub}>Overrides: {d.overrides.map(o => `${o.at.slice(0, 10)} ${o.by}: ${o.from.replace(/_/g, " ")} → ${o.to.replace(/_/g, " ")} (“${o.reason}”)`).join("; ")}</p>}
      </>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <form action={screenIntegrityAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} /><button className="btn" type="submit">{d ? "Rescreen" : "Screen now"}</button></form>
        <form action={generateRedesignAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} /><button className="btn" type="submit">Draft redesign scenarios</button></form>
      </div>
      {owner && d && (
        <details style={{ marginTop: 6 }}><summary className={ui.sub}>Override the decision (owner, with a reason)</summary>
          <form action={overrideIntegrityAction} className={styles.stack} style={{ marginTop: 6 }}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} />
            <label>New state<select name="state" defaultValue={d.state}>{DECISION_STATES.map(s => <option key={s} value={s}>{DECISION_STATE_LABEL[s]}</option>)}</select></label>
            <label>Reason (kept on the record; 20+ characters to leave an exclusion or human review)<textarea name="reason" rows={2} required /></label>
            <button className="btn" type="submit">Record override</button>
          </form>
        </details>
      )}
      {history.length > 1 && <p className={ui.sub}>History: {history.map(h => `${h.at.slice(0, 10)} v${h.v} ${h.state.replace(/_/g, " ")}`).join(" · ")}</p>}

      {current.length > 0 && <>
        <p className={r.panelTitle} style={{ marginTop: 14 }}>Redesign scenarios · v{latestV}</p>
        {current.map(s => (
          <details key={s.id} open={s.variant !== "original"}>
            <summary>{s.variant.replace(/_/g, " ")} <span className={ui.sub} style={{ display: "inline" }}>· {s.status}</span></summary>
            {s.options.length > 0 && <ul>{s.options.map(o => <li key={o.key} className={ui.sub}><b>{o.label}</b>: {o.effect}</li>)}</ul>}
            <table className={ui.table}><tbody>{s.comparison.map(c => <tr key={c.dimension}><td>{c.dimension}</td><td>{c.change}</td><td><span className={ui.sub}>{c.basis}</span></td></tr>)}</tbody></table>
            {s.variant !== "original" && s.status === "draft" && (
              <div style={{ display: "flex", gap: 6 }}>
                {(["approved", "rejected"] as const).map(st => <form key={st} action={decideRedesignAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value={st} /><input type="hidden" name="back" value={back} /><button className="btn" type="submit">{st === "approved" ? "Approve" : "Reject"}</button></form>)}
              </div>
            )}
            {s.status === "approved" && <form action={decideRedesignAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value="applied" /><input type="hidden" name="back" value={back} /><button className="btn" type="submit">Mark applied to the design</button></form>}
          </details>
        ))}
        <p className={ui.sub}>Assumptions: {current[0].assumptions.join("; ")}.</p>
      </>}

      <p className={r.panelTitle} style={{ marginTop: 14 }}>Impact records</p>
      {impacts.length === 0 ? <p className={r.empty}>No impact records. Start with a baseline, each with its method and source.</p> : (
        <table className={ui.table}><tbody>{impacts.map(x => (
          <tr key={x.id}><td>{indicatorByKey(x.indicator)?.label ?? x.indicator}</td><td>{IMPACT_KINDS[x.kind]}</td><td className={ui.num}>{x.value ?? "—"} {x.unit}</td>
            <td className={ui.wrap}><span className={ui.sub}>{[x.periodStart && `${x.periodStart}–${x.periodEnd ?? ""}`, x.method, x.source, x.verifiedBy && `verified by ${x.verifiedBy}`].filter(Boolean).join(" · ")}</span></td></tr>
        ))}</tbody></table>
      )}
      <details><summary className={ui.sub}>Add an impact record</summary>
        <form action={addImpactRecordAction} className={styles.stack} style={{ marginTop: 6 }}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} />
          <label>Indicator<select name="indicator">{INDICATORS.map(i => <option key={i.key} value={i.key}>{i.label} ({i.unit})</option>)}</select></label>
          <label>Kind<select name="kind">{Object.entries(IMPACT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Value<input name="value" inputMode="decimal" /></label>
          <div className={styles.grid2}><label>Period start<input name="periodStart" type="date" /></label><label>Period end<input name="periodEnd" type="date" /></label></div>
          <label>Method (blank = the indicator&apos;s standard method)<input name="method" /></label>
          <label>Source<input name="source" /></label>
          <label>Verified by (independent third party)<input name="verifiedBy" /></label>
          <button className="btn" type="submit">Add record</button>
        </form>
      </details>

      <p className={r.panelTitle} style={{ marginTop: 14 }}>Stewardship obligations</p>
      {obligations.length === 0 ? <p className={r.empty}>None recorded. Monitoring, reporting and benefit-sharing commitments belong here once agreed.</p> : (
        <table className={ui.table}><tbody>{obligations.map(o => (
          <tr key={o.id}><td>{o.title}<span className={ui.sub}>{OBLIGATION_KINDS[o.kind]}{o.recurrenceMonths ? ` · every ${o.recurrenceMonths} mo` : ""}{o.owner ? ` · ${o.owner}` : ""}</span></td>
            <td>{o.dueAt?.slice(0, 10) ?? "no date"}</td><td style={{ color: o.status === "overdue" ? "var(--critical)" : undefined }}>{o.status}</td>
            <td>{(o.status === "open" || o.status === "overdue") && <form action={completeObligationAction} style={{ display: "flex", gap: 4 }}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} /><input name="evidence" placeholder="Evidence" aria-label="Evidence" required /><button className="btn" type="submit">Done</button></form>}</td></tr>
        ))}</tbody></table>
      )}
      <details><summary className={ui.sub}>Add an obligation</summary>
        <form action={addObligationAction} className={styles.stack} style={{ marginTop: 6 }}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} />
          <label>Title<input name="title" required /></label>
          <label>Kind<select name="kind">{Object.entries(OBLIGATION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <div className={styles.grid2}><label>Due<input name="dueAt" type="date" /></label><label>Repeat every (months)<input name="recurrenceMonths" inputMode="numeric" /></label></div>
          <label>Owner<input name="owner" /></label>
          <label>Indicator<select name="indicator"><option value="">—</option>{INDICATORS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}</select></label>
          <button className="btn" type="submit">Add obligation</button>
        </form>
      </details>

      {cname && <>
        <p className={r.panelTitle} style={{ marginTop: 14 }}>Energy datasets · {cname}</p>
        {datasetsErr ? <p className={ui.sub}>EnergyData.info unavailable: {datasetsErr}</p> : datasets.length === 0 ? <p className={r.empty}>No EnergyData.info datasets found for {cname}.</p> : (
          <ul>{datasets.map(x => <li key={x.url} className={ui.sub}><a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> · {x.publisher}{x.licence ? ` · ${x.licence}` : ""}{x.updated ? ` · ${x.updated}` : ""}</li>)}</ul>
        )}
        <p className={ui.sub}>World Bank EnergyData.info catalogue; licence per dataset. Pull the relevant data into claims with its source.</p>
      </>}
    </section>
  );
}
