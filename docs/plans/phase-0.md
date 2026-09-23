# Phase 0 plan: Foundations

**Status (Sep 23, 2026): approved and built. Everything that can run locally is done and verified. Six criteria wait on accounts only Prado can create.**

## Acceptance report (SPEC section 26, phase 0)

| Criterion | Status | Evidence |
|---|---|---|
| Sign in with ChatGPT works; non-allowlisted account gets 403 | Pass (local) | Mock sign-in lands on Today; excluded email lands on /not-allowed; first allowlisted sign-in becomes owner (tests/integration/membership.test.ts) |
| Route-guard test: only listed anonymous routes reachable without a session | Pass | tests/unit/route-guard.test.ts walks every page, API route and server action |
| Both mailboxes connected via OAuth | **Blocked on Prado** | Flow verified locally up to Google: correct scopes, callback URL, browser-bound signed state; forged or declined callbacks rejected. Needs real `GOOGLE_CLIENT_ID`/`SECRET` |
| Drizzle migrations apply cleanly to a fresh local and staging D1 | Local pass; **staging blocked** | tests/integration/migrations.test.ts + `npm run db:migrate:local`. Staging needs the Sites project |
| Seed loads | Pass | tests/integration/seed.test.ts (idempotent) + `npm run db:seed:local` |
| Scheduler pings /api/jobs/tick and a test job runs | Endpoint pass; **scheduler deploy blocked** | Tick with the token runs `system.heartbeat`; wrong or missing token gets 401; overlap, retry, dead and budget covered by tests/integration/jobs.test.ts. Scheduler Worker needs a Cloudflare account (scheduler/README.md) |
| Lint, typecheck and CI green | Pass (local) | `npm run ci`: 42 tests, build OK. No git remote yet, so CI is not wired to a service |
| os.regenera.bio published as the second Sites project | **Blocked on Prado** | Build output is ready (`npm run build`) |
| No Supabase dependency | Pass | No Supabase references in code or lockfile |

Goal (SPEC section 15): login works, Gmail connected, domain warming, job engine proven. The acceptance criteria are in SPEC section 26, phase 0.

## Already done (scaffold, Sep 23 2026)

- Repository created from the same Sites starter as regenera-development-office: vinext, the vendored Sites Vite plugin, and scripts.
- `.openai/hosting.json` declares `d1: DB` and `r2: BUCKET`.
- `CLAUDE.md`, `docs/SPEC.md` (v2) and `docs/ENV.md`.
- Design tokens copied from the live site (`styles/tokens.css`), plus a light and dark theme.
- `lib/vocab.ts` holds the live site vocabulary as zod enums.
- App shell with nine nav screens, a Today placeholder and a sign-out link.
- Auth guard: Sign in with ChatGPT plus the `OS_ALLOWLIST` bootstrap. `/not-allowed` is the 403 page.
- Lint rule blocks `getDb` imports outside `lib/db/`.

## To build after approval

### 1. Schema and migrations (`db/schema.ts` → `drizzle/0000_*.sql`)

| Table | Why in phase 0 |
|---|---|
| `mandates` | Seed "Regenera" (advisory). Everything later is mandate-scoped |
| `mandate_members` | Replaces the `OS_ALLOWLIST` bootstrap. Holds the Sites user ID, email, mandate ID and role |
| `audit_log` | Sign-ins, OAuth connects and settings changes are audited from day one |
| `oauth_accounts` | Encrypted Google tokens per mailbox, plus scopes, caps and warm-up day |
| `jobs` | The job queue: type, payload, status, run_after, attempts, locked_until, last_error, dedupe_key (unique) |
| `job_schedules` | Recurring jobs: type, cadence (ET), next_run_at, last_run_at |

- Closed sets use Drizzle enums plus `CHECK` constraints.
- Indexes: `jobs(status, run_after)` and a unique `jobs(dedupe_key)`.
- Dates are stored as ISO-8601 text in UTC, matching the site's convention.

### 2. Data access (`lib/db/scoped.ts`)

- `scoped(user)` returns query helpers that inject `mandate_id IN (member mandates)`.
- `systemScope(reason)` is for jobs and writes an audit row.
- Tests show a user of mandate A cannot read mandate B.

### 3. Auth, finalized

- `requireOsUser` checks `mandate_members` first, and falls back to `OS_ALLOWLIST` only while the table is empty (first-run bootstrap). The first allowlisted sign-in creates the owner membership.
- A server-action wrapper `withOsUser(action)` guards every mutation.
- A **route-guard test** walks `app/**/page.tsx` and `app/api/**/route.ts`. It asserts that each page sits under the guarded `(app)` layout or is on the anonymous list (`/not-allowed`, and the five API routes in SPEC section 23), and that each anonymous API route calls its verifier.

### 4. Google OAuth (`lib/google/`, `app/api/oauth/google/*`)

- `GET /api/oauth/google/start?mailbox=primary|sending` is guarded and requires the signed-in owner.
- `GET /api/oauth/google/callback` checks the state (a signed, short-lived cookie), exchanges the code, and encrypts the tokens with AES-GCM (`TOKEN_ENCRYPTION_KEY`, Web Crypto) into `oauth_accounts`.
- Scopes: `gmail.send`, `gmail.modify`, `calendar.readonly`, `drive.file`.
- **Settings → Connections** shows both mailboxes with status, scopes, warm-up day and a "Send test email to myself" button. That test sends from the connected mailbox to the owner's own address, never to a contact.

### 5. Job engine (`lib/jobs/`, `app/api/jobs/tick/route.ts`)

- `enqueue(type, payload, { runAfter, dedupeKey })` is idempotent on the dedupe key.
- `tick()` works in three steps:
  1. It materializes due `job_schedules` rows.
  2. It claims a batch with `UPDATE … WHERE status='queued' AND run_after<=? … RETURNING`.
  3. It runs handlers under a ~25 s budget, with backoff retries, and marks a job `dead` after 5 attempts.
- Handler registry, with only one phase 0 handler: `system.heartbeat`, which writes `last_tick_at`.
- `POST /api/jobs/tick` requires `Authorization: Bearer $JOBS_TICK_TOKEN` and uses a constant-time compare.
- **Settings → Jobs** lists queued, running and dead jobs, shows the last tick, and has "Run jobs now" (guarded).
- ET schedule evaluation lives in `lib/time/`, with DST tests.

### 6. Scheduler (`scheduler/`)

- `scheduler/worker.ts` is a Cloudflare Worker with `scheduled()` that POSTs the tick URL every 5 min. It needs `wrangler.jsonc` with `triggers.crons = ["*/5 * * * *"]` and the secret `JOBS_TICK_TOKEN`.
- `scheduler/github-actions.yml` is the fallback, a copy-in workflow.
- `scheduler/README.md` gives deploy steps for Prado. It is a single `wrangler deploy` from that folder.

### 7. Settings skeleton

- Connections (above), Jobs (above), Members (list and add an email to the mandate).

### 8. Seed (`seed/seed.sql`)

- The Regenera mandate, the `system.heartbeat` schedule and the vocabulary display rows.
- Staging fixtures are left for phase 1.

### 9. Tooling

- vitest configured for unit tests. Integration tests run against Miniflare D1 through `wrangler`'s `getPlatformProxy` or `unstable_dev`.
- A CI script: `npm run lint && npm run typecheck && npm test && npm run build`. There is no git remote yet, so it is documented rather than wired.

## Tests in this phase

- Mandate scoping isolation, job claim under overlapping ticks (no double run), retry/backoff/dead, tick token rejection, ET schedule and DST, the route-guard walk, and token encrypt/decrypt round trip.

## Needs Prado (blocks acceptance, not building)

1. Create the second Sites project from this repository and add the `os.regenera.bio` domain. I can't create Sites projects from this session. Use the same Sites tool you publish regenera.bio with.
2. Google Cloud internal OAuth app → `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Secondary sending domain + mailbox, DNS (SPF/DKIM/DMARC), start warm-up.
4. Choose the scheduler host (free Cloudflare account is the default).
5. Set the secrets listed in `docs/ENV.md` for phase 0.

## Out of scope for phase 0

- CRM tables, imports, research, sending to anyone other than yourself, and site webhooks. These are phase 1.
