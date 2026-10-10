import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import type { Db } from "@/db";
import { engagementCloseouts, type engagements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { closeoutCheck } from "@/lib/lifecycle/closeout";
import { COMMERCIAL_STAGES } from "@/lib/lifecycle/vocab";
import { completeEngagementAction, reviewMeetingAction } from "./lifecycle-actions";

/** After a meeting: notes, decisions, actions with owners and dates, a follow-up draft for approval, a stage suggestion. */
export function MeetingReviewPanel({ dealId }: { dealId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={r.panel} id="meeting">
      <details>
        <summary className={r.panelTitle} style={{ cursor: "pointer" }}>Record a meeting and its follow-up</summary>
        <p className={ui.sub}>Actions become tasks with owners and dates. The follow-up is saved as a draft in the approval queue and is never sent from here. A suggested stage change is a task for you to review, not a move.</p>
        <form action={reviewMeetingAction} className={r.form}>
          <input type="hidden" name="dealId" value={dealId} />
          <div className={r.formRow}><label>Title<input name="title" defaultValue="Meeting" /></label><label>Held on<input type="date" name="heldOn" defaultValue={today} /></label></div>
          <label>Participants<input name="participants" /></label>
          <label>Notes<textarea name="notes" rows={5} required /></label>
          <label>Decisions (one per line)<textarea name="decisions" rows={2} /></label>
          <label>Actions (one per line: what | owner | YYYY-MM-DD)<textarea name="actions" rows={3} placeholder="Send the scope summary | you | 2026-10-14" /></label>
          <label>Suggested stage<select name="suggestedStage" defaultValue=""><option value="">No change</option>{Object.entries(COMMERCIAL_STAGES).filter(([k]) => k !== "signed").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Follow-up subject (optional)<input name="followSubject" /></label>
          <label>Follow-up message<textarea name="followBody" rows={4} /></label>
          <button className="btn btn--primary" type="submit">Save meeting</button>
        </form>
      </details>
    </section>
  );
}

/** Completion: outcome, acceptance, lessons, continuation; open work recorded, not hidden. */
export async function CloseoutPanel({ db, e }: { db: Db; e: typeof engagements.$inferSelect }) {
  const [done] = await db.select().from(engagementCloseouts).where(eq(engagementCloseouts.engagementId, e.id));
  if (done) return (
    <section className={r.panel} id="closeout">
      <p className={r.panelTitle}><span>Completed</span><span className={ui.chip}>{done.createdAt.slice(0, 10)}</span></p>
      <dl className={r.kv}><dt>Outcome</dt><dd>{done.outcome}</dd><dt>Client acceptance</dt><dd>{done.acceptanceEvidence}</dd>{done.lessons && <><dt>Lessons</dt><dd style={{ whiteSpace: "pre-wrap" }}>{done.lessons}</dd></>}{done.continuation && <><dt>Continuation</dt><dd>{done.continuation}</dd></>}<dt>Relationship review</dt><dd>{done.reviewDue ?? "—"}</dd>{done.outstanding.length > 0 && <><dt>Open at completion</dt><dd>{done.outstanding.join("; ")}</dd></>}</dl>
    </section>
  );
  if (!["active", "waiting_on_client", "on_hold", "renewal"].includes(e.status)) return null;
  const check = await closeoutCheck(db, e.id);
  const open = check.openDeliverables.length + check.openRequests.length;
  return (
    <section className={r.panel} id="closeout">
      <details>
        <summary className={r.panelTitle} style={{ cursor: "pointer" }}>Complete this engagement</summary>
        {open > 0 && <p className={ui.notice}>Still open: {[...check.openDeliverables, ...check.openRequests.map(x => `client request: ${x.label}`)].join("; ")}. Finish them, or record why the engagement closes with them open.</p>}
        {check.unpaidInvoices.length > 0 && <p className={ui.sub}>Unpaid: {check.unpaidInvoices.map(i => `${i.number} ${i.currency} ${i.outstanding}`).join(", ")}. Completing creates collection tasks; it does not mark anything paid.</p>}
        <form action={completeEngagementAction} className={r.form}>
          <input type="hidden" name="engagementId" value={e.id} />
          <label>Outcome<textarea name="outcome" rows={2} required /></label>
          <label>Client acceptance evidence<input name="acceptanceEvidence" required placeholder="Signed acceptance, email, meeting minutes" /></label>
          {open > 0 && <label>Why it closes with work open<input name="outstandingReason" required /></label>}
          <label>Lessons for future work<textarea name="lessons" rows={3} /></label>
          <label>Continuation to propose (optional)<input name="continuation" placeholder="e.g. monitoring retainer, readiness engagement" /></label>
          <div className={r.formRow}><label>Relationship review in (days)<input name="reviewInDays" inputMode="numeric" defaultValue="30" /></label></div>
          <label className={r.check}><input type="checkbox" name="askCaseStudy" /> Ask for case-study permission</label>
          <label className={r.check}><input type="checkbox" name="askReferral" /> Ask for a referral</label>
          <button className="btn btn--primary" type="submit">Complete engagement</button>
        </form>
      </details>
    </section>
  );
}
