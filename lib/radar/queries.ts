// Read models for the Searches screen. Saved searches and results are mandate-scoped; list sources are system data.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { listEntries, listSources, organizations, savedSearches, searchResults, segments } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";

export async function savedSearchList(scope: Scope) {
  const newCount = sql<number>`(select count(*) from ${searchResults} r where r.saved_search_id = ${savedSearches.id} and r.status = 'new')`;
  return appDb().select({ s: savedSearches, segment: segments.name, newCount }).from(savedSearches)
    .leftJoin(segments, eq(segments.id, savedSearches.segmentId))
    .where(mandateCondition(scope, savedSearches.mandateId)).orderBy(asc(savedSearches.kind), asc(savedSearches.name));
}

export async function searchResultsFor(scope: Scope, savedSearchId?: string) {
  return appDb().select({ r: searchResults, searchName: savedSearches.name }).from(searchResults)
    .innerJoin(savedSearches, eq(savedSearches.id, searchResults.savedSearchId))
    .where(and(mandateCondition(scope, searchResults.mandateId), eq(searchResults.status, "new"), savedSearchId ? eq(searchResults.savedSearchId, savedSearchId) : undefined))
    .orderBy(desc(searchResults.foundAt)).limit(200);
}

export async function listOverview() {
  const db = appDb();
  const sources = await db.select().from(listSources).orderBy(asc(listSources.key));
  const recent = await db.select({ e: listEntries, orgName: organizations.name }).from(listEntries)
    .leftJoin(organizations, eq(organizations.id, listEntries.orgId))
    .where(eq(listEntries.isNew, true)).orderBy(desc(listEntries.firstSeenAt)).limit(150);
  const tracked = await db.select({ key: listEntries.sourceKey, n: sql<number>`count(*)` }).from(listEntries).groupBy(listEntries.sourceKey);
  return { sources, recent, tracked: Object.fromEntries(tracked.map(t => [t.key, t.n])) as Record<string, number> };
}
