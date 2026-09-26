import Link from "next/link";
import { withBase } from "@/lib/base-path";
import { PORTAL_KINDS, type PortalKind } from "@/lib/portal/vocab";
import styles from "./portal.module.css";

export const PORTAL_NAV: Record<PortalKind, [string, string][]> = {
  sponsor: [["overview", "Overview"], ["requests", "Requests"], ["documents", "Documents"], ["capital", "Capital process"], ["updates", "Updates"], ["messages", "Messages"]],
  capital: [["overview", "Overview"], ["opportunities", "Opportunities"], ["documents", "Documents"], ["updates", "Updates"], ["messages", "Messages"], ["profile", "Profile"]],
  broker: [["overview", "Overview"], ["referrals", "Referrals"], ["opportunities", "Opportunities"], ["fees", "Fees"], ["documents", "Documents"], ["messages", "Messages"], ["profile", "Profile"]],
  partner: [["overview", "Overview"], ["opportunities", "Opportunities"], ["requests", "Requests"], ["documents", "Documents"], ["messages", "Messages"]],
  stakeholder: [["overview", "Overview"], ["documents", "Documents"], ["updates", "Updates"], ["messages", "Messages"]],
};

/** External portal chrome: simpler than the OS, no internal sidebar, one next action at a time. */
export function PortalShell({ kind, tab, user, notice, children }: { kind: PortalKind; tab: string; user: { name: string; email: string }; notice?: string; children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>REGENERA<span>Capital aligned with living systems · {PORTAL_KINDS[kind]} portal</span></div>
        <div className={styles.who}>
          <span>{user.name || user.email}</span>
          <form method="post" action={withBase("/api/portal/signout")}><button className="btn" type="submit">Sign out</button></form>
        </div>
      </header>
      <nav className={styles.nav} aria-label="Portal">
        {PORTAL_NAV[kind].map(([k, label]) => <Link key={k} href={`/portal/${kind}${k === "overview" ? "" : `?tab=${k}`}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>)}
      </nav>
      <main className={styles.main}>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {children}
        <p className={styles.foot}>Information here is shared by Regenera for the stated purpose only and is confidential. It is not an offer of securities or investment advice. Labels show where information comes from: Verified, Sponsor provided, Regenera analysis, Pending. Access is logged.</p>
      </main>
    </div>
  );
}
