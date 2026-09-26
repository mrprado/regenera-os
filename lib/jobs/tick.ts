import { ensureRulesAndGates } from "@/lib/events/engine";
import { ensurePlaybooks } from "@/lib/playbooks/engine";
import type { Db } from "@/db";
import { inArray } from "drizzle-orm";
import { triggerQueries } from "@/db/schema";
import { ensureInvestmentMandates } from "@/lib/mandates";
import { ensureListSources } from "@/lib/radar/lists";
import { ensureSavedSearches } from "@/lib/radar/saved-searches";
import { ensureRegeneraMandate, REGENERA_MANDATE_ID } from "@/lib/membership";
import { ensureSequences } from "@/lib/outreach/sequences";
import { ensurePrompts } from "@/lib/ai/run";
import { ensureSegments } from "@/lib/segments";
import { getState, setState } from "@/lib/state";
import { ensureTriggerQueries } from "@/lib/triggers/queries";
import { DEFAULT_SCHEDULES, handlers as defaultHandlers, type JobHandler } from "./handlers";
import { claim, complete, fail, reclaimStale } from "./queue";
import { ensureSchedules, materializeDue } from "./schedules";
import { ensureIntegrations } from "@/lib/integrations/engine";

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
  skipReferenceData?: boolean;
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
  if (!opts.skipReferenceData) await ensureReferenceData(db);
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

const REFERENCE_VERSION = "2026-09-26.3";

/** Seeds segments, prompts and trigger queries once per code version (cheap no-op afterwards). */
export async function ensureReferenceData(db: Db): Promise<void> {
  if ((await getState(db, "reference_version")) === REFERENCE_VERSION) return;
  await ensureSegments(db);
  await ensurePrompts(db);
  await ensureTriggerQueries(db);
  await ensureIntegrations(db);
  await ensureRegeneraMandate(db);
  await ensureInvestmentMandates(db);
  await ensureSequences(db, REGENERA_MANDATE_ID);
  await ensureSavedSearches(db, REGENERA_MANDATE_ID);
  await ensurePlaybooks(db, REGENERA_MANDATE_ID);
  await ensureRulesAndGates(db, REGENERA_MANDATE_ID);
  await ensureListSources(db);
  // Phase 5: EU TED and World Bank tenders now live in Funding, not Triggers.
  await db.update(triggerQueries).set({ enabled: false }).where(inArray(triggerQueries.source, ["ted", "worldbank"]));
  await setState(db, "reference_version", REFERENCE_VERSION);
}
