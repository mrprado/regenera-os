# Deploying Regenera OS (Cloudflare, regenera.bio/os)

The OS is the Cloudflare Worker `regenera-os` in the same Cloudflare account as regenera.bio. Worker routes
`regenera.bio/os` and `regenera.bio/os/*` run before the public site's Custom Domain, so only `/os` reaches the
OS and every other URL still goes to `regenera-development-office` unchanged. The app is built with
`basePath: "/os"` (next.config.ts). The `workers.dev` URL is off.

| Piece | Where |
|---|---|
| Worker, routes, cron (`*/5 * * * *` runs the job tick), D1 id, public vars | `deploy/cloudflare.json` |
| Build patch + deploy | `scripts/deploy.mjs` (`npm run deploy` = build, D1 migrations, deploy) |
| D1 | `regenera-os-d1` (migrations from `drizzle/`, applied on every deploy) |
| R2 | not enabled on the account yet: imports and backups say "not available" until it is |

## Sign-in

Email + password (lib/session.ts, app/api/auth/signin). The password is the tracker's: the OS posts it to
the site's `/api/pipeline/auth` (`TRACKER_AUTH_URL` overrides) and never stores it, so changing the tracker
password (`PIPELINE_PASSWORD` on the site) changes the OS password too. The email must be a mandate member, or
in `OS_ALLOWLIST` while no member exists. 5 failures lock an email for 15 minutes; 20 lock an IP. Sessions last
30 days in D1; Sign out revokes them. When the `OS_PASSWORD` secret is set it is the password instead (locally, in `.dev.vars`).

## Secrets (set once, by Prado)

```bash
node scripts/setup-secrets.mjs alanprado@regenera.bio
npx wrangler secret put OS_PASSWORD --name regenera-os         # type the password at the prompt
npx wrangler secret put ANTHROPIC_API_KEY --name regenera-os    # optional: Claude reads, drafts, Ask the OS
npx wrangler secret put RESEND_API_KEY --name regenera-os       # optional: digest and notifications
```

`APP_ENV` stays unset for testing: sequence and reply sends then go only to `SEND_ALLOWED_DOMAINS`
(`regenera.bio`). Set `APP_ENV=production` only when outreach should reach real contacts.

## Other addresses that moved from os.regenera.bio

- Site webhook: `OS_WEBHOOK_URL=https://regenera.bio/os/api/webhooks/site` on the site
- Google OAuth redirect: `https://regenera.bio/os/api/oauth/google/callback`
- Extension: OS address `https://regenera.bio/os`
- MCP server: `https://regenera.bio/os/api/mcp`
