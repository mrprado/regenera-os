import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Notice, withParams } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { contractAlerts } from "@/lib/contracts/engine";
import { CONTRACT_KIND_LABEL, CONTRACT_STATUS_LABEL, money } from "@/lib/contracts/labels";
import { contractSources, listContracts } from "@/lib/contracts/queries";
import { appDb } from "@/lib/db/scoped";
import { createContractAction } from "../contract-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contracts" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/contracts");
  const sp = await searchParams;
  const [rows, sources, alerts] = await Promise.all([
    listContracts(user.scope, { status: sp.status, kind: sp.kind }),
    contractSources(user.scope),
    contractAlerts(appDb(), user.scope.mandateIds),
  ]);
  const alertCount = alerts.awaitingSignature.length + alerts.renewals.length + alerts.milestonesDue.length;

  return (
    <>
      <PageHeader title="Contracts" count={rows.length} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Templates are starting points, not legal advice. Have counsel review each contract before it is sent. Success fees, equity and capital work are blocked from sending until counsel review is recorded. Payments are tracked here only; nothing is charged or collected.</p>

      <div className={r.grid}>
        <div>
          <nav className={ui.tabs} aria-label="Contract status">
            {[["", "All"], ["draft", "Drafts"], ["sent", "Awaiting signature"], ["signed", "Signed"], ["completed", "Completed"], ["terminated", "Terminated"]].map(([k, label]) => (
              <Link key={k} className={`${ui.tab} ${(sp.status ?? "") === k ? ui.tabActive : ""}`} href={withParams("/contracts", sp, { status: k || undefined, notice: undefined })}>{label}</Link>
            ))}
          </nav>
          {rows.length === 0 ? (
            <EmptyState icon={FileSignature} title="No contracts yet" body="Draft an engagement letter, statement of work or NDA from a deal, or a referral agreement from a partner. The template fills in the parties, scope and fees." />
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>Contract</th><th>Status</th><th>Value</th><th>Signed</th><th>Ends</th></tr></thead>
                <tbody>{rows.map(({ c, orgName, dealName }) => (
                  <tr key={c.id}>
                    <td><Link className={ui.primary} href={`/contracts/${c.id}`}>{c.title}</Link>
                      <span className={ui.sub}>{CONTRACT_KIND_LABEL[c.kind]}{orgName ? ` · ${orgName}` : ""}{dealName ? ` · ${dealName}` : ""} · v{c.version}</span></td>
                    <td><span className={c.status === "signed" ? ui.chip : ui.chipMuted}>{CONTRACT_STATUS_LABEL[c.status]}</span>
                      {c.counselRequired && !c.counselReviewedAt && <span className={ui.sub} style={{ color: "#b0432f" }}>Counsel review needed</span>}</td>
                    <td>{money(c.value, c.terms.currency)}</td>
                    <td>{c.signedAt ?? "—"}</td>
                    <td>{c.endDate ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>New contract</p>
            <form action={createContractAction} className={r.form}>
              <label>Type
                <select name="kind" defaultValue="engagement_letter">
                  {Object.entries(CONTRACT_KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <label>From
                <select name="source" required defaultValue="">
                  <option value="" disabled>Choose a deal or partner</option>
                  <optgroup label="Deals">{sources.deals.map(d => <option key={d.id} value={`deal:${d.id}`}>{d.name}</option>)}</optgroup>
                  <optgroup label="Partners (referral agreement)">{sources.partners.map(p => <option key={p.id} value={`partner:${p.id}`}>{p.name} ({p.tier})</option>)}</optgroup>
                </select>
              </label>
              <button className="btn btn--primary" type="submit">Draft from template</button>
            </form>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Needs attention{alertCount ? ` (${alertCount})` : ""}</p>
            {alertCount === 0 ? <p className={r.empty}>Nothing waiting: no signatures over 7 days, no renewal notices within 45 days, no payments due this week.</p> : (
              <ul className={r.timeline}>
                {alerts.awaitingSignature.map(a => <li key={a.id}><span className={r.when}>{a.days} days</span><span>Unsigned: <Link href={`/contracts/${a.id}`}>{a.title}</Link></span></li>)}
                {alerts.renewals.map(a => <li key={a.id}><span className={r.when}>{a.noticeBy}</span><span>{a.autoRenew ? "Renews" : "Ends"} {a.endDate}: <Link href={`/contracts/${a.id}`}>{a.title}</Link> (notice by {a.noticeBy})</span></li>)}
                {alerts.milestonesDue.map(m => <li key={m.id}><span className={r.when} style={{ color: m.overdue ? "#b0432f" : undefined }}>{m.dueDate}</span><span>{m.title}, {money(m.amount, m.currency)}: <Link href={`/contracts/${m.contractId}`}>{m.contractTitle}</Link></span></li>)}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
