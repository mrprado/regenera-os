# Phase 28 — Steward ecosystem

Status: **proposed 2026-10-10, awaiting approval.** Source brief: the founder's Steward specification (2026-10-10).
Infrastructure confirmed: Cloudflare Workers, D1 (binding DB), R2 (BUCKET, regenera-os-backups), cron tick via the jobs
table (scripts/deploy.mjs). No PostGIS, no raster processing service, no queues binding.

## 1. What already exists (reused, not rebuilt)

| Need | Existing |
|---|---|
| Communities, rights, authorities, governance rights | db/community.ts: communities, community_rights, community_authorities, community_governance_rights |
| Knowledge with permissions and uses | knowledge_holders, knowledge_records, knowledge_permissions, knowledge_uses (governed; never in Ask/MCP/search) |
| Consent, engagements, grievances, commitments, funds | consent_records, community_engagements, community_grievances, community_commitments, community_funds, community_ledger |
| Obligations, impact records | stewardship_obligations, impact_records (phase 23), contract_obligations |
| Field records, site features | field_observations, site_features, spatial_layers (db/spatial.ts) |
| Sources | data_providers, datasets, dataset_sync_jobs, project_dataset_links, project_screening_flags; integration registry with real-success "connected" status |
| Evidence | claims, claim_evidence (evidence levels; provenance) |

## 2. Stages (each shipped, tested and reported on its own)

**28A — Steward hub on persisted records (no new sources).** Steward area with six tabs: Overview, Places, Knowledge,
Community, Care, Outcomes. New: steward_places (+ geometry versions, accuracy, many-to-many with projects and
communities, contested claims allowed), care_plans and care_actions (owners, dates, seasonality, dependencies,
monitoring method, completion evidence), stewardship_budgets and funding_allocations (projected / committed / funded /
paid kept apart; no mixed-currency totals without a dated conversion), outcome indicators and measurements (baseline,
latest, method, unit, period, uncertainty, target, reviewer). Knowledge permissions widened to the specified fields
(custodian vs contributor, authority evidence, purpose, users, digitisation, translation, publication, commercial use,
AI retrieval, model training default no, precision, review/expiry, compensation, benefit sharing) and enforced
server-side across views, counts, search, maps, exports, AI, notifications and MCP; permission-aware counts. Query states
(not queried · pending · completed with no records · failed · no coverage · insufficient evidence · restricted · stale ·
unverified) used everywhere; no state ever renders as "low risk" or "none present". Multidimensional assessment with the
specified statuses, never one score. Workflows B (community knowledge), C (care plan), F (permission change) and G
(source-linked Steward brief) delivered here.

**28B — Source register and verified global connectors.** Source register fields added to data_providers/datasets:
access method, coverage, resolution, cadence, version, licence URL, commercial use, redistribution and AI processing as
separate fields, auth, quotas, verification time, last success, latest observation, health, enabled/blocked reason.
Fetch pipeline: discovery → licence check → fetch → validate (detects HTML/login pages, 200-with-error, empty and partial
pages) → normalise → persist with fingerprints → spatial match → findings → review → notify; idempotent, retries with
backoff and jitter, bounded concurrency, checkpoints, dead letters. Connectors, each enabled only after a live bounded
request is verified and recorded:
- **Expected free and commercial-compatible (verify terms first):** GBIF occurrence search (per-dataset licences kept),
  SoilGrids REST (point/bounded queries, rate-limited), Global Forest Watch data API (key already configured), Copernicus
  Data Space STAC (metadata search; downloads need an account), UNESCO World Heritage list, FAOSTAT, GIAHS references,
  JRC Global Surface Water (tile/extract), NASA FIRMS (needs MAP_KEY).
- **Needs an account or key from you:** Copernicus CDS (ERA5, ERA5-Land; asynchronous jobs), Copernicus Data Space
  downloads, NASA FIRMS MAP_KEY, INEGI token.
- **Licence-required (catalogued, kept disabled):** Protected Planet API (non-commercial terms), IBAT (paid licence),
  LandMark if its terms exclude commercial use. Google Earth Engine not used.
- **Large rasters/vectors (HydroBASINS/HydroRIVERS, CHIRPS, LandMark downloads):** preprocessed per region pack by a
  script run outside the Worker, stored in R2 with version and attribution; the Worker only reads per-place extracts.
Workflows A (real place profile), D (refresh twice: idempotency and revisions) and E (source failure) delivered here.

**28C — Mexico / Yucatán regional pack.** Region-pack architecture (country packs already exist in lib/fabric); Mexico
first: CONABIO, INPI, INEGI, CONAGUA, RAN, INAH as catalogued sources with verified downloads or reference workflows
(no invented APIs); karst rule: surface-water results for Yucatán carry a groundwater limitation and open a request for
local hydrogeological evidence; sensitive archaeological and cultural locations never extracted or published.

**28D — Across the OS.** Project Steward tab (place, community context, plan, gaps, consent status, care costs,
outcomes); Atlas layers with provenance and generalised sensitive geometry; Capital readiness gaps and stewardship
costs (no valuation or credits); Network links for practitioners and institutions (community contacts never moved to
outreach); Intelligence questions over authorized records; automations for dataset updates, failures, review dates,
monitoring deadlines, budget gaps and overdue commitments, grouped to avoid notification storms; AI analyst drafts with
evidence references, dates, coverage, limitations and missing information, saved as drafts for review; permission
withdrawal invalidates dependent summaries through a dependency graph.

## 3. What I need from you before 28B/28C live connectors
1. NASA FIRMS MAP_KEY (free registration).
2. Copernicus accounts: Climate Data Store (ERA5) and Data Space (imagery downloads), free registration; you accept
   their terms.
3. INEGI API token (free).
4. Decision on IBAT (paid) and whether to seek a Protected Planet commercial agreement; until then both stay disabled.
I will not register accounts, accept terms or purchase anything on your behalf.

## 4. Order and reporting
28A → 28B → 28C → 28D, each with migrations (additive), tests (tenant isolation, permission leakage, idempotency,
pagination, missing-data states, revisions, withdrawal), a browser check, and the integration status table from the
brief (source · access · licence · auth · live request tested · period/version · persisted · operational · dependency).
