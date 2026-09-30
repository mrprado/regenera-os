import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import { withBase } from "@/lib/base-path";
import { requireOsUser } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";
import { mandates, tenants } from "@/db/schema";
import { appDb, isInternal } from "@/lib/db/scoped";
import { schedulerStatus } from "@/lib/settings";
import { openNotifications } from "@/lib/events/engine";
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
  const open = await openNotifications(appDb(), user.scope.mandateIds, user.email, new Date(), 200);
  const unread = open.filter(n => !n.readAt).length;
  const memberOf = user.scope.memberOf ?? user.scope.mandateIds;
  const mandateOptions = memberOf.length > 1
    ? (await appDb().select({ id: mandates.id, name: mandates.name, sandbox: mandates.sandbox, tenant: tenants.displayName }).from(mandates).leftJoin(tenants, eq(tenants.id, mandates.tenantId)).where(inArray(mandates.id, memberOf)))
      .map(m => ({ id: m.id, name: `${m.name}${m.sandbox ? " · SANDBOX" : ""}`, group: m.tenant ?? "Regenera" }))
    : [];
  const navUser = { modules: user.scope.modules ?? "all", internal: isInternal(user.scope) };
  const sandboxFocus = user.scope.mandateIds.length === 1 ? (await appDb().select({ sandbox: mandates.sandbox }).from(mandates).where(eq(mandates.id, user.scope.mandateIds[0])))[0]?.sandbox : false;
  const focus = user.scope.mandateIds.length === 1 && memberOf.length > 1 ? user.scope.mandateIds[0] : "all";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {/* Phone: the sidebar becomes a disclosure menu under the header, no client JS needed. */}
        <details className={styles.mobileMenu}>
          <summary aria-label="Menu"><Menu size={20} aria-hidden /></summary>
          <div className={styles.mobilePanel}><SidebarNav user={navUser} variant="accordion" /></div>
        </details>
        <Link href="/today" className={styles.brand}>REGENERA <b>OS</b></Link>
        <div className={styles.headerSlot}>
          {mandateOptions.length > 1 && <MandateSwitcher options={mandateOptions} current={focus} />}
          <CommandBar nav={navUser} />
        </div>
        <div className={styles.account}>
          <Link href="/notifications" className={styles.accountName} aria-label={`Notifications: ${unread} unread`} title="Notifications" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Bell size={16} aria-hidden />{unread > 0 && <b style={{ color: open.some(n => n.priority === "critical" && !n.readAt) ? "#b0432f" : undefined }}>{unread}</b>}</Link>
          <span className={styles.accountName} title={user.email}>{user.displayName}</span>
          <span className={styles.avatar} aria-hidden>{initials(user.displayName)}</span>
          <form method="post" action={withBase("/api/auth/signout")}><button type="submit" className={styles.signOut}>Sign out</button></form>
        </div>
      </header>

      <aside className={styles.sidebar}>
        <SidebarNav user={navUser} />
      </aside>

      <div className={styles.content}>
        {sandboxFocus && <div className={styles.banner} role="status"><b>SANDBOX</b> You are working in a sandbox workspace: test data only, never mixed with production records.</div>}
        {schedulerStale && isInternal(user.scope) && (
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
