# Phase 10 — Client operating layer, analyst workbench, commercial lifecycle, navigation

Source prompts (2026-09-29): client-operating-layer refactor (§1–111), company/GTM model (engagement ladder, pricing
bands, revenue categories, Command commercial metrics), analyst production workflow (question → workplan → evidence →
analysis → model → synthesis → review → decision → action), client lifecycle (target → discovery → diagnostic →
proposal → engagement → … → renewal) and the navigation-consolidation prompt (preserve 100% of the build).

The prompts' pricing figures are planning inputs for Regenera's own commercial records; the OS stores them as
user-entered values, never as forecasts it produced.

## 1. Current-build audit

| Area | Today | Verdict |
|---|---|---|
| Authentication | Email + password; password is OS_PASSWORD or the tracker's (checked by the site, never stored). Sessions hashed in D1. Lockout per email/IP. | **EXTEND**: client users cannot use the tracker password, so add OS credentials (PBKDF2, same scheme as portal users) set only through single-use invitations. Tracker/OS_PASSWORD path stays for Regenera. |
| User model | `mandate_members` (email, role owner/member). No user types, personas, teams, status. | **EXTEND**: `tenant_members` carries user type, persona, teams, status (deactivation), per-member module restrictions. `mandate_members` remains the data-access grant. |
| Organization model | CRM `organizations` (companies we talk to). `corporate_entities` (Regenera's own legal entities). No client-account object. | **ADD** `tenants` (client organization = account) with hierarchy in `org_units` (business unit, fund, HoldCo, SPV, asset …). CRM organizations stay the CRM; a tenant may link to its CRM record. |
| Tenancy | `mandates` = data workspaces (Regenera, RA-ESG, GWCe). Every scoped table has `mandate_id`; `mandateCondition` enforces server-side; lint blocks raw DB access. | **KEEP** as the enforcement boundary. A tenant owns one or more workspaces (`mandates.tenant_id`). Client A's users hold grants only to Client A's workspaces, so every existing query is already tenant-safe. UI label changes "Entity" → "Workspace". |
| Naming collision | The prompt's "Mandate" (scope of work) ≠ the existing `mandates` table (workspace). | New table `work_mandates` (UI "Mandate"). Existing table keeps its name; UI calls it Workspace. Documented in CLAUDE.md. |
| Roles/permissions | owner/member per workspace; OWNER-ONLY investor data; portal grants for externals. | **EXTEND**: user types (Regenera internal, client admin, client user, read-only; externals stay on the portal surface — no mixing), read-only enforced centrally in `withOsUser`, module entitlements enforced in `requireOsUser` by route. |
| Portals | Separate portal users/sessions/grants (capital, broker, partner, sponsor, stakeholder), data rooms with NDA gate, access log, document requests. | **KEEP** — this is the external collaborator / investor / broker model. Extend data rooms with expiry + folder permissions view. |
| Engagements | `engagements` (scope, deliverables, payments, change orders, margin), services catalogue, invoices, expenses, time, partners, accounts. | **EXTEND**: engagement type, client tenant, discovery record, renewal, included modules, SLA, reporting cadence; add mandates, workstreams, subscriptions, invoice items, payments, revenue categories. |
| Decisions | `decisions` per project (context, options, rationale, evidence). | **EXTEND** into the decision log (participants, alternatives, related scenario/assumptions, follow-ups), searchable. |
| Evidence | `claims` + `claim_evidence` (status ladder, AI never verified alone). | **KEEP** as the evidence backbone; the analyst evidence library references claims and adds question linkage. |
| Automation | `trigger_rules`, `stage_gates`, events, notifications, mutes, playbooks with versions/runs. | **EXTEND**: workflow templates (trigger → condition → action → approval → next state) reuse trigger_rules; approval engine is new and generic. |
| Reporting | Weekly metrics report, project brief PDF, finance export, document generator. | **EXTEND**: report builder (sections, branding, version, confidentiality, review states) with PDF/CSV export. |
| Audit | `audit_log` (actor, action, entity, before/after). | **EXTEND**: tenant attribution derived from workspace; security center reads it + login events. |
| Search / Cmd+K | Global search + Ask the OS + page list. | **EXTEND**: actions, favorites, recents, nav search. |
| Integrations | Registry enforced in fetchJson; account connections; Google OAuth; MCP tokens. | **KEEP**; integration control center = registry + connections + system-of-record map. API access = MCP personal tokens, scoped. |
| Billing | Invoices on engagements. | **EXTEND** with subscriptions, invoice items, payments (separate from project finance). |

## 2. Build order (each slice tested, committed, deployed)

1. **Tenancy + security** — tenants, org units, tenant members, teams, modules/entitlements, OS invitations +
   credentials, login events, deactivation, read-only, entitlement guard. Migration maps every existing workspace to the
   Regenera tenant and every existing member to `regenera_internal`.
2. **Navigation** — consolidated sidebar (Command, Atlas, Projects, Systems▾, Capital▾, Deals▾, Relationships▾,
   Intelligence▾, Clients▾ internal, Operations▾, Settings), mega-menu for Systems, menu search, role/entitlement-aware
   filtering, workspace switcher grouped by tenant, favorites, recents, Cmd+K actions, route-inventory test (no orphan).
3. **Client admin console** (`/org`) — profile, branding, units, currency, hierarchy, users, invitations, teams, modules,
   security center, API tokens, data export. **Clients** (internal) — accounts, health, onboarding, offboarding.
4. **Engagement → mandate → workstream → deliverable → revenue**, commercial pipeline stages, discovery record,
   proposal → engagement conversion, subscriptions/billing schema, Command commercial metrics (ARR, MRR, backlog,
   weighted pipeline, renewals 120d, revenue mix, margin by type).
5. **Analyst workbench** — analysis requests, issue tree with hypotheses, evidence library, findings log, storyline,
   review markup (prepared/reviewed/approved), memo builder with sourced sections, IC workflow, comps, sensitivity.
6. **Governance primitives** — approvals, assumption registry (lock + versions), decision log, record versions,
   issues/blockers/opportunities/recommendations, dependency graph + critical path, comments/@mentions, meetings.
7. **Configuration** — custom fields, taxonomy, workflow templates, checklists, templates, jurisdiction packs,
   methodologies, feature flags, model governance.
8. **Operations** — report builder + scheduled reports, notification digest, support center + SLA, feedback,
   asset registry, work orders, warranties, handover, disposition, decommissioning, twin state, knowledge base,
   lessons learned, field forms.
9. **Hardening** — the gap audit matrix (implemented / partial / missing / broken / static / not connected).

## 3. Navigation map (every current page route → new access path)

URLs do not change, so bookmarks, portal links and deep links keep working; no redirects are needed.
`tests/unit/nav-inventory.test.ts` fails if a page route exists that is neither in the navigation map nor a detail
route reachable from its list page.

| Route | New location |
|---|---|
| /today | COMMAND |
| /map | ATLAS |
| /projects, /projects/[id] | PROJECTS ▸ All projects (tabs grouped in context) |
| /land, /land/[id] | PROJECTS ▸ Land pipeline; SYSTEMS ▸ Land systems |
| /community | PROJECTS ▸ Community & rights; SYSTEMS ▸ Nature |
| /systems | SYSTEMS ▸ each domain (filtered) |
| /power | SYSTEMS ▸ Energy; SYSTEMS ▸ Infrastructure (large loads) |
| /capital, /capital/partners/[id], /capital/private/[id], /capital/opportunities/[id] | CAPITAL ▸ Capital partners |
| /capital/structures, /capital/funding-pathways, /capital/alignment(/[id]) | CAPITAL ▸ Structures / Funding pathways / Capital alignment |
| /funding, /funding/[id] | CAPITAL ▸ Funding & grants |
| /deals, /deals/[id] | DEALS ▸ Opportunities |
| /contracts(/[id]) | DEALS ▸ Contracts & term sheets; OPERATIONS ▸ Documents |
| /portals | DEALS ▸ Data rooms & portals; CLIENTS ▸ Portals |
| /people, /companies, /partners, /relationships, /network, /lists, /prospecting, /sequences, /queue, /inbox, /searches | RELATIONSHIPS ▸ … |
| /triggers, /intelligence, /benchmarks, /reports | INTELLIGENCE ▸ … |
| /commercial, /commercial/engagements/[id] | CLIENTS ▸ Pipeline / Engagements |
| /tasks, /playbooks, /documents, /documents/generator, /notifications | OPERATIONS ▸ … |
| /settings/*, /connect/mcp | SETTINGS |

## 4. Feature freeze and product boundary (production-hardening prompt, 2026-09-29)

The architecture is frozen at the major-module level. From here, work must be a **bug**, **depth** on an existing
workflow, or a **validated client requirement**. Priority: security → data integrity → Project 360 → Command → Atlas
reliability → client/engagement → analyst workbench → capital → documents/evidence → reporting → performance →
integrations → secondary modules.

**Regenera OS is** a decision system, project intelligence platform, land and spatial intelligence environment, capital
and deal environment, client engagement system, analyst production system, portfolio intelligence platform and
execution coordination layer. **It is not** an ERP, accounting package, CAD/BIM, construction field tool, farm
management system, legal practice system, general-purpose CRM, payroll, general BI, full remote-sensing platform or
commodity trading system — where specialists are better, Regenera integrates.

Reconciling the client-operating-layer prompt with the freeze: the items below were **not built** and sit in the
product backlog (problem, user, evidence, frequency, revenue relevance, workaround) until a paying client needs them:
digital-twin state model, decommissioning planner, work orders and warranties beyond the existing operations records,
webhooks, SAML/Entra SSO (architecture prepared: credentials are per-email and MFA is shown as not enrolled),
white-label custom domains, field forms builder, usage analytics dashboards beyond login history and client health.

Slices 5 onward are reordered by the priority list above; each ships as depth inside an existing domain, never as a
new top-level area.

## 5. Visual system

Replaced by docs/design-system.md ("Territorial intelligence"): volcanic shell, limestone/chalk canvas, copper accent,
solar signal, semantic data colours. Applied centrally through tokens; every legacy token name is remapped.
