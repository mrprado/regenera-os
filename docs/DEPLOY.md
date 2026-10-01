# Deploying Regenera OS (Cloudflare, os.regenera.bio)

The OS is the Cloudflare Worker `regenera-os` in the same Cloudflare account as regenera.bio, served at the root of
**https://os.regenera.bio** (a Worker Custom Domain: Cloudflare creates the DNS record and certificate on deploy).
There is no base path. The old address keeps working: routes `regenera.bio/os` and `regenera.bio/os/*` reach the
same Worker, which answers with a 308 redirect to the same path on os.regenera.bio (method and body kept, so
webhooks and form posts still arrive). Every other regenera.bio URL still goes to `regenera-development-office`.
The `workers.dev` URL is off.

## Plan: Workers Paid is required

Server rendering a page takes roughly 20–120 ms of CPU. Workers Free allows 10 ms per request and fails the
request with **Cloudflare error 1102 (Worker exceeded resource limits)**. The account is on Workers Paid; the deploy
config states `limits.cpu_ms = 30000` (the Paid default) so a runaway request still stops. If 1102 ever returns,
check the plan first (Workers & Pages → Plans), then `npx wrangler tail regenera-os --format json` for
`cpuTime` per request.

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
in `OS_ALLOWLIST` (a plain var in `deploy/cloudflare.json`) while no member exists. Lockout after failed attempts is off for now. Sessions last
30 days in D1; Sign out revokes them. When the `OS_PASSWORD` secret is set it is the password instead (locally, in `.dev.vars`).

## Secrets (set once, by Prado)

```bash
node scripts/setup-secrets.mjs
npx wrangler secret put OS_PASSWORD --name regenera-os         # type the password at the prompt
npx wrangler secret put ANTHROPIC_API_KEY --name regenera-os    # optional: Claude reads, drafts, Ask the OS
npx wrangler secret put RESEND_API_KEY --name regenera-os       # optional: digest and notifications
```

`APP_ENV` stays unset for testing: sequence and reply sends then go only to `SEND_ALLOWED_DOMAINS`
(`regenera.bio`). Set `APP_ENV=production` only when outreach should reach real contacts.

## Addresses (os.regenera.bio since 2026-10-01; the old regenera.bio/os forms redirect)

- Site webhook: `OS_WEBHOOK_URL=https://os.regenera.bio/api/webhooks/site` on the site
- Google OAuth redirect: `https://os.regenera.bio/api/oauth/google/callback` (add it to the OAuth client's
  authorized redirect URIs in Google Cloud; Google does not follow redirects for this)
- Extension: OS address `https://os.regenera.bio`
- MCP server: `https://os.regenera.bio/api/mcp`
- Mail import: `node scripts/mail-import.mjs ... --base https://os.regenera.bio` (needs `MAIL_IMPORT_TOKEN`)
- Sessions are per host: after the move, sign in once at os.regenera.bio
