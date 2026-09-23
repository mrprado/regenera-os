// Applies drizzle/*.sql migrations and seed/seed.sql to the LOCAL preview D1 (.wrangler/state).
// Production migrations are applied by the Sites publish flow, never by this script.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = path.join(root, "dist", "server", "wrangler.json");
const ledger = path.join(root, ".wrangler", "state", "applied-migrations.json");
const [command] = process.argv.slice(2);

if (!["migrate", "seed"].includes(command)) throw new Error("Usage: node scripts/db-local.mjs migrate|seed");
if (!existsSync(config)) {
  console.error("dist/server/wrangler.json is missing. Run `npm run build` once first.");
  process.exit(1);
}

function execute(file) {
  const result = spawnSync(process.execPath, [
    "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
    "d1", "execute", "DB", "--local", "--config", config, "--persist-to", ".wrangler/state", "--file", file, "--yes",
  ], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === "seed") {
  execute("seed/seed.sql");
} else {
  mkdirSync(path.dirname(ledger), { recursive: true });
  const applied = new Set(existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8")) : []);
  const pending = readdirSync(path.join(root, "drizzle")).filter(f => f.endsWith(".sql")).sort().filter(f => !applied.has(f));
  for (const file of pending) {
    console.log(`Applying ${file}`);
    execute(`drizzle/${file}`);
    applied.add(file);
    writeFileSync(ledger, JSON.stringify([...applied], null, 2));
  }
  console.log(pending.length ? `Applied ${pending.length} migration(s).` : "Local D1 is up to date.");
}
