import Link from "next/link";
import { Suspense } from "react";
import Loading from "../loading";
import { Notice } from "@/components/crm-bits";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import MiniMap from "@/components/mini-map";
import { projects, tenantMembers } from "@/db/schema";
import { isNotNull, isNull } from "drizzle-orm";
import t from "./today.module.css";
import { requireOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { homeData } from "@/lib/crm/home";
import { deliverabilityIssues } from "@/lib/outreach/deliverability";
import { engageCounts, sendingOverview, upcomingMeetings } from "@/lib/outreach/queries";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { capitalOpportunities, proposals } from "@/db/schema";
import { appDb, isInternal, mandateCondition } from "@/lib/db/scoped";
import { commercialOverview } from "@/lib/commercial/engine";
import { commercialMetrics } from "@/lib/commercial/metrics";
import { confirmProposalAction, rejectProposalAction } from "../intel-actions";
import { fundingCounts } from "@/lib/funding/queries";
import { fundingCommand } from "@/lib/funding/origination-queries";
import { builtCommand } from "@/lib/built/engine";
import { mandateCommand } from "@/lib/mandates/queries";
import { mailCommand } from "@/lib/mail-intel/queries";
import { contractTotals } from "@/lib/contracts/queries";
import { DEAL_STAGES } from "@/lib/vocab";
import { projectAlerts } from "@/lib/projects/engine";
import { stageLabel } from "@/lib/projects/labels";
import { obligationAlerts } from "@/lib/contracts/register";
import { regulatoryAlerts } from "@/lib/regulatory/engine";
import { deliveryAlerts } from "@/lib/delivery/engine";
import { procurementAlerts } from "@/lib/procurement/engine";
import { changesSinceLastSession, needsAttention, operatingStrip } from "@/lib/command/attention";
import { compactMoney } from "@/lib/projects/labels";
import { capitalAlignment } from "@/lib/alignment/engine";
import { ALIGNMENT } from "@/lib/alignment/vocab";
import { ES_TOPICS, INSURANCE_TYPES, STUDY_TYPES } from "@/lib/delivery/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

function Stat({ n, label, href, warn }: { n: number | string; label: string; href?: string; warn?: boolean }) {
  const body = <><b style={warn && Number(n) > 0 ? { color: "#b0432f" } : undefined}>{n}</b><span>{label}</span></>;
  return href ? <Link className={ui.stat} href={href}>{body}</Link> : <div className={ui.stat}>{body}</div>;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/today");
  const sp = await searchParams;
  // A real name only when one is recorded (Organization → Users); an email handle is not a name.
  const [member] = await appDb().select({ name: tenantMembers.name }).from(tenantMembers).where(eq(tenantMembers.email, user.email)).limit(1);
  const name = member?.name?.trim().split(/\s+/)[0] ?? "";
  const now = new Date();
  const tz = "America/Merida";
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(now);
  // The header renders at once; the body streams in behind a structural skeleton as its queries resolve.
  return (
    <>
      <header className={t.head}>
        <p className={t.date}>{date}</p>
        <div className={t.row}><h1 className={t.hello}>{greeting}{name ? `, ${name}` : ""}.</h1><Link className="btn" href="/map">Open Atlas</Link></div>
      </header>
      <Notice text={sp.notice} />
      <Suspense fallback={<Loading />}>
        <TodayBody user={user} sp={sp} />
      </Suspense>
    </>
  );
}

async function TodayBody({ user, sp }: { user: Awaited<ReturnType<typeof requireOsUser>>; sp: Record<string, string | undefined> }) {
  // Every independent read runs in one parallel round (on D1 each read is a network round trip); only "needs attention"
  // waits, because it consumes the alert sets.
  const db = appDb(), ws = user.scope.mandateIds;
  // Regenera's own commercial position: internal staff only, never a client user (hardening §31; company model §30).
  const internal = isInternal(user.scope);
  const [d, engage, sending, meetings, funding, contractStats, projectFlags, obligationFlags, regFlags, delivery, procurement, strip, changes, comm, fc, be, mc, mail, align, pending, [gateQueue], located] = await Promise.all([
    homeData(user.scope), engageCounts(user.scope), sendingOverview(), upcomingMeetings(user.scope), fundingCounts(user.scope), contractTotals(user.scope),
    projectAlerts(db, ws), obligationAlerts(db, ws), regulatoryAlerts(db, ws), deliveryAlerts(db, ws), procurementAlerts(db, ws),
    operatingStrip(db, ws), changesSinceLastSession(db, ws, user.email),
    internal ? commercialOverview(db, ws) : Promise.resolve(null),
    internal ? fundingCommand(user.scope) : Promise.resolve(null),
    builtCommand(db, ws).catch(() => []),
    mandateCommand(db, user.scope).catch(() => null),
    mailCommand(db, user.scope).catch(() => null),
    capitalAlignment(db, ws),
    db.select({ id: proposals.id, title: proposals.title, source: proposals.source, createdAt: proposals.createdAt }).from(proposals)
      .where(and(mandateCondition(user.scope, proposals.mandateId), eq(proposals.status, "pending"), eq(proposals.kind, "action"))).orderBy(desc(proposals.createdAt)).limit(10),
    db.select({ n: sql<number>`count(*)` }).from(capitalOpportunities)
      .where(and(mandateCondition(user.scope, capitalOpportunities.mandateId), inArray(capitalOpportunities.gateState, ["review_required", "hold"]), sql`${capitalOpportunities.status} != 'closed'`)),
    db.select({ id: projects.id, name: projects.name, lat: projects.lat, lng: projects.lng, stage: projects.stage, country: projects.country }).from(projects)
      .where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt), isNotNull(projects.lat), isNotNull(projects.lng))).limit(500),
  ]);
  const attention = await needsAttention(db, ws, user.email, new Date(), { pa: projectFlags, del: delivery, proc: procurement, reg: regFlags, obl: obligationFlags });
  const showAll = sp.attention === "all";
  const cm = comm ? commercialMetrics(comm.rows) : null;
  const flagged = new Set(attention.map(a => a.href.match(/^\/projects\/([^/?]+)/)?.[1]).filter(Boolean));
  const points = located.map(p => ({ id: p.id, name: p.name, lat: p.lat!, lng: p.lng!, stage: stageLabel(p.stage as never) ?? p.stage, sub: p.country ?? undefined, alert: flagged.has(p.id) }));
  const critical = attention.filter(a => a.severity === "critical" || a.severity === "high").length;
  const now = new Date().toISOString();
  const alerts = [
    ...sending.checks.flatMap(c => deliverabilityIssues(c)),
    ...sending.state.filter(s => s.pausedUntil && s.pausedUntil > now).map(s => `${s.role === "primary" ? "regenera.bio" : "Sending"} mailbox paused: ${s.pauseReason ?? ""}`),
  ];
  const ai = aiConfig();
  const apollo = apolloConfig();
  return (
    <>
      <p className={t.statement}>{attention.length === 0 ? "Nothing needs attention across the portfolio." : `${attention.length} item${attention.length === 1 ? " needs" : "s need"} attention${critical ? `, ${critical} of them high or critical` : ""}.`}</p>
      <div className={ui.stats}>
        <Stat n={strip.projects} label="Projects" href="/projects" />
        <Stat n={strip.deals} label="Active opportunities" href="/deals" />
        <Stat n={strip.capital.length ? strip.capital.map(c => compactMoney(c.gap, c.currency)).join(" + ") : "0"} label="Capital still to raise (open requirements)" href="/capital" />
        <Stat n={strip.investors} label="Capital partner profiles" href="/capital" />
        <Stat n={strip.criticalRisks} label="High-impact open risks" href="/projects" warn />
      </div>
      {cm && cm.byCurrency.some(m => m.arr || m.advisoryMrr || m.backlog || m.weighted || m.renewals) && cm.byCurrency.map(m => (
        <div key={m.currency} className={ui.stats} aria-label="Regenera commercial (internal)">
          <Stat n={compactMoney(m.arr, m.currency)} label="Platform ARR" href="/commercial" />
          <Stat n={compactMoney(m.advisoryMrr, m.currency)} label="Advisory MRR" href="/commercial" />
          <Stat n={compactMoney(m.backlog, m.currency)} label="Implementation backlog" href="/commercial" />
          <Stat n={compactMoney(m.weighted, m.currency)} label="Weighted pipeline" href="/commercial?tab=engagements" />
          <Stat n={compactMoney(m.renewals, m.currency)} label="Renewing in 120 days" href="/commercial" />
        </div>))}
      {fc && (fc.activeBids + fc.fresh + fc.deadlines30 + fc.diagnostics + fc.awardsPending + fc.postAward + fc.pipelineCount > 0 || fc.capacity.length > 0) && (
        <section className={r.panel} aria-label="Funding (internal)">
          <p className={r.panelTitle}><span>Funding</span><Link href="/funding?tab=origination">Origination</Link></p>
          <div className={ui.stats} style={{ margin: 0 }}>
            <Stat n={fc.fresh} label="New relevant opportunities, 7 days" href="/funding" />
            <Stat n={fc.deadlines30} label="Tracked deadlines in 30 days" href="/funding?tab=calendar" warn />
            <Stat n={fc.activeBids} label="Active bids" href="/funding?tab=bids" />
            <Stat n={fc.diagnostics} label="Diagnostics in progress" href="/funding?tab=applicants&stage=diagnostic_won" />
            <Stat n={fc.awardsPending} label="Awards pending" href="/funding?tab=bids" />
            <Stat n={fc.postAward} label="Post-award programs" href="/funding?tab=awards" />
            <Stat n={compactMoney(fc.pipelineWeighted, fc.pipelineCurrency)} label={`Funding-originated pipeline, weighted (${fc.pipelineCount})`} href="/funding?tab=origination" />
          </div>
          {(fc.atRisk.length > 0 || fc.capacity.length > 0) && (
            <ul className={r.timeline}>
              {fc.atRisk.slice(0, 6).map(a => <li key={a.id}><span className={r.when} style={{ color: "var(--critical)" }}>At risk</span><span><Link href={`/funding/applications/${a.id}?tab=workplan`}>{a.name}</Link>: {a.why}</span></li>)}
              {fc.capacity.slice(0, 5).map(w => <li key={w.key}><span className={r.when} style={{ color: w.severity === "high" ? "var(--critical)" : undefined }}>Capacity</span><span><Link href="/capacity">{w.issue}</Link></span></li>)}
            </ul>
          )}
          {!fc.teamConfigured && fc.activeBids > 0 && <p className={ui.sub}>Proposal capacity is not measured until the team and cost rates are set in <Link href="/capacity?tab=team">Capacity</Link>.</p>}
        </section>
      )}
      {mc && mc.mandates.length > 0 && (
        <section className={r.panel} aria-label="Mandates">
          <p className={r.panelTitle}><span>Mandates</span><Link href="/mandates">Live mandates</Link></p>
          <div className={ui.stats} style={{ margin: 0 }}>
            <Stat n={mc.active.length} label="Active mandates" href="/mandates?status=active" />
            <Stat n={mc.awaitingClient} label="Awaiting client decision" href="/mandates" />
            <Stat n={mc.pending.length} label="Approvals pending" href="/approvals" warn />
            <Stat n={mc.pursuits.length} label="Open pursuits" href="/pursuits" />
            <Stat n={compactMoney(mc.weighted, "USD")} label="Weighted pursuit pipeline" href="/pursuits" />
            <Stat n={mc.stale.length} label="Stalled pursuits (14 days)" href="/pursuits" warn />
          </div>
          {(mc.pending.length > 0 || mc.signals.length > 0 || mc.atRisk.length > 0) && (
            <ul className={r.timeline}>
              {mc.atRisk.slice(0, 4).map(m => <li key={m.id}><span className={r.when} style={{ color: "var(--critical)" }}>At risk</span><span><Link href={"/mandates/" + m.id}>{m.name}</Link>: {m.healthNote}</span></li>)}
              {mc.pending.slice(0, 5).map(a => <li key={a.id}><span className={r.when}>Approve</span><span><Link href="/approvals">{a.title}</Link></span></li>)}
              {mc.signals.slice(0, 5).map(x => <li key={x.id}><span className={r.when}>{x.inference ? "Signal (inference)" : "Signal"}</span><span>{x.candidateId ? <Link href={"/mandates/candidates/" + x.candidateId}>{x.whatChanged}</Link> : x.whatChanged}<span className={ui.sub} style={{ display: "block" }}>{x.recommendedAction}</span></span></li>)}
            </ul>
          )}
        </section>
      )}
      {mail && (mail.awaiting.length > 0 || mail.obligations.length > 0) && (
        <section className={r.panel} aria-label="Email follow-ups">
          <p className={r.panelTitle}><span>Email follow-ups</span><Link href="/intelligence/mail">Email intelligence</Link></p>
          <ul className={r.timeline}>
            {mail.obligations.slice(0, 5).map(o => <li key={o.id}><span className={r.when}>{o.kind === "commitment" ? (o.byMe ? "I committed" : "They committed") : (o.byMe ? "I asked" : "Asked of me")}</span><span><Link href="/intelligence/mail?tab=obligations">{o.text}</Link><span className={ui.sub} style={{ display: "block" }}>{o.actor} → {o.counterparty}{o.dueDate ? " · due " + o.dueDate.slice(0, 10) : ""}</span></span></li>)}
            {mail.awaiting.slice(0, 5).map(t => <li key={t.key}><span className={r.when}>Reply owed</span><span><Link href="/intelligence/mail?tab=threads&awaiting=me">{t.subject || "(no subject)"}</Link><span className={ui.sub} style={{ display: "block" }}>last message {t.lastAt.slice(0, 10)}</span></span></li>)}
          </ul>
        </section>
      )}
      {be.length > 0 && (
        <section className={r.panel} aria-label="Built environment">
          <p className={r.panelTitle}><span>Built environment</span><Link href="/intelligence/built">Overview</Link></p>
          <ul className={r.timeline}>{be.slice(0, 8).map(x => <li key={x.key}><span className={r.when}>{x.kind}</span><span><Link href={x.href}>{x.text}</Link><span className={ui.sub} style={{ display: "block" }}>{x.why}</span></span></li>)}</ul>
        </section>
      )}
      {align.total > 0 && <div className={ui.stats} aria-label="Capital alignment">
        {(["nature_positive", "transition", "unclassified"] as const).map(k => <Stat key={k} n={compactMoney(align.byAlignment[k], align.currency)} label={`${ALIGNMENT[k]} capital`} href="/capital/alignment" />)}
        <Stat n={compactMoney(align.materialRisk, align.currency)} label="Capital with material nature risk" href="/capital/alignment" />
      </div>}
      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Needs attention</span><span className={ui.sub}>{attention.length} items · ranked by severity, then due date</span></p>
          {attention.length === 0 ? <p className={r.empty}>Nothing needs attention across projects, capital, contracts, compliance, documents and playbooks.</p> : (
            <table className={ui.table}>
              <thead><tr><th>Severity</th><th>Issue</th><th>Why it matters</th><th>Owner</th><th>Due</th><th>Source</th><th /></tr></thead>
              <tbody>{attention.slice(0, showAll ? 200 : 12).map(a => (
                <tr key={a.key}>
                  <td><span className={ui.chip} style={{ color: a.severity === "critical" || a.severity === "high" ? "#b0432f" : undefined }}>{a.severity}</span></td>
                  <td><b>{a.entity}</b><span className={ui.sub} style={{ display: "block" }}>{a.issue}</span></td>
                  <td className={ui.sub}>{a.why}</td>
                  <td className={ui.sub}>{a.owner ?? "—"}</td>
                  <td className={ui.sub}>{a.due ?? "—"}</td>
                  <td className={ui.sub}>{a.source}</td>
                  <td><Link className={ui.miniBtn} href={a.href}>Open</Link></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {attention.length > 12 && <p className={ui.sub}>{showAll ? <Link href="/today">Show the top 12</Link> : <Link href="/today?attention=all">Show all {attention.length}</Link>}</p>}
        </section>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Portfolio map</span><Link href="/map">Open in Atlas</Link></p>
            <MiniMap points={points} height={260} />
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>What changed since your last session</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Since {changes.since.slice(0, 16).replace("T", " ")} UTC, from the event log (each links to its record).</p>
            {changes.events.length === 0 ? <p className={r.empty}>No recorded changes by others.</p> : (
              <ul className={r.timeline}>{changes.events.slice(0, 12).map(e => {
                const href = e.entityType === "project" && e.entityId ? `/projects/${e.entityId}` : e.entityType === "playbook_run" && e.entityId ? `/playbooks/runs/${e.entityId}` : e.entityType === "referral" ? "/portals?tab=referrals" : e.entityType === "intake" ? "/portals?tab=intake" : "/notifications?tab=events";
                const name = String(e.payload.name ?? "");
                return <li key={e.id}><span className={r.when}>{e.at.slice(5, 16).replace("T", " ")}</span><span><Link href={href}>{e.type.replace(/_/g, " ").toLowerCase()}</Link>{name ? `: ${name}` : ""}{e.payload.to ? ` → ${String(e.payload.to).replace(/_/g, " ")}` : ""}</span></li>;
              })}</ul>
            )}
          </section>
        </aside>
      </div>
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
        <Stat n={funding.open} label="Open funding opportunities" href="/funding" />
        <Stat n={funding.closing} label="Funding deadlines in 14 days" href="/funding?window=30" warn />
        <Stat n={contractStats.sent} label="Contracts awaiting signature" href="/contracts?status=sent" warn />
        <Stat n={gateQueue?.n ?? 0} label="Capital opportunities awaiting gate review" href="/capital?tab=opportunities" warn />
        <Stat n={d.newTriggers} label="New triggers this year" href="/triggers" />
        <Stat n={d.newInquiries} label="Site inquiries and referrals, 7 days" href="/deals" />
        <Stat n={d.dossiersReady} label="Dossiers ready, 7 days" href="/companies" />
        <Stat n={d.overdue} label="Opportunities with overdue next actions" href="/deals?view=table" warn />
        <Stat n={d.noNext} label="Open opportunities with no next action" href="/deals?view=table" warn />
        <Stat n={d.awaitingAi} label="Signals waiting for Claude" href="/triggers?tab=signals&status=new" />
      </div>

      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Projects</span><Link href="/projects">All projects</Link></p>
            {projectFlags.blocked.length + projectFlags.capitalNow.length + projectFlags.moved.length === 0 ? (
              <p className={r.empty}>No project blockers, near-term capital needs or stage moves this week. <Link href="/projects">Projects</Link> hold readiness, constraints and capital requirements.</p>
            ) : (
              <ul className={r.timeline}>
                {projectFlags.blocked.slice(0, 8).map((b, i) => <li key={`b${i}`}><span className={r.when} style={{ color: "#b0432f" }}>Blocked</span><span><Link href={`/projects/${b.projectId}?tab=constraints`}>{b.name}</Link>: {b.why}</span></li>)}
                {projectFlags.capitalNow.slice(0, 6).map((c, i) => <li key={`c${i}`}><span className={r.when}>{c.targetClose}</span><span>Capital needed: <Link href={`/projects/${c.projectId}?tab=capital`}>{c.name}</Link>, {c.purpose}, {c.currency} {Math.round(c.gap).toLocaleString("en-US")} open</span></li>)}
                {projectFlags.moved.slice(0, 6).map((m, i) => <li key={`m${i}`}><span className={r.when}>{m.at.slice(0, 10)}</span><span><Link href={`/projects/${m.projectId}`}>{m.name}</Link> moved {m.from ? `${stageLabel(m.from)} → ` : ""}{stageLabel(m.to)}</span></li>)}
              </ul>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Delivery</span><Link href="/projects">Projects</Link></p>
            {delivery.milestones.length + delivery.decisions.length + delivery.missingEngineering.length + delivery.es.length + delivery.insurance.length + procurement.bidsDue.length + procurement.awardLate.length + procurement.leadTime.length === 0 ? (
              <p className={r.empty}>No milestones due or slipping, no decisions waiting, no missing core studies, no high E&amp;S issues or insurance gaps, no bids due or supply arriving late.</p>
            ) : (
              <ul className={r.timeline}>
                {delivery.milestones.slice(0, 8).map(m => <li key={m.id}><span className={r.when} style={{ color: m.red ? "#b0432f" : undefined }}>{m.dueDate ?? "Plan"}</span><span>{m.why}: {m.name} · <Link href={`/projects/${m.projectId}?tab=plan`}>{m.project}</Link></span></li>)}
                {delivery.decisions.slice(0, 5).map(x => <li key={x.id}><span className={r.when} style={{ color: x.overdue ? "#b0432f" : undefined }}>{x.dueDate}</span><span>Decision needed: {x.title} · <Link href={`/projects/${x.projectId}?tab=plan`}>{x.project}</Link></span></li>)}
                {delivery.missingEngineering.slice(0, 5).map(x => <li key={x.projectId}><span className={r.when}>Studies</span><span>Missing engineering information: {x.missing.map(t => STUDY_TYPES[t as keyof typeof STUDY_TYPES] ?? t).join(", ")} · <Link href={`/projects/${x.projectId}?tab=engineering`}>{x.project}</Link></span></li>)}
                {delivery.es.slice(0, 5).map(x => <li key={x.id}><span className={r.when} style={{ color: "#b0432f" }}>E&amp;S</span><span>{ES_TOPICS[x.topic as keyof typeof ES_TOPICS] ?? x.topic}: {x.description} · <Link href={`/projects/${x.projectId}?tab=risk`}>{x.project}</Link></span></li>)}
                {procurement.bidsDue.slice(0, 5).map(x => <li key={x.id}><span className={r.when}>{x.date}</span><span>Bids due: {x.name} · <Link href={`/projects/${x.projectId}?tab=procurement&pkg=${x.id}`}>{x.project}</Link></span></li>)}
                {procurement.awardLate.slice(0, 5).map(x => <li key={x.id}><span className={r.when} style={{ color: "#b0432f" }}>{x.date}</span><span>Award overdue: {x.name} · <Link href={`/projects/${x.projectId}?tab=procurement&pkg=${x.id}`}>{x.project}</Link></span></li>)}
                {procurement.leadTime.slice(0, 5).map(x => <li key={x.id}><span className={r.when} style={{ color: "#b0432f" }}>Supply</span><span>{x.name}: {x.why} · <Link href={`/projects/${x.projectId}?tab=procurement&pkg=${x.id}`}>{x.project}</Link></span></li>)}
                {delivery.insurance.slice(0, 5).map(x => <li key={x.id}><span className={r.when}>{x.date ?? "Insurance"}</span><span>{x.why}: {INSURANCE_TYPES[x.type as keyof typeof INSURANCE_TYPES] ?? x.type} · <Link href={`/projects/${x.projectId}?tab=risk`}>{x.project}</Link></span></li>)}
              </ul>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Regulatory</span><Link href="/projects">Projects</Link></p>
            {regFlags.permitsExpiring.length + regFlags.verificationsDue.length + regFlags.counselReview.length === 0 ? (
              <p className={r.empty}>No permits expiring in 90 days, no requirements due for re-verification, nothing waiting for counsel.</p>
            ) : (
              <ul className={r.timeline}>
                {regFlags.permitsExpiring.slice(0, 6).map(x => <li key={x.id}><span className={r.when} style={{ color: x.expired ? "#b0432f" : undefined }}>{x.expiresAt}</span><span>{x.expired ? "Expired" : "Expires"}: {x.name} · <Link href={`/projects/${x.projectId}?tab=regulatory`}>{x.project}</Link></span></li>)}
                {regFlags.verificationsDue.slice(0, 6).map(x => <li key={x.id}><span className={r.when}>{x.nextVerification}</span><span>Re-verify: {x.title} · <Link href={`/projects/${x.projectId}?tab=regulatory`}>{x.project}</Link></span></li>)}
                {regFlags.counselReview.slice(0, 6).map(x => <li key={x.id}><span className={r.when}>Counsel</span><span>{x.title} · <Link href={`/projects/${x.projectId}?tab=regulatory`}>{x.project}</Link></span></li>)}
              </ul>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Contracts: obligations, expiries, reviews</span><Link href="/contracts?tab=obligations">Obligations</Link></p>
            {obligationFlags.due.length + obligationFlags.expiring.length + obligationFlags.reviews.length === 0 ? (
              <p className={r.empty}>No obligations due in the next 14 days, no agreements expiring in 90 days, no compensation reviews waiting.</p>
            ) : (
              <ul className={r.timeline}>
                {obligationFlags.due.slice(0, 8).map(o => <li key={o.id}><span className={r.when} style={{ color: o.overdue ? "#b0432f" : undefined }}>{o.dueDate}</span><span>{o.overdue ? "Overdue: " : ""}{o.obligation} · {o.responsibleParty} · <Link href={`/contracts/${o.contractId}`}>{o.contractTitle}</Link></span></li>)}
                {obligationFlags.expiring.slice(0, 5).map(e => <li key={e.id}><span className={r.when}>{e.endDate}</span><span>Expires: <Link href={`/contracts/${e.id}`}>{e.title}</Link></span></li>)}
                {obligationFlags.reviews.slice(0, 5).map(x => <li key={x.id}><span className={r.when} style={{ color: "#b0432f" }}>Review</span><span>Compensation / regulatory review: <Link href={`/contracts/${x.id}`}>{x.title}</Link></span></li>)}
              </ul>
            )}
          </section>
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
