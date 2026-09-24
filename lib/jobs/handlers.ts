import { env } from "cloudflare:workers";
import type { Db } from "@/db";
import { processImportChunk, r2Store } from "@/lib/import/process";
import { AiBudgetError } from "@/lib/ai/run";
import { aiConfig, apolloConfig, outreachConfig, sendPolicy, siteConfig } from "@/lib/config";
import { listSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runListSource } from "@/lib/radar/lists";
import { dueSavedSearches, runSavedSearch } from "@/lib/radar/saved-searches";
import { buildWeeklyReport, renderWeekly, type WeeklyBody } from "@/lib/reports/weekly";
import type { Metrics } from "@/lib/reports/metrics";
import { reports } from "@/db/schema";
import { oauthAccounts } from "@/db/schema";
import { getAccessToken } from "@/lib/google/accounts";
import { googleConfig } from "@/lib/google/config";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { listEvents, queueDueBriefs, syncCalendarEvents, writeBrief } from "@/lib/outreach/calendar";
import { runDeliverability } from "@/lib/outreach/deliverability";
import { buildDigest, renderDigest, sendViaResend } from "@/lib/outreach/digest";
import { syncRelationships } from "@/lib/outreach/relationships";
import { classifyReply, draftResponse, watchReplies } from "@/lib/outreach/replies";
import { runSender, type MailboxRoleName } from "@/lib/outreach/sender";
import { draftEnrollment } from "@/lib/outreach/sequences";
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

/** Connected Google mailboxes, with a token getter. Empty until Google OAuth is configured and connected. */
async function mailboxes(db: Db) {
  const g = googleConfig();
  if (!g) return null;
  const rows = await db.select({ role: oauthAccounts.mailboxRole, email: oauthAccounts.email }).from(oauthAccounts);
  const roles = rows.map(r => r.role).filter((r): r is MailboxRoleName => r === "primary" || r === "sending");
  return { roles, emails: Object.fromEntries(rows.map(r => [r.role, r.email])), getToken: (role: MailboxRoleName) => getAccessToken(db, g, role) };
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

  // ---------- phase 2: automation ----------
  "outreach.draft": async ctx => {
    await deferOnBudget(ctx, () => draftEnrollment(ctx.db, requireAi(), String(ctx.job.payload.enrollmentId), {
      angleHint: ctx.job.payload.angleHint ? String(ctx.job.payload.angleHint) : undefined,
      onlyStep: ctx.job.payload.onlyStep === undefined ? undefined : Number(ctx.job.payload.onlyStep),
    }));
  },
  "outreach.send": async ({ db, now }) => {
    const mb = await mailboxes(db);
    if (!mb || mb.roles.length === 0) return; // nothing connected: approved messages wait
    const cfg = outreachConfig();
    const r = await runSender(db, { policy: sendPolicy(), getToken: mb.getToken, unsubscribe: cfg.unsubscribe, caps: cfg.caps, now });
    if (r.sent || r.failed) await setState(db, "last_send_run", JSON.stringify({ at: now.toISOString(), ...r }));
  },
  "replies.watch": async ({ db, now }) => {
    const mb = await mailboxes(db);
    if (!mb || mb.roles.length === 0) return;
    const n = await watchReplies(db, { roles: mb.roles, getToken: mb.getToken, now });
    await setState(db, "last_reply_watch", JSON.stringify({ at: now.toISOString(), stored: n }));
  },
  "reply.classify": async ctx => {
    await deferOnBudget(ctx, () => classifyReply(ctx.db, requireAi(), String(ctx.job.payload.replyId), undefined, ctx.now));
  },
  "reply.respond": async ctx => {
    await deferOnBudget(ctx, () => draftResponse(ctx.db, requireAi(), String(ctx.job.payload.replyId), outreachConfig().bookingUrl));
  },
  "calendar.sync": async ({ db, now }) => {
    const mb = await mailboxes(db);
    if (!mb || !mb.roles.includes("primary")) return;
    const { accessToken, email } = await mb.getToken("primary");
    const events = await listEvents(accessToken, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 14 * 86_400_000));
    const matched = await syncCalendarEvents(db, events, email, now);
    const briefs = await queueDueBriefs(db, now);
    await setState(db, "last_calendar_sync", JSON.stringify({ at: now.toISOString(), events: events.length, matched, briefs }));
  },
  "meeting.brief": async ctx => {
    await deferOnBudget(ctx, () => writeBrief(ctx.db, requireAi(), String(ctx.job.payload.briefId)));
  },
  "relationships.sync": async ({ db, now }) => {
    const mb = await mailboxes(db);
    if (!mb) return;
    const cfg = outreachConfig();
    const own = [cfg.primaryDomain, cfg.sendingDomain].filter((d): d is string => !!d);
    for (const role of mb.roles) {
      const { accessToken, email } = await mb.getToken(role);
      await syncRelationships(db, { mandateId: REGENERA_MANDATE_ID, accessToken, mailbox: email, ownDomains: own, now });
    }
  },
  "deliverability.check": async ({ db, now }) => {
    const cfg = outreachConfig();
    const domains: { domain: string; role: MailboxRoleName }[] = [{ domain: cfg.primaryDomain, role: "primary" }];
    if (cfg.sendingDomain) domains.push({ domain: cfg.sendingDomain, role: "sending" });
    await runDeliverability(db, { domains, now });
  },
  // ---------- phase 3: radar and reach ----------
  "searches.run": async ({ db, now }) => {
    const cfg = apolloConfig();
    if (!cfg) return;
    // A few per run keeps well inside Apollo's free per-minute and per-hour search limits.
    for (const s of (await dueSavedSearches(db, now)).slice(0, 3)) await runSavedSearch(db, cfg, s.id, now);
  },
  "lists.diff": async ({ db, now }) => {
    const sources = await db.select({ key: listSources.key }).from(listSources).where(eq(listSources.enabled, true));
    for (const src of sources) await enqueue(db, "lists.diff.source", { key: src.key }, { dedupeKey: `listdiff:${src.key}:${now.toISOString().slice(0, 10)}`, now });
  },
  "lists.diff.source": async ({ db, job, now }) => {
    await runListSource(db, String(job.payload.key), REGENERA_MANDATE_ID, now);
  },
  "reports.weekly": async ({ db, now }) => {
    const r = await buildWeeklyReport(db, aiConfig(), REGENERA_MANDATE_ID, now);
    const cfg = outreachConfig();
    if (!r?.body || !cfg.resend || r.emailedAt) return;
    await sendViaResend(cfg.resend, renderWeekly({ periodStart: r.periodStart, periodEnd: r.periodEnd, body: r.body as WeeklyBody, metrics: r.metrics as unknown as Metrics }, cfg.appBaseUrl));
    await db.update(reports).set({ emailedAt: now.toISOString() }).where(eq(reports.id, r.id));
  },
  "digest.daily": async ({ db, now }) => {
    const cfg = outreachConfig();
    const digest = await buildDigest(db, now);
    await setState(db, "last_digest", JSON.stringify(digest));
    if (!cfg.resend) return; // stored for Home; emailed once Resend is configured
    await sendViaResend(cfg.resend, renderDigest(digest, cfg.appBaseUrl));
  },
};

// Recurring jobs seeded at startup and editable later in Settings (SPEC section 23).
export const DEFAULT_SCHEDULES: Record<string, string> = {
  "system.heartbeat": "every:5m",
  "triggers.scan": "every:15m",
  "site.reconcile": "every:1h",
  "outreach.send": "every:5m",
  "replies.watch": "every:10m",
  "calendar.sync": "every:30m",
  "relationships.sync": "every:1h",
  "deliverability.check": "daily:06:00",
  "digest.daily": "daily:07:00",
  "searches.run": "every:1h",
  "lists.diff": "monthly:2:05:00",
  "reports.weekly": "weekly:mon:07:30",
};
