// Deploys the built OS to Cloudflare as the Worker "regenera-os", served at regenera.bio/os (docs/DEPLOY.md).
// Run `npm run build` first. Wrangler must be logged in (`npx wrangler login`). Secrets are set separately
// with `npx wrangler secret put NAME --name regenera-os`; this script never reads or writes them.
//   node scripts/deploy.mjs            apply D1 migrations, then deploy
//   node scripts/deploy.mjs --dry-run  write the config and show what would be uploaded
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = path.join(root, "dist", "server");
const built = path.join(server, "wrangler.json");
if (!existsSync(built)) { console.error("dist/server/wrangler.json is missing. Run `npm run build` first."); process.exit(1); }
const target = JSON.parse(readFileSync(path.join(root, "deploy", "cloudflare.json"), "utf8"));
const dryRun = process.argv.includes("--dry-run");

// Wraps the vinext handler: a cron trigger runs the job tick, and MCP clients that look up OAuth metadata
// by path insertion (/.well-known/<kind>/os/...) reach the OS's own /os/.well-known routes.
writeFileSync(path.join(server, "entry.js"), `import app from "./index.js";
const WELL_KNOWN = /^\\/\\.well-known\\/(oauth-authorization-server|oauth-protected-resource)\\/os(\\/.*)?$/;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(WELL_KNOWN);
    if (m) { url.pathname = "/os/.well-known/" + m[1] + (m[2] ?? ""); request = new Request(url, request); }
    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (!env.JOBS_TICK_TOKEN) return;
    const tick = new Request(env.APP_BASE_URL + "/api/jobs/tick", { method: "POST", headers: { authorization: "Bearer " + env.JOBS_TICK_TOKEN } });
    ctx.waitUntil(app.fetch(tick, env, ctx).then(r => r.text()));
  },
};
`);

const config = JSON.parse(readFileSync(built, "utf8"));
Object.assign(config, {
  name: target.worker,
  topLevelName: target.worker,
  main: "entry.js",
  // vinext loads route chunks with dynamic imports, which the module walker misses: upload every .js file.
  find_additional_modules: true,
  base_dir: ".",
  workers_dev: false,
  preview_urls: false,
  routes: target.routes.map(pattern => ({ pattern, zone_name: target.zone })),
  triggers: { crons: [target.cron] },
  vars: { ...config.vars, ...target.vars },
  d1_databases: [{ binding: "DB", database_name: target.d1.name, database_id: target.d1.id, migrations_dir: "../../drizzle" }],
  r2_buckets: target.r2 ? [{ binding: "BUCKET", bucket_name: target.r2 }] : [],
  // vinext serves public/ files through env.ASSETS (Sites provides it implicitly).
  assets: { ...config.assets, binding: "ASSETS" },
});
delete config.dev;
const deployConfig = path.join(server, "wrangler.deploy.json");
writeFileSync(deployConfig, JSON.stringify(config, null, 2));

function wrangler(...args) {
  console.log(`\n> wrangler ${args.join(" ")}`);
  const r = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args, "--config", deployConfig], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (dryRun) {
  wrangler("deploy", "--dry-run");
} else {
  wrangler("d1", "migrations", "apply", target.d1.name, "--remote");
  wrangler("deploy");
  console.log(`\nLive at ${target.vars.APP_BASE_URL}`);
}
