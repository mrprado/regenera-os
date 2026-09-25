# Data model

Canonical spec: docs/master-spec.md part IV. Plan: docs/plans/phase-6.md §5. This file describes what is built.

## Scoping
Every business row carries `mandate_id`: the **entity** (Regenera, RA-ESG, GWCe) whose book it belongs to. The
`mandates` table is shown as "Entities" in the interface; investor mandates (master spec) will be `capital_mandates`.
All reads go through `mandateCondition(scope, column)` in lib/db/scoped.ts.

## Entities built

| Spec entity | Table(s) | Notes |
|---|---|---|
| User | `mandate_members`, `auth_sessions` | roles owner / member per entity |
| Organization | `organizations` | LEI, SEC CIK, Wikidata, parent, geo, segment, per-field provenance `field_sources` |
| Person | `contacts` | email status, consent, provenance |
| Relationship | `relationships` | email/meeting metadata by domain (graph with introducers: M2) |
| Opportunity | `deals` (shown as Opportunities), `funding_opportunities` | a deal is Regenera's commercial pipeline item; it can link to a project |
| **Project** | `projects` | the physical asset: identity, stage (18 lifecycle stages), status, Regenera role, location (lat/lng + GeoJSON geometry), systems, provenance |
| Project parties | `project_parties` | organization and/or person with a role (sponsor, developer, ProjectCo, issuer, landowner, offtaker, EPC, OEM, engineer, lender, investor, counsel, advisor, government, community), confirmed or proposed |
| ProjectReadiness | `project_readiness` | one row per dimension (14), status (8), evidence, owner; no scores |
| Constraint | `constraints` | 25 categories, severity, evidence, owner, resolution action, deadline, dependency, status |
| ProjectStage history | `project_stage_history` | every move with reason and actor |
| ProjectCapitalRequirement | `capital_requirements` | purpose, instrument, stage, target/min/max, currency, target close, use of funds, economics, term, security, seniority, repayment, exit, regulatory status, secured amount |
| CapitalTranche | `capital_tranches` | under a requirement; instrument, target, min/max participation, economics, seniority, security, eligibility, target investor type |
| Action | `tasks` | links to contact, organization, deal, **project** |
| Contract | `contracts`, `contract_versions`, `contract_milestones` | Regenera commercial contracts; links to deal and **project** |
| IntelligenceSignal | `signals`, `triggers` | triggers can link to a **project** |
| FundingOpportunity | `funding_opportunities`, `funding_matches` | matches can link to a **project** |
| AuditLog | `audit_log` | actor, action, entity, before, after |

Links added in M1 (nullable `project_id`): `deals`, `tasks`, `contracts`, `triggers`, `funding_matches`.
