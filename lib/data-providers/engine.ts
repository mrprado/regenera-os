// Data-provider engine: mirror the catalogue into the database, compute each dataset's connection from real
// results, sync (resolve provider ids, probe), health for admins, licence checks before export, and reads with
// explicit fallback (live → cached → last known → source link only → unavailable). Never fabricates a response.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { dataProviders, datasets, datasetSyncJobs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { CredentialRequired } from "@/lib/integrations/adapters";
import { eeStatus } from "@/lib/providers/earth-engine";
import { DATASETS, PROVIDERS, datasetOf } from "./catalog";
import type { Connection, RegeneraDataset } from "./types";
import { gfwDatasetMeta } from "./wri/global-forest-watch";
import { pickDataset, rwSearch } from "./wri/resource-watch";

type Row = typeof datasets.$inferSelect;
const STALE_DAYS = 45;

/** Seeds / refreshes the registry from the catalogue. Live state (connection, sync, failures) is preserved. */
export async function ensureDataRegistry(db: Db) {
  for (const p of PROVIDERS) await db.insert(dataProviders).values({ key: p.key, name: p.name, tier: p.tier }).onConflictDoUpdate({ target: dataProviders.key, set: { name: p.name, tier: p.tier } });
  const have = new Map((await db.select({ id: datasets.id }).from(datasets)).map(r => [r.id, true]));
  for (const d of DATASETS) {
    if (have.has(d.id)) await db.update(datasets).set({ record: d, name: d.name, category: d.category, provider: d.provider, platform: d.platform ?? null, updatedAt: new Date().toISOString() }).where(eq(datasets.id, d.id));
    else await db.insert(datasets).values({ id: d.id, provider: d.provider, platform: d.platform ?? null, name: d.name, category: d.category, record: d, connection: baseConnection(d, {}) });
  }
  return DATASETS.length;
}

/** Connection before any sync: what the configuration allows. */
export function baseConnection(d: RegeneraDataset, env: Record<string, string | undefined>): Connection {
  if (d.adapter) return "api_available";
  if (d.sourceType === "download") return "download_only";
  if (d.sourceType === "manual") return "external";
  if (d.sourceType === "earth-engine") return eeStatus(env).connected ? "api_available" : "external";
  return "not_connected";
}

/** Status shown to people: from the last real success, else configuration. `needsKey` when an env var is missing. */
export function statusOf(d: RegeneraDataset, row: Pick<Row, "lastSuccessAt" | "failures" | "lastSyncedAt" | "deprecated"> | null, env: Record<string, string | undefined>, now = new Date()) {
  const needsKey = !!d.envVar && !env[d.envVar];
  const stale = row?.lastSuccessAt ? now.getTime() - Date.parse(row.lastSuccessAt) > STALE_DAYS * 86_400_000 : false;
  const connection: Connection = row?.lastSuccessAt && !needsKey ? "connected" : baseConnection(d, env);
  const health = row?.deprecated ? "deprecated" : needsKey ? "needs_key" : (row?.failures ?? 0) >= 3 ? "failing" : stale ? "stale" : row?.lastSuccessAt ? "healthy" : connection === "api_available" ? "not_synced" : "metadata_only";
  return { connection, health, needsKey, stale };
}

export const HEALTH_LABEL: Record<string, string> = { healthy: "Healthy", stale: "Stale", failing: "Failing", needs_key: "Key needed", not_synced: "Not synced yet", metadata_only: "Metadata and link", deprecated: "Deprecated" };

async function record(db: Db, id: string, ok: boolean, detail: string, patch: Partial<Row> = {}) {
  const now = new Date().toISOString();
  const [row] = await db.select().from(datasets).where(eq(datasets.id, id));
  await db.insert(datasetSyncJobs).values({ datasetId: id, status: ok ? "ok" : "failed", detail: detail.slice(0, 500), finishedAt: now });
  await db.update(datasets).set({ ...patch, lastSyncedAt: now, ...(ok ? { lastSuccessAt: now, failures: 0, lastError: null, connection: "connected" } : { failures: (row?.failures ?? 0) + 1, lastError: detail.slice(0, 300) }), updatedAt: now }).where(eq(datasets.id, id));
}

/** One dataset sync: resolve the provider's dataset id / metadata with a real call. */
export async function syncDataset(db: Db, id: string, env: Record<string, string | undefined>, actor: string, fetchImpl?: typeof fetch) {
  const d = datasetOf(id);
  if (!d) throw new Error("Unknown dataset");
  try {
    if (d.adapter === "resource_watch") {
      const search = d.externalId ?? d.name;
      const list = await rwSearch(db, search, fetchImpl);
      const hit = id === "wri.rw.catalog" ? list[0] ?? null : pickDataset(list, search);
      if (!hit) { await record(db, id, false, `No Resource Watch dataset matched "${search}"`); return { ok: false, detail: `No Resource Watch dataset matched "${search}"` }; }
      await record(db, id, true, `Resolved ${hit.name} (${hit.id}, ${hit.connector ?? "?"})`, { resolvedRef: JSON.stringify(hit), providerUpdatedAt: hit.updatedAt });
      return { ok: true, detail: `Resolved ${hit.name}` };
    }
    if (d.adapter === "gfw") {
      const slug = (d.externalId ?? "").split(/[\s/]/)[0];
      if (!slug || slug.includes("(")) throw new Error("Dataset slug to verify before sync");
      await gfwDatasetMeta(db, slug, fetchImpl);
      const detail = env.GFW_API_KEY ? `Metadata reachable (${slug})` : `Metadata reachable (${slug}); zonal queries need GFW_API_KEY`;
      if (!env.GFW_API_KEY) { await db.insert(datasetSyncJobs).values({ datasetId: id, status: "skipped", detail, finishedAt: new Date().toISOString() }); await db.update(datasets).set({ lastSyncedAt: new Date().toISOString(), lastError: "GFW_API_KEY not set" }).where(eq(datasets.id, id)); return { ok: false, detail }; }
      await record(db, id, true, detail);
      return { ok: true, detail };
    }
    await db.insert(datasetSyncJobs).values({ datasetId: id, status: "skipped", detail: "Metadata only: no API adapter", finishedAt: new Date().toISOString() });
    return { ok: false, detail: "Metadata only: no API adapter" };
  } catch (e) {
    const detail = e instanceof CredentialRequired ? e.message : (e as Error).message;
    await record(db, id, false, detail);
    return { ok: false, detail };
  } finally {
    await audit(db, { actor, action: "dataset_sync", entity: "datasets", entityId: id });
  }
}

export async function syncProvider(db: Db, provider: string, env: Record<string, string | undefined>, actor: string, fetchImpl?: typeof fetch) {
  const out: { id: string; ok: boolean; detail: string }[] = [];
  for (const d of DATASETS.filter(x => x.provider === provider && x.adapter && ["resource_watch", "gfw"].includes(x.adapter))) out.push({ id: d.id, ...(await syncDataset(db, d.id, env, actor, fetchImpl)) });
  return out;
}

/** §24–25 Health for admins: counts reflect actual adapter / configuration state. */
export async function providerHealth(db: Db, env: Record<string, string | undefined>, now = new Date()) {
  const rows = await db.select().from(datasets);
  const byId = new Map(rows.map(r => [r.id, r]));
  return PROVIDERS.map(p => {
    const ds = DATASETS.filter(d => d.provider === p.key).map(d => ({ d, row: byId.get(d.id) ?? null, s: statusOf(d, byId.get(d.id) ?? null, env, now) }));
    const platforms = p.platforms.map(pl => {
      const inPl = ds.filter(x => x.d.platform === pl.key);
      const worst = ["failing", "needs_key", "stale", "not_synced", "metadata_only", "healthy"].find(h => inPl.some(x => x.s.health === h)) ?? "metadata_only";
      return { ...pl, datasets: inPl.length, health: inPl.length ? worst : "metadata_only", connected: inPl.filter(x => x.s.connection === "connected").length };
    });
    const last = ds.map(x => x.row?.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
    return { p, datasets: ds, platforms, connected: ds.filter(x => x.s.connection === "connected").length, failures: ds.reduce((a, x) => a + (x.row?.failures ?? 0), 0), lastSync: last,
      licenseVerify: ds.filter(x => x.d.commercialUse === null || x.d.redistribution === null).length };
  });
}

export async function recentSyncs(db: Db, limit = 30) {
  return db.select().from(datasetSyncJobs).orderBy(desc(datasetSyncJobs.startedAt)).limit(limit);
}

/** §22 EXPORT DATASET CHECK: what may be packaged; restricted data exports as analysis + citation only. */
export function exportCheck(ids: string[]) {
  return ids.map(id => datasetOf(id)).filter((d): d is RegeneraDataset => !!d).map(d => ({
    id: d.id, name: d.name, citation: d.attributionText, sourceUrl: d.sourceUrl, license: d.license, methodologyUrl: d.methodologyUrl ?? null, version: d.version ?? null, limitation: d.limitations[0] ?? null,
    raw: d.redistribution === true ? "allowed" : d.redistribution === false ? "prohibited" : "verify",
    commercial: d.commercialUse === true ? "allowed" : d.commercialUse === false ? "prohibited" : "verify",
  }));
}

/** §23 "Data sources" block for reports and memos. */
export function dataSourcesBlock(ids: string[], accessed: string) {
  return exportCheck([...new Set(ids)]).map(x => `${x.name}. ${x.citation}.${x.version ? ` Version ${x.version}.` : ""} Accessed ${accessed}. Licence: ${x.license}.${x.methodologyUrl ? ` Methodology: ${x.methodologyUrl}.` : ""}${x.limitation ? ` Limitation: ${x.limitation}.` : ""}${x.raw !== "allowed" ? " Raw data not redistributed." : ""}`);
}

export async function datasetRows(db: Db, ids?: string[]) {
  return ids?.length ? db.select().from(datasets).where(inArray(datasets.id, ids)) : db.select().from(datasets);
}

export async function markLicenseReviewed(db: Db, provider: string, actor: string) {
  await db.update(dataProviders).set({ licenseReviewedBy: actor, licenseReviewedAt: new Date().toISOString() }).where(and(eq(dataProviders.key, provider)));
  await audit(db, { actor, action: "data_license_review", entity: "data_providers", entityId: provider });
}
