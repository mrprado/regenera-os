import { redirect } from "next/navigation";
import styles from "@/components/portal.module.css";
import { withBase } from "@/lib/base-path";
import { currentPortalUser } from "@/lib/portal/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal sign in" };

export default async function PortalSignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await currentPortalUser();
  if (u) redirect(`/portal/${u.kind}`);
  return (
    <main style={{ maxWidth: 420, margin: "16vh auto", padding: "0 16px" }}>
      <p className="eyebrow">Regenera</p>
      <h1>Partner sign in</h1>
      <p className={styles.muted}>For sponsors, capital partners, introducers and project partners invited by Regenera.</p>
      {sp.signed_out && <p className={styles.muted}>You are signed out.</p>}
      {sp.error && <p role="alert" className={styles.warn}>Email or password is incorrect.</p>}
      <form method="post" action={withBase("/api/portal/signin")} className={styles.form}>
        <label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={200} /></label>
        <button className="btn btn--primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}
