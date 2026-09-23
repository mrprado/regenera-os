import Link from "next/link";
import { chatGPTSignOutPath } from "@/lib/chatgpt-auth";
import { requireOsUser } from "@/lib/auth";
import { schedulerStatus } from "@/lib/settings";
import styles from "./shell.module.css";

export const dynamic = "force-dynamic";

const NAV = [
  ["/today", "Today"],
  ["/triggers", "Triggers"],
  ["/prospecting", "Prospecting"],
  ["/queue", "Queue"],
  ["/inbox", "Inbox"],
  ["/pipeline", "Pipeline"],
  ["/partners", "Partners"],
  ["/reports", "Reports"],
  ["/settings", "Settings"],
] as const;


// Pages also call requireOsUser themselves: a layout guard alone does not cover every request path.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireOsUser("/today");
  const { lastTick, stale: schedulerStale } = await schedulerStatus();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/today" className={styles.brand}>REGENERA <span>OS</span></Link>
        <nav className={styles.nav}>
          {NAV.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className={styles.user}>
          <span>{user.displayName}</span>
          <a href={chatGPTSignOutPath("/")} target="_top">Sign out</a>
        </div>
      </header>
      {schedulerStale && (
        <div className={styles.banner} role="status">
          Automation is paused: the job scheduler has not run {lastTick ? "in the last 30 minutes" : "yet"}. <Link href="/settings/jobs">Check jobs</Link>
        </div>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
