import Link from "next/link";
import {env} from "cloudflare:workers";
import { Bell, Menu } from "lucide-react";
import { withBase } from "@/lib/base-path";
import { requireOsUser } from "@/lib/auth";
import { and, eq, inArray } from "drizzle-orm";
import { mandates, tenants, tenantMembers } from "@/db/schema";
import { appDb, isInternal, isOwner } from "@/lib/db/scoped";
import { schedulerStatus } from "@/lib/settings";
import { openNotifications } from "@/lib/events/engine";
import AccountMenu from "./account-menu";
import WorkspaceShell, { SidebarToggle } from "./workspace-shell";
import { USER_TYPES } from "@/lib/tenancy/vocab";
import MandateSwitcher from "./mandate-switcher";
import { SidebarNav } from "./sidebar";
import styles from "./shell.module.css";
import WorkspaceTrail from './workspace-trail';
import ErrorReporter from "@/components/error-reporter";
import FormGuard from "@/components/form-guard";
import PinnedTray from "./pinned-tray";
import { listPins } from "@/lib/pins/queries";
import { currentOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// White header like regenera.bio, fern sidebar for navigation (Apollo layout, Regenera brand).
// Pages also call requireOsUser themselves: a layout guard alone does not cover every request path.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Signed out: render the page alone, so its own guard redirects with the right return path (not always /today).
  // Every page calls requireOsUser itself (tests/unit/route-guard.test.ts), so nothing renders unauthenticated.
  if (!(await currentOsUser())) return <>{children}</>;
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
  const [profile] = await appDb().select({ name: tenantMembers.name }).from(tenantMembers).where(and(eq(tenantMembers.email, user.email), eq(tenantMembers.status, "active"))).limit(1);
  // Pinned items (phase 25): access re-checked on every load; a failure never blocks the page.
  const pinned = user.visitor ? { pins: [], removed: 0 } : await listPins(appDb(), user.scope, user.email).catch(() => ({ pins: [], removed: 0 }));
  const focus = user.scope.mandateIds.length === 1 && memberOf.length > 1 ? user.scope.mandateIds[0] : "all";

  return (
    <WorkspaceShell><a className="skip-link" href="#main-content">Skip to workspace content</a>
      <header className={styles.header} data-shell-header>
        {/* Phone: the sidebar becomes a disclosure menu under the header, no client JS needed. */}
        <details className={styles.mobileMenu} data-mobile-navigation>
          <summary aria-label="Menu"><Menu size={20} aria-hidden /></summary>
          <div className={styles.mobilePanel}>{mandateOptions.length>1&&<MandateSwitcher options={mandateOptions} current={focus}/>}<SidebarNav user={navUser} variant="accordion" /></div>
        </details>
        <div className={styles.brandArea}><SidebarToggle /><Link href="/today" className={styles.brand} aria-label="Regenera OS, go to Command">REGENERA</Link></div>
        <div className={styles.headerSlot}>
          <WorkspaceTrail user={navUser}/>
          <PinnedTray pins={pinned.pins} removed={pinned.removed} canPin={!user.visitor && user.scope.userType !== "read_only"} />
          {mandateOptions.length > 1 && <MandateSwitcher options={mandateOptions} current={focus} />}
          <ErrorReporter /><FormGuard viewOnly={!!user.visitor || user.scope.userType === "read_only"} />
        </div>
        {/* Ask the OS lives in the sidebar above Settings; the header keeps the notification bell and the avatar menu. */}
        <div className={styles.account}>
          <Link className={styles.notificationsButton} href="/notifications" aria-label={`Notifications: ${unread} unread`} title="Notifications"><Bell size={20} aria-hidden />{unread > 0 && <span className={styles.notificationCount} style={open.some(n => n.priority === "critical" && !n.readAt) ? { background: "#b0432f" } : undefined}>{unread > 99 ? "99+" : unread}</span>}</Link>
          <AccountMenu name={profile?.name || user.displayName} email={user.email} typeLabel={USER_TYPES[user.scope.userType ?? "regenera_internal"].label} canManage={(isInternal(user.scope) && isOwner(user.scope)) || !!user.scope.adminOf?.length} visitor={!!user.visitor} />
        </div>
      </header>

      <aside className={styles.sidebar} id="workspace-sidebar">
        <SidebarNav user={navUser} />
      </aside>

      <div className={styles.content} data-shell-content>
        {user.visitor && <div className={styles.banner} role="status"><b>OPEN ACCESS · VIEW ONLY</b> Opened without a password. Nothing can be changed, sent or spent until you <a href={withBase("/signin?return_to=/today")}>sign in</a>.</div>}
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
    </WorkspaceShell>
  );
}
