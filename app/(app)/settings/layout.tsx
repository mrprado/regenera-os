import Link from "next/link";
import { requireOsUser } from "@/lib/auth";
import styles from "./settings.module.css";

export default async function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireOsUser("/settings");
  return (
    <section>
      <p className="eyebrow">Settings</p>
      <nav className={styles.tabs} aria-label="Settings sections">
        <Link href="/settings/connections">Connections</Link>
        <Link href="/settings/jobs">Jobs</Link>
        <Link href="/settings/members">Members</Link>
      </nav>
      {children}
    </section>
  );
}
