import Link from "next/link";
import { chatGPTSignOutPath } from "@/lib/chatgpt-auth";
import { requireOsUser } from "@/lib/auth";
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

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireOsUser("/today");
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
      <main className={styles.main}>{children}</main>
    </div>
  );
}
