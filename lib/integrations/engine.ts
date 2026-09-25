// Integration registry engine: seeding (owner overrides survive), the feature-state gate used by fetchJson, and health
// from the provider_calls ledger (the sync log for every adapter).
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { integrations, providerCalls } from "@/db/schema";
import { INTEGRATIONS } from "./registry";

/** Upserts the registry. A feature state an owner changed (stateOverridden) is kept. */
export async function ensureIntegrations(db: Db) {
  for (const i of INTEGRATIONS) {
    const row = {
      key: i.key, provider: i.provider, dataset: i.dataset, category: i.category, coverage: i.coverage, baseUrl: i.baseUrl, auth: i.auth, envVar: i.envVar ?? null,
      license: i.license, licenseUrl: i.licenseUrl ?? null, commercialUse: i.commercialUse, attribution: i.attribution, caching: i.caching, redistribution: i.redistribution,
      rateLimit: i.rateLimit, refresh: i.refresh, sourceTier: i.tier, notes: i.notes ?? "",
    };
    await db.insert(integrations).values({ ...row, featureState: i.featureState })
      .onConflictDoUpdate({ target: integrations.key, set: { ...row, featureState: sql`case when ${integrations.stateOverridden} then ${integrations.featureState} else ${i.featureState} end`, updatedAt: new Date().toISOString() } });
  }
  return INTEGRATIONS.length;
}

// Per-isolate cache so the gate costs one query per provider per minute.
const stateCache = new Map<string, { state: string | null; at: number }>();
export function clearIntegrationCache() { stateCache.clear(); }

/** Throws when the registry marks a provider disabled or licence-required. Unregistered providers are allowed. */
export async function assertIntegrationAllowed(db: Db, provider: string) {
  const hit = stateCache.get(provider);
  let state = hit && Date.now() - hit.at < 60_000 ? hit.state : undefined;
  if (state === undefined) {
    try {
      const [row] = await db.select({ state: integrations.featureState }).from(integrations).where(eq(integrations.key, provider));
      state = row?.state ?? null;
    } catch { state = null; } // registry table missing (older database): do not block
    stateCache.set(provider, { state, at: Date.now() });
  }
  if (state === "disabled" || state === "license_required") {
    throw new Error(`${provider}: integration is ${state === "disabled" ? "disabled" : "waiting for a licence"} in the registry`);
  }
}

export type IntegrationHealth = { key: string; lastSuccess: string | null; lastFailure: string | null; lastError: string | null; calls24h: number; failures24h: number };

export async function integrationHealth(db: Db, now = new Date()): Promise<Map<string, IntegrationHealth>> {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const agg = await db.select({
    key: providerCalls.provider,
    lastSuccess: sql<string | null>`max(case when ${providerCalls.ok} then ${providerCalls.createdAt} end)`,
    lastFailure: sql<string | null>`max(case when not ${providerCalls.ok} then ${providerCalls.createdAt} end)`,
    calls24h: sql<number>`sum(case when ${providerCalls.createdAt} >= ${since} then 1 else 0 end)`,
    failures24h: sql<number>`sum(case when ${providerCalls.createdAt} >= ${since} and not ${providerCalls.ok} then 1 else 0 end)`,
  }).from(providerCalls).groupBy(providerCalls.provider);
  const out = new Map<string, IntegrationHealth>();
  for (const a of agg) {
    const [err] = a.lastFailure ? await db.select({ detail: providerCalls.detail }).from(providerCalls).where(and(eq(providerCalls.provider, a.key), eq(providerCalls.ok, false), gte(providerCalls.createdAt, a.lastFailure))).orderBy(desc(providerCalls.createdAt)).limit(1) : [];
    out.set(a.key, { key: a.key, lastSuccess: a.lastSuccess, lastFailure: a.lastFailure, lastError: err?.detail ?? null, calls24h: a.calls24h ?? 0, failures24h: a.failures24h ?? 0 });
  }
  return out;
}
