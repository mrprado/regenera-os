import { env } from "cloudflare:workers";
import type { Db } from "@/db";
import { processImportChunk, r2Store } from "@/lib/import/process";
import { AiBudgetError } from "@/lib/ai/run";
import { aiConfig, siteConfig } from "@/lib/config";
import { reconcileSite } from "@/lib/crm/site-intake";
import { geocodeOrganization } from "@/lib/crm/geo";
import { enrichOrganizationIdentity } from "@/lib/crm/identity-enrich";
import { gatherStep, scoreContact, synthesizeStep } from "@/lib/crm/research";
import { freshnessSince } from "@/lib/freshness";
import { getState, setState } from "@/lib/state";
import { classifyNewSignals, expireStaleSignals, readSignal, scanDueQueries } from "@/lib/triggers/engine";
import { enqueue, type Job } from "./queue";

export type JobContext = { db: Db; job: Job; now: Date };
export type JobHandler = (ctx: JobContext) => Promise<void>;

class AiUnavailableError extends Error {}

function requireAi() {
  const cfg = aiConfig();
  if (!cfg) throw new AiUnavailableError("ANTHROPIC_API_KEY is not set (docs/ENV.md)");
  return cfg;
}

/**
 * A missing key or an exhausted monthly budget is not a failure: the job waits (6 h without a key,
 * 24 h over budget) instead of burning retries and landing in dead jobs.
 */
async function deferOnBudget(ctx: JobContext, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const wait = error instanceof AiBudgetError ? 24 : error instanceof AiUnavailableError ? 6 : 0;
    if (!wait) throw error;
    const runAfter = new Date(ctx.now.getTime() + wait * 3_600_000);
    await enqueue(ctx.db, ctx.job.type, ctx.job.payload, { runAfter, now: ctx.now, dedupeKey: `deferred:${ctx.job.type}:${JSON.stringify(ctx.job.payload)}:${runAfter.toISOString().slice(0, 13)}` });
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
    // Unread signals stay "new" and are picked up by the next classify run once a key exists.
    if (!aiConfig()) return;
    await deferOnBudget(ctx, () => classifyNewSignals(ctx.db, requireAi(), 15, ctx.now));
  },
  "triggers.read": async ctx => {
    await deferOnBudget(ctx, () => readSignal(ctx.db, requireAi(), String(ctx.job.payload.signalId), ctx.now));
  },
  "identity.enrich": async ({ db, job }) => {
    await enrichOrganizationIdentity(db, String(job.payload.orgId));
    await enqueue(db, "geo.org", { orgId: job.payload.orgId }, { dedupeKey: `geo:${job.payload.orgId}:identity` });
  },
  "research.gather": async ctx => {
    await deferOnBudget(ctx, () => gatherStep(ctx.db, requireAi(), String(ctx.job.payload.dossierId)));
  },
  "research.dossier": async ctx => {
    await deferOnBudget(ctx, () => synthesizeStep(ctx.db, requireAi(), String(ctx.job.payload.dossierId)));
  },
  "score.match": async ctx => {
    await deferOnBudget(ctx, () => scoreContact(ctx.db, requireAi(), String(ctx.job.payload.contactId)));
  },
  "site.reconcile": async ({ db, now }) => {
    const cfg = siteConfig();
    if (!cfg) return; // not connected yet (SITE_EXPORT_TOKEN)
    const since = (await getState(db, "site_reconcile_since")) ?? freshnessSince(now).toISOString();
    const r = await reconcileSite(db, cfg, since.slice(0, 19).replace("T", " "));
    await setState(db, "site_reconcile_since", new Date(now.getTime() - 3_600_000).toISOString());
    await setState(db, "site_reconcile_last", JSON.stringify({ at: now.toISOString(), ...r }));
  },
  "import.process": async ({ db, job }) => {
    if (!env.BUCKET) throw new Error("R2 binding BUCKET is not available");
    await processImportChunk(db, r2Store(env.BUCKET), String(job.payload.importId), Number(job.payload.offset ?? 0));
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
  "site.reconcile": "every:1h",
};
