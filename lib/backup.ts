// Nightly backup (SPEC section 13, docs/plans/phase-4.md item 6). Every table is exported to R2 as JSON lines under
// backups/YYYY-MM-DD/, with a manifest of row counts. 30 days are kept. A monthly check reads the latest backup
// back and verifies it parses and matches its manifest; scripts/restore-backup.mjs restores a night into a scratch D1.
// Tokens stay as stored: OAuth tokens encrypted, extension and MCP tokens hashed. The HTTP cache is skipped.
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setState } from "@/lib/state";

export type BackupStore = {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
  delete(keys: string[]): Promise<void>;
};

export function r2BackupStore(bucket: R2Bucket): BackupStore {
  return {
    put: async (key, value) => { await bucket.put(key, value, { httpMetadata: { contentType: "application/x-ndjson" } }); },
    get: async key => { const o = await bucket.get(key); return o ? o.text() : null; },
    list: async prefix => {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const r = await bucket.list({ prefix, cursor });
        keys.push(...r.objects.map(o => o.key));
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      return keys;
    },
    delete: async keys => { for (let i = 0; i < keys.length; i += 900) await bucket.delete(keys.slice(i, i + 900)); },
  };
}

const SKIP = new Set(["source_cache"]);

/** Every Drizzle table in the schema, by SQL name. */
export function backupTables(): { name: string; table: SQLiteTable }[] {
  const out = new Map<string, SQLiteTable>();
  for (const v of Object.values(schema)) {
    if (v && typeof v === "object" && Symbol.for("drizzle:IsDrizzleTable") in (v as object)) {
      const t = v as SQLiteTable;
      const name = getTableConfig(t).name;
      if (!SKIP.has(name)) out.set(name, t);
    }
  }
  // Parents before children, so a restore never breaks a foreign key.
  const names = [...out.keys()].sort();
  const deps = new Map(names.map(n => [n, new Set(getTableConfig(out.get(n)!).foreignKeys.map(fk => getTableConfig(fk.reference().foreignTable).name).filter(p => p !== n && out.has(p)))]));
  const ordered: string[] = [];
  const visit = (n: string, path: Set<string>) => {
    if (ordered.includes(n) || path.has(n)) return;
    path.add(n);
    for (const p of deps.get(n) ?? []) visit(p, path);
    ordered.push(n);
  };
  for (const n of names) visit(n, new Set());
  return ordered.map(name => ({ name, table: out.get(name)! }));
}

export type Manifest = { day: string; createdAt: string; tables: Record<string, number> };

export async function runBackup(db: Db, store: BackupStore, now = new Date(), keepDays = 30): Promise<Manifest> {
  const day = now.toISOString().slice(0, 10);
  const manifest: Manifest = { day, createdAt: now.toISOString(), tables: {} };
  for (const { name, table } of backupTables()) {
    const lines: string[] = [];
    // Raw column names, in pages, so the file restores into D1 exactly as stored.
    for (let offset = 0; ; offset += 500) {
      const rows = await db.all<Record<string, unknown>>(sql`select * from ${table} limit 500 offset ${offset}`);
      for (const r of rows) lines.push(JSON.stringify(r));
      if (rows.length < 500) break;
    }
    await store.put(`backups/${day}/${name}.jsonl`, lines.join("\n"));
    manifest.tables[name] = lines.length;
  }
  await store.put(`backups/${day}/manifest.json`, JSON.stringify(manifest));
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
  const old = (await store.list("backups/")).filter(k => k.slice(8, 18) < cutoff);
  if (old.length) await store.delete(old);
  await setState(db, "last_backup", JSON.stringify({ day, at: now.toISOString(), tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((a, n) => a + n, 0) }));
  return manifest;
}

/** Reads the latest backup back and checks every file parses and matches the manifest counts. */
export async function verifyLatestBackup(db: Db, store: BackupStore, now = new Date()) {
  const manifests = (await store.list("backups/")).filter(k => k.endsWith("/manifest.json")).sort();
  const latest = manifests.at(-1);
  const result = { ok: false, day: null as string | null, checked: 0, problems: [] as string[] };
  if (!latest) { result.problems.push("No backup found"); }
  else {
    const m = JSON.parse((await store.get(latest)) ?? "{}") as Manifest;
    result.day = m.day;
    for (const [name, count] of Object.entries(m.tables ?? {})) {
      const body = await store.get(`backups/${m.day}/${name}.jsonl`);
      if (body === null) { result.problems.push(`${name}: file missing`); continue; }
      const lines = body ? body.split("\n") : [];
      try { lines.forEach(l => JSON.parse(l)); } catch { result.problems.push(`${name}: unreadable line`); continue; }
      if (lines.length !== count) result.problems.push(`${name}: ${lines.length} rows, manifest says ${count}`);
      result.checked++;
    }
    result.ok = result.problems.length === 0 && result.checked > 0;
  }
  await setState(db, "last_backup_check", JSON.stringify({ ...result, at: now.toISOString() }));
  return result;
}

/** Restores one night into an empty database (tests and scripts/restore-backup.mjs). Rows are inserted as stored. */
export async function restoreInto(exec: (statement: string, params: unknown[]) => Promise<void>, files: Record<string, string>) {
  const counts: Record<string, number> = {};
  for (const [name, body] of Object.entries(files)) {
    const rows = body ? body.split("\n").map(l => JSON.parse(l) as Record<string, unknown>) : [];
    for (const r of rows) {
      const cols = Object.keys(r);
      await exec(`insert into "${name}" (${cols.map(c => `"${c}"`).join(", ")}) values (${cols.map(() => "?").join(", ")})`, cols.map(c => r[c]));
    }
    counts[name] = rows.length;
  }
  return counts;
}
