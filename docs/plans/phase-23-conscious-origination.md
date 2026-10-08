# Phase 23 — Conscious Opportunity Origination: the Regenera Origination & Integrity Engine

Source: founder directives "Conscious Opportunity Origination & Regenerative Intelligence Architecture" and "Global Data
Intelligence Integration" (2026-10-08). A governing layer across phases 6–22, not a dashboard or an ESG score.
Status: **awaiting approval**.

Principle: three independent dimensions — Commercial Integrity, Regenerative Integrity, Strategic Alignment. None
compensates for another; a hard exclusion is never outweighed by returns; a positive mission never implies feasibility;
Regenera's fee potential never touches an integrity reading.

## 0. Audit (repository + production, 2026-10-08)

| Directive need | Already operational | Gap |
|---|---|---|
| Discovery → record pipeline | World Bank projects loop (Market pipeline, claims + API evidence, parties, screening, assessment), funding scan (6 sources + rules/AI read), signals → triggers, GPPD plants, document extraction, public intake | No integrity screening step; GEM / OCDS / EnergyData / GCF / IFC not ingested |
| Evidence & provenance | claims (verified / source_provided / calculated / ai_inferred / assumption / unverified / disputed) + claim_evidence (method, URL, page, licence) | Map to the directive's six provenance classes in UI; no "MISSING / EXPIRED" surfacing per assessment |
| Ecological / social screening | Site intelligence (15 stages: grid, water + Aqueduct, ecology + GFW loss + GBIF, land/terrain, climate/hazards, community/rights/consent registers, regulatory), OSM protected areas, Natural & Community tabs, governed-knowledge rules (phase 12) | No rule engine turning these facts into decisions; WDPA/IBAT licence-blocked (legal protected boundaries) |
| Commercial screening | Readiness rubric (6 sector templates), eligibility engine (5 outcomes), capital pathways by stage, screening economics model | — (reused as Commercial Readiness) |
| Matching | Funding ↔ project (hard gates + reasons), capital rematch, programmes, partner scans | No impact / safeguard criteria on capital profiles; no investor status ladder |
| Gap intelligence | Market hypotheses (signal clusters) | No thesis from spatial suitability + finance programmes |
| Commercial conversion | Services catalogue (incl. phase 22 revenue streams), proposal drafts, engagement conflicts check, counsel gates | Not gated by integrity decisions; services D (redesign) and H (stewardship) missing |
| Governance | Approvals, send gate, sanctions, protected parties, owner-only capital data, audit log | No versioned origination policy; no override history for decisions |
| Command | Ops strip, origination counts, desk | No daily brief built from records |
| Stewardship | Obligations register (contracts), permits | No impact baselines / targets / observed results / verification states |

## 1. Scope

### 1.1 Origination & Integrity Engine (foundation)
- `origination_policies` (versioned, immutable once published): classification rules A Regenerative Core · B Transition &
  Enabling · C Conditional / Redesign Required · D Restricted / Excluded; configurable exclusion list; sector methods.
- `policy_decisions`: state (Eligible · Conditionally Eligible · Redesign Required · Enhanced Due Diligence · Insufficient
  Evidence · Excluded · Human Review Required), class, policy version, each rule fired with evidence links, confidence,
  outstanding information, remediation, reviewer, next review date, override history. New policy versions never rewrite
  old decisions; reversing an exclusion needs an owner's documented review.
- `integrity_findings`: evidence-linked concerns, uncertainties, conflicts and positive findings.
- Deterministic rules over existing facts: protected-area overlap / proximity (OSM, marked non-legal until IBAT), forest
  loss, water stress, slope, flood/seismic exposure, community rights open / consent status, sanctions matches, developer
  record, sector-specific requirements (e.g. WtE: feedstock, emissions, residues verification → Conditional; never
  "regenerative" by default), data gaps → Insufficient Evidence (never favourable, never "harmful").
- Service-layer enforcement: Excluded / Human Review blocks proposals, queue advancement, outreach drafts and capital
  introductions (server actions refuse, tested), not just a UI badge.

### 1.2 Seven independent readings (no blended score)
Commercial Readiness (existing rubric) · Regenerative Potential · Environmental & Social Risk · Strategic Alignment ·
Evidence Confidence · Implementation Feasibility · Additionality Potential — descriptive categories with the rule and
evidence behind each; numbers only where a documented method exists (e.g. hectares overlapped, km to substation).
Frameworks referenced (not certified): IFC Performance Standards 1–8 as the safeguard spine, TNFD LEAP, GHG Protocol
Project Protocol for emissions, IRIS+ indicator definitions, Equator Principles categories.

### 1.3 Impact & stewardship objects
`impact_indicators` (catalogue: unit, method, source standard), `impact_baselines`, `impact_targets`, `observed_impacts`
(baseline · forecast · target · reported · independently verified), `stewardship_obligations` (monitoring, reporting,
benefit-sharing, due dates → tasks). Community-held knowledge stays under the phase-12 governance (consent, withdrawal).

### 1.4 Regenerative Redesign Engine (v1)
Sector option libraries (solar: degraded land, habitat retention, agrivoltaics, wildlife fencing, community benefit;
WtE: waste hierarchy, feedstock, emissions verification; real estate: watershed, water demand, corridors; agriculture;
data centres: water, heat recovery, grid). `redesign_scenarios` (original · lower-impact · regenerative) with assumptions
and uncertainty; financial deltas only through the existing screening model when inputs exist; versioned; applying a
scenario to the project needs approval.

### 1.5 Both pathways wired through the engine
- Project-first (WB loop, intake, extraction, site screens): record → identity → site → evidence → commercial + integrity
  screen → classification → readiness → redesign options → financing → matches → strategy → diagnostic scope → tasks.
- Capital-first: funding record → eligibility + safeguard requirements (extracted from structured fields, AI read when
  available) → project universe screen → eligible / uncertain / unsuitable → supply gaps → hypotheses.
- Capital profiles gain structured impact criteria (environmental eligibility, exclusions, safeguard standard, impact
  reporting, catalytic / concessional) and an investor ladder: potential eligibility · preliminary fit · investor interest
  · confirmed mandate · approved investment. Carbon / biodiversity credits never counted as revenue.

### 1.6 Origination Gap Intelligence
Theses from (a) signal clusters (exists), (b) spatial suitability (resource + grid + land constraints from site screens and
registry plants), (c) open funding programmes without a matching project. Always labelled thesis; convert by a person.

### 1.7 Workspace, Atlas, Command
- /origination gains Screening and Stewardship views (Discovery = queue, Development = readiness/redesign, Matching,
  Engagements exist) — no new top-level pages.
- Atlas: "Regenerative Opportunity Intelligence" workspace; inspector shows classification, findings, confidence, redesign
  potential, next action; constraint overlays reuse existing layers with limits stated.
- Command: daily brief generated from records (highest-leverage opportunity, capital alignment, development risk,
  commercial next action, stewardship priority), each linked; says "little changed" when true.

### 1.8 Commercial conversion with integrity gates
Services A–H mapped to the catalogue (adds D Regenerative Redesign Advisory and H Monitoring & Stewardship); conversion
needs a non-excluded decision, no conflict, capacity; transaction-based compensation stays behind counsel review.

### 1.9 Data integration wave (status ladder: Operational · Partially operational · Credentials required · Licence
required · Unavailable · Planned, with evidence)
- Build now (keyless, documented): World Bank EnergyData.info (CKAN), Open Contracting Data Registry (selected publishers,
  bulk OCDS: Mexico, South Africa, UK, others with tender + award stages kept apart), Green Climate Fund open data
  (approved projects as history, never open windows), IFC disclosures where a feed exists.
- Already operational: World Bank projects + procurement, TED, Grants.gov, EU F&T, UK CF/FTS, GPPD, OSM/OpenInfraMap,
  Aqueduct, GBIF, NASA POWER, USGS. Credentials: GFW, SAM.gov, IATI, EIA, ENTSO-E, NREL. Licence: WDPA/IBAT, GEM
  (record-level terms), Earth Engine (commercial).
- Regional packs extend lib/fabric/packs.ts: United States, Mexico, Southern Africa, New Zealand, India, Europe — each
  listing authorities and connector status honestly.

### 1.10 Agents
The nine analyst roles map onto existing jobs (research = WB loop / scans; geospatial = site intelligence; capital =
eligibility + matching; commercial = readiness; integrity = new `integrity.screen` job; orchestrator = origination.sync;
stewardship = new `stewardship.due` job). Deterministic services for rules, arithmetic, geometry; AI only for document
reading and narrative (labelled). Permission matrix enforced in server actions.

## 2. Stack
No change: Workers + D1 + R2 + jobs table. No PostGIS, graph database or agent framework (the audit shows none needed now).
Migrations additive.

## 3. Acceptance (integration tests; live where data exists, fixtures labelled)
1. Renewable energy: a real World Bank solar project → record → commercial + integrity readings → gaps → funding pathways
   → next action.
2. Ecological red flag: hypothetical site overlapping a protected area → spatial check → Redesign Required / Excluded per
   policy → proposal and outreach blocked at the service layer.
3. Capital first: a real open funding call → criteria → eligible / uncertain / unsuitable projects; closed calls never
   shown as active.
4. Waste & resources: illustrative WtE → Conditional with verification needs; never labelled regenerative by default.
5. Regenerative land: illustrative restoration / community project → land, water, ecology, community, finance pathway.
Plus: policy versioning (old decisions unchanged), override needs owner + reason, fee potential has no effect on class.

## 4. Not in this phase
Licensed datasets (IBAT/WDPA, GEM commercial, Earth Engine commercial, PitchBook-class capital data), certified
verification, investor-facing publication, automatic external contact.
