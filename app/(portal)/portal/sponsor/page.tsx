import { PortalShell } from "@/components/portal-shell";
import styles from "@/components/portal.module.css";
import { appDb } from "@/lib/db/scoped";
import { requirePortalUser } from "@/lib/portal/guard";
import { portalDocuments, portalMessagesFor, sponsorView } from "@/lib/portal/views";
import { compactMoney } from "@/lib/projects/labels";
import { INSTRUMENTS } from "@/lib/projects/vocab";
import { DocumentsSection, MessagesSection, RequestsSection } from "../sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sponsor portal" };

export default async function SponsorPortal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePortalUser("sponsor");
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const v = await sponsorView(appDb(), user);
  const open = v.requests.filter(r => r.status === "open" || r.status === "rejected");

  return (
    <PortalShell kind="sponsor" tab={tab} user={user} notice={sp.notice}>
      {tab === "overview" && (
        <>
          <h1>Your project{v.projects.length === 1 ? "" : "s"} with Regenera</h1>
          <p className={styles.lede}>Where things stand, what we need from you, and what happens next.</p>
          {v.projects.length === 0 ? <p className={styles.muted}>No project has been shared with this account yet.</p> : (
            <div className={styles.cards}>{v.projects.map(p => (
              <div key={p.id} className={styles.card}>
                <h3>{p.name}</h3>
                <p className={styles.muted}>{[p.subdivision, p.country].filter(Boolean).join(", ")}</p>
                <p><span className={styles.label}>Stage</span>{p.stageLabel} since {p.stageChangedAt.slice(0, 10)}</p>
              </div>
            ))}</div>
          )}
          <section className={styles.section}>
            <h2>What Regenera needs</h2>
            {open.length === 0 ? <p className={styles.muted}>Nothing outstanding.</p> : <ul className={styles.list}>{open.slice(0, 6).map(r => <li key={r.id}><span>{r.title}</span><span className={styles.muted}>{r.dueDate ? `due ${r.dueDate}` : ""}</span></li>)}</ul>}
          </section>
          {v.updates[0] && <section className={styles.section}><h2>Latest update</h2><div className={styles.card}><h3>{v.updates[0].title}</h3><p className={styles.muted}>{v.updates[0].publishedAt?.slice(0, 10)}</p><p style={{ whiteSpace: "pre-wrap" }}>{v.updates[0].body}</p></div></section>}
        </>
      )}
      {tab === "requests" && <><h1>Requests</h1><RequestsSection requests={v.requests} /></>}
      {tab === "documents" && <><h1>Documents</h1><DocumentsSection docs={await portalDocuments(appDb(), user)} /></>}
      {tab === "capital" && (
        <>
          <h1>Capital process</h1>
          <p className={styles.lede}>How the raise is organised. Investor identities and discussions stay confidential between Regenera and each investor; you see the process, not the names.</p>
          {v.capital.length === 0 ? <p className={styles.muted}>No capital process has started yet.</p> : (
            <ul className={styles.list}>{v.capital.map(c => <li key={c.id}><span><b>{c.title}</b><br /><span className={styles.muted}>{INSTRUMENTS[c.instrument as keyof typeof INSTRUMENTS] ?? c.instrument} · {compactMoney(c.target, c.currency)} · {c.status}</span></span><span className={styles.muted}>{c.investorsApproached} investor{c.investorsApproached === 1 ? "" : "s"} approved for approach</span></li>)}</ul>
          )}
        </>
      )}
      {tab === "updates" && (
        <>
          <h1>Updates</h1>
          {v.updates.length === 0 ? <p className={styles.muted}>No updates yet.</p> : v.updates.map(u => <div key={u.id} className={styles.card} style={{ marginBottom: 12 }}><h3>{u.title}</h3><p className={styles.muted}>{u.publishedAt?.slice(0, 10)}</p><p style={{ whiteSpace: "pre-wrap" }}>{u.body}</p></div>)}
        </>
      )}
      {tab === "messages" && <><h1>Messages</h1><MessagesSection messages={await portalMessagesFor(appDb(), user)} /></>}
    </PortalShell>
  );
}
