# Regenera OS architecture audit — 2026-09-25

Sources: existing `docs/master-spec.md`, the original attachment preserved as `docs/canonical-source-2026-09-25.md`, and the architecture excerpts in `docs/conversation-requirements-2026-09-25.md`. Two cached conversation answers are truncated at 20,000 characters; their missing tails are not treated as reviewed. The final user prompt in that conversation has no cached architecture response.

## Implementation boundary

The repository is an established Next/React/vinext application on Cloudflare Workers with D1/Drizzle. Migrations 0000–0017 already exist. This task preserves that stack. `mandates` is the entity/authorization boundary; `capital_mandates` is an investor mandate. Do not introduce a second tenant or mandate model.

The user's later clarification restricts the Lucky Futures reference to genuinely missing capabilities, not a public-site redesign or replacement OS architecture. Phase 7A implements map discovery only. The broader control capabilities below are audited and sequenced, not silently marked complete.

## Latest requirements mapped to existing implementations

| Requirement | Existing base / evidence | Remaining work |
|---|---|---|
| Workflow engine | Project stages/history, readiness, constraints, milestones; `lib/projects/engine.ts` | Versioned workflow definitions, gates, SLAs and transactional transitions. Current `setStage` is not a bankability gate. |
| Decisions | `db/delivery.ts` decisions + project Plan | Extend review date, dependencies, affected capital/contracts and accepted risks; no second Decision model. |
| Engagement economics | Deals, contracts/terms, contract obligations and payment milestones | Normalize scope changes, client dependencies, accrual/payment ledger and ownership economics. Separate company fees from project cash flow. |
| Deal/opportunity room | `db/crm.ts` deals with links to projects | Enhance the current room; no new Deal table. |
| Stage gates | Readiness and constraints; regulatory capital gate already separate | Enforce project transition predicates, explicit exceptions and evidence. Retain separate solicitation controls. |
| Funding pathways | Capital requirements/tranches, funding matches | Add dependency sequencing, owner and timing to requirements rather than duplicate amounts in another capital stack. |
| System need → project fit | Project systems, place facts, constraints and risks | SystemAssessment is in the spec but not implemented as a schema model. Introduce one assessment backbone with typed need/gap/fit records, provenance and review. |
| Entity resolution | Canonical people/orgs with normalized names, email/domain/LEI/external IDs | Scoped external identity mappings and reviewed merges across providers; never merge on names alone. |
| Events / CDC | Jobs, schedules, activities and audit log | Transactional outbox, versioned event payloads, idempotent consumers and replay; use current queue. |
| Approval queue | `db/intel.ts` proposals; Ask/MCP share `lib/ask/tools.ts` | Extend supported proposals with expected record version, permission recheck, expiry and immutable decision evidence. |
| Agent controls | Scoped tools, AI runs, prompt versions, budget controls | Per-tool/data/action policy, run cancellation, limits and approval requirements. Existing private-capital exclusions remain. |
| Contextual AI panels | Ask + existing project views | Structured allowlisted panel renderer, never arbitrary AI HTML or executable UI. |
| Model router | Existing server-side AI entrypoint | Provider adapter/router constrained by sensitivity, language, jurisdiction, budgets and approved fallback. |
| Residency | Current Worker/D1 deployment | Explicit classification, storage/processing regions and enforceable transfer/retention policy. Do not infer residency from a provider name. |
| Consent/privacy | Consent basis, suppression, privacy requests | Purpose/retention/restriction history and policy checks at reads, exports and sends. |
| Counterparty risk | Organizations, project risks, KYC statuses and supplier profiles | Sourced counterparty assessments, exposure and shared-party concentration; no automatic compliance verdict. |
| Scenarios | `db/economics.ts` base/downside/upside cases | Controlled schedule/capital/risk propagation with versioned assumptions; preserve screening-model limitations. |
| Portfolio dependencies | Project parties, supplier bids, capital relationships | Scoped dependency projections and shared exposure analysis. Reuse existing links before adding entities. |
| Team allocation | Membership and owners | Skills, capacity and allocations only when team workload data is available. |
| Regenera finances | Deal values, contracted fees, invoiced/paid milestones | Company AR, expenses and cash ledger with explicit currencies; no mixed-currency totals or duplicate payment systems. |
| External portals | Private OS and public site already distinct in purpose | Deferred: explicit external access model and approved disclosure datasets first. |
| Reporting | Reports, project briefs and contract PDFs | Audience-specific templates and versioned source snapshots; avoid another reporting database. |
| Outcome verification | Source/verification primitives exist | Outcome baseline/target/method/evidence/reviewer/frequency. Do not treat case studies as verified measurements. |
| Knowledge versioning | Contract versions, prompt versions, audit and stage history | Temporal sourced facts, supersession and as-of queries. |
| Exceptions | Constraints/risks/decisions are available | Approved, bounded exception with reason, accepted risk, expiry/review date and affected gate. |

## Target flow and invariants

Observation → validated ingestion → scoped identity → sourced assessment → opportunity/deal → engagement → project development → capital alignment → approval → execution → evidenced outcomes. Every material step carries owner, state, evidence, dependencies, deadline, decision and next action.

Domain writes, audit/event rows and transition effects should commit together. Consequential AI writes require fresh authorization and human review. Funding fit is separate from legal eligibility. Verified engineering/legal conclusions remain attributable professional reviews. Unknown and unverified stay distinct from negative findings.

## Phases and migration acceptance

See `plans/phase-7.md`. 7A map discovery needs **no migration**, because it is a projection of existing records. 7B–7E require additive, reviewed migrations only after model mapping. Each migration must pass fresh-database and populated-snapshot checks, mandate-isolation tests, constraints/backfill checks and failure/retry tests before rollout. Backfills are idempotent jobs; old reads remain usable during rollout. Production restoration uses a verified backup/restore point, not destructive down-migrations.

Build verification is a release gate, not optional. A completed roadmap document is not a completed architecture implementation.

## Phase 7A verification record

- Baseline lint and typecheck passed before edits.
- Baseline integration runner failed at startup with Windows `spawn EPERM`; no test assertions ran. The runner-loader alternative failed with the same process restriction.
- Five focused map checks pass using the built-in Node runner: record inclusion/coordinates, combined filters/layer visibility, options, coordinate formatting and URL safety.
- A D1 integration regression was added for mandate isolation, archived rows and missing coordinate pairs. It remains unverified because the normal test runner cannot start.
- Production build was attempted; configuration/dependency resolution fails with Windows `spawn EPERM`. This is not a successful build.
- No production database migration, deployment or live-site modification was performed. Browser verification of the local implementation remains pending a functioning dev/build runtime.

Final lint and typecheck both passed (exit 0). `git diff --check` passed. The full integration suite and production build remain blocked as described above.
