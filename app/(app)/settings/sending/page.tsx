import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { outreachConfig, sendPolicy } from "@/lib/config";
import { isOwner } from "@/lib/db/scoped";
import { deliverabilityIssues } from "@/lib/outreach/deliverability";
import { sendingOverview } from "@/lib/outreach/queries";
import { capFor, etDay } from "@/lib/outreach/sender";
import { DEFAULT_WINDOWS } from "@/lib/time/windows";
import { deliverabilityNowAction, mailboxPauseAction } from "../../outreach-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sending" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ok = (v: boolean) => <span className={`${ui.chip} ${v ? ui.chipReed : ui.chipEmber}`}>{v ? "OK" : "Missing"}</span>;

export default async function SendingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/sending");
  const sp = await searchParams;
  const owner = isOwner(user.scope);
  const cfg = outreachConfig();
  const policy = sendPolicy();
  const { boxes, state, checks } = await sendingOverview();
  const now = new Date();
  const today = etDay(now);

  return (
    <>
      <Notice text={sp.notice} />
      {!policy.production && (
        <p className={ui.notice}>Not production (<code>APP_ENV</code>): sequence email only goes to {policy.allowedDomains.length ? policy.allowedDomains.join(", ") : "no domains yet (set SEND_ALLOWED_DOMAINS)"}. Everything else fails safely.</p>
      )}
      {!cfg.unsubscribe && <p className={ui.notice}>Set <code>UNSUBSCRIBE_SIGNING_SECRET</code>: mass-tier email never sends without a signed unsubscribe link.</p>}

      <h2 style={{ fontSize: 16, margin: "8px 0 10px" }}>Mailboxes and daily caps</h2>
      <div className={ui.tableWrap} style={{ marginBottom: 22 }}>
        <table className={ui.table}>
          <thead><tr><th>Mailbox</th><th>Tier</th><th className={ui.num}>Sent today</th><th className={ui.num}>Cap today</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(["primary", "sending"] as const).map(role => {
              const box = boxes.find(b => b.role === role);
              const st = state.find(s => s.role === role);
              const paused = st?.pausedUntil && st.pausedUntil > now.toISOString();
              return (
                <tr key={role}>
                  <td><span className={ui.primary}>{box?.email ?? "Not connected"}</span><span className={ui.sub}>{role === "primary" ? "regenera.bio" : cfg.sendingDomain ?? "secondary domain (set SENDING_DOMAIN)"}</span></td>
                  <td>{role === "primary" ? "Targeted and replies" : "Mass"}</td>
                  <td className={ui.num}>{st?.day === today ? st.sentToday : 0}</td>
                  <td className={ui.num}>{capFor(role, cfg.caps, now)}{role === "sending" && cfg.caps.warmupStartedOn ? <span className={ui.sub}>warm-up since {cfg.caps.warmupStartedOn}</span> : null}</td>
                  <td>{paused ? <><span className={`${ui.chip} ${ui.chipEmber}`}>Paused</span><span className={ui.sub}>{st?.pauseReason} · until {st?.pausedUntil?.slice(0, 16).replace("T", " ")} UTC</span></> : <span className={`${ui.chip} ${ui.chipReed}`}>Active</span>}</td>
                  <td>{owner && box && (
                    <form action={mailboxPauseAction}>
                      <input type="hidden" name="role" value={role} />
                      {paused ? <button className={ui.miniBtn} name="resume" value="1" type="submit">Resume</button> : <button className={ui.miniBtn} type="submit">Pause 7 days</button>}
                    </form>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Send windows (recipient&apos;s local time)</h2>
      <p style={{ fontSize: 13.5, margin: "0 0 22px" }}>
        {[1, 2, 3, 4, 5].map(d => `${DAYS[d]} ${DEFAULT_WINDOWS[d].map(w => `${w.from} to ${w.to}`).join(" and ")}`).join(" · ")}. No weekends. Time zone from the contact, else their country, else New York.
      </p>

      <div className={ui.toolbar}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Deliverability</h2>
        {owner && <form action={deliverabilityNowAction}><button className={ui.miniBtn} type="submit">Check now</button></form>}
      </div>
      {checks.length === 0 ? <p style={{ fontSize: 13.5 }}>No check yet. It runs daily at 06:00 ET.</p> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Domain</th><th>SPF</th><th>DKIM</th><th>DMARC</th><th>MX</th><th className={ui.num}>Bounce rate (7 days)</th><th>Checked</th></tr></thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.id}>
                  <td><span className={ui.primary}>{c.domain}</span>{deliverabilityIssues(c).map(i => <span key={i} className={ui.sub}>{i}</span>)}</td>
                  <td>{ok(c.spf)}</td><td>{ok(c.dkim)}</td>
                  <td><span className={`${ui.chip} ${c.dmarc === "missing" ? ui.chipEmber : c.dmarc === "none" ? ui.chipPollen : ui.chipReed}`}>{c.dmarc}</span></td>
                  <td>{ok(c.mx)}</td>
                  <td className={ui.num}>{c.bounceRate !== null ? `${(c.bounceRate * 100).toFixed(1)}%` : "—"}</td>
                  <td>{c.checkedAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
