// Steward source pipeline (phase 28B): licence check → fetch → validate → normalise → persist (fingerprints, revisions)
// → state. Every attempt is logged with its context, including failures and empty results; a failure never becomes a
// zero or a "low risk", and connector health is kept apart from data freshness.
import { and, asc, desc, eq, or } from "drizzle-orm";
import type { Db } from "@/db";
import { stewardPlaces, stewardSourceFetches, stewardSourceRecords, stewardSources } from "@/db/schema";
import type { DataState } from "@/lib/steward/vocab";
import { ADAPTERS, SourceUnavailable, type SourceRecord } from "./adapters";
import { STEWARD_SOURCES } from "./catalog";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");

/** Writes the catalogue into the register. Live state (health after a run, last success, latest observation) is kept. */
export async function syncSourceRegister(db: Db) {
  for (const s of STEWARD_SOURCES) {
    const catalogue = { ...s, updatedAt: new Date().toISOString() };
    const { health: _h, enabled: _e, ...descriptive } = catalogue;
    void _h; void _e;
    await db.insert(stewardSources).values(catalogue).onConflictDoUpdate({ target: stewardSources.key, set: descriptive });
    // A source can only be switched on here by the catalogue; it is switched off whenever the catalogue says so.
    if (!s.enabled) await db.update(stewardSources).set({ enabled: false, health: s.health }).where(eq(stewardSources.key, s.key));
  }
}

export type RunResult = { state: DataState; fetchId: string; records: number; added: number; revised: number; excluded: number; message: string };

/** One bounded query of one source for one place. Idempotent: running it again never duplicates records. */
export async function runSourceForPlace(db: Db, input: { placeId: string; sourceKey: string; actor: string; fetchImpl?: typeof fetch; env?: Record<string, string | undefined>; now?: Date }): Promise<RunResult> {
  const now = input.now ?? new Date();
  const [place] = await db.select().from(stewardPlaces).where(eq(stewardPlaces.id, input.placeId));
  if (!place) throw new Error("Place not found");
  const [source] = await db.select().from(stewardSources).where(eq(stewardSources.key, input.sourceKey));
  const log = async (state: DataState, extra: Partial<typeof stewardSourceFetches.$inferInsert> = {}) => {
    const [row] = await db.insert(stewardSourceFetches).values({ mandateId: place.mandateId, placeId: place.id, sourceKey: input.sourceKey, query: extra.query ?? {}, state, actor: input.actor, finishedAt: new Date().toISOString(), ...extra }).returning({ id: stewardSourceFetches.id });
    return row.id;
  };
  if (!source) return { state: "no_coverage", fetchId: await log("no_coverage", { error: "Source is not in the register." }), records: 0, added: 0, revised: 0, excluded: 0, message: "Source not in the register." };
  const adapter = ADAPTERS[source.key];
  if (!source.enabled || !adapter) {
    const why = source.blockedReason || (adapter ? "Source disabled." : "No automated connector: this source is a download, licence or reference.");
    return { state: "restricted", fetchId: await log("restricted", { error: why }), records: 0, added: 0, revised: 0, excluded: 0, message: why };
  }
  if (!place.geometry) return { state: "insufficient", fetchId: await log("insufficient", { error: "The place has no geometry to query." }), records: 0, added: 0, revised: 0, excluded: 0, message: "Add a boundary or point to the place first." };

  let result;
  try {
    result = await adapter({ geometry: place.geometry as never, fetchImpl: input.fetchImpl ?? fetch, env: input.env ?? {}, now });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    const err = e instanceof SourceUnavailable ? e : new SourceUnavailable(timedOut ? "The source did not answer in time (timed out)." : (e as Error).message);
    await db.update(stewardSources).set({ health: "failing", lastCheckedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(stewardSources.key, source.key));
    const fetchId = await log("failed", { error: err.message.slice(0, 600), httpStatus: err.httpStatus ?? null, limitations: "The query failed; nothing is concluded from it." });
    return { state: "failed", fetchId, records: 0, added: 0, revised: 0, excluded: 0, message: err.message };
  }

  const payloadHash = await sha(result.payloadText);
  const [fetchRow] = await db.insert(stewardSourceFetches).values({
    mandateId: place.mandateId, placeId: place.id, sourceKey: source.key, query: result.query, state: "pending", httpStatus: result.httpStatus, actor: input.actor, payloadHash, limitations: result.limitations.join(" "),
  }).returning({ id: stewardSourceFetches.id });
  let added = 0, revised = 0, latest: string | null = null;
  for (const r of result.records) {
    const content = JSON.stringify([r.title, r.value ?? null, r.unit ?? "", r.observedStart ?? null, r.geometry ?? null, r.precisionM ?? null, r.qualityFlags ?? [], r.license ?? "", r.datasetVersion ?? ""]);
    const contentHash = await sha(content);
    const fingerprint = await sha(`${source.key}|${r.recordId}|${r.datasetVersion ?? ""}`);
    if (r.observedStart && (!latest || r.observedStart > latest)) latest = r.observedStart;
    const [existing] = await db.select({ id: stewardSourceRecords.id, contentHash: stewardSourceRecords.contentHash, revision: stewardSourceRecords.revision }).from(stewardSourceRecords)
      .where(and(eq(stewardSourceRecords.placeId, place.id), eq(stewardSourceRecords.sourceKey, source.key), eq(stewardSourceRecords.recordId, r.recordId)));
    const values = toRow(r, { mandateId: place.mandateId, placeId: place.id, sourceKey: source.key, fingerprint, contentHash, fetchId: fetchRow.id, retrievedAt: now.toISOString() });
    if (!existing) { await db.insert(stewardSourceRecords).values(values); added++; }
    else if (existing.contentHash !== contentHash) { await db.update(stewardSourceRecords).set({ ...values, revision: existing.revision + 1, lastSeenAt: now.toISOString(), reviewStatus: "unreviewed" }).where(eq(stewardSourceRecords.id, existing.id)); revised++; }
    else await db.update(stewardSourceRecords).set({ lastSeenAt: now.toISOString(), fetchId: fetchRow.id }).where(eq(stewardSourceRecords.id, existing.id));
  }
  const state: DataState = result.records.length ? "available" : "no_records";
  await db.update(stewardSourceFetches).set({ state, finishedAt: new Date().toISOString(), recordCount: result.records.length, newCount: added, revisedCount: revised, excludedCount: result.excluded, latestObservation: latest }).where(eq(stewardSourceFetches.id, fetchRow.id));
  await db.update(stewardSources).set({ health: "verified", lastCheckedAt: now.toISOString(), lastSuccessAt: now.toISOString(), ...(latest && (!source.latestObservation || latest > source.latestObservation) ? { latestObservation: latest } : {}), updatedAt: now.toISOString() }).where(eq(stewardSources.key, source.key));
  return { state, fetchId: fetchRow.id, records: result.records.length, added, revised, excluded: result.excluded,
    message: state === "available" ? `${result.records.length} records (${added} new, ${revised} revised${result.excluded ? `, ${result.excluded} excluded by licence` : ""}).` : "Query completed: no matching records. This is not evidence of absence." };
}

function toRow(r: SourceRecord, base: { mandateId: string; placeId: string; sourceKey: string; fingerprint: string; contentHash: string; fetchId: string; retrievedAt: string }): typeof stewardSourceRecords.$inferInsert {
  return { ...base, recordId: r.recordId, title: r.title.slice(0, 300), value: r.value ?? null, unit: r.unit ?? "", observedStart: r.observedStart ?? null, observedEnd: r.observedEnd ?? null, publishedAt: r.publishedAt ?? null,
    geometry: r.geometry ?? null, precisionM: r.precisionM ?? null, resolution: r.resolution ?? "", method: r.method ?? "", qualityFlags: r.qualityFlags ?? [], uncertainty: r.uncertainty ?? "",
    license: r.license ?? "", sourceUrl: r.sourceUrl ?? "", datasetVersion: r.datasetVersion ?? "", sensitive: !!r.sensitive, payload: r.payload ?? null };
}

/** The latest state per source for a place: what was asked, when, and what came back (or why nothing did). */
export async function placeSourceStates(db: Db, placeId: string) {
  const [sources, fetches] = await Promise.all([
    db.select().from(stewardSources).orderBy(asc(stewardSources.accessMethod), asc(stewardSources.name)),
    db.select().from(stewardSourceFetches).where(eq(stewardSourceFetches.placeId, placeId)),
  ]);
  return sources.map(s => {
    const mine = fetches.filter(f => f.sourceKey === s.key).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const last = mine[0] ?? null;
    const stale = last?.state === "available" && s.refreshDays > 0 && Date.parse(last.startedAt) < Date.now() - s.refreshDays * 86_400_000;
    return { source: s, last, state: (last ? (stale ? "stale" : last.state) : "not_queried") as DataState };
  });
}

/** Places due a refresh under each source's policy, for the scheduled job. Bounded per run. */
export async function dueSourceRuns(db: Db, now: Date, limit = 12) {
  const [places, sources] = await Promise.all([db.select({ id: stewardPlaces.id, geometry: stewardPlaces.geometry }).from(stewardPlaces), db.select().from(stewardSources).where(eq(stewardSources.enabled, true))]);
  const out: { placeId: string; sourceKey: string }[] = [];
  for (const s of sources.filter(x => ADAPTERS[x.key])) {
    for (const p of places.filter(x => x.geometry)) {
      const [last] = await db.select({ startedAt: stewardSourceFetches.startedAt }).from(stewardSourceFetches)
        .where(and(eq(stewardSourceFetches.placeId, p.id), eq(stewardSourceFetches.sourceKey, s.key), or(eq(stewardSourceFetches.state, "available"), eq(stewardSourceFetches.state, "no_records"))))
        .orderBy(desc(stewardSourceFetches.startedAt)).limit(1);
      if (!last || Date.parse(last.startedAt) < now.getTime() - s.refreshDays * 86_400_000) out.push({ placeId: p.id, sourceKey: s.key });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
