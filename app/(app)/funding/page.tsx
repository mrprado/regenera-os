import Link from "next/link";
import { HandCoins } from "lucide-react";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import FilterForm from "@/components/filter-form";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { caseRecords, deals, fundingProspects, funders, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { appDb, isInternal, isOwner, mandateCondition, type Scope } from "@/lib/db/scoped";
import { bidDeals, funderProfiles, libraryBlocks, listFunding } from "@/lib/funding/queries";
import { allProspects, applicationsList, awardsList, calendarEvents, originationDashboard } from "@/lib/funding/origination-queries";
import { kindOf } from "@/lib/funding/origination";
import { getState } from "@/lib/state";
import { amount, daysLabel, daysLeft, ROUTE_LABEL, SOURCE_LABEL } from "@/lib/funding/labels";
import { compactMoney } from "@/lib/projects/labels";
import { APPLICANT_ELIGIBILITY, APPLICATION_STATES, CALENDAR_KINDS, FUNDER_TYPES, FUNDING_KINDS, FUNDING_LINES, PROSPECT_STAGES } from "@/lib/funding/vocab";
import { DEAL_STAGES } from "@/lib/vocab";
import { decideFundingAction, deleteLibraryAction, saveLibraryAction, scanFundingNowAction } from "../funding-actions";
import { saveFunderAction, tagLibraryAction } from "../funding-origination-actions";
import f from "./funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funding" };

type SP = Record<string, string | undefined>;
const TABS = [["open", "Opportunities"], ["calendar", "Calendar"], ["bids", "Bids"], ["applicants", "Applicants"], ["origination", "Origination"], ["awards", "Awards"], ["funders", "Funders"], ["library", "Bid library"]] as const;
const DECISION_LABEL: Record<string, string> = { new: "New", watching: "Watching", bidding: "Bidding", matched: "Applicants found", dismissed: "Dismissed" };

export default async function FundingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/funding");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "open";
  const owner = isOwner(user.scope);
  const internal = isInternal(user.scope);
  const last = await getState(appDb(), "funding_scan_last").then(v => { try { return v ? JSON.parse(v) as { at: string; fresh: number; errors: string[] } : null; } catch { return null; } });
  return (
    <>
      <PageHeader title="Funding" actions={<>{internal && <Link className="btn" href="/funding/economics">Practice economics</Link>}{owner && <form action={scanFundingNowAction}><button className="btn btn--primary" type="submit">Scan now</button></form>}</>} />
      <Notice text={sp.notice} />
      <p className={f.kicker}>Public &amp; blended finance · funding pathway → applicant → client → diagnostic → application → award → implementation</p>
      <nav className={ui.tabs} aria-label="Funding views">
        {TABS.map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "open" ? "/funding" : `/funding?tab=${k}`}>{v}</Link>)}
      </nav>
      {tab === "open" && <OpenTab sp={sp} scope={user.scope} last={last} />}
      {tab === "calendar" && <CalendarTab scope={user.scope} />}
      {tab === "bids" && <BidsTab scope={user.scope} />}
      {tab === "applicants" && <ApplicantsTab scope={user.scope} stage={sp.stage} />}
      {tab === "origination" && <OriginationTab scope={user.scope} internal={internal} />}
      {tab === "awards" && <AwardsTab scope={user.scope} />}
      {tab === "funders" && <FundersTab scope={user.scope} />}
      {tab === "library" && <LibraryTab scope={user.scope} edit={sp.edit} />}
    </>
  );
}

async function OpenTab({ sp, scope, last }: { sp: SP; scope: Scope; last: { at: string; fresh: number; errors: string[] } | null }) {
  const { rows, total, closingSoon } = await listFunding(scope, { q: sp.q, route: sp.route, type: sp.type, source: sp.source, region: sp.region, minFit: sp.min ? Number(sp.min) : undefined, window: sp.window, decision: sp.decision });
  const ids = rows.map(o => o.id);
  const elig = ids.length ? await appDb().select({ id: fundingProspects.opportunityId, e: sql<string>`group_concat(${fundingProspects.eligibility})`, n: sql<number>`count(*)` }).from(fundingProspects).where(inArray(fundingProspects.opportunityId, ids.slice(0, 95))).groupBy(fundingProspects.opportunityId) : [];
  const eligOf = new Map(elig.map(x => [x.id, x]));
  const kindFilter = sp.kind && sp.kind in FUNDING_KINDS ? sp.kind : null;
  const shown = kindFilter ? rows.filter(o => kindOf(o).kind === kindFilter) : rows;
  const back = `/funding?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "notice") as [string, string][])}`;
  return (
    <>
      <p className={ui.notice}>
        Open and forthcoming grants, tenders, concessional finance and incentives, with deadlines from today on. Sources: Grants.gov, EU Funding &amp; Tenders, EU TED, World Bank, UK Contracts Finder.
        {aiConfig() ? " Claude reads each call for route and caveats." : " Until ANTHROPIC_API_KEY is set, the only signal is a keyword count."} Keyword counts are a discovery signal only, never eligibility or fit.
        {last ? ` Last scan ${last.at.slice(0, 16).replace("T", " ")} UTC, ${last.fresh} new.` : " First scan runs on the next job tick."} {closingSoon} close in the next 14 days.
      </p>
      <div className={ui.workspace}>
        <FilterForm action="/funding" className={ui.filters}>
          <p className={ui.filtersTitle}>Filters</p>
          <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Title, funder, topic" /></div>
          <div className={ui.field}><label htmlFor="kind">Funding type</label>
            <select id="kind" name="kind" defaultValue={sp.kind ?? ""}><option value="">Any type</option>{Object.entries(FUNDING_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="route">Route</label>
            <select id="route" name="route" defaultValue={sp.route ?? ""}><option value="">Any route</option>{Object.entries(ROUTE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="type">Listed as</label>
            <select id="type" name="type" defaultValue={sp.type ?? ""}><option value="">Any</option>{["grant", "call", "tender", "prize", "concessional"].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="source">Source</label>
            <select id="source" name="source" defaultValue={sp.source ?? ""}><option value="">All sources</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="region">Country or region</label><input id="region" name="region" defaultValue={sp.region} placeholder="e.g. Peru, United Kingdom, European Union" /></div>
          <div className={ui.field}><label htmlFor="min">Discovery signal at least</label>
            <select id="min" name="min" defaultValue={sp.min ?? ""}><option value="">Any</option><option value="50">50+</option><option value="70">70+</option><option value="85">85+</option></select></div>
          <div className={ui.field}><label htmlFor="window">Closes within</label>
            <select id="window" name="window" defaultValue={sp.window ?? ""}><option value="">Any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">12 months</option></select></div>
          <div className={ui.field}><label htmlFor="decision">Regenera status</label>
            <select id="decision" name="decision" defaultValue={sp.decision ?? ""}><option value="">Not dismissed</option>{Object.entries(DECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/funding">Clear</Link></div>
        </FilterForm>
        <div>
          {shown.length === 0 ? (
            <EmptyState icon={HandCoins} title="No open opportunities" body="The funding scan runs every 2 hours across all sources, a few at a time. Use Scan now to start one, or clear the filters." />
          ) : (
            <>
              <div className={ui.toolbar}><span className={ui.resultCount}>{total} open opportunities{total > rows.length ? `, showing the first ${rows.length}` : ""}{kindFilter ? ` · ${shown.length} ${FUNDING_KINDS[kindFilter as keyof typeof FUNDING_KINDS].label}` : ""}</span></div>
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead><tr><th>Opportunity</th><th>Funder</th><th>Type</th><th>Geography</th><th>Amount</th><th>Deadline</th><th>Eligibility</th><th>Route</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {shown.map(o => {
                      const d = daysLeft(o.deadline);
                      const k = kindOf(o);
                      const e = eligOf.get(o.id);
                      const best = e ? (["confirmed", "likely", "uncertain", "not_eligible"] as const).find(s => e.e.split(",").includes(s)) : null;
                      return (
                        <tr key={o.id}>
                          <td className={ui.wrap}><Link className={ui.primary} href={`/funding/${o.id}`}>{o.title}</Link>
                            {o.read?.summary && <span className={ui.sub}>{o.read.summary.slice(0, 180)}</span>}
                            {o.fit != null && <span className={ui.sub}>{o.readAt ? "Read by Claude" : `Discovery signal: ${o.fit} keyword hits`} · {SOURCE_LABEL[o.source]}</span>}</td>
                          <td className={ui.wrap}>{o.funder ?? "—"}</td>
                          <td>{FUNDING_KINDS[k.kind].label}{k.derived && <span className={ui.sub}>derived</span>}</td>
                          <td className={ui.wrap}>{(o.countries ?? []).slice(0, 2).join(", ") || "Not stated"}{(o.countries ?? []).length > 2 && <span className={ui.sub}>+{(o.countries ?? []).length - 2}</span>}</td>
                          <td>{amount(o.amountMin, o.amountMax, o.currency)}</td>
                          <td style={{ whiteSpace: "nowrap" }} className={d !== null && d <= 14 ? f.warn : undefined}>{o.deadline ?? "Rolling"}{d !== null && <span className={ui.sub}>{daysLabel(d)}</span>}</td>
                          <td>{best ? <span className={f.state} data-s={best}>{APPLICANT_ELIGIBILITY[best].label}</span> : <span className={f.muted}>Needs review</span>}{e && <span className={ui.sub}>{e.n} applicant{e.n === 1 ? "" : "s"}</span>}</td>
                          <td>{o.route ? ROUTE_LABEL[o.route] : <span className={f.muted}>Not read</span>}</td>
                          <td>{DECISION_LABEL[o.decision]}</td>
                          <td><div className={ui.rowActions}>
                            {o.decision !== "watching" && o.decision !== "bidding" && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="watching" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Watch</button></form>}
                            {o.decision !== "dismissed" && o.decision !== "bidding" && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="dismissed" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Dismiss</button></form>}
                          </div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {last?.errors?.length ? <p className={ui.sub}>Source health: last scan could not reach {last.errors.slice(0, 3).join("; ")}. See Settings → Integrations.</p> : null}
        </div>
      </div>
    </>
  );
}

async function CalendarTab({ scope }: { scope: Scope }) {
  const ev = await calendarEvents(scope);
  const byMonth = new Map<string, typeof ev>();
  for (const e of ev) byMonth.set(e.date.slice(0, 7), [...(byMonth.get(e.date.slice(0, 7)) ?? []), e]);
  return byMonth.size === 0 ? <EmptyState icon={HandCoins} title="Nothing on the calendar" body="Funder deadlines and openings, plus internal bid / no-bid, draft and review dates from applications, appear here." /> : (
    <>
      <p className={ui.sub}>Funder dates and <b>internal</b> dates (bid / no-bid, drafts, reviews, consortium cutoffs) for the next 12 months. Add dates from an opportunity or an application.</p>
      {[...byMonth.entries()].map(([month, list]) => (
        <section key={month} className={ui.tableWrap} style={{ marginBottom: 14 }}>
          <p className={ui.filtersTitle} style={{ padding: "12px 14px 0" }}>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
          <table className={ui.table}><tbody>{list.map((e, i) => (
            <tr key={`${e.date}${i}`}><td style={{ width: 100 }}>{e.date}</td><td style={{ width: 190 }}>{CALENDAR_KINDS[e.kind as keyof typeof CALENDAR_KINDS]?.label ?? e.kind}{e.internal && <span className={ui.sub}>internal</span>}</td><td className={ui.wrap}><Link href={e.href}>{e.label || "—"}</Link></td></tr>
          ))}</tbody></table>
        </section>
      ))}
    </>
  );
}

async function BidsTab({ scope }: { scope: Scope }) {
  const [apps, rows] = await Promise.all([applicationsList(scope), bidDeals(scope)]);
  const submitted = apps.filter(a => ["submitted", "awarded", "unsuccessful"].includes(a.a.state));
  const won = apps.filter(a => a.a.state === "awarded").length, lost = apps.filter(a => a.a.state === "unsuccessful").length;
  return (
    <>
      <div className={ui.stats}>
        <div className={ui.stat}><b>{apps.filter(a => !["submitted", "awarded", "unsuccessful", "withdrawn"].includes(a.a.state)).length}</b><span>Applications in progress</span></div>
        <div className={ui.stat}><b>{submitted.length}</b><span>Submitted</span></div>
        <div className={ui.stat}><b>{won}</b><span>Awarded</span></div>
        <div className={ui.stat}><b>{won + lost ? `${won} of ${won + lost}` : "—"}</b><span>Decided that were awarded</span></div>
      </div>
      {apps.length === 0 ? <EmptyState icon={HandCoins} title="No application workspaces yet" body="Open an opportunity, run the bid / no-bid review, then open the application workspace." /> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Application</th><th>Funder</th><th>Deadline</th><th>Review state</th><th>Owner</th><th className={ui.num}>Open items</th><th className={ui.num}>Hours (plan / actual)</th></tr></thead>
            <tbody>{apps.map(r => (
              <tr key={r.a.id}>
                <td className={ui.wrap}><Link className={ui.primary} href={`/funding/applications/${r.a.id}`}>{r.a.name}</Link><span className={ui.sub}>{r.lead ? `Lead: ${r.lead}` : "Lead applicant not set"}</span></td>
                <td>{r.funder ?? "—"}</td><td>{r.deadline ?? "—"}</td>
                <td><span className={ui.chip}>{APPLICATION_STATES[r.a.state as keyof typeof APPLICATION_STATES]}</span></td>
                <td>{r.a.owner ?? "—"}</td>
                <td className={`${ui.num} ${r.late ? f.warn : ""}`}>{r.open}{r.late ? ` (${r.late} late)` : ""}</td>
                <td className={ui.num}>{Math.round(r.hoursBudget)} / {Math.round(r.hoursActual)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <details style={{ marginTop: 16 }}><summary className={ui.sub}>Bid deals ({rows.length})</summary>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Bid</th><th>Funder</th><th>Route</th><th>Deadline</th><th>Stage</th><th>Next action</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.d.id}><td className={ui.wrap}><Link className={ui.primary} href={`/funding/${r.oppId}`}>{r.title}</Link></td><td>{r.funder ?? "—"}</td><td>{r.route ? ROUTE_LABEL[r.route] : "—"}</td><td>{r.deadline ?? "—"}</td>
                  <td><span className={ui.chip}>{DEAL_STAGES[r.d.stage as keyof typeof DEAL_STAGES]}</span></td><td>{r.d.nextAction ?? "—"}<span className={ui.sub}>{r.d.nextActionDate ?? ""}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

async function ApplicantsTab({ scope, stage }: { scope: Scope; stage?: string }) {
  const rows = await allProspects(scope, stage && stage in PROSPECT_STAGES ? stage : undefined);
  return (
    <>
      <p className={ui.notice}>Organizations considered as applicants for a call. Each one is a CRM organization (never a copy) with a client opportunity in Engagements. Eligibility is Confirmed only with its basis.</p>
      <nav className={ui.tabs} aria-label="Prospect stages" style={{ marginTop: 0 }}>
        <Link className={`${ui.tab} ${!stage ? ui.tabActive : ""}`} href="/funding?tab=applicants">All</Link>
        {Object.entries(PROSPECT_STAGES).map(([k, v]) => <Link key={k} className={`${ui.tab} ${stage === k ? ui.tabActive : ""}`} href={`/funding?tab=applicants&stage=${k}`}>{v}</Link>)}
      </nav>
      {rows.length === 0 ? <EmptyState icon={HandCoins} title="No applicant prospects" body="Open an opportunity, build its ideal applicant profile, then use Applicants to add organizations from the CRM or public sources." /> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Organization</th><th>Opportunity</th><th>Eligibility</th><th>Stage</th><th>Client opportunity</th><th>Follow-up</th><th>Owner</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.p.id}>
                <td className={ui.wrap}><Link className={ui.primary} href={`/companies/${r.p.orgId}`}>{r.orgName}</Link><span className={ui.sub}>{r.p.origin === "external" ? "External prospect" : "From the CRM"}</span></td>
                <td className={ui.wrap}><Link href={`/funding/${r.p.opportunityId}?tab=applicants`}>{r.title}</Link><span className={ui.sub}>{r.deadline ? `Deadline ${r.deadline}` : "Rolling"}</span></td>
                <td><span className={f.state} data-s={r.p.eligibility}>{APPLICANT_ELIGIBILITY[r.p.eligibility as keyof typeof APPLICANT_ELIGIBILITY]?.label ?? r.p.eligibility}</span></td>
                <td>{PROSPECT_STAGES[r.p.stage as keyof typeof PROSPECT_STAGES] ?? r.p.stage}</td>
                <td>{r.p.engagementId ? <Link href={`/commercial/engagements/${r.p.engagementId}`}>{r.engStatus ?? "Open"}{r.fee ? ` · ${compactMoney(r.fee, "USD")}` : ""}</Link> : "—"}</td>
                <td>{r.p.followUpDate ?? "—"}</td><td>{r.p.owner ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function OriginationTab({ scope, internal }: { scope: Scope; internal: boolean }) {
  const d = await originationDashboard(scope);
  const max = Math.max(1, ...d.steps.map(s => s.n));
  const pipe = await allProspects(scope);
  const open = pipe.filter(p => !["lost", "engagement"].includes(p.p.stage));
  return (
    <>
      <p className={ui.notice}>Funding as an origination channel: call → organization → client → project → capital → engagement → OS → long-term relationship. The measure that matters is total revenue from funding-originated relationships, not application fees alone.</p>
      {internal && (
        <section style={{ marginBottom: 20 }}>
          <p className={f.kicker}>Revenue from funding-originated relationships</p>
          <div className={f.econ}>
            <div><b>{compactMoney(d.originatedTotal, "USD")}</b><span>Total contracted, all services</span></div>
            <div><b>{d.originated.length}</b><span>Funding-originated accounts</span></div>
            <div><b>{compactMoney(d.originated.reduce((a, o) => a + o.year1, 0), "USD")}</b><span>Year-1 revenue</span></div>
            <div><b>{compactMoney(d.originated.reduce((a, o) => a + o.recurring, 0), "USD")}</b><span>Recurring (annualized)</span></div>
          </div>
          {d.originated.length > 0 && (
            <div className={ui.tableWrap}><table className={ui.table}>
              <thead><tr><th>Account</th><th>First engagement</th><th className={ui.num}>Engagements</th><th className={ui.num}>Year 1</th><th className={ui.num}>Recurring / yr</th><th className={ui.num}>Total</th><th>By line</th></tr></thead>
              <tbody>{d.originated.map(o => (
                <tr key={o.orgId}><td><Link href={`/companies/${o.orgId}`}>{o.name}</Link></td><td>{o.firstAt.slice(0, 10)}</td><td className={ui.num}>{o.engagements}</td><td className={ui.num}>{compactMoney(o.year1, "USD")}</td><td className={ui.num}>{compactMoney(o.recurring, "USD")}</td><td className={ui.num}>{compactMoney(o.total, "USD")}</td>
                  <td className={ui.sub}>{Object.entries(o.lines).map(([k, v]) => `${FUNDING_LINES[k as keyof typeof FUNDING_LINES] ?? k.replace(/_/g, " ")} ${compactMoney(v, "USD")}`).join(" · ")}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className={ui.sub}>USD shown; engagements in other currencies are summed without conversion. Won and active engagements only; prospects and lost work are excluded. Not every client buys the full stack.</p>
        </section>
      )}
      <p className={f.kicker}>Funnel</p>
      <ul className={f.funnel}>{d.steps.map(s => (
        <li key={s.key}><span>{s.label}</span><span className={f.num}>{s.n.toLocaleString("en-US")}</span><span className={f.bar}><i style={{ width: `${(s.n / max) * 100}%` }} /></span><span className={`${f.num} ${f.conv}`}>{s.conversionPct === null ? "" : `${s.conversionPct}%`}</span></li>
      ))}</ul>
      <p className={ui.sub}>Conversion is step to step. Counts are records in the OS, not estimates.</p>
      <p className={f.kicker} style={{ marginTop: 20 }}>Origination pipeline ({open.length})</p>
      {open.length === 0 ? <p className={ui.sub}>No open funding-originated prospects.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Funding opportunity</th><th>Potential applicant</th><th>Outreach / stage</th><th>Client opportunity</th><th className={ui.num}>Estimated fee</th></tr></thead>
          <tbody>{open.map(r => (
            <tr key={r.p.id}><td className={ui.wrap}><Link href={`/funding/${r.p.opportunityId}`}>{r.title}</Link></td><td><Link href={`/companies/${r.p.orgId}`}>{r.orgName}</Link></td><td>{PROSPECT_STAGES[r.p.stage as keyof typeof PROSPECT_STAGES]}</td>
              <td>{r.p.engagementId ? <Link href={`/commercial/engagements/${r.p.engagementId}`}>{r.engStatus}</Link> : "—"}</td><td className={ui.num}>{r.fee ? compactMoney(r.fee, "USD") : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

async function AwardsTab({ scope }: { scope: Scope }) {
  const rows = await awardsList(scope);
  const t = new Date().toISOString().slice(0, 10);
  return rows.length === 0 ? <EmptyState icon={HandCoins} title="No awards yet" body="Record an award from a submitted application. It becomes an approved funding pathway on the project and, if you choose, a post-award program engagement." /> : (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead><tr><th>Award</th><th>Funder</th><th className={ui.num}>Amount</th><th>Period</th><th>Next report</th><th>Milestones</th><th>Post-award</th></tr></thead>
        <tbody>{rows.map(r => {
          const next = r.w.reporting.filter(x => !x.done && x.due).sort((a, b) => a.due!.localeCompare(b.due!))[0];
          return (
            <tr key={r.w.id}>
              <td className={ui.wrap}><Link className={ui.primary} href={`/funding/applications/${r.appId}?tab=submission`}>{r.name}</Link><span className={ui.sub}>{r.w.agreementRef || "Agreement ref not recorded"}</span></td>
              <td>{r.funder ?? "—"}</td><td className={ui.num}>{compactMoney(r.w.amount, r.w.currency)}</td><td>{r.w.periodStart ?? "?"} → {r.w.periodEnd ?? "?"}</td>
              <td className={next && next.due! < t ? f.warn : undefined}>{next ? `${next.due} · ${next.label}` : "—"}</td>
              <td>{r.w.milestones.filter(m => m.done).length} / {r.w.milestones.length}</td>
              <td>{r.w.postAwardEngagementId ? <Link href={`/commercial/engagements/${r.w.postAwardEngagementId}`}>Engagement</Link> : "—"}{r.projectId && <span className={ui.sub}><Link href={`/projects/${r.projectId}?tab=pathways`}>Capital stack</Link></span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

async function FundersTab({ scope }: { scope: Scope }) {
  const [rows, registry] = await Promise.all([funderProfiles(scope), appDb().select({ fu: funders, org: organizations.name }).from(funders).leftJoin(organizations, eq(organizations.id, funders.orgId)).where(mandateCondition(scope, funders.mandateId)).orderBy(funders.name)]);
  const byName = new Map(registry.map(r => [r.fu.name.toLowerCase(), r.fu]));
  return (
    <>
      <details className={ui.tableWrap} style={{ padding: 14, marginBottom: 14 }}>
        <summary className={ui.primary}>Add or update a funder profile</summary>
        <form action={saveFunderAction} className={f.grid3} style={{ marginTop: 10 }}>
          <label>Name<input name="name" required /></label>
          <label>Type<select name="type">{Object.entries(FUNDER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Typical award<input name="typicalAward" placeholder="e.g. 250k–2M USD" /></label>
          <label>Programs<input name="programs" placeholder="comma separated" /></label>
          <label>Sectors<input name="sectors" /></label>
          <label>Geography<input name="geography" /></label>
          <label className={f.full}>Applicant types<input name="applicantTypes" /></label>
          <label className={f.full}>History and Regenera relationship<textarea name="history" /></label>
          <div><button className="btn btn--primary" type="submit">Save funder</button></div>
        </form>
      </details>
      {rows.length === 0 && registry.length === 0 ? <EmptyState icon={HandCoins} title="No funders yet" body="Funders appear as the scan finds their calls, or add a profile above." /> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Funder</th><th>Type</th><th className={ui.num}>Open calls</th><th className={ui.num}>Seen</th><th>Largest award</th><th>Next deadline</th><th className={ui.num}>Bids</th><th>Programs · geography</th></tr></thead>
            <tbody>{rows.map(x => {
              const p = byName.get((x.funder ?? "").toLowerCase());
              return (
                <tr key={x.funder}><td className={ui.primary}><Link href={`/funding?q=${encodeURIComponent(x.funder ?? "")}`}>{x.funder}</Link></td><td>{p ? FUNDER_TYPES[p.type as keyof typeof FUNDER_TYPES] : <span className={f.muted}>Not profiled</span>}</td><td className={ui.num}>{x.open}</td><td className={ui.num}>{x.seen}</td>
                  <td>{x.maxAmount ? `${Math.round(x.maxAmount).toLocaleString("en-US")} ${x.currency ?? ""}` : "—"}</td><td>{x.nextDeadline ?? "—"}</td><td className={ui.num}>{x.bids}</td>
                  <td className={ui.sub}>{p ? [p.programs.join(", "), p.geography.join(", ")].filter(Boolean).join(" · ") : (x.sources ?? "").split(",").map(s => SOURCE_LABEL[s] ?? s).join(", ")}</td></tr>
              );
            })}
              {registry.filter(r => !rows.some(x => (x.funder ?? "").toLowerCase() === r.fu.name.toLowerCase())).map(r => (
                <tr key={r.fu.id}><td className={ui.primary}>{r.fu.name}</td><td>{FUNDER_TYPES[r.fu.type as keyof typeof FUNDER_TYPES]}</td><td className={ui.num}>0</td><td className={ui.num}>0</td><td>{r.fu.typicalAward || "—"}</td><td>—</td><td className={ui.num}>0</td><td className={ui.sub}>{[r.fu.programs.join(", "), r.fu.geography.join(", ")].filter(Boolean).join(" · ")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const LIB_KINDS: Record<string, string> = { profile: "Organizational boilerplate", narrative: "Approved narrative", boilerplate: "Boilerplate", cv: "Bio / CV", project: "Project description", methodology: "Methodology", impact: "Impact language", mande: "M&E framework", risk: "Risk approach", budgeting: "Budgeting assumptions", past_performance: "Past performance", prior_response: "Prior successful response", study: "Supporting study", other: "Other" };

async function LibraryTab({ scope, edit }: { scope: Scope; edit?: string }) {
  const blocks = await libraryBlocks(scope);
  const cases = await appDb().select({ id: caseRecords.id, deal: deals.name, authorized: caseRecords.disclosureAuthorized }).from(caseRecords).innerJoin(deals, eq(deals.id, caseRecords.dealId))
    .where(mandateCondition(scope, caseRecords.mandateId)).orderBy(desc(caseRecords.updatedAt));
  const current = blocks.find(b => b.b.id === edit)?.b;
  const clients = await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), inArray(organizations.id, blocks.map(b => b.b.clientOrgId).filter((x): x is string => !!x).slice(0, 90).concat([""]))));
  const clientName = new Map(clients.map(c => [c.id, c.name]));
  return (
    <>
      <p className={ui.notice}>Reusable institutional knowledge. Drafts use only <b>approved</b> blocks and the call text. Past performance is used only when its case record is marked disclosure authorized. Tag by sector, funder, program, geography and client so the right language is found.</p>
      <form action={saveLibraryAction} className={`${ui.tableWrap} ${f.form}`} style={{ padding: 14, marginBottom: 16 }}>
        {current && <input type="hidden" name="id" value={current.id} />}
        <div className={f.inline}>
          <select name="kind" aria-label="Kind" defaultValue={current?.kind ?? "narrative"}>{Object.entries(LIB_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input name="title" aria-label="Title" placeholder="Title" defaultValue={current?.title} required style={{ flex: 1 }} />
        </div>
        <textarea name="body" aria-label="Text" placeholder="Text" defaultValue={current?.body} required style={{ minHeight: 140 }} />
        <select name="caseRecordId" aria-label="Case record" defaultValue={current?.caseRecordId ?? ""}>
          <option value="">No case record (required for past performance to be used)</option>
          {cases.map(c => <option key={c.id} value={c.id}>{c.deal}{c.authorized ? " (disclosure authorized)" : " (private)"}</option>)}
        </select>
        <div><button className="btn btn--primary" type="submit">{current ? "Save changes" : "Add block"}</button>{current && <Link className={ui.clear} href="/funding?tab=library" style={{ marginLeft: 10 }}>Cancel</Link>}</div>
      </form>
      {blocks.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Block</th><th>Kind</th><th>Tags</th><th>Usable in drafts</th><th /></tr></thead>
            <tbody>{blocks.map(({ b, authorized }) => (
              <tr key={b.id}>
                <td className={ui.wrap}><span className={ui.primary}>{b.title}</span><span className={ui.sub}>{b.body.slice(0, 160)}</span></td>
                <td>{LIB_KINDS[b.kind] ?? b.kind}</td>
                <td className={ui.wrap}>
                  <details><summary className={ui.sub}>{[b.sectors.join(", "), b.funder, b.program, b.geography, b.clientOrgId ? clientName.get(b.clientOrgId) : null].filter(Boolean).join(" · ") || "Untagged"}</summary>
                    <form action={tagLibraryAction} className={f.form} style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={b.id} />
                      <input name="sectors" placeholder="Sectors" defaultValue={b.sectors.join(", ")} /><input name="funder" placeholder="Funder" defaultValue={b.funder ?? ""} /><input name="program" placeholder="Program" defaultValue={b.program ?? ""} />
                      <input name="geography" placeholder="Geography" defaultValue={b.geography ?? ""} /><input name="owner" placeholder="Owner" defaultValue={b.owner ?? ""} />
                      <label className={f.inline}><input type="checkbox" name="approved" defaultChecked={b.approved} /> Approved for reuse</label>
                      <button className={ui.miniBtn} type="submit">Save tags</button>
                    </form>
                  </details>
                </td>
                <td>{!b.approved ? <span className={f.warn}>No: not approved</span> : b.kind !== "past_performance" || authorized ? `Yes${b.approvedBy ? ` · ${b.approvedBy}` : ""}` : <span className={f.warn}>No: case record not authorized</span>}</td>
                <td><div className={ui.rowActions}>
                  <Link className={ui.miniBtn} style={{ display: "inline-flex", alignItems: "center" }} href={`/funding?tab=library&edit=${b.id}`}>Edit</Link>
                  <form action={deleteLibraryAction}><input type="hidden" name="id" value={b.id} /><button className={ui.miniBtn} type="submit">Delete</button></form>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
