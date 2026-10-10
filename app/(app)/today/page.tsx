import Link from "next/link";
import CommandReview from "@/components/command-review";
import { Suspense } from "react";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Loading from "../loading";
import { Notice } from "@/components/crm-bits";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import MiniMap from "@/components/mini-map";
import { claims, mandates, proposals, tenantMembers } from "@/db/schema";
import t from "./today.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { confirmProposalAction, rejectProposalAction } from "../intel-actions";
import { assignTaskToMeAction, rescheduleTaskAction } from "../command-actions";
import { projectAlerts } from "@/lib/projects/engine";
import { obligationAlerts } from "@/lib/contracts/register";
import { regulatoryAlerts } from "@/lib/regulatory/engine";
import { deliveryAlerts } from "@/lib/delivery/engine";
import { procurementAlerts } from "@/lib/procurement/engine";
import { changesSinceLastSession, needsAttention } from "@/lib/command/attention";
import { commandDesk, COMMAND_TZ, localDate, type Bucket, type PriorityGroup } from "@/lib/command/desk";
import { commandMapPoints, type MapMode } from "@/lib/command/map";
import { etToUtc } from "@/lib/time/et";
import { compactMoney } from "@/lib/projects/labels";
import { mandateCommand } from "@/lib/mandates/queries";
import { mailCommand } from "@/lib/mail-intel/queries";
import { readiness, readinessLabel } from "@/lib/readiness";
import { BUILT_IN_PRESETS } from "@/lib/scan/presets";
import { DEAL_STAGES } from "@/lib/vocab";
import { opsSummary } from "@/lib/command/ops";
import { dailyBrief } from "@/lib/command/brief";
import { notInArray } from "drizzle-orm";
import { originationItems } from "@/db/schema";
import { serviceName } from "@/lib/origination/labels";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Command" };

const BUCKETS: { key: Bucket; label: string; empty: string }[] = [
  { key: "overdue", label: "Overdue", empty: "Nothing overdue." },
  { key: "today", label: "Due today", empty: "Nothing due today." },
  { key: "blocked", label: "Blocked", empty: "No recorded blockers." },
  { key: "upcoming", label: "Next 7 days", empty: "Nothing due in the next 7 days." },
];
const SEV_CLASS: Record<string, string> = { critical: "sevCritical", high: "sevHigh", medium: "sevMedium", low: "sevLow" };

export default async function CommandPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/today");
  const sp = await searchParams;
  const db = appDb();
  const [[member], ws] = await Promise.all([
    db.select({ name: tenantMembers.name }).from(tenantMembers).where(eq(tenantMembers.email, user.email)).limit(1),
    db.select({ id: mandates.id, name: mandates.name }).from(mandates).where(inArray(mandates.id, user.scope.mandateIds.length ? user.scope.mandateIds : ["-"])),
  ]);
  const name = member?.name?.trim().split(/\s+/)[0] ?? "";
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: COMMAND_TZ }).format(now);
  const scope = ws.length === 1 ? ws[0].name : ws.length > 1 ? `${ws.length} workspaces` : "No workspace";
  const scanPreset = BUILT_IN_PRESETS[0];
  // Two views, Today (default) and All. They filter the map and the dashboard below; ?map=new is the old New alerts tab.
  const mapMode: MapMode | "off" = sp.map === "all" || sp.map === "off" ? sp.map : "today";
  const view: "today" | "all" = mapMode === "all" ? "all" : "today";
  const deskContext = loadDeskContext(user, now);
  const [ops, brief, queue] = await Promise.all([
    opsSummary(db, now), dailyBrief(db, user.scope.mandateIds, now),
    db.select().from(originationItems).where(and(mandateCondition(user.scope, originationItems.mandateId), notInArray(originationItems.stage, ["won", "lost", "deferred"]), sql`${originationItems.priority} >= 0`)).orderBy(desc(originationItems.priority)).limit(view === "all" ? 15 : 5),
  ]);
  const health = ops.aiPaused || ops.degraded.length || ops.dead;
  // Phase 24: after decisions, the brief and the top of the queue, each with its one action.
  const today = (
    <div className={t.todayCols}>
      <section className={t.todayPanel} aria-labelledby="brief-h">
        <p className={r.panelTitle}><span id="brief-h">Daily brief</span><span className={ui.sub} style={{ display: "inline" }}>built from records</span></p>
        <ul className={t.briefList}>{brief.map(b => <li key={b.heading}><b>{b.heading}</b>{b.href ? <Link href={b.href}>{b.text}</Link> : <span>{b.text}</span>}</li>)}</ul>
      </section>
      <section className={t.todayPanel} aria-labelledby="queue-h">
        <p className={r.panelTitle}><span id="queue-h">{view === "all" ? "Opportunity queue" : "Top of the opportunity queue"}</span><Link href="/origination">All {ops.queued}</Link></p>
        {queue.length === 0 ? <p className={r.empty}>The queue is empty; it rebuilds every 3 hours.</p> : (
          <ol className={t.briefList}>{queue.map(q => <li key={q.id}><Link href={q.projectId ? `/projects/${q.projectId}?tab=capital` : q.orgId ? `/companies/${q.orgId}` : "/origination"}>{q.title}</Link><span>{q.nextAction ?? "Review"}{q.recommendedService ? ` · offer: ${serviceName(q.recommendedService)}` : ""}</span></li>)}</ol>
        )}
      </section>
    </div>
  );
  return (
    <>
      <header className={t.commandHead}><div><h1 className="sr-only">Command</h1><p className={t.commandContext}>{date}</p></div><nav className={t.actions} aria-label="Quick actions"><Link className="btn btn--primary" href="/origination">Review the queue</Link><Link className="btn" href="/approvals">Approvals</Link><Link className="btn" href="/start">Start here</Link></nav></header>
      <Notice text={sp.notice} />
      <CommandReview>
      <Suspense fallback={<div className={t.mapSkeleton} aria-label="Loading global activity"/>}><CommandActivityMap context={deskContext} mapMode={mapMode}/></Suspense>
      <Suspense fallback={<Loading />}>
        <Desk user={user} now={now} context={deskContext} fullOpen={sp.full === "1"} afterDecisions={today} view={view} />
      </Suspense>
      <p className={t.systemLine} aria-label="System status">
        <b>System:</b> {health ? <>{ops.aiPaused ? `AI paused until ${ops.aiPaused.slice(11, 16)} UTC (rules reads continue) · ` : ""}{ops.degraded.length ? `${ops.degraded.length} source${ops.degraded.length === 1 ? "" : "s"} degraded · ` : ""}{ops.dead ? `${ops.dead} failed jobs · ` : ""}<Link href="/settings/jobs">details</Link></> : "healthy"}
        <span> · last 24 h: {ops.funding} funding calls, {ops.matches} matches, {ops.assessments} site assessments, {ops.orgs} organizations</span>
      </p>
      </CommandReview>
      <details className={t.workspacePurpose}><summary>About your workspace and regenerative purpose</summary><div className={t.purposeBody}>
        <section className={t.lens} aria-labelledby="lens-h">
          <div className={t.lensLintel}><h2 id="lens-h" className={t.lensTitle}>Regeneration lens</h2><p className={t.lensSub}>Three pillars every project, partner and decision is weighed against.</p></div>
          <ul className={t.pillars}>{LENS.map(x => <li key={x.title} className={t.pillar}><h3>{x.title}</h3><p>{x.body}</p></li>)}</ul>
        </section>

        <p className={t.brandLine}>REGENERA OS · ADVANCING A REGENERATIVE ECONOMY</p>
        <h2 className={t.heroTitle}>Your workspace for projects, capital, and execution.</h2>
        <span className={t.heroRule} aria-hidden="true" />
        <p className={t.heroLead}>Connect intelligence, assess opportunities, structure engagements, and coordinate delivery.</p>
        <p className={t.sectors}>Energy · Land · Infrastructure · Waste &amp; Resources</p>
        <div className={t.row}>
          <p className={t.date}>{date} · {scope}{name ? ` · ${name}` : ""}</p>
          <nav className={t.actions} aria-label="Command actions">
            <Link className="btn btn--primary" href={`/scans?preset=${scanPreset.key}`} title={`Opens the scan launcher with "${scanPreset.name}" selected; you confirm scope before anything runs.`}>Scan</Link>
            <Link className="btn" href="/queue">Review outreach</Link>
            <Link className="btn" href="/deals?new=1">Add a deal</Link>
          </nav>
        </div>
        <div className={t.statement}>
          <p className={t.statementTitle}>Measure what we restore.</p>
          <p className={t.statementText}>Align projects, capital, and daily action with healthier ecosystems, stronger communities, and resilient livelihoods.</p>
        </div>
</div></details>

    </>
  );
}

// The daily loop (phase 24), each step opening the work area that owns it (October 2026 sidebar).
const SHORTCUTS = [
  { label: "1 · Discover", body: "The ranked opportunity queue and funding calls.", href: "/overview/discover" },
  { label: "2 · Projects", body: "Integrity, readiness and scope before contact.", href: "/overview/projects" },
  { label: "3 · Network", body: "Decision makers, outreach drafts, replies.", href: "/overview/network" },
  { label: "4 · Engage", body: "Proposals, terms and contracts.", href: "/overview/engage" },
  { label: "5 · Workflows", body: "Playbooks and documents.", href: "/overview/workflows" },
  { label: "6 · Capital", body: "Needs, partners, introductions, applications.", href: "/overview/capital" },
  { label: "7 · Steward", body: "Obligations and impact records.", href: "/overview/steward" },
];
// Decision dimensions, not measured results: no scores or totals are shown or implied.
const LENS = [
  { title: "Ecological renewal", body: "Soil, water, biodiversity, and ecosystem health." },
  { title: "Community well-being", body: "Participation, equitable benefits, and community resilience." },
  { title: "Economic resilience", body: "Durable livelihoods, local value creation, and long-term prosperity." },
];
const MAP_MODES: { key: MapMode; label: string; href: string }[] = [{ key: "today", label: "Today", href: "/today" }, { key: "all", label: "All", href: "/today?map=all" }];

async function loadDeskContext(user: Awaited<ReturnType<typeof requireOsUser>>, now: Date) {
  const db = appDb(), ws = user.scope.mandateIds;
  const [pa, del, proc, reg, obl, changes, ready, mc, mail, pending] = await Promise.all([
    projectAlerts(db, ws), deliveryAlerts(db, ws), procurementAlerts(db, ws), regulatoryAlerts(db, ws), obligationAlerts(db, ws),
    changesSinceLastSession(db, ws, user.email), readiness(db, ws, now),
    mandateCommand(db, user.scope).catch(() => null), mailCommand(db, user.scope).catch(() => null),
    db.select({ id: proposals.id, title: proposals.title, source: proposals.source, createdAt: proposals.createdAt }).from(proposals)
      .where(and(mandateCondition(user.scope, proposals.mandateId), eq(proposals.status, "pending"), eq(proposals.kind, "action"))).orderBy(desc(proposals.createdAt)).limit(10),
  ]);
  const attention = await needsAttention(db, ws, user.email, now, { pa, del, proc, reg, obl });
  const desk = await commandDesk(db, ws, now, attention);
  const flagged = new Set(attention.map(a => a.href.match(/^\/projects\/([^/?]+)/)?.[1]).filter(Boolean) as string[]);
  const s = desk.summary;
  const notReady = ready.filter(x => x.status !== "ok");
  const deliveryItems = attention.filter(a => ["Project", "Contract", "Compliance", "Document"].includes(a.category));
  const maxStage = Math.max(1, ...desk.pipeline.map(p => p.count));
  const totalPriorities = BUCKETS.reduce((n, b) => n + desk.priorities[b.key].length, 0);
  // Up to three decisions: overdue, then due today, then blocked; each from an actual record with its reason and owner.
  const decisions = [...desk.priorities.overdue, ...desk.priorities.today, ...desk.priorities.blocked].slice(0, 3);
  // Today's work on the map: the records behind overdue and today's items and high-severity attention.
  const idOf = (href: string) => href.match(/^\/(?:projects|companies)\/([^/?#]+)/)?.[1];
  const focus = new Set([...desk.priorities.overdue, ...desk.priorities.today].flatMap(g => g.items.map(i => idOf(i.href))).concat(attention.map(a => idOf(a.href))).filter(Boolean) as string[]);
  const today = localDate(now);
  const [y, mo, d] = today.split("-").map(Number);
  const since = etToUtc(y, mo, d, 0, 0).toISOString();
  const [ev] = await db.select({ pending: sql<number>`sum(case when ${claims.status} in ('unverified','ai_inferred','assumption','source_provided') then 1 else 0 end)`, verified: sql<number>`sum(case when ${claims.status} = 'verified' then 1 else 0 end)`, disputed: sql<number>`sum(case when ${claims.status} = 'disputed' then 1 else 0 end)` })
    .from(claims).where(inArray(claims.mandateId, ws.length ? ws : ["-"]));

  return {ws, del, obl, changes, ready, mc, mail, pending, desk, flagged, s, notReady, deliveryItems, maxStage, totalPriorities, decisions, focus, today, since, ev};
}

async function CommandActivityMap({context, mapMode}: {context: ReturnType<typeof loadDeskContext>; mapMode: MapMode | "off"}) {
  const {ws, flagged, focus, since} = await context;
  return <>{mapMode === "off" ? (
        <p className={t.mapOff}><Link href="/today">Show map</Link> · <Link href="/map">Open Atlas</Link></p>
      ) : (
        <section className={t.mapBand} aria-labelledby="map-h">
          <div className={t.mapBar}>
            <h2 id="map-h" className={t.sectionTitle}>Your global activity</h2>
            <nav className={t.modes} aria-label="Map mode">{MAP_MODES.map(m => <Link key={m.key} href={m.href} className={t.mode} aria-current={mapMode === m.key ? "page" : undefined}>{m.label}</Link>)}</nav>
            <span className={t.mapLinks}><Link href="/map">Open Atlas</Link> · <Link href="/today?map=off">Hide map</Link></span>
          </div>
          <Suspense fallback={<div className={t.mapSkeleton} aria-label="Loading map" />}><CommandMap ws={ws} flagged={flagged} mode={mapMode} since={since} focus={focus} /></Suspense>
        </section>
      )}</>;
}

async function Desk({user, now, fullOpen, context, afterDecisions, view = "today"}: {user: Awaited<ReturnType<typeof requireOsUser>>; now: Date; fullOpen: boolean; context: ReturnType<typeof loadDeskContext>; afterDecisions?: ReactNode; view?: "today" | "all"}) {
  const {del, obl, changes, ready, mc, mail, pending, desk, s, notReady, deliveryItems, maxStage, totalPriorities, decisions: todays, today, ev} = await context;
  // Today: what is overdue, due today or blocked. All: every priority bucket, so the list matches the All map.
  const decisions = view === "all" ? BUCKETS.flatMap(b => desk.priorities[b.key]) : todays;

  return (
    <>
      <section className={t.decisions} aria-labelledby="dec-h">
        <p className={r.panelTitle}><span id="dec-h">{view === "all" ? `All priorities (${totalPriorities})` : "Today: needs your decision"}</span>{view === "today" && <Link href="/today?map=all">All priorities ({totalPriorities})</Link>}</p>
        {decisions.length === 0 && pending.length === 0 ? <p className={r.empty}>Nothing overdue, due today or blocked. {desk.prospects.length === 0 ? <><Link href={`/scans?preset=${BUILT_IN_PRESETS[0].key}`}>Run a prospect scan</Link> to build the pipeline.</> : null}</p> : (
          <ul className={t.decisionList}>
            {decisions.map(g => { const it = g.items[0]; return (
              <li key={g.key} className={t.decision}>
                <div><b><Link href={g.href}>{g.label}</Link></b><span className={t.decisionWhy}>{g.items.length > 1 ? `${g.items.length} related items · ` : ""}{it.reason}</span>
                  <span className={ui.sub}>{it.basis} · {it.due ? `due ${it.due}` : "no date"}{g.overdueDays ? ` · ${g.overdueDays} day${g.overdueDays === 1 ? "" : "s"} overdue` : ""} · owner {it.owner ?? "unassigned"}</span></div>
                <Link className={t.decisionAction} href={it.href}>{it.action.length > 28 ? "Open" : it.action}</Link>
              </li>); })}
            {decisions.length < 3 && pending.slice(0, 3 - decisions.length).map(p => (
              <li key={p.id} className={t.decision}><div><b>{p.title}</b><span className={t.decisionWhy}>Proposed {p.source === "mcp" ? "from Claude" : p.source === "meeting" ? "from meeting notes" : "by Ask the OS"}; nothing changes until you confirm.</span><span className={ui.sub}>{p.createdAt.slice(0, 10)}</span></div>
                <form action={confirmProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/today" /><button className={t.decisionAction} type="submit">Confirm</button></form></li>))}
          </ul>
        )}
      </section>

      {afterDecisions}
      <details className={t.launcher}><summary>Start new work</summary><nav className={t.shortcuts} aria-label="Move work forward">
        {SHORTCUTS.map(x => <Link key={x.href} href={x.href} className={t.shortcut}><b>{x.label}</b><span>{x.body}</span></Link>)}
      </nav></details>


      <div className={t.compactCols}>
        <section className={t.outcomes} aria-labelledby="out-h">
          <p className={r.panelTitle}><span id="out-h">Outcomes &amp; evidence</span><Link href="/projects">Projects</Link></p>
          {!(ev?.pending || ev?.verified || ev?.disputed) ? <p className={ui.sub}>No contribution claims recorded yet. An unassessed project is not a project with zero impact: record a baseline and intended contribution on the project before any outcome is reported.</p>
            : <p className={ui.sub}>{ev?.verified ?? 0} claim{ev?.verified === 1 ? "" : "s"} verified by a person · {ev?.pending ?? 0} awaiting evidence or verification (source-provided, calculated, AI-inferred and assumptions are not verified) · {ev?.disputed ?? 0} disputed.</p>}
        </section>
        <section className={t.recent} aria-labelledby="rc-h">
          <p className={r.panelTitle}><span id="rc-h">Recent changes</span><Link href="/notifications?tab=events">Full history</Link></p>
          {changes.events.length === 0 ? <p className={ui.sub}>No recorded changes by others since your last session.</p> : (
            <ul className={r.timeline}>{changes.events.slice(0, 3).map(e => <li key={e.id}><span className={r.when}>{e.at.slice(5, 10)}</span><span>{e.type.replace(/_/g, " ").toLowerCase()}{e.payload.name ? `: ${String(e.payload.name)}` : ""}</span></li>)}</ul>
          )}
        </section>
      </div>

      <details className={t.full} id="full-desk" open={fullOpen}>
        <summary>Full desk: metrics, all priorities, conversations, opportunities, delivery, pipeline and system readiness{notReady.length ? ` (${notReady.length} readiness item${notReady.length === 1 ? "" : "s"} need attention)` : ""}</summary>
      <section className={t.summary} aria-label="Summary">
        <Metric label="Qualified fee pipeline" value={s.qualifiedPipeline.count ? compactMoney(s.qualifiedPipeline.value, "USD") : "None"}
          sub={s.qualifiedPipeline.count ? `${s.qualifiedPipeline.count} opportunities${s.qualifiedPipeline.valued < s.qualifiedPipeline.count ? `, ${s.qualifiedPipeline.count - s.qualifiedPipeline.valued} without a fee estimate` : ""}${s.weighted ? ` · weighted ${compactMoney(s.weighted.value, "USD")} (${s.weighted.basis} with a probability)` : ""}` : "No opportunity is past first contact"}
          def={s.qualifiedPipeline.definition} href="/deals?view=table" />
        <Metric label="Interested replies" value={String(s.interestedReplies)} sub="Interested, questions and introductions not yet handled" def="Unhandled inbox replies classified interested, question or referral; excludes test records, out-of-office, bounces and unsubscribes. Replies not yet classified are listed under Conversations." href="/inbox" />
        <Metric label="Proposals awaiting decision" value={String(s.proposals.count)} sub={`${s.proposals.count ? `${compactMoney(s.proposals.value, "USD")} in estimated fees · ` : ""}${s.proposals.contractsAwaiting} agreement${s.proposals.contractsAwaiting === 1 ? "" : "s"} awaiting signature`} def="Opportunities at the Proposal stage, plus agreements marked sent and not yet signed. Fees are Regenera's own (USD)." href="/deals?stage=proposal" />
        <Metric label="Client commitments at risk" value={desk.projectCount === 0 && obl.due.length === 0 ? "Not assessed" : String(obl.due.filter(o => o.overdue).length + del.milestones.filter(m => m.red).length)}
          sub={desk.projectCount === 0 && obl.due.length === 0 ? "No projects or contract obligations recorded yet" : "Overdue obligations and slipping milestones"} def="Contract obligations past due plus project milestones flagged red on the plan. With no projects or obligations recorded, risk is not assessed, not zero." href="/contracts?tab=obligations" />
      </section>

      <div className={t.main}>
        <section className={t.priorities} aria-labelledby="prio-h">
          <p className={r.panelTitle}><span id="prio-h">Priorities</span><span className={ui.sub}>{totalPriorities ? `${totalPriorities} items, related tasks grouped` : ""}</span></p>
          {totalPriorities === 0 ? <p className={r.empty}>No open tasks, overdue opportunity actions or high-severity issues. {desk.prospects.length === 0 ? <><Link href={`/scans?preset=${BUILT_IN_PRESETS[0].key}`}>Run a prospect scan</Link> to build the pipeline.</> : null}</p>
            : BUCKETS.map(b => desk.priorities[b.key].length > 0 && (
              <div key={b.key} className={t.bucket}>
                <h2 className={t.bucketTitle} data-bucket={b.key}>{b.label} <span>{desk.priorities[b.key].length}</span></h2>
                <ul className={t.cards}>{desk.priorities[b.key].slice(0, 12).map(g => <PriorityCard key={g.key} g={g} today={desk.today} />)}</ul>
              </div>
            ))}
          {pending.length > 0 && (
            <div className={t.bucket}>
              <h2 className={t.bucketTitle}>Waiting for your confirmation <span>{pending.length}</span></h2>
              <ul className={t.cards}>{pending.map(p => (
                <li key={p.id} className={t.card}><div className={t.cardMain}><b>{p.title}</b><span className={ui.sub}>Proposed {p.source === "mcp" ? "from Claude" : p.source === "meeting" ? "from meeting notes" : "by Ask the OS"} · {p.createdAt.slice(0, 16).replace("T", " ")} UTC</span></div>
                  <div className={ui.rowActions}>
                    <form action={confirmProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/today" /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Confirm</button></form>
                    <form action={rejectProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/today" /><button className={ui.miniBtn} type="submit">Discard</button></form>
                  </div></li>))}</ul>
            </div>
          )}
        </section>
        <aside className={t.side}>
          <section aria-labelledby="ready-h" className={t.ready}>
            <p className={r.panelTitle}><span id="ready-h">System readiness</span><Link href="/settings/jobs">Jobs</Link></p>
            {notReady.length === 0 ? <p className={ui.sub}>Scheduler, providers, backups and sending are all working.</p> : (
              <ul className={t.readyList}>{ready.map(x => (
                <li key={x.key} data-status={x.status}><Link href={x.href}><b>{x.label}</b></Link> <span className={t.readyStatus}>{readinessLabel(x.status)}</span>
                  <span className={ui.sub}>{x.detail}{x.fix ? ` Fix: ${x.fix}` : ""}</span></li>))}</ul>
            )}
          </section>
        </aside>
      </div>

      <div className={t.columns}>
        <section className={r.panel} aria-labelledby="conv-h">
          <p className={r.panelTitle}><span id="conv-h">Conversations needing you</span><Link href="/inbox">Inbox</Link></p>
          {desk.conversations.interested.length + desk.conversations.introductions.length + desk.conversations.unclassified.length + desk.conversations.needsPrep.length + desk.conversations.contractsAwaiting.length + (mail?.awaiting.length ?? 0) === 0
            ? <p className={r.empty}>{ready.find(x => x.key === "google")?.status === "ok" ? "No replies, introductions or meetings waiting." : "No conversations recorded. The mailbox is not connected, so replies are not being read."}</p> : (
              <ul className={r.timeline}>
                {desk.conversations.interested.map(c => <li key={c.r.id}><span className={r.when}>{c.r.classification === "question" ? "Question" : "Interested"}</span><span><Link href={`/inbox?id=${c.r.id}`}>{c.contactName ?? c.r.fromEmail}</Link>{c.orgName ? ` · ${c.orgName}` : ""}<span className={ui.sub}>{c.r.subject || c.r.snippet.slice(0, 90)}</span></span></li>)}
                {desk.conversations.introductions.map(c => <li key={c.r.id}><span className={r.when}>Introduction</span><span><Link href={`/inbox?id=${c.r.id}`}>{c.contactName ?? c.r.fromEmail}</Link><span className={ui.sub}>{c.r.subject}</span></span></li>)}
                {desk.conversations.unclassified.slice(0, 5).map(c => <li key={c.r.id}><span className={r.when}>Unread reply</span><span><Link href={`/inbox?id=${c.r.id}`}>{c.contactName ?? c.r.fromEmail}</Link><span className={ui.sub}>Not yet classified: {c.r.subject}</span></span></li>)}
                {desk.conversations.needsPrep.map(m => <li key={m.b.id} id="meetings"><span className={r.when}>{m.b.startsAt.slice(5, 16).replace("T", " ")} UTC</span><span>Prepare: <b>{m.b.title}</b>{m.contactName ? ` · ${m.contactName}` : ""}{m.orgName ? `, ${m.orgName}` : ""}<span className={ui.sub}>No brief yet{m.b.dealId ? <> · <Link href={`/deals/${m.b.dealId}`}>Opportunity</Link></> : null}</span></span></li>)}
                {desk.conversations.contractsAwaiting.map(c => <li key={c.id}><span className={r.when}>Signature</span><span><Link href={`/contracts/${c.id}`}>{c.title}</Link><span className={ui.sub}>Sent {c.updatedAt.slice(0, 10)}, awaiting signature</span></span></li>)}
                {(mail?.awaiting ?? []).slice(0, 4).map(m => <li key={m.key}><span className={r.when}>Reply owed</span><span><Link href="/intelligence/mail?tab=threads&awaiting=me">{m.subject || "(no subject)"}</Link><span className={ui.sub}>Email intelligence · last message {m.lastAt.slice(0, 10)}</span></span></li>)}
              </ul>
            )}
          {desk.conversations.meetings.length > 0 && desk.conversations.needsPrep.length === 0 && <p className={ui.sub} id="meetings">{desk.conversations.meetings.length} meeting{desk.conversations.meetings.length === 1 ? "" : "s"} in the next 7 days, each with a brief.</p>}
        </section>

        <section className={r.panel} aria-labelledby="rev-h">
          <p className={r.panelTitle}><span id="rev-h">Opportunities needing action</span><Link href="/deals?view=table">Opportunities</Link></p>
          {desk.revenue.proposals.length + desk.revenue.stalled.length === 0 ? <p className={r.empty}>No proposals waiting and every open opportunity has a dated next action.</p> : (
            <ul className={r.timeline}>
              {desk.revenue.proposals.map(p => <li key={p.id}><span className={r.when}>Proposal</span><span><Link href={`/deals/${p.id}`}>{p.name}</Link>{p.org ? ` · ${p.org}` : ""}{p.value != null ? ` · ${compactMoney(p.value, "USD")} fee` : ""}<span className={ui.sub}>{p.next ? `Next: ${p.next}${p.nextDate ? ` (${p.nextDate})` : ""}` : "No next action"}{p.close ? ` · expected close ${p.close}` : ""}</span></span></li>)}
              {desk.revenue.stalled.filter(x => x.stage !== "proposal").slice(0, 8).map(x => <li key={x.id}><span className={r.when}>{DEAL_STAGES[x.stage as keyof typeof DEAL_STAGES]}</span><span><Link href={`/deals/${x.id}`}>{x.name}</Link>{x.org ? ` · ${x.org}` : ""}<span className={ui.sub}>{x.next ? `Next action overdue since ${x.nextDate}: ${x.next}` : "No next action recorded"}</span></span></li>)}
            </ul>
          )}
        </section>

        <section className={r.panel} aria-labelledby="del-h">
          <p className={r.panelTitle}><span id="del-h">Delivery and commitments</span><Link href="/projects">Projects</Link></p>
          {desk.projectCount === 0 && deliveryItems.length === 0 ? <p className={r.empty}>No projects recorded, so delivery risk is not assessed (this is not the same as no risk). <Link href="/projects">Add a project</Link> to track readiness, constraints and milestones.</p>
            : deliveryItems.length === 0 ? <p className={r.empty}>{desk.projectCount} project{desk.projectCount === 1 ? "" : "s"} recorded; no blockers, slipping milestones, overdue obligations or compliance issues flagged.</p> : (
              <ul className={r.timeline}>{deliveryItems.slice(0, 10).map(a => <li key={a.key}><span className={r.when} data-sev={a.severity}>{a.severity}</span><span><Link href={a.href}>{a.entity}</Link>: {a.issue}<span className={ui.sub}>{a.why} · {a.source}{a.due ? ` · due ${a.due}` : ""}</span></span></li>)}</ul>
            )}
        </section>

        <section className={r.panel} aria-labelledby="pipe-h">
          <p className={r.panelTitle}><span id="pipe-h">Pipeline by stage</span><span className={ui.sub}>Open opportunities now · fees USD</span></p>
          {desk.pipeline.every(p => p.count === 0) ? <p className={r.empty}>No open opportunities. <Link href="/deals?new=1">Add one</Link> or qualify accounts from a scan.</p> : (
            <>
              <ul className={t.bars} aria-hidden="true">{desk.pipeline.map(p => (
                <li key={p.stage}><Link href={`/deals?stage=${p.stage}`}><span className={t.barLabel}>{p.label}</span><span className={t.barTrack}><span className={t.bar} style={{ width: `${(p.count / maxStage) * 100}%` }} /></span><span className={t.barValue}>{p.count}{p.value ? ` · ${compactMoney(p.value, "USD")}` : ""}</span></Link></li>
              ))}</ul>
              <table className={t.srTable}><caption>Open opportunities by current stage (a snapshot, not historical conversion)</caption><thead><tr><th>Stage</th><th>Count</th><th>Estimated fees (USD)</th><th>Without estimate</th></tr></thead>
                <tbody>{desk.pipeline.map(p => <tr key={p.stage}><td>{p.label}</td><td>{p.count}</td><td>{Math.round(p.value)}</td><td>{p.unvalued}</td></tr>)}</tbody></table>
              <p className={ui.sub}>A snapshot of current stages, not conversion over time. Opportunities without a fee estimate count but add nothing to the value.</p>
            </>
          )}
        </section>

        <section className={r.panel} aria-labelledby="chg-h">
          <p className={r.panelTitle}><span id="chg-h">What changed</span><Link href="/notifications?tab=events">All events</Link></p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Since {changes.since.slice(0, 16).replace("T", " ")} UTC, recorded by others or by automation.</p>
          {changes.events.length === 0 ? <p className={r.empty}>No recorded changes by others.</p> : (
            <ul className={r.timeline}>{changes.events.slice(0, 10).map(e => {
              const href = e.entityType === "project" && e.entityId ? `/projects/${e.entityId}` : e.entityType === "deal" && e.entityId ? `/deals/${e.entityId}` : e.entityType === "playbook_run" && e.entityId ? `/playbooks/runs/${e.entityId}` : e.entityType === "referral" ? "/portals?tab=referrals" : e.entityType === "intake" ? "/portals?tab=intake" : "/notifications?tab=events";
              const nm = String(e.payload.name ?? "");
              return <li key={e.id}><span className={r.when}>{e.at.slice(5, 16).replace("T", " ")}</span><span><Link href={href}>{e.type.replace(/_/g, " ").toLowerCase()}</Link>{nm ? `: ${nm}` : ""}{e.payload.to ? ` → ${String(e.payload.to).replace(/_/g, " ")}` : ""}</span></li>;
            })}</ul>
          )}
          {mc && (mc.pending.length > 0 || mc.atRisk.length > 0) && <p className={ui.sub}>Mandates: {mc.pending.length ? <Link href="/approvals">{mc.pending.length} approval{mc.pending.length === 1 ? "" : "s"} pending</Link> : null}{mc.pending.length && mc.atRisk.length ? " · " : ""}{mc.atRisk.length ? <Link href="/mandates">{mc.atRisk.length} at risk</Link> : null}</p>}
        </section>
      </div>
      </details>
    </>
  );
}

function Metric({ label, value, sub, def, href }: { label: string; value: string; sub: string; def: string; href: string }) {
  return (
    <div className={t.metric}>
      <Link href={href} className={t.metricValue}>{value}</Link>
      <span className={t.metricLabel}>{label}</span>
      <span className={t.metricSub}>{sub}</span>
      <details className={t.def}><summary>Definition</summary><p>{def}</p></details>
    </div>
  );
}

function PriorityCard({ g, today }: { g: PriorityGroup; today: string }) {
  const first = g.items[0];
  const many = g.items.length > 1;
  const plus = (n: number) => localDate(new Date(Date.parse(today) + n * 86_400_000 + 12 * 3_600_000));
  const actions = (it: typeof first) => (
    <div className={ui.rowActions}>
      <Link className={`${ui.miniBtn} ${ui.miniPrimary}`} href={it.href}>Open</Link>
      {it.taskId && <>
        {!it.owner && <form action={assignTaskToMeAction}><input type="hidden" name="id" value={it.taskId} /><button className={ui.miniBtn} type="submit">Assign to me</button></form>}
        <form action={rescheduleTaskAction}><input type="hidden" name="id" value={it.taskId} /><input type="hidden" name="date" value={plus(1)} /><button className={ui.miniBtn} type="submit" title={`Move to ${plus(1)}`}>+1 day</button></form>
        <form action={rescheduleTaskAction}><input type="hidden" name="id" value={it.taskId} /><input type="hidden" name="date" value={plus(7)} /><button className={ui.miniBtn} type="submit" title={`Move to ${plus(7)}`}>+1 week</button></form>
      </>}
    </div>
  );
  const meta = (it: typeof first) => <span className={t.meta}><span className={`${t.sev} ${t[SEV_CLASS[it.severity]]}`}>{it.severity}</span> {it.basis} · Owner: {it.owner ?? "unassigned"}{it.due ? ` · due ${it.due}` : ""}</span>;
  return (
    <li className={t.card}>
      <div className={t.cardMain}>
        <span className={t.type}>{many ? `Workstream · ${g.items.length} items` : first.type}</span>
        <b><Link href={g.href}>{g.label}</Link></b>
        {g.overdueDays ? <span className={t.overdue}>{g.overdueDays} day{g.overdueDays === 1 ? "" : "s"} overdue</span> : null}
        {!many && <><span className={t.reason}>{first.reason}</span>{meta(first)}<span className={t.next}>Next: {first.action}</span></>}
      </div>
      {!many ? actions(first) : (
        <details className={t.group}><summary>Show {g.items.length} items (earliest due {g.due ?? "not set"})</summary>
          <ul>{g.items.map(it => <li key={it.key}><span className={t.reason}>{it.reason}</span>{meta(it)}{actions(it)}</li>)}</ul>
        </details>
      )}
    </li>
  );
}

async function CommandMap({ ws, flagged, mode, since, focus }: { ws: string[]; flagged: Set<string>; mode: MapMode; since: string; focus: Set<string> }) {
  const { points, missing, unmapped } = await commandMapPoints(appDb(), ws, flagged, { mode, since, focus });
  const empty = mode === "new" ? "No new projects, prospects, capital records or funding calls arrived today." : mode === "today" ? "No mapped records behind today's or overdue work." : "No mapped records yet.";
  return (
    <>
      <MiniMap points={points} height={200} emptyText={empty} missing={mode === "all" ? { count: missing, href: "/companies?missing=location" } : undefined} />
      {mode !== "all" && unmapped.length > 0 && (
        <details className={t.unmapped}><summary>{unmapped.length} item{unmapped.length === 1 ? "" : "s"} without a site location (listed, not pinned)</summary>
          <ul>{unmapped.slice(0, 12).map(u => <li key={u.key}><Link href={u.href}>{u.name}</Link> <span className={ui.sub}>{u.what}</span></li>)}</ul></details>
      )}
    </>
  );
}
