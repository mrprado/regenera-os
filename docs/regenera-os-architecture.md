# Regenera OS architecture

Canonical spec: docs/master-spec.md. Audit: docs/audit-2026-09.md. Plan and build reports: docs/plans/phase-6.md.

2026-09-25 addendum: `architecture-audit-2026-09-25.md` maps the latest conversation requirements onto existing models;
`plans/phase-7.md` sequences the remaining work. Map discovery now reuses canonical scoped records with a synchronized
directory, existing country/sector/topic filters, richer context and explicit location basis. See `lucky-futures-gap-review.md`.
This additive map phase creates no database models or migrations. Broader workflow/control phases remain pending.
The Land id review adds parcel-level requirements in `land-intelligence-addendum.md`, linked from the canonical spec.
The Place screen now exposes a deeper land-evidence checklist and links to the existing contracts, engineering,
constraints and planning workflows. Parcel databases, geometry tools and offline sync are specified, not yet built.

## Runtime
One Cloudflare Worker (`regenera-os`) serves os.regenera.bio: Next 16 (App Router, React 19) built with vinext,
no base path, Worker Custom Domain (regenera.bio/os redirects). D1 (SQLite, Drizzle) holds all data; R2 is planned for
file storage. A cron trigger (every 5 minutes) runs the job tick; jobs live in the D1 `jobs` table with cadences,
retries and budgets. See docs/DEPLOYMENT.md.

## The graph
Everything is one relational model scoped by **entity** (Regenera, RA-ESG, GWCe; table `mandates`):

```
PROJECT ── parties (org / person, role) ── readiness (14) ── constraints ── stage history
   │── place facts (sourced)          ── jurisdiction matrix ── requirements (host law | lender standard) ── permits
   │── capital requirements ── tranches ── capital opportunities ── matches (commercial | regulatory) ── ledger ── deliveries
   │── contracts (template | registered) ── parties ── obligations ── versions ── documents
   │── opportunities (deals) ── activities ── tasks (actions)
   └── triggers / signals ── funding opportunities ── funding matches
ORGANIZATION / PERSON ── capital profiles & mandates ── private capital profiles ── investor qualifications ── KYC status
                      ── introductions ── relationships ── outreach (sequences, messages, replies)
REVIEWS (any record) ── who concluded what, on what evidence
INTEGRATIONS registry ── provider_calls ledger ── source_cache
```

## Layers
- **Data** (`db/*.ts`): crm, automation, intel, radar, funding, contracts, projects, capital, regulatory,
  integrations. Additive migrations only (drizzle/0000–0014).
- **Domain logic** (`lib/*`): pure functions taking `db` so they are testable: projects, capital, contracts,
  regulatory, place, integrations, funding, outreach, triggers, crm, ask (tools), mcp.
- **Edges**: pages and server actions (`app/(app)`), route handlers (`app/api`). Every page, action and API route is
  guarded (route-guard test); every query is entity-scoped (`mandateCondition`).
- **External data**: `lib/sources/http.ts` `fetchJson` (registry gate, retries, cache, ledger, stale fallback) used
  by every adapter. No provider is called from a page.
- **AI**: Claude via `lib/ai/run.ts` (versioned prompts in D1, every call logged with cost). Ask the OS and the MCP
  server share one tool registry; writes are proposals confirmed by a person. See docs/ai-governance.md.

## Where the success tests are answered
- **Today** (`/today`): approvals, replies, tasks, projects (blocked, capital needed, moved), regulatory (permits,
  verifications, counsel), contracts (obligations, expiries, reviews), capital gate queue, funding, triggers,
  meetings, next actions.
- **Project** (`/projects/[id]`): Overview, Place, Readiness, Constraints, Capital, Regulatory, Partners, Contracts,
  Funding, Activity; brief PDF.
- **Capital relationship** (`/capital/partners/[id]`, `/capital/private/[id]`): criteria, mandates, matches with
  reasons, ledger, materials received, qualifications, KYC status, introductions, next action.
