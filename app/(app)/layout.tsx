import Link from "next/link";
import {env} from "cloudflare:workers";
import { Bell, Menu } from "lucide-react";
import { withBase } from "@/lib/base-path";
import { requireOsUser } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";
import { mandates, tenants } from "@/db/schema";
import { appDb, isInternal, isOwner } from "@/lib/db/scoped";
import { schedulerStatus } from "@/lib/settings";
import { openNotifications } from "@/lib/events/engine";
import CommandBar from "./command-bar";
import MandateSwitcher from "./mandate-switcher";
import { SidebarNav } from "./sidebar";
import styles from "./shell.module.css";
import WorkspaceTrail from './workspace-trail';
import ErrorReporter from "@/components/error-reporter";
import { currentEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

// White header like regenera.bio, fern sidebar for navigation (Apollo layout, Regenera brand).
// Pages also call requireOsUser themselves: a layout guard alone does not cover every request path.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Signed out: render the page alone, so its own guard redirects with the right return path (not always /today).
  // Every page calls requireOsUser itself (tests/unit/route-guard.test.ts), so nothing renders unauthenticated.
  if (!(await currentEmail())) return <>{children}</>;
  const user = await requireOsUser("/today");
  const { lastTick, stale: schedulerStale } = await schedulerStatus();
  const open = await openNotifications(appDb(), user.scope.mandateIds, user.email, new Date(), 200);
  const unread = open.filter(n => !n.readAt).length;
  const memberOf = user.scope.memberOf ?? user.scope.mandateIds;
  const mandateOptions = memberOf.length > 1
    ? (await appDb().select({ id: mandates.id, name: mandates.name, sandbox: mandates.sandbox, tenant: tenants.displayName }).from(mandates).leftJoin(tenants, eq(tenants.id, mandates.tenantId)).where(inArray(mandates.id, memberOf)))
      .map(m => ({ id: m.id, name: `${m.name}${m.sandbox ? " · SANDBOX" : ""}`, group: m.tenant ?? "Regenera" }))
    : [];
  const navUser = { modules: user.scope.modules ?? "all", internal: isInternal(user.scope), owner:isOwner(user.scope) };
  const sandboxFocus = user.scope.mandateIds.length === 1 ? (await appDb().select({ sandbox: mandates.sandbox }).from(mandates).where(eq(mandates.id, user.scope.mandateIds[0])))[0]?.sandbox : false;
  const focus = user.scope.mandateIds.length === 1 && memberOf.length > 1 ? user.scope.mandateIds[0] : "all";

  return (
    <div className={styles.shell} data-ui="regenera"><a className="skip-link" href="#main-content">Skip to workspace content</a>
      <header className={styles.header}>
        {/* Phone: the sidebar becomes a disclosure menu under the header, no client JS needed. */}
        <details className={styles.mobileMenu} data-mobile-navigation>
          <summary aria-label="Menu"><Menu size={20} aria-hidden /></summary>
          <div className={styles.mobilePanel}>{mandateOptions.length>1&&<MandateSwitcher options={mandateOptions} current={focus}/>}<SidebarNav user={navUser} variant="accordion" /></div>
        </details>
        <Link href="/today" className={styles.brand}>REGENERA <b>OS</b></Link>
        <div className={styles.headerSlot}>
          <WorkspaceTrail user={navUser}/>
          {mandateOptions.length > 1 && <MandateSwitcher options={mandateOptions} current={focus} />}
          <CommandBar nav={navUser} /><ErrorReporter />
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
        {(env.ISOLATED_DEMO==='true'||sandboxFocus||(schedulerStale&&isInternal(user.scope)))&&<details className={styles.statusStrip}><summary><span className={styles.statusLabel}>{env.ISOLATED_DEMO==='true'?'Demo workspace':sandboxFocus?'Sandbox workspace':'Automation paused'}</span><span>{env.ISOLATED_DEMO==='true'?'Fictional records · external actions disabled':'Workspace operating status'}</span><span>Details</span></summary><div className={styles.statusBody}>
        {env.ISOLATED_DEMO === "true" && <div className={styles.banner} role="status"><b>PRIVATE DEMO</b> Same Regenera build; fictional data and isolated storage. External actions are disabled. <Link href="/demo">Change demo identity</Link></div>}
        {sandboxFocus && <div className={styles.banner} role="status"><b>SANDBOX</b> You are working in a sandbox workspace: test data only, never mixed with production records.</div>}
        {schedulerStale && isInternal(user.scope) && (
          <div className={styles.banner} role="status">
            Automation is paused: the job scheduler has not run {lastTick ? "in the last 30 minutes" : "yet"}.
            <Link href="/settings/jobs">Check jobs</Link>
          </div>
        )}
        </div></details>}
        <main className={styles.main} id="main-content">{children}</main>
      </div>
    </div>
  );
}
