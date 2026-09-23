// D1-backed job queue (SPEC section 23). Claims are single atomic UPDATE ... RETURNING statements,
// so overlapping ticks can never run the same job twice.
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs } from "@/db/schema";

export type Job = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
};

type JobRow = { id: string; type: string; payload: string; attempts: number; max_attempts: number; run_after: string };

const iso = (d: Date) => d.toISOString();

export async function enqueue(db: Db, type: string, payload: Record<string, unknown> = {}, opts: {
  runAfter?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
  now?: Date;
} = {}): Promise<void> {
  await db.insert(jobs).values({
    type,
    payload,
    runAfter: iso(opts.runAfter ?? opts.now ?? new Date()),
    dedupeKey: opts.dedupeKey ?? null,
    maxAttempts: opts.maxAttempts ?? 5,
  }).onConflictDoNothing();
}

/** Returns jobs whose lock expired (worker died mid-run) to the queue. */
export async function reclaimStale(db: Db, now: Date): Promise<void> {
  await db.run(sql`UPDATE jobs SET status = 'queued', locked_until = NULL, updated_at = ${iso(now)}
    WHERE status = 'running' AND locked_until < ${iso(now)}`);
}

export async function claim(db: Db, now: Date, limit: number, lockMs: number): Promise<Job[]> {
  const rows = await db.all<JobRow>(sql`UPDATE jobs
    SET status = 'running', attempts = attempts + 1, locked_until = ${iso(new Date(now.getTime() + lockMs))}, updated_at = ${iso(now)}
    WHERE id IN (
      SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ${iso(now)} ORDER BY run_after LIMIT ${limit}
    ) AND status = 'queued'
    RETURNING id, type, payload, attempts, max_attempts, run_after`);
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    payload: JSON.parse(r.payload),
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: r.run_after,
  }));
}

export async function complete(db: Db, id: string, now: Date): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedUntil: null, lastError: null, updatedAt: iso(now) }).where(eq(jobs.id, id));
}

/** Backoff: 30s, 1m, 2m, 4m ... capped at 1h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

export async function fail(db: Db, job: Job, error: unknown, now: Date): Promise<"retry" | "dead"> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const dead = job.attempts >= job.maxAttempts;
  await db.update(jobs).set({
    status: dead ? "dead" : "queued",
    lockedUntil: null,
    lastError: message,
    runAfter: dead ? job.runAfter : iso(new Date(now.getTime() + backoffMs(job.attempts))),
    updatedAt: iso(now),
  }).where(eq(jobs.id, job.id));
  return dead ? "dead" : "retry";
}

/** Manual retry from Settings: resets attempts and queues immediately. */
export async function retryDead(db: Db, id: string, now: Date): Promise<void> {
  await db.run(sql`UPDATE jobs SET status = 'queued', attempts = 0, run_after = ${iso(now)}, locked_until = NULL, updated_at = ${iso(now)}
    WHERE id = ${id} AND status = 'dead'`);
}
