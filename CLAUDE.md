# Regenera OS

Private CRM, prospecting and outreach system for Regenera (regenera.bio).
Spec: docs/master-spec.md (canonical, 2026-09-24; supersedes docs/SPEC.md). Audit: docs/audit-2026-09.md.
Phase plans: docs/plans/ (phase-6 = master-spec roadmap). Environment: docs/ENV.md. Deploy: docs/DEPLOY.md.

## Stack
- Next.js 16 App Router + React 19, TypeScript strict, built with vinext for
  Cloudflare Workers (same toolchain as regenera-development-office)
- Hosted on Cloudflare as the Worker regenera-os at regenera.bio/os (docs/DEPLOY.md): routes in front of the
  public site's Custom Domain, basePath "/os", D1 (binding DB) with Drizzle, R2 (BUCKET, not yet enabled).
  Jobs live in the D1 jobs table; a cron trigger in scripts/deploy.mjs's entry runs POST /api/jobs/tick
- Auth: email + password sign-in (lib/session.ts, app/api/auth/*; password = the tracker's, checked by the
  site's /api/pipeline/auth, never stored) + membership (lib/auth.ts requireOsUser).
  Never trust identity headers. Every (app) route and server action calls the guard; anonymous routes are
  listed in tests/unit/route-guard.test.ts
- basePath: next/link, redirect() and router.push add /os; plain <a href>, <form action>, fetch() and cookie
  paths use withBase() from lib/base-path.ts
- NO Supabase, ever
- Anthropic API server-side only. Models: claude-sonnet-5 for research,
  scoring, drafting, reports; claude-haiku-4-5 for reply
  classification and extraction
- Google APIs: Gmail, Calendar, Drive (OAuth, internal Workspace app)
- Resend (mail.regenera.bio) for system notifications only
- Apollo.io API is the prospect data layer: search (0 credits) and enrichment
  (credits, budget-guarded). Apollo sequences, mailboxes and CRM are not used
- zod for all external and AI payloads

## Commands
- npm run dev (vinext, port 5180 via -- --port 5180; open http://localhost:5180/os. Locally
  OS_PASSWORD in .dev.vars is the password) / build / start / lint / typecheck / test
- npm run deploy: build, apply D1 migrations, deploy to regenera.bio/os (wrangler login first)
- npm run db:generate (drizzle-kit) after editing db/schema.ts
- npm run build once, then npm run db:migrate:local and npm run db:seed:local for the
  local preview D1 (.wrangler/state). Production migrations apply on npm run deploy
- npm run ci = lint + typecheck + test + build. Tests use real local D1 via
  wrangler getPlatformProxy (tests/helpers/d1.ts); "cloudflare:workers" is stubbed in vitest.config.ts
- Code that touches the DB takes a `db: Db` parameter so it is testable; only
  route/page/action edges call appDb() or read `env`
- node scripts/dev-post-site-event.mjs <event.json> posts a signed regenera.bio event to the local webhook
- Outreach (phase 2): lib/outreach/* (sequences + enrollment guards + drafting/approval, sender with
  recipient windows, caps, warm-up, threading and unsubscribe, reply watcher + routing, calendar sync +
  briefs, relationships (metadata only), deliverability, digest). Pages: /queue /sequences /tasks /inbox
  /settings/sending. Server actions: app/(app)/outreach-actions.ts
- Radar (phase 3): lib/triggers/pursue.ts + lib/crm/conflicts.ts (trigger -> people -> conflict check -> enroll),
  lib/radar/* (saved searches, public list diffs: SBTi xlsx streamed with fflate, TNFD table), lib/extension.ts +
  extension/ (MV3, load unpacked; per-user hashed tokens), lib/reports/* (metrics + weekly report). D1 allows 100
  bound parameters per statement: chunk IN (...) lists with lib/db/chunk.ts
- Funding (phase 5 part A): db/funding.ts (funding_opportunities, funding_matches, bid_library; deals.opportunityId),
  lib/funding/sources.ts (Grants.gov, EU Funding & Tenders, UK Contracts Finder; TED and World Bank wrap the
  signal sources, whose trigger queries are disabled), lib/funding/engine.ts (FUNDING_QUERIES x sources rotated by
  the funding_scan_cursor state, 8 pairs every 2h; cleanText + placeholder amounts/deadlines; off-topic skip;
  cross-source dedupe; Claude read; applicant matching; Bid = deal + back-planned tasks), lib/funding/bids.ts
  (proposal drafts; past performance only with disclosure-authorized case records). Page /funding, actions in
  app/(app)/funding-actions.ts. Shared page constants live in lib/funding/labels.ts (pages export only default)
- Contracts (phase 5 part E): db/contracts.ts, lib/contracts/{templates,engine,queries,labels}.ts, pages /contracts,
  actions app/(app)/contract-actions.ts. Templates are counsel starting points; markSent blocks on [TO CONFIRM],
  the template note, and counsel review for success fee / equity / capital work / investment mandates.
  components/markdown-lite.tsx renders contract text as React (never HTML). Downloads are PDFs from lib/contracts/pdf.ts
  (pdf-lib, Regenera header/footer, runs in the Worker) via /api/contracts/download
- Phase 6 (master spec; docs/regenera-os-architecture.md): projects spine (db/projects.ts, lib/projects/*, /projects,
  Place/Readiness/Constraints/Capital/Regulatory tabs, brief PDF); capital (db/capital.ts, lib/capital/*, /capital;
  private profiles, qualifications and KYC are OWNER-ONLY and must never reach lib/ask or lib/mcp: tested); send-time
  compliance gate in lib/crm/send.ts; agreement register + obligations + documents (lib/contracts/register.ts,
  /documents); regulatory (db/regulatory.ts, lib/regulatory/*; the OS records reviews, never "compliant");
  integration registry enforced in fetchJson (lib/integrations/*, Settings → Integrations); place adapters
  (lib/place/*); global search (lib/search.ts, /api/search, Cmd+K). Migrations are additive only.
- React drops name/value on a button whose formAction is a function: use one server action per button
- Data layer: lib/sources/* (free sources, each with limits, cache and provider_calls ledger);
  lib/triggers/* (engine + default queries); lib/freshness.ts (current-data policy: this calendar year)
- Local secrets in .dev.vars (ignored). Local tick:
  curl -X POST -H "Authorization: Bearer local-dev-tick-token" http://localhost:5180/os/api/jobs/tick
- If a dev route 500s with "Network connection lost" right after startup, it is a stale
  module from dependency optimization; touch the file or restart the dev server

## Rules
- Never send email or LinkedIn actions without an approved messages row.
  Sends are idempotent on messages.id.
- Every query on a mandate-scoped table goes through lib/db/scoped.ts
  (lint blocks importing getDb elsewhere). The D1 binding is server-only.
- AI prompts live in the prompts table, versioned. Log every AI call to
  ai_runs with tokens and cost.
- Every generated message passes lib/style/validate.ts before entering the
  approval queue.
- Investment-mandate records (mandates.type = 'investment') can never enter
  the mass tier or auto follow-ups.
- Vocabulary comes from the live site (lib/vocab.ts): three practices, five
  sectors, seven territorial systems, engagement keys, tracker stages.
  Source of truth is regenera-development-office, never regenera-nextjs.
- Design tokens from styles/tokens.css only (copied from
  regenera-development-office/app/globals.css): paper, ink, fern, leaf, reed,
  water, wax, pollen, line. Font: Helvetica Neue. Pollen is for primary
  actions and urgency only. CSS Modules per screen. No Tailwind. Icons: lucide-react.
- UX is Apollo.io's layout in Regenera's brand (SPEC section 11): white header,
  fern sidebar, filter panel + dense table + bulk action bar + side panel preview.
  Use components/page.tsx (PageHeader, EmptyState) for page chrome.
- Write JS regex and embedded scripts in their own files and run node --check.
  Avoid ID-level display overrides in CSS.
- Tests required for: dedupe, scoring, screening matrix, send idempotency,
  suppression, reply classification routing, style validator, mandate scoping,
  job claim safety, route guard.
- Build phase by phase; write docs/plans/phase-N.md and wait for approval
  before building a phase.
- Ask before adding paid services or changing the stack.
