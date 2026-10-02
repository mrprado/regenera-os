import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { reports } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { computeMetrics, type RateRow } from "@/lib/reports/metrics";
import type { WeeklyBody } from "@/lib/reports/weekly";
import { DEAL_STAGES, ENGAGEMENTS, FEE_TYPES, LEAD_SOURCES, PRACTICES } from "@/lib/vocab";
import { weeklyReportNowAction } from "../radar-actions";
import { CasesTab, ForecastTab, LearningTab } from "./tabs";
import { bidDeals } from "@/lib/funding/queries";
import { contractTotals } from "@/lib/contracts/queries";
import { ROUTE_LABEL } from "@/lib/funding/labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const RANGES: Record<string, { label: string; days?: number }> = { "7": { label: "7 days", days: 7 }, "30": { label: "30 days", days: 30 }, "90": { label: "90 days", days: 90 }, ytd: { label: "This year" } };
const DIM_LABEL: Record<string, string> = { segment: "Segment", funnel: "Funnel", triggerType: "Trigger type", angle: "Angle", tier: "Tier", language: "Language" };
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const label = (map: Record<string, string>, k: string) => map[k] ?? k;

function csvHref(rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `data:text/csv;charset=utf-8,${encodeURIComponent(rows.map(r => r.map(esc).join(",")).join("\n"))}`;
}

function Csv({ name, rows }: { name: string; rows: (string | number)[][] }) {
  return <a className={ui.clear} href={csvHref(rows)} download={`${name}.csv`}>CSV</a>;
}

function RateTable({ dim, rows }: { dim: string; rows: RateRow[] }) {
  const name = (k: string) => (dim === "funnel" ? label(LEAD_SOURCES, k) : k);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Replies by {DIM_LABEL[dim].toLowerCase()}</span><Csv name={`replies-by-${dim}`} rows={[[DIM_LABEL[dim], "Emails sent", "Replied", "Positive", "Reply rate %", "Positive rate %"], ...rows.map(x => [name(x.key), x.sent, x.replies, x.positive, x.replyRate, x.positiveRate])]} /></p>
      {rows.length === 0 ? <p className={r.empty}>No emails sent in this period.</p> : (
        <table className={ui.table}>
          <thead><tr><th>{DIM_LABEL[dim]}</th><th className={ui.num}>Sent</th><th className={ui.num}>Replied</th><th className={ui.num}>Positive</th><th className={ui.num}>Reply</th><th className={ui.num}>Positive</th></tr></thead>
          <tbody>{rows.slice(0, 12).map(x => (
            <tr key={x.key}><td>{name(x.key)}</td><td className={ui.num}>{x.sent}</td><td className={ui.num}>{x.replies}</td><td className={ui.num}>{x.positive}</td><td className={ui.num}>{x.replyRate}%</td><td className={ui.num}>{x.positiveRate}%</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/reports");
  const sp = await searchParams;
  const tab = sp.tab === "forecast" || sp.tab === "learning" || sp.tab === "cases" ? sp.tab : "overview";
  const tabs = (
    <nav className={ui.tabs} aria-label="Report views">
      {([["overview", "Overview"], ["forecast", "Forecast"], ["learning", "Learning loop"], ["cases", "Case evidence"]] as const).map(([k, v]) => (
        <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "overview" ? "/reports" : `/reports?tab=${k}`}>{v}</Link>
      ))}
    </nav>
  );
  if (tab !== "overview") {
    return (
      <>
        <PageHeader title="Reports" />
        <Notice text={sp.notice} />
        {tabs}
        {tab === "forecast" && <ForecastTab scope={user.scope} />}
        {tab === "learning" && <LearningTab scope={user.scope} owner={isOwner(user.scope)} />}
        {tab === "cases" && <CasesTab scope={user.scope} />}
      </>
    );
  }
  const range = sp.range && RANGES[sp.range] ? sp.range : "30";
  const now = new Date();
  const from = RANGES[range].days ? new Date(now.getTime() - RANGES[range].days! * 86_400_000) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const [m, weekly, bids, contractStats] = await Promise.all([
    computeMetrics(appDb(), user.scope.mandateIds, { from: from.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() }),
    appDb().select().from(reports).where(and(inArray(reports.mandateId, user.scope.mandateIds.length ? user.scope.mandateIds : ["__none__"]), eq(reports.kind, "weekly"))).orderBy(desc(reports.periodStart)).limit(6),
    bidDeals(user.scope),
    contractTotals(user.scope),
  ]);
  const o = m.outreach;
  const WON = ["signed", "active", "expansion", "completed"];
  const byFunder = [...bids.reduce((acc, b) => {
    const k = `${b.funder ?? "Unknown funder"}|${b.route ?? "unread"}`;
    const cur = acc.get(k) ?? { funder: b.funder ?? "Unknown funder", route: b.route, bids: 0, won: 0, lost: 0, valueWon: 0 };
    cur.bids++;
    if (WON.includes(b.d.stage)) { cur.won++; cur.valueWon += b.d.valueEstimate ?? 0; }
    if (b.d.stage === "lost") cur.lost++;
    return acc.set(k, cur);
  }, new Map<string, { funder: string; route: string | null; bids: number; won: number; lost: number; valueWon: number }>()).values()];

  return (
    <>
      <PageHeader title="Reports" actions={isOwner(user.scope) ? <form action={weeklyReportNowAction}><button className="btn" type="submit">Write last week&apos;s report</button></form> : undefined} />
      <Notice text={sp.notice} />
      {tabs}
      <nav className={ui.tabs} aria-label="Period">
        {Object.entries(RANGES).map(([k, v]) => <Link key={k} className={`${ui.tab} ${range === k ? ui.tabActive : ""}`} href={`/reports?range=${k}`}>{v.label}</Link>)}
      </nav>
      <div className={ui.stats}>
        <div className={ui.stat}><b>{o.contactsEmailed}</b><span>People emailed ({o.emailsSent} emails)</span></div>
        <div className={ui.stat}><b>{o.replyRate}%</b><span>Reply rate</span></div>
        <div className={ui.stat}><b>{o.positiveRate}%</b><span>Positive reply rate</span></div>
        <div className={ui.stat}><b>{o.callsPer100}</b><span>Scoping calls per 100 people</span></div>
        <div className={ui.stat}><b>{m.pipeline.openDeals}</b><span>Open deals · weighted {money(m.pipeline.weighted)}</span></div>
      </div>

      {weekly.length > 0 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Weekly reports</p>
          {weekly.map(w => {
            const b = w.body as WeeklyBody | null;
            return (
              <details key={w.id} open={w.id === weekly[0].id} style={{ marginBottom: 10 }}>
                <summary><b>{w.periodStart} to {w.periodEnd}</b>{b ? ` · ${b.headline}` : " · numbers only (Claude writes the narrative once ANTHROPIC_API_KEY is set)"}</summary>
                {b && (
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 8 }}>
                    <p><b>Pipeline.</b> {b.pipeline_movement}</p>
                    {([["Wins", b.wins], ["Stalled", b.stalled], ["Best angles", b.best_angles], ["Weakest angles", b.worst_angles], ["Triggers worth attention", b.triggers_worth_attention], ["Three actions this week", b.recommended_actions]] as const)
                      .filter(([, items]) => items.length).map(([t, items]) => (
                        <div key={t}><b>{t}</b><ul style={{ margin: "4px 0 10px", paddingLeft: 18 }}>{items.map(i => <li key={i}>{i}</li>)}</ul></div>
                      ))}
                  </div>
                )}
              </details>
            );
          })}
        </section>
      )}

      <div className={r.grid}>
        <div>
          {(["segment", "funnel", "triggerType", "angle", "tier", "language"] as const).map(d => <RateTable key={d} dim={d} rows={o.byDim[d]} />)}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Pipeline by stage</span><Csv name="pipeline-by-stage" rows={[["Stage", "Deals", "Value", "Weighted"], ...m.pipeline.byStage.map(x => [label(DEAL_STAGES, x.key), x.deals, Math.round(x.value), Math.round(x.weighted)])]} /></p>
            <table className={ui.table}><tbody>{m.pipeline.byStage.map(x => (
              <tr key={x.key}><td>{label(DEAL_STAGES, x.key)}</td><td className={ui.num}>{x.deals}</td><td className={ui.num}>{money(x.weighted)}</td></tr>
            ))}</tbody></table>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>By practice and fee type</span><Csv name="pipeline-by-practice" rows={[["Practice", "Deals", "Weighted"], ...m.pipeline.byPractice.map(x => [label(PRACTICES, x.key), x.deals, Math.round(x.weighted)]), [], ["Fee type", "Deals", "Weighted"], ...m.pipeline.byFeeType.map(x => [label(FEE_TYPES, x.key), x.deals, Math.round(x.weighted)])]} /></p>
            <table className={ui.table}><tbody>
              {m.pipeline.byPractice.map(x => <tr key={x.key}><td>{label(PRACTICES, x.key)}</td><td className={ui.num}>{x.deals}</td><td className={ui.num}>{money(x.weighted)}</td></tr>)}
              {m.pipeline.byFeeType.map(x => <tr key={`f-${x.key}`}><td>{label(FEE_TYPES, x.key)}</td><td className={ui.num}>{x.deals}</td><td className={ui.num}>{money(x.weighted)}</td></tr>)}
            </tbody></table>
            <p className={ui.sub}>Weighted uses each deal&apos;s probability, or a default by stage when none is set.</p>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Win rate by engagement</span><Csv name="win-rate" rows={[["Engagement", "Won", "Lost", "Win rate %"], ...m.winRate.map(x => [label(ENGAGEMENTS, x.engagement), x.won, x.lost, x.rate])]} /></p>
            {m.winRate.length === 0 ? <p className={r.empty}>No deals closed in this period.</p> : (
              <table className={ui.table}><tbody>{m.winRate.map(x => <tr key={x.engagement}><td>{label(ENGAGEMENTS, x.engagement)}</td><td className={ui.num}>{x.won} won / {x.lost} lost</td><td className={ui.num}>{x.rate}%</td></tr>)}</tbody></table>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Trigger to first touch</p>
            {m.triggerToFirstTouchHours.length === 0 ? <p className={r.empty}>No pursued triggers were emailed in this period.</p> : (
              <table className={ui.table}><tbody>{m.triggerToFirstTouchHours.map(x => <tr key={x.type}><td>{x.type}</td><td className={ui.num}>{x.triggers} triggers</td><td className={ui.num}>median {x.medianHours < 48 ? `${x.medianHours} h` : `${Math.round(x.medianHours / 24)} days`}</td></tr>)}</tbody></table>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Contracted value by engagement</span><Link href="/contracts">Contracts</Link></p>
            {contractStats.byEngagement.length === 0 ? <p className={r.empty}>No signed contracts yet.</p> : (
              <table className={ui.table}><tbody>{contractStats.byEngagement.map(x => (
                <tr key={x.engagement ?? "other"}><td>{x.engagement ? ENGAGEMENTS[x.engagement as keyof typeof ENGAGEMENTS] ?? x.engagement : "NDAs and referral agreements"}</td><td className={ui.num}>{x.signed} signed</td><td className={ui.num}>{x.value ? money(x.value) : ""}</td></tr>
              ))}</tbody></table>
            )}
            <p className={ui.sub}>Milestones paid {money(contractStats.paid)} · outstanding {money(contractStats.outstanding)}</p>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Funding bids by funder</span><Link href="/funding?tab=bids">Bids</Link></p>
            {byFunder.length === 0 ? <p className={r.empty}>No bids yet.</p> : (
              <table className={ui.table}><tbody>{byFunder.map(f => (
                <tr key={`${f.funder}${f.route}`}><td>{f.funder}<span className={ui.sub}>{f.route ? ROUTE_LABEL[f.route] : "Route not read"}</span></td><td className={ui.num}>{f.bids} bids</td>
                  <td className={ui.num}>{f.won + f.lost ? `${Math.round((f.won / (f.won + f.lost)) * 100)}% won` : "open"}</td><td className={ui.num}>{f.valueWon ? money(f.valueWon) : ""}</td></tr>
              ))}</tbody></table>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Partner Network referrals</p>
            {m.partners.length === 0 ? <p className={r.empty}>No referrals yet.</p> : (
              <table className={ui.table}><tbody>{m.partners.map(x => <tr key={x.tier}><td>{x.tier}</td><td className={ui.num}>{x.referrals} referrals</td><td className={ui.num}>{x.conversion}% won</td></tr>)}</tbody></table>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Deliverability</span><Link href="/settings/sending">Sending</Link></p>
            {m.deliverability.length === 0 ? <p className={r.empty}>No check yet.</p> : (
              <table className={ui.table}><tbody>{m.deliverability.map(x => (
                <tr key={x.domain}><td>{x.domain}</td><td>SPF {x.spf ? "ok" : "missing"} · DKIM {x.dkim ? "ok" : "missing"} · DMARC {x.dmarc}</td><td className={ui.num}>{x.bounceRate !== null ? `${(x.bounceRate * 100).toFixed(1)}% bounces` : ""}</td></tr>
              ))}</tbody></table>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
