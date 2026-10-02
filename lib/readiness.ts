// System readiness (phase 15 §3, §9): can the OS perform what Command offers? One honest reading per capability:
// ok, attention, not connected, never ran, stale or failed, each with the exact fix. Nothing here is inferred from a
// button existing: scheduler state comes from the tick and the cron heartbeat, providers from configuration and
// connected accounts, backups from a successful run, sending from the latest DNS check.
import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { deliverabilityChecks, jobs, oauthAccounts, scanRuns } from "@/db/schema";
import { aiConfig, apolloConfig, outreachConfig } from "@/lib/config";
import { googleConfig } from "@/lib/google/config";
import { getState } from "@/lib/state";

export type ReadinessStatus = "ok" | "attention" | "not_connected" | "never" | "stale" | "failed";
export type ReadinessItem = { key: string; label: string; status: ReadinessStatus; detail: string; href: string; fix?: string };

const STATUS_LABEL: Record<ReadinessStatus, string> = { ok: "Working", attention: "Needs attention", not_connected: "Not connected", never: "Never ran", stale: "Stale", failed: "Failed" };
export const readinessLabel = (s: ReadinessStatus) => STATUS_LABEL[s];

const ago = (iso: string | null, now: Date) => {
  if (!iso) return "never";
  const m = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export async function readiness(db: Db, mandateIds: string[], now = new Date()): Promise<ReadinessItem[]> {
  const e = env as unknown as Record<string, unknown>;
  const ids = mandateIds.length ? mandateIds : ["-"];
  const [lastTick, cronAt, cronStatus, backup, [queued], [dead], mailboxes, [latestCheck], [lastScan]] = await Promise.all([
    getState(db, "last_tick_at"), getState(db, "cron_last_fired_at"), getState(db, "cron_status"), getState(db, "last_backup"),
    db.select({ n: sql<number>`count(*)`, oldest: sql<string | null>`min(${jobs.runAfter})` }).from(jobs).where(and(eq(jobs.status, "queued"), lt(jobs.runAfter, now.toISOString()))),
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(eq(jobs.status, "dead")),
    db.select({ role: oauthAccounts.mailboxRole, email: oauthAccounts.email, paused: oauthAccounts.pausedUntil }).from(oauthAccounts),
    db.select().from(deliverabilityChecks).where(eq(deliverabilityChecks.domain, "regenera.bio")).orderBy(desc(deliverabilityChecks.checkedAt)).limit(1),
    db.select({ at: scanRuns.completedAt, status: scanRuns.status, name: scanRuns.presetName }).from(scanRuns).where(and(inArray(scanRuns.mandateId, ids), inArray(scanRuns.status, ["completed", "partial", "failed"]))).orderBy(desc(scanRuns.updatedAt)).limit(1),
  ]);
  const items: ReadinessItem[] = [];

  // Scheduler: the cron heartbeat says whether Cloudflare fires; the tick says whether jobs actually run.
  const tickAge = lastTick ? now.getTime() - new Date(lastTick).getTime() : Infinity;
  if (cronStatus === "skipped_no_token") items.push({ key: "scheduler", label: "Scheduler", status: "failed", href: "/settings/jobs",
    detail: `The 5-minute cron fires (${ago(cronAt, now)}) but cannot run jobs: the JOBS_TICK_TOKEN secret is not set.`, fix: "Run node scripts/setup-secrets.mjs (it sets the generated internal secrets; no redeploy needed)." });
  else if (!lastTick) items.push({ key: "scheduler", label: "Scheduler", status: "never", href: "/settings/jobs", detail: "No job tick has ever run in this database.", fix: "Set JOBS_TICK_TOKEN (node scripts/setup-secrets.mjs); the cron then runs the tick every 5 minutes." });
  else if (tickAge > 30 * 60_000) items.push({ key: "scheduler", label: "Scheduler", status: "stale", href: "/settings/jobs", detail: `Last tick ${ago(lastTick, now)}.`, fix: "Check Settings → Jobs and the Worker logs (npx wrangler tail regenera-os)." });
  else items.push({ key: "scheduler", label: "Scheduler", status: "ok", href: "/settings/jobs", detail: `Last tick ${ago(lastTick, now)}.` });

  const waiting = queued?.n ?? 0;
  const oldestH = queued?.oldest ? Math.round((now.getTime() - new Date(queued.oldest).getTime()) / 3_600_000) : 0;
  items.push({ key: "queue", label: "Background jobs", status: (dead?.n ?? 0) > 0 ? "failed" : waiting > 0 && oldestH >= 1 ? "attention" : "ok", href: "/settings/jobs",
    detail: `${waiting} due and waiting${waiting ? `, oldest ${oldestH} h` : ""}; ${dead?.n ?? 0} dead.` });

  const parsedBackup = (() => { try { return backup ? JSON.parse(backup) as { day?: string } : null; } catch { return null; } })();
  items.push(!e.BUCKET
    ? { key: "backup", label: "Backups", status: "not_connected", href: "/settings/jobs", detail: "R2 storage is not enabled on the Cloudflare account, so nightly backups cannot be written. D1 Time Travel still allows point-in-time restore (30 days on Workers Paid).", fix: "Enable R2, create a bucket and set r2 in deploy/cloudflare.json." }
    : parsedBackup?.day ? { key: "backup", label: "Backups", status: "ok", href: "/settings/jobs", detail: `Last successful nightly export ${parsedBackup.day}.` }
      : { key: "backup", label: "Backups", status: "never", href: "/settings/jobs", detail: "No backup has completed yet (runs nightly at 02:30 ET once the scheduler works)." });

  const ai = aiConfig();
  items.push(ai ? { key: "anthropic", label: "Claude (research, drafting)", status: "ok", href: "/settings/claude", detail: `Configured; monthly budget $${ai.monthlyBudgetUsd}.` }
    : { key: "anthropic", label: "Claude (research, drafting)", status: "not_connected", href: "/settings/claude", detail: "ANTHROPIC_API_KEY is not set: no research, signal reading or drafting runs.", fix: "npx wrangler secret put ANTHROPIC_API_KEY --name regenera-os" });
  items.push(apolloConfig() ? { key: "apollo", label: "Apollo (company and people search)", status: "ok", href: "/settings/connections", detail: "Configured. Enrichment spends credits only within the set budget." }
    : { key: "apollo", label: "Apollo (company and people search)", status: "not_connected", href: "/settings/connections", detail: "APOLLO_API_KEY is not set: scans can use only the public register and existing records.", fix: "npx wrangler secret put APOLLO_API_KEY --name regenera-os" });

  const g = googleConfig();
  const primary = mailboxes.find(m => m.role === "primary"), sending = mailboxes.find(m => m.role === "sending");
  items.push(!g ? { key: "google", label: "Google mailbox and calendar", status: "not_connected", href: "/settings/connections", detail: "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY).", fix: `Create the OAuth client with redirect ${(outreachConfig().appBaseUrl)}/api/oauth/google/callback, then set the secrets.` }
    : !primary ? { key: "google", label: "Google mailbox and calendar", status: "not_connected", href: "/settings/connections", detail: "OAuth configured; no mailbox connected yet.", fix: "Settings → Connections → Connect primary mailbox." }
      : { key: "google", label: "Google mailbox and calendar", status: primary.paused && primary.paused > now.toISOString() ? "attention" : "ok", href: "/settings/connections", detail: `Primary ${primary.email}${sending ? `; sending ${sending.email}` : "; no separate sending mailbox"}.` });

  const c = latestCheck;
  items.push(!c ? { key: "sending_dns", label: "Sending authentication (regenera.bio)", status: "never", href: "/settings/sending", detail: "No DNS check recorded in the OS yet." }
    : (!c.spf || !c.dkim) ? { key: "sending_dns", label: "Sending authentication (regenera.bio)", status: "attention", href: "/settings/sending",
      detail: `Checked ${c.checkedAt.slice(0, 10)}: ${[!c.spf && "no SPF record", !c.dkim && "no Google DKIM key", c.dmarc === "missing" && "no DMARC"].filter(Boolean).join(", ")}.`, fix: "Add SPF (v=spf1 include:_spf.google.com ~all) and the Google Workspace DKIM key in Cloudflare DNS before any outreach." }
      : { key: "sending_dns", label: "Sending authentication (regenera.bio)", status: "ok", href: "/settings/sending", detail: `SPF and DKIM present (checked ${c.checkedAt.slice(0, 10)}); DMARC ${c.dmarc ?? "unknown"}.` });

  items.push(!lastScan ? { key: "scans", label: "Prospect scans", status: "never", href: "/scans", detail: "No scan has run in this workspace." }
    : { key: "scans", label: "Prospect scans", status: lastScan.status === "failed" ? "failed" : "ok", href: "/scans", detail: `Last: ${lastScan.name || "scan"}, ${lastScan.status}, ${ago(lastScan.at, now)}.` });
  return items;
}
