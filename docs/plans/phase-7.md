# Phase 7 — architecture consolidation and map discovery

2026-09-25. Authorized by the request to audit and implement in phases, then narrowed for the Lucky Futures comparison to adding missing capabilities only. The existing stack, navigation, mandate scoping, and canonical records remain authoritative.

## Phase 7A: map discovery

Add a synchronized, keyboard-accessible directory for all existing map record types; filter by existing sector and country; search names, place and existing descriptions; show clear location basis and data provenance; provide useful record links. Keep globe, terrain, clusters and hazard layers. Honor reduced motion. Fix silent hazard failures and distinguish no data from loading or failed data. No new organization, project, tag or resource databases. Project boundary rendering remains a later canonical map capability.

Migration: none needed for this phase. Existing organization descriptions/industry/website, project systems/description/geometry, document links and sources supply the context. A directory is a read model, not a new entity.

Validation: map filtering, coordinate validation and geometry tests; mandate scoping regression; lint, typecheck, tests and production build. Keep baseline failures separate from introduced failures.

## Subsequent architecture phases

7B: versioned workflow definitions and project gate evaluations using existing readiness, requirements, constraints, decisions and stage history; atomic transitions, approvals and exceptions; decisions extended rather than duplicated.

7C: engagement economics on contracts/deals, deliverables and client dependencies; funding sequencing on existing capital requirements; SystemAssessment for sourced needs, gaps and project fit.

7D: external identity mappings, transactional events over the current jobs queue, unified proposals/approvals; permissions and provider routing around current AI runs; residency/consent constraints enforced at adapter boundaries.

7E: evidence-backed outcomes, versioned reporting, resource allocation and portfolio dependencies. External portals remain deferred until real access requirements and approved datasets exist. Public map publication is separate from the private OS.

These are implementation phases, not claims of shipped functionality. Track actual completion and evidence in the audit and build report.

## Land id follow-up

The user also requested a focused review of id.land. `land-intelligence-addendum.md`, now linked from the canonical
master spec, defines L1–L4 for parcels, geometry, spatial screening, fieldwork and reporting. The existing Place
screen's evidence checklist was expanded immediately; it introduces no schema or provider dependency. Broader land
features retain their explicit pending status. This is additive scope, not a competing project/CRM architecture.
