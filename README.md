# Regenera OS

The internal operating system of Regenera — *Regenerative Ecosystem Advisory. Capital aligned with living systems.*
One graph-centred platform connecting people, capital, land, projects, infrastructure, energy, nature, regulation,
execution and outcomes, with controlled external portals for sponsors, capital partners, introducers and partners.

Live: https://regenera.bio/os (internal) · https://regenera.bio/os/portal/signin (portals) ·
https://regenera.bio/os/intake/project (public intake: project, capital, broker, partner)

## Architecture
- Next.js 16 App Router + React 19 + TypeScript (strict), built with vinext for Cloudflare Workers.
- Cloudflare D1 (SQLite) through Drizzle; migrations in `drizzle/` (additive only). No Supabase (standing rule).
- Jobs: D1 `jobs` table + a cron trigger every 5 minutes (`/api/jobs/tick`); claim-safe, retried, logged.
- Auth: internal members (email + password, sessions in D1); portal users are a separate population (invite links,
  PBKDF2 passwords, their own cookie). Every page, action and API route guards itself (tested).
- Scoping: every query on entity data goes through `lib/db/scoped.ts`; portal reads go through `lib/portal/access.ts`
  and whitelisted view models.
- CSS Modules with Regenera design tokens (no Tailwind), MapLibre for Atlas, pdf-lib for PDFs, fflate for DOCX/ZIP.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [BUILD_CHECKLIST.md](BUILD_CHECKLIST.md) for what exists and
how the master build instruction maps onto this stack.

## Quick start (local)
```bash
npm ci
cp .env.example .dev.vars   # fill OS_PASSWORD and OS_ALLOWLIST at minimum; everything else is optional
npm run build               # once, to produce the local D1 config
npm run db:migrate:local
npm run db:seed:local
npm run dev -- --port 5180  # open http://localhost:5180/os
```
Run the job tick locally: `curl -X POST -H "Authorization: Bearer local-dev-tick-token" http://localhost:5180/os/api/jobs/tick`.
Demo data: Settings → Demo data → Load (a separate "DEMO" entity; every record is labelled).

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Local dev server (vinext) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Vitest (unit + integration against a real local D1) and the map discovery test |
| `npm run ci` | lint + typecheck + test + production build (the verify step) |
| `npm run db:generate` | New migration after editing `db/*.ts` |
| `npm run deploy` | Build, apply D1 migrations remotely, deploy the Worker (wrangler login first) |
| `npx tsx scripts/gen-api-integrations.ts` | Regenerate docs/API_INTEGRATIONS.md from the registry |

## Environment
Names only in [.env.example](.env.example); details in [docs/ENV.md](docs/ENV.md). Secrets are Worker secrets
(`npx wrangler secret put NAME --name regenera-os`), never committed, never sent to the browser. Integrations without
credentials show "Integration ready: credential required" and nothing is fabricated.

## Surfaces
Internal: Today (Command), Projects (14+ tabs: place, readiness, plan, constraints, engineering, materials,
procurement, systems, risk & E&S, capital, economics, regulatory, partners, contracts, funding, activity), Capital,
Opportunities, Relationships, Intelligence, Atlas, Systems, Playbooks, Documents (+ generator), Contracts, Portals,
Notifications, Settings. External: sponsor, capital, introducer, partner portals; stakeholder portal behind a flag;
public intake. See [docs/PORTALS.md](docs/PORTALS.md).

## Data provenance
Every external fact carries provider, tier, licence, retrieval date and stale state; claims have statuses from
Verified to AI inferred, and AI output can never become Verified without non-AI evidence and a person. See
[docs/source-provenance.md](docs/source-provenance.md), [docs/PLAYBOOKS.md](docs/PLAYBOOKS.md) and
[docs/API_INTEGRATIONS.md](docs/API_INTEGRATIONS.md).

## Security and operations
[docs/SECURITY.md](docs/SECURITY.md) · [docs/OPERATIONS.md](docs/OPERATIONS.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
· [docs/COMPLIANCE.md](docs/COMPLIANCE.md) · [docs/DOCUMENTS.md](docs/DOCUMENTS.md) · [docs/DATA_MODEL.md](docs/DATA_MODEL.md)

## Testing
Vitest with a real local D1 (`tests/helpers/d1.ts`); CI runs lint, typecheck, tests and build without provider keys
(adapters are tested against recorded fixtures). Browser end-to-end tests (Playwright) are not set up yet; flows are
verified in the browser during each build phase and recorded in BUILD_CHECKLIST.md.
