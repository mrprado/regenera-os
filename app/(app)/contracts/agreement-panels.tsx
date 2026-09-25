import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contractObligations, contractParties, contracts, documentLinks, documents, organizations, type KeyTerms } from "@/db/schema";
import { CONFIDENTIALITY, DOCUMENT_CATEGORIES, EXECUTED, LIFECYCLE, OBLIGATION_CATEGORIES, OBLIGATION_STATUSES, RECURRENCE, typeLabel } from "@/lib/contracts/catalog";
import { appDb, isOwner, type UserScope } from "@/lib/db/scoped";
import { addContractPartyAction, addDocumentAction, addObligationAction, amendmentAction, completeObligationAction, contractReviewedAction, keyTermsAction, lifecycleAction } from "../register-actions";
import styles from "../projects/projects.module.css";

type Contract = typeof contracts.$inferSelect;

const KEY_TERM_LABELS: [keyof KeyTerms, string][] = [
  ["conditionsPrecedent", "Conditions precedent"], ["conditionsSubsequent", "Conditions subsequent"], ["representations", "Representations and warranties"],
  ["covenants", "Covenants"], ["reporting", "Reporting obligations"], ["deliverables", "Deliverables and milestones"], ["performance", "Performance requirements"],
  ["paymentTerms", "Payment terms"], ["insurance", "Insurance requirements"], ["security", "Security"], ["guarantees", "Guarantees"], ["indemnities", "Indemnities"],
  ["liabilityCap", "Liability cap"], ["liquidatedDamages", "Liquidated damages"], ["termination", "Termination rights"], ["defaults", "Events of default"],
  ["changeControl", "Change control"], ["assignment", "Assignment"], ["confidentiality", "Confidentiality"], ["disputeResolution", "Dispute resolution"], ["notices", "Notices"],
];

/** Main panel for a registered (project or third-party) agreement. */
export async function RegisteredMain({ c, scope }: { c: Contract; scope: UserScope }) {
  const db = appDb();
  const [parent] = c.parentContractId ? await db.select({ id: contracts.id, title: contracts.title }).from(contracts).where(eq(contracts.id, c.parentContractId)) : [];
  const amendments = await db.select({ id: contracts.id, title: contracts.title, lifecycle: contracts.lifecycle }).from(contracts).where(eq(contracts.parentContractId, c.id));
  const locked = !!c.lockedAt;
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>{typeLabel(c.category, c.contractType)}</span><span className={ui.chip}>{LIFECYCLE[c.lifecycle]}</span></p>
        {c.reviewRequired && (
          <div className={ui.notice}>
            <b>Compensation / regulatory review required.</b> This type of agreement can involve compensation tied to capital or securities.
            {isOwner(scope) && (
              <form action={contractReviewedAction} className={styles.inline} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={c.id} />
                <input name="conclusion" required minLength={5} placeholder="Reviewer, date and conclusion" style={{ minWidth: 260 }} aria-label="Review conclusion" />
                <button className={ui.miniBtn} type="submit">Record review</button>
              </form>
            )}
          </div>
        )}
        <dl className={r.kv}>
          {parent && <><dt>Amends</dt><dd><Link href={`/contracts/${parent.id}`}>{parent.title}</Link></dd></>}
          {amendments.length > 0 && <><dt>Amendments</dt><dd>{amendments.map(a => <Link key={a.id} href={`/contracts/${a.id}`} style={{ display: "block" }}>{a.title} ({LIFECYCLE[a.lifecycle as keyof typeof LIFECYCLE]})</Link>)}</dd></>}
          <dt>Governing law</dt><dd>{c.governingLaw ?? "Not recorded"}</dd>
          <dt>Forum</dt><dd>{c.forum ?? "Not recorded"}</dd>
          <dt>Executed</dt><dd>{c.executionDate ?? "—"}</dd>
          <dt>Effective / expires</dt><dd>{c.effectiveDate ?? "—"} / {c.endDate ?? "—"}</dd>
          {c.renewalTerms && <><dt>Renewal</dt><dd>{c.renewalTerms}</dd></>}
        </dl>
        <form action={lifecycleAction} className={styles.inline} style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={c.id} />
          <select name="lifecycle" defaultValue={c.lifecycle} aria-label="Lifecycle">{Object.entries(LIFECYCLE).map(([k, v]) => <option key={k} value={k} disabled={locked && !EXECUTED.includes(k as keyof typeof LIFECYCLE)}>{v}</option>)}</select>
          <button className={ui.miniBtn} type="submit">Set lifecycle</button>
        </form>
        {locked && <p className={ui.sub}>Executed {c.lockedAt?.slice(0, 10)}: the recorded terms are locked. Record changes as an amendment.</p>}
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}>Summary and key terms</p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Record what the executed document says, with clause numbers. The OS organizes; it does not interpret.</p>
        {locked ? (
          <>
            {c.body && <p style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{c.body}</p>}
            <dl className={r.kv}>{KEY_TERM_LABELS.filter(([k]) => c.keyTerms[k]).map(([k, label]) => <div key={k} style={{ display: "contents" }}><dt>{label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.keyTerms[k]}</dd></div>)}</dl>
            <details style={{ marginTop: 8 }}><summary className={ui.sub}>Register an amendment</summary>
              <form action={amendmentAction} className={styles.stack} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={c.id} />
                <input name="title" placeholder="Title (optional)" aria-label="Title" />
                <textarea name="summary" required rows={3} placeholder="What the amendment changes, with clause references" aria-label="Summary" />
                <label>Executed on (leave empty if still a draft)<input name="executionDate" type="date" /></label>
                <button className="btn" type="submit">Register amendment</button>
              </form>
            </details>
          </>
        ) : (
          <form action={keyTermsAction} className={styles.stack}>
            <input type="hidden" name="id" value={c.id} />
            <label>Summary<textarea name="summary" rows={3} defaultValue={c.body} /></label>
            <div className={styles.grid2}>{KEY_TERM_LABELS.map(([k, label]) => <label key={k}>{label}<textarea name={k} rows={2} defaultValue={c.keyTerms[k] ?? ""} /></label>)}</div>
            <input name="note" placeholder="What changed (kept in the history)" aria-label="Change note" />
            <button className="btn btn--primary" type="submit">Save key terms</button>
          </form>
        )}
      </section>
    </>
  );
}

/** Parties, obligations and linked documents: shown for every contract. */
export async function PartiesObligations({ c, scope }: { c: Contract; scope: UserScope }) {
  const db = appDb();
  const [parties, obligations, links, orgs] = await Promise.all([
    db.select().from(contractParties).where(eq(contractParties.contractId, c.id)).orderBy(asc(contractParties.role)),
    db.select().from(contractObligations).where(eq(contractObligations.contractId, c.id)).orderBy(asc(contractObligations.dueDate)),
    db.select({ d: documents }).from(documentLinks).innerJoin(documents, eq(documents.id, documentLinks.documentId)).where(and(eq(documentLinks.entity, "contract"), eq(documentLinks.entityId, c.id))),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.mandateId, scope.mandateIds.length ? scope.mandateIds : ["-"])).orderBy(asc(organizations.name)).limit(1000),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const open = obligations.filter(o => o.status === "open" || o.status === "in_progress");
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}>Obligations{open.length ? ` (${open.length} open)` : ""}</p>
        {obligations.length === 0 ? <p className={r.empty}>None recorded. Each obligation names who owes it, when, the evidence required and the clause it comes from.</p> : (
          <table className={ui.table}><tbody>{obligations.map(o => (
            <tr key={o.id}>
              <td style={{ whiteSpace: "nowrap", color: o.dueDate && o.dueDate < today && (o.status === "open" || o.status === "in_progress") ? "#b0432f" : undefined }}>{o.dueDate ?? "No date"}<span className={ui.sub}>{RECURRENCE[o.recurrence]}</span></td>
              <td>{o.obligation}<span className={ui.sub}>{[OBLIGATION_CATEGORIES[o.category], o.responsibleParty, o.sourceClause && `Clause ${o.sourceClause}`, o.evidenceRequired && `Evidence: ${o.evidenceRequired}`, o.riskIfMissed && `If missed: ${o.riskIfMissed}`].filter(Boolean).join(" · ")}</span>
                {o.completionEvidence && <span className={ui.sub}>Done: {o.completionEvidence}</span>}</td>
              <td>{o.status === "open" || o.status === "in_progress" ? (
                <form action={completeObligationAction} className={styles.inline}>
                  <input type="hidden" name="obligationId" value={o.id} />
                  <input name="evidence" placeholder="Evidence" aria-label="Evidence" style={{ width: 130 }} />
                  <select name="status" aria-label="Outcome"><option value="done">Done</option><option value="waived">Waived</option><option value="missed">Missed</option></select>
                  <button className={ui.miniBtn} type="submit">Record</button>
                </form>
              ) : OBLIGATION_STATUSES[o.status]}</td>
            </tr>
          ))}</tbody></table>
        )}
        <details style={{ marginTop: 8 }}><summary className={ui.sub}>Add an obligation</summary>
          <form action={addObligationAction} className={styles.grid2} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={c.id} />
            <label className={styles.wide}>Obligation<input name="obligation" required placeholder="e.g. Deliver quarterly generation report to offtaker" /></label>
            <label>Responsible party<input name="responsibleParty" placeholder="e.g. Sponsor" /></label>
            <label>Owner<input name="owner" placeholder="Person accountable" /></label>
            <label>Category<select name="category" defaultValue="other">{Object.entries(OBLIGATION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Due<input name="dueDate" type="date" /></label>
            <label>Recurrence<select name="recurrence" defaultValue="none">{Object.entries(RECURRENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Source clause<input name="sourceClause" placeholder="e.g. 7.3(b)" /></label>
            <label>Evidence required<input name="evidenceRequired" /></label>
            <label>Risk if missed<input name="riskIfMissed" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </details>
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}>Parties and documents</p>
        {parties.length > 0 && <ul className={r.timeline}>{parties.map(p => <li key={p.id}><span className={r.when}>{p.role.replace(/_/g, " ")}</span><span>{p.orgId ? <Link href={`/companies/${p.orgId}`}>{p.name}</Link> : p.name}</span></li>)}</ul>}
        <form action={addContractPartyAction} className={styles.inline} style={{ marginTop: 6 }}>
          <input type="hidden" name="id" value={c.id} />
          <select name="role" aria-label="Role">{["party", "counterparty", "guarantor", "agent", "beneficiary", "signatory", "key_contact"].map(x => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select>
          <select name="orgId" defaultValue="" aria-label="Organization"><option value="">Organization…</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <input name="name" placeholder="or name" aria-label="Name" style={{ width: 120 }} />
          <button className={ui.miniBtn} type="submit">Add party</button>
        </form>
        {links.length > 0 && <ul className={r.timeline} style={{ marginTop: 8 }}>{links.map(({ d }) => <li key={d.id}><span className={r.when}>v{d.version}</span><span>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title} · {d.status}</span></li>)}</ul>}
        <details style={{ marginTop: 8 }}><summary className={ui.sub}>Link a document</summary>
          <form action={addDocumentAction} className={styles.stack} style={{ marginTop: 8 }}>
            <input type="hidden" name="contractId" value={c.id} /><input type="hidden" name="back" value={`/contracts/${c.id}`} />
            {c.projectId && <input type="hidden" name="projectId" value={c.projectId} />}
            <input name="title" required placeholder="Title" aria-label="Title" />
            <select name="category" defaultValue="legal" aria-label="Category">{Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="version" placeholder="Version" aria-label="Version" />
            <select name="confidentiality" defaultValue="confidential" aria-label="Confidentiality">{Object.entries(CONFIDENTIALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="url" placeholder="Link (Drive, data room)" aria-label="Link" />
            <button className="btn" type="submit">Link document</button>
          </form>
        </details>
      </section>
    </>
  );
}
