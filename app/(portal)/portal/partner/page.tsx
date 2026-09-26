import { PortalShell } from "@/components/portal-shell";
import styles from "@/components/portal.module.css";
import { appDb } from "@/lib/db/scoped";
import { requirePortalUser } from "@/lib/portal/guard";
import { partnerView, portalDocuments, portalMessagesFor } from "@/lib/portal/views";
import { BID_STATUSES } from "@/lib/procurement/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { submitProposalAction } from "../actions";
import { DocumentsSection, MessagesSection, RequestsSection } from "../sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partner portal" };

export default async function PartnerPortal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePortalUser("partner");
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const v = await partnerView(appDb(), user);

  return (
    <PortalShell kind="partner" tab={tab} user={user} notice={sp.notice}>
      {tab === "overview" && (
        <>
          <h1>Work with Regenera</h1>
          <p className={styles.lede}>Requests for proposals, what we need from you, and shared documents.</p>
          <div className={styles.cards}>
            <div className={styles.card}><h3>{v.packages.filter(p => p.open).length}</h3><p className={styles.muted}>Open requests for proposal</p></div>
            <div className={styles.card}><h3>{v.requests.filter(r => r.status === "open").length}</h3><p className={styles.muted}>Information requests</p></div>
          </div>
        </>
      )}
      {tab === "opportunities" && (
        <>
          <h1>Opportunities</h1>
          {v.packages.length === 0 ? <p className={styles.muted}>Nothing has been shared with you yet.</p> : v.packages.map(p => (
            <div key={p.id} className={styles.card} style={{ marginBottom: 14 }}>
              <h3>{p.name} · {p.category}</h3>
              <p className={styles.muted}>{p.project}{p.country ? ` · ${p.country}` : ""} · {p.stage}{p.bidsDueAt ? ` · proposals due ${p.bidsDueAt}` : ""}{p.requiredOnSiteAt ? ` · needed on site ${p.requiredOnSiteAt}` : ""}</p>
              {p.scope && <p style={{ whiteSpace: "pre-wrap" }}>{p.scope}</p>}
              {p.esRequirements && <p><span className={styles.label}>E&amp;S requirements</span>{p.esRequirements}</p>}
              {p.localContentTargetPct !== null && <p><span className={styles.label}>Local content target</span>{p.localContentTargetPct}%</p>}
              {p.bid && <p><span className={styles.label}>Your proposal</span>{BID_STATUSES[p.bid.status as keyof typeof BID_STATUSES]}{p.bid.price !== null ? ` · ${compactMoney(p.bid.price, p.bid.currency)}` : ""}{p.bid.submittedAt ? ` · ${p.bid.submittedAt}` : ""}</p>}
              {p.open ? (
                <form action={submitProposalAction} className={styles.form}>
                  <input type="hidden" name="packageId" value={p.id} />
                  <div className={styles.grid2}>
                    <label>Price<input name="price" inputMode="decimal" required defaultValue={p.bid?.price ?? ""} /></label>
                    <label>Currency<input name="currency" defaultValue={p.bid?.currency ?? "USD"} /></label>
                    <label>Schedule (weeks)<input name="scheduleWeeks" inputMode="decimal" defaultValue={p.bid?.scheduleWeeks ?? ""} /></label>
                    <label>Lead time (weeks)<input name="leadTimeWeeks" inputMode="decimal" defaultValue={p.bid?.leadTimeWeeks ?? ""} /></label>
                    <label>Warranty (years)<input name="warrantyYears" inputMode="decimal" defaultValue={p.bid?.warrantyYears ?? ""} /></label>
                    <label>Country of manufacture<input name="originCountry" /></label>
                  </div>
                  <label>Exceptions and clarifications<textarea name="exceptions" rows={3} defaultValue={p.bid?.exceptions ?? ""} /></label>
                  <button className="btn btn--primary" type="submit">{p.bid?.submittedAt ? "Revise proposal" : "Submit proposal"}</button>
                </form>
              ) : <p className={styles.muted}>Not accepting proposals at this stage.</p>}
            </div>
          ))}
        </>
      )}
      {tab === "requests" && <><h1>Requests</h1><RequestsSection requests={v.requests} /></>}
      {tab === "documents" && <><h1>Documents</h1><DocumentsSection docs={await portalDocuments(appDb(), user)} /></>}
      {tab === "messages" && <><h1>Messages</h1><MessagesSection messages={await portalMessagesFor(appDb(), user)} /></>}
    </PortalShell>
  );
}
