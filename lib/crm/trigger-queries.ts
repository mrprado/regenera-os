// Read models for the Triggers screen. Mandate-scoped through mandateCondition.
import { and, desc, eq, gte, inArray, like, sql, type SQL } from "drizzle-orm";
import { organizations, signals, triggerQueries, triggers } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { freshnessSince } from "@/lib/freshness";

export type TriggerFilters = { type?: string; status?: string; source?: string; q?: string; minRelevance?: number };

export async function listTriggers(scope: Scope, f: TriggerFilters, now = new Date()) {
  const db = appDb();
  const conds: (SQL | undefined)[] = [
    mandateCondition(scope, triggers.mandateId),
    gte(triggers.eventDate, freshnessSince(now).toISOString().slice(0, 10)),
    f.type ? eq(triggers.type, f.type as never) : undefined,
    f.status ? eq(triggers.status, f.status as never) : inArray(triggers.status, ["new", "pursued", "watched"]),
    f.source ? eq(triggers.source, f.source) : undefined,
    f.minRelevance ? gte(triggers.relevance, f.minRelevance) : undefined,
    f.q ? like(sql`lower(${triggers.summary} || ' ' || coalesce(${organizations.name}, ''))`, `%${f.q.toLowerCase()}%`) : undefined,
  ];
  return db.select({
    id: triggers.id, type: triggers.type, summary: triggers.summary, eventDate: triggers.eventDate, urgency: triggers.urgency,
    relevance: triggers.relevance, source: triggers.source, sourceUrl: triggers.sourceUrl, status: triggers.status,
    decisionRead: triggers.decisionRead, suggested: triggers.suggestedEngagement, country: triggers.country,
    orgId: organizations.id, orgName: organizations.name, orgLocation: organizations.location,
  }).from(triggers).leftJoin(organizations, eq(organizations.id, triggers.orgId))
    .where(and(...conds))
    .orderBy(desc(triggers.urgency), desc(triggers.relevance), desc(triggers.eventDate))
    .limit(200);
}

export type SignalFilters = { source?: string; status?: string; q?: string };

/** Raw current signals (before or after AI classification). Signals are global, not mandate data. */
export async function listSignals(f: SignalFilters, now = new Date()) {
  const db = appDb();
  const conds: (SQL | undefined)[] = [
    gte(signals.publishedAt, freshnessSince(now).toISOString()),
    f.source ? eq(signals.source, f.source) : undefined,
    f.status ? eq(signals.status, f.status as never) : undefined,
    f.q ? like(sql`lower(${signals.title} || ' ' || coalesce(${signals.orgName}, '') || ' ' || coalesce(${signals.country}, ''))`, `%${f.q.toLowerCase()}%`) : undefined,
  ];
  return db.select().from(signals).where(and(...conds)).orderBy(desc(signals.publishedAt)).limit(300);
}

export async function triggerStats(scope: Scope, now = new Date()) {
  const db = appDb();
  const since = freshnessSince(now).toISOString();
  const bySource = await db.select({ source: signals.source, status: signals.status, n: sql<number>`count(*)` })
    .from(signals).where(gte(signals.publishedAt, since)).groupBy(signals.source, signals.status);
  const [{ open }] = await db.select({ open: sql<number>`count(*)` }).from(triggers)
    .where(and(mandateCondition(scope, triggers.mandateId), inArray(triggers.status, ["new", "pursued", "watched"]), gte(triggers.eventDate, since.slice(0, 10))));
  const queries = await db.select().from(triggerQueries).orderBy(triggerQueries.source, triggerQueries.label);
  return { bySource, open, queries };
}
