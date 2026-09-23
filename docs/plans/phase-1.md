# Phase 1 plan: CRM core

**Status: draft for review (Sep 23, 2026). Not started.** Building begins only after (a) Prado approves this plan and (b) phase 0 is signed off (SPEC rule: no phase starts before the previous one passes). Planning ahead lets the account setup for phase 0 and the review of this plan run in parallel.

**Goal (SPEC section 15).** The first 25 real prospects are researched, scored and emailed from the app, and the tracker's history is visible in the OS. The acceptance criteria are in SPEC section 26, phase 1, and are restated at the end of this plan.

## Decisions needed from Prado before building

| # | Decision | Why it matters | Default if unanswered |
|---|---|---|---|
| 1 | **Enrichment provider (paid).** Approve Apollo now, or defer | The spec says to verify every address before sending. Without enrichment, phase 1 can still send manually to addresses you supply, but they show as "unverified" | Build the provider interface and a manual "verified by Prado" flag; add the Apollo adapter only when approved |
| 2 | **Changes to the live regenera.bio site.** The site must post inquiries and referrals to the OS and expose a token-protected export | This touches production. It is small (two webhook calls, one export route) and goes in its own commit in `regenera-development-office` for you to publish | Written, tested locally and committed on a branch there, **not published** until you say so |
| 3 | **Anthropic API monthly budget** | Research stops enqueueing when month-to-date `ai_runs` cost reaches the cap | US$50/month (enough for about 150 full dossiers at the estimates below) |
| 4 | **Test inbox for acceptance** | "A manual email sends to a test inbox and threads correctly" needs a real inbox you control | An address you name. Staging sends are restricted to it |
| 5 | **Tracker cut-over timing** | After the import, `/tracker` should become read-only so the two systems don't diverge | Read-only after you confirm the import matches (site change, same branch as #2) |

## 1. Schema (migration `0001_crm_core`)

These are the tables from SPEC section 9 that phase 1 needs. Every mandate-scoped table has `mandate_id` and is read only through `lib/db/scoped.ts`. Closed sets use the enums in `lib/vocab.ts` plus CHECK constraints.

| Table | Phase 1 use | Notes |
|---|---|---|
| `segments` | Seeded with the 24 segments (section 3). Post-industrial land is seeded disabled | Config; not mandate-scoped |
| `organizations` | Created from import, tracker, site intake and manual entry | Unique `domain`; `name_normalized` for dedupe; `country` ISO3 |
| `contacts` | Same sources | Unique `lower(email)` and `linkedin_url`; `email_status` (unknown, unverified, verified_manual, verified_provider, invalid); `consent_basis`; `suppressed` |
| `dossiers` | Output of the research job | Section 6 fields as JSON; each field carries `sources[]` and `confidence` |
| `triggers` | Manual triggers in phase 1 (scan is phase 3) | Feeds the trigger axis of scoring |
| `scores` | Output of score-match | fit, trigger, access, total, tier, screening_quadrant, `rationale` JSON, `model_version` |
| `deals` | Pipeline | Stages from `lib/vocab.ts`, plus `legacy_pipeline_entry_id` and `fee_terms` JSON |
| `activities` | Touch timeline | Tracker contact history lands here |
| `messages` | Manual email only in phase 1 | Status machine per SPEC section 21. Sequences and approval queue are phase 2 |
| `inquiries`, `referrals`, `partners` | Site intake mirror | Upserted on `(source, site_id)` |
| `imports` | CSV and tracker imports | The file goes to R2, the row tracks progress and dedupe results |
| `suppression` | Checked inside the send claim | Unsubscribes arrive in phase 2, but the check exists from the first send |
| `prompts`, `ai_runs` | AI contracts (SPEC section 22) | Prompts are versioned and never edited in place. Runs log tokens, cache tokens, web searches, cost and latency |
| `merges` | Dedupe audit | Keeps the before-state of every merge |

Seed: segments, the phase 1 prompts (section 4 below) and the default scoring weights 40/35/25.

## 2. Intake

### 2a. Tracker import (one-time, re-runnable)

- **Source:** the site's new `GET /api/export/pipeline` (decision #2), token-protected.
- **Mapping** (all vocabularies already match `lib/vocab.ts`):
  - `pipeline_entries` → organization (by normalized name) + contact (by email, else name + org) + deal
  - `stage` maps 1:1, except `renewed` → `expansion`
  - `engagement`, `fee` and `source` map 1:1
  - `type` `capital` → path `capital_mandate`; `opportunity` → path `project_diagnostic`
  - `monthly`, `equity`, `deal_size`, `percentage` and `flat_fee` go into `fee_terms`
- `pipeline_contacts` → activities, keeping `method`, date and note.
- **Idempotent:** keyed on `legacy_pipeline_entry_id`, so running it again updates rather than duplicates.
- **Report:** after the run, a report shows counts per stage in the tracker and in the OS side by side, so you can confirm they match before the tracker goes read-only.

### 2b. Site webhook + hourly reconcile

- `POST /api/webhooks/site` verifies an HMAC (`SITE_WEBHOOK_SECRET`) and a timestamp (5-minute window, no replay). It handles `inquiry.created`, `referral.created` and `referral.updated`.
- `site-reconcile` job (hourly): calls `GET /api/export/{inquiries,referrals}?since=`, so anything the webhook missed still arrives.
- Upsert on `(event type, site_id)`, so the webhook and the reconcile can't double-create.
- Routing follows SPEC section 24:
  - Capital inquiry → deal at `lead`, path capital_mandate, mandate parameters prefilled from the form.
  - Diagnostic request → path project_diagnostic.
  - Partnership → partner record.
  - Referral → referral + deal, with conflict check.
- **Site side** (separate commit in `regenera-development-office`, decision #2): after the existing D1 insert in `/api/inquiries` and the referral routes, `waitUntil` a signed POST to the OS. Add a token-protected export route. The site keeps working exactly as today if the OS is unreachable.

### 2c. CSV import (Prospecting screen)

- Upload goes to R2, then an `imports` row, then chunked `process-import` jobs (200 rows each, to stay inside the tick budget).
- Column mapping UI with auto-detect for common headers (Sales Navigator and Apollo export shapes). A preview shows the first 10 rows before commit.
- Per row: normalize, dedupe (below), create or update, then set lead_state `sourced`, which enqueues research by tier.

### 2d. Dedupe (`lib/dedupe/`)

- **Contacts:** match on lower(email), then canonical LinkedIn URL (strip query, trailing slash, locale subdomain), then normalized name + organization.
- **Organizations:** match on registrable domain (strip `www.`, ignore free-mail domains such as gmail.com), then normalized name (lowercase, strip legal suffixes like S.A. de C.V., Ltd, GmbH, LLC, and punctuation).
- **Merges:** keep full history (activities, deals and dossiers re-pointed) and write a `merges` row.
- **Ambiguous matches** (name match only, different domains) are flagged for review rather than auto-merged.

## 3. Research job (dossiers)

The spec requires sources for every claim. Citations can't be combined with structured JSON output in a single call, so research is split into steps, each its own job so no request runs long:

1. **`research.gather`** (Claude Sonnet 5, `web_search_20260209` + `web_fetch_20260209`, adaptive thinking, effort `medium`, `max_uses` 8 searches / 6 fetches)
   - **Input:** org domain and name, contact name, title and any pasted LinkedIn text, segment config, and the active trigger.
   - **Output:** research notes as text, with the source URL beside each fact.
   - **`pause_turn`:** handled by resuming, capped at 3 resumptions.
   - **Storage:** result blocks are summarized into notes. Raw page copies are never kept (SPEC section 13).
2. **Country context:** a plain `fetch` of the public `https://regenera.bio/api/intelligence/countries/{iso3}`, cached per country for 30 days. It is labeled screening-grade backdrop, never a claim about the project.
3. **`research.dossier`** (Sonnet 5, structured output via `client.messages.parse` + `zodOutputFormat`)
   - **Input:** the notes and country context.
   - **Output:** section 6 fields, each with `sources[]` (URLs that must appear in the notes) and `confidence`.
   - **Validation:** a zod refinement rejects any source URL not present in the gather notes. An invalid output retries once with the errors attached, then the job goes `dead`.
4. **LinkedIn:** paste-only in phase 1, via a "Paste profile" box on the Record screen. The app never fetches linkedin.com. The extension arrives in phase 3.

**Tiering.**
- Targeted-tier candidates get the full gather.
- Mass-tier candidates get a light gather: website + trigger only, 2 searches / 2 fetches.
- Tier is first estimated from segment + trigger presence, then set by scoring.

## 4. Scoring, matching, screening

| Prompt | Model | Output (zod) |
|---|---|---|
| `score.lead` | Sonnet 5, structured output, effort `medium` | fit, trigger, access (0–100) with a rationale per axis. The total and tier are computed **in code** from the weights, not by the model |
| `match.offer` | Sonnet 5, structured output | Primary and secondary {engagement_path, practice, engagement, offer, angle} + rationale, constrained to `lib/vocab.ts` enums |
| `screen.deal` | Sonnet 5, structured output | Readiness per dimension (control, technical, commercial, institutional, capital), alignment, and a rationale. The quadrant (proceed, develop, redirect, decline) is computed **in code** |

- **Conflict check:** before a lead is marked `qualified`, the OS matches it against existing deals, partners, referrals and other mandates. A hit flags it for Prado, and nothing proceeds automatically.
- **Explainability:** the rationales show as the "why" line on the Record screen.
- **Unit tests:** weight math, tier cut-offs (75/50/30), quadrant logic and the enum constraints.

## 5. AI plumbing (`lib/ai/`)

- `@anthropic-ai/sdk` (fetch-based, runs on Workers) is the single client. The key is server-only.
- `runPrompt(key, input)`:
  1. Loads the active prompt version from `prompts`.
  2. Calls the model, validates the output with zod, and logs `ai_runs` (input/output/cache tokens, web search count, cost, latency, status).
  3. Checks `stop_reason` before reading content: `refusal`, `max_tokens` and `pause_turn` are each handled explicitly.
- **Cost table** in `lib/ai/pricing.ts`:
  - Sonnet 5: $2 input / $10 output per MTok.
  - Haiku 4.5: $1 / $5.
  - Cache writes cost 1.25x input and cache reads 0.1x.
  - The web search fee is taken from the current pricing page at build time.
- **Budget guard:** research and scoring jobs check the month-to-date cost against `AI_MONTHLY_BUDGET_USD` before calling. When over budget, jobs wait (they don't fail), and a banner appears.
- **Prompt caching:** system prompts are stable (the vocabulary block and role boundaries from SPEC section 13 come first, and per-lead data comes last) so the prefix caches. `cache_read_input_tokens` is logged to confirm hits.
- **Contract tests:** each prompt's output validates against its zod schema on 5 recorded fixtures. Tests use recorded responses and make no live API calls, so the suite costs nothing to run.

**Rough cost per organization** (to be replaced by measured `ai_runs` data):
- Full dossier: about US$0.25–0.40 (gather with ~8 searches, synthesize, score, match).
- Light (mass tier): about US$0.05–0.10.
- The acceptance run of 10 test organizations: about US$3–4.

## 6. Screens

| Screen | Phase 1 content |
|---|---|
| **Today** | Live counts: new site inquiries and referrals, leads awaiting research, dossiers ready to review, flagged conflicts, open deals without a next action, and dead jobs |
| **Prospecting** | CSV import with mapping and preview, the import history, research status per lead, and score-ranked lists filterable by segment, tier, sector and region |
| **Pipeline** | Kanban by deal stage with drag to move (a server action, audited) and filters for mandate, path, segment, sector, region and engagement. It also has the fee calculator carried over from the tracker |
| **Record** (org and contact) | Dossier with sources and confidence, mandate parameters or readiness position, "why" lines for score and match, a trigger list with "add trigger", the touch timeline, deals, "Paste LinkedIn profile", "Re-run research", and the compose box |
| **Compose** (on Record) | A manual email from the primary mailbox. Creating it = Prado approving it (a `messages` row, `approved`). The send is idempotent on `messages.id` with suppression checked in the same D1 batch, and it records `gmail_thread_id`/`Message-ID`. Replies in the same thread are handled in phase 2 |

- **Design:** CSS Modules on the phase 0 tokens. The Record page uses the split layout (dossier panel beside the timeline).
- **Mobile:** Today and Record are readable on a phone.

## 7. Send safety (phase 1)

- Only manual, single-recipient sends from the **primary** mailbox. There are no sequences and no mass tier until phase 2.
- Investment-mandate records can't be composed to. The UI hides compose, and the server action refuses.
- **Non-production guard:** when `APP_ENV` is not `production`, the sender refuses any recipient outside `SEND_ALLOWED_DOMAINS` (your test inbox, decision #4). This enforces "never test sends against real contacts" in code.
- **Email status:** a contact with `email_status` unknown or unverified shows a warning, and the send needs an explicit confirmation (decision #1 default).
- Every send writes `audit_log` and an `activity`.

## 8. Jobs registered in phase 1

| Job | Trigger |
|---|---|
| `site.reconcile` | Hourly |
| `import.process` | Chunk enqueued on upload |
| `research.gather` → `research.dossier` | lead_state `sourced` (targeted runs first) |
| `score.match` | Dossier saved |
| `tracker.import` | Manual button in Settings (re-runnable) |

## 9. Tests (added to `npm run ci`)

- **Unit:**
  - dedupe normalization and matching, with the tricky cases (legal suffixes, free-mail domains, LinkedIn URL variants, accents)
  - scoring math and tiers
  - screening quadrant
  - the tracker mapping for every stage, engagement and fee
  - webhook HMAC + timestamp
  - CSV column auto-detect
  - the cost calculation
- **Integration (real local D1):**
  - a 100-row CSV with seeded duplicates produces the expected creates, updates and merges
  - tracker import is idempotent
  - site webhook + reconcile never double-create
  - mandate isolation on every new table
  - send idempotency under parallel claims
  - suppression inside the claim
  - investment-mandate compose refused
  - the non-production recipient guard
- **AI contract tests:** 5 recorded fixtures per prompt.
- **End to end (Playwright, staging):** import, research (recorded), record, compose, send to the test inbox, then a stage move.

## Acceptance criteria (SPEC section 26, phase 1)

- An import of a 100-row CSV dedupes correctly against seeded duplicates.
- The tracker export imports with every stage, engagement and fee mapped, and the counts match.
- A test site inquiry of each kind arrives via webhook and creates the right records. An invalid signature is rejected.
- Dossiers are generated with sources for 10 test organizations.
- Scores and tiers are assigned with rationales.
- The Record and Pipeline screens work.
- A manual email sends from a Record page to the test inbox and threads correctly.
- The Today screen shows live counts.
- Then, the first 25 real prospects are researched, scored and emailed from the app. This is Prado's run, after the go-live items that apply to manual targeted sends.

## Out of scope for phase 1

Sequences, the approval queue, the automated sender, reply watching, calendar sync and the digest (phase 2). Also the trigger scan, the LinkedIn extension and reports (phase 3).
