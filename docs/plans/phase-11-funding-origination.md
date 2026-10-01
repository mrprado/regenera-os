# Phase 11 — Funding origination, public & blended finance, delivery team and economics

Funding stops being a feed. It is a pathway: funding opportunity → eligibility → ideal applicant profile → applicant /
client discovery → qualification → discovery → paid diagnostic → bid / no-bid → engagement → consortium → application
→ submission → award → implementation → reporting → additional capital → renewal / expansion. It serves existing
clients (client-first) and originates new relationships (funding-first), and it feeds project capital stacks
(stack-first). Positioning: Funding & Capital Strategy / Public & Blended Finance, not grant writing.

## Where it lives (no new top-level module)

- Capital → Funding section: Opportunities, Calendar, Bids & applications, Applicants, Funding origination, Awards &
  post-award, Funders, Bid library, Funding practice economics (`/funding?tab=…`, `/funding/economics`).
- Opportunity: `/funding/[id]` with Overview, Eligibility, Applicant profile, Applicants, Consortium, Application,
  Documents, Activity, an executive strip (eligibility, applicant, strategic fit, timing, consortium, match) and a right
  context panel (route, client fit, project fit, owner, next action, source, verification).
- Application workspace: `/funding/applications/[id]` with the 14 tabs of §20.
- Relationships → Specialists (`/specialists`); Operations → Capacity (`/capacity`). Both Regenera-internal.
- Clients: organization pages show Funding pathways (Confirmed eligibility / Potential fit / Needs review) and Expansion.
- Project 360 → Capital → Funding: public funding matched by sector and country; "Start pathway" creates a funding
  pathway; awards become approved pathways; a pathway enters a capital structure once (no double counting).
- Command (internal): Funding section with the §45 counts, applications at risk and capacity warnings.

## Data (migration 0042, additive)

`funding_opportunities` gains §16 kind, call data (eligibility, objectives, application), applicant profile, owner,
next action, project, territory and provenance (retrieved, verified by / at, extraction confidence). New tables:
funding_prospects, funding_readiness, bid_reviews, funding_applications, consortium_members, application_tasks,
funding_awards, funders, funding_dates, org_registrations, team_members, allocations, specialists, practice_scenarios,
expansion_opportunities. `engagements` gains funding line, origin opportunity, fee basis, budget lines.
`bid_library` gains tags and approval. Services catalogue gains nine funding services (planning ranges, editable).

## Rules

- Keyword counts are a discovery signal only. No 0–100 fit, no award probability; evidence flags instead.
- Eligibility: Confirmed / Likely / Uncertain / Not eligible; Confirmed requires its basis.
- Readiness: ten dimensions, categorical (Ready … Unknown), a source for every "ready".
- Bid / no-bid shows fee, cost lines, GP, GM, hours, opportunity cost before a person decides; ≥ 25k needs senior
  approval. AI cannot decide, approve or submit. Submission is recorded by the person who submitted.
- Default fees fixed / milestone / retainer; contingent fees carry LEGAL / PROGRAM REVIEW REQUIRED; procurement is
  distinguished from grants.
- Outreach positions pathway, eligibility, readiness and strategy; award promises are flagged by the validator.
- Drafts are grounded in the call text, applicant and project records and approved library blocks; each section is
  labelled source fact / client-provided fact / draft language / missing evidence.
- Team cost rates, capacity, specialist ratings and practice economics are internal only. Scenario outputs are
  ILLUSTRATIVE unless a person designates a forecast. The OS warns about capacity; it never accepts work.

## Acceptance

`tests/integration/funding-origination.test.ts` runs §66 end to end (open call → profile → candidates → deduplicated
prospect → client opportunity → outreach draft in the approval queue → discovery → diagnostic at the planning price →
readiness → bid / no-bid with economics and senior approval → application with 14-step workplan and consortium gaps →
review ladder → human approval → recorded submission → award → pathway in the capital stack once → post-award
engagement → funding-originated revenue) and client-first (a call becomes a project pathway once).
`tests/unit/funding-origination.test.ts` covers readiness, flags, positioning, profile, economics (the §33 example),
capacity, hiring guidance, scenarios, stack double counting, classification, consortium gaps, originated value, funnel.
