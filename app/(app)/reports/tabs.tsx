import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { caseRecords, deals, proposals } from "@/db/schema";
import { appDb, mandateCondition, type UserScope } from "@/lib/db/scoped";
import { forecast } from "@/lib/reports/forecast";
import { DEAL_STAGES, FEE_TYPES, PRACTICES } from "@/lib/vocab";
import { confirmProposalAction, rejectProposalAction, runLearningNowAction, saveCaseAction } from "../intel-actions";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const label = (map: Record<string, string>, k: string) => map[k] ?? k.replace(/_/g, " ");

export async function ForecastTab({ scope }: { scope: UserScope }) {
  const f = await forecast(appDb(), scope.mandateIds);
  const practices = [...new Set(f.months.flatMap(m => Object.keys(m.byPractice)))];
  const fees = [...new Set(f.months.flatMap(m => Object.keys(m.byFeeType)))];
  const total = f.months.reduce((a, m) => a + m.weighted, 0);
  return (
    <>
      <p className={ui.notice}>Weighted by each deal&apos;s probability. A deal without its own probability uses its stage&apos;s rate: learned from your closed deals once a stage has 10 or more, otherwise a default. Set value, monthly retainer and expected close in <Link href="/deals?view=table">Deals, Table</Link>.</p>
      <div className={ui.stats}>
        <div className={ui.stat}><b>{money(total)}</b><span>Weighted, next 6 months</span></div>
        <div className={ui.stat}><b>{f.noDate.deals}</b><span>Open deals without an expected close (weighted {money(f.noDate.weighted)})</span></div>
      </div>
      <div className={ui.tableWrap} style={{ marginBottom: 18 }}>
        <table className={ui.table}>
          <thead><tr><th>Month</th><th className={ui.num}>Weighted</th>{practices.map(p => <th key={p} className={ui.num}>{label(PRACTICES, p)}</th>)}{fees.map(x => <th key={x} className={ui.num}>{label(FEE_TYPES, x)}</th>)}</tr></thead>
          <tbody>{f.months.map(m => (
            <tr key={m.month}><td>{m.month}</td><td className={ui.num}>{money(m.weighted)}</td>
              {practices.map(p => <td key={p} className={ui.num}>{money(m.byPractice[p] ?? 0)}</td>)}
              {fees.map(x => <td key={x} className={ui.num}>{money(m.byFeeType[x] ?? 0)}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      <section className={r.panel}>
        <p className={r.panelTitle}>Stage probabilities</p>
        <table className={ui.table}><tbody>{Object.entries(f.probabilities).map(([s, v]) => (
          <tr key={s}><td>{label(DEAL_STAGES, s)}</td><td className={ui.num}>{v.p}%</td><td>{v.source === "calibrated" ? `learned from ${v.n} closed deals` : `default (${v.n} of 10 closed deals needed)`}</td></tr>
        ))}</tbody></table>
      </section>
    </>
  );
}

export async function LearningTab({ scope, owner }: { scope: UserScope; owner: boolean }) {
  const rows = await appDb().select().from(proposals)
    .where(and(mandateCondition(scope, proposals.mandateId), eq(proposals.source, "learning"))).orderBy(desc(proposals.createdAt)).limit(40);
  return (
    <>
      <div className={ui.toolbar}>
        <p className={ui.sub} style={{ margin: 0, maxWidth: 720 }}>Monthly, on the 1st. Angle and timing proposals need 50 or more emails on an angle in a segment. Scoring weights need 20 or more won or lost deals. Nothing changes until an owner approves.</p>
        {owner && <form action={runLearningNowAction}><button className="btn" type="submit">Run the review now</button></form>}
      </div>
      {rows.length === 0 ? <p className={r.empty}>No proposals yet. There is not enough outcome data.</p> : rows.map(p => (
        <section key={p.id} className={r.panel}>
          <p className={r.panelTitle}><span>{p.title}</span><span className={ui.chip}>{p.kind} · {p.status}</span></p>
          {typeof (p.evidence as { rationale?: string } | null)?.rationale === "string" && <p className={ui.read}>{(p.evidence as { rationale: string }).rationale}</p>}
          <details><summary className={ui.sub}>Evidence and change</summary>
            <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify({ evidence: p.evidence, change: p.change.args }, null, 2)}</pre>
          </details>
          {p.status === "pending" && owner && (
            <div className={ui.rowActions} style={{ marginTop: 8 }}>
              <form action={confirmProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/reports?tab=learning" /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">{p.kind === "ladder" ? "Acknowledge" : "Approve and apply"}</button></form>
              <form action={rejectProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/reports?tab=learning" /><input name="reason" placeholder="Reason (optional)" aria-label="Reason" style={{ height: 26, border: "1px solid var(--line)", borderRadius: 999, padding: "0 10px", fontSize: 12 }} /><button className={ui.miniBtn} type="submit">Reject</button></form>
            </div>
          )}
          {p.decidedBy && <p className={ui.sub}>{p.status} by {p.decidedBy} on {p.decidedAt?.slice(0, 10)}{p.reason ? `: ${p.reason}` : ""}</p>}
        </section>
      ))}
    </>
  );
}

export async function CasesTab({ scope }: { scope: UserScope }) {
  const rows = await appDb().select({ c: caseRecords, deal: deals.name, stage: deals.stage }).from(caseRecords).innerJoin(deals, eq(deals.id, caseRecords.dealId))
    .where(and(mandateCondition(scope, caseRecords.mandateId), inArray(deals.stage, ["signed", "active", "expansion", "completed"]))).orderBy(desc(caseRecords.updatedAt));
  return (
    <>
      <p className={ui.notice}>Every won engagement gets a decision record. Records stay private. Project names, counterparties, values and mandate status are used as proof only where disclosure is authorized (the site&apos;s rule).</p>
      {rows.length === 0 ? <p className={r.empty}>No won deals yet.</p> : rows.map(({ c, deal, stage }) => (
        <form key={c.id} action={saveCaseAction} className={r.panel}>
          <input type="hidden" name="id" value={c.id} />
          <p className={r.panelTitle}><span>{deal}</span><span className={ui.chip}>{label(DEAL_STAGES, stage)}{c.disclosureAuthorized ? " · disclosure authorized" : " · private"}</span></p>
          <div className={r.form}>
            <textarea name="decision" defaultValue={c.decision} placeholder="The decision the client held, and what Regenera did" aria-label="Decision" style={{ minHeight: 60 }} />
            <textarea name="outcome" defaultValue={c.outcome} placeholder="Outcome" aria-label="Outcome" style={{ minHeight: 60, marginTop: 6 }} />
            <textarea name="evidence" defaultValue={c.evidence} placeholder="Evidence (documents, dates)" aria-label="Evidence" style={{ minHeight: 50, marginTop: 6 }} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontWeight: 500 }}><input type="checkbox" name="disclosure" defaultChecked={c.disclosureAuthorized} style={{ width: "auto" }} /> Client has authorized disclosure</label>
            <button className={ui.miniBtn} type="submit" style={{ marginTop: 8 }}>Save</button>
          </div>
        </form>
      ))}
    </>
  );
}
