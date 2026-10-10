import { dispatchEvents } from "@/lib/events/engine";
import { expireBrokerRecords } from "@/lib/portal/broker";
import { env } from "cloudflare:workers";
import type { Db } from "@/db";
import { processImportChunk, r2Store } from "@/lib/import/process";
import { AI_PAUSE_KEY, AiBudgetError, aiPausedUntil, isCreditError } from "@/lib/ai/run";
import { notifications } from "@/db/schema";
import { readFundingByRules } from "@/lib/funding/rules-read";
import { classifyByRules } from "@/lib/triggers/rules";
import { autoPlaceProjects } from "@/lib/projects/auto-place";
import { ingestGppd } from "@/lib/infrastructure/gppd";
import { runWbLoop } from "@/lib/intel/wb-projects";
import { matchFundingToProjects } from "@/lib/funding/project-match";
import { generateGapTheses, generateHypotheses, syncOriginationQueue } from "@/lib/origination/engine";
import { screenDue } from "@/lib/integrity/engine";
import { stewardshipDue } from "@/lib/integrity/stewardship";
import { dueSourceRuns, runSourceForPlace, syncSourceRegister } from "@/lib/steward/sources/pipeline";
import { aiConfig, apolloConfig, outreachConfig, sendPolicy, siteConfig } from "@/lib/config";
import { capitalOpportunities, listSources, organizations } from "@/db/schema";
import { eq, ne } from "drizzle-orm";
import { runListSource } from "@/lib/radar/lists";
import { dueSavedSearches, runSavedSearch } from "@/lib/radar/saved-searches";
import { draftPlaybookTemplates } from "@/lib/radar/playbooks";
import { r2BackupStore, runBackup, verifyLatestBackup } from "@/lib/backup";
import { placeFunding, readFunding, scanFunding } from "@/lib/funding/engine";
import { draftProposal } from "@/lib/funding/bids";
import { ensureCaseRecords, ladderSummary, proposeOutreachChanges, proposeWeights } from "@/lib/learning/loop";
import { savedSearches } from "@/db/schema";
import { and as andOp, asc as ascOp, inArray as inArrayOp } from "drizzle-orm";
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
import { LIST_KEYS, refreshList, type ListKey } from "@/lib/sanctions/engine";
import { checkCompaniesHouse, dueRegistryChecks } from "@/lib/registry/companies-house";
import { runScanJob } from "@/lib/scan/engine";
import { expireQualifications, runMatches } from "@/lib/capital/engine";
import { expirePermissions } from "@/lib/community/engine";
import { continueAbandonedRuns } from "@/lib/site-intel/engine";
import { expirePermits } from "@/lib/regulatory/engine";
import { buildPlaceProfile, projectsNeedingPlace } from "@/lib/place/engine";
import { syncQueue } from "@/lib/mandates/queues";
import { buildUniverseSlice, getWork, mandateAutomation, setWork, signalsFromQueueChanges } from "@/lib/mandates/engine";
import { commercialMandates } from "@/db/schema";

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
    // No credit on the Anthropic account: pause every AI job for an hour (one notification per pause) instead of
    // burning five retries into dead jobs. The rules reads keep signals and funding moving meanwhile.
    if (isCreditError(error)) {
      const until = new Date(ctx.now.getTime() + 3_600_000).toISOString();
      const wasPaused = await aiPausedUntil(ctx.db, ctx.now);
      await setState(ctx.db, AI_PAUSE_KEY, until);
      await setState(ctx.db, "ai_paused_reason", (error as Error).message.slice(0, 300));
      if (!wasPaused && !(await getState(ctx.db, "ai_credit_notified_" + ctx.now.toISOString().slice(0, 10)))) {
        await setState(ctx.db, "ai_credit_notified_" + ctx.now.toISOString().slice(0, 10), "1");
        await ctx.db.insert(notifications).values({ mandateId: REGENERA_MANDATE_ID, category: "system", priority: "critical", title: "AI paused: the Anthropic account has no credit", body: "Funding reads, signal classification, memos and reports wait. Rules reads keep data moving. Add credit at console.anthropic.com → Billing; AI resumes within the hour.", link: "/settings/jobs" });
      }
      await enqueue(ctx.db, ctx.job.type, ctx.job.payload, { runAfter: new Date(until), now: ctx.now, dedupeKey: `deferred:${ctx.job.type}:${JSON.stringify(ctx.job.payload)}:${until.slice(0, 13)}` });
      return;
    }
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
    // Without AI (no key, or paused for credit) the rules read turns well-sourced signals into triggers; the rest stay
    // "new" for the AI classifier.
    if (!aiConfig() || await aiPausedUntil(ctx.db, ctx.now)) { await classifyByRules(ctx.db, 40, ctx.now); return; }
    await deferOnBudget(ctx, () => classifyNewSignals(ctx.db, requireAi(), 15, ctx.now));
  },
  "triggers.read": async ctx => {
    await deferOnBudget(ctx, () => readSignal(ctx.db, requireAi(), String(ctx.job.payload.signalId), ctx.now));
  },
  "identity.enrich": async ({ db, job }) => {
    // The organization may have been merged or deleted since the job was queued: nothing to do.
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, String(job.payload.orgId)));
    if (!org) return;
    await enrichOrganizationIdentity(db, org.id);
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
  // Prospecting "Scan now": every enabled Apollo people search (0 credits), 10 per run, the rest a minute later
  // so Apollo's free per-minute limit is never hit; plus the trigger scan and the public-list diffs.
  "prospecting.scan": async ({ db, job, now }) => {
    const cfg = apolloConfig();
    const offset = Number(job.payload.offset ?? 0);
    if (offset === 0) {
      await enqueue(db, "triggers.scan", { manual: true }, { dedupeKey: `scan-now-triggers:${now.toISOString().slice(0, 15)}`, now });
      await enqueue(db, "lists.diff", {}, { dedupeKey: `scan-now-lists:${now.toISOString().slice(0, 10)}`, now });
    }
    if (!cfg) return;
    const all = await db.select({ id: savedSearches.id }).from(savedSearches)
      .where(andOp(eq(savedSearches.kind, "apollo_people"), eq(savedSearches.enabled, true))).orderBy(ascOp(savedSearches.name));
    for (const s of all.slice(offset, offset + 10)) await runSavedSearch(db, cfg, s.id, now);
    if (offset + 10 < all.length) {
      await enqueue(db, "prospecting.scan", { offset: offset + 10, batch: job.payload.batch }, { runAfter: new Date(now.getTime() + 70_000), dedupeKey: `scan-now:${job.payload.batch}:${offset + 10}`, now });
    }
  },
  "playbook.draft": async ctx => {
    await deferOnBudget(ctx, () => draftPlaybookTemplates(ctx.db, requireAi(), String(ctx.job.payload.mandateId), String(ctx.job.payload.segmentId)));
  },
  // Learning loop (monthly): outreach proposals need Claude; weights, ladder and case records do not.
  "learning.monthly": async ctx => {
    const { db, now } = ctx;
    await proposeWeights(db, REGENERA_MANDATE_ID);
    await ladderSummary(db, REGENERA_MANDATE_ID);
    await ensureCaseRecords(db, REGENERA_MANDATE_ID);
    if (aiConfig()) await deferOnBudget(ctx, () => proposeOutreachChanges(db, requireAi(), REGENERA_MANDATE_ID, now));
  },
  "cases.ensure": async ({ db }) => {
    await ensureCaseRecords(db, REGENERA_MANDATE_ID);
  },
  // Nightly backup to R2, and a monthly read-back check (docs/plans/phase-4.md item 6).
  "backup.nightly": async ({ db, now }) => {
    if (!env.BUCKET) throw new Error("R2 binding BUCKET is not available");
    await runBackup(db, r2BackupStore(env.BUCKET), now);
  },
  "backup.verify": async ({ db, now }) => {
    if (!env.BUCKET) throw new Error("R2 binding BUCKET is not available");
    const r = await verifyLatestBackup(db, r2BackupStore(env.BUCKET), now);
    if (!r.ok) throw new Error(`Backup check failed: ${r.problems.slice(0, 3).join("; ")}`);
  },
  // Funding (phase 5): rotating scans, then Claude's read (when a key exists) and map placement.
  "funding.scan": async ({ db, now }) => {
    await scanFunding(db, REGENERA_MANDATE_ID, now);
    await enqueue(db, "funding.read", {}, { dedupeKey: `funding-read:${now.toISOString().slice(0, 13)}`, now });
    await enqueue(db, "funding.place", {}, { dedupeKey: `funding-place:${now.toISOString().slice(0, 13)}`, now });
    await enqueue(db, "funding.project_match", {}, { dedupeKey: `funding-pmatch:${now.toISOString().slice(0, 13)}`, now });
  },
  "integrity.screen": async ({ db, now }) => {
    // Phase 23: unscreened or due projects through the Origination & Integrity Engine, a few per run.
    await screenDue(db, 6, now);
  },
  "stewardship.due": async ({ db, now }) => {
    await stewardshipDue(db, now);
  },
  "steward.sources": async ({ db, now }) => {
    // Phase 28B: refresh the register, then a bounded number of place × source queries that are due under each source's policy.
    await syncSourceRegister(db);
    for (const run of await dueSourceRuns(db, now, 12)) {
      await runSourceForPlace(db, { ...run, actor: "system:steward.sources", env: { FIRMS_MAP_KEY: (env as unknown as Record<string, string | undefined>).FIRMS_MAP_KEY }, now });
    }
  },
  "origination.sync": async ({ db, now }) => {
    // Phase 22: market hypotheses from signals, then the unified origination queue (capital-, project-, market-first).
    await generateHypotheses(db, REGENERA_MANDATE_ID, now);
    await generateGapTheses(db, REGENERA_MANDATE_ID, now);
    await syncOriginationQueue(db, REGENERA_MANDATE_ID, now);
  },
  "funding.project_match": async ({ db, now }) => {
    // Funding discovery workflow: every open record is matched to Regenera projects by hard gates, with reasons.
    await matchFundingToProjects(db, REGENERA_MANDATE_ID, now);
  },
  "funding.read": async ctx => {
    // Without AI the rules read gives sectors and a summary; the AI read replaces it when available.
    if (!aiConfig() || await aiPausedUntil(ctx.db, ctx.now)) { await readFundingByRules(ctx.db, 60, ctx.now); return; }
    await deferOnBudget(ctx, () => readFunding(ctx.db, requireAi(), 12, ctx.now));
  },
  "place.profile": async ({ db, job }) => {
    await buildPlaceProfile(db, String(job.payload.projectId));
  },
  "intel.wb_projects": async ({ db, now }) => {
    // Autonomous loop: World Bank projects → Market pipeline records, orgs with roles, screening and saved assessment.
    await runWbLoop(db, now, 8);
  },
  "registry.gppd": async ({ db, job, now }) => {
    // Registry-listed power plants, one slice per job until the file ends.
    const offset = Number(job.payload.offset ?? 0);
    const r = await ingestGppd(db, offset, 4000);
    if (!r.done) await enqueue(db, "registry.gppd", { offset: r.next }, { now, dedupeKey: `gppd:${now.toISOString().slice(0, 10)}:${r.next}` });
    else await setState(db, "registry_gppd_last", JSON.stringify({ at: now.toISOString(), rows: r.next }));
  },
  "projects.autoplace": async ({ db, now }) => {
    // Unlocated projects get an approximate point (town, region or country) so Atlas and site checks can run.
    const r = await autoPlaceProjects(db, 6, now);
    // First run after deploy: start the registry-listed power plant ingestion if it has never completed.
    if (!(await getState(db, "registry_gppd_last"))) await enqueue(db, "registry.gppd", { offset: 0 }, { now, dedupeKey: `gppd:kickoff:${now.toISOString().slice(0, 10)}` });
    if (r.more) await enqueue(db, "projects.autoplace", {}, { runAfter: new Date(now.getTime() + 60_000), now, dedupeKey: `autoplace:${now.toISOString().slice(0, 16)}` });
  },
  "place.refresh": async ({ db, now }) => {
    for (const id of await projectsNeedingPlace(db, now)) await enqueue(db, "place.profile", { projectId: id }, { dedupeKey: `place:${id}:${now.toISOString().slice(0, 10)}`, now });
  },
  "regulatory.expire": async ({ db, now }) => {
    await expirePermits(db, now);
  },
  "events.dispatch": async ({ db, now }) => {
    // Domain events → trigger rules → notifications, tasks, playbook runs, jobs (§17, §75).
    await dispatchEvents(db, now);
  },
  "portal.expire": async ({ db, now }) => {
    // Introducer agreements past their date expire (removing portal access); approved registrations lapse.
    await expireBrokerRecords(db, now);
  },
  "capital.rematch": async ({ db, now }) => {
    // Daily: partner mandates, profiles and qualifications change; matches (and eligibility) follow.
    for (const o of await db.select({ id: capitalOpportunities.id }).from(capitalOpportunities).where(ne(capitalOpportunities.status, "closed")).limit(200)) {
      await runMatches(db, o.id, now);
    }
  },
  "capital.expire": async ({ db, now }) => {
    await expireQualifications(db, now);
    // Knowledge permissions past their expiry stop working and flag every output that used them.
    await expirePermissions(db, now);
  },
  "site_intel.continue": async ({ db, now }) => {
    // Site-intelligence runs whose panel was closed are finished here, a few stages per tick.
    await continueAbandonedRuns(db, now, 6, env as unknown as Record<string, string | undefined>);
  },
  "funding.place": async ({ db, now }) => {
    const { more } = await placeFunding(db, 15);
    if (more) await enqueue(db, "funding.place", {}, { runAfter: new Date(now.getTime() + 60_000), now, dedupeKey: `funding-place:${now.toISOString().slice(0, 16)}` });
  },
  "funding.draft": async ctx => {
    await deferOnBudget(ctx, () => draftProposal(ctx.db, requireAi(), String(ctx.job.payload.opportunityId), undefined, ctx.job.payload.applicationId ? String(ctx.job.payload.applicationId) : undefined));
  },
  "lists.diff": async ({ db, now }) => {
    const sources = await db.select({ key: listSources.key }).from(listSources).where(eq(listSources.enabled, true));
    for (const src of sources) await enqueue(db, "lists.diff.source", { key: src.key }, { dedupeKey: `listdiff:${src.key}:${now.toISOString().slice(0, 10)}`, now });
  },
  // Phase 14, background work in short jobs (each well inside a Worker request): a daily fan-out, one job per public
  // queue, then one job per universe slice. Screens drive the same jobs while open (runJobsOfTypes); the tick finishes them.
  "mandates.queues": async ({ db, now }) => {
    const live = await db.select({ id: commercialMandates.id }).from(commercialMandates).where(andOp(eq(commercialMandates.type, "epc_origination"), inArrayOp(commercialMandates.status, ["active", "pilot", "proposed", "draft"])));
    const day = now.toISOString().slice(0, 10);
    for (const iso of ["miso", "spp"] as const) await enqueue(db, "mandates.queue.sync", { iso }, { dedupeKey: `queue-sync:${iso}:${day}`, now });
    for (const m of live) await enqueue(db, "mandates.universe", { id: m.id, offset: 0, actor: "system:mandates" }, { dedupeKey: `universe:${m.id}:${day}:0`, now: new Date(now.getTime() + 1000) });
  },
  "mandates.queue.sync": async ({ db, job, now }) => {
    const iso = job.payload.iso === "spp" ? "spp" : "miso";
    const mandateId = typeof job.payload.mandateId === "string" ? job.payload.mandateId : null;
    if (mandateId) { const w = await getWork(db, mandateId); if (w) await setWork(db, mandateId, { ...w, phase: "syncing", label: `Syncing the ${iso.toUpperCase()} queue` }); }
    const r = await syncQueue(db, iso, now);
    await signalsFromQueueChanges(db, r.changes, now);
  },
  // Shared scan engine (phase 15): one bounded step per job, resuming from the run's checkpoint.
  "scan.step": async ({ db, job, now }) => {
    await runScanJob(db, job, { apollo: apolloConfig(), ai: aiConfig() }, now);
  },
  "mandates.universe": async ({ db, job, now }) => {
    const id = String(job.payload.id);
    const offset = Number(job.payload.offset ?? 0);
    const actor = String(job.payload.actor ?? "system:mandates");
    const prev = offset ? await getWork(db, id) : null;
    const r = await buildUniverseSlice(db, id, actor, now, { offset });
    const started = prev?.startedAt ?? now.toISOString();
    const created = (prev?.created ?? 0) + r.created, updated = (prev?.updated ?? 0) + r.updated;
    if (r.next !== null) {
      await setWork(db, id, { phase: "screening", label: "Screening the universe", done: r.processed, total: r.total, created, updated, startedAt: started });
      await enqueue(db, "mandates.universe", { id, offset: r.next, actor }, { dedupeKey: `universe:${id}:${started}:${r.next}`, now });
    } else {
      await setWork(db, id, { phase: "done", label: "Universe up to date", done: r.total, total: r.total, created, updated, startedAt: started, finishedAt: now.toISOString() });
    }
  },
  "mandates.automation": async ({ db, now }) => { await mandateAutomation(db, now); },
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
  // Phase 19: public sanctions lists, one list per job (the UK and EU files are tens of MB, streamed).
  "sanctions.refresh": async ({ db, now }) => {
    for (const list of LIST_KEYS) await enqueue(db, "sanctions.list", { list }, { dedupeKey: `sanctions:${list}:${now.toISOString().slice(0, 10)}`, now });
  },
  "sanctions.list": async ({ db, job, now }) => {
    const list = LIST_KEYS.includes(job.payload.list as ListKey) ? (job.payload.list as ListKey) : "ofac";
    await refreshList(db, list, now);
  },
  // Phase 20: weekly Companies House re-check for sponsors with a company number; changes raise a notification.
  "registry.check": async ({ db, now }) => {
    const key = (env as unknown as Record<string, string | undefined>).COMPANIES_HOUSE_API_KEY;
    if (!key) return;
    for (const a of await dueRegistryChecks(db, now)) {
      const [o] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, a.orgId));
      if (o) await checkCompaniesHouse(db, key, { mandateId: a.mandateId, orgId: a.orgId, orgName: o.name, companyNumber: a.value.replace(/\s+/g, "").toUpperCase() }).catch(() => undefined);
    }
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
  "learning.monthly": "monthly:1:06:30",
  "cases.ensure": "daily:05:30",
  "backup.nightly": "daily:02:30",
  "backup.verify": "monthly:3:04:00",
  "funding.scan": "every:2h",
  "capital.expire": "daily:05:30",
  "capital.rematch": "daily:05:45",
  "regulatory.expire": "daily:05:35",
  "portal.expire": "daily:05:40",
  "events.dispatch": "every:5m",
  "place.refresh": "daily:04:10",
  "projects.autoplace": "every:1h",
  "registry.gppd": "monthly:5:03:30",
  "intel.wb_projects": "every:6h",
  "origination.sync": "every:3h",
  "integrity.screen": "every:2h",
  "stewardship.due": "daily:06:40",
  "steward.sources": "every:6h",
  "site_intel.continue": "every:5m",
  "mandates.queues": "daily:05:10",
  "mandates.automation": "daily:06:15",
  "sanctions.refresh": "weekly:sun:03:20",
  "registry.check": "weekly:mon:04:40",
};
