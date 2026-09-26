import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { PortalShell } from "@/components/portal-shell";
import styles from "@/components/portal.module.css";
import { appDb } from "@/lib/db/scoped";
import { grantedIds } from "@/lib/portal/access";
import { requirePortalUser } from "@/lib/portal/guard";
import { portalDocuments, portalMessagesFor, stakeholderUpdates } from "@/lib/portal/views";
import { DocumentsSection, MessagesSection } from "../sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stakeholder portal" };

// Behind the PORTAL_STAKEHOLDER feature flag (§38): shared documents, approved updates and messages only.
export default async function StakeholderPortal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if ((env as { PORTAL_STAKEHOLDER?: string }).PORTAL_STAKEHOLDER !== "on") notFound();
  const user = await requirePortalUser("stakeholder");
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const updates = await stakeholderUpdates(appDb(), await grantedIds(appDb(), user, "project"));
  return (
    <PortalShell kind="stakeholder" tab={tab} user={user} notice={sp.notice}>
      {(tab === "overview" || tab === "updates") && (
        <>
          <h1>Project updates</h1>
          {updates.length === 0 ? <p className={styles.muted}>No updates yet.</p> : updates.map(u => <div key={u.id} className={styles.card} style={{ marginBottom: 12 }}><h3>{u.title}</h3><p className={styles.muted}>{u.publishedAt?.slice(0, 10)}</p><p style={{ whiteSpace: "pre-wrap" }}>{u.body}</p></div>)}
        </>
      )}
      {tab === "documents" && <><h1>Documents</h1><DocumentsSection docs={await portalDocuments(appDb(), user)} /></>}
      {tab === "messages" && <><h1>Messages</h1><MessagesSection messages={await portalMessagesFor(appDb(), user)} /></>}
    </PortalShell>
  );
}
