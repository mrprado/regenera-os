// Opportunity record panels for the connected workflow (phase 15): commercial qualification (evidence per field, then a
// person's decision), source attribution, meeting notes with proposed changes awaiting confirmation, and time logged.
import { and, desc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { meetingNotes, proposals, ATTRIBUTION_CHANNELS, QUALIFICATION_FIELDS, type QualificationField } from "@/db/schema";
import type { Db } from "@/db";
import { aiConfig } from "@/lib/config";
import { attributionFor, opportunityQualification, qualificationGaps } from "@/lib/flow/commercial";
import { attributeAction, decideOppQualificationAction, logEffortAction, saveMeetingNoteAction, setOppQualificationAction } from "../../flow-actions";
import { confirmProposalAction, rejectProposalAction } from "../../intel-actions";
import p from "../../companies/[id]/panels.module.css";

type Deal = { id: string; mandateId: string; name: string; orgId: string | null };

export async function DealFlowPanels({ db, d }: { db: Db; d: Deal }) {
  const [q, attr, notes, pending] = await Promise.all([
    opportunityQualification(db, d.mandateId, d.id), attributionFor(db, d.mandateId, "deal", d.id),
    db.select().from(meetingNotes).where(and(eq(meetingNotes.mandateId, d.mandateId), eq(meetingNotes.dealId, d.id))).orderBy(desc(meetingNotes.heldOn)).limit(10),
    db.select().from(proposals).where(and(eq(proposals.mandateId, d.mandateId), eq(proposals.status, "pending"), eq(proposals.source, "meeting"))).orderBy(desc(proposals.createdAt)).limit(40),
  ]);
  const mine = pending.filter(x => (x.change.args as { dealId?: string }).dealId === d.id);
  const gaps = qualificationGaps(q?.fields ?? {});
  const back = `/deals/${d.id}`;
  return (
    <>
      <section className={r.panel} id="qualification">
        <p className={r.panelTitle}><span>Commercial qualification</span><span>{q?.decision === "qualified" ? `Qualified by ${q.decidedBy}` : q?.decision === "not_qualified" ? `Not qualified (${q.decidedBy})` : "Open"}</span></p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Filling fields is not qualifying: a person decides, with a reason. Changing evidence after a decision reopens it.</p>
        <div className={p.dims}>{(Object.keys(QUALIFICATION_FIELDS) as QualificationField[]).map(f => {
          const v = q?.fields[f];
          return (
            <form key={f} action={setOppQualificationAction} className={p.dim}>
              <input type="hidden" name="dealId" value={d.id} /><input type="hidden" name="field" value={f} />
              <b>{QUALIFICATION_FIELDS[f]}</b>
              <span className={ui.sub}>{v ? `${v.text}${v.evidence ? ` · evidence: ${v.evidence}` : " · no evidence recorded"} · ${v.by}, ${v.at.slice(0, 10)}` : "Unknown"}</span>
              <div className={p.row}>
                <input name="text" defaultValue={v?.text ?? ""} placeholder="What you know" aria-label={QUALIFICATION_FIELDS[f]} className={p.grow} />
                <input name="evidence" defaultValue={v?.evidence ?? ""} placeholder="Evidence (meeting, email, document)" aria-label={`${QUALIFICATION_FIELDS[f]}: evidence`} className={p.grow} />
                <button className={ui.miniBtn} type="submit">Save</button>
              </div>
            </form>
          );
        })}</div>
        <form action={decideOppQualificationAction} className={p.row} style={{ marginTop: 10 }}>
          <input type="hidden" name="dealId" value={d.id} />
          <input name="reason" required placeholder="Reason for the decision" aria-label="Reason for the qualification decision" className={p.grow} />
          <button className={`${ui.miniBtn} ${ui.miniPrimary}`} name="decision" value="qualified" type="submit" disabled={gaps.length > 0} title={gaps.length ? `Needs: ${gaps.join(", ")}` : ""}>Qualified</button>
          <button className={ui.miniBtn} name="decision" value="not_qualified" type="submit">Not qualified</button>
        </form>
        {gaps.length > 0 && <p className={ui.sub}>Before &quot;Qualified&quot;: {gaps.join(", ")}.</p>}
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Meeting notes</span><span>{notes.length}</span></p>
        <form action={saveMeetingNoteAction} className={p.stack}>
          <input type="hidden" name="dealId" value={d.id} />
          <div className={p.row}><label className={p.grow}>Meeting<input name="title" required placeholder="Scoping call" /></label><label>Date<input name="heldOn" type="date" /></label><label className={p.grow}>Participants<input name="participants" /></label></div>
          <label>Reviewed notes<textarea name="notes" rows={5} required placeholder={"Need: …\nBudget: …\nTiming: …\nDecision maker: …\nAction: send capability statement 2026-10-08\nNext step: scoping call 2026-10-15"} /></label>
          {aiConfig() && <label style={{ display: "flex", gap: 6 }}><input type="checkbox" name="useClaude" /> Also ask Claude to propose follow-ups (each must quote a line of these notes)</label>}
          <button className={ui.miniBtn} type="submit">Save notes and propose follow-ups</button>
          <p className={ui.sub}>Proposed tasks, next actions and qualification evidence wait below for your confirmation. Nothing is applied or sent automatically.</p>
        </form>
        {mine.length > 0 && (
          <ul className={r.timeline}>{mine.map(x => (
            <li key={x.id}><span className={r.when}>Proposed</span><span>{x.title}<span className={ui.sub}>From notes: &quot;{String((x.evidence as { quote?: string } | null)?.quote ?? "").slice(0, 160)}&quot;</span>
              <span className={ui.rowActions}>
                <form action={confirmProposalAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="back" value={back} /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Confirm</button></form>
                <form action={rejectProposalAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Discard</button></form>
              </span></span></li>
          ))}</ul>
        )}
        {notes.length > 0 && <details><summary className={ui.sub}>Earlier notes</summary><ul className={r.timeline}>{notes.map(n => <li key={n.id}><span className={r.when}>{n.heldOn}</span><span><b>{n.title}</b>{n.participants ? ` · ${n.participants}` : ""}<span className={ui.sub} style={{ whiteSpace: "pre-wrap" }}>{n.notes.slice(0, 600)}</span></span></li>)}</ul></details>}
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Source attribution</span><span>First row = original source</span></p>
        {attr.length === 0 ? <p className={r.empty}>No source recorded.</p> : <ul className={r.timeline}>{attr.map(a => <li key={a.id}><span className={r.when}>{a.kind === "original" ? "Original" : "Influence"}</span><span>{ATTRIBUTION_CHANNELS[a.channel as keyof typeof ATTRIBUTION_CHANNELS] ?? a.channel}{a.campaign ? ` · ${a.campaign}` : ""}<span className={ui.sub}>{a.at.slice(0, 10)} · {a.by}{a.note ? ` · ${a.note}` : ""}</span></span></li>)}</ul>}
        <form action={attributeAction} className={p.row}>
          <input type="hidden" name="entityType" value="deal" /><input type="hidden" name="entityId" value={d.id} />
          <select name="channel" aria-label="Channel">{Object.entries(ATTRIBUTION_CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input name="campaign" placeholder="Campaign" aria-label="Campaign" /><input name="note" placeholder="Note" aria-label="Note" className={p.grow} />
          <button className={ui.miniBtn} type="submit">Record source</button>
        </form>
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}>Time spent</p>
        <form action={logEffortAction} className={p.row}>
          <input type="hidden" name="dealId" value={d.id} />
          <input name="minutes" type="number" min={1} max={1440} required placeholder="Minutes" aria-label="Minutes" />
          <input name="on" type="date" aria-label="Date" />
          <input name="campaign" placeholder="Campaign (optional)" aria-label="Campaign" />
          <input name="note" placeholder="What for" aria-label="Note" className={p.grow} />
          <button className={ui.miniBtn} type="submit">Log time</button>
        </form>
      </section>
    </>
  );
}
