// "What the OS did" (phase 21 §7): counts from persisted records only (never demo activity), last 24 hours, plus the
// conditions that stop work: AI paused, degraded sources, failed jobs.
import { and, eq, gte, like, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { aiRuns, auditLog, fundingOpportunities, jobs, organizations, providerCalls, systemState, triggers } from "@/db/schema";
import { aiPausedUntil } from "@/lib/ai/run";

const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

export async function opsSummary(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const n = sql<number>`count(*)`;
  const [funding, signalsTriggered, orgs, placed, sourceCalls, sourceOk, dead, aiSpend, cool] = await Promise.all([
    count(db.select({ n }).from(fundingOpportunities).where(gte(fundingOpportunities.createdAt, since))),
    count(db.select({ n }).from(triggers).where(gte(triggers.createdAt, since))),
    count(db.select({ n }).from(organizations).where(gte(organizations.createdAt, since))),
    count(db.select({ n }).from(auditLog).where(and(eq(auditLog.action, "project_located"), gte(auditLog.createdAt, since)))),
    count(db.select({ n }).from(providerCalls).where(gte(providerCalls.createdAt, since))),
    count(db.select({ n }).from(providerCalls).where(and(gte(providerCalls.createdAt, since), eq(providerCalls.ok, true)))),
    count(db.select({ n }).from(jobs).where(eq(jobs.status, "dead"))),
    db.select({ usd: sql<number>`coalesce(sum(${aiRuns.costUsd}), 0)` }).from(aiRuns).where(gte(aiRuns.createdAt, monthStart)),
    db.select({ key: systemState.key, value: systemState.value }).from(systemState).where(like(systemState.key, "cool:%")),
  ]);
  const degraded = cool.flatMap(r => { try { const h = JSON.parse(r.value) as { failures: number }; return h.failures >= 3 ? [r.key.slice(5)] : []; } catch { return []; } });
  return { funding, triggers: signalsTriggered, orgs, placed, sourceCalls, sourceOk, dead, aiUsd: aiSpend[0]?.usd ?? 0, aiPaused: await aiPausedUntil(db, now), degraded };
}
