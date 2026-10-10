import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { deals, deliveryTemplates, offerProposals, organizations, services } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { sendBlockers, versions, versionTotal } from "@/lib/lifecycle/proposals";
import { FEE_STRUCTURES, PROPOSAL_STATUS, PROPOSAL_VERSION_STATUS } from "@/lib/lifecycle/vocab";
import { decideProposalAction, recordAgreementAction, saveProposalAction, sendProposalAction } from "../../../lifecycle-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal" };
const money = (n: number | null, c: string) => (n == null ? "Not set" : `${c} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** A commercial proposal (phase 29A): versions, the editable draft, send, the client's decision and the agreement. */
export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/commercial/proposals/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [p] = await db.select().from(offerProposals).where(and(eq(offerProposals.id, id), mandateCondition(user.scope, offerProposals.mandateId)));
  if (!p) notFound();
  const [vs, [deal], [org], svc, templates] = await Promise.all([
    versions(db, id),
    db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.id, p.dealId)),
    p.orgId ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId)) : Promise.resolve([]),
    db.select({ id: services.id, name: services.name, offerStatus: services.offerStatus }).from(services).where(eq(services.mandateId, p.mandateId)),
    db.select().from(deliveryTemplates).where(eq(deliveryTemplates.mandateId, p.mandateId)),
  ]);
  const latest = vs[0];
  const draft = latest?.status === "draft" ? latest : null;
  const sent = vs.find(v => v.status === "sent");
  const accepted = vs.find(v => v.id === p.acceptedVersionId);
  const blockers = draft ? await sendBlockers(db, draft) : [];
  const show = draft ?? latest;
  const svcName = new Map(svc.map(s => [s.id, `${s.name}${s.offerStatus === "draft" ? " (draft offer)" : ""}`]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={p.title} actions={<>{deal && <Link className="btn" href={`/deals/${deal.id}#commercial`}>Opportunity</Link>}{p.engagementId && <Link className="btn btn--primary" href={`/commercial/engagements/${p.engagementId}`}>Engagement</Link>}</>} />
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          {draft ? (
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Version {draft.version} (draft)</span><span className={ui.chip}>editable</span></p>
              <form action={saveProposalAction} className={r.form}>
                <input type="hidden" name="proposalId" value={p.id} />
                <label>Summary<textarea name="summary" defaultValue={draft.summary} rows={2} /></label>
                <label>Scope<textarea name="scope" defaultValue={draft.scope} rows={5} required /></label>
                <label>Deliverables (one per line)<textarea name="deliverables" defaultValue={draft.deliverables.map(d => d.label).join("\n")} rows={4} /></label>
                <label>Assumptions<textarea name="assumptions" defaultValue={draft.assumptions} rows={3} /></label>
                <label>Exclusions<textarea name="exclusions" defaultValue={draft.exclusions} rows={3} /></label>
                <label>Client responsibilities<textarea name="responsibilities" defaultValue={draft.responsibilities} rows={3} /></label>
                <label>Timeline<input name="timeline" defaultValue={draft.timeline} /></label>
                <label>Fee structure<select name="feeStructure" defaultValue={draft.feeStructure}>{Object.entries(FEE_STRUCTURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Currency<input name="currency" defaultValue={draft.currency} maxLength={3} /></label>
                <label>Fee (fixed, or one-off part)<input name="fee" inputMode="decimal" defaultValue={draft.fee ?? ""} /></label>
                <label>Monthly fee (retainer)<input name="monthlyFee" inputMode="decimal" defaultValue={draft.monthlyFee ?? ""} /></label>
                <label>Months<input name="months" inputMode="numeric" defaultValue={draft.months ?? ""} /></label>
                <label>Hourly rate<input name="hourlyRate" inputMode="decimal" defaultValue={draft.hourlyRate ?? ""} /></label>
                <label>Estimated hours<input name="estimatedHours" inputMode="decimal" defaultValue={draft.estimatedHours ?? ""} /></label>
                <label>Payment schedule (label | amount | when, one per line)<textarea name="paymentSchedule" defaultValue={draft.paymentSchedule.map(x => `${x.label} | ${x.amount} | ${x.trigger}`).join("\n")} rows={3} /></label>
                <label>Valid until<input name="validUntil" type="date" defaultValue={draft.validUntil ?? ""} /></label>
                <label>Delivery template<select name="templateId" defaultValue={draft.templateId ?? ""}><option value="">None</option>{templates.filter(t => t.status !== "retired").map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}{t.status === "draft" ? " (draft)" : ""}</option>)}</select></label>
                <button className="btn" type="submit">Save draft</button>
              </form>
              <p className={ui.sub} style={{ marginTop: 10 }}>Total: {money(versionTotal(draft), draft.currency)} · Services: {draft.serviceIds.map(s => svcName.get(s) ?? "removed").join(", ") || "none"}</p>
              {blockers.length ? <p className={ui.notice} role="status">Before sending: {blockers.join(" ")}</p> : (
                <form action={sendProposalAction}><input type="hidden" name="proposalId" value={p.id} /><button className="btn btn--primary" type="submit">Record as sent</button><span className={ui.sub}> Freezes this version. Send the document from your mailbox or an approved message; the OS does not email it.</span></form>
              )}
            </section>
          ) : show && (
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Version {show.version}</span><span className={ui.chip}>{PROPOSAL_VERSION_STATUS[show.status]}</span></p>
              <dl className={r.kv}>
                <dt>Scope</dt><dd style={{ whiteSpace: "pre-wrap" }}>{show.scope}</dd>
                <dt>Deliverables</dt><dd>{show.deliverables.map(d => d.label).join("; ")}</dd>
                {show.assumptions && <><dt>Assumptions</dt><dd style={{ whiteSpace: "pre-wrap" }}>{show.assumptions}</dd></>}
                {show.exclusions && <><dt>Exclusions</dt><dd style={{ whiteSpace: "pre-wrap" }}>{show.exclusions}</dd></>}
                <dt>Fee</dt><dd>{FEE_STRUCTURES[show.feeStructure]} · {money(versionTotal(show), show.currency)}</dd>
                {show.paymentSchedule.length > 0 && <><dt>Schedule</dt><dd>{show.paymentSchedule.map(x => `${x.label}: ${money(x.amount, show.currency)} ${x.trigger}`).join("; ")}</dd></>}
                <dt>Valid until</dt><dd>{show.validUntil ?? "Not set"}</dd>
                {show.sentAt && <><dt>Sent</dt><dd>{show.sentAt.slice(0, 10)} by {show.sentBy}</dd></>}
                {show.decidedAt && <><dt>Decision</dt><dd>{PROPOSAL_VERSION_STATUS[show.status]} by {show.decidedBy} on {show.decidedAt.slice(0, 10)} · {show.decisionEvidence}</dd></>}
              </dl>
              {!p.engagementId && <form action={saveProposalAction} style={{ marginTop: 8 }}><input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="scope" value={show.scope} /><input type="hidden" name="deliverables" value={show.deliverables.map(d => d.label).join("\n")} /><input type="hidden" name="feeStructure" value={show.feeStructure} /><input type="hidden" name="currency" value={show.currency} /><input type="hidden" name="fee" value={show.fee ?? ""} /><input type="hidden" name="monthlyFee" value={show.monthlyFee ?? ""} /><input type="hidden" name="months" value={show.months ?? ""} /><input type="hidden" name="hourlyRate" value={show.hourlyRate ?? ""} /><input type="hidden" name="estimatedHours" value={show.estimatedHours ?? ""} /><input type="hidden" name="paymentSchedule" value={show.paymentSchedule.map(x => `${x.label} | ${x.amount} | ${x.trigger}`).join("\n")} /><input type="hidden" name="validUntil" value={show.validUntil ?? ""} /><input type="hidden" name="templateId" value={show.templateId ?? ""} /><input type="hidden" name="assumptions" value={show.assumptions} /><input type="hidden" name="exclusions" value={show.exclusions} /><input type="hidden" name="responsibilities" value={show.responsibilities} /><input type="hidden" name="timeline" value={show.timeline} /><input type="hidden" name="summary" value={show.summary} /><button className={ui.miniBtn} type="submit">Start a new version from this one</button></form>}
            </section>
          )}

          {sent && !accepted && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Client decision on version {sent.version}</p>
              {sent.validUntil && sent.validUntil < today && <p className={ui.notice}>This version expired on {sent.validUntil}. Send a new version to accept.</p>}
              <form action={decideProposalAction} className={r.form}><input type="hidden" name="versionId" value={sent.id} /><input type="hidden" name="decision" value="accepted" />
                <label>Accepted by<input name="decidedBy" required placeholder="Name and role at the client" /></label>
                <label>Evidence<input name="evidence" required placeholder="Signed acceptance, email, meeting minutes" /></label>
                <button className="btn btn--primary" type="submit">Record acceptance</button></form>
              <form action={decideProposalAction} className={r.form} style={{ marginTop: 8 }}><input type="hidden" name="versionId" value={sent.id} /><input type="hidden" name="decision" value="declined" />
                <label>Declined by<input name="decidedBy" required /></label><label>Evidence or reason<input name="evidence" required /></label>
                <button className="btn" type="submit">Record decline</button></form>
            </section>
          )}

          {accepted && !p.engagementId && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Record the agreement (version {accepted.version})</p>
              <p className={ui.sub}>Registers the contract, creates the engagement from this accepted version (later edits never change it), sets up the delivery plan and marks the opportunity Signed.</p>
              <form action={recordAgreementAction} className={r.form}><input type="hidden" name="proposalId" value={p.id} />
                <label>Signature date<input name="executionDate" type="date" required defaultValue={today} /></label>
                <label>Start date<input name="startDate" type="date" defaultValue={today} /></label>
                <label>Signed evidence<input name="evidence" required placeholder="Signed copy location, e-signature reference or documented confirmation" /></label>
                <label>Delivery template<select name="templateId" defaultValue={accepted.templateId ?? ""}><option value="">None (plan by hand)</option>{templates.filter(t => t.status !== "retired").map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}{t.status === "draft" ? " (draft)" : ""}</option>)}</select></label>
                <button className="btn btn--primary" type="submit">Record agreement</button></form>
            </section>
          )}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Status</span><span className={ui.chip}>{PROPOSAL_STATUS[p.status]}</span></p>
            <dl className={r.kv}>
              <dt>Client</dt><dd>{org ? <Link href={`/companies/${org.id}`}>{org.name}</Link> : "Not linked"}</dd>
              <dt>Opportunity</dt><dd>{deal ? <Link href={`/deals/${deal.id}`}>{deal.name}</Link> : "—"}</dd>
              {p.contractId && <><dt>Agreement</dt><dd><Link href={`/contracts/${p.contractId}`}>Open contract</Link></dd></>}
            </dl>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Versions</p>
            <ul className={r.timeline}>{vs.map(v => <li key={v.id}><span className={r.when}>v{v.version}</span><span className={r.what}>{PROPOSAL_VERSION_STATUS[v.status]} · {money(versionTotal(v), v.currency)}{v.sentAt ? ` · sent ${v.sentAt.slice(0, 10)}` : ""}{v.id === p.acceptedVersionId ? " · agreed scope" : ""}</span></li>)}</ul>
          </section>
        </aside>
      </div>
    </>
  );
}
