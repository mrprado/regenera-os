import Link from "next/link";
import { eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import type { Db } from "@/db";
import { deliveryTemplates, engagements, offerProposalVersions } from "@/db/schema";
import { deliveryPlan } from "@/lib/lifecycle/delivery";
import { CHANGE_REQUEST_STATUS, CLIENT_REQUEST_STATUS, DELIVERABLE_STATUS, MILESTONE_STATUS } from "@/lib/lifecycle/vocab";
import { clientRequestAction, decideChangeAction, instantiateTemplateAction, moveDeliverableAction, proposeChangeAction } from "../../../lifecycle-actions";

type E = typeof engagements.$inferSelect;
const inline = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 } as const;

/** One button per move (React drops name/value on function formActions), each with the fields that move needs. */
function Move({ e, d, to, label, fields, secondary }: { e: E; d: { id: string }; to: string; label: string; fields?: [string, string][]; secondary?: boolean }) {
  const form = (
    <form action={moveDeliverableAction} style={inline}>
      <input type="hidden" name="engagementId" value={e.id} /><input type="hidden" name="deliverableId" value={d.id} /><input type="hidden" name="to" value={to} />
      {fields?.map(([name, ph]) => <input key={name} name={name} placeholder={ph} aria-label={ph} required style={{ minWidth: 160 }} />)}
      <button className={ui.miniBtn} type="submit">{label}</button>
    </form>
  );
  // Secondary moves stay folded until asked for, so each deliverable shows its next step first.
  return secondary ? <details style={{ display: "inline-block", marginRight: 8 }}><summary className={ui.sub} style={{ cursor: "pointer", display: "inline" }}>{label}</summary>{form}</details> : form;
}

/** Delivery (phase 29A): milestones, deliverables (internal done ≠ client accepted), client requests and change requests. */
export default async function DeliveryPanel({ db, e }: { db: Db; e: E }) {
  const [plan, templates, accepted] = await Promise.all([
    deliveryPlan(db, e.id),
    db.select().from(deliveryTemplates).where(eq(deliveryTemplates.mandateId, e.mandateId)),
    e.acceptedVersionId ? db.select().from(offerProposalVersions).where(eq(offerProposalVersions.id, e.acceptedVersionId)) : Promise.resolve([]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const byMilestone = (id: string | null) => plan.deliverables.filter(d => d.milestoneId === id);
  return (
    <section className={r.panel} id="delivery">
      <p className={r.panelTitle}><span>Delivery plan</span>{e.templateId && <span className={ui.chip}>template v{e.templateVersion}</span>}</p>
      {accepted[0] && <p className={ui.sub}>Agreed scope: <Link href={`/commercial/proposals/${e.proposalId}`}>proposal version {accepted[0].version}</Link>, accepted by {accepted[0].decidedBy} on {accepted[0].decidedAt?.slice(0, 10)}. It is never edited; changes go through change requests.</p>}
      {!e.templateId && !plan.deliverables.length && (
        <form action={instantiateTemplateAction} className={r.form}>
          <input type="hidden" name="engagementId" value={e.id} />
          <label>Delivery template<select name="templateId" required>{templates.filter(t => t.status !== "retired").map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}{t.status === "draft" ? " (draft)" : ""}</option>)}</select></label>
          <label>Start<input type="date" name="startDate" defaultValue={e.startDate ?? today} /></label>
          <button className={ui.miniBtn} type="submit">Create delivery plan</button>
          {!templates.length && <p className={ui.sub}>No templates yet: add the starter templates under <Link href="/commercial?tab=templates">Delivery templates</Link>.</p>}
        </form>
      )}
      {[...plan.milestones.map(m => ({ m, ds: byMilestone(m.id) })), ...(byMilestone(null).length ? [{ m: null, ds: byMilestone(null) }] : [])].map(({ m, ds }) => (
        <div key={m?.id ?? "none"} style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{m ? m.label : "Other deliverables"}{m && <span className={ui.sub} style={{ display: "inline" }}> · {MILESTONE_STATUS[m.status]}{m.dueDate ? ` · due ${m.dueDate}` : ""}</span>}</p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>{ds.map(d => (
            <li key={d.id} style={{ marginBottom: 8 }}>
              <b>{d.label}</b> · {DELIVERABLE_STATUS[d.status]}{d.version > 1 ? ` · v${d.version}` : ""}{d.dueDate ? <span style={{ color: d.dueDate < today && d.status !== "accepted" ? "var(--critical)" : undefined }}> · due {d.dueDate}</span> : ""}{d.owner ? ` · ${d.owner}` : ""}
              {d.status === "blocked" && <span className={ui.sub}>Blocked: {d.blockedReason} (waiting on {d.blockedParty})</span>}
              {d.revisionNote && d.status !== "accepted" && <span className={ui.sub}>Revision asked: {d.revisionNote}</span>}
              {d.status === "accepted" && <span className={ui.sub}>Accepted by {d.acceptedBy} on {d.acceptedAt?.slice(0, 10)}: {d.acceptanceNote}</span>}
              {d.status === "not_started" && <Move e={e} d={d} to="in_progress" label="Start" />}
              {(d.status === "not_started" || d.status === "in_progress") && <Move e={e} d={d} to="blocked" label="Mark blocked" fields={[["blockedReason", "Reason"], ["blockedParty", "Waiting on"]]} secondary />}
              {d.status === "blocked" && <Move e={e} d={d} to="in_progress" label="Unblock" />}
              {d.status === "in_progress" && <Move e={e} d={d} to="internal_done" label="Done internally" fields={[["evidence", "Artifact link or completion evidence"]]} />}
              {d.status === "internal_done" && (d.clientReview ? <Move e={e} d={d} to="in_client_review" label="Send to client for review" /> : <Move e={e} d={d} to="accepted" label="Close (internal deliverable)" />)}
              {d.status === "in_client_review" && <><Move e={e} d={d} to="accepted" label="Record client acceptance" fields={[["clientName", "Accepted by"], ["note", "How (email, signed form, portal)"]]} /><Move e={e} d={d} to="revision_requested" label="Record revision request" fields={[["note", "What the client asked to change"]]} secondary /></>}
              {d.status === "revision_requested" && <Move e={e} d={d} to="in_progress" label="Start revision" />}
            </li>
          ))}</ul>
        </div>
      ))}

      <p className={r.panelTitle} style={{ marginTop: 16 }}>What we need from the client<span>{plan.requests.filter(x => ["open", "rejected"].includes(x.status)).length} open</span></p>
      {plan.requests.length === 0 ? <p className={r.empty}>No requests.</p> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{plan.requests.map(q => (
        <li key={q.id} style={{ marginBottom: 6 }}>{q.label} · {CLIENT_REQUEST_STATUS[q.status]}{q.dueDate ? <span style={{ color: q.dueDate < today && ["open", "rejected"].includes(q.status) ? "var(--critical)" : undefined }}> · due {q.dueDate}</span> : ""}
          {q.response && <span className={ui.sub}>Response: {q.response}</span>}{q.reviewNote && <span className={ui.sub}>Review: {q.reviewNote}</span>}
          {["open", "rejected"].includes(q.status) && <form action={clientRequestAction} style={inline}><input type="hidden" name="engagementId" value={e.id} /><input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="op" value="submit" /><input name="response" placeholder="What the client provided" aria-label="Client response" required /><button className={ui.miniBtn} type="submit">Record response</button></form>}
          {q.status === "submitted" && <><form action={clientRequestAction} style={inline}><input type="hidden" name="engagementId" value={e.id} /><input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="op" value="accept" /><button className={ui.miniBtn} type="submit">Accept</button></form>
            <form action={clientRequestAction} style={inline}><input type="hidden" name="engagementId" value={e.id} /><input type="hidden" name="requestId" value={q.id} /><input type="hidden" name="op" value="reject" /><input name="note" placeholder="What is missing" aria-label="What is missing" required /><button className={ui.miniBtn} type="submit">Send back</button></form></>}
        </li>
      ))}</ul>}

      <p className={r.panelTitle} style={{ marginTop: 16 }}>Change requests</p>
      {plan.changes.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{plan.changes.map(c => (
        <li key={c.id} style={{ marginBottom: 6 }}><b>{c.title}</b> · {CHANGE_REQUEST_STATUS[c.status]} · fee {c.feeImpact >= 0 ? "+" : ""}{c.feeImpact.toLocaleString("en-US")} {c.currency} · {c.timelineWeeks} wk<span className={ui.sub}>{c.scopeEffect}{c.decisionEvidence ? ` · ${c.decisionEvidence}` : ""}</span>
          {c.status === "proposed" && <><form action={decideChangeAction} style={inline}><input type="hidden" name="engagementId" value={e.id} /><input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="decision" value="approved" /><input name="evidence" placeholder="Client approval evidence" aria-label="Client approval evidence" required /><button className={ui.miniBtn} type="submit">Approve</button></form>
            <form action={decideChangeAction} style={inline}><input type="hidden" name="engagementId" value={e.id} /><input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="decision" value="rejected" /><button className={ui.miniBtn} type="submit">Reject</button></form></>}
        </li>
      ))}</ul>}
      <form action={proposeChangeAction} className={r.form} style={{ marginTop: 6 }}>
        <input type="hidden" name="engagementId" value={e.id} />
        <div className={r.formRow}><label>Change<input name="title" required /></label><label>Effect on scope<input name="scopeEffect" required /></label></div>
        <div className={r.formRow}><label>Fee impact ({e.currency})<input name="feeImpact" inputMode="decimal" defaultValue="0" /></label><label>Timeline impact (weeks)<input name="timelineWeeks" inputMode="decimal" defaultValue="0" /></label></div>
        <label>Deliverables it adds (one per line)<textarea name="addDeliverables" rows={2} /></label>
        <button className={ui.miniBtn} type="submit">Record change request</button>
      </form>
    </section>
  );
}
