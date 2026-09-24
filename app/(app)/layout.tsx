import Link from "next/link";
import { Menu } from "lucide-react";
import { withBase } from "@/lib/base-path";
import { requireOsUser } from "@/lib/auth";
import { inArray } from "drizzle-orm";
import { mandates } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { schedulerStatus } from "@/lib/settings";
import CommandBar from "./command-bar";
import MandateSwitcher from "./mandate-switcher";
import { SidebarNav } from "./sidebar";
import styles from "./shell.module.css";

export const dynamic = "force-dynamic";

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

// White header like regenera.bio, fern sidebar for navigation (Apollo layout, Regenera brand).
// Pages also call requireOsUser themselves: a layout guard alone does not cover every request path.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireOsUser("/today");
  const { lastTick, stale: schedulerStale } = await schedulerStatus();
  const memberOf = user.scope.memberOf ?? user.scope.mandateIds;
  const mandateOptions = memberOf.length > 1 ? await appDb().select({ id: mandates.id, name: mandates.name }).from(mandates).where(inArray(mandates.id, memberOf)) : [];
  const focus = user.scope.mandateIds.length === 1 && memberOf.length > 1 ? user.scope.mandateIds[0] : "all";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {/* Phone: the sidebar becomes a disclosure menu under the header, no client JS needed. */}
        <details className={styles.mobileMenu}>
          <summary aria-label="Menu"><Menu size={20} aria-hidden /></summary>
          <div className={styles.mobilePanel}><SidebarNav /></div>
        </details>
        <Link href="/today" className={styles.brand}>REGENERA <b>OS</b></Link>
        <div className={styles.headerSlot}>
          {mandateOptions.length > 1 && <MandateSwitcher options={mandateOptions} current={focus} />}
          <CommandBar />
        </div>
        <div className={styles.account}>
          <span className={styles.accountName} title={user.email}>{user.displayName}</span>
          <span className={styles.avatar} aria-hidden>{initials(user.displayName)}</span>
          <form method="post" action={withBase("/api/auth/signout")}><button type="submit" className={styles.signOut}>Sign out</button></form>
        </div>
      </header>

      <aside className={styles.sidebar}>
        <SidebarNav />
      </aside>

      <div className={styles.content}>
        {schedulerStale && (
          <div className={styles.banner} role="status">
            Automation is paused: the job scheduler has not run {lastTick ? "in the last 30 minutes" : "yet"}.
            <Link href="/settings/jobs">Check jobs</Link>
          </div>
        )}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
