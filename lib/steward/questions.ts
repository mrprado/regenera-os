// Steward questions for Ask the OS and MCP (phase 28D). Answers come from scoped records with reproducible rules; they
// return place, project and action names and counts, never governed knowledge content or restricted records.
import { and, eq, inArray, like, lte, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { careActions, carePlans, consentRecords, knowledgeRecords, projects, stewardIndicators, stewardMeasurements, stewardPlaceLinks, stewardPlaces, stewardSourceRecords, stewardSources, stewardshipBudgets, tasks } from "@/db/schema";
import { mandateCondition, type UserScope } from "@/lib/db/scoped";
import { canStartAction } from "./engine";

export async function stewardQuestion(db: Db, scope: UserScope, q: string, now: Date) {
  const today = now.toISOString().slice(0, 10), monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const places = await db.select({ id: stewardPlaces.id, name: stewardPlaces.name }).from(stewardPlaces).where(mandateCondition(scope, stewardPlaces.mandateId));
  const pids = places.map(p => p.id).length ? places.map(p => p.id) : ["-"];
  const name = (id: string) => places.find(p => p.id === id)?.name ?? "a place";
  switch (q) {
    case "projects_without_stewardship_budget": {
      const linked = await db.select({ projectId: stewardPlaceLinks.entityId, placeId: stewardPlaceLinks.placeId }).from(stewardPlaceLinks).where(and(inArray(stewardPlaceLinks.placeId, pids), eq(stewardPlaceLinks.entityType, "project")));
      const budgeted = new Set((await db.select({ placeId: stewardshipBudgets.placeId }).from(stewardshipBudgets).where(inArray(stewardshipBudgets.placeId, pids))).map(b => b.placeId));
      const all = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), sql`${projects.archivedAt} is null`));
      const withBudget = new Set(linked.filter(l => budgeted.has(l.placeId)).map(l => l.projectId));
      const withPlace = new Set(linked.map(l => l.projectId));
      return { rule: "Project linked to a Steward place that has a budget record", withoutPlace: all.filter(p => !withPlace.has(p.id)).map(p => p.name).slice(0, 50), placeButNoBudget: all.filter(p => withPlace.has(p.id) && !withBudget.has(p.id)).map(p => p.name) };
    }
    case "places_with_stale_baseline": {
      const cutoff = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
      const latest = await db.select({ placeId: stewardIndicators.placeId, last: sql<string>`max(${stewardMeasurements.periodStart})` }).from(stewardMeasurements).innerJoin(stewardIndicators, eq(stewardIndicators.id, stewardMeasurements.indicatorId)).where(inArray(stewardIndicators.placeId, pids)).groupBy(stewardIndicators.placeId);
      return { rule: "No measurement at all, or latest measurement older than 12 months", noMeasurement: places.filter(p => !latest.some(l => l.placeId === p.id)).map(p => p.name), stale: latest.filter(l => l.last < cutoff).map(l => ({ place: name(l.placeId), latest: l.last })) };
    }
    case "reviews_due_this_month": {
      const [consent, plans, knowledge] = await Promise.all([
        db.select({ id: consentRecords.id }).from(consentRecords).where(and(mandateCondition(scope, consentRecords.mandateId), lte(consentRecords.reviewDate, monthEnd))),
        db.select({ title: carePlans.title, placeId: carePlans.placeId, reviewDate: carePlans.reviewDate }).from(carePlans).where(and(inArray(carePlans.placeId, pids), lte(carePlans.reviewDate, monthEnd))),
        db.select({ id: knowledgeRecords.id }).from(knowledgeRecords).where(and(mandateCondition(scope, knowledgeRecords.mandateId), lte(knowledgeRecords.reviewDate, monthEnd))),
      ]);
      return { by: monthEnd, consentReviews: consent.length, carePlanReviews: plans.map(p => ({ plan: p.title, place: name(p.placeId), date: p.reviewDate })), knowledgePermissionReviews: knowledge.length, note: "Knowledge records are counted only; their content is governed and not shown here." };
    }
    case "findings_on_revised_or_failing_sources": {
      const [revised, failing] = await Promise.all([
        db.select({ placeId: stewardSourceRecords.placeId, source: stewardSourceRecords.sourceKey, n: sql<number>`count(*)` }).from(stewardSourceRecords).where(and(inArray(stewardSourceRecords.placeId, pids), sql`${stewardSourceRecords.revision} > 1`)).groupBy(stewardSourceRecords.placeId, stewardSourceRecords.sourceKey),
        db.select({ key: stewardSources.key, name: stewardSources.name, health: stewardSources.health }).from(stewardSources).where(eq(stewardSources.health, "failing")),
      ]);
      return { revisedRecords: revised.map(r => ({ place: name(r.placeId), source: r.source, records: r.n })), failingSources: failing, note: "Revised records were changed by the provider since first stored; findings built on them need review." };
    }
    case "actions_blocked_by_permissions": {
      const open = await db.select({ id: careActions.id, title: careActions.title, planId: careActions.planId }).from(careActions).where(and(mandateCondition(scope, careActions.mandateId), notInArray(careActions.status, ["done", "cancelled"]), sql`${careActions.requiresKnowledgeId} is not null`));
      const out = [];
      for (const a of open.slice(0, 40)) { const c = await canStartAction(db, a.id, now); if (!c.ok) out.push({ action: a.title, reasons: c.reasons }); }
      return { blocked: out };
    }
    case "groundwater_evidence_gaps": {
      const open = await db.select({ title: tasks.title, dueAt: tasks.dueAt }).from(tasks).where(and(mandateCondition(scope, tasks.mandateId), eq(tasks.status, "open"), like(tasks.workstream, "steward:%:mx_karst"), ne(tasks.testRecord, true)));
      return { rule: "Karst places with an open request for local hydrogeological evidence", open: open.map(t => ({ request: t.title, due: t.dueAt.slice(0, 10) })), asOf: today };
    }
  }
  return { error: "Unknown question" };
}
