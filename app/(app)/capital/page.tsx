import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalOpportunities, capitalProfiles, contacts, debtSecurities, introductions, organizations, privateCapitalProfiles, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { CAPITAL_TYPES, GATE_STATES, INTRO_STATUSES, INVESTOR_JOURNEY, RELATIONSHIP_STRENGTH } from "@/lib/capital/vocab";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { INSTRUMENTS } from "@/lib/projects/vocab";
import { addIntroductionAction, createCapitalProfileAction, createDebtSecurityAction, createPrivateProfileAction, introductionReviewedAction } from "../capital-actions";
import styles from "../projects/projects.module.css";
import CriteriaFields from "./criteria-fields";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital partners" };

const TABS = [["partners", "Capital partners"], ["private", "Private investors"], ["opportunities", "Capital opportunities"], ["introductions", "Introductions"], ["bonds", "Bonds and notes"]] as const;

export default async function CapitalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capital");
  const sp = await searchParams;
  const owner = isOwner(user.scope);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "partners";
  const db = appDb();
  const today = new Date().toISOString().slice(0, 10);

  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000);
  const people = tab === "private" || tab === "introductions" ? await db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(mandateCondition(user.scope, contacts.mandateId)).orderBy(asc(contacts.fullName)).limit(1000) : [];

  return (
    <>
      <PageHeader title="Capital partners" />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Commercial fit and regulatory eligibility are always shown separately. Investor classification is jurisdiction-specific and only ever recorded from an assessment, never inferred. Investment communications pass the compliance gate and always need your approval.</p>
      <nav className={ui.tabs} aria-label="Capital sections">
        {TABS.filter(([k]) => k !== "private" || owner).map(([k, label]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/capital${k === "partners" ? "" : `?tab=${k}`}`}>{label}</Link>)}
        <Link className={ui.tab} href="/capital/structures">Capital structures</Link>
        <Link className={ui.tab} href="/capital/alignment">Capital alignment</Link>
        <Link className={ui.tab} href="/capital/funding-pathways">Funding pathways</Link>
      </nav>

      {tab === "partners" && await (async () => {
        const rows = await db.select().from(capitalProfiles).where(and(mandateCondition(user.scope, capitalProfiles.mandateId), isNull(capitalProfiles.archivedAt))).orderBy(asc(capitalProfiles.name));
        return (
          <div className={r.grid}>
            <div className={ui.tableWrap}>
              {rows.length === 0 ? <p className={r.empty} style={{ padding: 14 }}>No capital partners yet: funds, family offices, DFIs, lenders, foundations and strategics with their mandates.</p> : (
                <table className={ui.table}>
                  <thead><tr><th>Partner</th><th>Type</th><th>Ticket</th><th>Relationship</th><th>Next action</th><th>Verified</th></tr></thead>
                  <tbody>{rows.map(p => (
                    <tr key={p.id}>
                      <td><Link className={ui.primary} href={`/capital/partners/${p.id}`}>{p.name}</Link><span className={ui.sub}>{[p.geographies.join(", "), p.instruments.map(i => INSTRUMENTS[i as keyof typeof INSTRUMENTS] ?? i).slice(0, 3).join(", ")].filter(Boolean).join(" · ") || "Criteria not known"}</span></td>
                      <td>{CAPITAL_TYPES[p.capitalType]}</td>
                      <td>{p.ticketMin || p.ticketMax ? `${compactMoney(p.ticketMin, p.currency ?? "USD")}–${compactMoney(p.ticketMax, p.currency ?? "USD")}` : <span className={ui.chipMuted}>Unknown</span>}</td>
                      <td>{RELATIONSHIP_STRENGTH[p.relationshipStrength]}</td>
                      <td>{p.nextAction ? <>{p.nextAction}<span className={ui.sub} style={{ color: p.nextActionDate && p.nextActionDate < today ? "#b0432f" : undefined }}>{p.nextActionDate}</span></> : "—"}</td>
                      <td>{p.lastVerifiedAt ? p.lastVerifiedAt.slice(0, 10) : <span className={ui.chipMuted}>Never</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <aside>
              <section className={r.panel}>
                <p className={r.panelTitle}>New capital partner</p>
                <form action={createCapitalProfileAction} className={styles.stack}>
                  <label>Name<input name="name" required minLength={2} /></label>
                  <label>Type<select name="capitalType" required>{Object.entries(CAPITAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Organization in the CRM<select name="orgId" defaultValue=""><option value="">None</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                  <label>Source<input name="source" placeholder="Where the criteria come from (website, call, mandate document)" /></label>
                  <CriteriaFields />
                  <button className="btn btn--primary" type="submit">Create</button>
                </form>
              </section>
            </aside>
          </div>
        );
      })()}

      {tab === "private" && owner && await (async () => {
        const rows = await db.select({ p: privateCapitalProfiles, name: contacts.fullName }).from(privateCapitalProfiles).innerJoin(contacts, eq(contacts.id, privateCapitalProfiles.contactId))
          .where(and(mandateCondition(user.scope, privateCapitalProfiles.mandateId), isNull(privateCapitalProfiles.archivedAt))).orderBy(asc(contacts.fullName));
        return (
          <div className={r.grid}>
            <div className={ui.tableWrap}>
              {rows.length === 0 ? <p className={r.empty} style={{ padding: 14 }}>No private investor profiles. Profiles are visible to entity owners only and never shared with Ask the OS or Claude connectors.</p> : (
                <table className={ui.table}>
                  <thead><tr><th>Person</th><th>Journey</th><th>Indicative ticket</th><th>Next action</th><th>Verified</th></tr></thead>
                  <tbody>{rows.map(({ p, name }) => (
                    <tr key={p.id}>
                      <td><Link className={ui.primary} href={`/capital/private/${p.id}`}>{name}</Link><span className={ui.sub}>{[p.primaryJurisdiction, p.geographies.join(", ")].filter(Boolean).join(" · ") || "Interests not known"}</span></td>
                      <td>{INVESTOR_JOURNEY[p.journeyStage]}</td>
                      <td>{p.ticketMin || p.ticketMax ? `${compactMoney(p.ticketMin, p.currency ?? "USD")}–${compactMoney(p.ticketMax, p.currency ?? "USD")}` : <span className={ui.chipMuted}>Unknown</span>}</td>
                      <td>{p.nextAction ?? "—"}<span className={ui.sub}>{p.nextActionDate}</span></td>
                      <td>{p.lastVerifiedAt ? p.lastVerifiedAt.slice(0, 10) : <span className={ui.chipMuted}>Never</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <aside>
              <section className={r.panel}>
                <p className={r.panelTitle}>New private investor profile</p>
                <form action={createPrivateProfileAction} className={styles.stack}>
                  <label>Person<select name="contactId" required defaultValue=""><option value="" disabled>Choose</option>{people.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label>How we know them<input name="relationshipSource" /></label>
                  <button className="btn btn--primary" type="submit">Create</button>
                </form>
                <p className={ui.sub}>A profile is not a classification: accredited, professional or sophisticated status is recorded separately, per jurisdiction, from an assessment.</p>
              </section>
            </aside>
          </div>
        );
      })()}

      {tab === "opportunities" && await (async () => {
        const rows = await db.select({ o: capitalOpportunities, project: projects.name }).from(capitalOpportunities).innerJoin(projects, eq(projects.id, capitalOpportunities.projectId))
          .where(mandateCondition(user.scope, capitalOpportunities.mandateId)).orderBy(desc(capitalOpportunities.updatedAt));
        return (
          <div className={ui.tableWrap}>
            {rows.length === 0 ? <p className={r.empty} style={{ padding: 14 }}>No capital opportunities. Create one from a project&apos;s Capital tab, per requirement or tranche.</p> : (
              <table className={ui.table}>
                <thead><tr><th>Opportunity</th><th>Instrument</th><th>Target</th><th>Jurisdictions</th><th>Gate</th><th>Status</th></tr></thead>
                <tbody>{rows.map(({ o, project }) => (
                  <tr key={o.id}>
                    <td><Link className={ui.primary} href={`/capital/opportunities/${o.id}`}>{o.title}</Link><span className={ui.sub}>{project}</span></td>
                    <td>{INSTRUMENTS[o.instrument as keyof typeof INSTRUMENTS] ?? o.instrument}</td>
                    <td>{compactMoney(o.target, o.currency)}</td>
                    <td>{o.jurisdictions.join(", ") || <span className={ui.chipMuted}>Not set</span>}</td>
                    <td><span className={o.gateState === "approved" ? ui.chip : ui.chipMuted}>{GATE_STATES[o.gateState]}</span></td>
                    <td>{o.status}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        );
      })()}

      {tab === "introductions" && await (async () => {
        const rows = await db.select().from(introductions).where(mandateCondition(user.scope, introductions.mandateId)).orderBy(desc(introductions.createdAt)).limit(200);
        const names = new Map(people.map(p => [p.id, p.name]));
        const orgNames = new Map(orgs.map(o => [o.id, o.name]));
        return (
          <div className={r.grid}>
            <div className={ui.tableWrap}>
              {rows.length === 0 ? <p className={r.empty} style={{ padding: 14 }}>No introductions recorded. Recording who introduced whom answers &quot;who can introduce us?&quot; later.</p> : (
                <table className={ui.table}>
                  <thead><tr><th>Introducer</th><th>To</th><th>Context</th><th>Status</th><th>Review</th></tr></thead>
                  <tbody>{rows.map(i => (
                    <tr key={i.id}>
                      <td>{names.get(i.fromContactId) ?? "—"}</td>
                      <td>{i.toContactId ? names.get(i.toContactId) : i.toOrgId ? orgNames.get(i.toOrgId) : "—"}</td>
                      <td>{i.context}<span className={ui.sub}>{i.date}</span></td>
                      <td>{INTRO_STATUSES[i.status]}</td>
                      <td>{i.reviewStatus === "review_required" ? (
                        <>
                          <b style={{ color: "#b0432f" }}>Compensation / regulatory review required</b>
                          {owner && <form action={introductionReviewedAction} className={styles.inline}><input type="hidden" name="id" value={i.id} /><input name="notes" placeholder="Reviewer and conclusion" required /><button className={ui.miniBtn} type="submit">Record review</button></form>}
                        </>
                      ) : i.reviewStatus === "reviewed" ? "Reviewed" : "Not required"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <aside>
              <section className={r.panel}>
                <p className={r.panelTitle}>Record an introduction</p>
                <form action={addIntroductionAction} className={styles.stack}>
                  <input type="hidden" name="back" value="/capital?tab=introductions" />
                  <label>Introducer<select name="fromContactId" required defaultValue=""><option value="" disabled>Choose</option>{people.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label>To (person)<select name="toContactId" defaultValue=""><option value="">None</option>{people.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label>To (organization)<select name="toOrgId" defaultValue=""><option value="">None</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                  <label>Date<input name="date" type="date" /></label>
                  <label>Context<input name="context" /></label>
                  <label>Status<select name="status" defaultValue="requested">{Object.entries(INTRO_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="compensation" /> Compensation is associated (flags a regulatory review)</label>
                  <button className="btn btn--primary" type="submit">Record</button>
                </form>
              </section>
            </aside>
          </div>
        );
      })()}

      {tab === "bonds" && await (async () => {
        const rows = await db.select().from(debtSecurities).where(mandateCondition(user.scope, debtSecurities.mandateId)).orderBy(desc(debtSecurities.createdAt));
        const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(mandateCondition(user.scope, projects.mandateId)).orderBy(asc(projects.name));
        return (
          <div className={r.grid}>
            <div className={ui.tableWrap}>
              {rows.length === 0 ? <p className={r.empty} style={{ padding: 14 }}>No bond or note programs. Issuers are data, not code: RA-ESG and third-party issuers use the same record.</p> : (
                <table className={ui.table}>
                  <thead><tr><th>Program</th><th>Issuer</th><th>Size</th><th>Coupon / maturity</th><th>Jurisdictions and restrictions</th><th>Status</th></tr></thead>
                  <tbody>{rows.map(b => (
                    <tr key={b.id}>
                      <td>{b.program}<span className={ui.sub}>{b.instrument}{b.isin ? ` · ${b.isin}` : ""}</span></td>
                      <td>{b.issuerOrgId ? orgs.find(o => o.id === b.issuerOrgId)?.name : "—"}</td>
                      <td>{compactMoney(b.issueSize, b.currency)}<span className={ui.sub}>min {compactMoney(b.minDenomination, b.currency)}</span></td>
                      <td>{b.coupon} {b.couponType}<span className={ui.sub}>{b.maturity}</span></td>
                      <td>{b.jurisdictions.join(", ")}<span className={ui.sub}>{b.offeringRestrictions}</span></td>
                      <td>{b.status.replace(/_/g, " ")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <aside>
              <section className={r.panel}>
                <p className={r.panelTitle}>Record a bond or note program</p>
                <form action={createDebtSecurityAction} className={styles.stack}>
                  <label>Program<input name="program" required /></label>
                  <label>Instrument<input name="instrument" placeholder="bond, note, green bond" /></label>
                  <label>Issuer<select name="issuerOrgId" defaultValue=""><option value="">Not set</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                  <label>Project<select name="projectId" defaultValue=""><option value="">None</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label>Currency<input name="currency" defaultValue="USD" /></label>
                  <label>Issue size<input name="issueSize" inputMode="decimal" /></label>
                  <label>Minimum denomination<input name="minDenomination" inputMode="decimal" /></label>
                  <label>Coupon<input name="coupon" /></label>
                  <label>Maturity<input name="maturity" type="date" /></label>
                  <label>Offering jurisdictions<input name="jurisdictions" placeholder="comma-separated" /></label>
                  <label>Offering restrictions<textarea name="offeringRestrictions" rows={2} /></label>
                  <label>Eligible recipients<input name="eligibleRecipients" /></label>
                  <label>Trustee<input name="trustee" /></label>
                  <label>Arranger<input name="arranger" /></label>
                  <label>Placement agent<input name="placementAgent" /></label>
                  <label>Counsel<input name="counsel" /></label>
                  <button className="btn btn--primary" type="submit">Record</button>
                </form>
              </section>
            </aside>
          </div>
        );
      })()}
    </>
  );
}
