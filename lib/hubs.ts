// Landing pages for each main navigation group (phase 15 §5): a purpose statement, a few metrics with definitions, an
// attention queue, recent records, contextual actions and the group's specialist tools. Counts exclude test records
// where the table has the flag; an empty module says so instead of showing a row of zeros.
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import {
  accountQualifications, capitalProfiles, capitalRequirements, commercialMandates, contacts, deals, documents, engagements, interventions, introductions,
  invoices, organizations, projects, pursuits, replies, scanResults, scanRuns, signals, systemAssessments, tasks, approvals,
} from "@/db/schema";
import { DEAL_STAGES } from "@/lib/vocab";
import { localDate } from "@/lib/command/desk";
import { QUALIFICATION_LABELS } from "@/lib/scan/qualification";
import { BUILT_IN_PRESETS } from "@/lib/scan/presets";

export type HubMetric = { label: string; value: string; href: string; def: string };
export type HubLink = { label: string; href: string; sub?: string };
export type Hub = { title: string; purpose: string; metrics: HubMetric[]; attention: HubLink[]; recent: HubLink[]; recentTitle: string; actions: HubLink[]; empty?: string };

const n = (v: number | null | undefined) => String(v ?? 0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const count = async (db: Db, table: any, where: SQL | undefined) => {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return r?.n ?? 0;
};
const inWs = (col: SQLiteColumn, ids: string[]) => inArray(col, ids.length ? ids : ["-"]);

export const HUB_KEYS = ["mandates", "projects", "systems", "capital", "deals", "relationships", "intelligence", "clients", "operations"] as const;
export type HubKey = (typeof HUB_KEYS)[number];

export async function hubData(db: Db, key: HubKey, ids: string[], now = new Date()): Promise<Hub> {
  const today = localDate(now);
  switch (key) {
    case "mandates": {
      const [active, open, pending, review, recent] = await Promise.all([
        count(db, commercialMandates, and(inWs(commercialMandates.mandateId, ids), eq(commercialMandates.status, "active"))),
        count(db, pursuits, and(inWs(pursuits.mandateId, ids), isNull(pursuits.outcome))),
        count(db, approvals, and(inWs(approvals.mandateId, ids), eq(approvals.status, "pending"))),
        db.select({ id: commercialMandates.id, name: commercialMandates.name, status: commercialMandates.status, health: commercialMandates.healthNote }).from(commercialMandates).where(inWs(commercialMandates.mandateId, ids)).orderBy(desc(commercialMandates.updatedAt)).limit(8),
        db.select({ id: commercialMandates.id, name: commercialMandates.name, status: commercialMandates.status, client: commercialMandates.clientName }).from(commercialMandates).where(inWs(commercialMandates.mandateId, ids)).orderBy(desc(commercialMandates.updatedAt)).limit(8),
      ]);
      return {
        title: "Mandates", purpose: "Contracted or scoped objectives with written criteria: pursuits screened against them, delivery targets, client decisions, approvals and economics.",
        metrics: [
          { label: "Active mandates", value: n(active), href: "/mandates?status=active", def: "Commercial mandates with status Active." },
          { label: "Open pursuits", value: n(open), href: "/pursuits", def: "Pursuits without a recorded outcome." },
          { label: "Approvals pending", value: n(pending), href: "/approvals", def: "Approval requests waiting for the named approver." },
        ],
        attention: review.filter(m => m.health && m.health.length > 0).map(m => ({ label: m.name, href: `/mandates/${m.id}`, sub: m.health ?? "" })),
        recentTitle: "Mandates", recent: recent.map(m => ({ label: m.name, href: `/mandates/${m.id}`, sub: [m.client, m.status].filter(Boolean).join(" · ") })),
        actions: [{ label: "New mandate", href: "/mandates?new=epc_origination" }, { label: "Screen candidates", href: "/mandates" }, { label: "Review pursuits", href: "/pursuits" }, { label: "Approvals", href: "/approvals" }],
        empty: active + open === 0 ? "No mandates yet. A mandate starts from a signed or scoped client objective: create one, then screen candidates against its written criteria." : undefined,
      };
    }
    case "projects": {
      const base = and(inWs(projects.mandateId, ids), isNull(projects.archivedAt), ne(projects.status, "dropped"));
      const [total, noLocation, seeking, recent] = await Promise.all([
        count(db, projects, base), count(db, projects, and(base, or(isNull(projects.lat), isNull(projects.lng)))),
        db.select({ n: sql<number>`count(distinct ${capitalRequirements.projectId})` }).from(capitalRequirements).where(and(inWs(capitalRequirements.mandateId, ids), notInArray(capitalRequirements.status, ["closed", "cancelled"]))).then(r => r[0]?.n ?? 0),
        db.select({ id: projects.id, name: projects.name, stage: projects.stage, country: projects.country }).from(projects).where(base).orderBy(desc(projects.updatedAt)).limit(8),
      ]);
      return {
        title: "Projects", purpose: "Physical assets and development initiatives: readiness, constraints, milestones, stage movement, decisions and capital needs.",
        metrics: [
          { label: "Projects", value: n(total), href: "/projects", def: "Projects not archived or dropped." },
          { label: "Seeking capital", value: n(seeking), href: "/projects?capital=1", def: "Projects with at least one open capital requirement." },
          { label: "Without a location", value: n(noLocation), href: "/projects", def: "Projects with no recorded point or boundary; they cannot appear on maps or in site analysis." },
        ],
        attention: noLocation ? [{ label: `${noLocation} project${noLocation === 1 ? "" : "s"} without a location`, href: "/projects", sub: "Add a point or boundary to enable site analysis" }] : [],
        recentTitle: "Recently updated", recent: recent.map(p => ({ label: p.name, href: `/projects/${p.id}`, sub: [p.stage.replace(/_/g, " "), p.country].filter(Boolean).join(" · ") })),
        actions: [{ label: "Add project", href: "/projects?new=1" }, { label: "Review blockers", href: "/projects?blocked=1" }, { label: "Site briefs", href: "/map/briefs" }, { label: "Match delivery partners", href: "/objectives" }, { label: "Seeking capital", href: "/projects?capital=1" }],
        empty: total === 0 ? "No projects recorded. Projects are created from opportunities (Create and link project) or added directly." : undefined,
      };
    }
    case "systems": {
      const [assessed, constrained, ints, notAssessed] = await Promise.all([
        count(db, systemAssessments, inWs(systemAssessments.mandateId, ids)),
        count(db, systemAssessments, and(inWs(systemAssessments.mandateId, ids), inArray(systemAssessments.capacity, ["constrained", "exceeded"]))),
        db.select({ id: interventions.id, issue: interventions.systemIssue, projectId: interventions.projectId, status: interventions.status }).from(interventions).where(inWs(interventions.mandateId, ids)).orderBy(desc(interventions.updatedAt)).limit(8),
        db.select({ n: sql<number>`count(*)` }).from(projects).where(and(inWs(projects.mandateId, ids), isNull(projects.archivedAt), sql`not exists (select 1 from system_assessments sa where sa.project_id = ${projects.id})`)).then(r => r[0]?.n ?? 0),
      ]);
      return {
        title: "Systems", purpose: "Assessed capacity of land, water, ecology, community and infrastructure systems, the risks they carry, and the interventions that would change them. Blank means not assessed, never fine.",
        metrics: [
          { label: "Assessments recorded", value: n(assessed), href: "/systems", def: "System category readings recorded on projects." },
          { label: "Constrained or exceeded", value: n(constrained), href: "/systems", def: "Readings a person recorded as constrained or threshold exceeded." },
          { label: "Projects not assessed", value: n(notAssessed), href: "/systems", def: "Projects with no system reading at all: coverage, not risk." },
        ],
        attention: constrained ? [{ label: `${constrained} constrained system reading${constrained === 1 ? "" : "s"}`, href: "/systems", sub: "Review interventions and capital implications" }] : [],
        recentTitle: "Interventions", recent: ints.map(i => ({ label: i.issue, href: `/projects/${i.projectId}?tab=systems`, sub: i.status })),
        actions: [{ label: "Capacity matrix", href: "/systems" }, { label: "Land & agriculture", href: "/systems?focus=land,soil,water" }, { label: "Biodiversity & climate", href: "/systems?focus=biodiversity,climate,resilience" }],
        empty: assessed === 0 ? "No system assessments yet: nothing is assessed, so no capacity risk can be stated." : undefined,
      };
    }
    case "capital": {
      const [profiles, intros, gaps, recent] = await Promise.all([
        count(db, capitalProfiles, and(inWs(capitalProfiles.mandateId, ids), isNull(capitalProfiles.archivedAt))),
        count(db, introductions, and(inWs(introductions.mandateId, ids), inArray(introductions.status, ["requested", "permission_granted"]))),
        db.select({ currency: capitalRequirements.currency, gap: sql<number>`sum(max(0, coalesce(${capitalRequirements.target}, 0) - ${capitalRequirements.secured}))` }).from(capitalRequirements).where(and(inWs(capitalRequirements.mandateId, ids), notInArray(capitalRequirements.status, ["closed", "cancelled"]))).groupBy(capitalRequirements.currency),
        db.select({ id: capitalProfiles.id, name: capitalProfiles.name, type: capitalProfiles.capitalType }).from(capitalProfiles).where(and(inWs(capitalProfiles.mandateId, ids), isNull(capitalProfiles.archivedAt))).orderBy(desc(capitalProfiles.updatedAt)).limit(8),
      ]);
      const gapText = gaps.filter(g => g.gap > 0).map(g => `${g.currency} ${Math.round(g.gap).toLocaleString("en-US")}`).join(" + ") || "None recorded";
      return {
        title: "Capital", purpose: "Capital relationships and project capital requirements: stated mandates, matching on investment criteria (never proximity), introductions and assessment status. Commercial fit is separate from regulatory eligibility.",
        metrics: [
          { label: "Capital partner profiles", value: n(profiles), href: "/capital", def: "Recorded capital providers with a profile." },
          { label: "Capital still to raise", value: gapText, href: "/capital?tab=opportunities", def: "Open project capital requirements minus secured amounts, per currency. Project capital, not Regenera revenue." },
          { label: "Introductions in progress", value: n(intros), href: "/capital?tab=introductions", def: "Introductions requested or with permission granted, not yet made." },
        ],
        attention: [], recentTitle: "Capital partners", recent: recent.map(c => ({ label: c.name, href: `/capital/${c.id}`, sub: c.type?.replace(/_/g, " ") ?? "" })),
        actions: [{ label: "Find capital providers", href: "/scans?preset=real_asset_funds" }, { label: "Match to a project", href: "/capital?tab=opportunities" }, { label: "Review introductions", href: "/capital?tab=introductions" }, { label: "Funding opportunities", href: "/funding" }],
        empty: profiles === 0 ? "No capital providers recorded. Scan for funds, family offices, lenders or DFIs, then record each mandate from its source." : undefined,
      };
    }
    case "deals": {
      const base = and(inWs(deals.mandateId, ids), isNull(deals.archivedAt), eq(deals.testRecord, false));
      const open = and(base, inArray(deals.stage, ["lead", "contacted", "engaged", "call_booked", "proposal", "nurture"]));
      const [total, proposals, noNext, rows] = await Promise.all([
        count(db, deals, open), count(db, deals, and(base, eq(deals.stage, "proposal"))),
        count(db, deals, and(open, or(isNull(deals.nextAction), eq(deals.nextAction, ""), lt(deals.nextActionDate, today)))),
        db.select({ id: deals.id, name: deals.name, stage: deals.stage, next: deals.nextAction, date: deals.nextActionDate, value: deals.valueEstimate }).from(deals).where(open).orderBy(desc(deals.updatedAt)).limit(10),
      ]);
      return {
        title: "Opportunities", purpose: "Regenera's own commercial pipeline: potential paid engagements, expected fees (USD), proposals, owners and next actions. Project value, grants and capital raised are not counted here.",
        metrics: [
          { label: "Open opportunities", value: n(total), href: "/deals?view=table", def: "Opportunities from Lead to Proposal (and Nurture), excluding test records." },
          { label: "Proposals awaiting decision", value: n(proposals), href: "/deals?view=table&stage=proposal", def: "Opportunities at the Proposal stage." },
          { label: "Missing or overdue next action", value: n(noNext), href: "/deals?view=table", def: "Open opportunities with no next action, or one dated before today." },
        ],
        attention: rows.filter(r => !r.next || (r.date && r.date < today)).map(r => ({ label: r.name, href: `/deals/${r.id}`, sub: r.next ? `Next action overdue since ${r.date}` : "No next action" })),
        recentTitle: "Open opportunities", recent: rows.map(r => ({ label: r.name, href: `/deals/${r.id}`, sub: `${DEAL_STAGES[r.stage as keyof typeof DEAL_STAGES]}${r.value != null ? ` · USD ${Math.round(r.value).toLocaleString("en-US")} fee` : ""}` })),
        actions: [{ label: "Add opportunity", href: "/deals?new=1" }, { label: "Pipeline board", href: "/deals" }, { label: "Proposals", href: "/deals?view=table&stage=proposal" }, { label: "Contracts", href: "/contracts" }],
        empty: total === 0 ? "No open opportunities. Opportunities come from qualified accounts, inquiries, referrals and pursued signals." : undefined,
      };
    }
    case "relationships": {
      const [orgCount, people, toReview, statuses, unhandled, recent] = await Promise.all([
        count(db, organizations, and(inWs(organizations.mandateId, ids), isNull(organizations.archivedAt), eq(organizations.testRecord, false))),
        count(db, contacts, and(inWs(contacts.mandateId, ids), isNull(contacts.archivedAt), eq(contacts.testRecord, false))),
        count(db, scanResults, and(inWs(scanResults.mandateId, ids), eq(scanResults.review, "needs_review"), eq(scanResults.entityType, "organization"))),
        db.select({ status: accountQualifications.status, n: sql<number>`count(*)` }).from(accountQualifications).where(inWs(accountQualifications.mandateId, ids)).groupBy(accountQualifications.status),
        count(db, replies, and(inWs(replies.mandateId, ids), eq(replies.handled, false), eq(replies.testRecord, false))),
        db.select({ id: scanRuns.id, name: scanRuns.presetName, status: scanRuns.status, counts: scanRuns.counts, at: scanRuns.createdAt }).from(scanRuns).where(inWs(scanRuns.mandateId, ids)).orderBy(desc(scanRuns.createdAt)).limit(6),
      ]);
      const by = Object.fromEntries(statuses.map(s => [s.status, s.n])) as Record<string, number>;
      return {
        title: "Relationships", purpose: "Organizations, people and prospect discovery: who to pursue, account coverage, referral partners and relationship history. A discovered organization is not a lead until a person reviews it.",
        metrics: [
          { label: "Organizations", value: n(orgCount), href: "/companies", def: "Organizations in the workspace, excluding test records." },
          { label: "Scan results to review", value: n(toReview), href: "/scans?tab=runs", def: "Organizations a scan found that no person has accepted or rejected yet." },
          { label: "Ready for outreach", value: n(by.ready_for_outreach), href: "/companies?qualification=ready_for_outreach", def: "Accounts a person marked ready: fit assessed and a usable contact route recorded." },
          { label: "People", value: n(people), href: "/people", def: "People records, excluding test records." },
        ],
        attention: [
          ...(toReview ? [{ label: `${toReview} scan result${toReview === 1 ? "" : "s"} waiting for review`, href: "/scans?tab=runs" }] : []),
          ...(unhandled ? [{ label: `${unhandled} unhandled repl${unhandled === 1 ? "y" : "ies"}`, href: "/inbox" }] : []),
          ...(Object.keys(QUALIFICATION_LABELS) as (keyof typeof QUALIFICATION_LABELS)[]).filter(k => by[k] && ["criteria_matched", "human_reviewed"].includes(k)).map(k => ({ label: `${by[k]} account${by[k] === 1 ? "" : "s"}: ${QUALIFICATION_LABELS[k]}`, href: `/companies?qualification=${k}`, sub: "Next: record fit, intent, access and contact readiness" })),
        ],
        recentTitle: "Recent scans", recent: recent.map(r => ({ label: r.name || "Scan", href: `/scans/${r.id}`, sub: `${r.status} · ${r.counts.found ?? 0} found, ${r.counts.matching ?? 0} match` })),
        actions: [{ label: "Find organizations", href: `/scans?preset=${BUILT_IN_PRESETS[0].key}` }, { label: "Find decision makers", href: "/prospecting" }, { label: "Review prospects", href: "/scans?tab=runs" }, { label: "Inbox", href: "/inbox" }],
      };
    }
    case "intelligence": {
      const [waiting, relevant] = await Promise.all([count(db, signals, eq(signals.status, "new")), count(db, signals, eq(signals.status, "relevant"))]);
      return {
        title: "Intelligence", purpose: "Signals, sourced research, analyses and decision briefs. A relevant-looking event is not proof of buying intent; analyses carry their evidence and assumptions.",
        metrics: [
          { label: "Signals waiting to be read", value: n(waiting), href: "/triggers?tab=signals&status=new", def: "Collected public signals not yet read by Claude (needs ANTHROPIC_API_KEY)." },
          { label: "Signals read as relevant", value: n(relevant), href: "/triggers?tab=signals", def: "Signals Claude read as relevant to Regenera's scope; still to be reviewed." },
        ],
        attention: waiting ? [{ label: `${waiting} signals waiting`, href: "/settings/claude", sub: "They are read only once Claude is configured" }] : [],
        recentTitle: "Tools", recent: [], actions: [{ label: "Analyst workbench", href: "/workbench" }, { label: "Signals", href: "/triggers" }, { label: "Email intelligence", href: "/intelligence/mail" }, { label: "Reports", href: "/reports" }],
      };
    }
    case "clients": {
      const [active, overdue, recent] = await Promise.all([
        count(db, engagements, and(inWs(engagements.mandateId, ids), inArray(engagements.status, ["active", "waiting_on_client"]))),
        count(db, invoices, and(inWs(invoices.mandateId, ids), inArray(invoices.status, ["sent", "overdue"]), lt(invoices.dueDate, today))),
        db.select({ id: engagements.id, name: engagements.name, status: engagements.status }).from(engagements).where(inWs(engagements.mandateId, ids)).orderBy(desc(engagements.updatedAt)).limit(8),
      ]);
      return {
        title: "Clients", purpose: "Engagements, commitments, deliverables, change requests, invoices, renewals and expansion. Signed, invoiced and collected revenue are reported separately.",
        metrics: [
          { label: "Active engagements", value: n(active), href: "/commercial?tab=engagements", def: "Engagements Active or Waiting on client." },
          { label: "Invoices past due", value: n(overdue), href: "/commercial?tab=billing", def: "Sent invoices whose due date has passed and are not marked paid." },
        ],
        attention: overdue ? [{ label: `${overdue} invoice${overdue === 1 ? "" : "s"} past due`, href: "/commercial?tab=billing" }] : [],
        recentTitle: "Engagements", recent: recent.map(e => ({ label: e.name, href: `/commercial/engagements/${e.id}`, sub: e.status.replace(/_/g, " ") })),
        actions: [{ label: "Accounts", href: "/clients" }, { label: "Engagements", href: "/commercial?tab=engagements" }, { label: "Billing", href: "/commercial?tab=billing" }, { label: "Services & pricing", href: "/commercial?tab=services" }],
        empty: active === 0 ? "No active engagements recorded." : undefined,
      };
    }
    case "operations": {
      const [open, overdue, unassigned, docs] = await Promise.all([
        count(db, tasks, and(inWs(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false))),
        count(db, tasks, and(inWs(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false), lt(tasks.dueAt, today))),
        count(db, tasks, and(inWs(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false), isNull(tasks.owner))),
        count(db, documents, inWs(documents.mandateId, ids)),
      ]);
      return {
        title: "Operations", purpose: "Tasks, owners, dependencies, documents and execution blockers across the practice.",
        metrics: [
          { label: "Open tasks", value: n(open), href: "/tasks", def: "Open tasks, excluding test records." },
          { label: "Overdue", value: n(overdue), href: "/tasks", def: "Open tasks due before today (workspace time zone)." },
          { label: "Unassigned", value: n(unassigned), href: "/tasks", def: "Open tasks with no owner." },
          { label: "Documents", value: n(docs), href: "/documents", def: "Documents registered in the workspace." },
        ],
        attention: overdue ? [{ label: `${overdue} overdue task${overdue === 1 ? "" : "s"}`, href: "/today", sub: "Grouped by workstream on Command" }] : [],
        recentTitle: "Tools", recent: [], actions: [{ label: "Tasks", href: "/tasks" }, { label: "Capacity", href: "/capacity" }, { label: "Documents", href: "/documents" }, { label: "Document generator", href: "/documents/generator" }],
      };
    }
  }
}
