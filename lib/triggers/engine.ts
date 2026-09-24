// Trigger engine (SPEC section 4): scan free sources, keep only current signals, classify them for
// Regenera's scope with Claude Haiku, write a decision read with Claude Sonnet, then link the trigger
// to an organization with a map location.
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { signals, triggerQueries, triggers } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { upsertOrganization } from "@/lib/crm/entities";
import { enqueue } from "@/lib/jobs/queue";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { SourceError } from "@/lib/sources/http";
import { formDSignals, gdacsSignals, gdeltSignals, tedSignals, worldBankSignals, type RawSignal } from "@/lib/sources/signals";
import { ENGAGEMENT_PATHS, ENGAGEMENTS, PRACTICES, SECTORS, TERRITORIAL_SYSTEMS, TRIGGER_TYPES } from "@/lib/vocab";

const RESCAN_MS: Record<string, number> = {
  gdelt: 8 * 3_600_000, ted: 24 * 3_600_000, worldbank: 24 * 3_600_000, edgar_form_d: 24 * 3_600_000, gdacs: 3 * 3_600_000,
};
export const RELEVANCE_THRESHOLD = 60;
export const MAX_READS_PER_DAY = 40;

type Fetchers = {
  [K in RawSignal["source"]]: (db: Db, query: string, now: Date) => Promise<RawSignal[]>;
};
const DEFAULT_FETCHERS: Fetchers = {
  gdelt: (db, q, now) => gdeltSignals(db, q, now),
  ted: (db, q, now) => tedSignals(db, q, now),
  worldbank: (db, q, now) => worldBankSignals(db, q, now),
  edgar_form_d: (db, q, now) => formDSignals(db, q, now),
  gdacs: (db, _q, now) => gdacsSignals(db, now),
};

/** Runs the most overdue enabled queries: at most one GDELT query (5 s rate rule) and two others per call. */
export async function scanDueQueries(db: Db, now = new Date(), fetchers: Fetchers = DEFAULT_FETCHERS): Promise<{ ran: string[]; inserted: number; skipped: string[] }> {
  const all = await db.select().from(triggerQueries).where(eq(triggerQueries.enabled, true)).orderBy(asc(sql`coalesce(${triggerQueries.lastRunAt}, '')`));
  const due = all.filter(q => !q.lastRunAt || now.getTime() - new Date(q.lastRunAt).getTime() >= (RESCAN_MS[q.source] ?? 86_400_000));
  const picked = [...due.filter(q => q.source === "gdelt").slice(0, 1), ...due.filter(q => q.source !== "gdelt").slice(0, 2)];
  let inserted = 0;
  const ran: string[] = [], skipped: string[] = [];
  for (const q of picked) {
    let found: RawSignal[];
    try {
      found = await fetchers[q.source as RawSignal["source"]](db, q.query, now);
    } catch (error) {
      if (error instanceof SourceError && error.retryable) { skipped.push(q.key); continue; }
      throw error;
    }
    for (const s of found) {
      const rows = await db.insert(signals).values({
        source: s.source, externalId: s.externalId, title: s.title.slice(0, 500), url: s.url, publishedAt: s.publishedAt,
        deadline: s.deadline ?? null, country: s.country ?? null, lat: s.lat ?? null, lng: s.lng ?? null,
        orgName: s.orgName ?? null, summary: s.summary ?? "", queryKey: q.key,
      }).onConflictDoNothing().returning({ id: signals.id });
      inserted += rows.length;
    }
    await db.update(triggerQueries).set({ lastRunAt: now.toISOString(), lastCount: found.length, updatedAt: now.toISOString() }).where(eq(triggerQueries.id, q.id));
    ran.push(q.key);
  }
  if (inserted > 0) await enqueue(db, "triggers.classify", {}, { dedupeKey: `classify:${now.toISOString().slice(0, 16)}`, now });
  return { ran, inserted, skipped };
}

const zClassification = z.object({
  items: z.array(z.object({
    index: z.number().int(),
    relevant: z.boolean(),
    relevance: z.number().int().min(0).max(100),
    trigger_type: z.enum(TRIGGER_TYPES),
    org_name: z.string().describe("Organization that holds the decision; empty if none"),
    country: z.string().describe("Country name; empty if unknown"),
    city: z.string().describe("City or region; empty if unknown"),
    urgency: z.number().int().min(1).max(5),
    reason: z.string(),
  })),
});

/** Classifies up to `batch` new signals in one Haiku call. Relevant ones get a decision-read job. */
export async function classifyNewSignals(db: Db, cfg: AiConfig, batch = 15, now = new Date(), client?: Anthropic): Promise<{ classified: number; relevant: number }> {
  const pending = await db.select().from(signals).where(eq(signals.status, "new")).orderBy(asc(signals.publishedAt)).limit(batch);
  if (pending.length === 0) return { classified: 0, relevant: 0 };
  const input = pending.map((s, i) => [
    `#${i}`, `source: ${s.source}`, `published: ${s.publishedAt.slice(0, 10)}`, s.deadline ? `deadline: ${s.deadline.slice(0, 10)}` : "",
    `title: ${s.title}`, s.orgName ? `organization: ${s.orgName}` : "", s.country ? `country: ${s.country}` : "", s.summary ? `note: ${s.summary}` : "", `url: ${s.url}`,
  ].filter(Boolean).join("\n")).join("\n\n");
  const out = await runStructured(db, cfg, "trigger.classify", `Today is ${now.toISOString().slice(0, 10)}. Classify these ${pending.length} signals.\n\n${input}`, zClassification, { entity: "signals" }, client);
  let relevant = 0;
  for (const item of out.items) {
    const s = pending[item.index];
    if (!s) continue;
    const isRelevant = item.relevant && item.relevance >= RELEVANCE_THRESHOLD;
    await db.update(signals).set({
      status: isRelevant ? "relevant" : "irrelevant", relevance: item.relevance,
      orgName: s.orgName ?? (item.org_name || null), country: s.country ?? (item.country || null),
      summary: [s.summary, `type=${item.trigger_type}`, `urgency=${item.urgency}`, item.city ? `city=${item.city}` : "", item.reason].filter(Boolean).join(" · ").slice(0, 1000),
      updatedAt: now.toISOString(),
    }).where(eq(signals.id, s.id));
    if (isRelevant) {
      relevant++;
      await enqueue(db, "triggers.read", { signalId: s.id }, { dedupeKey: `read:${s.id}`, now });
    }
  }
  // Anything the model skipped goes back through once more, then is marked irrelevant.
  const answered = new Set(out.items.map(i => i.index));
  for (const [i, s] of pending.entries()) {
    if (!answered.has(i)) await db.update(signals).set({ status: "irrelevant", summary: `${s.summary} · not classified` }).where(eq(signals.id, s.id));
  }
  if (pending.length === batch) await enqueue(db, "triggers.classify", {}, { dedupeKey: `classify:${now.toISOString()}`, now });
  return { classified: pending.length, relevant };
}

const zDecisionRead = z.object({
  decision_read: z.string(),
  org_name: z.string(),
  event_date: z.string().describe("YYYY-MM-DD"),
  trigger_type: z.enum(TRIGGER_TYPES),
  urgency: z.number().int().min(1).max(5),
  engagement_path: z.enum(ENGAGEMENT_PATHS),
  engagement: z.enum(Object.keys(ENGAGEMENTS) as [string, ...string[]]),
  practices: z.array(z.enum(Object.keys(PRACTICES) as [string, ...string[]])),
  sectors: z.array(z.enum(Object.keys(SECTORS) as [string, ...string[]])),
  territorial_systems: z.array(z.enum(Object.keys(TERRITORIAL_SYSTEMS) as [string, ...string[]])),
  suggested_titles: z.array(z.string()),
  location: z.string().describe("City and country of the project or organization, as specific as the signal allows"),
});

export async function readsToday(db: Db, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(triggers).where(sql`${triggers.createdAt} >= ${start} AND ${triggers.signalId} IS NOT NULL`);
  return n;
}

/** Turns one relevant signal into a trigger with a decision read, linked organization and location text. */
export async function readSignal(db: Db, cfg: AiConfig, signalId: string, now = new Date(), client?: Anthropic): Promise<string | null> {
  const [s] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!s || s.status !== "relevant") return null;
  if ((await readsToday(db, now)) >= MAX_READS_PER_DAY) {
    await enqueue(db, "triggers.read", { signalId }, { runAfter: new Date(now.getTime() + 6 * 3_600_000), dedupeKey: `read:${signalId}:${now.toISOString().slice(0, 10)}`, now });
    return null;
  }
  const input = [
    `Today is ${now.toISOString().slice(0, 10)}.`, `Source: ${s.source}`, `Title: ${s.title}`, `Published: ${s.publishedAt.slice(0, 10)}`,
    s.deadline ? `Deadline: ${s.deadline.slice(0, 10)}` : "", s.orgName ? `Organization named in source: ${s.orgName}` : "",
    s.country ? `Country: ${s.country}` : "", `Classifier notes: ${s.summary}`, `URL: ${s.url}`,
  ].filter(Boolean).join("\n");
  const read = await runStructured(db, cfg, "trigger.decision_read", input, zDecisionRead, { entity: "signal", entityId: s.id }, client);

  const org = await upsertOrganization(db, REGENERA_MANDATE_ID, {
    name: read.org_name || s.orgName || s.title.slice(0, 80),
    country: s.country ?? null,
    location: read.location || s.country || null,
    sector: read.sectors[0] ?? null,
    lat: s.lat ?? null, lng: s.lng ?? null, geoSource: s.lat != null ? s.source : null,
  }, "trigger", { source: s.source, url: s.url, confidence: "medium" });

  const [trigger] = await db.insert(triggers).values({
    mandateId: REGENERA_MANDATE_ID,
    orgId: org.row.id,
    type: read.trigger_type,
    summary: s.title.slice(0, 300),
    eventDate: read.event_date || s.publishedAt.slice(0, 10),
    sourceUrl: s.url,
    source: s.source,
    urgency: read.urgency,
    country: s.country ?? null,
    lat: s.lat ?? org.row.lat ?? null,
    lng: s.lng ?? org.row.lng ?? null,
    signalId: s.id,
    relevance: s.relevance,
    suggestedEngagement: JSON.stringify({
      path: read.engagement_path, engagement: read.engagement, practices: read.practices, sectors: read.sectors,
      systems: read.territorial_systems, titles: read.suggested_titles, location: read.location,
    }),
    decisionRead: read.decision_read,
  }).returning();
  await db.update(signals).set({ status: "triggered", updatedAt: now.toISOString() }).where(eq(signals.id, s.id));
  if (org.row.lat == null) await enqueue(db, "geo.org", { orgId: org.row.id }, { dedupeKey: `geo:${org.row.id}`, now });
  return trigger.id;
}

/** Copies an organization's coordinates onto its triggers that have none (after geocoding). */
export async function backfillTriggerCoordinates(db: Db, orgId: string, lat: number, lng: number) {
  await db.update(triggers).set({ lat, lng }).where(and(eq(triggers.orgId, orgId), or(isNull(triggers.lat), isNull(triggers.lng))));
}

/** Housekeeping: signals older than the freshness floor are dropped from the queue. */
export async function expireStaleSignals(db: Db, floorIso: string) {
  await db.update(signals).set({ status: "irrelevant" }).where(and(inArray(signals.status, ["new", "relevant"]), lt(signals.publishedAt, floorIso)));
}
