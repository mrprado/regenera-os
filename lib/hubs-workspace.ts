// Landing pages for the October 2026 work areas (Discover, Projects, Network, Engage, Workflows, Steward), built on the
// phase 24 loop data so "Do this next" keeps its records and actions. Phase 24 loop URLs (/overview/find …) resolve here.
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import { contractObligations, organizations, scanRuns, tasks } from "@/db/schema";
import { localDate } from "@/lib/command/desk";
import { hubData, type Hub } from "@/lib/hubs";
import { loopHub } from "@/lib/hubs-loop";

export const WORKSPACE_HUB_KEYS = ["discover", "network", "engage", "workflows", "steward", "find", "qualify", "reach", "win", "deliver"] as const;
export type WorkspaceHubKey = (typeof WORKSPACE_HUB_KEYS)[number];
/** Phase 24 loop step → the work area that now owns it. */
export const LOOP_TO_AREA: Record<string, string> = { find: "discover", qualify: "projects", reach: "network", win: "engage", deliver: "workflows" };

const inWs = (col: SQLiteColumn, ids: string[]) => inArray(col, ids.length ? ids : ["-"]);
const merge = (a: Hub, b: Hub, title: string, purpose: string): Hub => ({
  title, purpose,
  metrics: [...a.metrics, ...b.metrics.filter(m => !a.metrics.some(x => x.label === m.label))],
  attention: [...a.attention, ...b.attention],
  recent: a.recent.length ? a.recent : b.recent, recentTitle: a.recent.length ? a.recentTitle : b.recentTitle,
  actions: [...a.actions, ...b.actions.filter(x => !a.actions.some(y => y.href === x.href))],
  empty: a.empty ?? b.empty,
});

export async function workspaceHub(db: Db, key: WorkspaceHubKey | "projects", ids: string[], now = new Date()): Promise<Hub> {
  const area = LOOP_TO_AREA[key] ?? key;
  switch (area) {
    case "discover": {
      const [find, runs] = await Promise.all([
        loopHub(db, "find", ids, now),
        db.select().from(scanRuns).where(inWs(scanRuns.mandateId, ids)).orderBy(desc(scanRuns.createdAt)).limit(8),
      ]);
      return { ...find, title: "Discover", recentTitle: "Discovery runs",
        recent: runs.map(r => ({ label: r.presetName || "Discovery run", href: `/scans/${r.id}`, sub: `${r.status} · ${r.counts.found ?? 0} found` })),
        actions: [...find.actions, { label: "Project-first search", href: "/objectives" }] };
    }
    case "projects": {
      const [projects, qualify] = await Promise.all([hubData(db, "projects", ids, now), loopHub(db, "qualify", ids, now)]);
      return merge(qualify, projects, "Projects", "Qualify and advance assets: may we pursue it (integrity screening), what is missing (readiness), and what blocks it (constraints), before anyone is contacted.");
    }
    case "network": {
      const [reach, rows] = await Promise.all([
        loopHub(db, "reach", ids, now),
        db.select({ id: organizations.id, name: organizations.name, country: organizations.country }).from(organizations)
          .where(and(inWs(organizations.mandateId, ids), isNull(organizations.archivedAt), eq(organizations.testRecord, false))).orderBy(desc(organizations.updatedAt)).limit(12),
      ]);
      return { ...reach, title: "Network", recentTitle: "Organizations",
        purpose: "The shared party register: organizations, people, expertise and relationships connected to project work. Every outreach message is approved before it is sent.",
        recent: rows.map(r => ({ label: r.name, href: `/companies/${r.id}`, sub: r.country ?? "Location not recorded" })),
        actions: [...reach.actions, { label: "Relationship graph", href: "/relationships" }] };
    }
    case "engage": {
      const [win, deals] = await Promise.all([loopHub(db, "win", ids, now), hubData(db, "deals", ids, now)]);
      return { ...win, title: "Engage", recent: deals.recent, recentTitle: deals.recentTitle,
        purpose: "Qualify, propose, agree terms and deliver the engagement. Regenera's fees only: project capital and grant amounts are never counted here." };
    }
    case "workflows": {
      const [deliver, rows] = await Promise.all([
        loopHub(db, "deliver", ids, now),
        db.select().from(tasks).where(and(inWs(tasks.mandateId, ids), eq(tasks.status, "open"), eq(tasks.testRecord, false))).orderBy(asc(tasks.dueAt)).limit(16),
      ]);
      return { ...deliver, title: "Workflows", recentTitle: "Delivery queue",
        recent: rows.map(task => ({ label: task.title, href: task.projectId ? `/projects/${task.projectId}?tab=plan` : task.dealId ? `/deals/${task.dealId}` : "/tasks", sub: `Due ${task.dueAt.slice(0, 10)} · ${task.owner || "Owner unassigned"}${task.workstream ? ` · ${task.workstream}` : ""}` })),
        purpose: "Run the work through named owners, dependencies, playbooks and versioned documents. Approval and submission of applications stay a person's decision." };
    }
    case "steward": {
      const today = localDate(now);
      const base = and(inWs(contractObligations.mandateId, ids), inArray(contractObligations.status, ["open", "in_progress"]));
      const [stewardship, [{ open }], [{ overdue }], rows] = await Promise.all([
        loopHub(db, "steward", ids, now),
        db.select({ open: sqlCount() }).from(contractObligations).where(base),
        db.select({ overdue: sqlCount() }).from(contractObligations).where(and(base, lt(contractObligations.dueDate, today))),
        db.select().from(contractObligations).where(base).orderBy(asc(contractObligations.dueDate)).limit(16),
      ]);
      return { ...stewardship, title: "Steward",
        metrics: [...stewardship.metrics,
          { label: "Open agreement obligations", value: String(open ?? 0), href: "/contracts?tab=obligations", def: "Contract obligations in selected workspaces with open or in-progress status." },
          { label: "Overdue agreement obligations", value: String(overdue ?? 0), href: "/contracts?tab=obligations", def: "Open contract obligations with a recorded due date before today." }],
        attention: [...stewardship.attention, ...rows.filter(r => r.dueDate && r.dueDate < today).map(r => ({ label: r.obligation, href: `/contracts/${r.contractId}`, sub: `Due ${r.dueDate} · ${r.owner || r.responsibleParty}` }))],
        recentTitle: "Commitment register",
        recent: rows.map(r => ({ label: r.obligation, href: r.projectId ? `/projects/${r.projectId}` : `/contracts/${r.contractId}`, sub: `${r.dueDate || "No due date"} · ${r.responsibleParty}` })),
        actions: [...stewardship.actions, { label: "Agreement obligations", href: "/contracts?tab=obligations" }] };
    }
  }
  throw new Error(`Unknown work area ${key}`);
}

const sqlCount = () => sql<number>`count(*)`;
