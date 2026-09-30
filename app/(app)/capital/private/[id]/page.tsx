import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, or } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { FitEvidence } from "@/components/fit-evidence";
import { capitalMatches, capitalOpportunities, commitments, contacts, introductions, investorQualifications, materialDeliveries, privateCapitalProfiles } from "@/db/schema";
import { requireOsOwner } from "@/lib/auth";
import { APPETITE, COMMITMENT_STAGES, ELIGIBILITY, INVESTOR_JOURNEY, MATCH_STATUSES, QUALIFICATION_STATUSES, RELATIONSHIP_STRENGTH } from "@/lib/capital/vocab";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { addIntroductionAction, addQualificationAction, updatePrivateProfileAction } from "../../../capital-actions";
import styles from "../../../projects/projects.module.css";
import CriteriaFields from "../../criteria-fields";
import { KycPanel } from "../../../regulatory/reviews-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private investor" };

// Owner-only (sensitive): private capital profiles and qualifications never reach members, Ask the OS or MCP.
export default async function PrivateInvestorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsOwner("/capital");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [row] = await db.select({ p: privateCapitalProfiles, name: contacts.fullName, email: contacts.email }).from(privateCapitalProfiles).innerJoin(contacts, eq(contacts.id, privateCapitalProfiles.contactId))
    .where(and(eq(privateCapitalProfiles.id, id), mandateCondition(user.scope, privateCapitalProfiles.mandateId)));
  if (!row) notFound();
  const { p } = row;
  const key = `private:${p.id}`;
  const [quals, matches, ledger, deliveries, intros, people] = await Promise.all([
    db.select().from(investorQualifications).where(eq(investorQualifications.contactId, p.contactId)).orderBy(desc(investorQualifications.createdAt)),
    db.select({ m: capitalMatches, title: capitalOpportunities.title, oid: capitalOpportunities.id }).from(capitalMatches).innerJoin(capitalOpportunities, eq(capitalOpportunities.id, capitalMatches.opportunityId)).where(eq(capitalMatches.investorKey, key)),
    db.select({ c: commitments, title: capitalOpportunities.title }).from(commitments).innerJoin(capitalOpportunities, eq(capitalOpportunities.id, commitments.opportunityId)).where(eq(commitments.investorKey, key)),
    db.select().from(materialDeliveries).where(eq(materialDeliveries.investorKey, key)).orderBy(desc(materialDeliveries.sentAt)).limit(40),
    db.select().from(introductions).where(or(eq(introductions.fromContactId, p.contactId), eq(introductions.toContactId, p.contactId))),
    db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(mandateCondition(user.scope, contacts.mandateId)).limit(1000),
  ]);
  const nameOf = new Map(people.map(x => [x.id, x.name]));
  const today = new Date().toISOString().slice(0, 10);
  const appetite = (name: "incomePreference" | "growthPreference" | "developmentAppetite" | "constructionAppetite" | "operatingAppetite", label: string) => (
    <label>{label}<select name={name} defaultValue={p[name]}>{Object.entries(APPETITE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  );

  return (
    <>
      <PageHeader title={row.name} actions={<><Link className="btn" href={`/people/${p.contactId}`}>Person record</Link><Link className="btn" href="/capital?tab=private">All private investors</Link></>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6 }}>{INVESTOR_JOURNEY[p.journeyStage]} · relationship {RELATIONSHIP_STRENGTH[p.relationshipStrength].toLowerCase()} · last verified {p.lastVerifiedAt?.slice(0, 10) ?? "never"} · visible to entity owners only</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Opportunities, interest and what they received</p>
            {matches.length === 0 && ledger.length === 0 ? <p className={r.empty}>Not matched or presented yet.</p> : (
              <table className={ui.table}><tbody>
                {matches.map(x => {
                  const l = ledger.find(y => y.c.opportunityId === x.oid);
                  return (
                    <tr key={x.m.id}><td><Link href={`/capital/opportunities/${x.oid}`}>{x.title}</Link><FitEvidence reasons={x.m.commercialReasons} compact /><span className={ui.sub}>{ELIGIBILITY[x.m.eligibility]} · {MATCH_STATUSES[x.m.status]}</span></td>
                      <td>{l ? `${COMMITMENT_STAGES[l.c.stage]} ${compactMoney(l.c.amount, l.c.currency)}` : "No interest recorded"}</td></tr>
                  );
                })}
              </tbody></table>
            )}
            {deliveries.length > 0 && <>
              <p className={ui.sub}><b>Materials received</b></p>
              <table className={ui.table}><tbody>{deliveries.map(d => <tr key={d.id}><td>{d.document} v{d.version}</td><td>{d.channel}</td><td className={ui.sub}>{d.sentAt.slice(0, 10)} · {d.sentBy}</td></tr>)}</tbody></table>
            </>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Profile (only what the person has stated)</p>
            <form action={updatePrivateProfileAction}>
              <input type="hidden" name="id" value={p.id} />
              <div className={styles.grid2}>
                <label>Journey stage<select name="journeyStage" defaultValue={p.journeyStage}>{Object.entries(INVESTOR_JOURNEY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Reason for change<input name="reason" placeholder="Kept in the audit log" /></label>
                <label>How we know them<input name="relationshipSource" defaultValue={p.relationshipSource} /></label>
                <label>Relationship<select name="relationshipStrength" defaultValue={p.relationshipStrength}>{Object.entries(RELATIONSHIP_STRENGTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Primary jurisdiction<input name="primaryJurisdiction" defaultValue={p.primaryJurisdiction ?? ""} /></label>
                <label>Vehicle jurisdiction<input name="vehicleJurisdiction" defaultValue={p.vehicleJurisdiction ?? ""} /></label>
                <label>Preferred channel<input name="preferredChannel" defaultValue={p.preferredChannel ?? ""} /></label>
                <label>Horizon<input name="horizon" defaultValue={p.horizon} /></label>
              </div>
              <CriteriaFields c={p} />
              <div className={styles.grid2}>
                <label className={styles.wide}>Asset classes<input name="assetClasses" defaultValue={p.assetClasses.join(", ")} /></label>
                {appetite("incomePreference", "Income preference")}{appetite("growthPreference", "Growth preference")}
                {appetite("developmentAppetite", "Development-stage appetite")}{appetite("constructionAppetite", "Construction-stage appetite")}{appetite("operatingAppetite", "Operating-asset appetite")}
                <label className={styles.wide}>Impact interests<input name="impactInterests" defaultValue={p.impactInterests} /></label>
                <label className={styles.wide}>Risk appetite (as explicitly stated)<input name="knownRiskAppetite" defaultValue={p.knownRiskAppetite} /></label>
                <label className={styles.wide}>Constraints<input name="constraints" defaultValue={p.constraints} /></label>
                <label>Next action<input name="nextAction" defaultValue={p.nextAction ?? ""} /></label>
                <label>Next action date<input name="nextActionDate" type="date" defaultValue={p.nextActionDate ?? ""} /></label>
                <label className={styles.wide}>Private notes<textarea name="privateNotes" rows={3} defaultValue={p.privateNotes} /></label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="verified" /> Confirmed with the person today</label>
              </div>
              <button className="btn btn--primary" type="submit" style={{ marginTop: 10 }}>Save</button>
            </form>
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Investor qualifications</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Per jurisdiction, rule and date. Never inferred from wealth, title or experience.</p>
            {quals.length === 0 ? <p className={r.empty}>None on record: assessment required before any investment communication.</p> : (
              <ul className={r.timeline}>{quals.map(q => (
                <li key={q.id}><span className={r.when} style={{ color: q.expiresAt && q.expiresAt < today ? "#b0432f" : undefined }}>{q.jurisdiction}</span>
                  <span>{q.classification}{q.definitionVersion ? ` (${q.definitionVersion})` : ""} · {QUALIFICATION_STATUSES[q.verificationStatus]}{q.verifiedBy ? ` by ${q.verifiedBy}` : ""}{q.expiresAt ? ` · until ${q.expiresAt}` : ""}{q.restrictions ? ` · ${q.restrictions}` : ""}</span></li>
              ))}</ul>
            )}
            <details><summary className={ui.sub}>Record a qualification</summary>
              <form action={addQualificationAction} className={styles.stack} style={{ marginTop: 8 }}>
                <input type="hidden" name="contactId" value={p.contactId} /><input type="hidden" name="back" value={`/capital/private/${p.id}`} />
                <input name="jurisdiction" required placeholder="Jurisdiction (e.g. US, GB, MX)" aria-label="Jurisdiction" />
                <input name="classification" required placeholder="Classification (e.g. Accredited investor)" aria-label="Classification" />
                <input name="definitionVersion" placeholder="Definition / rule version (e.g. Rule 501(a), 2020 amendments)" aria-label="Definition" />
                <select name="verificationStatus" aria-label="Status">{Object.entries(QUALIFICATION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="method" placeholder="Method (e.g. third-party verification letter)" aria-label="Method" />
                <input name="verifiedBy" placeholder="Verified by" aria-label="Verified by" />
                <input name="verifiedAt" type="date" aria-label="Verified on" />
                <input name="expiresAt" type="date" aria-label="Expires" />
                <input name="evidenceRef" placeholder="Evidence reference (provider ID or link, not the document)" aria-label="Evidence" />
                <input name="restrictions" placeholder="Restrictions" aria-label="Restrictions" />
                <button className="btn" type="submit">Record</button>
              </form>
            </details>
          </section>
          <KycPanel contactId={p.contactId} back={`/capital/private/${p.id}`} />
          <section className={r.panel}>
            <p className={r.panelTitle}>Introductions</p>
            {intros.length === 0 ? <p className={r.empty}>None recorded.</p> : (
              <ul className={r.timeline}>{intros.map(i => <li key={i.id}><span className={r.when}>{i.date ?? ""}</span><span>{nameOf.get(i.fromContactId)} → {i.toContactId ? nameOf.get(i.toContactId) : "organization"}{i.compensation ? " · compensation, review required" : ""}</span></li>)}</ul>
            )}
            <details><summary className={ui.sub}>Who introduced them?</summary>
              <form action={addIntroductionAction} className={styles.stack} style={{ marginTop: 8 }}>
                <input type="hidden" name="toContactId" value={p.contactId} /><input type="hidden" name="back" value={`/capital/private/${p.id}`} />
                <select name="fromContactId" required defaultValue="" aria-label="Introducer"><option value="" disabled>Introducer</option>{people.filter(x => x.id !== p.contactId).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <input name="date" type="date" aria-label="Date" />
                <input name="context" placeholder="Context" aria-label="Context" />
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="compensation" /> Compensation associated</label>
                <button className="btn" type="submit">Record</button>
              </form>
            </details>
          </section>
        </aside>
      </div>
    </>
  );
}
