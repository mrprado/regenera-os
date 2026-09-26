import { PortalShell } from "@/components/portal-shell";
import styles from "@/components/portal.module.css";
import { appDb } from "@/lib/db/scoped";
import { requirePortalUser } from "@/lib/portal/guard";
import { brokerView, portalDocuments, portalMessagesFor } from "@/lib/portal/views";
import { AGREEMENT_STATUSES, BROKER_ROLES, BROKER_STATUSES, COMMISSION_STATUSES, REFERRAL_STATUSES, REFERRAL_TARGETS } from "@/lib/portal/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { registerReferralAction } from "../actions";
import { DocumentsSection, MessagesSection } from "../sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Introducer portal" };

export default async function BrokerPortal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePortalUser("broker");
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const v = await brokerView(appDb(), user);
  const approved = v.referrals.filter(r => r.status === "approved" || r.status === "converted").length;

  return (
    <PortalShell kind="broker" tab={tab} user={user} notice={sp.notice}>
      {!v.standing.active && <p className={styles.notice}>Your account is not active for deals or materials yet: {v.standing.reasons.join("; ")}. You can still register introductions for review.</p>}
      {tab === "overview" && (
        <>
          <h1>Introductions</h1>
          <p className={styles.lede}>Register an introduction before you make it. Regenera checks it against existing relationships and other claims; any fee depends only on your signed agreement.</p>
          <div className={styles.cards}>
            <div className={styles.card}><h3>{v.referrals.length}</h3><p className={styles.muted}>Registered</p></div>
            <div className={styles.card}><h3>{approved}</h3><p className={styles.muted}>Approved</p></div>
            <div className={styles.card}><h3>{v.opportunities.length}</h3><p className={styles.muted}>Opportunities shared with you</p></div>
            <div className={styles.card}><h3>{v.fees.filter(f => f.status === "paid").length}</h3><p className={styles.muted}>Fees paid</p></div>
          </div>
        </>
      )}
      {tab === "referrals" && (
        <>
          <h1>Referrals</h1>
          <section className={styles.section}>
            <h2>Register an introduction</h2>
            <form action={registerReferralAction} className={styles.form}>
              <div className={styles.grid2}>
                <label>Type<select name="targetType" required>{Object.entries(REFERRAL_TARGETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label>Name<input name="name" required minLength={2} /></label>
                <label>Organization<input name="organization" /></label>
                <label>Contact email<input name="contactEmail" type="email" /></label>
                <label>Jurisdiction (country code)<input name="jurisdiction" maxLength={3} placeholder="MX" /></label>
              </div>
              <label>How you know them<textarea name="relationship" rows={2} /></label>
              <label>Intended introduction<textarea name="intendedIntroduction" rows={2} placeholder="To whom, for what" /></label>
              <label>Evidence (e.g. prior correspondence date)<input name="evidence" /></label>
              <label>Notes<textarea name="notes" rows={2} /></label>
              <button className="btn btn--primary" type="submit">Register</button>
              <p className={styles.muted}>Do not send investment materials or discuss terms unless Regenera has approved it for you in writing. Registration does not create a fee entitlement.</p>
            </form>
          </section>
          <section className={styles.section}>
            <h2>Your registrations</h2>
            {v.referrals.length === 0 ? <p className={styles.muted}>None yet.</p> : <ul className={styles.list}>{v.referrals.map(r => <li key={r.id}><span><b>{r.name}</b>{r.organization ? ` · ${r.organization}` : ""} <span className={styles.label}>{REFERRAL_TARGETS[r.targetType]}</span>{r.decisionNote && <><br /><span className={styles.muted}>{r.decisionNote}</span></>}</span><span className={styles.muted}>{REFERRAL_STATUSES[r.status]}{r.expiresAt ? ` · protected to ${r.expiresAt}` : ""}</span></li>)}</ul>}
          </section>
        </>
      )}
      {tab === "opportunities" && (
        <>
          <h1>Opportunities</h1>
          {v.opportunities.length === 0 ? <p className={styles.muted}>No opportunities are shared with you.</p> : <ul className={styles.list}>{v.opportunities.map(o => <li key={o.id}><span>{o.title}</span><span className={styles.muted}>{compactMoney(o.target, o.currency)}</span></li>)}</ul>}
        </>
      )}
      {tab === "fees" && (
        <>
          <h1>Fees</h1>
          <p className={styles.lede}>Amounts marked Estimated are subject to your agreement and Regenera&apos;s approvals.</p>
          {v.fees.length === 0 ? <p className={styles.muted}>No fee records.</p> : <ul className={styles.list}>{v.fees.map(f => <li key={f.id}><span>{compactMoney(f.amount, f.currency)}</span><span className={styles.muted}>{COMMISSION_STATUSES[f.status]}{f.paidAt ? ` · paid ${f.paidAt.slice(0, 10)}` : ""}</span></li>)}</ul>}
        </>
      )}
      {tab === "documents" && <><h1>Documents</h1><DocumentsSection docs={await portalDocuments(appDb(), user)} /></>}
      {tab === "messages" && <><h1>Messages</h1><MessagesSection messages={await portalMessagesFor(appDb(), user)} /></>}
      {tab === "profile" && (
        <>
          <h1>Profile</h1>
          {v.profile ? (
            <div className={styles.card}>
              <p><span className={styles.label}>Role</span>{BROKER_ROLES[v.profile.roleType]}</p>
              <p><span className={styles.label}>Status</span>{BROKER_STATUSES[v.profile.complianceStatus]}</p>
              <p><span className={styles.label}>Agreement</span>{AGREEMENT_STATUSES[v.profile.agreementStatus]}{v.profile.agreementExpiresAt ? ` · until ${v.profile.agreementExpiresAt}` : ""}</p>
              <p><span className={styles.label}>Jurisdictions</span>{v.profile.jurisdictions.join(", ") || "Not recorded"}</p>
              <p><span className={styles.label}>Licence</span>{v.profile.licenseStatus}</p>
            </div>
          ) : <p className={styles.muted}>No profile yet.</p>}
          <p className={styles.muted}>A role label does not give authority to offer securities. Licences are verified by Regenera before any securities-related material is shared.</p>
        </>
      )}
    </PortalShell>
  );
}
