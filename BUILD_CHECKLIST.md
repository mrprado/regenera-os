# Regenera OS — build checklist (master production build instruction, 2026-09-26)

Status legend: **Done** (verified by test or browser), **Built** (code exists, verification noted), **Adapted** (built
on the existing stack instead of the literal instruction), **Pending**, **External** (needs Prado: credential, licence,
account, counsel).

## Stack decision (applies to every phase)
The instruction asks for a pnpm monorepo on Supabase Postgres/PostGIS/Auth/Storage, Tailwind and pg-boss. Regenera OS
already runs in production at regenera.bio/os on Cloudflare Workers + D1 with 225 passing tests, and two standing
rules apply: **never Supabase** and **no Tailwind** (CLAUDE.md, memory). So the spec is built onto the existing stack:

| Instruction | Built as | Why |
|---|---|---|
| Supabase Postgres + RLS | D1 (SQLite) + server-enforced scoping (`lib/db/scoped.ts`, `mandateCondition`) + portal grants; tests assert isolation | No Supabase; every query already passes the scope guard and lint blocks unscoped DB access |
| PostGIS | GeoJSON in D1 + Turf-style helpers + server-side bbox queries | D1 has no PostGIS; volumes are small |
| Supabase Auth / roles | Internal: email + password sessions (existing). External portals: separate `portal_users` with PBKDF2 hashes, invite links, `portal_session` cookie | External users must never share the internal session |
| Supabase Storage | Document registry with external links; R2 adapter when R2 is enabled (External) | R2 not enabled yet |
| pg-boss / Redis | D1 `jobs` table + cron tick (existing) | Same guarantees (claim safety tested) |
| Tailwind + shadcn | CSS Modules + design tokens (existing rule) | No Tailwind |
| pnpm monorepo, Vercel, Docker worker | Single vinext app on Workers; worker = cron trigger | Already deployed; no second runtime to operate |
| Playwright PDF | pdf-lib in the Worker (existing, branded) | Playwright cannot run in Workers |
| OpenAI + Anthropic | Anthropic server-side (existing), app works without a key | Stack rule; provider interface kept small |

## Gap analysis against the instruction (numbers = instruction sections)

| # | Area | Before this build | Status |
|---|---|---|---|
| 01–02 | One platform, internal + portals + intake | Internal OS only | Pending → portals phase |
| 06 | Sidebar | Grouped sidebar (Today, Origination, Projects, Capital, Intelligence, Work) | Adapted (keep routes; no rename churn) |
| 07 | Command | Today page with panels | Done (Today); pending: needs-attention ranking, map |
| 08–09 | Projects, record, stages | 14-tab project record, 18 stages, readiness with evidence | Done |
| 10–11 | Capital, matching, stack | Profiles, mandates, qualifications (owner-only), opportunities, transparent matching with eligibility gate, tranches | Done; capital-stack scenarios via Economics |
| 12 | Deals + stage gates | Opportunities pipeline | Pending: stage-gate conditions |
| 13 | Engagements | Regenera contracts per engagement, fees, success-fee review flag | Done |
| 14–15 | Relationships, outreach | People, companies, relationships, one-to-one approved sends, Gmail/Calendar | Done; pending: graph view / warm paths |
| 16–17 | Intelligence, triggers | Signals, trigger queries, funding radar | Done; pending: rule-driven trigger definitions |
| 18–19 | Atlas, spatial engine | Map page (MapLibre) + place profile | Partial → Atlas phase |
| 20–21 | Systems, interventions | Territorial systems tags | Pending |
| 22–23 | Playbooks + learning loop | Playbook drafts (phase 4) | Pending: Process/Toolbox/Proof/Governance engine |
| 24 | Evidence + claims | field_sources, verifications, place_facts with provenance | Partial → claims/evidence phase |
| 25–26 | Documents, data rooms | Document registry with versions | Pending: data rooms, NDA gate, access logs |
| 27–28 | Templates, PDF/DOCX | 5 contract templates, branded PDFs | Pending: more templates, DOCX |
| 29 | Obligations | Done (M3) | Done |
| 30 | E-signature | — | Pending: provider interface + mock + signed upload |
| 31–34 | Broker portal, registration, economics, materials | — | Pending (mandatory) |
| 35–38 | Capital, sponsor, partner, stakeholder portals | — | Pending |
| 39–41 | Compliance, securities, KYC | Regulatory M4, KYC owner-only, send-time gate | Done; pending: distribution log for portals |
| 42–44 | Search, Ask, AI governance | Cmd+K, Ask the OS with tools, proposals queue | Done |
| 45–48 | Data model, visibility, auth, audit | Audit log, scoping | Pending: explicit visibility for external scopes |
| 49–57 | Connector framework + providers | Registry of 43 with licence states, gate, stale fallback, 5 place adapters | Partial → integrations phase (PVGIS, Copernicus STAC, EIA, NOAA, FIRMS, ENTSO-E, IMF, Open-Meteo …) |
| 58–60 | .env.example, integration center, licence profiles | Settings → Integrations | Partial |
| 62–63 | Notifications, tasks | Tasks, digest | Pending: notification centre |
| 64–65 | Reports, exports | Weekly report, brief PDF, CSV registers | Partial |
| 69 | Public intake | Site webhook intake | Pending: /intake/{project,capital,broker,partner} |
| 70–72 | Financial data, risk, readiness | Economics, risk register, readiness | Done |
| 89–91 | Demo data | `[local test]` records locally | Pending: is_demo seed |
| 92–94 | Tests incl. broker/portal security | 225 tests | Pending: portal security tests |

## Phase log
(Each phase: tests run, failures repaired, this file updated.)

### Phase P1 — External portals, intake, introducers, data rooms (2026-09-26)
- Built: portal accounts (invite → password → session, PBKDF2), explicit grants, access log, document gateway,
  sponsor / capital / introducer / partner portals (+ stakeholder behind flag), public intake ×4 with honeypot and
  rate limit, introducer onboarding, referral registration with conflict checks, agreements, commission schedules
  and events with approval blockers, distribution approvals, data rooms with NDA gate, document requests, approved
  updates, messages, admin page /portals. Migration 0018 (additive).
- Verified: tests/integration/portal.test.ts (10 tests incl. every §93/§94 case) pass; route-guard test extended
  (portal pages need requirePortalUser, portal code never touches the OS session) passes; browser: broker intake →
  convert → invite → password → introducer portal (inactive notice) → referral → internal queue shows 4 conflicts;
  capital and partner invites render every tab; cross-portal URLs redirect to the user's own portal.
- Status: **Done** for §31–35, §37, §46 (portal scope), §69, §93, §94. §36 sponsor portal Built (view tested; page
  rendered through tests of its view, not a browser pass). §38 Built behind flag.

### Phase P2 — Playbook engine + learning loop; P3 — claims and evidence (2026-09-26)
- Built: migration 0019 (playbooks, playbook_versions, playbook_runs, playbook_corrections, claims, claim_evidence);
  20-playbook library; runner with tools, governance, proof checks, approval; corrections → draft versions → owner
  promotion; repeat detection; claims with evidence, verification rule, supersession and as-of queries; /playbooks,
  /playbooks/[id], /playbooks/runs/[id]; project "What we know, and how" panel; "Run site intelligence".
- Verified: tests/integration/playbooks.test.ts (5 tests) pass; browser: Run site intelligence on Valle Solar → run
  with both autonomous tools done (place profile queued, study gaps listed), review steps open, definition of done
  2/2 checks pass, run stays "needs review" until the review steps are done; project overview renders the claims panel.
- Status: **Done** §22, §23, §24 (claims/evidence), §44 (step governance), §74 (claims as-of).

### Phase P4 — Systems and interventions (2026-09-26)
- Built: migration 0020 (system_assessments, interventions); project Systems tab (11 categories; baseline →
  dependencies → impacts → thresholds → risks → opportunities → future state; capacity; implications for durability,
  development, operating, permitting, capital, cost; framework mapping TNFD/IFC PS/ISSB as reference only; review needs
  sources); interventions with cost basis, outcome, linked risk, funding pathway, partner, and "Create capital need"
  (capital requirement linked); /systems portfolio matrix; sidebar Intelligence → Atlas, Systems.
- Verified: browser on Valle Solar: water assessment saved (constrained), intervention added, capital requirement
  created and linked. Typecheck clean.
- Status: **Done** §20, §21.

### Phase P5 — Events, trigger rules, notifications, stage gates (2026-09-26)
- Built: migration 0021 (events, trigger_rules, notifications, notification_mutes, stage_gates); emitEvent from
  project create/stage change, introducer registration/approval, playbook completed/failed, portal messages, public
  intake, capital mandate changes; events.dispatch job every 5 minutes (claimed once, idempotent); 7 default rules;
  rule builder (event + condition → notify / task / playbook / job); notification centre with read, resolve, snooze,
  assign, mute by category, header badge; stage gates for Capital alignment, Financial close, Construction (checks
  reuse the playbook proof checks; owner override with an audited reason).
- Verified: tests/integration/events.test.ts (4) pass; browser: move to Construction blocked with the missing items
  named; /notifications inbox, rules, gates and event log render.
- Status: **Done** §09 (stage gates), §17, §62, §75. Deal (tracker) stages keep the live-site vocabulary; gates apply
  to project stages.

### Phase P6 — Integrations (2026-09-26)
- Built: adapters (lib/integrations/adapters.ts) for PVGIS (now in the place profile), Copernicus STAC (scene
  metadata, no raster downloads), EIA v2, NOAA CDO, NASA FIRMS, ENTSO-E, FRED, IMF SDMX (configurable base), Protected
  Planet (refuses unless PROTECTED_PLANET_COMMERCIAL_LICENSE=true and a token); fetchJson text mode for CSV/XML;
  registry grown to 61 providers (public Nominatim → development only with the OSMF limits, self-hosted Nominatim,
  SoilGrids disabled (REST paused), Google Places/Solar disabled (paid), ERCOT/CAISO/PJM, e-signature, accounting,
  Stripe, Sentry registered off); Integration Center "Test" (one real call, owner); .env.example (names only);
  docs/API_INTEGRATIONS.md generated from the registry (scripts/gen-api-integrations.ts).
- Verified: tests/unit/adapters.test.ts (6) + place test with PVGIS fixture pass; live checks: PVGIS for Mérida returned
  1,519 kWh/kWp/yr through the adapter's schema and normalizer; Copernicus STAC returned 20 real Sentinel-2 scenes
  (base moved to stac.dataspace.copernicus.eu/v1; default updated).
- External: keys for EIA, NOAA, FIRMS, ENTSO-E, FRED, Companies House, NREL …; commercial licences for Protected
  Planet, IBAT, PJM, Open-Meteo; Google billing if ever wanted.
- Status: **Done** §49–51 (framework, spatial/earth, ecology/land within licences), §52 (EIA, ENTSO-E; ERCOT/CAISO/PJM
  registered), §53 (PVGIS + NASA POWER; Google Solar optional/off), §54 (World Bank, IMF, FRED), §55 (EDGAR, GDELT,
  Companies House existing), §57–60 (registry, center, .env.example, licence fields).

### Phase P7 — Atlas and spatial engine (2026-09-26)
- Built: migration 0022 (spatial_layers with provider, source/retrieval dates, licence, resolution, coverage,
  confidence, bbox, is_demo); lib/geo/geo.ts (geodesic area/length, GeoJSON validation, KML placemarks, CSV points,
  bbox, viewport clipping, 5 MB / 20k feature limits); /api/map/layers (library), /api/map/layers/[id]?bbox= (features
  clipped server-side to the view), /api/map/areas (project boundaries with area), /api/map/site (site context grouped
  Energy / Infrastructure / Water / Ecology / Climate / Community / Land / Permitting with source, tier, date);
  Atlas panel tabs Library (toggle, provenance, import, remove) and Draw (draw site, measure, undo, clear, save as a
  project boundary, create a project here, export GeoJSON); selected project shows site context and "Run site
  intelligence"; Map renamed Atlas.
- Verified: tests/unit/geo.test.ts (4) pass; browser: layer imported through the form (2 features), library lists it
  with licence, bbox fetch returns 2 in view and 0 far away; four clicks on the globe drew a polygon with computed area
  and the save/create forms appeared.
- Pending: zipped shapefile, KMZ and GeoTIFF direct import (documented: convert to GeoJSON), PMTiles/vector tiles for
  very large layers, compare and scenario selector, bookmarks, Cesium 3D (MapLibre globe + terrain already available).
- Status: **Done** §18 core, §19 core; items above Pending.

### Phase P8 — Command (2026-09-26)
- Built: lib/command/attention.ts: Needs attention ranked across blockers, capital gaps, critical-path milestones,
  decisions, missing studies, E&S, insurance, bids, awards, lead times, permits, re-verification, counsel, obligations,
  expiring agreements, overdue actions, playbook runs needing review, document requests and action notifications (each
  with entity, issue, severity, why, owner, due, source, action); operating strip (projects, active opportunities,
  capital still to raise by currency, capital partner profiles, high-impact open risks); "What changed since your last
  session" from the event log with links. Today reuses the alert results it already computes (no duplicate queries).
- Verified: browser Today shows the strip and 6 ranked items (critical constraint → overdue obligation → critical-path
  milestone → permit expiry → capital gap → playbook review), each linking to its record.
- Pending: AI-written brief (works through Ask the OS when ANTHROPIC_API_KEY is set; not wired into Today), portfolio
  map embedded on Today (Atlas link instead), Assign/Snooze on non-notification items.
- Status: **Done** §07 core, §90.

### Phase P9 — Document generator, PDF/DOCX, e-signature (2026-09-26)
- Built: migration 0023 (generated_documents with versions and legal review; esign_envelopes); 27 templates
  (lib/documents/library.ts: mutual/one-way NDA, advisory engagement, sponsor engagement, development scope, capital
  advisory scope, broker/referral, introducer, partner MOU, collaboration, consultant SOW, EPC introduction, data room
  access, investor qualification attestation, conflict disclosure, information request, LOI, term sheet, meeting memo,
  investor teaser, investment memo, and data-driven reports: project brief, site intelligence, capital pathway, systems
  assessment, monthly update, commission statement); [TO CONFIRM] for any empty field; legal documents open with
  "DRAFT — COUNSEL REVIEW REQUIRED" and a PDF watermark until an owner records the named counsel's approval (refused
  while items are open); versions never overwritten; PDF header "REGENERA / Regenerative Ecosystem Advisory", footer
  with confidentiality, version, date and code; DOCX via fflate (no new dependency); e-sign provider interface with a
  mock provider (records each signature, nothing emailed), DocuSign / Dropbox Sign adapters that report "credential
  required", signed-PDF link as universal fallback; generator pages under Documents; downloads audited.
- Verified: tests/integration/documents.test.ts (3) pass (draft mark, approval blockers, versioning, signature gating,
  mock completion, report sources/unknowns, DOCX package parts); browser: site intelligence report generated for Valle
  Solar, PDF (%PDF-, 17.8 KB) and DOCX (PK zip) downloaded.
- Pending: charts and map snapshots inside generated PDFs (reports are text/tables), obligation extraction from an
  approved uploaded document (obligations are entered on the agreement; §29 register already Done).
- Status: **Done** §27, §28 (text/tables), §30.

### Phase P10 — Relationship graph and warm paths (2026-09-26)
- Built: migration 0024 (relationship_edges: works_at, founded, owns, advises, introduced_by, invested_in,
  partnered_with, financed, develops, supplies, contracts_with, referred, met_at, knows; strength, since, note);
  lib/graph/graph.ts builds the graph from records (contacts at organizations, mailbox correspondence strength,
  introductions, project parties, contract parties, bids, Regenera's projects) plus manual edges; warm paths = cheapest
  paths from Regenera (cost 1/strength), each hop with its reason; ego network; /relationships page with path finder,
  SVG network view and manual edge entry; sidebar entry.
- Verified: tests/unit/graph.test.ts (2) pass; browser: warm path to Valle Solar found with its reason; network view
  renders.
- Status: **Done** §14 (graph, warm paths). Gmail/Calendar outreach (§15) already existed (approved one-to-one sends).

### Phase P11 — Demo data (2026-09-26)
- Built: lib/demo/seed.ts: separate entity "DEMO — Regenera sample data" (mass sending off), 4 projects (Mexico Solar
  100 MW with a Yucatán site polygon, Yucatán Eco Park, New Zealand Solar, Africa Energy Project), family office, DFI,
  EPC, introducer, advisor, developer, people (@example.test), readiness, constraints, risks, capital requirements,
  tranche, capital profiles and mandate, milestones with a dependency, tasks, documents, open data room, document
  request, published update, introducer portal user (is_demo) with a conflict-review referral, three Atlas layers
  labelled "DEMO / SAMPLE DATA (illustrative, not an official source)", playbooks and rules; Settings → Demo data
  (owner) loads or removes it. No place facts or third-party figures are fabricated.
- Verified: tests/integration/demo.test.ts (idempotent, labels, removal) passes; browser: loaded locally, the four
  DEMO projects list and Today ranks the DEMO grid constraint.
- Status: **Done** §89, §90, §91.

### Phase P12 — Documentation, CI, final verification (2026-09-26)
- Built: README.md; docs/ARCHITECTURE, SECURITY (merged with the earlier security notes), OPERATIONS, DEPLOYMENT,
  COMPLIANCE, DOCUMENTS, DATA_MODEL, DATA_SOURCES (+ PORTALS, PLAYBOOKS, API_INTEGRATIONS from earlier phases);
  .github/workflows/ci.yml (install, lint, typecheck, build, test; no provider keys); `npm run verify`.
- Verified (actual run): `npm run ci` → lint clean, typecheck clean, Vitest 46 files / 262 tests passed, map discovery
  test 5/5, production build complete, exit 0.

### Phase P13 — Atlas intelligence globe (2026-09-27)
- Asked for: maps "top level, like spatialintelligence.ai" (Bilawal Sidhu's God's Eye View: photorealistic globe, live
  public feeds, sensor looks, click-to-track) with all APIs integrated. Built on the existing MapLibre globe (no stack
  change; Cesium + Google 3D Tiles would need a metered key or a non-commercial token: see docs/ATLAS.md).
- Built: layer catalogue (lib/map/catalog.ts, 26 layers, each tied to a registry key; /api/map/catalog filters by
  registry state and configured keys); 11 new registry entries (NASA GIBS, NASA EONET, NOAA NHC, FIRMS public files,
  adsb.lol, CelesTrak, EOX Sentinel-2 cloudless 2016, GFW tiles, OpenFreeMap, Open Infrastructure Map, AWS terrain);
  live feeds through fetchJson (lib/map/live.ts, /api/map/live/[feed]: USGS quakes, EONET events with tracks, NHC
  cyclones, FIRMS fires (keyless MODIS global or VIIRS for the view with a key), adsb.lol aircraft for the view and
  military worldwide, CelesTrak elements); basemaps (Esri HD with key, Sentinel-2 cloudless, yesterday's VIIRS, Black
  Marble, Blue Marble, tactical vector); overlays (NDVI, land surface temperature, night lights, IMERG precipitation,
  aerosol, tree cover loss, OSM protected areas, power grid by voltage and plant source, 3D buildings); browser SGP4
  satellites (satellite.js; WASM runtimes aliased to a stub); sensor looks (CRT, NVG, FLIR, Thermal ironbow, Noir);
  tactical HUD (UTC, DMS, altitude, heading/tilt, compass tape, live counts, target telemetry); detection boxes;
  click-to-track with trails, chase cam, satellite ground tracks; missions (Portfolio, Site scout, Hazard watch,
  Energy transition, Forest and land, Live traffic, Orbital watch); orbit and project tour; share links (camera,
  layers, look, tracked target in the URL hash); keyboard control; coordinate and place search (/api/map/geocode);
  imagery date slider; per-layer provenance, licence, caveats and status ("unavailable", never "none").
- Verified: tests/unit/atlas.test.ts (11) and tests/integration/atlas-live.test.ts (4: compact cache and ledger,
  disabled registry never called, FIRMS keyless vs key, ISS propagation 300–500 km) pass; route guard passes; lint,
  typecheck, build clean. Browser (local): Sentinel-2 globe with cyclones, quakes and GDACS; Live traffic mission in
  NVG over London (live aircraft); Orbital watch (satellites) with ISS-class tracking, ground track and HUD
  telemetry; Hazard watch in Thermal (334 quakes, 16,208 fires, 74 events, 5 cyclones); 3D buildings over Mexico City;
  FLIR with detection boxes on 155 aircraft over New York.
- Pending: photorealistic 3D tiles (needs a metered Google key or Cesium ion licence and a CesiumJS decision), vessels
  (AISStream key + websocket), animated wind, time scrubbing for point feeds.
- Status: **Done** §18–19 visual/live layer scope within licences.

### Phase P14 — Capital structures, funding pathways, opportunity gates, search (2026-09-29)
- Built:
  - **Migration 0025:** capital_structures, capital_stack_layers and funding_pathways; stage_gates.entity_type adds
    "deal".
  - **Capital stack builder:**
    - Scenarios per project are built from its capital requirements. Each layer records provider, amount, pricing,
      rate, tenor, amortization, security, status, conditions, source and assumption status.
    - Live figures: coverage, gap, debt/equity mix, weighted rate, committed share, and warnings.
    - Seniority chart with the gap shown and unsourced layers hatched.
    - Scenarios can be copied and compared, and one marked preferred.
    - An owner records reviews; any change resets the review. Nothing is labelled "compliant".
  - **Funding pathways:**
    - Generic process steps per source type.
    - Eligibility is separate from fit and is only "confirmed" with a named source.
    - Deadlines and overdue steps appear on Today.
    - A pathway can be started from a Funding call.
  - **Pages:** /capital/structures and /capital/funding-pathways.
  - **Opportunity gates:**
    - Gates on Engaged, Proposal, Signed and Active. Conditions sit on the deal or its linked project and can apply
      per path.
    - Gates are cumulative along the stage flow, so stages cannot be skipped.
    - An owner can override with a reason; the override is audited.
  - **Opportunity detail (/deals/[id]):** overview, conditions, participants, capital, agreements and activity.
  - **Search:** 12 more record types.
  - **Demo data:** a DEMO scenario and pathway.
- Verified:
  - capital-structure.test.ts (7) pass.
  - Full CI: lint, typecheck, 284 tests, build.
  - Browser:
    - A scenario was built, and editing it updated coverage and the gap live; it saved.
    - A pathway was created with the DFI steps.
    - Moving an opportunity to Proposal was blocked, with the failing conditions listed.
- Status: **Done** §10 FundingPathway, §11 Capital Stack Builder, §12 stage gates and deal detail, §42 search.

### Phase P15 — ATLAS geospatial workbench (2026-09-29)
- Built:
  - Migration 0026: site_features, spatial_analyses, field_observations.
  - lib/geo:
    - dem.ts: terrarium decode; slope, aspect, TRI/TPI; contours (d3-contour); mask polygons; profile; depression
      fill; D8; accumulation; watershed; viewshed; line of sight; cut/fill; polygon mask.
    - ops.ts (Turf): measures, buffers, boolean ops, split, nearest, quantities, vector envelope.
    - raster-envelope.ts: bounded raster envelope with an exact Euclidean distance transform.
    - crs.ts (proj4): UTM zones and round trip; decimal, DMS and UTM parsing.
    - osm.ts: Overpass nearest infrastructure and constraints, with mirror fallback and a 30-day cache.
    - export.ts: GeoJSON, KML, CSV (formula-safe), DXF R12 in WGS84 or UTM.
    - workbench.ts: records.
  - /api/spatial/[op]: measure, buffer, intersect, difference, union, nearest, constraints, developable-area,
    features, analyses, observations, observations-convert, export.
  - Atlas Workbench tab:
    - modes, drawing tools, coordinate and bearing entry
    - every analysis with its grade and limitation
    - operation history with hide, undo, save and export
    - profile tray, design quantities and user cost inputs
    - compare saved analyses, monitoring and observations
- Fixed during verification:
  - Overpass rejects requests without an identifying User-Agent (sent by fetchJson).
  - The combined query was trimmed, and mirrors are tried when the main instance times out.
  - Style mutations now wait for the style to load.
  - The vector envelope ran out of memory on dense city data (3,000+ polygons), so it was replaced server-side by
    the raster method.
- Verified:
  - Tests: terrain (15), atlas (11), workbench (4), route guard. Lint and typecheck clean.
  - Browser:
    - A 1,440 ha rectangle over the Desierto de los Leones gave elevation 2,465–3,102 m and 5 m contours with
      labels; recorded.
    - UTM readout 14N 474996 E 2134537 N; watershed recorded.
    - Envelope for a 348 ha site in Mérida: 1,116 OSM road features, 176.5 ha hard exclusions, 171.4 ha net,
      3.7 m cells, about 10 s.
    - Nearest infrastructure returned in 36 s on the first call (cached afterwards).
- Pending: see docs/plans/phase-8.md §8A (planned items).
- Status: **Done** workbench core (draw, measure, terrain, contours, hydrology, visibility, constraints,
  envelope, design quantities, exports, audit log, observations).

## Definition of Done (§104) — actual status
| Item | Status | Evidence / note |
|---|---|---|
| Internal authenticated application | Done | Live at regenera.bio/os; route-guard test |
| Command with seeded data | Done | Browser: strip + 13 ranked items with demo data |
| Projects CRUD / Project Digital Record | Done | Existing + new Plan, Engineering, Materials, Procurement, Systems, Economics, Risk & E&S, claims panel |
| Relationships graph / warm paths | Done | tests/unit/graph.test.ts; browser |
| Capital profiles, mandates, explained matching | Done | Existing (phase 6 M2) |
| Funding pathways | Done | funding_pathways with eligibility, steps, deadlines (P14) |
| Capital stack builder | Done | Interactive builder with scenarios and comparison (P14) |
| Deals and stage gates | Done | Cumulative opportunity gates with audited override; /deals/[id] (P14) |
| Engagement / commercial records | Done | Contracts per engagement, fees, success-fee review flag |
| Atlas renders, layers toggle, site polygon | Done | Browser; P13 intelligence globe (docs/ATLAS.md) |
| Site Intelligence playbook runs | Done | Browser + test |
| Systems assessment | Done | Browser |
| Intelligence records / signals | Done | Existing Intelligence |
| Trigger engine | Done | tests/integration/events.test.ts |
| Evidence / provenance | Done | Claims + place-fact provenance; tests |
| Documents upload / extract / version | Partial | Registry and versions Done; file upload waits for R2; automatic extraction not built |
| Data rooms enforce access | Done | Portal tests |
| PDF / DOCX / contract template generation | Done | Document tests; browser downloads |
| Contract obligations | Done | Existing register |
| Playbook engine, definition-of-done checks, human approval states | Done | Playbook tests; browser |
| Compliance issues | Done | Regulatory, E&S, gates, distribution |
| Sponsor portal | Built | View model tested; page shares components with the browser-verified portals |
| Capital, broker, partner portals; referral registration; conflict checks; commissions | Done | Portal tests + browser |
| Portal security tests (§93–94) | Done | Server-enforced (no RLS on D1); tests/integration/portal.test.ts |
| Integration center; no-key integrations run; credential adapters show disconnected | Done | PVGIS and Copernicus STAC checked live; registry states |
| Search | Done | Existing Cmd+K (new entity types not yet indexed) |
| Notifications | Done | Events test; browser |
| Ask Regenera with AI / without AI | External / Done | Needs ANTHROPIC_API_KEY in production; degrades to unavailable without it |
| Audit logging | Done | Across approvals, access and changes |
| Demo data identifies itself | Done | tests/integration/demo.test.ts |
| No secrets committed | Done | .env.example names only |
| lint / typecheck / test / build | Done | `npm run ci` exit 0 (npm, not pnpm) |
| README, API_INTEGRATIONS, SECURITY, PORTALS, BUILD_CHECKLIST | Done | This commit |
| E2E browser tests (Playwright) | Not built | Flows verified manually in the browser each phase |

## Remaining external configuration (Prado)
Workers Paid (CPU); secrets (setup-secrets, OS_PASSWORD); R2 (file uploads, signed URLs); ANTHROPIC_API_KEY; provider
keys (EIA, NOAA, FIRMS, ENTSO-E, FRED, NREL, Companies House …); licences (Protected Planet, IBAT, PJM, Open-Meteo);
e-signature account if wanted; counsel review of every legal template before first use; revoke the Cloudflare API key
pasted earlier in chat.
