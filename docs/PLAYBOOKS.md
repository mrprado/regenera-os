# Playbooks, evidence and provenance

Master build instruction §22–24, §44, §74, §88.

## Playbooks (db/playbooks.ts, lib/playbooks/*, /playbooks)
- Four layers per version: **Process** (purpose, when to use, trigger, inputs, steps, decision rules), **Toolbox**
  (APIs, tools, templates, references, sub-playbooks), **Proof** (definition of done: checks), **Governance** (what AI may
  execute, what needs human review, what needs approval, what is restricted).
- Maturity: Draft → Tested → Validated → Trusted → Automated (owner sets it).
- Library: 20 playbooks seeded per entity as approved v1 (project-intake, project-qualification, sponsor-screening,
  site-intelligence, solar-project-screen, data-room-audit, capital-pathway-analysis, investor-project-match,
  compliance-screen, system-capacity-assessment, project-update, document-intelligence, investor-research,
  investor-qualification, broker-onboarding, broker-referral-registration, partner-qualification, meeting-preparation,
  meeting-followup, investment-memo). The database copy is the source of truth after seeding.
- Runs: steps with governance. Tools (lib/playbooks/tools.ts: place.profile, study.gaps, readiness.summary,
  capital.match, org.relationship) complete a step only when the step is autonomous; review steps keep the tool output
  and wait for a person; approval steps complete only when an owner approves a verified run.
- Proof checks (lib/playbooks/checks.ts) run against records: field present, count at least N (constraints, risks,
  studies, place facts, capital requirements/opportunities, parties, documents, permits, requirements, E&S issues,
  milestones, decisions, revenue streams, contracts, requests, matches), readiness dimensions recorded, party role,
  none open, or manual confirmation. Status: needs review → awaiting approval → completed.
- Learning loop: a correction names the failing layer (process, toolbox, proof) and a scope (one-time, process rule,
  toolbox update, proof check). Anything beyond one-time becomes a **draft version**; the live version changes only
  when an owner approves it. The same one-time correction twice (order- and filler-insensitive fingerprint) raises a
  "make it a permanent rule" suggestion.
- Entry points: /playbooks, project Overview ("Run a playbook"), Place tab ("Run site intelligence").

## Claims and evidence (db/evidence.ts, lib/evidence/engine.ts)
- `claims`: statement, type, field, value, unit, status (Verified, Source provided, Calculated, AI inferred,
  Assumption, Unverified, Disputed), validity window, verifier, supersession.
- `claim_evidence`: provider, source, URL, document and page, section, excerpt, retrieval and source dates, raw hash,
  method (document, API, registry, site visit, interview, calculation, AI, other), confidence, licence.
- Rules: Verified needs at least one non-AI evidence row and a person (not ai:/tool:/system). Superseding keeps
  history; `claimsAsOf(date)` answers what was true on a date.
- Project Overview shows "What we know, and how" grouped as Verified, Sponsor provided, Regenera analysis, Assumption,
  Unknown (§08).
- Place facts keep their own provenance (provider, tier, licence, period, retrieval date, stale state).
