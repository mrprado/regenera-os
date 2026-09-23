# Regenera OS

Private CRM, prospecting and outreach system for Regenera (regenera.bio).
Spec: docs/SPEC.md. Phase plans: docs/plans/. Environment: docs/ENV.md.

## Stack
- Next.js 16 App Router + React 19, TypeScript strict, built with vinext for
  Cloudflare Workers (same toolchain as regenera-development-office)
- Hosted as a second Sites project (.openai/hosting.json): D1 (binding DB) with
  Drizzle ORM + drizzle-kit, R2 (binding BUCKET). No Queues or Cron bindings:
  jobs live in the D1 jobs table and run via POST /api/jobs/tick
- Auth: Sign in with ChatGPT (lib/chatgpt-auth.ts) + allowlist (lib/auth.ts
  requireOsUser). The Site is public; every (app) route and server action calls
  the guard. Anonymous routes are only the five listed in SPEC section 23
- NO Supabase, ever
- Anthropic API server-side only. Models: claude-sonnet-5 for research,
  scoring, drafting, reports; claude-haiku-4-5-20251001 for reply
  classification and extraction
- Google APIs: Gmail, Calendar, Drive (OAuth, internal Workspace app)
- Resend (mail.regenera.bio) for system notifications only
- zod for all external and AI payloads

## Commands
- npm run dev (vinext, port 5180 via -- --port 5180; local mock sign-in at /signin-with-chatgpt?return_to=/today
  as seedy@sites.test) / build / start / lint / typecheck / test
- npm run db:generate (drizzle-kit); apply local migrations with
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/<file>.sql
  (build once first to generate dist/server/wrangler.json). Production migrations apply on Sites publish
- Local secrets in .dev.vars (ignored)

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
  actions and urgency only. CSS Modules per screen. No Tailwind.
- Write JS regex and embedded scripts in their own files and run node --check.
  Avoid ID-level display overrides in CSS.
- Tests required for: dedupe, scoring, screening matrix, send idempotency,
  suppression, reply classification routing, style validator, mandate scoping,
  job claim safety, route guard.
- Build phase by phase; write docs/plans/phase-N.md and wait for approval
  before building a phase.
- Ask before adding paid services or changing the stack.
