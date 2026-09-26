import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { claimEvidence, claims } from "@/db/schema";
import { CLAIM_STATUSES, CLAIM_TYPES, EVIDENCE_METHODS } from "@/db/evidence";
import { appDb } from "@/lib/db/scoped";
import { SOURCE_LABEL, STATUS_LABEL } from "@/lib/evidence/engine";
import { addClaimAction, claimStatusAction } from "../playbook-actions";
import styles from "./projects.module.css";

const ORDER = ["Verified", "Sponsor provided", "Regenera analysis", "Assumption", "Unknown"] as const;

/** What we know about the entity and how we know it (master build instruction §08, §24, §88). */
export default async function ClaimsPanel({ entityType, entityId, back }: { entityType: "project" | "organization"; entityId: string; back: string }) {
  const rows = await appDb().select().from(claims).where(and(eq(claims.entityType, entityType), eq(claims.entityId, entityId), isNull(claims.supersededById))).orderBy(desc(claims.updatedAt)).limit(100);
  const ev = rows.length ? await appDb().select().from(claimEvidence).where(inArray(claimEvidence.claimId, rows.map(c => c.id))) : [];
  const evFor = (id: string) => ev.filter(e => e.claimId === id);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>What we know, and how</p>
      <p className={ui.sub} style={{ marginTop: 0 }}>{ORDER.map(l => `${l}: ${rows.filter(c => SOURCE_LABEL[c.status] === l).length}`).join(" · ")}. AI inference is never shown as Verified; verifying needs non-AI evidence and a person.</p>
      {rows.length === 0 ? <p className={r.empty}>No claims recorded. Record material facts (land control, capacity, grid capacity, offtake) with their source.</p> : (
        <table className={ui.table}><tbody>{rows.map(c => (
          <tr key={c.id}>
            <td><span className={ui.chip}>{SOURCE_LABEL[c.status]}</span> {c.statement}{c.value ? ` (${c.value}${c.unit ? ` ${c.unit}` : ""})` : ""}
              <span className={ui.sub} style={{ display: "block" }}>{STATUS_LABEL[c.status]}{c.verifiedBy ? ` by ${c.verifiedBy} ${c.verifiedAt?.slice(0, 10)}` : ""}{c.validFrom ? ` · from ${c.validFrom}` : ""}</span>
              {evFor(c.id).map(e => <span key={e.id} className={ui.sub} style={{ display: "block" }}>Evidence ({e.method}{e.provider ? `, ${e.provider}` : ""}{e.sourceDate ? `, ${e.sourceDate}` : ""}): {e.excerpt}{e.sourceUrl && <> <a href={e.sourceUrl} target="_blank" rel="noreferrer">source</a></>}</span>)}</td>
            <td>
              <details><summary className={ui.sub}>Update</summary>
                <form action={claimStatusAction} className={styles.stack} style={{ minWidth: 210, marginTop: 4 }}>
                  <input type="hidden" name="claimId" value={c.id} /><input type="hidden" name="back" value={back} />
                  <select name="status" defaultValue={c.status} aria-label="Status">{CLAIM_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
                  <select name="method" defaultValue="document" aria-label="Evidence method">{EVIDENCE_METHODS.map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</select>
                  <input name="provider" placeholder="Source / provider" aria-label="Provider" />
                  <input name="sourceUrl" type="url" placeholder="https://" aria-label="Source URL" />
                  <input name="excerpt" placeholder="Excerpt or page" aria-label="Excerpt" />
                  <button className={ui.miniBtn} type="submit">Save</button>
                </form>
              </details>
            </td>
          </tr>
        ))}</tbody></table>
      )}
      <details style={{ marginTop: 8 }}><summary className={ui.sub}>Record a claim</summary>
        <form action={addClaimAction} className={styles.grid2} style={{ marginTop: 6 }}>
          <input type="hidden" name="entityType" value={entityType} /><input type="hidden" name="entityId" value={entityId} /><input type="hidden" name="back" value={back} />
          <label className={styles.wide}>Statement<input name="statement" required minLength={3} placeholder="e.g. Sponsor holds a 30-year lease option on 120 ha" /></label>
          <label>Type<select name="claimType">{CLAIM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>Status<select name="status" defaultValue="source_provided">{CLAIM_STATUSES.filter(s => s !== "verified").map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          <label>Value<input name="value" /></label><label>Unit<input name="unit" /></label>
          <label>Valid from<input name="validFrom" type="date" /></label>
          <label>Evidence method<select name="method" defaultValue="document">{EVIDENCE_METHODS.map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</select></label>
          <label>Source / provider<input name="provider" /></label><label>Source URL<input name="sourceUrl" type="url" /></label>
          <label>Source date<input name="sourceDate" type="date" /></label><label>Excerpt<input name="excerpt" /></label>
          <button className="btn" type="submit">Record</button>
        </form>
      </details>
    </section>
  );
}
