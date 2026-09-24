import Link from "next/link";
import { PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";
import styles from "./settings.module.css";

export default async function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireOsUser("/settings");
  return (
    <section>
      <PageHeader title="Settings" />
      <nav className={styles.tabs} aria-label="Settings sections">
        <Link href="/settings/connections">Connections</Link>
        <Link href="/settings/sending">Sending</Link>
        <Link href="/settings/mandates">Mandates</Link>
        <Link href="/settings/extension">Extension</Link>
        <Link href="/settings/claude">Claude</Link>
        <Link href="/settings/jobs">Jobs</Link>
        <Link href="/settings/members">Members</Link>
      </nav>
      {children}
    </section>
  );
}
