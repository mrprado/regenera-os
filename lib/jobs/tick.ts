import type { Db } from "@/db";
import { setState } from "@/lib/state";
import { DEFAULT_SCHEDULES, handlers as defaultHandlers, type JobHandler } from "./handlers";
import { claim, complete, fail, reclaimStale } from "./queue";
import { ensureSchedules, materializeDue } from "./schedules";

export type TickResult = { scheduled: number; ran: number; retried: number; dead: number; stoppedForBudget: boolean };

/**
 * One scheduler tick (SPEC section 23): materialize due schedules, then run claimed jobs until
 * the time budget is spent. Unfinished work stays queued for the next tick.
 */
export async function tick(db: Db, opts: {
  now?: () => Date;
  budgetMs?: number;
  batch?: number;
  lockMs?: number;
  handlers?: Record<string, JobHandler>;
  schedules?: Record<string, string>;
} = {}): Promise<TickResult> {
  const now = opts.now ?? (() => new Date());
  const handlers = opts.handlers ?? defaultHandlers;
  const budgetMs = opts.budgetMs ?? 25_000;
  const lockMs = opts.lockMs ?? 120_000;
  const started = Date.now();
  const result: TickResult = { scheduled: 0, ran: 0, retried: 0, dead: 0, stoppedForBudget: false };

  await setState(db, "last_tick_at", now().toISOString());
  await reclaimStale(db, now());
  await ensureSchedules(db, opts.schedules ?? DEFAULT_SCHEDULES, now());
  result.scheduled = await materializeDue(db, now());

  while (true) {
    if (Date.now() - started > budgetMs) { result.stoppedForBudget = true; break; }
    const batch = await claim(db, now(), opts.batch ?? 5, lockMs);
    if (batch.length === 0) break;
    for (const job of batch) {
      const handler = handlers[job.type];
      try {
        if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
        await handler({ db, job, now: now() });
        await complete(db, job.id, now());
        result.ran++;
      } catch (error) {
        const outcome = await fail(db, job, error, now());
        if (outcome === "dead") result.dead++; else result.retried++;
      }
    }
  }
  return result;
}
