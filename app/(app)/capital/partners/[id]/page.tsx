import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalMandates, capitalMatches, capitalOpportunities, capitalProfiles, commitments, investorQualifications, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { CAPITAL_TYPES, COMMITMENT_STAGES, ELIGIBILITY, MATCH_STATUSES, QUALIFICATION_STATUSES, RELATIONSHIP_STRENGTH } from "@/lib/capital/vocab";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { addCapitalMandateAction, addQualificationAction, updateCapitalProfileAction } from "../../../capital-actions";
import styles from "../../../projects/projects.module.css";
import CriteriaFields from "../../criteria-fields";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital partner" };

export default async function CapitalPartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capital");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [p] = await db.select().from(capitalProfiles).where(and(eq(capitalProfiles.id, id), mandateCondition(user.scope, capitalProfiles.mandateId)));
  if (!p) notFound();
  const key = `profile:${p.id}`;
  const [mandatesRows, matches, ledger, quals, org] = await Promise.all([
    db.select().from(capitalMandates).where(eq(capitalMandates.profileId, id)).orderBy(desc(capitalMandates.createdAt)),
    db.select({ m: capitalMatches, title: capitalOpportunities.title, oid: capitalOpportunities.id }).from(capitalMatches).innerJoin(capitalOpportunities, eq(capitalOpportunities.id, capitalMatches.opportunityId)).where(eq(capitalMatches.investorKey, key)),
    db.select({ c: commitments, title: capitalOpportunities.title }).from(commitments).innerJoin(capitalOpportunities, eq(capitalOpportunities.id, commitments.opportunityId)).where(eq(commitments.investorKey, key)),
    p.orgId ? db.select().from(investorQualifications).where(eq(investorQualifications.orgId, p.orgId)) : Promise.resolve([]),
    p.orgId ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId)).then(x => x[0]) : Promise.resolve(undefined),
  ]);

  return (
    <>
      <PageHeader title={p.name} actions={<Link className="btn" href="/capital">All capital partners</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6 }}>{CAPITAL_TYPES[p.capitalType]} · relationship {RELATIONSHIP_STRENGTH[p.relationshipStrength].toLowerCase()}{org ? <> · <Link href={`/companies/${org.id}`}>{org.name}</Link></> : ""} · last verified {p.lastVerifiedAt?.slice(0, 10) ?? "never"}</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Matched opportunities</p>
            {matches.length === 0 ? <p className={r.empty}>Not matched to any capital opportunity yet.</p> : (
              <table className={ui.table}><tbody>{matches.map(x => (
                <tr key={x.m.id}><td><Link href={`/capital/opportunities/${x.oid}`}>{x.title}</Link><span className={ui.sub}>{x.m.commercialReasons.join(" · ")}</span></td>
                  <td className={ui.num}>{x.m.commercialScore}</td><td>{ELIGIBILITY[x.m.eligibility]}</td><td>{MATCH_STATUSES[x.m.status]}</td></tr>
              ))}</tbody></table>
            )}
            {ledger.length > 0 && <>
              <p className={ui.sub}><b>Ledger</b></p>
              <table className={ui.table}><tbody>{ledger.map(x => <tr key={x.c.id}><td>{x.title}</td><td>{COMMITMENT_STAGES[x.c.stage]}</td><td className={ui.num}>{compactMoney(x.c.amount, x.c.currency)}</td></tr>)}</tbody></table>
            </>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Profile</p>
            <form action={updateCapitalProfileAction}>
              <input type="hidden" name="id" value={p.id} />
              <div className={styles.grid2}>
                <label>Name<input name="name" defaultValue={p.name} /></label>
                <label>Type<select name="capitalType" defaultValue={p.capitalType}>{Object.entries(CAPITAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              </div>
              <CriteriaFields c={p} />
              <div className={styles.grid2}>
                <label>Technologies<input name="technologies" defaultValue={p.technologies.join(", ")} /></label>
                <label>Tenor<input name="tenor" defaultValue={p.tenor} /></label>
                <label>Risk<input name="risk" defaultValue={p.risk} /></label>
                <label>Return target<input name="returnTarget" defaultValue={p.returnTarget} /></label>
                <label className={styles.wide}>Impact<input name="impact" defaultValue={p.impact} /></label>
                <label className={styles.wide}>E&amp;S / lender standards (IFC PS, Equator Principles …)<input name="esRequirements" defaultValue={p.esRequirements} /></label>
                <label>Local content<input name="localContent" defaultValue={p.localContent} /></label>
                <label>Relationship<select name="relationshipStrength" defaultValue={p.relationshipStrength}>{Object.entries(RELATIONSHIP_STRENGTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Next action<input name="nextAction" defaultValue={p.nextAction ?? ""} /></label>
                <label>Next action date<input name="nextActionDate" type="date" defaultValue={p.nextActionDate ?? ""} /></label>
                <label className={styles.wide}>Source<input name="source" defaultValue={p.source} /></label>
                <label className={styles.wide}>Notes<textarea name="notes" rows={3} defaultValue={p.notes} /></label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="verified" /> I verified these criteria today</label>
              </div>
              <button className="btn btn--primary" type="submit" style={{ marginTop: 10 }}>Save</button>
            </form>
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Mandates</p>
            {mandatesRows.length === 0 ? <p className={r.empty}>No specific mandates. Matching uses the profile.</p> : (
              <ul className={r.timeline}>{mandatesRows.map(m => <li key={m.id}><span className={r.when}>{m.validTo ? `to ${m.validTo}` : "open"}</span><span>{m.name}<span className={ui.sub}>{[m.geographies.join(", "), m.instruments.join(", "), m.ticketMin || m.ticketMax ? `${compactMoney(m.ticketMin, m.currency ?? "USD")}–${compactMoney(m.ticketMax, m.currency ?? "USD")}` : ""].filter(Boolean).join(" · ")}</span></span></li>)}</ul>
            )}
            <details><summary className={ui.sub}>Add a mandate</summary>
              <form action={addCapitalMandateAction} className={styles.stack} style={{ marginTop: 8 }}>
                <input type="hidden" name="profileId" value={p.id} />
                <label>Name<input name="name" required placeholder="e.g. Fund III — LATAM energy transition" /></label>
                <CriteriaFields />
                <label>Valid to<input name="validTo" type="date" /></label>
                <label>Source<input name="source" /></label>
                <button className="btn" type="submit">Add mandate</button>
              </form>
            </details>
          </section>
          {p.orgId && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Investor qualifications (entity)</p>
              {quals.length === 0 ? <p className={r.empty}>None on record. Institutional classification is jurisdiction-specific too.</p> : (
                <ul className={r.timeline}>{quals.map(q => <li key={q.id}><span className={r.when}>{q.jurisdiction}</span><span>{q.classification} · {QUALIFICATION_STATUSES[q.verificationStatus]}{q.expiresAt ? ` · until ${q.expiresAt}` : ""}</span></li>)}</ul>
              )}
              {isOwner(user.scope) && (
                <details><summary className={ui.sub}>Record a qualification</summary>
                  <form action={addQualificationAction} className={styles.stack} style={{ marginTop: 8 }}>
                    <input type="hidden" name="orgId" value={p.orgId} /><input type="hidden" name="back" value={`/capital/partners/${p.id}`} />
                    <input name="jurisdiction" required placeholder="Jurisdiction (e.g. US)" aria-label="Jurisdiction" />
                    <input name="classification" required placeholder="Classification (e.g. Qualified institutional buyer)" aria-label="Classification" />
                    <select name="verificationStatus" aria-label="Status">{Object.entries(QUALIFICATION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="verifiedBy" placeholder="Verified by" aria-label="Verified by" />
                    <input name="expiresAt" type="date" aria-label="Expires" />
                    <input name="evidenceRef" placeholder="Evidence reference (not the document)" aria-label="Evidence" />
                    <button className="btn" type="submit">Record</button>
                  </form>
                </details>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
