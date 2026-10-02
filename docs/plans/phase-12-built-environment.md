# Phase 12 — Built Environment intelligence

Built environment is one node in Regenera's relationship graph (land, projects, companies, technologies, materials,
energy, water, infrastructure, capital, communities, regulation, contractors, suppliers, investors), not a
construction-tech directory. It lives under Intelligence → Built environment (`/intelligence/built`) and inside
Project 360 → Development → Built environment. No new top-level module.

## Architecture (reuse first)

- Companies are CRM organizations with a `be_company_profiles` row (no second company table). Investors are
  organizations too; the capital graph reads profile investor links.
- Technologies (`be_technologies`) are separate from companies; materials (`be_materials`) link suppliers and EPDs;
  construction systems (`be_systems`); signals (`be_signals`); project matches (`be_matches`); commercial
  opportunities (`be_opportunities`, each backed by a deal); governed vernacular knowledge (`be_knowledge`).
- Suppliers are `network_profiles` with qualification columns; RFIs / RFPs are `procurement_packages` and `bids`
  (criterion-by-criterion comparison already in the project Procurement tab).
- Sustainability claims use `project_attributes` with subject type company / technology / material and a claim
  state (company reported, third-party verified, certified, estimated, unverified).
- Migration 0044, additive.

## Tabs

Overview (metrics, needs attention, matches, technologies, signals, partnerships, procurement, capital, regulation,
expansion, a brief assembled from records), Market map (by category, stage, maturity, geography, project fit; company
drawer), Companies, Technologies, Materials (+ governed knowledge register), Construction systems, Building energy,
Water & circular, Project fit, Partnerships, Capital, Signals, Regions, Procurement.

## Project fit engine (lib/built/fit.ts)

Site profile: climate inferred from latitude and NASA POWER precipitation, hazards from location, screening flags and
USGS facts, development type from asset class — each labelled as inferred. Candidates are excluded on explicit climate
or building-type mismatch; each recommendation carries a reason, a confidence (high / moderate / low, not a score),
categorical cost / schedule / carbon / resilience effects, stage fit and provider options. Passive / bioclimatic design
and resilience strategies are added by climate and hazard.

## Rules

- Records carry their origin: DEMO, LIVE, USER ENTERED, IMPORTED, API, RESEARCH. The DEMO sample (40 companies, 50+
  technologies, 35 materials, 20 systems, 20 investors, 15 signals, matches on the four demo projects, 5 RFIs / RFPs)
  is fictional, "DEMO — " prefixed, and has no invented figures (embodied carbon, prices and amounts "Not recorded").
- "Carbon-negative", "sustainable", "regenerative", "zero carbon" are refused on a record without a supporting,
  non-unverified claim.
- Success fees are never assumed permissible: fee compliance starts Unknown and becomes Review required when a
  success fee is chosen.
- Traditional / vernacular knowledge is governed (holder, community, custodian, consent, authorized use, commercial,
  publication and digitization permission, attribution, benefit-sharing, restrictions, review date, access state). It is
  not searchable and never reaches Ask the OS or MCP.
- No scraping of services in violation of their terms; future connectors are adapters (lib/data-providers pattern).

## Integration

Signal → company → match engine → matched projects → partnership opportunity (deal + outreach task) → meeting → NDA →
technical review → pilot → agreement. Command shows high-importance signals, RFP deadlines and new matches. Atlas site
context links to the project's Built environment and Environmental & spatial screening tabs. Global search covers
built-environment companies, technologies and materials ("low carbon concrete Mexico", "companies expanding into
Mexico", "bamboo supplier Latin America").

## Tests

`tests/unit/built-fit.test.ts` (site profile, explained recommendations, exclusions, strategies, guarded claims) and
`tests/integration/built.test.ts` (sample breadth and labelling, company → projects → deal, recommendation → RFI with
invited suppliers, search excluding governed knowledge, demo removal).

## Credentials still needed for live data

None for the built-environment workflows themselves. Future connectors (licensed company databases, EPD APIs,
permit and procurement portals) need their own keys or licences and are not assumed.
