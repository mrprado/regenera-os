// What the queue and each scheduled job actually did (phase 16 §10). A schedule's last_run_at is when a job was QUEUED;
// success is a job reaching "done". Readiness and Settings → Jobs read this, so "configured" or "queued" never shows as
// "working". Expired leases are reclaimed by the tick (lib/jobs/queue.ts reclaimStale); this only reports them.
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs, jobSchedules } from "@/db/schema";
import { chunk } from "@/lib/db/chunk";

export type QueueHealth = {
  dueWaiting: number; oldestDueAt: string | null; running: number; expiredLeases: number; retrying: number; dead: number;
};
export type ScheduleHealth = {
  jobType: string; cadence: string; enabled: boolean; nextRunAt: string; lastQueuedAt: string | null;
  lastCompletedAt: string | null; lastFailedAt: string | null; lastError: string | null; waiting: number;
  state: "ok" | "never" | "failing" | "overdue" | "paused";
};

export async function queueHealth(db: Db, now = new Date()): Promise<QueueHealth> {
  const t = now.toISOString();
  const [[due], [running], [expired], [retrying], [dead]] = await Promise.all([
    db.select({ n: sql<number>`count(*)`, oldest: sql<string | null>`min(${jobs.runAfter})` }).from(jobs).where(and(eq(jobs.status, "queued"), lt(jobs.runAfter, t))),
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(eq(jobs.status, "running")),
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.status, "running"), lt(jobs.lockedUntil, t))),
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.status, "queued"), sql`${jobs.attempts} > 0`)),
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(eq(jobs.status, "dead")),
  ]);
  return { dueWaiting: due?.n ?? 0, oldestDueAt: due?.oldest ?? null, running: running?.n ?? 0, expiredLeases: expired?.n ?? 0, retrying: retrying?.n ?? 0, dead: dead?.n ?? 0 };
}

/** Per schedule: when it was last queued, last completed, last failed, and whether it is keeping up. */
export async function scheduleHealth(db: Db, now = new Date()): Promise<ScheduleHealth[]> {
  const schedules = await db.select().from(jobSchedules);
  const types = schedules.map(s => s.jobType);
  const done = new Map<string, string>(), failed = new Map<string, { at: string; error: string | null }>(), waiting = new Map<string, number>();
  for (const part of chunk(types, 80)) {
    if (!part.length) continue;
    for (const r of await db.select({ type: jobs.type, at: sql<string>`max(${jobs.updatedAt})` }).from(jobs).where(and(inArray(jobs.type, part), eq(jobs.status, "done"))).groupBy(jobs.type)) done.set(r.type, r.at);
    // A failure is a dead job, or a queued job waiting to retry after a recorded error. A job put back after an expired
    // lease (attempted, no error) is not a failure.
    for (const r of await db.select({ type: jobs.type, at: jobs.updatedAt, error: jobs.lastError }).from(jobs)
      .where(and(inArray(jobs.type, part), sql`(${jobs.status} = 'dead' OR (${jobs.status} = 'queued' AND ${jobs.attempts} > 0 AND ${jobs.lastError} IS NOT NULL))`))) {
      const cur = failed.get(r.type);
      if (!cur || r.at > cur.at) failed.set(r.type, { at: r.at, error: r.error });
    }
    for (const r of await db.select({ type: jobs.type, n: sql<number>`count(*)` }).from(jobs).where(and(inArray(jobs.type, part), eq(jobs.status, "queued"))).groupBy(jobs.type)) waiting.set(r.type, r.n);
  }
  return schedules.map(s => {
    const lastCompletedAt = done.get(s.jobType) ?? null;
    const f = failed.get(s.jobType);
    const lastFailedAt = f?.at ?? null;
    // Overdue: queued more than an hour ago and nothing completed since.
    const overdue = !!s.lastRunAt && (!lastCompletedAt || lastCompletedAt < s.lastRunAt) && now.getTime() - new Date(s.lastRunAt).getTime() > 3_600_000;
    const state: ScheduleHealth["state"] = !s.enabled ? "paused"
      : lastFailedAt && (!lastCompletedAt || lastFailedAt > lastCompletedAt) ? "failing"
        : overdue ? "overdue" : !lastCompletedAt ? "never" : "ok";
    return { jobType: s.jobType, cadence: s.cadence, enabled: s.enabled, nextRunAt: s.nextRunAt, lastQueuedAt: s.lastRunAt, lastCompletedAt, lastFailedAt, lastError: f?.error ?? null, waiting: waiting.get(s.jobType) ?? 0, state };
  });
}
