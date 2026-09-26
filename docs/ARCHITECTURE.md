# Architecture

Detailed history: docs/regenera-os-architecture.md (phase 6), docs/master-spec.md, BUILD_CHECKLIST.md (master build).

## Runtime
One Cloudflare Worker (`regenera-os`) serves regenera.bio/os/* (routes placed in front of the public site). vinext
builds the Next.js App Router app; static assets through the ASSETS binding; D1 (`regenera-os-d1`) is the only database;
a cron trigger every 5 minutes runs the job tick. R2 (files) is prepared but not enabled.

## Layers
| Layer | Where | Notes |
|---|---|---|
| Pages and actions | `app/(app)` (internal), `app/(portal)` (portals), `app/(public)` (intake), `app/api` | Each guards itself: requireOsUser / withOsUser / getOsApiUser; requirePortalUser / withPortalUser; anonymous routes call a named verifier (tests/unit/route-guard.test.ts) |
| Domain logic | `lib/*` | Functions over a `Db` parameter, so they are testable; only edges call `appDb()` or read `env` |
| Schema | `db/*.ts`, exported by `db/schema.ts` | Drizzle; migrations in `drizzle/` (0000–0024), additive only |
| Jobs | `lib/jobs/*` | Claim-safe queue in D1; schedules (cadence strings) for funding scans, place refresh, capital rematch, expiries, event dispatch, digest, backups |
| Integrations | `lib/sources/http.ts` (fetchJson), `lib/integrations/*`, `lib/place/*` | Registry gate, cache, retries/backoff, ledger, stale fallback |

## Canonical graph
Organizations, people, projects (with parties, readiness, constraints, stage history, plan, engineering, materials,
procurement, systems, risks, E&S, insurance, economics, regulatory records, place facts, claims), capital (profiles,
mandates, qualifications, requirements, tranches, opportunities, matches, commitments), agreements (register,
obligations, documents), opportunities (deals), relationships (derived + manual edges), portals (users, grants, data
rooms, introducers), playbooks, events, notifications. Entity scoping ("mandates" in the schema, Entities in the UI)
separates Regenera's own work from investment mandates and the DEMO entity.

## Operating loops
Events (append-only) → trigger rules → notifications / tasks / playbook runs / jobs. Playbooks carry Process, Toolbox,
Proof and Governance; corrections create draft versions approved by an owner. Stage gates are evidence checks.

## Stack decisions versus the generic instruction
See BUILD_CHECKLIST.md "Stack decision": D1 instead of Supabase/PostGIS (standing rule), server-enforced scoping instead
of RLS, CSS Modules instead of Tailwind, cron + D1 queue instead of pg-boss, pdf-lib instead of Playwright PDF, one app
instead of a pnpm monorepo.
