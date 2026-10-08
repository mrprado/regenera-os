# Phase 22 — Global origination, capital intelligence and project development engine

Source: founder directive "Regenera OS — Global Origination, Capital Intelligence & Project Development Engine" plus the
project-first addendum (2026-10-08). Extends phases 6–21; replaces nothing that works. Status: **awaiting approval**.

Operating cycle: DISCOVER → VERIFY → MATCH → QUALIFY → ENGAGE → DIAGNOSE → STRUCTURE → EXECUTE → LEARN.
Two equal entrances (capital-first, project-first) plus market-first, all writing to the same records.

## 0. Audit: what already exists (verified in code and on os.regenera.bio, 2026-10-08)

| Directive area | Already built (where) | Gap this phase closes |
|---|---|---|
| Repository / deploy | regenera-os → Cloudflare Worker `regenera-os` at os.regenera.bio; D1 + R2; jobs table + cron; migrations through 0055 | — |
| Canonical records | projects, organizations, contacts, project_parties (typed roles), claims + claim_evidence, ontology relations / aliases (phase 19), registry_assets, events | Verification states as directed (MISSING, EXPIRED, CONFLICTED mapping); validity + last_checked on claims |
| Capital records | capital_profiles (lane, ticket band, preference — owner-only), capital opportunities, matches, qualifications, KYC, programme catalogue (33 programmes) | Normalized **eligibility rules** per funding record and per programme; 5-state eligibility output |
| Funding ingestion | Grants.gov, World Bank (notices; awards kept separately), EU F&T, TED, UK Contracts Finder, UK Find a Tender, SAM.gov (dormant until key), rules read + AI read | IATI (key), DFI / climate-fund project feeds; capital-stage tagging (development / construction / long-term) |
| Project discovery | World Bank loop → Market pipeline (claims, parties, screening, assessment); document extraction (PDF → projects); partner scans | Project-first workspace with three strategies (existing projects, sites & assets, needs-based) |
| Matching | Funding ↔ project (hard gates + reasons, phase 21); capital rematch; programme fit; partner scans | Eligibility states replace "match", soft ranking separate, capital stage fit, suppression of engaged / expired |
| Readiness | 14 readiness dimensions per project, constraints, critical path, screening economics | **Published rubric**, sector templates, evidence sufficiency, blocking issues, work packages, dossier |
| Site / spatial | Atlas workbench, site screen (15 stages), saved assessment, registry plants | Country-level opportunities drawn as regions, not points; suitability score from the rubric |
| Commercial | Deals (tracker stages), commercial engagements + services catalogue (diagnostic → retainer), pursuits / approvals (phase 14), outreach approval queue + send gate | Origination stage field and queue; diagnostic proposal generated from the dossier; prioritization by expected engagement value |
| Compliance | Counsel review for success fees / equity / investment mandates, sanctions screening, protected parties, guardrails | Jurisdiction gate on capital introduction / placement offerings |
| Client entry | Portal (portals), intake API (regenera.bio events) | Sponsor "submit project" and capital-partner "declare mandate" flows feeding the same records |

Known live failure that blocks AI-assisted steps: the Anthropic account has no credit (rules paths keep data moving).

## 1. Scope (smallest complete vertical slices first)

### Slice A — Capital-first, end to end (Test A)
1. **Eligibility rules** (`funding_eligibility` table): per funding record, normalized rules extracted from structured fields
   (+ AI read when available): geography, applicant types, sectors, ticket min/max, stage, window, exclusions, required
   documents, co-financing; each rule carries its source and verification state.
2. **Eligibility engine** (pure, tested): hard checks first → `ELIGIBLE` · `POTENTIALLY_ELIGIBLE` (requires
   verification) · `INELIGIBLE` · `INSUFFICIENT_EVIDENCE` · `EXPIRED_OR_CLOSED`; then soft factors (strategic relevance,
   ticket alignment, maturity, documentation, ESG) shown separately. No numeric score substitutes for eligibility.
3. Funding ↔ project matches upgraded to carry the eligibility state, failed/unknown rules and diligence questions.
4. **Project origination dossier** (versioned generated document): sponsor, site, stage, evidence, readiness gaps,
   financing thesis by capital stage, counterparties, next action.
5. **Diagnostic proposal**: from the dossier and the services catalogue (Funding Eligibility & Project Diagnostic),
   a draft engagement + outreach draft into the existing approval queue (never sent without approval) + CRM task.

### Slice B — Project-first, end to end (Test B)
1. **Origination workspace** `/origination`: entrances *Existing projects* (Market pipeline, extracted documents, CRM),
   *Sites & assets* (Atlas site screens), *Market needs* (hypotheses, Slice C); one queue.
2. **Readiness rubric** (published in-app): 14 dimensions × sector templates (solar/BESS, wind, WtE / resource recovery,
   water / wastewater, restoration / nature, real estate / built). Each dimension: evidence found, sufficiency, score
   0–3 or **insufficient data**, blocking flag. Missing documentation never scores as favourable.
3. **Capital pathway by stage**: development capital / construction capital / long-term capital, each matched only to
   programmes and providers whose lanes fit that stage (e.g. no operating-asset buyer for a pre-permit project).
4. Gap analysis + work packages mapped to services; saved on the project record.

### Slice C — Market-first (Test C)
Signals (triggers, hazards, queue changes, policy items) → **Hypothesis** records (`origination_hypotheses`): region
boundary or country, thesis, evidence links, candidate counterparts from Network, required validation; always labelled
HYPOTHESIS, never shown as a project; queued for human validation, convertible to a project or pursuit.

### Slice D — Commercial engine (Test E)
Origination stage on pursuits (Discovered … Won / Lost / Deferred, the directive's 21 stages) without changing tracker
deal stages; prioritization by expected qualified engagement value from real records (service band × eligibility ×
readiness evidence); offerings A–G mapped to the existing catalogue with scope, questionnaire, checklist, milestones;
jurisdiction review gate for capital introduction / placement-like work (flags "licensed intermediary may be needed").

### Slice E — Atlas and dashboards
Country-level funding drawn as country regions (Natural Earth admin-0, public domain) instead of a reference point;
Atlas inspector deep links to dossier, eligibility, diagnostics; Command adds "qualified matches today", "hypotheses to
validate", "diagnostics to complete"; Capital adds the eligibility explorer.

### Slice F — Reliability (Test F) and documentation
Idempotent syncs, contradiction visibility, stale handling, permission tests for every new action; docs: ontology,
eligibility + readiness rubrics, agent permission matrix, env inventory (no values), runbooks, status ledger.

## 2. Status ledger (kept current in this file)
Each capability is marked **implemented & tested** · **implemented, unverified in production** · **planned** · **blocked**.
Phase 21 entries: implemented & tested — pipeline unblock, source registry, Atlas workbench, site screen, GPPD ingestion
(live: ingesting), World Bank loop, funding ↔ project matching, awarded contracts. Implemented, unverified in production —
SAM.gov (needs SAM_API_KEY), UK Find a Tender (first scan pending). Blocked — AI reads (Anthropic credit), IATI / EIA /
ENTSO-E / NREL (keys), GEM (download form), WDPA commercial use (licence).

## 3. Not in this phase
Regulated placement or brokerage features; automatic sending; paid data sources; investor-facing deal rooms beyond the
existing portal; financial models beyond the existing screening model.

## 4. Stack
No change: Workers + D1 + R2 + jobs table. New tables are additive (eligibility rules, hypotheses, origination stage
columns, dossier versions in generated_documents).

## 5. Definition of done
Tests A, B, C, E and F pass as integration tests with real fixtures of real source responses; on production, one real
funding record and one real project traverse their slice with persisted record IDs, events and documents listed in the
completion report, plus the status ledger above.

---
## Build record (2026-10-08) — approved by the founder ("finish and add")

Added to scope: the commercial operations engine and five revenue engines (founder brief, same day): services catalogue
gains Project Diagnostic, readiness assessment, Development Office retainer, managed intelligence, capital-provider
screening, AI origination system implementation, market-access retainer, technology commercialization, OS subscription
tiers and development partnership (bands are hypotheses; capital-introduction work carries a legal gate).

### Status ledger
| Capability | State |
|---|---|
| Eligibility engine (5 outcomes, checks, questions, capital stage) on funding ↔ project matches | implemented & tested |
| Readiness rubric (6 sector templates, evidence caps, insufficient data, blocking, work packages) | implemented & tested |
| Capital pathways by stage (viable and not-viable with reasons) | implemented & tested |
| Origination dossier (versioned, confidential) | implemented & tested |
| Diagnostic proposal: draft engagement + proposal doc + outreach draft + approval task | implemented & tested |
| Market-first hypotheses (≥3 signals / country / sector / 60 days), validate / convert / dismiss | implemented & tested |
| Unified origination queue (3 entrances, 20 stages, expected value from bands × evidence) | implemented & tested |
| Commercial operations: service recommendation by need / role | implemented & tested |
| /origination (Queue, Hypotheses, Rubric, Revenue engines), project readiness panel, Command counts | implemented, tested, verified in production (deploy 98464fdc, 2026-10-08) |
| Funding geographies drawn as country regions in Atlas | implemented & tested (Natural Earth 1:110m, public domain, public/geo/countries-110m.json) |
| Capital-partner "declare mandate" and sponsor "submit project" flows | implemented (existing public intake: a converted sponsor submission becomes a project and enters the origination queue; a capital submission becomes an owner-only capital profile used by capital rematch) |
| AI narrative in dossiers / proposals | blocked (Anthropic credit) |

### Agent permission matrix
| Automatic (audited) | Requires a person |
|---|---|
| Fetch public sources, normalize, dedupe, claims with evidence | Any external message (outreach drafts stay in documents / approval queue) |
| Eligibility checks, matches, readiness scoring, hypotheses | Converting a hypothesis into a project |
| Dossiers, site assessments, queue sync | Drafting a proposal / engagement (owner), sending, applying, introductions |
| Review tasks | Stage changes, accept / dismiss matches, any commitment, deletion |

### Environment variables (names only)
OS_ALLOWLIST, OS_PASSWORD, OS_OPEN_ACCESS, JOBS_TICK_TOKEN, ANTHROPIC_API_KEY, APOLLO_API_KEY, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, COMPANIES_HOUSE_API_KEY, SAM_API_KEY, IATI_API_KEY, NASA_FIRMS_MAP_KEY,
GFW_API_KEY, ESRI_API_KEY (full list with purpose: docs/ENV.md).

### Tests
tests/integration/origination.test.ts (Tests A, B, C, F), tests/unit/origination-rules.test.ts, tests/unit/funding-match.test.ts,
tests/integration/wb-loop.test.ts (Test G).
