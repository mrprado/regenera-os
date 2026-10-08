// Shared HTTP layer for free public sources (SPEC section 12a): identification, timeouts,
// retries, a D1-backed spacing limiter that holds across Worker isolates, a cache and a ledger.
import { and, eq, gte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db";
import { providerCalls, sourceCache, systemState } from "@/db/schema";
import { assertIntegrationAllowed } from "@/lib/integrations/engine";

export const USER_AGENT = "RegeneraOS/1.0 (+https://regenera.bio; alanprado@regenera.bio)";

export class SourceError extends Error {
  constructor(public provider: string, message: string, public status?: number, public retryable = false) {
    super(`${provider}: ${message}`);
  }
}

/** Minimum spacing between calls to one provider, e.g. GDELT asks for one request every 5 seconds. */
export async function acquireSlot(db: Db, provider: string, minIntervalMs: number, now = new Date()): Promise<boolean> {
  const key = `rl:${provider}`;
  const cutoff = new Date(now.getTime() - minIntervalMs).toISOString();
  await db.insert(systemState).values({ key, value: "1970-01-01T00:00:00.000Z" }).onConflictDoNothing();
  const rows = await db.update(systemState).set({ value: now.toISOString(), updatedAt: now.toISOString() })
    .where(and(eq(systemState.key, key), sql`${systemState.value} <= ${cutoff}`))
    .returning({ key: systemState.key });
  return rows.length === 1;
}

/** Counts successful calls to a provider (optionally one endpoint) since a time, for window-based limits. */
export async function callsSince(db: Db, provider: string, since: Date, endpoint?: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(providerCalls).where(and(
    eq(providerCalls.provider, provider),
    gte(providerCalls.createdAt, since.toISOString()),
    endpoint ? eq(providerCalls.endpoint, endpoint) : undefined,
  ));
  return n;
}

export async function creditsSince(db: Db, provider: string, since: Date): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${providerCalls.credits}), 0)` }).from(providerCalls)
    .where(and(eq(providerCalls.provider, provider), gte(providerCalls.createdAt, since.toISOString())));
  return n;
}

export async function logCall(db: Db, entry: { provider: string; endpoint: string; ok: boolean; httpStatus?: number; credits?: number; detail?: string }) {
  await db.insert(providerCalls).values({
    provider: entry.provider, endpoint: entry.endpoint, ok: entry.ok,
    httpStatus: entry.httpStatus ?? null, credits: entry.credits ?? 0, detail: entry.detail?.slice(0, 500) ?? null,
  });
}

async function cacheGet(db: Db, key: string, now: Date): Promise<unknown | undefined> {
  const [row] = await db.select().from(sourceCache).where(eq(sourceCache.key, key));
  if (!row || row.expiresAt < now.toISOString()) return undefined;
  return JSON.parse(row.value);
}

async function cacheSet(db: Db, key: string, provider: string, value: unknown, ttlMs: number, now: Date) {
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const text = JSON.stringify(value);
  await db.insert(sourceCache).values({ key, provider, value: text, expiresAt })
    .onConflictDoUpdate({ target: sourceCache.key, set: { value: text, expiresAt } });
}

export type FetchJsonOptions<T> = {
  provider: string;
  endpoint: string;               // stable label for the ledger, e.g. "people_search"
  url: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  init?: RequestInit;
  cacheKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  retries?: number;
  credits?: (data: T) => number;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** When every attempt fails, return the last cached copy (even expired) instead of throwing. */
  staleOnError?: boolean;
  /** "text" for CSV / XML sources (the schema then validates a string). */
  as?: "json" | "text";
};

/** GET/POST JSON with identification, retries on 429/5xx, zod validation, cache and ledger. */
export async function fetchJson<T>(db: Db, o: FetchJsonOptions<T>): Promise<T> {
  if((await import('cloudflare:workers')).env.ISOLATED_DEMO==='true')throw new Error('External discovery disabled in isolated demo');
  const now = o.now ?? new Date();
  // Integration registry (phase 6 M5): disabled or licence-required sources are never called.
  await assertIntegrationAllowed(db, o.provider);
  if (o.staleOnError) {
    try { return await fetchJsonOnce(db, o, now); } catch (error) {
      const stale = o.cacheKey ? await cacheGetStale(db, `${o.provider}:${o.cacheKey}`) : undefined;
      if (stale !== undefined) return o.schema.parse(stale);
      throw error;
    }
  }
  return fetchJsonOnce(db, o, now);
}

/** The last cached value whatever its age (for "source unavailable, showing data synchronized on …"). */
async function cacheGetStale(db: Db, key: string): Promise<unknown | undefined> {
  const [row] = await db.select().from(sourceCache).where(eq(sourceCache.key, key));
  return row ? JSON.parse(row.value) : undefined;
}

// Source backoff (phase 21 §1.4): after a call ends in 429, 5xx or a network error the provider cools down
// (5 min, doubling per consecutive failure, capped at 6 h) so a struggling source is not hammered by every tick.
// Three consecutive failures mark it degraded (Settings → Integrations and Command show it). A success clears both.
const coolKey = (p: string) => `cool:${p}`;
export type SourceHealth = { failures: number; until: string | null; lastError: string | null };

export async function sourceHealth(db: Db, provider: string): Promise<SourceHealth> {
  const [row] = await db.select().from(systemState).where(eq(systemState.key, coolKey(provider)));
  if (!row) return { failures: 0, until: null, lastError: null };
  try { return JSON.parse(row.value) as SourceHealth; } catch { return { failures: 0, until: null, lastError: null }; }
}

export const isDegraded = (h: SourceHealth) => h.failures >= 3;

/** Pure: next cooldown in ms after n consecutive failures. */
export const cooldownMs = (failures: number) => Math.min(5 * 60_000 * 2 ** Math.max(0, failures - 1), 6 * 3_600_000);

async function recordOutcome(db: Db, provider: string, ok: boolean, now: Date, error?: string) {
  if (ok) {
    const h = await sourceHealth(db, provider);
    if (h.failures) await db.delete(systemState).where(eq(systemState.key, coolKey(provider)));
    return;
  }
  const h = await sourceHealth(db, provider);
  const failures = h.failures + 1;
  const value = JSON.stringify({ failures, until: new Date(now.getTime() + cooldownMs(failures)).toISOString(), lastError: error?.slice(0, 200) ?? null });
  await db.insert(systemState).values({ key: coolKey(provider), value, updatedAt: now.toISOString() }).onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now.toISOString() } });
}

async function fetchJsonOnce<T>(db: Db, o: FetchJsonOptions<T>, now: Date): Promise<T> {
  if (o.cacheKey) {
    const hit = await cacheGet(db, `${o.provider}:${o.cacheKey}`, now);
    if (hit !== undefined) return o.schema.parse(hit);
  }
  const health = await sourceHealth(db, o.provider);
  if (health.until && health.until > now.toISOString()) throw new SourceError(o.provider, `cooling down after ${health.failures} failure(s) until ${health.until.slice(11, 16)} UTC`, 429, true);
  try {
    const data = await fetchJsonAttempts(db, o, now);
    await recordOutcome(db, o.provider, true, now);
    return data;
  } catch (error) {
    const e = error as SourceError;
    // Only upstream trouble cools a source down; a 4xx (our request) or a schema mismatch does not.
    if (e.status === undefined ? /network error/.test(e.message) : e.retryable) await recordOutcome(db, o.provider, false, now, e.message);
    throw error;
  }
}

async function fetchJsonAttempts<T>(db: Db, o: FetchJsonOptions<T>, now: Date): Promise<T> {
  const doFetch = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 2;
  let lastError: SourceError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await doFetch(o.url, {
        ...o.init,
        headers: { "user-agent": USER_AGENT, accept: o.as === "text" ? "*/*" : "application/json", ...(o.init?.headers ?? {}) },
        signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
      });
    } catch (error) {
      lastError = new SourceError(o.provider, `network error: ${(error as Error).message}`, undefined, true);
      await logCall(db, { provider: o.provider, endpoint: o.endpoint, ok: false, detail: lastError.message });
      if (attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
      throw lastError;
    }
    if (res.ok) {
      let data: T;
      try {
        data = o.schema.parse(o.as === "text" ? await res.text() : await res.json());
      } catch (error) {
        await logCall(db, { provider: o.provider, endpoint: o.endpoint, ok: false, httpStatus: res.status, detail: `invalid response: ${(error as Error).message}` });
        throw new SourceError(o.provider, "response did not match the expected shape", res.status);
      }
      await logCall(db, { provider: o.provider, endpoint: o.endpoint, ok: true, httpStatus: res.status, credits: o.credits?.(data) ?? 0 });
      if (o.cacheKey && o.cacheTtlMs) await cacheSet(db, `${o.provider}:${o.cacheKey}`, o.provider, data, o.cacheTtlMs, now);
      return data;
    }
    const body = (await res.text()).slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    lastError = new SourceError(o.provider, `HTTP ${res.status}: ${body}`, res.status, retryable);
    await logCall(db, { provider: o.provider, endpoint: o.endpoint, ok: false, httpStatus: res.status, detail: body });
    if (!retryable || attempt === retries) throw lastError;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 1000 * 2 ** attempt);
  }
  throw lastError ?? new SourceError(o.provider, "unknown error");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
