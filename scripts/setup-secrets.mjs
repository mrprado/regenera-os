// Sets the production secrets of the "regenera-os" Worker (docs/DEPLOY.md). Run it yourself:
//   node scripts/setup-secrets.mjs
// (The allowlist is a plain var in deploy/cloudflare.json, not a secret.)
// Generated secrets (tokens and keys nobody types) are random and never printed. Secrets already set are
// left alone, so running it twice is safe. Provider keys (Resend, Anthropic) are set by hand, see DEPLOY.md.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const WORKER = "regenera-os";

const wrangler = (args, input) => spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], { input, encoding: "utf8" });

const listed = wrangler(["secret", "list", "--name", WORKER, "--format", "json"]);
const existing = new Set(listed.status === 0 ? JSON.parse(listed.stdout).map(s => s.name) : []);

const generated = () => randomBytes(32).toString("hex");
const wanted = {
  JOBS_TICK_TOKEN: generated,
  TOKEN_ENCRYPTION_KEY: generated,
  UNSUBSCRIBE_SIGNING_SECRET: generated,
  EXTENSION_TOKEN_SECRET: generated,
};

for (const [name, value] of Object.entries(wanted)) {
  if (existing.has(name)) { console.log(`${name}: already set, kept`); continue; }
  const r = wrangler(["secret", "put", name, "--name", WORKER], value());
  console.log(`${name}: ${r.status === 0 ? "set" : `failed\n${r.stderr}`}`);
}
