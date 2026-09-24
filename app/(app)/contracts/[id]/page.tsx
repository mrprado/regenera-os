import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import MarkdownLite from "@/components/markdown-lite";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { sendBlockers } from "@/lib/contracts/engine";
import { CONTRACT_KIND_LABEL, CONTRACT_STATUS_LABEL, MILESTONE_STATUS_LABEL, money } from "@/lib/contracts/labels";
import { getContract } from "@/lib/contracts/queries";
import { isOwner } from "@/lib/db/scoped";
import { DEAL_STAGES } from "@/lib/vocab";
import {
  addMilestoneAction, closeContractAction, counselReviewAction, markSentAction, markSignedAction, milestoneStatusAction, regenerateContractAction, saveContractAction, scheduleRetainerAction,
} from "../../contract-actions";
import styles from "../contracts.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract" };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/contracts");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getContract(user.scope, id);
  if (!data) notFound();
  const { c, orgName, dealName, dealStage, versions, milestones } = data;
  const t = c.terms;
  const draft = c.status === "draft";
  const blockers = draft ? sendBlockers(c) : null;
  const today = new Date().toISOString().slice(0, 10);
  const paid = milestones.filter(m => m.status === "paid").reduce((s, m) => s + (m.amount ?? 0), 0);
  const open = milestones.filter(m => m.status === "pending" || m.status === "invoiced").reduce((s, m) => s + (m.amount ?? 0), 0);

  return (
    <>
      <PageHeader title={c.title} actions={<>
        <Link className="btn" href={`/contracts/${c.id}/print`}>Print or save as PDF</Link>
        <Link className="btn" href="/contracts">All contracts</Link>
      </>} />
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>{CONTRACT_KIND_LABEL[c.kind]} · version {c.version}</span><span className={ui.chip}>{CONTRACT_STATUS_LABEL[c.status]}</span></p>
            {c.counselRequired && (
              <p className={ui.notice} style={{ marginBottom: 8 }}>
                {c.counselReviewedAt ? `Counsel review recorded ${c.counselReviewedAt.slice(0, 10)} by ${c.counselReviewedBy}.` : "Counsel review is required before this can be sent or signed (success fee, equity, capital work or an investment mandate)."}
              </p>
            )}
            <div className={ui.rowActions}>
              {draft && <form action={markSentAction}><input type="hidden" name="id" value={c.id} /><button className="btn btn--primary" type="submit" disabled={!!blockers}>Mark sent</button></form>}
              {c.counselRequired && !c.counselReviewedAt && isOwner(user.scope) && (
                <form action={counselReviewAction}><input type="hidden" name="id" value={c.id} /><button className="btn" type="submit">Record counsel review</button></form>
              )}
              {draft && <form action={regenerateContractAction}><input type="hidden" name="id" value={c.id} /><button className="btn" type="submit">Rebuild text from terms</button></form>}
              {c.status === "signed" && <>
                <form action={closeContractAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value="completed" /><button className="btn" type="submit">Mark completed</button></form>
                <form action={closeContractAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value="terminated" /><button className="btn" type="submit">Mark terminated</button></form>
              </>}
            </div>
            {blockers && <ul className={styles.blockers}>{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
            {(c.status === "draft" || c.status === "sent") && (
              <form action={markSignedAction} className={styles.inline}>
                <input type="hidden" name="id" value={c.id} />
                <label>Signed on <input type="date" name="signedAt" required defaultValue={today} /></label>
                <label>Effective <input type="date" name="effectiveDate" /></label>
                <input name="signedCopyUrl" placeholder="Link to signed copy (Drive, e-sign)" aria-label="Link to signed copy" style={{ minWidth: 220 }} />
                <button className={ui.miniBtn} type="submit">Record signature</button>
              </form>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>{draft ? "Edit" : "Contract text"}</p>
            {draft ? (
              <form action={saveContractAction}>
                <input type="hidden" name="id" value={c.id} />
                <div className={styles.fields}>
                  <label className={styles.wide}>Title<input name="title" defaultValue={c.title} /></label>
                  <label>Counterparty<input name="cpName" defaultValue={t.counterparty.name} /></label>
                  <label>Address<input name="cpAddress" defaultValue={t.counterparty.address} /></label>
                  <label>Their signatory<input name="cpSignatory" defaultValue={t.counterparty.signatoryName} /></label>
                  <label>Their title<input name="cpTitle" defaultValue={t.counterparty.signatoryTitle} /></label>
                  <label>Their email<input name="cpEmail" type="email" defaultValue={t.counterparty.signatoryEmail} /></label>
                  <label>Governing law<input name="governingLaw" defaultValue={t.governingLaw} /></label>
                  <label>Regenera signatory<input name="rgSignatory" defaultValue={t.regenera.signatoryName} /></label>
                  <label>Regenera title<input name="rgTitle" defaultValue={t.regenera.signatoryTitle} /></label>
                  <label className={styles.wide}>Fee terms<input name="feeSummary" defaultValue={t.feeSummary} /></label>
                  <label>Currency<input name="currency" defaultValue={t.currency} maxLength={8} /></label>
                  <label>Total value<input name="value" inputMode="decimal" defaultValue={c.value ?? ""} /></label>
                  <label>Payment days<input name="paymentDays" inputMode="numeric" defaultValue={t.paymentDays} /></label>
                  <label>Term, months (blank = until done)<input name="termMonths" inputMode="numeric" defaultValue={t.termMonths ?? ""} /></label>
                  <label>Notice days<input name="noticeDays" inputMode="numeric" defaultValue={t.noticeDays} /></label>
                  <label style={{ alignContent: "end" }}><span><input type="checkbox" name="autoRenew" defaultChecked={t.autoRenew} /> Renews automatically</span></label>
                </div>
                <textarea name="body" className={styles.editor} defaultValue={c.body} aria-label="Contract text (Markdown)" />
                <div className={styles.inline}>
                  <input name="note" placeholder="What changed (for the history)" aria-label="Change note" style={{ minWidth: 260 }} />
                  <button className="btn btn--primary" type="submit">Save</button>
                </div>
                <p className={ui.sub}>Saving changes to the text or terms creates a new version. Terms fill the text only when you use Rebuild text from terms.</p>
              </form>
            ) : (
              <>
                <MarkdownLite text={c.body} className={styles.doc} />
                <form action={saveContractAction} className={styles.inline}>
                  <input type="hidden" name="id" value={c.id} />
                  <input name="signedCopyUrl" defaultValue={c.signedCopyUrl ?? ""} placeholder="Link to signed copy" aria-label="Link to signed copy" style={{ minWidth: 260 }} />
                  <input name="value" defaultValue={c.value ?? ""} placeholder="Value" aria-label="Total value" style={{ width: 110 }} />
                  <button className={ui.miniBtn} type="submit">Save</button>
                </form>
                <p className={ui.sub}>Sent and signed contracts are not edited: draft an amendment from the deal instead.</p>
              </>
            )}
          </section>
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>At a glance</p>
            <dl className={r.kv}>
              <dt>Counterparty</dt><dd>{t.counterparty.name}{orgName && orgName !== t.counterparty.name ? ` (${orgName})` : ""}</dd>
              {c.dealId && <><dt>Deal</dt><dd><Link href="/deals?view=table">{dealName}</Link>{dealStage ? ` · ${DEAL_STAGES[dealStage as keyof typeof DEAL_STAGES]}` : ""}</dd></>}
              <dt>Value</dt><dd>{money(c.value, t.currency)}</dd>
              <dt>Fees</dt><dd>{t.feeSummary}</dd>
              <dt>Term</dt><dd>{t.termMonths ? `${t.termMonths} months${t.autoRenew ? ", renews" : ""}` : "Until scope is complete"} · {`${t.noticeDays} days' notice`}</dd>
              <dt>Sent</dt><dd>{c.sentAt?.slice(0, 10) ?? "—"}</dd>
              <dt>Signed</dt><dd>{c.signedAt ?? "—"}</dd>
              <dt>Effective</dt><dd>{c.effectiveDate ?? "—"}</dd>
              <dt>Ends</dt><dd>{c.endDate ?? "—"}</dd>
              {c.signedCopyUrl && <><dt>Signed copy</dt><dd><a href={c.signedCopyUrl} target="_blank" rel="noreferrer">Open</a></dd></>}
            </dl>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Payment milestones</p>
            {milestones.length === 0 ? <p className={r.empty}>No milestones yet. Add them by hand, or schedule a monthly retainer once the contract is signed.</p> : (
              <>
                <table className={ui.table}><tbody>{milestones.map(m => (
                  <tr key={m.id}>
                    <td>{m.title}<span className={ui.sub} style={{ color: m.dueDate && m.dueDate < today && (m.status === "pending" || m.status === "invoiced") ? "#b0432f" : undefined }}>{m.dueDate ?? "no date"} · {money(m.amount, m.currency)}</span></td>
                    <td>
                      <form action={milestoneStatusAction} style={{ display: "flex", gap: 4 }}>
                        <input type="hidden" name="id" value={m.id} />
                        <select name="status" defaultValue={m.status} aria-label="Milestone status">
                          {Object.entries(MILESTONE_STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                        <button className={ui.miniBtn} type="submit">Set</button>
                      </form>
                    </td>
                  </tr>
                ))}</tbody></table>
                <p className={ui.sub}>Paid {money(paid, t.currency)} · outstanding {money(open, t.currency)}</p>
              </>
            )}
            <form action={addMilestoneAction} className={styles.inline}>
              <input type="hidden" name="id" value={c.id} />
              <input name="title" required placeholder="Milestone" aria-label="Milestone" style={{ width: 130 }} />
              <input name="dueDate" type="date" aria-label="Due date" />
              <input name="amount" inputMode="decimal" placeholder="Amount" aria-label="Amount" style={{ width: 80 }} />
              <button className={ui.miniBtn} type="submit">Add</button>
            </form>
            {c.effectiveDate && c.terms.termMonths && milestones.length === 0 && (
              <form action={scheduleRetainerAction} className={styles.inline}>
                <input type="hidden" name="id" value={c.id} />
                <input name="monthly" required inputMode="decimal" placeholder="Monthly amount" aria-label="Monthly amount" style={{ width: 130 }} />
                <button className={ui.miniBtn} type="submit">Schedule {c.terms.termMonths} monthly payments</button>
              </form>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>History</p>
            <ul className={r.timeline}>{versions.map(v => (
              <li key={v.version}><span className={r.when}>v{v.version}</span><span>{v.note || "Edited"}<span className={ui.sub}>{v.createdAt.slice(0, 16).replace("T", " ")} · {v.createdBy}</span></span></li>
            ))}</ul>
          </section>
        </aside>
      </div>
    </>
  );
}
