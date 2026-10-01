// Public interconnection queues (docs/plans/phase-14-mandates.md §14, §20): MISO (JSON) and SPP (CSV), both keyless
// public files, fetched through the integration registry (ledger, cache, feature gate). A position's developer is not
// published by these queues. Changes between syncs become mandate signals; nothing is inferred as confirmed.
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { queueProjects } from "@/db/schema";
import { chunk } from "@/lib/db/chunk";
import { parseCsv } from "@/lib/import/csv";
import { fetchJson } from "@/lib/sources/http";
import { technologyOf } from "./fit";

export type QueueRow = { key: string; iso: string; number: string; state: string; county: string; poi: string; transmissionOwner: string; fuel: string; technology: string; mw: number | null; mwWinter: number | null; queueDate: string | null; inServiceDate: string | null; withdrawnDate: string | null; status: string; studyPhase: string; iaStatus: string; raw: Record<string, unknown> };

export const QUEUE_SOURCES = {
  miso: { label: "MISO generator interconnection queue", url: "https://www.misoenergy.org/api/giqueue/getprojects", page: "https://www.misoenergy.org/planning/resource-utilization/GI_Queue/gi-interactive-queue/", provider: "miso_queue" },
  spp: { label: "SPP generation interconnection active requests", url: "https://opsportal.spp.org/Studies/GenerateActiveCSV", page: "https://opsportal.spp.org/Studies/GIActive", provider: "spp_queue" },
} as const;
export type QueueIso = keyof typeof QUEUE_SOURCES;

const d = (s: unknown) => { const t = String(s ?? "").trim(); if (!t) return null; const x = new Date(t); return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10); };
const n = (s: unknown) => { const x = Number(String(s ?? "").replace(/,/g, "")); return Number.isFinite(x) && x > 0 ? x : null; };

const zMiso = z.array(z.object({ projectNumber: z.string(), queueDate: z.string().nullish(), inService: z.string().nullish(), withdrawnDate: z.string().nullish(), transmissionOwner: z.string().nullish(), county: z.string().nullish(), state: z.string().nullish(), studyPhase: z.string().nullish(), poiName: z.string().nullish(), summerNetMW: z.number().nullish(), winterNetMW: z.number().nullish(), fuelType: z.string().nullish(), facilityType: z.string().nullish(), applicationStatus: z.string().nullish(), postGIAStatus: z.string().nullish(), studyCycle: z.string().nullish() }).passthrough());

export function normalizeMiso(rows: z.infer<typeof zMiso>): QueueRow[] {
  return rows.map(r => ({
    key: `MISO:${r.projectNumber}`, iso: "MISO", number: r.projectNumber, state: (r.state ?? "").trim().toUpperCase(), county: (r.county ?? "").trim(), poi: (r.poiName ?? "").trim(), transmissionOwner: (r.transmissionOwner ?? "").trim(),
    fuel: [r.fuelType, r.facilityType].filter(Boolean).join(" / "), technology: technologyOf(r.fuelType ?? "", r.facilityType ?? ""),
    mw: n(r.summerNetMW), mwWinter: n(r.winterNetMW), queueDate: d(r.queueDate), inServiceDate: d(r.inService), withdrawnDate: d(r.withdrawnDate),
    status: (r.applicationStatus ?? "").trim(), studyPhase: [r.studyCycle, r.studyPhase].filter(Boolean).join(" · "), iaStatus: r.postGIAStatus ? `Post-GIA: ${r.postGIAStatus}` : "",
    raw: r as Record<string, unknown>,
  }));
}

/** SPP active-requests CSV: a "Last Updated On" line, then the header. */
export function normalizeSpp(csv: string): QueueRow[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex(l => /Generation Interconnection Number/i.test(l));
  if (start < 0) return [];
  const rows = parseCsv(lines.slice(start).join("\n"));
  const [head, ...body] = rows;
  const ix = (name: string) => head.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
  const col = { num: ix("Generation Interconnection Number"), county: ix("Nearest Town or County"), state: ix("State"), to: ix("TO at POI"), isd: ix("In-Service Date"), cod: ix("Commercial Operation Date"), cap: ix("Capacity"), summer: ix("MAX Summer MW"), winter: ix("MAX Winter MW"), gen: ix("Generation Type"), fuel: ix("Fuel Type"), sub: ix("Substation or Line"), rec: ix("Request Received"), wd: ix("Date Withdrawn"), status: ix("Status"), cluster: ix("Current Cluster") };
  const g = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return body.filter(r => g(r, col.num)).map(r => {
    const status = g(r, col.status);
    return {
      key: `SPP:${g(r, col.num)}`, iso: "SPP", number: g(r, col.num), state: g(r, col.state).toUpperCase(), county: g(r, col.county).replace(/[,s]+$/, ""), poi: g(r, col.sub), transmissionOwner: g(r, col.to),
      fuel: [g(r, col.gen), g(r, col.fuel)].filter(Boolean).join(" / "), technology: technologyOf(g(r, col.gen), g(r, col.fuel)),
      mw: n(g(r, col.summer)) ?? n(g(r, col.cap)), mwWinter: n(g(r, col.winter)), queueDate: d(g(r, col.rec)), inServiceDate: d(g(r, col.cod)) ?? d(g(r, col.isd)), withdrawnDate: d(g(r, col.wd)),
      status, studyPhase: g(r, col.cluster), iaStatus: /IA /i.test(status) ? status : "",
      raw: Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])),
    };
  });
}

const TRACKED = ["status", "studyPhase", "iaStatus", "inServiceDate", "mw", "withdrawnDate"] as const;

/** Upserts queue rows; returns the changes (field-level) for signal generation. Idempotent. Writes are batched: new
 *  and changed rows one statement each, unchanged rows one bulk `last_seen_at` touch per 90 keys. */
export async function upsertQueue(db: Db, rows: QueueRow[], now = new Date()) {
  const at = now.toISOString();
  const changes: { key: string; field: string; from: string; to: string; isNew: boolean }[] = [];
  const stmts: unknown[] = [];
  const seen = new Map<string, QueueRow>();
  for (const r of rows) seen.set(r.key, r); // the public files occasionally repeat a key
  const uniq = [...seen.values()];
  for (const part of chunk(uniq, 90)) {
    const existing = new Map((await db.select().from(queueProjects).where(inArray(queueProjects.key, part.map(r => r.key)))).map(r => [r.key, r]));
    const unchanged: string[] = [];
    for (const r of part) {
      const prev = existing.get(r.key);
      if (!prev) {
        changes.push({ key: r.key, field: "new", from: "", to: r.status, isNew: true });
        stmts.push(db.insert(queueProjects).values({ ...r, firstSeenAt: at, lastSeenAt: at }).onConflictDoNothing());
        continue;
      }
      const diff = TRACKED.filter(f => String(prev[f] ?? "") !== String(r[f] ?? "")).map(f => ({ at, field: f, from: String(prev[f] ?? ""), to: String(r[f] ?? "") }));
      if (!diff.length && prev.county === r.county && prev.poi === r.poi) { unchanged.push(r.key); continue; }
      for (const c of diff) changes.push({ key: r.key, field: c.field, from: c.from, to: c.to, isNew: false });
      stmts.push(db.update(queueProjects).set({ ...r, lastSeenAt: at, ...(diff.length ? { lastChangedAt: at, changes: [...prev.changes, ...diff].slice(-30) } : {}) }).where(sql`${queueProjects.key} = ${r.key}`));
    }
    if (unchanged.length) stmts.push(db.update(queueProjects).set({ lastSeenAt: at }).where(inArray(queueProjects.key, unchanged)));
  }
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40) as unknown as Parameters<Db["batch"]>[0]);
  return changes;
}

export async function syncQueue(db: Db, iso: QueueIso, now = new Date(), fetchImpl?: typeof fetch) {
  const src = QUEUE_SOURCES[iso];
  const rows = iso === "miso"
    ? normalizeMiso(await fetchJson(db, { provider: src.provider, endpoint: "queue", url: src.url, schema: zMiso, timeoutMs: 60_000, fetchImpl, now }))
    : normalizeSpp(await fetchJson(db, { provider: src.provider, endpoint: "queue", url: src.url, schema: z.string(), as: "text", timeoutMs: 60_000, fetchImpl, now }));
  const changes = await upsertQueue(db, rows, now);
  // No response cache: the MISO file is ~2 MB, above the D1 value limit. The daily job and queue_projects are the cache.
  return { iso, rows: rows.length, changes };
}
