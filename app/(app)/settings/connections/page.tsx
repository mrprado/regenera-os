import { requireOsUser } from "@/lib/auth";
import { isOwner } from "@/lib/db/scoped";
import { googleConfig } from "@/lib/google/config";
import { listConnections } from "@/lib/settings";
import { sendTestEmail } from "../actions";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

const MAILBOXES = [
  { role: "primary", title: "regenera.bio mailbox", body: "Targeted-tier and warm threads. Replies are read from here." },
  { role: "sending", title: "Secondary sending domain", body: "Mass-tier outreach only. Warm up for 3 to 4 weeks before the first send." },
] as const;

const NOTICES: Record<string, [string, boolean]> = {
  connected: ["Mailbox connected.", true],
  sent: ["Test email sent. Check that mailbox's inbox.", true],
  denied: ["Google access was declined.", false],
  invalid_state: ["The connection link expired or was opened in another browser. Start again.", false],
  not_authorized: ["Only the signed-in owner who started the connection can finish it.", false],
  not_configured: ["Google OAuth is not configured yet. See docs/ENV.md.", false],
  error: ["Something went wrong. The details are in the server log.", false],
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/connections");
  const params = await searchParams;
  const notice = NOTICES[params.google ?? params.test ?? ""];
  const configured = googleConfig() !== null;
  const accounts = await listConnections();
  const owner = isOwner(user.scope);

  return (
    <>
      <h2>Connections</h2>
      {notice && <p className={`${styles.notice} ${notice[1] ? styles.noticeOk : ""}`}>{notice[0]}</p>}
      {!configured && (
        <p className={styles.notice}>Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY and APP_BASE_URL (docs/ENV.md).</p>
      )}
      <div className={styles.grid}>
        {MAILBOXES.map(m => {
          const acct = accounts.find(a => a.mailboxRole === m.role);
          return (
            <article key={m.role} className={styles.card}>
              <p className="eyebrow">{m.role}</p>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
              {acct ? (
                <dl className={styles.meta}>
                  <dt>Account</dt><dd>{acct.email}</dd>
                  <dt>Status</dt><dd><span className={`${styles.pill} ${acct.pausedUntil ? styles.pillWarn : styles.pillOk}`}>{acct.pausedUntil ? `Paused until ${acct.pausedUntil}` : "Connected"}</span></dd>
                  <dt>Daily cap</dt><dd>{acct.dailyCap}</dd>
                  {acct.warmupStartedOn && <><dt>Warm-up</dt><dd>Since {acct.warmupStartedOn}</dd></>}
                  <dt>Scopes</dt><dd className={styles.mono}>{acct.scopes.split(" ").map(s => s.split("/").pop()).join(", ")}</dd>
                </dl>
              ) : (
                <dl className={styles.meta}><dt>Status</dt><dd><span className={`${styles.pill} ${styles.pillMuted}`}>Not connected</span></dd></dl>
              )}
              {owner && configured && (
                <div className={styles.actions}>
                  <a className={`btn ${acct ? "" : "btn--primary"}`} href={`/api/oauth/google/start?mailbox=${m.role}`}>{acct ? "Reconnect" : "Connect Google"}</a>
                  {acct && (
                    <form action={sendTestEmail}>
                      <input type="hidden" name="mailbox" value={m.role} />
                      <button className="btn" type="submit">Send test to itself</button>
                    </form>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
