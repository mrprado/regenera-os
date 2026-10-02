import Link from "next/link";
import { notFound } from "next/navigation";
import { Target } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { withBase } from "@/lib/base-path";
import { deliveryFloor, getWork, mandateEconomics, mandateHealth } from "@/lib/mandates/engine";
import { WorkProgress } from "./work-progress";
import { day, label, money, pct } from "@/lib/mandates/format";
import { candidatePage, candidatesFor, funnelFor, mandateById, pursuitsFor, signalsFor } from "@/lib/mandates/queries";
import { ATTRIBUTION, BREADTH, BUILDER, CADENCE, CANDIDATE_STAGES, CLIENT_RESPONSES, CONFIDENTIALITY, DELIVERY_METRICS, DESKS, ENGAGEMENT_MODELS, FIT_DIMENSIONS, HEALTH, MANDATE_STATUSES, MANDATE_TYPES, OUTREACH_PERMISSION, PURSUIT_TYPES, qualificationFor, SEATS, SIGNAL_KINDS, STAGE_ORDER, SUCCESS_STRUCTURES, type ClientResponse, type MandateType } from "@/lib/mandates/vocab";
import { approvePublicationAction, buildUniverseAction, clientRespondAction, reviewDeliveryAction, signalStatusAction, syncQueuesAction, updateMandateAction } from "../../origination-actions";
import f from "../../funding/funding.module.css";
import s from "../mandates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mandate" };

const TABS = [["overview", "Overview"], ["universe", "Universe"], ["client", "Client approval queue"], ["pursuits", "Pursuits"], ["signals", "Signals"], ["delivery", "Delivery floor"], ["economics", "Economics"], ["report", "Report"], ["profile", "Profile"]] as const;
type Sp = Record<string, string | undefined>;

export default async function MandatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Sp> }) {
  const user = await requireOsUser("/mandates");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const m = await mandateById(db, user.scope, id);
  if (!m) notFound();
  const internal = isInternal(user.scope);
  const tab = TABS.some(([k]) => k === sp.tab) && (sp.tab !== "economics" || internal) ? sp.tab! : "overview";
  const [fn, work] = await Promise.all([funnelFor(db, user.scope, id), getWork(db, id)]);
  const showWork = work && (work.phase !== "done" || (work.finishedAt && Date.parse(work.finishedAt) > Date.parse(new Date().toISOString()) - 120_000));
  const type = m.type as MandateType;

  return (
    <>
      <PageHeader title={m.name} actions={<form action={buildUniverseAction}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Build / refresh universe</button></form>} />
      <Notice text={sp.notice} />
      {showWork && work && <WorkProgress key={work.startedAt + work.phase} id={m.id} initial={work} />}
      <div className={f.inline} style={{ marginBottom: 10 }}>
        <span className={s.reading} data-r={m.health}>{HEALTH[m.health as keyof typeof HEALTH]}</span>
        <span className={s.reading}>{MANDATE_STATUSES[m.status as keyof typeof MANDATE_STATUSES] ?? m.status}</span>
        <span className={ui.sub} style={{ margin: 0 }}>{MANDATE_TYPES[type].label} · {MANDATE_TYPES[type].side} · {DESKS[m.desk as keyof typeof DESKS]} desk{m.clientName ? ` · client ${m.clientName}` : ""}{m.owner ? ` · owner ${m.owner}` : ""}</span>
      </div>
      <nav className={ui.tabs} aria-label="Mandate views">
        {TABS.filter(([k]) => k !== "economics" || internal).map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/mandates/${m.id}${k === "overview" ? "" : `?tab=${k}`}`}>{v}{k === "universe" ? <span className={ui.tabCount}>{fn.total}</span> : null}</Link>)}
      </nav>
      {tab === "overview" && <Overview m={m} fn={fn} />}
      {tab === "universe" && <Universe m={m} sp={sp} scope={user.scope} internal={internal} />}
      {tab === "client" && <ClientQueue m={m} scope={user.scope} />}
      {tab === "pursuits" && <Pursuits m={m} scope={user.scope} />}
      {tab === "signals" && <Signals m={m} scope={user.scope} status={sp.status ?? "new"} />}
      {tab === "delivery" && <Delivery m={m} period={sp.period ?? new Date().toISOString().slice(0, 7)} />}
      {tab === "economics" && <Economics m={m} />}
      {tab === "report" && <Report m={m} scope={user.scope} fn={fn} />}
      {tab === "profile" && <Profile m={m} />}
    </>
  );
}

type M = NonNullable<Awaited<ReturnType<typeof mandateById>>>;
type Fn = Awaited<ReturnType<typeof funnelFor>>;
type Scope = Parameters<typeof mandateById>[1];

async function Overview({ m, fn }: { m: M; fn: Fn }) {
  const h = await mandateHealth(appDb(), m);
  const max = Math.max(1, ...fn.cumulative.map(c => c.n));
  const type = m.type as MandateType;
  return (
    <div className={f.layout}>
      <div>
        <h3 className={f.kicker}>Funnel (cumulative, from records)</h3>
        <ul className={f.funnel}>
          {fn.cumulative.map((c, i) => (
            <li key={c.stage}><span>{CANDIDATE_STAGES[c.stage]}</span><span className={f.num}>{c.n}</span><span className={f.bar}><i style={{ width: `${(c.n / max) * 100}%` }} /></span><span className={`${f.num} conv`}>{i > 0 && fn.cumulative[i - 1].n ? pct(c.n / fn.cumulative[i - 1].n) : ""}</span></li>
          ))}
        </ul>
        <p className={ui.sub}>Watching {fn.byStage.watch} · rejected {fn.byStage.rejected} · excluded {fn.byStage.excluded}. Machine screening stops at pre-qualified; qualification and later stages are recorded by a person against written criteria.</p>
        <h3 className={f.kicker} style={{ marginTop: 18 }}>Activity → output → outcome → commercial result</h3>
        <div className={s.levels}>
          <div><h4>Activity</h4><p><b>{fn.levels.activity.screened}</b> screened of <b>{fn.levels.activity.universe}</b> in the universe</p></div>
          <div><h4>Output</h4><p><b>{fn.levels.output.matched}</b> matched · <b>{fn.levels.output.preQualified}</b> pre-qualified · <b>{fn.levels.output.qualified}</b> qualified</p></div>
          <div><h4>Outcome</h4><p><b>{fn.levels.outcome.approved}</b> client-approved · <b>{fn.levels.outcome.alreadyKnown}</b> already known · <b>{fn.levels.outcome.pursuits}</b> pursuits</p></div>
          <div><h4>Commercial result</h4><p><b>{fn.levels.commercial.rfx}</b> RFx / term stage · <b>{fn.levels.commercial.won}</b> won · <b>{fn.levels.commercial.lost}</b> lost</p></div>
        </div>
        <h3 className={f.kicker}>Qualification definition ({MANDATE_TYPES[type].label})</h3>
        {m.qualificationNote && <p className={f.brief}>{m.qualificationNote}</p>}
        <ul className={s.evidence} style={{ marginTop: 8 }}>{qualificationFor(type).map(q => <li key={q.key} data-k={q.machine ? "source" : "analyst"}><span className={s.ek}>{q.level}{q.machine ? " · machine-checkable" : " · person records"}</span>{q.label}</li>)}</ul>
      </div>
      <aside className={f.aside}>
        <h3>Health</h3><p><span className={s.reading} data-r={h.health}>{HEALTH[h.health as keyof typeof HEALTH]}</span></p>
        {h.behind.length > 0 && <p className={ui.sub}>{h.behind.join(" · ")}</p>}
        {h.stale.length > 0 && <p className={ui.sub}>Stalled: {h.stale.map(x => x.name).join(", ")}</p>}
        <h3>Next action</h3><p>{m.nextAction || "—"}{m.nextActionDate ? ` (${day(m.nextActionDate)})` : ""}</p>
        <h3>Geography</h3><p>{[...(m.geography.isos ?? []), ...(m.geography.states ?? []), ...(m.geography.countries ?? [])].join(", ") || "—"}</p>
        <h3>Technologies</h3><p>{m.technologies.map(label).join(", ") || "—"}</p>
        <h3>Criteria</h3><p className={ui.sub}>{Object.entries(m.criteria).map(([k, v]) => `${BUILDER[type].find(b => b.key === k)?.label ?? k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ") || "—"}</p>
        <h3>Exclusions</h3><p className={ui.sub}>{m.exclusions || "—"}</p>
        <h3>Attribution</h3><p className={ui.sub}>{m.attributionRules || "—"}</p>
        <h3>Outreach</h3><p>{OUTREACH_PERMISSION[m.outreachPermission as keyof typeof OUTREACH_PERMISSION] ?? m.outreachPermission}</p>
        {m.complianceRequirements && <><h3>Compliance</h3><p className={s.caution}>{m.complianceRequirements}</p></>}
        <h3>Reporting</h3><p>{CADENCE[m.reportingCadence as keyof typeof CADENCE] ?? m.reportingCadence}</p>
        {m.sources.length > 0 && <><h3>Sources</h3>{m.sources.map(x => <p key={x.url} className={ui.sub}><a href={x.url} target="_blank" rel="noreferrer">{x.label}</a> · {day(x.at)}</p>)}</>}
      </aside>
    </div>
  );
}

const dots = (fit: Record<string, { reading: string }>) => <span className={s.fitDots} aria-hidden>{(Object.keys(FIT_DIMENSIONS)).map(k => <i key={k} data-r={fit[k]?.reading ?? "unknown"} title={`${FIT_DIMENSIONS[k as keyof typeof FIT_DIMENSIONS]}: ${fit[k]?.reading ?? "unknown"}`} />)}</span>;

async function Universe({ m, sp, scope, internal }: { m: M; sp: Sp; scope: Scope; internal: boolean }) {
  const PAGE = 100;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const { rows, total, states } = await candidatePage(appDb(), scope, m.id, { stage: sp.stage ?? "open", priority: sp.priority, q: sp.q, state: sp.state, response: sp.response, limit: PAGE, offset: page * PAGE });
  const qs = (n: number) => `/mandates/${m.id}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v != null && k !== "page" && k !== "notice")) as Record<string, string>, tab: "universe", page: String(n) }).toString()}`;
  const pager = total > PAGE ? <p className={f.inline} style={{ margin: "10px 0", fontSize: 12.5 }}><span className={f.muted}>Showing {(page * PAGE + 1).toLocaleString("en-US")}–{Math.min(total, (page + 1) * PAGE).toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>{page > 0 && <Link href={qs(page - 1)}>Previous</Link>}{(page + 1) * PAGE < total && <Link href={qs(page + 1)}>Next</Link>}</p> : null;
  return (
    <>
      <form action={withBase(`/mandates/${m.id}`)} className={f.inline} style={{ marginBottom: 10 }}>
        <input type="hidden" name="tab" value="universe" />
        <input name="q" defaultValue={sp.q} placeholder="Name, queue number, county" aria-label="Search" />
        <select name="stage" defaultValue={sp.stage ?? "open"} aria-label="Stage"><option value="open">All open</option><option value="">Everything</option>{Object.entries(CANDIDATE_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="priority" defaultValue={sp.priority ?? ""} aria-label="Priority"><option value="">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        {states.length > 0 && <select name="state" defaultValue={sp.state ?? ""} aria-label="State"><option value="">All states</option>{states.map(x => <option key={x}>{x}</option>)}</select>}
        <select name="response" defaultValue={sp.response ?? ""} aria-label="Client response"><option value="">Any client response</option><option value="none">No response yet</option>{Object.entries(CLIENT_RESPONSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
        {internal && m.type === "epc_origination" && <span className={f.inline}><input type="hidden" form="sync" name="id" value={m.id} /><button className="btn" type="submit" form="sync">Sync MISO + SPP queues</button></span>}
      </form>
      {internal && m.type === "epc_origination" && <form id="sync" action={syncQueuesAction}><input type="hidden" name="id" value={m.id} /></form>}
      <p className={ui.sub}>Fit dots read: {Object.values(FIT_DIMENSIONS).join(" · ")}. Each reading has its basis on the candidate page. Values marked inference (EPC value, procurement window) are planning estimates, not sourced facts.</p>
      {pager}
      {rows.length === 0 ? <EmptyState icon={Target} title="Universe is empty" body={m.type === "epc_origination" ? "Sync the public MISO and SPP queues, then build the universe." : "Build the universe to screen canonical records against this mandate."} /> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Candidate</th><th>Stage</th><th>Fit</th><th className={ui.num}>Criteria</th><th>Window (inference)</th><th className={ui.num}>Est. value</th><th>Priority</th><th>Client</th></tr></thead>
          <tbody>{rows.map(c => (
            <tr key={c.id}>
              <td className={ui.wrap}><span className={ui.primary}><Link href={`/mandates/candidates/${c.id}`}>{c.name}</Link></span><span className={ui.sub}>{c.accountOrgId ? "Sponsor linked" : c.entityType === "queue_project" ? "Sponsor unidentified (queue)" : label(c.entityType)}{c.lastSignalAt ? ` · signal ${day(c.lastSignalAt)}` : ""}</span></td>
              <td><span className={s.reading} data-r={STAGE_ORDER.indexOf(c.stage as never) >= STAGE_ORDER.indexOf("qualified") ? "strong" : c.stage === "pre_qualified" ? "partial" : c.stage === "rejected" || c.stage === "excluded" ? "fail" : undefined}>{CANDIDATE_STAGES[c.stage as keyof typeof CANDIDATE_STAGES] ?? c.stage}</span></td>
              <td>{dots(c.fit)}</td>
              <td className={ui.num}>{c.metCount} met<span className={ui.sub}>{c.unknownCount} unknown · {c.failCount} not met</span></td>
              <td>{c.windowStart ? `${day(c.windowStart)} → ${day(c.windowEnd)}` : "—"}</td>
              <td className={ui.num}>{money(c.estValue)}</td>
              <td><span className={s.reading} data-r={c.priority === "high" ? "strong" : c.priority === "low" ? "weak" : undefined}>{c.priority}</span></td>
              <td>{c.clientResponse ? CLIENT_RESPONSES[c.clientResponse as ClientResponse].label : "—"}<span className={ui.sub}>{ATTRIBUTION[c.attribution as keyof typeof ATTRIBUTION]?.label}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {pager}
    </>
  );
}

async function ClientQueue({ m, scope }: { m: M; scope: Scope }) {
  const SHOW = 25;
  const all = (await candidatesFor(appDb(), scope, m.id, { response: "none", limit: 2000 })).filter(c => c.stage === "pre_qualified" || c.stage === "qualified");
  const rows = all.slice(0, SHOW);
  return (
    <>
      <p className={ui.notice}>The client approves opportunities by name. Approve pursuit makes the opportunity attribution-protected (Regenera originated unless it is on the pre-existing list); Already known records it as client originated with no success fee. Only pre-qualified or qualified opportunities appear here.</p>
      {all.length > SHOW && <p className={ui.sub}>Showing the {SHOW} highest-priority of {all.length.toLocaleString("en-US")} awaiting a decision (qualified first, then priority and window). The rest are in the <Link href={`/mandates/${m.id}?tab=universe&response=none`}>Universe</Link>.</p>}
      {rows.length === 0 ? <EmptyState icon={Target} title="Nothing awaiting the client" body="Pre-qualified and qualified opportunities without a client response appear here." /> : rows.map(c => (
        <section key={c.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
          <div className={f.inline}><strong><Link href={`/mandates/candidates/${c.id}`}>{c.name}</Link></strong><span className={s.reading} data-r={c.stage === "qualified" ? "strong" : "partial"}>{CANDIDATE_STAGES[c.stage as keyof typeof CANDIDATE_STAGES]}</span><span className={s.reading} data-r={c.priority === "high" ? "strong" : undefined}>{c.priority}</span></div>
          <p className={ui.sub}>{money(c.estValue)} est. ({c.estValueBasis ? "inference" : "not estimated"}) · window {c.windowStart ? `${day(c.windowStart)} → ${day(c.windowEnd)}` : "unknown"} · {c.metCount} criteria met, {c.unknownCount} unknown</p>
          <p className={ui.sub}>Why surfaced: {String(c.data.priorityWhy ?? "")} {c.fit.timing?.basis ?? ""}</p>
          <div className={s.respond}>{(Object.keys(CLIENT_RESPONSES) as ClientResponse[]).map(r => (
            <form key={r} action={clientRespondAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="response" value={r} /><input type="hidden" name="back" value={`/mandates/${m.id}?tab=client`} /><button className={r === "approve" ? "btn btn-primary" : "btn"} type="submit">{CLIENT_RESPONSES[r].label}</button></form>
          ))}</div>
        </section>
      ))}
    </>
  );
}

async function Pursuits({ m, scope }: { m: M; scope: Scope }) {
  const rows = await pursuitsFor(appDb(), scope, { cm: m.id });
  return rows.length === 0 ? <EmptyState icon={Target} title="No pursuits yet" body="A pursuit opens from a client-approved candidate." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Pursuit</th><th>Type</th><th>Stage</th><th className={ui.num}>Value</th><th className={ui.num}>Probability</th><th>Owner</th><th>Next action</th><th>Attribution</th></tr></thead>
      <tbody>{rows.map(({ p, prob }) => <tr key={p.id}><td><Link href={`/pursuits/${p.id}`}>{p.name}</Link><span className={ui.sub}>{p.outcome !== "open" ? label(p.outcome) : ""}</span></td><td>{PURSUIT_TYPES[p.type as keyof typeof PURSUIT_TYPES]}</td><td>{label(p.stage)}</td><td className={ui.num}>{money(p.value)}</td><td className={ui.num}>{prob.effective}%<span className={ui.sub}>{prob.overridden ? "override" : "stage default"}</span></td><td>{p.owner ?? "—"}</td><td className={ui.wrap}>{p.nextAction || "—"}</td><td>{ATTRIBUTION[p.attribution as keyof typeof ATTRIBUTION]?.label}</td></tr>)}</tbody>
    </table></div>
  );
}

async function Signals({ m, scope, status }: { m: M; scope: Scope; status: string }) {
  const rows = await signalsFor(appDb(), scope, m.id, status);
  return (
    <>
      <nav className={f.inline} style={{ marginBottom: 8 }}>{["new", "reviewed", "actioned", "dismissed", "all"].map(x => <Link key={x} className={s.reading} data-r={x === status ? "strong" : undefined} href={`/mandates/${m.id}?tab=signals&status=${x}`}>{x}</Link>)}</nav>
      {rows.length === 0 ? <EmptyState icon={Target} title="No signals" body="Queue status changes, interconnection-agreement progress and date changes on candidates appear here after each daily sync." /> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Observed</th><th>What changed</th><th>Why it matters</th><th>Recommended action</th><th>Urgency</th><th /></tr></thead>
          <tbody>{rows.map(x => (
            <tr key={x.id}><td>{day(x.observedAt)}<span className={ui.sub}>{SIGNAL_KINDS[x.kind as keyof typeof SIGNAL_KINDS] ?? x.kind}</span></td><td className={ui.wrap}>{x.candidateId ? <Link href={`/mandates/candidates/${x.candidateId}`}>{x.whatChanged}</Link> : x.whatChanged}<span className={ui.sub}>{x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noreferrer">{x.source}</a> : x.source}</span></td><td className={ui.wrap}>{x.inference && <span className={s.ek} data-k="inference">inference</span>}{x.whyItMatters}</td><td className={ui.wrap}>{x.recommendedAction}</td><td>{x.urgency}</td>
              <td>{x.status === "new" && <span className={f.inline}>{(["reviewed", "actioned", "dismissed"] as const).map(st => <form key={st} action={signalStatusAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value={st} /><input type="hidden" name="back" value={`/mandates/${m.id}?tab=signals`} /><button className="btn" type="submit">{st}</button></form>)}</span>}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}

async function Delivery({ m, period }: { m: M; period: string }) {
  const d = await deliveryFloor(appDb(), m, period);
  return (
    <>
      <form action={withBase(`/mandates/${m.id}`)} className={f.inline} style={{ marginBottom: 10 }}><input type="hidden" name="tab" value="delivery" /><input name="period" type="month" defaultValue={period} aria-label="Period" /><button className="btn" type="submit">Show</button></form>
      {d.lines.length === 0 ? <EmptyState icon={Target} title="No delivery floor" body="Set monthly targets in Profile. Delivered counts come from the records; raw activity is never the only measure." /> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Metric</th><th>Level</th><th className={ui.num}>Target</th><th className={ui.num}>Delivered</th><th>Status</th></tr></thead>
          <tbody>{d.lines.map(l => <tr key={l.metric}><td>{l.label}</td><td>{l.level}</td><td className={ui.num}>{l.target}</td><td className={ui.num}>{l.delivered}</td><td><span className={s.reading} data-r={l.met ? "yes" : "weak"}>{l.met ? "Met" : `Short ${l.target - l.delivered}`}</span></td></tr>)}</tbody>
        </table></div>
      )}
      <h3 className={f.kicker} style={{ marginTop: 16 }}>Mandate lead review for {period}</h3>
      {d.review && <p className={ui.sub}>Reviewed by {d.review.reviewedBy} on {day(d.review.reviewedAt)}: {d.review.status}.</p>}
      <form action={reviewDeliveryAction} className={f.form} style={{ maxWidth: 720 }}>
        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="period" value={period} />
        <label>Quality of what was delivered<textarea name="quality" defaultValue={d.review?.quality ?? ""} /></label>
        <label>Shortfall<textarea name="shortfall" defaultValue={d.review?.shortfall ?? ""} /></label>
        <label>Remediation<textarea name="remediation" defaultValue={d.review?.remediation ?? ""} /></label>
        <div><button className="btn" type="submit">Record review</button></div>
      </form>
    </>
  );
}

async function Economics({ m }: { m: M }) {
  const e = await mandateEconomics(appDb(), m);
  return (
    <>
      <div className={f.econ}>
        <div><b>{money(e.monthlyRevenue)}</b><span>Retainer / month</span></div>
        <div><b>{money(e.monthlyCost)}</b><span>Delivery cost / month</span></div>
        <div><b>{money(e.contribution)}</b><span>Contribution / month</span></div>
        <div><b>{money(e.totalRevenue)}</b><span>Expected revenue ({e.months} mo)</span></div>
        <div><b>{money(e.grossProfit)}</b><span>Expected gross profit</span></div>
        <div><b>{pct(e.margin)}</b><span>Expected margin</span></div>
      </div>
      {e.assumedRates && <p className={s.caution}>Some seats use the internal planning rate (no team member with a cost rate assigned). Add people and rates under Operations → Capacity.</p>}
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Seat</th><th className={ui.num}>Hours / month</th><th>Who</th><th className={ui.num}>Rate</th><th className={ui.num}>Cost</th></tr></thead>
        <tbody>{e.seats.map(x => <tr key={x.seat}><td>{SEATS[x.seat]}</td><td className={ui.num}>{x.hours}</td><td>{x.who ?? "Unassigned (planning rate)"}</td><td className={ui.num}>{money(x.rate)}</td><td className={ui.num}>{money(x.cost)}</td></tr>)}
          <tr><td>Data, partners, travel</td><td /><td /><td /><td className={ui.num}>{money(m.dataCost + m.partnerCost + m.travelCost)}</td></tr></tbody>
      </table></div>
      <h3 className={f.kicker} style={{ marginTop: 14 }}>Outcome economics</h3>
      <p className={s.caution}>{e.successNote}</p>
      {e.recommended && <><h3 className={f.kicker}>Recommended structure (template)</h3><p>{money(e.recommended.low)} – {money(e.recommended.high)} {ENGAGEMENT_MODELS[m.engagementModel as keyof typeof ENGAGEMENT_MODELS]?.billing === "monthly" ? "per month" : ENGAGEMENT_MODELS[m.engagementModel as keyof typeof ENGAGEMENT_MODELS]?.billing === "annual" ? "per year" : "fixed"}</p><p className={ui.sub}>{e.recommended.why}</p></>}
    </>
  );
}

async function Report({ m, scope, fn }: { m: M; scope: Scope; fn: Fn }) {
  const db = appDb();
  const now = new Date(), since = new Date(now.getTime() - 7 * 864e5).toISOString();
  const cands = await candidatesFor(db, scope, m.id, { stage: "", limit: 2000 });
  const purs = await pursuitsFor(db, scope, { cm: m.id });
  const sig = (await signalsFor(db, scope, m.id, "all")).filter(x => x.observedAt >= since);
  const newC = cands.filter(c => c.firstSeenAt >= since), moved = cands.filter(c => c.stageHistory.some(h => h.at >= since && h.by !== "engine"));
  const top = cands.filter(c => c.priority === "high" && ["pre_qualified", "qualified"].includes(c.stage)).slice(0, 10);
  const h = await mandateHealth(db, m, now);
  return (
    <div className={s.report}>
      <p className={ui.sub}>Weekly report generated from the records on {day(now.toISOString())}. Every line links to the record behind it; inferences are labelled.</p>
      <h3>Headline</h3><p>{fn.total} in the universe · {fn.levels.output.preQualified} pre-qualified · {fn.levels.output.qualified} qualified · {fn.levels.outcome.approved} client-approved · {purs.filter(p => p.p.outcome === "open").length} open pursuits · health {HEALTH[h.health as keyof typeof HEALTH]}.</p>
      <h3>This week</h3><ul><li>{newC.length} newly screened candidates</li><li>{moved.length} candidates moved by a person</li><li>{sig.length} signals observed</li></ul>
      <h3>Priority recommendations</h3>{top.length ? <ul>{top.map(c => <li key={c.id}><Link href={`/mandates/candidates/${c.id}`}>{c.name}</Link> · {money(c.estValue)} (inference) · window {c.windowStart ? day(c.windowStart) : "unknown"} · next: {c.nextAction}</li>)}</ul> : <p>None at high priority yet.</p>}
      <h3>Pursuits</h3>{purs.length ? <ul>{purs.map(({ p, prob }) => <li key={p.id}><Link href={`/pursuits/${p.id}`}>{p.name}</Link> · {label(p.stage)} · {prob.effective}% · next: {p.nextAction || "—"}</li>)}</ul> : <p>No pursuits yet.</p>}
      <h3>Signals</h3>{sig.length ? <ul>{sig.slice(0, 15).map(x => <li key={x.id}>{x.inference ? "[inference] " : ""}{x.whatChanged}: {x.recommendedAction}</li>)}</ul> : <p>No signals this week.</p>}
      <h3>Risks and gaps</h3><ul>{h.behind.map(b => <li key={b}>{b}</li>)}{h.stale.map(x => <li key={x.id}>Stalled pursuit: {x.name}</li>)}{!h.behind.length && !h.stale.length && <li>None recorded.</li>}</ul>
    </div>
  );
}

function Profile({ m }: { m: M }) {
  const type = m.type as MandateType;
  const cv = (k: string) => { const v = m.criteria[k]; return Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v); };
  const fl = (k: string) => m.deliveryFloor.find(x => x.metric === k)?.target ?? "";
  return (
    <>
      <form action={updateMandateAction} className={f.grid3}>
        <input type="hidden" name="id" value={m.id} />
        <label className={f.full}>Name<input name="name" defaultValue={m.name} /></label>
        <label>Client<input name="clientName" defaultValue={m.clientName} /></label>
        <label>Client entity<input name="clientEntity" defaultValue={m.clientEntity} /></label>
        <label>Status<select name="status" defaultValue={m.status}>{Object.entries(MANDATE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Owner<input name="owner" defaultValue={m.owner ?? ""} /></label>
        <label>Lead<input name="lead" defaultValue={m.lead ?? ""} /></label>
        <label>Originator<input name="originator" defaultValue={m.originator ?? ""} /></label>
        <label>Priority<select name="priority" defaultValue={m.priority}><option>critical</option><option>high</option><option>medium</option><option>low</option></select></label>
        <label>Technologies<input name="c_technologies" defaultValue={m.technologies.join(", ")} /></label>
        <label>Countries<input name="c_countries" defaultValue={(m.geography.countries ?? []).join(", ")} /></label>
        <label>States / provinces<input name="c_states" defaultValue={(m.geography.states ?? []).join(", ")} /></label>
        <label>ISO / RTO<input name="c_isos" defaultValue={(m.geography.isos ?? []).join(", ")} /></label>
        {BUILDER[type].filter(c => !["technologies", "countries", "states", "isos"].includes(c.key)).map(c => <label key={c.key} className={c.kind === "text" ? f.full : undefined}>{c.label}{c.unit ? ` (${c.unit})` : ""}{c.kind === "select" ? <select name={`c_${c.key}`} defaultValue={cv(c.key)}><option value="">—</option>{c.options!.map(o => <option key={o} value={o}>{label(o)}</option>)}</select> : <input name={`c_${c.key}`} defaultValue={cv(c.key)} placeholder={c.hint} />}</label>)}
        <label className={f.full}>Exclusions<textarea name="exclusions" defaultValue={m.exclusions} /></label>
        <label className={f.full}>Qualification definition<textarea name="qualificationNote" defaultValue={m.qualificationNote} /></label>
        <label className={f.full}>Success definition<textarea name="successDefinition" defaultValue={m.successDefinition} /></label>
        <label>Engagement model<select name="engagementModel" defaultValue={m.engagementModel ?? ""}><option value="">—</option>{Object.entries(ENGAGEMENT_MODELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Breadth<select name="breadth" defaultValue={m.breadth}>{Object.entries(BREADTH).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Term (months)<input name="termMonths" defaultValue={m.termMonths ?? ""} /></label>
        <label>Pilot / fixed fee<input name="pilotFee" defaultValue={m.pilotFee || ""} /></label>
        <label>Retainer / month<input name="retainer" defaultValue={m.retainer || ""} /></label>
        <label>Implementation<input name="implementationFee" defaultValue={m.implementationFee || ""} /></label>
        <label>Data cost / month<input name="dataCost" defaultValue={m.dataCost || ""} /></label>
        <label>Partner cost / month<input name="partnerCost" defaultValue={m.partnerCost || ""} /></label>
        <label>Travel / month<input name="travelCost" defaultValue={m.travelCost || ""} /></label>
        <label>Success structure<select name="successStructure" defaultValue={m.successEconomics.structure ?? "none"}>{Object.entries(SUCCESS_STRUCTURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Rate (%)<input name="successRate" defaultValue={m.successEconomics.rate ?? ""} /></label>
        <label>Fixed amount<input name="successAmount" defaultValue={m.successEconomics.amount ?? ""} /></label>
        <label>Cap<input name="successCap" defaultValue={m.successEconomics.cap ?? ""} /></label>
        <label>Floor<input name="successFloor" defaultValue={m.successEconomics.floor ?? ""} /></label>
        <label>Attribution window (months)<input name="attributionWindow" defaultValue={m.successEconomics.attributionWindowMonths ?? ""} /></label>
        <label className={f.full}>Applies to<input name="successAppliesTo" defaultValue={m.successEconomics.appliesTo ?? ""} /></label>
        <label className={f.full}>Success-fee exclusions<input name="successExclusions" defaultValue={m.successEconomics.exclusions ?? ""} /></label>
        <label>Payment event<input name="paymentEvent" defaultValue={m.successEconomics.paymentEvent ?? ""} /></label>
        <label><span><input type="checkbox" name="counselReviewed" defaultChecked={!!m.successEconomics.counselReviewed} /> Counsel reviewed the success terms</span></label>
        <label className={f.full}>Attribution rules<textarea name="attributionRules" defaultValue={m.attributionRules} /></label>
        <label>Outreach permission<select name="outreachPermission" defaultValue={m.outreachPermission}>{Object.entries(OUTREACH_PERMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Confidentiality<select name="confidentiality" defaultValue={m.confidentiality}>{Object.entries(CONFIDENTIALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Reporting<select name="reportingCadence" defaultValue={m.reportingCadence}>{Object.entries(CADENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Start<input type="date" name="startDate" defaultValue={m.startDate ?? ""} /></label>
        <label>Review<input type="date" name="reviewDate" defaultValue={m.reviewDate ?? ""} /></label>
        <label>End<input type="date" name="endDate" defaultValue={m.endDate ?? ""} /></label>
        <p className={`${f.full} ${f.kicker}`}>Delivery floor per month</p>
        {Object.entries(DELIVERY_METRICS).map(([k, v]) => <label key={k}>{v.label}<input name={`floor_${k}`} defaultValue={fl(k)} inputMode="numeric" /></label>)}
        <label className={f.full}>Compliance requirements<textarea name="complianceRequirements" defaultValue={m.complianceRequirements} /></label>
        <label className={f.full}>Legal restrictions<textarea name="legalRestrictions" defaultValue={m.legalRestrictions} /></label>
        <label className={f.full}>Next action<input name="nextAction" defaultValue={m.nextAction} /></label>
        <label>Next action date<input type="date" name="nextActionDate" defaultValue={m.nextActionDate ?? ""} /></label>
        <label className={f.full}>Anonymized public line (no names; publication needs owner approval)<input name="publicLabel" defaultValue={m.publicLabel} placeholder="UTILITY SOLAR + BESS · U.S. · EPC PROCUREMENT · 2027" /></label>
        <div className={f.full}><button className="btn btn-primary" type="submit">Save</button></div>
      </form>
      <form action={approvePublicationAction} className={f.inline} style={{ marginTop: 10 }}><input type="hidden" name="id" value={m.id} /><span className={ui.sub}>Publication: {m.publishApproved ? "approved" : "not approved"}</span><button className="btn" type="submit" disabled={!m.publicLabel || m.publishApproved}>Approve anonymized line</button></form>
    </>
  );
}
