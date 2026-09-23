import { asc, desc, eq, sql } from "drizzle-orm";
import { jobs, jobSchedules, mandateMembers, mandates, oauthAccounts } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { getState } from "@/lib/state";

export async function listMembers(scope: Scope) {
  return appDb().select({
    id: mandateMembers.id,
    email: mandateMembers.email,
    role: mandateMembers.role,
    bound: sql<number>`${mandateMembers.userId} IS NOT NULL`,
    mandate: mandates.name,
    mandateId: mandates.id,
  }).from(mandateMembers)
    .innerJoin(mandates, eq(mandates.id, mandateMembers.mandateId))
    .where(mandateCondition(scope, mandateMembers.mandateId))
    .orderBy(asc(mandates.name), asc(mandateMembers.email));
}

export async function listConnections() {
  // Tokens are never selected here.
  return appDb().select({
    mailboxRole: oauthAccounts.mailboxRole,
    email: oauthAccounts.email,
    scopes: oauthAccounts.scopes,
    dailyCap: oauthAccounts.dailyCap,
    warmupStartedOn: oauthAccounts.warmupStartedOn,
    pausedUntil: oauthAccounts.pausedUntil,
    updatedAt: oauthAccounts.updatedAt,
  }).from(oauthAccounts);
}

export async function jobsOverview() {
  const db = appDb();
  const [counts, recent, schedules, lastTick, lastHeartbeat] = await Promise.all([
    db.select({ status: jobs.status, n: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status),
    db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(25),
    db.select().from(jobSchedules).orderBy(asc(jobSchedules.jobType)),
    getState(db, "last_tick_at"),
    getState(db, "last_heartbeat_at"),
  ]);
  return {
    counts: Object.fromEntries(counts.map(c => [c.status, c.n])) as Record<string, number>,
    recent, schedules, lastTick, lastHeartbeat,
    stale: isStale(lastTick),
  };
}

const STALE_TICK_MS = 30 * 60_000;
const isStale = (lastTick: string | null, now = Date.now()) => !lastTick || now - new Date(lastTick).getTime() > STALE_TICK_MS;

/** Watchdog (SPEC section 23): automation is considered paused after 30 minutes without a tick. */
export async function schedulerStatus(): Promise<{ lastTick: string | null; stale: boolean }> {
  const lastTick = await getState(appDb(), "last_tick_at");
  return { lastTick, stale: isStale(lastTick) };
}
