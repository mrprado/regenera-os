import type { Db } from "@/db";
import { AiBudgetError } from "@/lib/ai/run";
import { aiConfig } from "@/lib/config";
import { geocodeOrganization } from "@/lib/crm/geo";
import { freshnessSince } from "@/lib/freshness";
import { setState } from "@/lib/state";
import { classifyNewSignals, expireStaleSignals, readSignal, scanDueQueries } from "@/lib/triggers/engine";
import { enqueue, type Job } from "./queue";

export type JobContext = { db: Db; job: Job; now: Date };
export type JobHandler = (ctx: JobContext) => Promise<void>;

function requireAi() {
  const cfg = aiConfig();
  if (!cfg) throw new Error("ANTHROPIC_API_KEY is not set (docs/ENV.md)");
  return cfg;
}

/** Budget exhaustion is not a failure: the job waits until the next day instead of burning retries. */
async function deferOnBudget(ctx: JobContext, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof AiBudgetError)) throw error;
    await enqueue(ctx.db, ctx.job.type, ctx.job.payload, { runAfter: new Date(ctx.now.getTime() + 24 * 3_600_000), now: ctx.now });
  }
}

// One handler per job type (SPEC section 23).
export const handlers: Record<string, JobHandler> = {
  "system.heartbeat": async ({ db, now }) => {
    await setState(db, "last_heartbeat_at", now.toISOString());
  },
  "triggers.scan": async ({ db, now }) => {
    await expireStaleSignals(db, freshnessSince(now).toISOString());
    const r = await scanDueQueries(db, now);
    await setState(db, "last_trigger_scan", JSON.stringify({ at: now.toISOString(), ...r }));
  },
  "triggers.classify": async ctx => {
    await deferOnBudget(ctx, () => classifyNewSignals(ctx.db, requireAi(), 15, ctx.now));
  },
  "triggers.read": async ctx => {
    await deferOnBudget(ctx, () => readSignal(ctx.db, requireAi(), String(ctx.job.payload.signalId), ctx.now));
  },
  "geo.org": async ({ db, job, now }) => {
    const r = await geocodeOrganization(db, String(job.payload.orgId));
    if (r === "retry") await enqueue(db, "geo.org", job.payload, { runAfter: new Date(now.getTime() + 60_000), now });
  },
};

// Recurring jobs seeded at startup and editable later in Settings (SPEC section 23).
export const DEFAULT_SCHEDULES: Record<string, string> = {
  "system.heartbeat": "every:5m",
  "triggers.scan": "every:15m",
};
