# Phase 19: Canonical ontology v1.0 and the external data fabric (approved and built 2026-10-07)

Source: the founder's "master external-data fabric" and "what is still missing" notes (2026-10-07). This plan checks
those notes against what the OS already has and proposes the remaining work. Approved on 2026-10-07 ("build all … only freemium sources for now"); section 6 records what was built.

## Principle

The order of evidence is global screening, then jurisdictional verification, then project evidence, then
Regenera-derived intelligence. A global dataset helps discover and screen. It never becomes investment-grade
evidence by itself. Users choose a question such as "Water risk". The OS picks the best source for that place and
shows where the answer came from.

## 1. What already exists

These items already exist and are reused. They will not be rebuilt.

| Note asks for | Already in the OS | Gap |
|---|---|---|
| Claim / evidence model (§24, "Microsoft is the offtaker") | `db/evidence.ts` claims + claim_evidence: status, method, confidence, licence, valid_from/to, superseded_by; AI never Verified without non-AI evidence | Claims are not yet the mandatory path for key project fields; no source-conflict "canonical value" view |
| Graph grammar | `db/graph.ts` relationship_edges (14 edge types, person/org/project only); `project_context_edges` (phase 17) | Edge vocabulary too small (no site, parcel, permit, equipment, fund, grid node); no temporal validity on edges |
| Source registry + licence | `db/data-providers.ts` (providers with tier and licence review, datasets with connection status, sync jobs, schema hash); `lib/integrations/registry.ts` enforced in fetchJson | Missing source-record fields from the note: spatial/temporal resolution, update frequency, commercial-use and redistribution flags as columns, authority level |
| Evidence levels | Levels 1/2/3 (screening / jurisdictional / project) on screening flags | Note proposes L0–L4; L0 (discovery) and L4 (verified professional) are missing |
| Spatial model | `db/spatial.ts` layers, site features, analyses, field observations, atlas views; Atlas discovery filters | No admin-area inheritance chain (parcel → municipality → state → country → region); no upstream/downstream relations |
| Permits | `db/regulatory.ts` jurisdictions, requirements, permits, reviews, KYC checks | No permit dependency graph or jurisdiction-specific critical path; state machine not formalised |
| Stage gates / events / automations | `db/events.ts` events, trigger_rules, notifications, stage_gates | Gates not aligned to one canonical project state machine; few "WHEN … THEN" rules shipped |
| Community / FPIC / grievances / TEK governance | `db/community.ts` (16 tables incl. consent, knowledge permissions, grievances, commitments) | Generic project-stakeholder register (influence, interest, position) for non-community stakeholders |
| Offtake / grid / storage | `db/power.ts` ppas, grid_connections, storage_specs, large_loads | No interconnection-queue object (queue position, study phase, upgrades, withdrawals) |
| Economics + cost benchmarks | `db/economics.ts`, `db/benchmarks.ts` cost_benchmarks, technologies; screening model | Scenario engine (sensitivities saved as named scenarios) is partial; no financing structure inputs (DSCR, tenor) |
| Equipment / vendors / EPDs | `db/procurement.ts` epds, boq, packages, bids, network_profiles | No canonical Equipment object (model, manufacturer, certifications, lead time) |
| Capital, matching, introductions, conflicts | `db/capital.ts`, `lib/crm/conflicts.ts`, mandates/pursuits/approvals | Match engine is capital-only; Project ↔ EPC / offtaker / grant / consultant matches not unified |
| Engagements, revenue | `db/commercial.ts` engagements, invoices, time, expenses | Accounting sync (QuickBooks/Xero/Stripe) not wired (paid; needs approval) |
| Data room / documents | documents register, contracts, obligations, Save to Drive | Data room completeness by the 11 standard folders not computed |
| MRV / monitoring / credits | `db/natural.ts` monitoring periods, certifications, credit lots | Sensor/IoT time series not modelled |
| Human approvals, audit | approvals, isHuman, audit log, AI calls in ai_runs | Field-level old/new value audit for AI edits is partial |
| Funding / procurement sources | Grants.gov, EU F&T, UK Contracts Finder, TED, World Bank (phase 5/11) | USAspending, SAM.gov, World Bank procurement notices + contract awards, MDB pipelines |
| Counterparty | GLEIF (scans), KYC checks | Sanctions screening (OFAC, EU, UK, UN lists), Companies House, SEC EDGAR, Open Ownership |

## 2. Proposed scope, in build order

### Part A: Ontology v1.0 (the constitutional layer). This comes first.

- `lib/ontology/` holds the canonical entity list, the relationship vocabulary, the controlled taxonomies and the
  state machines as typed constants. It also holds the doc `docs/ontology.md`, generated from those constants so the
  doc cannot drift from the code.
  - The entity list maps each entity to its table. It covers about 24 entities: Project, Site, Parcel,
    InfrastructureAsset, GridNode, Organization (roles: developer, EPC, investor, offtaker, utility, advisor,
    government, …), Person, Fund, CapitalRequirement, CommercialMandate, Engagement, Deal, Contract, Permit,
    Stakeholder, Equipment, Document, Claim, Evidence, Signal, Task, Transaction and Observation.
  - "Investor" is a role on Organization and is not a separate root object. This matches how the CRM works today.
- Relationship edges are widened. This is additive.
  - New nullable columns `valid_from` and `valid_to`, plus an `evidence_claim_id`.
  - `from_type` and `to_type` accept every ontology entity.
  - The edge vocabulary grows to about 60 typed predicates, each with allowed source and target types. A test
    enforces those types.
- Canonical state machines live in one module. They cover project, capital raise, permit, engagement, claim and
  signal.
  - Each machine has allowed transitions and states which moves need a person (`isHuman`).
  - Existing stage enums are mapped onto the machines. No current value is removed.
  - Project gates 0–8 sit over the existing tracker stages from `lib/vocab.ts`. The tracker stays the source of truth.
- Identity resolution adds an `entity_aliases` table: entity, alias, source and source_id.
  - Every external ID (LEI, EIA plant ID, GEM ID, OSM ID, Companies House number) maps to one Regenera ID.
  - This extends `lib/dedupe` and does not replace it.
- External-source mapping: each catalogue dataset declares the ontology entity it maps to. For example, EIA plant
  maps to InfrastructureAsset, a GBIF occurrence to Observation, and WRI water stress to an indicator Observation.
- Source conflicts: a "values by source" view on a field.
  - It shows each source's value next to the chosen canonical value, with that value's confidence.
  - It is built from claims, so nothing is overwritten.
- Tests cover the edge type rules, the state machine transitions, alias resolution, and the rule that a conflict
  never overwrites a value.

### Part B: Data fabric with question-first layers

- Source records gain the missing columns: domain, spatial and temporal resolution, update frequency,
  commercial_use, redistribution, attribution, authority level and cost.
- Evidence levels are extended to L0–L4. Today's 1/2/3 map to L1/L2/L3, so existing data is unchanged. L0
  (discovery) and L4 (verified professional) are new.
- Provider families group connectors: NASA, Copernicus, USGS, NOAA, WRI, World Bank, FAO, DOE/NREL, EPA and GEM.
  Each family has one adapter with sub-datasets, not one connector per dataset.
- Question layers in Atlas: Water risk, Grid access, Land & nature constraints, Hazards, Solar/wind resource and
  Population. Each picks a source hierarchy by place (global → country pack → site) and shows its provenance under
  the answer.
- Jurisdiction packs (US, Mexico, UK first) are activated per workspace only when a project is located there.
- First keyless connectors, about 12: OSM/Overpass (already used), Natural Earth, GeoNames, NASA POWER, NASA FIRMS,
  USGS earthquakes, SoilGrids, GBIF, World Bank indicators, EIA (free key), SEC EDGAR, USAspending, and the World Bank
  procurement notices and contract awards.

### Part C: Missing business objects (smaller, additive)

- Sanctions screening against OFAC, EU, UK and UN lists. These are free downloads, cached and refreshed weekly, and
  the check runs before an introduction or a contract.
  - A match is a flag for a person to review. It is never an automatic decision.
- Interconnection queue entries are linked to a GridNode and a substation.
- Project stakeholder register (influence, interest, position, consultation required, last engagement). It links
  to the community tables for anything governed.
- Canonical Equipment object (manufacturer, model, certifications, lead time, installed projects).
- Land control: a structured record per parcel covering control type, counterparty, term, extension, title
  evidence, encumbrances, rights of way and water rights. It replaces any "land secured" true/false field.
- Data room completeness against the 11 standard folders, computed from documents and claims.
- Matches follow one reusable shape (criteria met, criteria failed, evidence, confidence). It covers project to
  investor, EPC, offtaker, grant and consultant.

## 3. Deliberately not included (needs your decision)

These are paid services or stack changes. Under the house rule ("ask before adding paid services or changing the
stack"), none of them is built without a separate yes:

- Google Earth Engine (compute layer; commercial use is a paid licence)
- Google Maps Platform, Electricity Maps
- Licensed data: Protected Planet for commercial use, TeleGeography, Regrid/LightBox/ATTOM, Planet/Maxar,
  Preqin/PitchBook/IJGlobal, S&P/Moody's/Fitch, BNEF/Wood Mackenzie
- QuickBooks, Xero and Stripe sync
- An IoT time-series store. D1 is not a good fit for this; it would need a separate service.

## 4. Where this plan departs from the notes

- **No opaque composite scores.** The notes show examples like "Grid: 82", "Overall economics: 84" and "Investment
  readiness 92%". House rules forbid award probabilities and 0–100 fit scores. The plan shows readiness as evidence
  counts and missing items instead, as `lib/readiness.ts` does today, and every match as the criteria it met and
  failed.
- **Pick an answer by question, not by provider.** The provider stays visible in the provenance under every
  answer.
- **"Absence of observations is not evidence of absence."** GBIF results are always labelled that way, and no layer
  can state "species absent".
- **Culturally governed knowledge stays in its own layer.** TEK and community-controlled data stay in the community
  tables with their consent gates. They never become an Atlas layer, and never reach search, Ask or MCP.

## 5. Size and order

| Part | Size | Builds on |
|---|---|---|
| A. Ontology v1.0 | about 2 migrations (additive), 1 module, about 6 test files | nothing; do first |
| B. Data fabric | 1 migration, about 12 connectors in 6 families, Atlas question layers | A (entity mapping) |
| C. Business objects | 2–3 migrations, sanctions job, 4 small screens/tabs | A |

Recommended order: A, then C's sanctions screening and land control, then B, then the rest of C.

## 6. Built (2026-10-07)

- **Ontology** (`lib/ontology/`): 24 entities mapped to their tables (entities.ts), 49 typed relationships with allowed
  ends (relations.ts; `addOntologyEdge` refuses ungrammatical edges), state machines for project / capital raise /
  permit / engagement / claim / signal with person-only moves and project gates 0–8 derived from tracker stages
  (states.ts), taxonomies incl. evidence levels L0–L4 (taxonomies.ts), identity resolution (`entity_aliases`,
  identity.ts), values by source with a rule-chosen canonical value (conflicts.ts). Page: Intelligence → Ontology & data fabric.
- **Migration 0052** (additive): entity_aliases, sanctions_lists, sanctions_checks, stakeholders, equipment,
  project_equipment, land_controls, project_queue_links, ontology_matches, permit_dependencies; relationship_edges gains
  valid_from, valid_to, evidence_claim_id.
- **Data fabric** (`lib/fabric/`): source records overlaying the integration registry (family, domain, level,
  resolution, update, maps-to), 8 question layers (water risk, grid access, land & nature, hazards, resource, soils,
  people & economy, emitting assets) with source hierarchies, country packs (US, Mexico, UK, EU) active only where a
  project is located. New free connectors: ISRIC SoilGrids (re-enabled; beta, 5 req/min), Climate TRACE assets,
  OpenStreetMap reverse lookup for the administrative chain. Registered for import or reference: Global Energy Monitor,
  Overture, GeoNames. Electricity Maps is registered as licence-required (free tier is non-commercial).
- **Sanctions** (`lib/sanctions/`): OFAC SDN + aliases, UK Sanctions List, EU consolidated, UN consolidated (about 93,000
  names, streamed), weekly job `sanctions.refresh` (Sunday 03:20) fanning out `sanctions.list`; screening of names and
  recorded name aliases; possible matches block introductions until an owner records a decision with a reason.
  Page: Network → Sanctions screening.
- **Project 360 tabs**: Site questions, Land control, Diligence & data room (gate, 11 folders, values by source, permit
  critical path with cycle check, party screening), Equipment & queue, Stakeholders, Matches (criteria met / failed /
  unknown; no score).
- Tests: tests/unit/ontology.test.ts, tests/unit/sanctions-fabric.test.ts, tests/integration/ontology.test.ts.

Not built (needs a separate decision): event-driven automations beyond the existing trigger rules, IoT time series,
paid or non-commercial sources (section 3).
