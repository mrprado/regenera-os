# Operations

## Backups and restore
- D1 Time Travel keeps point-in-time history (30 days on Workers Paid): `npx wrangler d1 time-travel info regenera-os-d1`
  then `npx wrangler d1 time-travel restore regenera-os-d1 --timestamp <ISO>`.
- The `backup.nightly` job exports critical tables; `backup.verify` checks it monthly (Settings → Jobs shows status).
- Manual export: `npx wrangler d1 export regenera-os-d1 --remote --output backup.sql`.
- Files: documents are links to where they live (Drive, data rooms); R2, when enabled, gets its own lifecycle policy.

## Migrations
Additive only. `npm run db:generate` after schema edits; `npm run deploy` applies pending migrations before the new
Worker version goes live. Never edit an applied migration; add a new one. Check with
`npx wrangler d1 migrations list regenera-os-d1 --remote`.

## Integration outages
fetchJson retries with backoff (429/5xx, Retry-After), then falls back to the last cached copy where the adapter allows
(shown as stale with its date). Settings → Integrations shows last success, last failure and error per provider, and
Test runs one real call. A provider can be set Disabled there by an owner; the gate then refuses all calls.

## Key rotation
Generate new values (`node scripts/setup-secrets.mjs` for internal secrets), `npx wrangler secret put NAME --name
regenera-os`, redeploy not required (secrets apply to new requests). Rotating TOKEN_ENCRYPTION_KEY requires
re-connecting Google accounts. Provider keys: rotate at the provider, then update the secret; Test confirms.

## People
- Deactivate a member: Settings → Members (remove the membership); their sessions stop working at the next request.
- Revoke portal access: Portals → Users → Suspended/Revoked (ends every session), or revoke individual grants in
  Portals → Access. Introducer agreements past their expiry remove access automatically (daily `portal.expire`).

## Incident response basics
1. Contain: revoke the affected sessions/grants; set the affected integration to Disabled; if needed, rotate secrets.
2. Assess: audit log (who did what), portal access log (who opened what), provider ledger (what was called).
3. Recover: D1 Time Travel restore to before the incident if data was damaged.
4. Record: what happened, what was exposed, who was informed, what changed; privacy requests are handled in Settings.

## Scheduler health
Today shows a banner when the job tick has not run for 30 minutes. Worker CPU limits on the Free plan cause error
1102 under load; Workers Paid is recommended.
