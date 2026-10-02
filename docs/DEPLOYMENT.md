# Deployment

Full procedure: [DEPLOY.md](DEPLOY.md). Summary:

1. `npx wrangler login` (the Cloudflare account that owns regenera.bio).
2. Secrets once: `node scripts/setup-secrets.mjs` (internal secrets) and `npx wrangler secret put OS_PASSWORD --name regenera-os`; optional provider keys (.env.example).
3. `npm run deploy` — builds, applies D1 migrations remotely, uploads the Worker on the Custom Domain `os.regenera.bio` (plus the `regenera.bio/os*` redirect routes) with a 30 s CPU limit and the 5-minute cron trigger.
4. Verify: `https://os.regenera.bio/signin`, `/portal/signin`, `/intake/project` return 200; `https://regenera.bio/os` redirects; Settings → Jobs shows the tick; Settings → Integrations shows health.

The generic instruction's Vercel + Docker worker targets do not apply: the web app and the worker are the same
Cloudflare Worker (cron trigger), so there is no separate container to host. Rollback: `npx wrangler rollback
--name regenera-os` (code) and D1 Time Travel (data); take a Time Travel restore point before any risky migration.
Workers Paid is active (required: see DEPLOY.md, error 1102). Pending for production: secrets, R2, and optionally a staging database. `workers.dev` stays off.
