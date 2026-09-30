import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contracts, engagements, expenses, invoices, organizations, projects, services, timeEntries } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { withBase } from "@/lib/base-path";
import { derivedInvoiceStatus, engagementEconomics, priceService } from "@/lib/commercial/engine";
import { BILLING_TYPES, CHANGE_REASONS, CONFLICT_STATES, DELIVERABLE_STATUSES, DEPTHS, ENGAGEMENT_STATUSES, EXPENSE_CATEGORIES, EXPENSE_CLASSES, INVOICE_STATUSES } from "@/lib/commercial/vocab";
import { approveEngagementAction, changeOrderAction, conflictCheckAction, conflictDecisionAction, deliverableAction, expenseAction, invoiceAction, partnerLineAction, statusAction, timeAction, updateEngagementAction } from "../../../commercial-actions";
import { createContractAction } from "../../../contract-actions";
import styles from "../../commercial.module.css";
import Lifecycle from "./lifecycle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Engagement" };

const money = (n: number | null | undefined, cur: string) => (n === null || n === undefined ? "—" : `${cur} ${Math.round(n).toLocaleString("en-US")}`);

export default async function EngagementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/commercial/engagements/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [e] = await db.select().from(engagements).where(and(eq(engagements.id, id), mandateCondition(user.scope, engagements.mandateId)));
  if (!e) notFound();
  const [invs, exps, time, svc] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.engagementId, id)).orderBy(asc(invoices.dueDate)),
    db.select().from(expenses).where(eq(expenses.engagementId, id)).orderBy(asc(expenses.date)),
    db.select().from(timeEntries).where(eq(timeEntries.engagementId, id)).orderBy(asc(timeEntries.date)),
    e.workstreams.length ? db.select().from(services).where(and(eq(services.mandateId, e.mandateId), inArray(services.key, e.workstreams))) : Promise.resolve([]),
  ]);
  const [org] = e.orgId ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, e.orgId)) : [];
  const [project] = e.projectId ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, e.projectId)) : [];
  const [contract] = e.contractId ? await db.select({ id: contracts.id, title: contracts.title, lifecycle: contracts.lifecycle }).from(contracts).where(eq(contracts.id, e.contractId)) : [];
  const econ = engagementEconomics(e, invs, exps, time);
  const today = new Date().toISOString().slice(0, 10);
  const owner = isOwner(user.scope, e.mandateId);
  const oneOff = svc.filter(s => !s.perMonth);
  const quote = oneOff.length ? oneOff.map(s => priceService(s, { complexity: "standard", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: e.hourlyCost })) : [];
  const quoteTotal = quote.reduce((a, q) => a + q.suggested, 0);
  const minTotal = quote.reduce((a, q) => a + q.minimum, 0);
  const next = svc.flatMap(s => s.nextServices).filter(k => !e.workstreams.includes(k));

  return (
    <>
      <PageHeader title={e.name} actions={<><a className="btn" href={withBase(`/api/commercial/proposal?engagement=${e.id}`)} download>Proposal (PDF)</a><Link className="btn" href="/commercial?tab=engagements">All engagements</Link></>} />
      <Notice text={sp.notice} />
      <p className={ui.sub}><span className={ui.chip}>{ENGAGEMENT_STATUSES[e.status]}</span> {org ? <Link href={`/companies/${org.id}`}>{org.name}</Link> : "No client linked"}{project ? <> · <Link href={`/projects/${project.id}`}>{project.name}</Link></> : null} · {BILLING_TYPES[e.billingType]} · conflict check: {CONFLICT_STATES[e.conflictStatus]}{e.approvalRequired ? ` · approval ${e.approvedBy ? `by ${e.approvedBy}` : "REQUIRED"}` : ""}</p>

      <div className={styles.strip}>
        {[["Contract value", money(econ.contractValue, e.currency)], ["Invoiced", money(econ.invoiced, e.currency)], ["Collected", money(econ.collected, e.currency)], ["Outstanding", money(econ.outstanding, e.currency)], ["To invoice", money(econ.toInvoice, e.currency)], ["Hours (vs plan)", `${econ.hours}${econ.hoursVsPlanPct !== null ? ` (${econ.hoursVsPlanPct}%)` : ""}`], ["Gross margin", econ.marginPct === null ? "—" : `${econ.marginPct}%${econ.internalCostKnown ? "" : " (no time cost)"}`]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </div>

      <Lifecycle e={e} scope={user.scope} />

      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Scope, fees and terms</p>
            <form action={updateEngagementAction} className={r.form}>
              <input type="hidden" name="id" value={e.id} />
              <label>Name<input name="name" defaultValue={e.name} required /></label>
              <label>Scope<textarea name="scope" defaultValue={e.scope} rows={4} /></label>
              <div className={r.formRow}><label>Assumptions<textarea name="assumptions" defaultValue={e.assumptions} rows={2} /></label><label>Exclusions<textarea name="exclusions" defaultValue={e.exclusions} rows={2} /></label></div>
              <label>Client responsibilities<textarea name="clientResponsibilities" defaultValue={e.clientResponsibilities} rows={2} /></label>
              <div className={r.formRow}>
                <label>Fixed fee<input name="fee" defaultValue={e.fee} inputMode="decimal" /></label>
                <label>Monthly fee<input name="monthlyFee" defaultValue={e.monthlyFee} inputMode="decimal" /></label>
                <label>Months<input name="months" defaultValue={e.months} inputMode="numeric" /></label>
                <label>Currency<input name="currency" defaultValue={e.currency} /></label>
              </div>
              <div className={r.formRow}>
                <label>Billing<select name="billingType" defaultValue={e.billingType}>{Object.entries(BILLING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Payment terms<input name="paymentTerms" defaultValue={e.paymentTerms} /></label>
                <label>Internal cost / hour<input name="hourlyCost" defaultValue={e.hourlyCost ?? ""} placeholder="for margin" /></label>
                <label>Probability % (override)<input name="probabilityPct" defaultValue={e.probabilityPct ?? ""} placeholder={`stage default`} /></label>
              </div>
              <div className={r.formRow}>
                <label>Expected hours<input name="expectedHours" defaultValue={e.expectedHours} /></label>
                <label>Start<input name="startDate" type="date" defaultValue={e.startDate ?? ""} /></label>
                <label>End<input name="endDate" type="date" defaultValue={e.endDate ?? ""} /></label>
                <label>Owner<input name="owner" defaultValue={e.owner ?? ""} /></label>
              </div>
              <button className="btn btn--primary" type="submit">Save</button>
            </form>
            {quote.length > 0 && <p className={ui.sub}>Pricing check (one-off services, standard complexity{e.hourlyCost ? `, ${e.currency} ${e.hourlyCost}/h` : ", no time cost"}): suggested {money(quoteTotal, e.currency)}, minimum {money(minTotal, e.currency)}. {e.fee < minTotal ? <b style={{ color: "#b0432f" }}>Fee is below the minimum: LOW MARGIN.</b> : null} Override is allowed; the pricing policy lives in Services &amp; pricing.</p>}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Deliverables</p>
            <table className={ui.table}><thead><tr><th>Deliverable</th><th>Status</th><th>Due</th><th /></tr></thead><tbody>
              {e.deliverables.map(d => <tr key={d.id}><td>{d.label}{d.serviceKey ? <span className={ui.sub}>{svc.find(s => s.key === d.serviceKey)?.name}</span> : null}</td>
                <td colSpan={3}><form action={deliverableAction} className={styles.inline}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="deliverableId" value={d.id} />
                  <select name="status" defaultValue={d.status}>{Object.entries(DELIVERABLE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <input type="date" name="due" defaultValue={d.due ?? ""} style={{ color: d.due && d.due < today && !["delivered", "accepted"].includes(d.status) ? "#b0432f" : undefined }} />
                  <button className={ui.miniBtn} type="submit">Update</button></form></td></tr>)}
            </tbody></table>
            <form action={deliverableAction} className={styles.inline}><input type="hidden" name="id" value={e.id} /><input name="label" placeholder="Add deliverable" required /><input type="date" name="due" /><button className={ui.miniBtn} type="submit">Add</button></form>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Payment schedule and invoices</p>
            <table className={ui.table}><thead><tr><th>Line</th><th>Amount</th><th>Invoice</th></tr></thead><tbody>
              {e.paymentSchedule.map(l => { const inv = invs.find(i => i.id === l.invoiceId); return <tr key={l.id}><td>{l.label}</td><td className={ui.num}>{money(l.amount, e.currency)}</td><td>{inv ? `${inv.number} · ${INVOICE_STATUSES[derivedInvoiceStatus(inv, today) as keyof typeof INVOICE_STATUSES]}` : <form action={invoiceAction} className={styles.inline}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="create" /><input type="hidden" name="lineId" value={l.id} /><input type="date" name="issueDate" defaultValue={today} aria-label="Issue date" /><input className={styles.amt} name="termsDays" defaultValue={30} aria-label="Terms (days)" /><button className={ui.miniBtn} type="submit">Draft invoice</button></form>}</td></tr>; })}
            </tbody></table>
            {invs.length > 0 && <table className={ui.table}><thead><tr><th>Invoice</th><th>Amount</th><th>Paid</th><th>Due</th><th>Status</th><th /></tr></thead><tbody>
              {invs.map(i => { const st = derivedInvoiceStatus(i, today); return <tr key={i.id}><td>{i.number}<span className={ui.sub}>{i.milestone}</span></td><td className={ui.num}>{money(i.amount, i.currency)}</td><td className={ui.num}>{money(i.paidAmount, i.currency)}</td><td style={{ color: st === "overdue" ? "#b0432f" : undefined }}>{i.dueDate}</td><td><span className={ui.chip}>{INVOICE_STATUSES[st as keyof typeof INVOICE_STATUSES]}</span></td>
                <td><div className={styles.inline}>
                  {i.status === "draft" && <form action={invoiceAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="send" /><input type="hidden" name="invoiceId" value={i.id} /><button className={ui.miniBtn} type="submit">Mark sent</button></form>}
                  {!["draft", "void", "paid"].includes(st) && <form action={invoiceAction} className={styles.inline}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="pay" /><input type="hidden" name="invoiceId" value={i.id} /><input className={styles.amt} name="amount" defaultValue={i.amount - i.paidAmount} aria-label="Amount received" /><input type="date" name="paidAt" defaultValue={today} aria-label="Date received" /><button className={ui.miniBtn} type="submit">Record payment</button></form>}
                  {st !== "paid" && i.status !== "void" && <form action={invoiceAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="void" /><input type="hidden" name="invoiceId" value={i.id} /><button className={ui.miniBtn} type="submit">Void</button></form>}
                </div></td></tr>; })}
            </tbody></table>}
            <p className={ui.sub}>Invoices are records here; send and collect through your billing or accounting system (Stripe / QuickBooks / Xero adapters: NOT CONNECTED).</p>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Costs: partners, expenses and time (internal)</p>
            {e.partners.length > 0 && <table className={ui.table}><tbody>{e.partners.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.role}</td><td className={ui.num}>{money(p.cost, e.currency)}</td><td>{p.share}</td></tr>)}</tbody></table>}
            <form action={partnerLineAction} className={styles.inline}><input type="hidden" name="id" value={e.id} /><input name="name" placeholder="Partner / subconsultant" required /><input name="role" placeholder="Role" /><input className={styles.amt} name="cost" placeholder="Cost" /><input name="share" placeholder="Share (e.g. 70/30)" /><button className={ui.miniBtn} type="submit">Add partner cost</button></form>
            {exps.length > 0 && <table className={ui.table}><tbody>{exps.map(x => <tr key={x.id}><td>{x.date}</td><td>{EXPENSE_CATEGORIES[x.category]}</td><td>{EXPENSE_CLASSES[x.classification]}</td><td className={ui.num}>{money(x.amount, x.currency)}</td><td className={ui.sub}>{x.vendor} {x.note}</td></tr>)}</tbody></table>}
            <form action={expenseAction} className={styles.inline}><input type="hidden" name="id" value={e.id} />
              <select name="category" defaultValue="travel">{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="classification" defaultValue="reimbursable">{Object.entries(EXPENSE_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className={styles.amt} name="amount" placeholder="Amount" required /><input type="date" name="date" defaultValue={today} /><input name="vendor" placeholder="Vendor" /><input name="receiptUrl" placeholder="Receipt link" /><button className={ui.miniBtn} type="submit">Add expense</button></form>
            <p className={ui.sub}>Time logged: {econ.hours} h{e.expectedHours ? ` of ${e.expectedHours} planned` : ""}. Internal only, never shown in portals.</p>
            <form action={timeAction} className={styles.inline}><input type="hidden" name="id" value={e.id} /><input name="person" placeholder="Person" /><input name="workstream" placeholder="Workstream" /><input className={styles.amt} name="hours" placeholder="Hours" required /><input type="date" name="date" defaultValue={today} /><button className={ui.miniBtn} type="submit">Log time</button></form>
          </section>
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Status</p>
            <form action={statusAction} className={styles.inline}><input type="hidden" name="id" value={e.id} />
              <select name="status" defaultValue={e.status}>{Object.entries(ENGAGEMENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input name="lostReason" placeholder="Reason (if lost)" /><button className={ui.miniBtn} type="submit">Set</button></form>
            <p className={ui.sub}>Contracting and activation need a cleared conflict check{e.approvalRequired ? " and internal approval" : ""}.</p>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Conflict check and approval</p>
            <p className={ui.sub}>{CONFLICT_STATES[e.conflictStatus]}{e.conflictNote ? `: ${e.conflictNote}` : ""}</p>
            <form action={conflictCheckAction}><input type="hidden" name="id" value={e.id} /><button className={ui.miniBtn} type="submit">Run conflict check</button></form>
            {owner && e.conflictStatus !== "clear" && e.conflictStatus !== "unchecked" && <form action={conflictDecisionAction} className={r.form}><input type="hidden" name="id" value={e.id} /><label>Decision (owner)<textarea name="conflictNote" rows={2} required minLength={5} /></label>{e.conflictStatus === "conflict" && <label className={ui.sub}><input type="checkbox" name="clear" /> Downgrade to review after mitigation (e.g. waiver, ethical wall)</label>}<button className={ui.miniBtn} type="submit">Record decision</button></form>}
            {e.approvalRequired && !e.approvedBy && owner && <form action={approveEngagementAction}><input type="hidden" name="id" value={e.id} /><button className={ui.miniBtn} type="submit">Approve engagement (owner)</button></form>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Contract</p>
            {contract ? <p><Link href={`/contracts/${contract.id}`}>{contract.title}</Link> · {contract.lifecycle.replace(/_/g, " ")}</p> : <>
              <p className={ui.sub}>No contract linked. Recurring clients: MSA + SOW. Templates are counsel starting points.</p>
              {e.dealId && <form action={createContractAction}><input type="hidden" name="kind" value="engagement_letter" /><input type="hidden" name="source" value={`deal:${e.dealId}`} /><button className={ui.miniBtn} type="submit">Draft engagement letter</button></form>}
              <p className={ui.sub}><Link href="/documents/generator">Generate SOW / NDA / engagement letter</Link></p>
            </>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Change orders</p>
            {e.changeOrders.map(c => <div key={c.id} className={ui.sub}>{CHANGE_REASONS[c.reason as keyof typeof CHANGE_REASONS] ?? c.reason}: {c.description} · {money(c.fee, e.currency)} · {c.weeks} wks · <b>{c.status}</b>
              {c.status === "proposed" && owner && <span className={styles.inline}>{(["approved", "rejected"] as const).map(d => <form key={d} action={changeOrderAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="coId" value={c.id} /><input type="hidden" name="decision" value={d} /><button className={ui.miniBtn} type="submit">{d === "approved" ? "Approve" : "Reject"}</button></form>)}</span>}</div>)}
            <form action={changeOrderAction} className={r.form}><input type="hidden" name="id" value={e.id} />
              <label>Reason<select name="reason" defaultValue="scope">{Object.entries(CHANGE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Description<input name="description" required /></label>
              <div className={r.formRow}><label>Additional fee<input name="fee" inputMode="decimal" /></label><label>Timeline impact (weeks)<input name="weeks" inputMode="numeric" /></label></div>
              <button className={ui.miniBtn} type="submit">Propose change order</button></form>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Services and next step</p>
            <ul className={ui.sub}>{svc.map(s => <li key={s.id}>{s.name}{s.depth !== "standard" ? ` · ${DEPTHS[s.depth]}` : ""} · role {s.role.replace(/_/g, " ")}{s.specialistRequired.length ? ` · SPECIALIST REQUIRED: ${s.specialistRequired.join(", ")}` : ""}</li>)}</ul>
            {next.length > 0 && <p className={ui.sub}>Logical next service (internal): {[...new Set(next)].slice(0, 3).join(", ").replace(/_/g, " ")}.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
