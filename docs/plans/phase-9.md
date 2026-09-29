# Phase 9 — Master additions: community & knowledge governance, power stack, economics, intelligence, compliance, learning

Source: the "Master Additions Build" prompt, the Community Rights + Knowledge Governance prompt, and the BESS / data
center / large-load prompt (2026-09-29). Stack decision (user, 2026-09-29): no paid integrations; use the best free
public equivalent anywhere in the world. Everything is additive to the existing Worker + D1 + Drizzle stack.

## What already exists (reuse, do not rebuild)

| Spec area | Existing module |
|---|---|
| Signals, triggers, source watch | `signals`, `triggers`, `trigger_queries`, `trigger_rules`, lib/triggers, lib/radar |
| Capital mandates and matching | `capital_profiles`, `capital_mandates`, `capital_matches`, lib/capital/engine (commercialFit, eligibility, gates) |
| Canonical institutions / people | `organizations`, `contacts` (+ contextual roles: partners, network_profiles, capital_profiles, broker_profiles) |
| Relationship graph | `relationships`, `relationship_edges`, /relationships |
| Evidence status, claims | `claims`, `claim_evidence`, `verifications`, `decisions` |
| Suppression, send-time compliance | `suppression`, lib/crm/send.ts gate, sequences with stop rules |
| Portals, progressive disclosure, deal rooms | `portal_users`, `portal_grants`, `data_rooms`, `nda_acceptances`, `distribution_approvals`, brokers, referrals |
| Permits, requirements, KYC | `permits`, `requirements`, `regulatory_reviews`, `kyc_checks` |
| Contract obligations | `contract_obligations`, lib/contracts/register |
| Capital stack, structures, pathways | `capital_structures`, `capital_stack_layers`, `funding_pathways`, `capital_tranches` |
| Project finance model | `fin_models` (CFADS, DSCR sculpting, waterfall, sensitivities, revenue classes) |
| Playbooks, postmortem seeds | `playbooks`, `playbook_runs`, `playbook_corrections`, `case_records` |
| Natural assets, land pipeline, MRV | phase 8 natural layer |
| Services, pricing, engagements | phase 8 commercial layer |

## Build order (each slice: schema → engine with tests → UI → wiring → deploy)

1. **Community & knowledge governance** (new): communities, rights, authorities (incl. knowledge authority powers),
   knowledge records (metadata only; existence-only and sacred records never hold content), granular activity
   permissions incl. seven AI permissions, FPIC/consent records, engagement timeline, participation structures,
   three separate ledgers (mitigation/compensation, economic participation, development/partnership), community funds,
   governance rights, commitments, grievances, knowledge-use register with withdrawal propagation, community economics
   (year-by-year, nominal/real/discounted, scenarios), stage gates, capital-profile community alignment and explainable
   fit, search/ask/MCP exclusion (tested), Local Contexts fields (NOT CONNECTED adapter), portfolio dashboard.
2. **Power stack**: PPA engine (types, terms, risk allocation, credit, lender rights, conditions) with independent
   bankability dimensions; revenue stack view (contracted %, merchant %, concentration, tenor); grid/interconnection
   records; BESS technical/commercial fields and LCOS; large-load / offtaker power requirements (data centers etc.);
   power-to-load matching in both directions; free map layers (OSM power, data centers where mapped).
3. **Technology & cost benchmarks**: technology library, cost benchmarks with provenance and normalisation (currency,
   base year, units), benchmark engine (percentile, deviation, "ask why" flag), contradiction detection across sources.
4. **Intelligence depth**: signal interpretation + independent relevance dimensions (rating, reason, evidence,
   confidence), mandate evidence layers (stated / public / observed / inferred), thesis intelligence and thesis→mandate
   gap, institution and person watch (professional activity only).
5. **Prospecting compliance**: contact source ledger (unknown provenance not outreach-eligible), campaign object,
   activity classification, permission states with reasons, legal campaign brief (never presented as legal advice),
   risk tiers with human approval, suppression statuses.
6. **Learning, field notes, feedback loops**: reading objects, curriculum, field notes with visibility and attribution
   funnel, postmortems feeding benchmarks/playbooks/partner performance, next-best-action with provenance, portfolio
   concentration, exit/buyer universe and value by milestone.

Freeze rule (user): no new top-level modules unless a genuinely new domain appears. After this phase: a production
hardening / gap audit returning implemented / partial / missing / broken / static / not-connected per module.

## Non-negotiables carried into every slice

- DEMO data is labelled DEMO; unconnected integrations are labelled NOT CONNECTED; unknowns show UNKNOWN.
- No opaque AI scores: fit and bankability are explained per dimension with evidence.
- AI may suggest, classify, compare and draft; it never changes verified facts, publishes, sends capital
  solicitations, approves legal/compliance conclusions, alters permissions or discloses protected knowledge.
- Restricted knowledge never reaches lib/ask, lib/mcp, search snippets, exports or portal views (tested).
- Compensation is never counted as community benefit; consultation is never shown as consent.
