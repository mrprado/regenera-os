// Daily brief (phase 23) built only from records: highest-leverage opportunity, capital alignment, development risk,
// commercial next action, stewardship priority. Each item links to its record; when little changed it says so.
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { fundingOpportunities, fundingProjectMatches, integrityFindings, originationItems, policyDecisions, projects, stewardshipObligations, tasks } from "@/db/schema";

export type BriefItem = { heading: string; text: string; href: string | null };

export async function dailyBrief(db: Db, mandateIds: string[], now = new Date()): Promise<BriefItem[]> {
  if (!mandateIds.length) return [];
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const items: BriefItem[] = [];
  const [top] = await db.select().from(originationItems).where(and(inArray(originationItems.mandateId, mandateIds), gte(originationItems.priority, 1))).orderBy(desc(originationItems.priority)).limit(1);
  items.push(top
    ? { heading: "Highest-leverage opportunity", text: `${top.title}: ${top.nextAction ?? "review"}${top.recommendedService ? ` (${top.recommendedService})` : ""}`, href: top.projectId ? `/projects/${top.projectId}?tab=capital` : "/origination" }
    : { heading: "Highest-leverage opportunity", text: "Nothing prioritised yet: the origination queue is empty or blocked.", href: "/origination" });
  const [m] = await db.select({ title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, pname: projects.name, pid: projects.id }).from(fundingProjectMatches)
    .innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProjectMatches.opportunityId)).innerJoin(projects, eq(projects.id, fundingProjectMatches.projectId))
    .where(and(inArray(fundingProjectMatches.mandateId, mandateIds), eq(fundingProjectMatches.eligibility, "eligible"), eq(fundingProjectMatches.status, "proposed"))).orderBy(asc(fundingOpportunities.deadline)).limit(1);
  items.push(m
    ? { heading: "Capital alignment", text: `${m.title} fits ${m.pname} on stated criteria${m.deadline ? `; deadline ${m.deadline}` : ""}`, href: `/projects/${m.pid}?tab=capital` }
    : { heading: "Capital alignment", text: "No new eligible funding match awaiting a decision.", href: null });
  const [risk] = await db.select({ text: integrityFindings.text, pid: integrityFindings.projectId, pname: projects.name }).from(integrityFindings).innerJoin(projects, eq(projects.id, integrityFindings.projectId))
    .where(and(inArray(integrityFindings.mandateId, mandateIds), eq(integrityFindings.kind, "concern"), gte(integrityFindings.createdAt, since))).limit(1);
  items.push(risk
    ? { heading: "Development risk", text: `${risk.pname}: ${risk.text}`, href: `/projects/${risk.pid}?tab=capital#integrity` }
    : { heading: "Development risk", text: "No new integrity concern in the last 24 hours.", href: null });
  const [t] = await db.select({ title: tasks.title, pid: tasks.projectId }).from(tasks).where(and(inArray(tasks.mandateId, mandateIds), eq(tasks.status, "open"), lte(tasks.dueAt, new Date(now.getTime() + 2 * 86_400_000).toISOString()))).orderBy(asc(tasks.dueAt)).limit(1);
  items.push(t ? { heading: "Commercial next action", text: t.title, href: t.pid ? `/projects/${t.pid}` : "/tasks" } : { heading: "Commercial next action", text: "No task due in the next two days.", href: "/tasks" });
  const [s] = await db.select({ title: stewardshipObligations.title, pid: stewardshipObligations.projectId, status: stewardshipObligations.status, due: stewardshipObligations.dueAt }).from(stewardshipObligations)
    .where(and(inArray(stewardshipObligations.mandateId, mandateIds), inArray(stewardshipObligations.status, ["overdue", "open"]))).orderBy(asc(stewardshipObligations.dueAt)).limit(1);
  items.push(s
    ? { heading: "Stewardship priority", text: `${s.title} (${s.status}${s.due ? `, due ${s.due.slice(0, 10)}` : ""})`, href: `/projects/${s.pid}?tab=capital#integrity` }
    : { heading: "Stewardship priority", text: "No stewardship obligations recorded yet.", href: null });
  const recent = await db.select({ id: policyDecisions.id }).from(policyDecisions).where(and(inArray(policyDecisions.mandateId, mandateIds), gte(policyDecisions.createdAt, since))).limit(1);
  if (!recent.length && !risk && !m) items.unshift({ heading: "Today", text: "Little changed in the last 24 hours.", href: null });
  return items;
}
