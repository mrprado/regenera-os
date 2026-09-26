import { eq } from "drizzle-orm";
import { PortalShell } from "@/components/portal-shell";
import styles from "@/components/portal.module.css";
import { organizations } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { requirePortalUser } from "@/lib/portal/guard";
import { capitalView, portalDocuments, portalMessagesFor } from "@/lib/portal/views";
import { compactMoney } from "@/lib/projects/labels";
import { ASSET_CLASSES, INSTRUMENTS } from "@/lib/projects/vocab";
import { expressInterestAction } from "../actions";
import { DocumentsSection, MessagesSection } from "../sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital partner portal" };

export default async function CapitalPortal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePortalUser("capital");
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const v = await capitalView(appDb(), user);
  const selected = v.opportunities.find(o => o.id === sp.id);
  const [org] = user.orgId ? await appDb().select({ name: organizations.name, country: organizations.country }).from(organizations).where(eq(organizations.id, user.orgId)) : [];

  return (
    <PortalShell kind="capital" tab={tab} user={user} notice={sp.notice}>
      {tab === "overview" && (
        <>
          <h1>Opportunities shared with you</h1>
          <p className={styles.lede}>Only opportunities cleared for you appear here. Each item says where its information comes from.</p>
          <div className={styles.cards}>{v.opportunities.map(o => (
            <a key={o.id} className={styles.card} href={`?tab=opportunities&id=${o.id}`} style={{ color: "inherit" }}>
              <h3>{o.title}</h3>
              <p className={styles.muted}>{o.project?.name} · {o.project?.country ?? ""} · {o.project?.stage}</p>
              <p>{INSTRUMENTS[o.instrument as keyof typeof INSTRUMENTS] ?? o.instrument} · {compactMoney(o.target, o.currency)}</p>
            </a>
          ))}</div>
          {v.opportunities.length === 0 && <p className={styles.muted}>Nothing has been shared yet.</p>}
        </>
      )}
      {tab === "opportunities" && (
        selected ? (
          <>
            <p><a href="?tab=opportunities">All opportunities</a></p>
            <h1>{selected.title}</h1>
            <p className={styles.lede}><span className={styles.label}>Regenera analysis</span>{INSTRUMENTS[selected.instrument as keyof typeof INSTRUMENTS] ?? selected.instrument} · {compactMoney(selected.target, selected.currency)}{selected.jurisdictions.length ? ` · offered in ${selected.jurisdictions.join(", ")}` : ""}</p>
            {selected.project && (
              <div className={styles.card}>
                <h3>{selected.project.name}</h3>
                <p className={styles.muted}>{[selected.project.assetClass && ASSET_CLASSES[selected.project.assetClass as keyof typeof ASSET_CLASSES], selected.project.capacity && `${selected.project.capacity} ${selected.project.capacityUnit ?? ""}`, selected.project.country, `stage: ${selected.project.stage}`].filter(Boolean).join(" · ")}</p>
                {selected.project.description && <p style={{ whiteSpace: "pre-wrap" }}><span className={styles.label}>Sponsor provided</span>{selected.project.description}</p>}
              </div>
            )}
            {selected.offering && <section className={styles.section}><h2>Offering</h2><p style={{ whiteSpace: "pre-wrap" }}>{selected.offering}</p></section>}
            <section className={styles.section}>
              <h2>Approved materials</h2>
              {selected.approvedMaterials.length === 0 ? <p className={styles.muted}>None yet.</p> : <ul className={styles.list}>{selected.approvedMaterials.map(m => <li key={m.title + m.version}><span>{m.title}</span><span className={styles.muted}>version {m.version} · see Documents</span></li>)}</ul>}
            </section>
            <section className={styles.section}>
              <h2>Next step</h2>
              <form action={expressInterestAction} className={styles.form}>
                <input type="hidden" name="opportunityId" value={selected.id} />
                <label>Anything Regenera should know (optional)<textarea name="message" rows={3} /></label>
                <button className="btn btn--primary" type="submit">Express interest</button>
              </form>
            </section>
          </>
        ) : (
          <>
            <h1>Opportunities</h1>
            {v.opportunities.length === 0 ? <p className={styles.muted}>Nothing has been shared yet.</p> : <ul className={styles.list}>{v.opportunities.map(o => <li key={o.id}><a href={`?tab=opportunities&id=${o.id}`}>{o.title}</a><span className={styles.muted}>{compactMoney(o.target, o.currency)}</span></li>)}</ul>}
          </>
        )
      )}
      {tab === "documents" && <><h1>Documents</h1><DocumentsSection docs={await portalDocuments(appDb(), user)} /></>}
      {tab === "updates" && (
        <>
          <h1>Updates</h1>
          {v.updates.length === 0 ? <p className={styles.muted}>No updates yet.</p> : v.updates.map(u => <div key={u.id} className={styles.card} style={{ marginBottom: 12 }}><h3>{u.title}</h3><p className={styles.muted}>{u.publishedAt?.slice(0, 10)}</p><p style={{ whiteSpace: "pre-wrap" }}>{u.body}</p></div>)}
        </>
      )}
      {tab === "messages" && <><h1>Messages</h1><MessagesSection messages={await portalMessagesFor(appDb(), user)} /></>}
      {tab === "profile" && (
        <>
          <h1>Profile</h1>
          <div className={styles.card}><p><span className={styles.label}>Name</span>{user.name}</p><p><span className={styles.label}>Email</span>{user.email}</p><p><span className={styles.label}>Organization</span>{org?.name ?? "Not linked"}{org?.country ? ` · ${org.country}` : ""}</p></div>
          <p className={styles.muted}>To update your mandate (sectors, geographies, ticket, structures) send a message. Investor qualification is recorded separately, by jurisdiction, and verified by Regenera or a third party.</p>
        </>
      )}
    </PortalShell>
  );
}
