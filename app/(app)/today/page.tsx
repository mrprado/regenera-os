import Link from "next/link";
import { Suspense } from "react";
import { and, desc, eq, inArray } from "drizzle-orm";
import Loading from "../loading";
import { Notice } from "@/components/crm-bits";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import MiniMap from "@/components/mini-map";
import { mandates, proposals, tenantMembers } from "@/db/schema";
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
import { commandMapPoints } from "@/lib/command/map";
import { compactMoney } from "@/lib/projects/labels";
import { mandateCommand } from "@/lib/mandates/queries";
import { mailCommand } from "@/lib/mail-intel/queries";
import { readiness, readinessLabel } from "@/lib/readiness";
import { BUILT_IN_PRESETS } from "@/lib/scan/presets";
import { DEAL_STAGES } from "@/lib/vocab";

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
  return (
    <>
      <header className={t.head}>
        <p className={t.date}>{date} · {scope}</p>
        <div className={t.row}>
          <h1 className={t.hello}>Command{name ? <span className={t.helloName}> · {name}</span> : null}</h1>
          <nav className={t.actions} aria-label="Command actions">
            <Link className="btn btn--primary" href={`/scans?preset=${scanPreset.key}`} title={`Opens the scan launcher with "${scanPreset.name}" selected; you confirm scope before anything runs.`}>Scan prospects</Link>
            <Link className="btn" href="/queue">Review outreach</Link>
            <Link className="btn" href="/deals?new=1">Add opportunity</Link>
            <Link className="btn" href="#meetings">Prepare meeting</Link>
          </nav>
        </div>
      </header>
      <Notice text={sp.notice} />
      <Suspense fallback={<Loading />}>
        <Desk user={user} now={now} />
      </Suspense>
    </>
  );
}

async function Desk({ user, now }: { user: Awaited<ReturnType<typeof requireOsUser>>; now: Date }) {
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

  return (
    <>
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
          <section aria-labelledby="map-h">
            <p className={r.panelTitle}><span id="map-h">Map</span><Link href="/map">Open Atlas</Link></p>
            <Suspense fallback={<div className={t.mapSkeleton} aria-label="Loading map" />}><CommandMap ws={ws} flagged={flagged} /></Suspense>
          </section>
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

async function CommandMap({ ws, flagged }: { ws: string[]; flagged: Set<string> }) {
  const { points, missing } = await commandMapPoints(appDb(), ws, flagged);
  return <MiniMap points={points} height={260} missing={{ count: missing, href: "/companies?missing=location" }} />;
}
