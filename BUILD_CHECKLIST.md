# Regenera OS — build checklist (master production build instruction, 2026-09-26)

Status legend: **Done** (verified by test or browser), **Built** (code exists, verification noted), **Adapted** (built
on the existing stack instead of the literal instruction), **Pending**, **External** (needs Prado: credential, licence,
account, counsel).

## Stack decision (applies to every phase)
The instruction asks for a pnpm monorepo on Supabase Postgres/PostGIS/Auth/Storage, Tailwind and pg-boss. Regenera OS
already runs in production at regenera.bio/os on Cloudflare Workers + D1 with 225 passing tests, and two standing
rules apply: **never Supabase** and **no Tailwind** (CLAUDE.md, memory). So the spec is built onto the existing stack:

| Instruction | Built as | Why |
|---|---|---|
| Supabase Postgres + RLS | D1 (SQLite) + server-enforced scoping (`lib/db/scoped.ts`, `mandateCondition`) + portal grants; tests assert isolation | No Supabase; every query already passes the scope guard and lint blocks unscoped DB access |
| PostGIS | GeoJSON in D1 + Turf-style helpers + server-side bbox queries | D1 has no PostGIS; volumes are small |
| Supabase Auth / roles | Internal: email + password sessions (existing). External portals: separate `portal_users` with PBKDF2 hashes, invite links, `portal_session` cookie | External users must never share the internal session |
| Supabase Storage | Document registry with external links; R2 adapter when R2 is enabled (External) | R2 not enabled yet |
| pg-boss / Redis | D1 `jobs` table + cron tick (existing) | Same guarantees (claim safety tested) |
| Tailwind + shadcn | CSS Modules + design tokens (existing rule) | No Tailwind |
| pnpm monorepo, Vercel, Docker worker | Single vinext app on Workers; worker = cron trigger | Already deployed; no second runtime to operate |
| Playwright PDF | pdf-lib in the Worker (existing, branded) | Playwright cannot run in Workers |
| OpenAI + Anthropic | Anthropic server-side (existing), app works without a key | Stack rule; provider interface kept small |

## Gap analysis against the instruction (numbers = instruction sections)

| # | Area | Before this build | Status |
|---|---|---|---|
| 01–02 | One platform, internal + portals + intake | Internal OS only | Pending → portals phase |
| 06 | Sidebar | Grouped sidebar (Today, Origination, Projects, Capital, Intelligence, Work) | Adapted (keep routes; no rename churn) |
| 07 | Command | Today page with panels | Done (Today); pending: needs-attention ranking, map |
| 08–09 | Projects, record, stages | 14-tab project record, 18 stages, readiness with evidence | Done |
| 10–11 | Capital, matching, stack | Profiles, mandates, qualifications (owner-only), opportunities, transparent matching with eligibility gate, tranches | Done; capital-stack scenarios via Economics |
| 12 | Deals + stage gates | Opportunities pipeline | Pending: stage-gate conditions |
| 13 | Engagements | Regenera contracts per engagement, fees, success-fee review flag | Done |
| 14–15 | Relationships, outreach | People, companies, relationships, one-to-one approved sends, Gmail/Calendar | Done; pending: graph view / warm paths |
| 16–17 | Intelligence, triggers | Signals, trigger queries, funding radar | Done; pending: rule-driven trigger definitions |
| 18–19 | Atlas, spatial engine | Map page (MapLibre) + place profile | Partial → Atlas phase |
| 20–21 | Systems, interventions | Territorial systems tags | Pending |
| 22–23 | Playbooks + learning loop | Playbook drafts (phase 4) | Pending: Process/Toolbox/Proof/Governance engine |
| 24 | Evidence + claims | field_sources, verifications, place_facts with provenance | Partial → claims/evidence phase |
| 25–26 | Documents, data rooms | Document registry with versions | Pending: data rooms, NDA gate, access logs |
| 27–28 | Templates, PDF/DOCX | 5 contract templates, branded PDFs | Pending: more templates, DOCX |
| 29 | Obligations | Done (M3) | Done |
| 30 | E-signature | — | Pending: provider interface + mock + signed upload |
| 31–34 | Broker portal, registration, economics, materials | — | Pending (mandatory) |
| 35–38 | Capital, sponsor, partner, stakeholder portals | — | Pending |
| 39–41 | Compliance, securities, KYC | Regulatory M4, KYC owner-only, send-time gate | Done; pending: distribution log for portals |
| 42–44 | Search, Ask, AI governance | Cmd+K, Ask the OS with tools, proposals queue | Done |
| 45–48 | Data model, visibility, auth, audit | Audit log, scoping | Pending: explicit visibility for external scopes |
| 49–57 | Connector framework + providers | Registry of 43 with licence states, gate, stale fallback, 5 place adapters | Partial → integrations phase (PVGIS, Copernicus STAC, EIA, NOAA, FIRMS, ENTSO-E, IMF, Open-Meteo …) |
| 58–60 | .env.example, integration center, licence profiles | Settings → Integrations | Partial |
| 62–63 | Notifications, tasks | Tasks, digest | Pending: notification centre |
| 64–65 | Reports, exports | Weekly report, brief PDF, CSV registers | Partial |
| 69 | Public intake | Site webhook intake | Pending: /intake/{project,capital,broker,partner} |
| 70–72 | Financial data, risk, readiness | Economics, risk register, readiness | Done |
| 89–91 | Demo data | `[local test]` records locally | Pending: is_demo seed |
| 92–94 | Tests incl. broker/portal security | 225 tests | Pending: portal security tests |

## Phase log
(Each phase: tests run, failures repaired, this file updated.)

### Phase P1 — External portals, intake, introducers, data rooms (2026-09-26)
- Built: portal accounts (invite → password → session, PBKDF2), explicit grants, access log, document gateway,
  sponsor / capital / introducer / partner portals (+ stakeholder behind flag), public intake ×4 with honeypot and
  rate limit, introducer onboarding, referral registration with conflict checks, agreements, commission schedules
  and events with approval blockers, distribution approvals, data rooms with NDA gate, document requests, approved
  updates, messages, admin page /portals. Migration 0018 (additive).
- Verified: tests/integration/portal.test.ts (10 tests incl. every §93/§94 case) pass; route-guard test extended
  (portal pages need requirePortalUser, portal code never touches the OS session) passes; browser: broker intake →
  convert → invite → password → introducer portal (inactive notice) → referral → internal queue shows 4 conflicts;
  capital and partner invites render every tab; cross-portal URLs redirect to the user's own portal.
- Status: **Done** for §31–35, §37, §46 (portal scope), §69, §93, §94. §36 sponsor portal Built (view tested; page
  rendered through tests of its view, not a browser pass). §38 Built behind flag.

### Phase P2 — Playbook engine + learning loop; P3 — claims and evidence (2026-09-26)
- Built: migration 0019 (playbooks, playbook_versions, playbook_runs, playbook_corrections, claims, claim_evidence);
  20-playbook library; runner with tools, governance, proof checks, approval; corrections → draft versions → owner
  promotion; repeat detection; claims with evidence, verification rule, supersession and as-of queries; /playbooks,
  /playbooks/[id], /playbooks/runs/[id]; project "What we know, and how" panel; "Run site intelligence".
- Verified: tests/integration/playbooks.test.ts (5 tests) pass; browser: Run site intelligence on Valle Solar → run
  with both autonomous tools done (place profile queued, study gaps listed), review steps open, definition of done
  2/2 checks pass, run stays "needs review" until the review steps are done; project overview renders the claims panel.
- Status: **Done** §22, §23, §24 (claims/evidence), §44 (step governance), §74 (claims as-of).
