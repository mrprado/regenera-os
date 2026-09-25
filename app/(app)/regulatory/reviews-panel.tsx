import { and, desc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { kycChecks, regulatoryReviews } from "@/db/schema";
import { appDb, isOwner, type UserScope } from "@/lib/db/scoped";
import { KYC_CHECKS, KYC_STATUSES, REVIEW_CONCLUSIONS, REVIEW_TOPICS, type REVIEW_SUBJECTS } from "@/lib/regulatory/vocab";
import { addKycAction, addReviewAction } from "../regulatory-actions";
import styles from "../projects/projects.module.css";

/** Reviews recorded on any record: who concluded what, on what evidence, with what conditions, until when. */
export async function ReviewsPanel({ subjectType, subjectId, back, scope, topics }: { subjectType: keyof typeof REVIEW_SUBJECTS; subjectId: string; back: string; scope: UserScope; topics?: (keyof typeof REVIEW_TOPICS)[] }) {
  const rows = await appDb().select().from(regulatoryReviews).where(and(eq(regulatoryReviews.subjectType, subjectType), eq(regulatoryReviews.subjectId, subjectId))).orderBy(desc(regulatoryReviews.reviewedAt));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Regulatory reviews</p>
      <p className={ui.sub} style={{ marginTop: 0 }}>The OS records conclusions by named reviewers with evidence. It never states that anything is compliant.</p>
      {rows.length === 0 ? <p className={r.empty}>No reviews recorded.</p> : (
        <ul className={r.timeline}>{rows.map(x => (
          <li key={x.id}><span className={r.when} style={{ color: x.validUntil && x.validUntil < today ? "#b0432f" : undefined }}>{x.reviewedAt}</span>
            <span><b>{REVIEW_TOPICS[x.topic]}{x.jurisdiction ? ` (${x.jurisdiction})` : ""}: {REVIEW_CONCLUSIONS[x.conclusion]}</b>
              <span className={ui.sub}>{x.reviewer}, {x.reviewerRole} · {x.evidence}{x.conditions ? ` · Conditions: ${x.conditions}` : ""}{x.validUntil ? ` · valid until ${x.validUntil}` : ""}</span></span></li>
        ))}</ul>
      )}
      {isOwner(scope) && (
        <details style={{ marginTop: 8 }}><summary className={ui.sub}>Record a review</summary>
          <form action={addReviewAction} className={styles.stack} style={{ marginTop: 8 }}>
            <input type="hidden" name="subjectType" value={subjectType} /><input type="hidden" name="subjectId" value={subjectId} /><input type="hidden" name="back" value={back} />
            <select name="topic" aria-label="Topic">{Object.entries(REVIEW_TOPICS).filter(([k]) => !topics || topics.includes(k as keyof typeof REVIEW_TOPICS)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="jurisdiction" placeholder="Jurisdiction (e.g. US, GB, MX)" aria-label="Jurisdiction" />
            <select name="conclusion" aria-label="Conclusion">{Object.entries(REVIEW_CONCLUSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="conditions" placeholder="Conditions" aria-label="Conditions" />
            <input name="reviewer" required placeholder="Reviewer name" aria-label="Reviewer" />
            <input name="reviewerRole" required placeholder="Role (e.g. external counsel, compliance)" aria-label="Role" />
            <input name="reviewedAt" type="date" aria-label="Reviewed on" />
            <input name="evidence" required placeholder="Evidence (memo, opinion, reference)" aria-label="Evidence" />
            <input name="validUntil" type="date" aria-label="Valid until" />
            <button className="btn" type="submit">Record review</button>
          </form>
        </details>
      )}
    </section>
  );
}

/** KYC / AML status for a person or entity: statuses and provider references only (owner-only). */
export async function KycPanel({ contactId, orgId, back }: { contactId?: string | null; orgId?: string | null; back: string }) {
  const rows = contactId ? await appDb().select().from(kycChecks).where(eq(kycChecks.contactId, contactId)) : orgId ? await appDb().select().from(kycChecks).where(eq(kycChecks.orgId, orgId)) : [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>KYC / AML status</p>
      <p className={ui.sub} style={{ marginTop: 0 }}>Specialist providers run the checks; the OS keeps the status and provider reference, not identity documents.</p>
      {rows.length === 0 ? <p className={r.empty}>No checks recorded.</p> : (
        <ul className={r.timeline}>{rows.map(k => (
          <li key={k.id}><span className={r.when} style={{ color: k.status === "flagged" || k.status === "failed" || (k.expiresAt && k.expiresAt < today) ? "#b0432f" : undefined }}>{KYC_STATUSES[k.status]}</span>
            <span>{KYC_CHECKS[k.checkType]}{k.provider ? ` · ${k.provider}` : ""}{k.providerRef ? ` · ref ${k.providerRef}` : ""}{k.expiresAt ? ` · until ${k.expiresAt}` : ""}</span></li>
        ))}</ul>
      )}
      <details style={{ marginTop: 8 }}><summary className={ui.sub}>Record a check</summary>
        <form action={addKycAction} className={styles.stack} style={{ marginTop: 8 }}>
          {contactId && <input type="hidden" name="contactId" value={contactId} />}{orgId && <input type="hidden" name="orgId" value={orgId} />}
          <input type="hidden" name="back" value={back} />
          <select name="checkType" aria-label="Check">{Object.entries(KYC_CHECKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="status" aria-label="Status">{Object.entries(KYC_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input name="provider" placeholder="Provider" aria-label="Provider" />
          <input name="providerRef" placeholder="Provider reference" aria-label="Reference" />
          <input name="checkedAt" type="date" aria-label="Checked on" />
          <input name="expiresAt" type="date" aria-label="Expires" />
          <button className="btn" type="submit">Record</button>
        </form>
      </details>
    </section>
  );
}
