// Home: what needs Prado now (SPEC section 11). Mandate-scoped counts and short lists.
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { activities, deals, dossiers, jobs, organizations, signals, triggers } from "@/db/schema";
import { spentThisMonth } from "@/lib/ai/run";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { freshnessSince } from "@/lib/freshness";
import { creditsUsedThisMonth } from "@/lib/sources/apollo";

export async function homeData(scope: Scope, now = new Date()) {
  const db = appDb();
  const today = now.toISOString().slice(0, 10);
  const since = freshnessSince(now).toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const openStages = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion"] as const;

  const [
    [{ newInquiries }], [{ newTriggers }], [{ dossiersReady }], [{ noNext }], [{ overdue }], [{ awaitingAi }], [{ dead }],
    topTriggers, dueDeals, recentInquiries, aiSpend, apolloCredits,
  ] = await Promise.all([
    db.select({ newInquiries: sql<number>`count(*)` }).from(activities).where(and(mandateCondition(scope, activities.mandateId), inArray(activities.type, ["site_inquiry", "referral"]), gte(activities.occurredAt, weekAgo))),
    db.select({ newTriggers: sql<number>`count(*)` }).from(triggers).where(and(mandateCondition(scope, triggers.mandateId), eq(triggers.status, "new"), gte(triggers.eventDate, since))),
    db.select({ dossiersReady: sql<number>`count(*)` }).from(dossiers).where(and(mandateCondition(scope, dossiers.mandateId), eq(dossiers.status, "ready"), gte(dossiers.refreshedAt, weekAgo))),
    db.select({ noNext: sql<number>`count(*)` }).from(deals).where(and(mandateCondition(scope, deals.mandateId), isNull(deals.archivedAt), inArray(deals.stage, [...openStages]), or(isNull(deals.nextAction), eq(deals.nextAction, "")))),
    db.select({ overdue: sql<number>`count(*)` }).from(deals).where(and(mandateCondition(scope, deals.mandateId), isNull(deals.archivedAt), inArray(deals.stage, [...openStages]), lt(deals.nextActionDate, today))),
    db.select({ awaitingAi: sql<number>`count(*)` }).from(signals).where(and(eq(signals.status, "new"), gte(signals.publishedAt, freshnessSince(now).toISOString()))),
    db.select({ dead: sql<number>`count(*)` }).from(jobs).where(eq(jobs.status, "dead")),
    db.select({ id: triggers.id, summary: triggers.summary, type: triggers.type, urgency: triggers.urgency, relevance: triggers.relevance, eventDate: triggers.eventDate, orgId: organizations.id, orgName: organizations.name })
      .from(triggers).leftJoin(organizations, eq(organizations.id, triggers.orgId))
      .where(and(mandateCondition(scope, triggers.mandateId), eq(triggers.status, "new"), gte(triggers.eventDate, since)))
      .orderBy(desc(triggers.urgency), desc(triggers.relevance)).limit(5),
    db.select({ id: deals.id, name: deals.name, stage: deals.stage, nextAction: deals.nextAction, nextActionDate: deals.nextActionDate, orgId: deals.orgId })
      .from(deals).where(and(mandateCondition(scope, deals.mandateId), isNull(deals.archivedAt), inArray(deals.stage, [...openStages])))
      .orderBy(sql`coalesce(${deals.nextActionDate}, '0000')`).limit(6),
    db.select({ id: activities.id, detail: activities.detail, occurredAt: activities.occurredAt, dealId: activities.dealId, type: activities.type })
      .from(activities).where(and(mandateCondition(scope, activities.mandateId), inArray(activities.type, ["site_inquiry", "referral"])))
      .orderBy(desc(activities.occurredAt)).limit(5),
    spentThisMonth(db, now),
    creditsUsedThisMonth(db, now),
  ]);
  return { newInquiries, newTriggers, dossiersReady, noNext, overdue, awaitingAi, dead, topTriggers, dueDeals, recentInquiries, aiSpend, apolloCredits, today };
}
