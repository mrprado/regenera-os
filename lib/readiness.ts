// System readiness (phase 15 §3, §9; phase 16 §10): can the OS perform what Command offers? One honest reading per
// capability. A key that is set is "configured, not verified" until a real call succeeds; a queued job is not a completed
// one; a partial scan is not a working pipeline. Scheduler state comes from the tick and the cron heartbeat, providers
// from their last successful and failed calls, backups from a successful run, sending from the latest DNS check.
import { env } from "cloudflare:workers";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { aiRuns, deliverabilityChecks, oauthAccounts, providerCalls, scanRuns } from "@/db/schema";
import { aiConfig, apolloConfig, outreachConfig } from "@/lib/config";
import { googleConfig } from "@/lib/google/config";
import { queueHealth, scheduleHealth } from "@/lib/jobs/health";
import { getState } from "@/lib/state";

export type ReadinessStatus = "ok" | "attention" | "unverified" | "not_connected" | "never" | "stale" | "failed";
export type ReadinessItem = { key: string; label: string; status: ReadinessStatus; detail: string; href: string; fix?: string };

const STATUS_LABEL: Record<ReadinessStatus, string> = { ok: "Working", attention: "Needs attention", unverified: "Configured, not verified", not_connected: "Not connected", never: "Never ran", stale: "Stale", failed: "Failing" };
export const readinessLabel = (s: ReadinessStatus) => STATUS_LABEL[s];

const ago = (iso: string | null, now: Date) => {
  if (!iso) return "never";
  const m = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Reading for a configured external service from its own call history (last 14 days). */
export function serviceReading(lastOk: string | null, lastFail: string | null, failMsg: string | null, now: Date): { status: ReadinessStatus; detail: string } {
  if (lastFail && (!lastOk || lastFail > lastOk)) return { status: "failed", detail: `Last call failed ${ago(lastFail, now)}${failMsg ? `: ${failMsg.slice(0, 140)}` : ""}${lastOk ? `; last success ${ago(lastOk, now)}` : "; no success yet"}.` };
  if (!lastOk) return { status: "unverified", detail: "Key is set, but no successful call is recorded in the last 14 days." };
  return { status: "ok", detail: `Last successful call ${ago(lastOk, now)}.` };
}

export async function readiness(db: Db, mandateIds: string[], now = new Date()): Promise<ReadinessItem[]> {
  const e = env as unknown as Record<string, unknown>;
  const ids = mandateIds.length ? mandateIds : ["-"];
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [lastTick, cronAt, cronStatus, backup, q, sched, mailboxes, [latestCheck], [lastScan], [aiOk], [aiFail], [apOk], [apFail]] = await Promise.all([
    getState(db, "last_tick_at"), getState(db, "cron_last_fired_at"), getState(db, "cron_status"), getState(db, "last_backup"),
    queueHealth(db, now), scheduleHealth(db, now),
    db.select({ role: oauthAccounts.mailboxRole, email: oauthAccounts.email, paused: oauthAccounts.pausedUntil }).from(oauthAccounts),
    db.select().from(deliverabilityChecks).where(eq(deliverabilityChecks.domain, "regenera.bio")).orderBy(desc(deliverabilityChecks.checkedAt)).limit(1),
    db.select({ at: scanRuns.completedAt, status: scanRuns.status, name: scanRuns.presetName, found: sql<number>`json_extract(${scanRuns.counts}, '$.found')` }).from(scanRuns).where(and(inArray(scanRuns.mandateId, ids), inArray(scanRuns.status, ["completed", "partial", "failed"]))).orderBy(desc(scanRuns.updatedAt)).limit(1),
    db.select({ at: sql<string | null>`max(${aiRuns.createdAt})` }).from(aiRuns).where(and(eq(aiRuns.status, "ok"), gte(aiRuns.createdAt, since))),
    db.select({ at: aiRuns.createdAt, error: aiRuns.error }).from(aiRuns).where(and(eq(aiRuns.status, "error"), gte(aiRuns.createdAt, since))).orderBy(desc(aiRuns.createdAt)).limit(1),
    db.select({ at: sql<string | null>`max(${providerCalls.createdAt})` }).from(providerCalls).where(and(eq(providerCalls.provider, "apollo"), eq(providerCalls.ok, true), gte(providerCalls.createdAt, since))),
    db.select({ at: providerCalls.createdAt, detail: providerCalls.detail }).from(providerCalls).where(and(eq(providerCalls.provider, "apollo"), eq(providerCalls.ok, false), gte(providerCalls.createdAt, since))).orderBy(desc(providerCalls.createdAt)).limit(1),
  ]);
  const items: ReadinessItem[] = [];

  // Scheduler: the cron heartbeat says whether Cloudflare fires; the tick says whether jobs actually run.
  const tickAge = lastTick ? now.getTime() - new Date(lastTick).getTime() : Infinity;
  if (cronStatus === "skipped_no_token") items.push({ key: "scheduler", label: "Scheduler", status: "failed", href: "/settings/jobs",
    detail: `The 5-minute cron fires (${ago(cronAt, now)}) but cannot run jobs: the JOBS_TICK_TOKEN secret is not set.`, fix: "Run node scripts/setup-secrets.mjs (it sets the generated internal secrets; no redeploy needed)." });
  else if (!lastTick) items.push({ key: "scheduler", label: "Scheduler", status: "never", href: "/settings/jobs", detail: "No job tick has ever run in this database.", fix: "Set JOBS_TICK_TOKEN (node scripts/setup-secrets.mjs); the cron then runs the tick every 5 minutes." });
  else if (tickAge > 30 * 60_000) items.push({ key: "scheduler", label: "Scheduler", status: "stale", href: "/settings/jobs", detail: `Last tick ${ago(lastTick, now)}.`, fix: "Check Settings → Jobs and the Worker logs (npx wrangler tail regenera-os)." });
  else items.push({ key: "scheduler", label: "Scheduler", status: "ok", href: "/settings/jobs", detail: `Last tick ${ago(lastTick, now)}.` });

  const oldestH = q.oldestDueAt ? Math.round((now.getTime() - new Date(q.oldestDueAt).getTime()) / 3_600_000) : 0;
  const failing = sched.filter(s => s.state === "failing"), overdue = sched.filter(s => s.state === "overdue");
  items.push({ key: "queue", label: "Background jobs", href: "/settings/jobs",
    status: q.dead > 0 || failing.length ? "failed" : (q.dueWaiting > 0 && oldestH >= 1) || q.expiredLeases > 0 || overdue.length ? "attention" : "ok",
    detail: [`${q.dueWaiting} due and waiting${q.dueWaiting ? `, oldest ${oldestH} h` : ""}`, `${q.running} running`, `${q.retrying} retrying`, `${q.dead} dead`,
      q.expiredLeases ? `${q.expiredLeases} expired lease${q.expiredLeases === 1 ? "" : "s"} (reclaimed next tick)` : "",
      failing.length ? `failing: ${failing.map(s => s.jobType).join(", ")}` : "", overdue.length ? `queued but not completed: ${overdue.map(s => s.jobType).join(", ")}` : ""].filter(Boolean).join("; ") + "." });

  const parsedBackup = (() => { try { return backup ? JSON.parse(backup) as { day?: string } : null; } catch { return null; } })();
  const backupAgeDays = parsedBackup?.day ? (now.getTime() - new Date(`${parsedBackup.day}T12:00:00Z`).getTime()) / 86_400_000 : Infinity;
  items.push(!e.BUCKET
    ? { key: "backup", label: "Backups", status: "not_connected", href: "/settings/jobs", detail: "No R2 bucket is bound to this Worker, so nightly backups cannot be written. D1 Time Travel still allows point-in-time restore (30 days on Workers Paid).", fix: "Create a bucket, set r2 in deploy/cloudflare.json and redeploy." }
    : !parsedBackup?.day ? { key: "backup", label: "Backups", status: "never", href: "/settings/jobs", detail: "R2 is bound but no backup has completed yet (runs nightly at 02:30 Pacific once the scheduler works)." }
      : backupAgeDays > 2 ? { key: "backup", label: "Backups", status: "stale", href: "/settings/jobs", detail: `Last successful nightly export ${parsedBackup.day}; none since.`, fix: "Check backup.nightly in Settings → Jobs." }
        : { key: "backup", label: "Backups", status: "ok", href: "/settings/jobs", detail: `Last successful nightly export ${parsedBackup.day}. Restore is tested with scripts/restore-backup.mjs into a separate database, never production.` });

  const ai = aiConfig();
  if (!ai) items.push({ key: "anthropic", label: "Claude (research, drafting)", status: "not_connected", href: "/settings/claude", detail: "ANTHROPIC_API_KEY is not set: no research, signal reading or drafting runs.", fix: "npx wrangler secret put ANTHROPIC_API_KEY --name regenera-os" });
  else { const r = serviceReading(aiOk?.at ?? null, aiFail?.at ?? null, aiFail?.error ?? null, now); items.push({ key: "anthropic", label: "Claude (research, drafting)", status: r.status, href: "/settings/claude", detail: `${r.detail} Monthly budget $${ai.monthlyBudgetUsd}.` }); }
  if (!apolloConfig()) items.push({ key: "apollo", label: "Apollo (company and people search)", status: "not_connected", href: "/settings/connections", detail: "APOLLO_API_KEY is not set: scans use open web, the public register and existing records.", fix: "npx wrangler secret put APOLLO_API_KEY --name regenera-os" });
  else { const r = serviceReading(apOk?.at ?? null, apFail?.at ?? null, apFail?.detail ?? null, now); items.push({ key: "apollo", label: "Apollo (company and people search)", status: r.status, href: "/settings/connections", detail: `${r.detail} Enrichment spends credits only within the set budget.` }); }

  const g = googleConfig();
  const primary = mailboxes.find(m => m.role === "primary"), sending = mailboxes.find(m => m.role === "sending");
  items.push(!g ? { key: "google", label: "Google mailbox and calendar", status: "not_connected", href: "/settings/connections", detail: "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY).", fix: `Create the OAuth client with redirect ${(outreachConfig().appBaseUrl)}/api/oauth/google/callback, then set the secrets.` }
    : !primary ? { key: "google", label: "Google mailbox and calendar", status: "not_connected", href: "/settings/connections", detail: "OAuth configured; no mailbox connected yet.", fix: "Settings → Connections → Connect primary mailbox." }
      : { key: "google", label: "Google mailbox and calendar", status: primary.paused && primary.paused > now.toISOString() ? "attention" : "ok", href: "/settings/connections", detail: `Primary ${primary.email}${sending ? `; sending ${sending.email}` : "; no separate sending mailbox"}${primary.paused && primary.paused > now.toISOString() ? `; paused until ${primary.paused.slice(0, 10)}` : ""}.` });

  const c = latestCheck;
  items.push(!c ? { key: "sending_dns", label: "Sending authentication (regenera.bio)", status: "never", href: "/settings/sending", detail: "No DNS check recorded in the OS yet." }
    : (!c.spf || !c.dkim) ? { key: "sending_dns", label: "Sending authentication (regenera.bio)", status: "attention", href: "/settings/sending",
      detail: `Checked ${c.checkedAt.slice(0, 10)}: ${[!c.spf && "no SPF record", !c.dkim && "no Google DKIM key", c.dmarc === "missing" && "no DMARC"].filter(Boolean).join(", ")}.`, fix: "Add SPF (v=spf1 include:_spf.google.com ~all) and the Google Workspace DKIM key in Cloudflare DNS, then re-run the check in Settings → Sending." }
      : { key: "sending_dns", label: "Sending authentication (regenera.bio)", status: "ok", href: "/settings/sending", detail: `SPF and DKIM present (checked ${c.checkedAt.slice(0, 10)}); DMARC ${c.dmarc ?? "unknown"}.` });

  items.push(!lastScan ? { key: "scans", label: "Prospect scans", status: "never", href: "/scans", detail: "No scan has run in this workspace." }
    : { key: "scans", label: "Prospect scans", href: "/scans",
      status: lastScan.status === "failed" ? "failed" : lastScan.status === "partial" ? "attention" : "ok",
      detail: `Last: ${lastScan.name || "scan"}, ${lastScan.status === "partial" ? "partial (a source failed or hit a limit)" : lastScan.status}${!(lastScan.found ?? 0) ? ", no results" : `, ${lastScan.found} results`}, ${ago(lastScan.at, now)}.` });
  return items;
}
