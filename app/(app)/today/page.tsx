import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { homeData } from "@/lib/crm/home";
import { deliverabilityIssues } from "@/lib/outreach/deliverability";
import { engageCounts, sendingOverview, upcomingMeetings } from "@/lib/outreach/queries";
import { and, desc, eq } from "drizzle-orm";
import { proposals } from "@/db/schema";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { confirmProposalAction, rejectProposalAction } from "../intel-actions";
import { DEAL_STAGES } from "@/lib/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

function Stat({ n, label, href, warn }: { n: number | string; label: string; href?: string; warn?: boolean }) {
  const body = <><b style={warn && Number(n) > 0 ? { color: "#b0432f" } : undefined}>{n}</b><span>{label}</span></>;
  return href ? <Link className={ui.stat} href={href}>{body}</Link> : <div className={ui.stat}>{body}</div>;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/today");
  const sp = await searchParams;
  const [d, engage, sending, meetings] = await Promise.all([homeData(user.scope), engageCounts(user.scope), sendingOverview(), upcomingMeetings(user.scope)]);
  const pending = await appDb().select({ id: proposals.id, title: proposals.title, source: proposals.source, createdAt: proposals.createdAt }).from(proposals)
    .where(and(mandateCondition(user.scope, proposals.mandateId), eq(proposals.status, "pending"), eq(proposals.kind, "action"))).orderBy(desc(proposals.createdAt)).limit(10);
  const now = new Date().toISOString();
  const alerts = [
    ...sending.checks.flatMap(c => deliverabilityIssues(c)),
    ...sending.state.filter(s => s.pausedUntil && s.pausedUntil > now).map(s => `${s.role === "primary" ? "regenera.bio" : "Sending"} mailbox paused: ${s.pauseReason ?? ""}`),
  ];
  const first = user.displayName.split(/[\s@]/)[0];
  const ai = aiConfig();
  const apollo = apolloConfig();
  return (
    <>
      <PageHeader title={`Good to see you, ${first}`} />
      <Notice text={sp.notice} />
      {alerts.length > 0 && <p className={ui.notice}><Link href="/settings/sending">Sending</Link>: {alerts.join(" · ")}</p>}
      {pending.length > 0 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Waiting for your confirmation</p>
          <table className={ui.table}><tbody>{pending.map(p => (
            <tr key={p.id}>
              <td className={ui.wrap}>{p.title}<span className={ui.sub}>Proposed {p.source === "mcp" ? "from Claude" : "by Ask the OS"} · {p.createdAt.slice(0, 16).replace("T", " ")}</span></td>
              <td><div className={ui.rowActions}>
                <form action={confirmProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/today" /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Confirm</button></form>
                <form action={rejectProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/today" /><button className={ui.miniBtn} type="submit">Discard</button></form>
              </div></td>
            </tr>
          ))}</tbody></table>
        </section>
      )}
      <div className={ui.stats}>
        <Stat n={engage.queue} label="Drafts to approve" href="/queue" />
        <Stat n={engage.replies} label="Replies to handle" href="/inbox" warn />
        <Stat n={engage.tasksDue} label="Tasks due today" href="/tasks" />
        <Stat n={d.newTriggers} label="New triggers this year" href="/triggers" />
        <Stat n={d.newInquiries} label="Site inquiries and referrals, 7 days" href="/deals" />
        <Stat n={d.dossiersReady} label="Dossiers ready, 7 days" href="/companies" />
        <Stat n={d.overdue} label="Deals with overdue next actions" href="/deals?view=table" warn />
        <Stat n={d.noNext} label="Open deals with no next action" href="/deals?view=table" warn />
        <Stat n={d.awaitingAi} label="Signals waiting for Claude" href="/triggers?tab=signals&status=new" />
      </div>

      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Top new triggers</span><Link href="/triggers">All triggers</Link></p>
            {d.topTriggers.length === 0 ? <p className={r.empty}>{ai ? "No new triggers. The scanners run every 15 minutes." : "Triggers appear once ANTHROPIC_API_KEY is set. The scanners are already collecting current signals."}</p> : (
              <table className={ui.table}><tbody>
                {d.topTriggers.map(t => (
                  <tr key={t.id}>
                    <td className={ui.wrap}><span className={ui.primary}>{t.summary}</span><span className={ui.sub}>{t.orgId ? <Link href={`/companies/${t.orgId}`}>{t.orgName}</Link> : null} · {t.eventDate}</span></td>
                    <td><span className={ui.chip}>{t.type}</span></td>
                    <td className={ui.num}>{t.urgency}/5</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Next actions</span><Link href="/deals">Deals</Link></p>
            {d.dueDeals.length === 0 ? <p className={r.empty}>No open deals.</p> : (
              <table className={ui.table}><tbody>
                {d.dueDeals.map(x => (
                  <tr key={x.id}>
                    <td><span className={ui.primary}>{x.name}</span><span className={ui.sub}>{x.nextAction ?? "No next action set"}</span></td>
                    <td><span className={ui.chip}>{DEAL_STAGES[x.stage as keyof typeof DEAL_STAGES]}</span></td>
                    <td style={x.nextActionDate && x.nextActionDate < d.today ? { color: "#b0432f" } : undefined}>{x.nextActionDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Meetings, next 7 days</p>
            {meetings.length === 0 ? <p className={r.empty}>No meetings with CRM contacts. Calendar syncs every 30 minutes.</p> : (
              <ul className={r.timeline}>{meetings.map(({ b, contactName, orgName }) => {
                const brief = b.brief as { context?: string; questions?: string[]; regenera_angle?: string } | null;
                return (
                  <li key={b.id}>
                    <span className={r.when}>{b.startsAt.slice(5, 16).replace("T", " ")} UTC</span>
                    <span><b>{b.title}</b>{contactName ? ` · ${contactName}` : ""}{orgName ? `, ${orgName}` : ""}
                      {brief ? (
                        <details><summary>Brief</summary>
                          {brief.context && <p style={{ margin: "6px 0" }}>{brief.context}</p>}
                          {brief.regenera_angle && <p style={{ margin: "6px 0" }}><b>Angle:</b> {brief.regenera_angle}</p>}
                          {brief.questions?.length ? <ol style={{ margin: "6px 0", paddingLeft: 18 }}>{brief.questions.map(q => <li key={q}>{q}</li>)}</ol> : null}
                        </details>
                      ) : <span className={ui.sub}>Brief is written 24 hours before</span>}
                    </span>
                  </li>
                );
              })}</ul>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>From regenera.bio</p>
            {d.recentInquiries.length === 0 ? <p className={r.empty}>No inquiries or referrals yet.</p> : (
              <ul className={r.timeline}>{d.recentInquiries.map(a => <li key={a.id}><span className={r.when}>{a.occurredAt.slice(0, 10)}</span><span>{a.detail.slice(0, 140)}</span></li>)}</ul>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>This month</p>
            <dl className={r.kv}>
              <dt>Claude spend</dt><dd>{ai ? `$${d.aiSpend.toFixed(2)} of $${ai.monthlyBudgetUsd}` : "Not connected"}</dd>
              <dt>Apollo credits</dt><dd>{apollo ? `${d.apolloCredits} of ${apollo.monthlyCreditBudget} (free plan)` : "Not connected"}</dd>
              <dt>Dead jobs</dt><dd>{d.dead > 0 ? <Link href="/settings/jobs">{d.dead}</Link> : 0}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
