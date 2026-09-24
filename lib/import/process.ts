// CSV import processing: rows live in R2 (BUCKET), processed in chunks of 200 by the import.process job.
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, imports } from "@/db/schema";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { enqueue } from "@/lib/jobs/queue";
import { applyMapping, type ImportField, type ImportRow } from "./csv";

export const CHUNK = 200;
export type StoredImport = { headers: string[]; rows: string[][] };

export type ImportStore = {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
};

export function r2Store(bucket: R2Bucket): ImportStore {
  return {
    put: async (key, value) => { await bucket.put(key, value, { httpMetadata: { contentType: "application/json" } }); },
    get: async key => { const o = await bucket.get(key); return o ? o.text() : null; },
  };
}

export const importKey = (id: string) => `imports/${id}.json`;

/** Imports one chunk of mapped rows. Returns created/updated counts for the chunk. */
export async function importRows(db: Db, mandateId: string, rows: ImportRow[], importId: string) {
  let created = 0, updated = 0, flagged = 0;
  // Rows in a CSV repeat the same companies: resolve each distinct organization once per chunk.
  // (upsertOrganization already queues identity enrichment for new organizations.)
  const orgCache = new Map<string, string>();
  for (const r of rows) {
    if (!r.fullName && !r.email && !r.company) { flagged++; continue; }
    let orgId: string | null = null;
    if (r.company) {
      const domain = r.website ?? r.email?.split("@")[1] ?? null;
      const location = [r.location, r.country].filter(Boolean).join(", ") || null;
      const key = [normalizeOrgName(r.company), (domain ?? "").toLowerCase(), r.website ? "w" : "e", location ?? ""].join("|");
      orgId = orgCache.get(key) ?? null;
      if (!orgId) {
        const o = await upsertOrganization(db, mandateId, { name: r.company, website: r.website ?? null, domain, domainInferred: !r.website, location }, "other", { source: "csv" });
        orgId = o.row.id;
        orgCache.set(key, orgId);
      }
    }
    if (r.fullName || r.email) {
      const c = await upsertContact(db, mandateId, {
        fullName: r.fullName || r.email!.split("@")[0], firstName: r.firstName, lastName: r.lastName, title: r.title, email: r.email,
        emailStatus: r.email ? "unverified" : undefined, linkedinUrl: r.linkedinUrl, location: r.location, country: r.country, orgId,
      }, "other", { source: "csv" });
      if (c.created) created++; else updated++;
      if (c.conflicts.length) flagged++;
    }
  }
  await db.update(imports).set({
    processedRows: sql`${imports.processedRows} + ${rows.length}`, created: sql`${imports.created} + ${created}`,
    updated: sql`${imports.updated} + ${updated}`, flagged: sql`${imports.flagged} + ${flagged}`, updatedAt: new Date().toISOString(),
  }).where(eq(imports.id, importId));

  return { created, updated, flagged };
}

export async function processImportChunk(db: Db, store: ImportStore, importId: string, offset: number) {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp || imp.status !== "processing" || !imp.mapping) return;
  const raw = await store.get(importKey(importId));
  if (!raw) {
    await db.update(imports).set({ status: "failed", error: "Upload not found in storage" }).where(eq(imports.id, importId));
    return;
  }
  const stored = JSON.parse(raw) as StoredImport;
  const mapping = Object.fromEntries(Object.entries(imp.mapping).map(([k, v]) => [k, Number(v)])) as Partial<Record<ImportField, number>>;
  const slice = stored.rows.slice(offset, offset + CHUNK);
  await importRows(db, imp.mandateId, applyMapping(slice, mapping), importId);
  if (offset + CHUNK < stored.rows.length) {
    await enqueue(db, "import.process", { importId, offset: offset + CHUNK }, { dedupeKey: `import:${importId}:${offset + CHUNK}` });
  } else {
    const [done] = await db.update(imports).set({ status: "done", updatedAt: new Date().toISOString() }).where(eq(imports.id, importId)).returning();
    await db.insert(activities).values({ mandateId: imp.mandateId, type: "import", detail: `CSV import "${imp.filename}": ${done.created} new, ${done.updated} updated, ${done.flagged} flagged`, source: "import", actor: imp.createdBy });
  }
}
