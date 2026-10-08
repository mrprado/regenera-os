// Phase 24 landing pages for the daily loop (Find → Qualify → Reach → Win → Deliver → Capital → Steward). Each says what
// the step is for, what to do next (records, each with the action that moves it) and how much is waiting, with links.
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import {
  contacts, deals, fundingApplications, fundingOpportunities, impactRecords, introductions, messages, organizations, originationItems, policyDecisions, projects,
  replies, scanResults, signals, stewardshipObligations, tasks,
} from "@/db/schema";
import { localDate } from "@/lib/command/desk";
import { DECISION_STATE_LABEL } from "@/lib/integrity/policy";
import { serviceName } from "@/lib/origination/labels";
import type { Hub } from "@/lib/hubs";

export const LOOP_STEPS = [
  { key: "find", label: "Find", question: "What new projects, funding calls and needs appeared?" },
  { key: "qualify", label: "Qualify", question: "Is it sound, ready and worth our time?" },
  { key: "reach", label: "Reach", question: "Who decides, and how do we reach them?" },
  { key: "win", label: "Win", question: "What do we propose, at what price, and is it signed?" },
  { key: "deliver", label: "Deliver", question: "What is due, by whom, for which client?" },
  { key: "capital", label: "Capital", question: "Which capital gets this project financed?" },
  { key: "steward", label: "Steward", question: "Is it doing what it promised?" },
] as const;
export type LoopKey = (typeof LOOP_STEPS)[number]["key"];
export const LOOP_HUB_KEYS = ["find", "qualify", "reach", "win", "deliver", "steward"] as const;
export type LoopHubKey = (typeof LOOP_HUB_KEYS)[number];

const n = (v: number | null | undefined) => String(v ?? 0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const count = async (db: Db, table: any, where: SQL | undefined) => { const [r] = await db.select({ n: sql<number>`count(*)` }).from(table).where(where); return r?.n ?? 0; };
const inWs = (col: SQLiteColumn, ids: string[]) => inArray(col, ids.length ? ids : ["-"]);
const CLOSED_STAGES = ["won", "lost", "deferred"];

export async function loopHub(db: Db, key: LoopHubKey, ids: string[], now = new Date()): Promise<Hub> {
  const today = localDate(now);
  switch (key) {
    case "find": {
      const open = and(inWs(originationItems.mandateId, ids), notInArray(originationItems.stage, CLOSED_STAGES));
      const [queued, discovered, calls, sigs, toReview, top] = await Promise.all([
        count(db, originationItems, open),
        count(db, originationItems, and(open, eq(originationItems.stage, "discovered"))),
        count(db, fundingOpportunities, and(inWs(fundingOpportunities.mandateId, ids), ne(fundingOpportunities.status, "closed"), eq(fundingOpportunities.category, "opportunity"), gte(fundingOpportunities.deadline, today))),
        count(db, signals, eq(signals.status, "relevant")),
        count(db, scanResults, and(inWs(scanResults.mandateId, ids), eq(scanResults.review, "needs_review"))),
        db.select().from(originationItems).where(and(open, gte(originationItems.priority, 0))).orderBy(desc(originationItems.priority)).limit(6),
      ]);
      return {
        title: "Find", purpose: "Everything the OS found overnight, ranked: projects that need help, funding calls that fit a project, market theses and open client needs. Review each item, then qualify it or dismiss it. Nothing here contacts anyone.",
        metrics: [
          { label: "In the opportunity queue", value: n(queued), href: "/origination", def: "Open queue items (not won, lost or deferred)." },
          { label: "Not yet reviewed", value: n(discovered), href: "/origination", def: "Queue items still at Discovered: no person has looked at them." },
          { label: "Open funding calls", value: n(calls), href: "/funding", def: "Funding calls with a deadline today or later (awards excluded)." },
          { label: "Scan results to review", value: n(toReview), href: "/scans?tab=runs", def: "Organizations or people a scan found that no person has accepted or rejected." },
          { label: "Relevant signals", value: n(sigs), href: "/triggers?tab=signals", def: "Public signals read as relevant to Regenera's scope." },
        ],
        attention: top.map(x => ({ label: x.title, href: x.projectId ? `/projects/${x.projectId}?tab=capital` : "/origination", sub: `Do next: ${x.nextAction ?? "review"}${x.recommendedService ? ` · offer: ${serviceName(x.recommendedService)}` : ""}` })),
        recentTitle: "", recent: [],
        actions: [{ label: "Review the queue", href: "/origination" }, { label: "Funding calls", href: "/funding" }, { label: "Run a scan", href: "/scans" }],
        empty: queued === 0 ? "The queue is empty. It rebuilds every 3 hours from funding matches, projects, site screens and market theses; Refresh queue on the Opportunity queue page runs it now." : undefined,
      };
    }
    case "qualify": {
      const base = and(inWs(projects.mandateId, ids), isNull(projects.archivedAt), ne(projects.status, "dropped"));
      const [total, decisions, blocked] = await Promise.all([
        count(db, projects, base),
        db.select({ state: policyDecisions.state, n: sql<number>`count(*)` }).from(policyDecisions).where(and(inWs(policyDecisions.mandateId, ids), eq(policyDecisions.current, true))).groupBy(policyDecisions.state),
        db.select({ pid: policyDecisions.projectId, state: policyDecisions.state, out: policyDecisions.outstanding, name: projects.name }).from(policyDecisions).innerJoin(projects, eq(projects.id, policyDecisions.projectId))
          .where(and(inWs(policyDecisions.mandateId, ids), eq(policyDecisions.current, true), inArray(policyDecisions.state, ["human_review", "redesign_required", "enhanced_due_diligence"]))).orderBy(desc(policyDecisions.createdAt)).limit(6),
      ]);
      const by = Object.fromEntries(decisions.map(d => [d.state, d.n])) as Record<string, number>;
      const screened = decisions.reduce((s, d) => s + d.n, 0);
      return {
        title: "Qualify", purpose: "Decide whether a project is sound and worth Regenera's time before anyone is contacted: integrity screening (may we pursue it?), readiness (what is missing?) and the commercial scope we would offer.",
        metrics: [
          { label: "Projects", value: n(total), href: "/projects", def: "Active projects in your workspaces (archived and dropped excluded)." },
          { label: "Not screened yet", value: n(Math.max(0, total - screened)), href: "/origination?tab=screening", def: "Projects without a current integrity decision (screening runs every 2 hours)." },
          { label: "Cleared to pursue", value: n((by.eligible ?? 0) + (by.conditionally_eligible ?? 0)), href: "/origination?tab=screening&state=eligible", def: "Eligible or conditionally eligible under the current policy." },
          { label: "Need a person", value: n((by.human_review ?? 0) + (by.excluded ?? 0)), href: "/origination?tab=screening&state=human_review", def: "Human review or excluded: no proposal, outreach or introduction until an owner decides." },
        ],
        attention: blocked.map(b => ({ label: b.name, href: `/projects/${b.pid}?tab=capital#integrity`, sub: `${DECISION_STATE_LABEL[b.state]}${b.out[0] ? ` · next: ${b.out[0]}` : ""}` })),
        recentTitle: "", recent: [],
        actions: [{ label: "Integrity screening", href: "/origination?tab=screening" }, { label: "Projects", href: "/projects" }, { label: "Add project", href: "/projects?new=1" }],
        empty: total === 0 ? "No projects yet. Projects arrive from the World Bank loop, portal intake, Atlas site screens or Add project." : undefined,
      };
    }
    case "reach": {
      const [orgCount, people, drafts, unhandled, readyItems] = await Promise.all([
        count(db, organizations, and(inWs(organizations.mandateId, ids), isNull(organizations.archivedAt), eq(organizations.testRecord, false))),
        count(db, contacts, and(inWs(contacts.mandateId, ids), isNull(contacts.archivedAt), eq(contacts.testRecord, false))),
        count(db, messages, and(inWs(messages.mandateId, ids), inArray(messages.status, ["pending_approval", "style_failed"]))),
        count(db, replies, and(inWs(replies.mandateId, ids), eq(replies.handled, false), eq(replies.testRecord, false))),
        db.select({ title: originationItems.title, pid: originationItems.projectId, oid: originationItems.orgId, next: originationItems.nextAction }).from(originationItems)
          .where(and(inWs(originationItems.mandateId, ids), inArray(originationItems.stage, ["qualified", "outreach_proposed", "outreach_approved"]))).orderBy(desc(originationItems.priority)).limit(6),
      ]);
      return {
        title: "Reach", purpose: "Find who decides and reach them well: organizations, people, introductions and outreach. Every message is drafted for your approval; nothing is sent without it.",
        metrics: [
          { label: "Drafts awaiting approval", value: n(drafts), href: "/queue", def: "Outreach messages drafted and waiting for a person to approve." },
          { label: "Replies to handle", value: n(unhandled), href: "/inbox", def: "Replies not yet marked handled." },
          { label: "Organizations", value: n(orgCount), href: "/companies", def: "Organizations, excluding test records." },
          { label: "People", value: n(people), href: "/people", def: "People records, excluding test records." },
        ],
        attention: [
          ...(drafts ? [{ label: `${drafts} outreach draft${drafts === 1 ? "" : "s"} to approve`, href: "/queue" }] : []),
          ...(unhandled ? [{ label: `${unhandled} repl${unhandled === 1 ? "y" : "ies"} to handle`, href: "/inbox" }] : []),
          ...readyItems.map(x => ({ label: x.title, href: x.pid ? `/projects/${x.pid}?tab=stakeholders` : x.oid ? `/companies/${x.oid}` : "/origination", sub: "Qualified: find the decision maker and propose outreach" })),
        ],
        recentTitle: "", recent: [],
        actions: [{ label: "Approve drafts", href: "/queue" }, { label: "Find decision makers", href: "/prospecting" }, { label: "Organizations", href: "/companies" }],
      };
    }
    case "win": {
      const base = and(inWs(deals.mandateId, ids), isNull(deals.archivedAt), eq(deals.testRecord, false));
      const open = and(base, inArray(deals.stage, ["lead", "contacted", "engaged", "call_booked", "proposal", "nurture"]));
      const [total, leads, proposals, rows] = await Promise.all([
        count(db, deals, open), count(db, deals, and(base, eq(deals.stage, "lead"))), count(db, deals, and(base, eq(deals.stage, "proposal"))),
        db.select({ id: deals.id, name: deals.name, stage: deals.stage, next: deals.nextAction, date: deals.nextActionDate }).from(deals).where(open).orderBy(asc(deals.nextActionDate)).limit(30),
      ]);
      const due = rows.filter(r => !r.next || (r.date && r.date <= today)).slice(0, 6);
      return {
        title: "Win", purpose: "Regenera's own sales: turn a qualified need into a proposal, agree terms and sign. Fees only; project value, grants and capital raised are never counted here.",
        metrics: [
          { label: "Open in the sales pipeline", value: n(total), href: "/deals?view=table", def: "Deals from Lead to Proposal (and Nurture), excluding test records." },
          { label: "New leads", value: n(leads), href: "/deals?stage=lead", def: "Deals at Lead: qualify with a call or close as not a fit." },
          { label: "Proposals awaiting decision", value: n(proposals), href: "/deals?view=table&stage=proposal", def: "Deals at the Proposal stage." },
        ],
        attention: due.map(r => ({ label: r.name, href: `/deals/${r.id}`, sub: r.next ? `Due ${r.date ?? "now"}: ${r.next}` : "No next action set" })),
        recentTitle: "", recent: [],
        actions: [{ label: "Sales pipeline", href: "/deals" }, { label: "New leads", href: "/deals?stage=lead" }, { label: "Add a deal", href: "/deals?new=1" }, { label: "Contracts", href: "/contracts" }],
        empty: total === 0 ? "No open deals. Deals start from a qualified queue item, an enquiry from regenera.bio, a referral or a portal intake." : undefined,
      };
    }
    case "deliver": {
      const [open, overdue, apps, appRows] = await Promise.all([
        count(db, tasks, and(inWs(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false))),
        count(db, tasks, and(inWs(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false), lt(tasks.dueAt, today))),
        count(db, fundingApplications, and(inWs(fundingApplications.mandateId, ids), notInArray(fundingApplications.state, ["submitted", "awarded", "unsuccessful", "withdrawn"]))),
        db.select({ id: fundingApplications.id, name: fundingApplications.name, state: fundingApplications.state, due: fundingApplications.internalDeadline }).from(fundingApplications)
          .where(and(inWs(fundingApplications.mandateId, ids), notInArray(fundingApplications.state, ["submitted", "awarded", "unsuccessful", "withdrawn"]))).orderBy(asc(fundingApplications.internalDeadline)).limit(5),
      ]);
      return {
        title: "Deliver", purpose: "Do the work clients pay for: tasks with owners and dates, playbooks, documents and funding applications. Approval and submission of applications are always a person's decision.",
        metrics: [
          { label: "Open tasks", value: n(open), href: "/tasks", def: "Open tasks, excluding test records." },
          { label: "Overdue tasks", value: n(overdue), href: "/tasks", def: "Open tasks due before today (workspace time zone)." },
          { label: "Applications in progress", value: n(apps), href: "/funding?tab=bids", def: "Funding applications not yet submitted, awarded, unsuccessful or withdrawn." },
        ],
        attention: [
          ...(overdue ? [{ label: `${overdue} overdue task${overdue === 1 ? "" : "s"}`, href: "/tasks", sub: "Assign an owner or move the date" }] : []),
          ...appRows.map(a => ({ label: a.name, href: `/funding/applications/${a.id}`, sub: `${a.state.replace(/_/g, " ")}${a.due ? ` · internal deadline ${a.due}` : ""}` })),
        ],
        recentTitle: "", recent: [],
        actions: [{ label: "Tasks", href: "/tasks" }, { label: "Applications", href: "/funding?tab=bids" }, { label: "Documents", href: "/documents" }, { label: "Playbooks", href: "/playbooks" }],
      };
    }
    case "steward": {
      const [openO, overdueO, impacts, rows, intros] = await Promise.all([
        count(db, stewardshipObligations, and(inWs(stewardshipObligations.mandateId, ids), eq(stewardshipObligations.status, "open"))),
        count(db, stewardshipObligations, and(inWs(stewardshipObligations.mandateId, ids), eq(stewardshipObligations.status, "overdue"))),
        count(db, impactRecords, inWs(impactRecords.mandateId, ids)),
        db.select({ title: stewardshipObligations.title, pid: stewardshipObligations.projectId, status: stewardshipObligations.status, due: stewardshipObligations.dueAt }).from(stewardshipObligations)
          .where(and(inWs(stewardshipObligations.mandateId, ids), inArray(stewardshipObligations.status, ["overdue", "open"]))).orderBy(asc(stewardshipObligations.dueAt)).limit(6),
        count(db, introductions, and(inWs(introductions.mandateId, ids), eq(introductions.status, "made"))),
      ]);
      return {
        title: "Steward", purpose: "After financing: keep the promises a project made. Monitoring, reporting and benefit-sharing obligations, and impact records kept apart as baseline, forecast, target, reported and independently verified.",
        metrics: [
          { label: "Overdue obligations", value: n(overdueO), href: "/origination?tab=stewardship", def: "Stewardship obligations past their due date (each creates a task)." },
          { label: "Open obligations", value: n(openO), href: "/origination?tab=stewardship", def: "Obligations not yet due." },
          { label: "Impact records", value: n(impacts), href: "/origination?tab=stewardship", def: "Impact values recorded with method and source." },
          { label: "Introductions made", value: n(intros), href: "/capital?tab=introductions", def: "Capital introductions recorded as made." },
        ],
        attention: rows.map(o => ({ label: o.title, href: `/projects/${o.pid}?tab=capital#integrity`, sub: `${o.status}${o.due ? ` · due ${o.due.slice(0, 10)}` : ""}` })),
        recentTitle: "", recent: [],
        actions: [{ label: "Stewardship & impact", href: "/origination?tab=stewardship" }, { label: "Operating assets", href: "/projects?stage=operations" }, { label: "Reports", href: "/reports" }],
        empty: openO + overdueO + impacts === 0 ? "Nothing to steward yet. Obligations and impact records are added on a project's Capital tab once agreed with the sponsor or funder." : undefined,
      };
    }
  }
}
