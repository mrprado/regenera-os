// Restores one night of backups (backups/YYYY-MM-DD/*.jsonl + manifest.json, downloaded from R2) into a scratch
// LOCAL D1 and checks every table's row count against the manifest. Never touches production.
//   1. Download:  npx wrangler r2 object get <bucket>/backups/2026-09-24/manifest.json --file backup/manifest.json  (and each .jsonl)
//   2. Restore:   node scripts/restore-backup.mjs backup/
// Needs `npm run build` once (dist/server/wrangler.json). The scratch database lives in .wrangler/restore-check.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.resolve(process.argv[2] ?? "");
const config = path.join(root, "dist", "server", "wrangler.json");
const persist = path.join(root, ".wrangler", "restore-check");
if (!process.argv[2] || !existsSync(path.join(dir, "manifest.json"))) { console.error("Usage: node scripts/restore-backup.mjs <folder with manifest.json and *.jsonl>"); process.exit(1); }
if (!existsSync(config)) { console.error("Run `npm run build` once first."); process.exit(1); }

const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
rmSync(persist, { recursive: true, force: true });
mkdirSync(persist, { recursive: true });

function wrangler(args) {
  const r = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", config, "--persist-to", persist, "--yes", ...args], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(r.status ?? 1); }
  return r.stdout;
}

// 1. Schema: every migration in order.
for (const f of readdirSync(path.join(root, "drizzle")).filter(f => f.endsWith(".sql")).sort()) wrangler(["--file", path.join(root, "drizzle", f)]);

// 2. Data: one SQL file per table, values escaped as SQL literals.
const lit = v => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replace(/'/g, "''")}'`;
const tmp = path.join(persist, "sql");
mkdirSync(tmp, { recursive: true });
for (const name of Object.keys(manifest.tables)) {
  const file = path.join(dir, `${name}.jsonl`);
  if (!existsSync(file)) { console.error(`Missing ${name}.jsonl`); process.exit(1); }
  const body = readFileSync(file, "utf8");
  const rows = body ? body.split("\n").map(l => JSON.parse(l)) : [];
  if (!rows.length) continue;
  const stmts = rows.map(r => { const cols = Object.keys(r); return `INSERT INTO "${name}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${cols.map(c => lit(r[c])).join(", ")});`; });
  const out = path.join(tmp, `${name}.sql`);
  writeFileSync(out, `PRAGMA defer_foreign_keys = ON;\n${stmts.join("\n")}\n`);
  wrangler(["--file", out]);
}

// 3. Check counts.
let bad = 0;
for (const [name, expected] of Object.entries(manifest.tables)) {
  const json = JSON.parse(wrangler(["--command", `select count(*) as n from "${name}"`, "--json"]));
  const n = json[0]?.results?.[0]?.n ?? -1;
  if (n !== expected) { bad++; console.log(`MISMATCH ${name}: restored ${n}, manifest ${expected}`); }
}
console.log(bad ? `Restore check FAILED for ${bad} tables.` : `Restore check passed: ${Object.keys(manifest.tables).length} tables from ${manifest.day} match the manifest.`);
process.exit(bad ? 1 : 0);
