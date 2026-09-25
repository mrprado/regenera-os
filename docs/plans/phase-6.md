# Phase 6: from CRM to project operating system (plan for approval)

Source: docs/master-spec.md (supersedes earlier specs). Audit: docs/audit-2026-09.md.
This covers master-spec steps 5–12. Nothing here is built until Prado approves a milestone.

**Rule for all of phase 6: additive and reversible.** New tables and nullable columns only. No table renames, no
destructive migrations, no change to how existing records are scoped. Existing screens keep working throughout.

## 5. Target schema

Everything stays inside the existing mandate scoping (`mandate_id` on every row; see the naming decision in §10).
Where a spec entity already exists, it is reused (third column).

### Project spine
| Table | Key fields | Reuses / links |
|---|---|---|
| `projects` | name, description, asset_class, sector (existing 5 sectors), subsector, technology, capacity + unit, capex + currency, stage (18 lifecycle stages), status (active, on hold, dropped, operating), regenera_role (advisor, development office, co-developer, arranger support, monitoring; never issuer/broker by default), origination_source, country (ISO3), subdivision, municipality, lat, lng, geometry (GeoJSON) + bbox columns, owner_user, field_sources (provenance per field) | `deals.project_id` (an opportunity can be about a project), `tasks.project_id`, `contracts.project_id`, `triggers.project_id`, `funding_matches.project_id` |
| `project_parties` | project, organization and/or person, role (sponsor, developer, ProjectCo/SPV, issuer, landowner, offtaker, EPC, OEM, engineer, lender, investor, counsel, advisor, government, community), is_confirmed, source | organizations, contacts |
| `project_readiness` | project, dimension (14), status (Unknown … Not Applicable), evidence, note, owner, updated_by/at | one row per dimension; no scores or percentages |
| `constraints` | project, category (25), description, severity (low, medium, high, critical), evidence, owner, resolution_action, deadline, depends_on, status (open, in progress, resolved, accepted) | surfaced on Today when high/critical or overdue |
| `project_stage_history` | project, from, to, at, by, reason | audit of lifecycle moves |
| `decisions` | project or deal, decision, rationale, decided_by, at, evidence | generalizes `case_records` over time |

### Capital
| Table | Key fields |
|---|---|
| `capital_requirements` | project, purpose, stage, instrument (catalog of Part XXIII), target/min/max + currency, timing, target_close, use_of_funds, economics (text), term, security, seniority, repayment, exit_refinance, regulatory_status |
| `capital_tranches` | project, requirement, instrument, target, currency, min/max participation, economics, seniority, security, eligibility, target_investor_type, status |
| `capital_profiles` | organization or person, capital_type, ticket min/max + currency, geographies, sectors, technologies, stages, instruments, risk, return, tenor, impact, E&S, local content, relationship owner/strength, source, last_verified |
| `capital_mandates` | capital_profile, name, criteria (same dimensions), valid_from/to, source, last_verified (the investor's mandate; distinct from Regenera's entities) |
| `private_capital_profiles` | person, vehicle org, family office org, relationship owner/source/strength, introducer, jurisdictions, preferred channel, interests (sectors, geographies, asset classes, stages, instruments), indicative ticket, horizon, preferences, known risk appetite, constraints, last_verified. **Sensitive: owner-only by default.** |
| `investor_qualifications` | person or organization, jurisdiction, classification, definition_version, assessment_status, verification_status (8 spec statuses), method, verified_by, verified_at, expires_at, evidence_ref (pointer, not the document), restrictions. **Sensitive.** |
| `capital_opportunities` | project, tranche, issuer org, sponsor org, instrument, offering description, jurisdictions, regulatory_status, gate_state (CLEAR, REVIEW REQUIRED, HOLD, APPROVED, NOT PERMITTED), roles (arranger, placement party, counsel, financial advisor, Regenera role) |
| `capital_matches` | opportunity or tranche, capital profile or private profile, commercial_fit (+ reasons), regulatory_eligibility (+ reasons), status |
| `commitments` | opportunity/tranche, investor, stage (conversation, interest, IOI, soft circle, commitment, subscription, funded), amount + currency, at, evidence; one current row per investor per tranche, history kept, so nothing is double counted |
| `material_deliveries` | investor, opportunity, document + version, channel, sent_by, sent_at, approval_ref, acknowledged_at |
| `introductions` | from person, to person/org, date, context, project/opportunity, permission_status, compensation flag (forces regulatory review), notes |
| `debt_securities` | issuer, program, instrument, currency, principal, issue size, minimum denomination, coupon + type, maturity, frequency, seniority, security, guarantee, use of proceeds, ISIN, venue, trustee, paying agent, arranger, placement agent, counsel, jurisdictions, restrictions, eligible recipients, status. RA-ESG is data, not code. |

### Regulatory
| Table | Key fields |
|---|---|
| `jurisdictions` | code (ISO3 / ISO 3166-2), name, parent, notes |
| `project_jurisdictions` | project, role (project site, ProjectCo, sponsor, Regenera entity, investor, lender, issuer, EPC, equipment origin, offtaker), jurisdiction |
| `requirements` | project, domain (29 project-regulation domains), title, authority (org), jurisdiction, status (9 spec statuses), source, reviewer, reviewed_at, evidence, next_verification |
| `permits` | requirement, authority, reference, submitted/approved/expires dates, conditions, owner, document |
| `regulatory_reviews` | subject (capital opportunity, outreach, introduction, contract, project), topic (exemption, solicitation, financial promotion, intermediary, compensation, KYC/AML, sanctions, …), jurisdiction, conclusion, conditions, reviewer (name + role, e.g. counsel), date, evidence. The OS never writes "compliant"; it records who concluded what, when, on what evidence. |
| `kyc_checks` | person/org, check type, provider, status, checked_at, expires_at, provider_ref. Status only; no identity documents stored. |

### Contracts and documents
| Table | Key fields |
|---|---|
| `contracts` (extend) | + project_id, category and type (full catalog of Part XLIX), governing_law, forum, execution_date, expiration, renewal, lifecycle (14 spec states), executed_version (locked), source_document_id, key terms (JSON: CPs, reps, covenants, LDs, caps, termination, assignment, notices) |
| `contract_parties` | contract, organization/person, role (party, counterparty, guarantor, agent, beneficiary) |
| `contract_obligations` | contract, responsible party, obligation, category (payment, reporting, notice, CP, covenant, deliverable, insurance, E&S, renewal), due_date, recurrence, evidence_required, owner, status, completed_at, source_clause, risk_if_missed. Payment milestones migrate into this with category "payment". |
| `documents` | title, category (17), project, counterparty, version, owner, status, confidentiality (internal, confidential, restricted), approval, effective/expiry, storage (Drive link or R2 key), hash |
| `document_links` | document ↔ any entity (project, contract, requirement, permit, capital opportunity, delivery) |

### Provenance and integrations
| Table | Key fields |
|---|---|
| `sources` | type (13), organization, title, url or document, tier (1–5), published, retrieved, effective, expires, jurisdiction, license |
| `verifications` | entity, field, source, state (known, unknown, estimated, sponsor-provided, API-derived, verified, stale, conflicting), confidence, verified_by, verified_at, next_verification |
| `integrations` | provider, dataset, category, coverage, base_url, auth, env_var, license, commercial_use, attribution, caching, redistribution, rate_limit, refresh, feature_state (ENABLED, DEVELOPMENT_ONLY, LICENSE_REQUIRED, DISABLED), adapter_version, source_tier |
| `integration_syncs` | integration, started/finished, status, records, errors, latency, last_good_at |

The existing per-field `field_sources` JSON stays as the fast path on rows; `verifications` holds the full record
for facts that matter (capital, regulatory, permits, investor data).

### Later phases (shape only, not built now)
Place profiles, system assessments, engineering requirements, studies and design packages, materials and EPDs, BoQ,
procurement packages and bids, risks, insurance requirements, E&S assessments, economics and scenarios, outcomes.

## 6. Safe migrations

1. Every migration only creates tables or adds nullable columns; drizzle-generated, reviewed by hand, tested on a
   fresh local D1 and on a copy of production data (export → local import, as done on 2026-09-24).
2. D1 Time Travel restore point noted before each production migration (and R2 backups once R2 is on).
3. Backfills are explicit, idempotent jobs, never part of the migration: e.g. "create project from deal" is a user
   action, not an automatic conversion, because most current deals are not projects.
4. `contract_milestones` → `contract_obligations`: copy rows, keep the old table read-only for one phase, then drop.
5. No renames: the Entity label for `mandates` is interface-only.

## 7. Integration and licensing matrix

States: **In use** (running today) · **Ready** (free, no key: can build now) · **Key** (free credential needed) ·
**License** (paid or permission required before production) · **Later**. Licensing notes are from provider terms as
I understand them and each is re-checked when its adapter is built; "verify" marks the ones to confirm first.

| Provider | Category | State | Terms to respect |
|---|---|---|---|
| GLEIF | Corporate | In use | CC0; no key |
| SEC EDGAR | Corporate, filings | In use | Public; User-Agent with contact required; ≤10 req/s |
| Wikidata | Corporate | In use | CC0 |
| GDELT | Intelligence | In use | Free with attribution |
| GDACS | Hazards | In use | Free; attribution to GDACS/JRC (verify) |
| TED, EU Funding & Tenders | Funding | In use | EU reuse policy, attribution |
| World Bank procurement | Funding | In use | World Bank open data terms (CC BY 4.0) |
| Grants.gov | Funding | In use | Public; no key for search |
| UK Contracts Finder | Funding | In use | Open Government Licence |
| Nominatim | Geocoding | In use | 1 req/s, identify the app, no bulk use; switch to own/paid geocoder at scale |
| Apollo.io | Prospect data | In use (free tier) | Account terms; credits budget-guarded |
| NASA GIBS / Esri basemaps | Map | In use | GIBS free; Esri key, attribution, referrer-restricted |
| OpenStreetMap / Overpass | Place, infrastructure | Ready | ODbL: attribution; share-alike for derived databases we distribute; public Overpass is fair-use only |
| Natural Earth | Place | Ready | Public domain |
| World Bank Indicators | Country | Ready | CC BY 4.0 |
| USAspending | Funding | Ready | Public |
| NASA POWER | Climate, solar | Ready | Free; cite NASA POWER |
| USGS Water / earthquakes | Water, hazards | Ready | Public domain |
| EPA Envirofacts | Environment | Ready | Public |
| OpenAlex | Research | Ready | CC0; polite pool with contact email |
| Crossref | Research | Ready | Metadata mostly CC0; polite User-Agent |
| Eurostat | Country | Ready | Free reuse with attribution |
| FAOSTAT | Agriculture | Ready | CC BY 4.0 (verify) |
| GBIF | Biodiversity | Ready | Per-dataset licenses (CC0, CC BY, CC BY-NC): store the license per record and exclude NC data from commercial outputs |
| NREL (NLR) PVWatts, NSRDB | Energy | Key | Free api.data.gov key; rate limits per key |
| EIA Open Data | Energy | Key | Free key; public domain data |
| FRED | Markets | Key | Free key; FRED terms, some series carry third-party copyright |
| Companies House | Corporate | Key | Free key; 600 requests per 5 minutes |
| SAM.gov | Funding | Key | Free key (skipped so far) |
| Copernicus Data Space | Earth observation | Key, Later | Free account; heavy processing belongs with the provider, not the Worker |
| Global Forest Watch | Forest | Key | API key; dataset licenses vary, mostly CC BY 4.0 (verify) |
| OpenAQ | Air | Key | Key required; mostly CC BY 4.0 (verify per source) |
| ENTSO-E | Grid | Key | Token by request; terms of use |
| UN Comtrade | Trade | Key | Free tier limited; bulk needs subscription (License) |
| IRENA, Ember | Energy | Ready (verify) | Ember CC BY 4.0; IRENA terms to verify |
| Open-Meteo | Weather | License | Free tier is non-commercial; commercial use needs a paid plan |
| Protected Planet (WDPA) | Protected areas | License | Non-commercial without a license |
| IUCN / IBAT | Biodiversity | License | Paid subscription |
| Building Transparency EC3 | Materials | License (verify) | Account terms; commercial use to confirm |
| OpenCorporates | Corporate | License | ODbL share-alike or paid licence |
| Regulators (SEC, FCA, EUR-Lex, national) | Regulation | Later | Official feeds/RSS where available; manual verified entry otherwise; no scraping as infrastructure |
| DFI/MDB feeds (IFC, IDB, ADB, AfDB, EBRD, EIB, GCF, GEF …) | Funding | Later | Official APIs or feeds where they exist; otherwise verified manual entry |

Adapters follow one interface (search, fetch, fetchByGeometry, fetchByCountry, fetchByDate, normalize, validate,
sync, healthCheck) on top of the existing `lib/sources/http.ts` (limits, cache, ledger). No provider call from a page
component; everything goes through jobs and the cache. `.env.example` lists every variable name.

## 8. Regulatory architecture

- **Two tracks, never merged:** project regulation (`requirements`, `permits`, host-country law) and capital
  regulation (`regulatory_reviews` on capital opportunities, outreach, introductions and contracts). Lender and
  investor standards (IFC PS, WBG EHS, World Bank ESF, Equator Principles) sit in a third bucket attached to the
  capital source, because meeting host-country law does not satisfy a lender.
- **Compliance gate** for any investment-specific communication, enforced in the outreach sender (which already
  refuses mass tier for investment mandates and blocks sending until counsel confirmation):
  match → regulatory review on the opportunity → recipient qualification valid for that jurisdiction → approved
  material version → authorized channel → human approval → send. Gate states CLEAR, REVIEW REQUIRED, HOLD,
  APPROVED, NOT PERMITTED. Expired qualifications move the gate to HOLD automatically.
- **Outreach types** become a field on messages and sequences: relationship outreach, project introduction,
  investment communication, financial promotion, approved offering communication. Only the first two can run
  without a gate; none is ever sent without human approval.
- **Reviews, not verdicts:** the OS stores who concluded what (counsel name, role), on what evidence, with what
  conditions and until when. It never writes "SEC compliant", "FCA compliant" or equivalent, and Claude is
  instructed not to.
- **Compensation flag:** any introduction, referral or contract with compensation tied to capital raised forces a
  regulatory review (the referral agreement template already excludes fees on capital raised).

## 9. Contract and document architecture

- One `contracts` table for every agreement type (the catalog in Part XLIX as `category`/`type`), with parties,
  obligations, versions, documents and a 14-state lifecycle. Regenera's own templates (built in part E) remain the
  generator for Regenera commercial contracts; third-party agreements (PPA, EPC, loan, lease) are **registered**,
  not drafted: upload or link the executed document, then record key terms and obligations.
- **Executed versions are locked**; changes create amendments linked to the original.
- **Obligations drive Today**: due within 14 days, overdue, renewals and notice dates, covenants and reporting.
- **Claude's role (later):** extract proposed key terms and obligations from an uploaded agreement with the source
  clause quoted, marked "extracted, not verified" until a person confirms. It never gives legal conclusions.
- **Documents:** registry rows with confidentiality and version; storage is a Drive link or an R2 object (R2 must be
  enabled); a document can link to any entity; material deliveries point at an exact document version.

## 10. Navigation

Proposed grouping (same routes, regrouped; no screen rebuilt):

| Group | Items (current route) |
|---|---|
| Today | Today (`/today`, now labelled Home) |
| Origination | Prospecting (`/prospecting`, with Lists), Opportunities (`/deals`), Outreach (`/queue`, `/sequences`, `/inbox`) |
| Projects | Projects (new `/projects`), Pipeline (`/projects?view=board`) |
| Capital | Funding (`/funding`), Capital partners (new), Mandates (new capital mandates) |
| Intelligence | Intelligence (`/triggers`), Network (`/people`, `/companies`, `/partners`), Map (`/map`) |
| Secondary | Actions (`/tasks`), Documents (`/contracts` + documents), Reports, Settings; Search is Cmd+K |

**Naming decision for Prado:** the header switcher "mandates" (Regenera, RA-ESG, GWCe) becomes **Entity**, so
"Mandates" can mean investor mandates as the spec intends. Only labels change.

## 11. Phased plan

| Milestone | Scope | Depends on |
|---|---|---|
| **M1 Project spine** (proposed first) | projects, parties, readiness, constraints, stage history, capital requirements and tranches; links from deals, tasks, contracts, triggers, funding; Projects list + board + map layer; project record (Overview, Readiness, Constraints, Capital, Partners, Contracts, Funding, Activity); Today sections for projects, blockers and capital needed; navigation regroup and Entity label | nothing |
| M2 Capital relationships | capital profiles and mandates, private capital profiles, investor qualifications, capital opportunities, matches (commercial vs regulatory), commitment ledger, material deliveries, introductions, compliance gate in the sender, capital formation panel | M1 |
| M3 Contracts and documents | contract parties, obligations (milestones migrate), full catalog and lifecycle, executed lock, documents registry, obligations on Today | M1; R2 for uploads |
| M4 Regulatory | jurisdictions, jurisdiction matrix, requirements, permits with expiry alerts, regulatory reviews, KYC status | M1–M3 |
| M5 Provenance and integrations | sources, verifications, integration registry and syncs, staleness on Today, admin health; first new adapters: World Bank Indicators, OSM/Overpass, NASA POWER, USGS, GBIF, OpenAlex/Crossref, USAspending | M1 |
| M6 Place | place profile per project from M5 adapters; polygons; infrastructure and hazard layers | M5 |
| Later | engineering, materials/EPD/circularity, E&S assessments, procurement, construction/operations, economics and scenarios, agents and automation over the new entities, exports, portals | as data accumulates |

Each milestone ships with tests (including the relevant slice of the spec's critical workflow test), docs in
`/docs` for what it built, a build report here, and a deploy.

## 12. Highest-value first milestone: M1 Project spine

**Why first:** both of the spec's success tests (Today, Project) and every later module (capital, regulatory,
contracts, place) hang off a Project record that does not exist yet. It changes no existing behavior, and deals,
contracts, funding and tasks can attach to projects as soon as it lands.

**Scope:**
- Migration: `projects`, `project_parties`, `project_readiness`, `constraints`, `project_stage_history`,
  `capital_requirements`, `capital_tranches`; nullable `project_id` on deals, tasks, contracts, triggers,
  funding_matches.
- Screens: `/projects` (table and board by lifecycle stage, filters for stage, sector, country, readiness blockers,
  capital needed); project record with the eight tabs above; "Create project" from scratch or from a deal;
  add sponsor/developer/other parties from existing organizations and people.
- Readiness: 14 dimensions with the 8 statuses, evidence and owner; no scores.
- Constraints: 25 categories, severity, owner, resolution, deadline, status.
- Capital: requirements broken down by purpose and instrument, tranches under them, totals by stage (no double
  counting), "capital needed now" = requirements with a target close in the next 180 days and not yet covered.
- Today: Projects moved (stage history), blocked (critical/overdue constraints, Blocked readiness), capital needed
  now; existing sections stay.
- Map: projects layer (points now, polygons stored as GeoJSON for later).
- Ask the OS: `search_projects` tool; Cmd+K lists projects.
- Navigation regroup and the Entity label.
- Docs: data-model.md, project-lifecycle.md, capital-model.md (first sections), build-roadmap.md.
- Tests: schema and scoping, readiness and constraint rules, capital totals without double counting, create project
  from deal, Today sections, the first slice of the critical workflow (create project → location → sponsor →
  readiness → constraints → capital requirements → development tranche → Today).

**Not in M1:** capital profiles and investors (M2), obligations and documents (M3), regulation (M4), AI agents.

## Decisions needed from Prado

1. Approve **M1 Project spine** as scoped.
2. Rename the header "mandates" to **Entity** (labels only)?
3. Confirm that deals stay as **Opportunities** (Regenera's commercial pipeline) and projects are separate records
   linked to them.
4. GIS on D1 with GeoJSON (no PostGIS for now; changing databases would be a stack change and a paid service).
5. Still pending from before: **Workers Paid** (the live OS cannot render signed-in pages without it) and **R2**
   (documents and backups, needed by M3).

## Build report: M1 Project spine (2026-09-24)

Built as scoped, additive only (migration 0010: 7 tables, 5 nullable `project_id` columns).
- Projects page (table and Pipeline board by lifecycle phase, filters for stage, sector, country, blocked, capital
  needed), create from scratch or from an opportunity; project record with Overview, Readiness, Constraints, Capital,
  Partners, Contracts, Funding and Activity tabs.
- Today: Projects panel (blocked, capital needed within 180 days, stage moves this week).
- Map: projects layer at the project's own coordinates. Ask the OS: `search_projects`. Cmd+K: Projects, Pipeline.
- Navigation regrouped (Today, Origination, Projects, Capital, Intelligence, Work); Deals shown as Opportunities;
  header and settings "mandates" shown as Entities. Opportunities table has a Project column.
- Tests: tests/integration/projects.test.ts (6, including the first slice of the critical workflow). Full suite 28
  files passing. Checked in the browser: create project, every tab, constraint and requirement forms, Today panel.
- Docs: data-model.md, project-lifecycle.md, capital-model.md, build-roadmap.md.

## Build report: M2 Capital relationships and compliance gate (2026-09-24)

Built as scoped, additive only (migration 0011: 11 tables; `messages.capital_opportunity_id` and `outreach_type`).
- Capital partners page (partners, private investors [owners only], capital opportunities, introductions, bonds and
  notes); partner and private investor records; capital opportunity record (formation, matches, ledger,
  deliveries, gate, approved materials, offering and roles). "Offer to investors" on each requirement and tranche.
- Engine (lib/capital/engine.ts): commercial fit with reasons, eligibility from qualification records only,
  matching across partners (best active mandate) and private investors, commitment ledger with events and an
  evidence rule, formation without double counting, gate with reviewer and evidence, send-time gate in
  `sendClaimedMessage`, material delivery log, daily qualification expiry.
- Today: capital opportunities awaiting gate review. Sidebar: Capital partners.
- Tests: tests/integration/capital.test.ts (6) and a route-guard check that private investor data never reaches Ask
  the OS or MCP. Full suite 29 files passing. Checked in the browser: opportunity from a project requirement, gate
  refusal without reviewer, partner creation, matching with reasons.
- Docs: capital-model.md, private-capital-model.md, regulatory-model.md.

## Build report: M3 Contracts, obligations and documents (2026-09-24)

Built as scoped, additive only (migration 0012: 4 tables, 12 contract columns, lifecycle backfill). Payment milestones
stay as they are (Regenera fee tracking); obligations cover everything else, so no data was moved.
- Agreement register for the full catalog of Part XLIX with key terms, parties, governing law, forum, dates,
  14-state lifecycle, locking on execution, amendments linked to originals, compensation review flag.
- Obligations with evidence rules and recurrence; Today and digest sections; contract and obligation registers as
  CSV; contract abstract PDF for registered agreements.
- Documents registry with versions (supersede, never overwrite) and links to any record; Documents in the sidebar.
- Tests: tests/integration/register.test.ts (5). Full suite 30 files passing. Checked in the browser: register a PPA
  on a project, add a recurring obligation, abstract PDF, CSVs, Today.
- Docs: contracts-model.md.

## Build report: M4 Regulatory (2026-09-24)

Built as scoped, additive only (migration 0013: 5 tables).
- Project Regulatory tab: jurisdiction matrix, host-country requirements and lender/investor standards as separate
  tracks (one-click IFC PS, World Bank ESF, Equator Principles, EHS Guidelines), permits with expiry, reviews.
- Reviews panel on projects, capital opportunities and registered contracts; KYC status panel on private investors.
- Rules: approved / not applicable need evidence and reviewer; reviews need reviewer, role and evidence; conditional
  conclusions need conditions; approved permits need an approval date; daily permit expiry job.
- Today: Regulatory panel. Isolation test extended to KYC data.
- Tests: tests/integration/regulatory.test.ts (4). Full suite 31 files passing. Browser: checklist seed, permit on
  Today, review panels on opportunity and contract pages.
