import styles from "@/components/portal.module.css";
import { withBase } from "@/lib/base-path";
import { appDb } from "@/lib/db/scoped";
import { inviteUser } from "@/lib/portal/auth";
import { PORTAL_KINDS } from "@/lib/portal/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation" };

export default async function AcceptInvite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const row = await inviteUser(appDb(), token);
  return (
    <main style={{ maxWidth: 460, margin: "14vh auto", padding: "0 16px" }}>
      <p className="eyebrow">Regenera</p>
      {!row ? (
        <><h1>Invitation not valid</h1><p className={styles.muted}>This link has expired or was already used. Ask your Regenera contact for a new one.</p></>
      ) : (
        <>
          <h1>Welcome, {row.user.name || row.user.email}</h1>
          <p className={styles.muted}>Set a password for your {PORTAL_KINDS[row.user.kind].toLowerCase()} portal account ({row.user.email}).</p>
          {sp.error && <p role="alert" className={styles.warn}>{sp.error}</p>}
          <form method="post" action={withBase("/api/portal/invite")} className={styles.form}>
            <input type="hidden" name="token" value={token} />
            <label>Password (at least 12 characters, letters and a digit)<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} /></label>
            <label>Confirm<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} /></label>
            <button className="btn btn--primary" type="submit">Set password and continue</button>
          </form>
        </>
      )}
    </main>
  );
}
