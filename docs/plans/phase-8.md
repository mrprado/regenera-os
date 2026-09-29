# Phase 8: Master build specification v2 (workspace OS)

2026-09-29. Prado pasted "REGENERA OS — MASTER BUILD SPECIFICATION" (95 sections, originally written with ChatGPT) and said
"Continue". It supersedes the earlier UX direction and keeps the underlying Regenera logic.

The standing rules still apply:
- Never Supabase.
- No Tailwind (CSS Modules and tokens).
- LinkedIn is never scraped.
- Additive migrations only.
- Ask before paid services or stack changes.
- The OS never fabricates data, and never calls anything compliant or verified without a named review.

This plan maps every section onto the existing Cloudflare Worker, D1 and Drizzle stack.

## Decisions for Prado (not built until approved)

| # | Spec asks for | Why it needs approval | What is built meanwhile |
|---|---|---|---|
| D1 | PostgreSQL + PostGIS, Supabase (§52, §76) | Stack change; Supabase never | D1 + GeoJSON + server-side bbox clipping (already live); geo services behind `/api/geo/*` so a PostGIS backend can replace it later |
| D2 | Cesium + Google Photorealistic 3D Tiles (§8, §9, §52) | New renderer (stack change); Google 3D Tiles is metered and Cesium ion's free tier is non-commercial | MapLibre 2D/3D switch (terrain, extrusions, tilt) keeping selection, layers and camera; a provider seam for a Cesium view |
| D3 | Google Earth Engine / AlphaEarth `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL` (§11–12, §53) | Commercial Earth Engine use needs a paid, registered Cloud project; a service-account key becomes a Worker secret | Full adapter + `/api/geo/{analyze,change,classify,similarity,restoration,baseline,monitor}` returning NOT CONNECTED with the exact credential needed; derived-output cache table |
| D4 | TanStack Table / Query (§76) | New dependencies; the spec also asks to avoid bloat | Own `DataTable` primitive (sticky header, sort, column choice, saved views in localStorage, keyboard) |
| D5 | Configurable deal stages (§30) | Opportunity stages mirror the regenera.bio tracker (vocabulary rule) | A separate transaction pipeline for capital-mandate deals (Prospect → Closing) configured per entity, alongside the tracker stage |

## Build order (this phase)

1. **Shell (§4–5, §59, §61, §79–80).**
   - Light workspace with a 64 px global rail: Command, Atlas, Projects, Capital, Deals, Network, Intelligence, Documents; Automations, Integrations and Settings at the bottom; labels appear on hover or focus.
   - A context sidebar per module, collapsible and remembered.
   - A compact top bar with the command palette.
   - An `Inspector` primitive, and the keyboard shortcuts Ctrl+K, Ctrl+/ and Esc.
   - Tokens only from `styles/tokens.css`; neutrals are derived with `color-mix`.
2. **Command (§6, §87, §89):**
   - Three temporal bands (Today, Pipeline, Horizon) in lines and tables, not cards.
   - Each item links to its project, contact, investor or decision.
3. **Development Engine (§23):**
   - Gates G0 to G9 map onto project stages.
   - Each gate lists its required studies, documents, technical, legal, permit, capital and stakeholder requirements and approvals, all evaluated against records (✓ met, △ partial, ! missing).
   - Blockers are shown on the project, on Command and on the deal.
4. **Capital (§24–27, §29, §91):**
   - A capital workspace with pipeline, capital gaps and structures.
   - A value / revenue stack beside the capital stack.
   - Capital continuum by stage.
   - "What prevents the next capital event" gap analysis with next milestone, gap, action, owner and date.
   - Matching explained with reasons, conflicts and evidence.
5. **System Fit (§13–14, §18):**
   - Structured conclusions (best fit, alternatives, hybrid, no-development case, constraints, risks, studies, permitting, partners, capital path, environmental value, sequence) with confidence and evidence counts; never a single score.
   - Resource quality from place facts (PVGIS, NASA POWER).
   - Project optimum versus system optimum.
6. **Environmental markets and EVA (§15–17):**
   - Feasibility across legal, technical, social, financial and integrity dimensions.
   - Revenue tagged High / Moderate / Speculative / Not eligible; speculative revenue never enters base cases.
7. **Geo services and AlphaEarth adapter (§11–12, §51, §53–54):** see D3.
8. **Records the spec names that do not exist yet:**
   - Decision log on projects and deals (the `decisions` table is extended).
   - Meetings with agenda, notes, decisions and follow-ups.
   - Jurisdiction intelligence with statement types (legal fact, regulatory guidance, market practice, analyst inference) and source, date and confidence.
   - Outcomes with evidence and methodology.
   - Service templates.
   - Coalition builder (who controls, approves, funds, builds, buys, operates, verifies, benefits, could block).
   - An internal system status page.
9. **Atlas (§7, §10, §41–42, §81, §90):**
   - Layer library regrouped into the spec's hierarchy (each layer shows "NOT CONNECTED" or "PLANNED" where there is no source).
   - Light analytical basemap by default, with a dark map mode.
   - Spatial command bar (search, scenario, compare, 2D/3D).
   - Natural-language spatial queries translated into visible layers and filters.

## Already built (kept)

Portals (§46–49); evidence and claims (§37); documents, generator and data rooms (§35, §70); playbooks, automations and triggers (§50); relationship graph and warm paths (§31); capital stack scenarios and funding pathways (§25); opportunity stage gates; Atlas live layers; demo entity (§94); security, audit and RBAC scaffolding (§65, §84).

Validation: unit and integration tests per engine, route guard, lint, typecheck, build, browser verification.
BUILD_CHECKLIST.md records actual status.

## Extensions received 2026-09-29 (same conversation)

### 8A: ATLAS geospatial workbench (advanced geospatial, site analysis and map workbench)

Built in P15:
- Modes: Site analysis, Design, Compare, Monitor, beside Explore (Layers).
- Drawing:
  - Tools: point, line, polygon, rectangle, circle.
  - Coordinate entry in decimal, DMS or UTM, and bearing + distance entry.
  - Measures in metric and imperial units: area, perimeter, length, bearing, and WGS84/UTM readout.
- Terrain engine on the ~30 m terrain tiles, in the browser (`lib/geo/dem.ts`):
  - elevation and slope statistics
  - contours at 0.5–50 m with major and minor lines and labels; export to GeoJSON/KML/CSV/DXF in WGS84 or UTM
  - slope and elevation threshold areas
  - cut/fill screening
  - elevation profile, with a bottom tray chart and CSV export
  - watershed delineation (depression fill, D8, accumulation) with a truncation warning
  - site hydrology (drainage lines, ponding areas)
  - viewshed and line of sight
- Server:
  - nearest infrastructure from OSM, never inferring grid capacity (known or unknown)
  - OSM constraint screening
  - development envelope on a bounded raster with a distance-transform buffer (site − hard = net, plus soft overlap)
  - buffers and boolean operations
  - exports
- Records:
  - Saved typed features (project boundary, envelope, solar array …) with visibility and grade.
  - An auditable analysis log (datasets, parameters, grade, limitation, model version).
  - Field observations that convert to a task or risk.
- Design objects: screening quantities and a cost table filled only with unit costs you enter and their sources.
- Grades are visible on every result: SCREENING / PRELIMINARY / VALIDATED / ENGINEERING / CLIENT-PROVIDED.

Planned or requiring data:
- Wind and hydro resource screening.
- Water balance, flood depth, soils and erosion (need climate and soil datasets).
- Weighted suitability surfaces.
- Route and corridor optimisation.
- Parcels and cadastre (country sources).
- Land assembly.
- Shapefile/GeoPackage/GeoTIFF import.
- Map composer and site report map pack (PDF).
- Swipe comparison between imagery years, and Earth Engine change detection (D3).
- Present mode.
- Spatial comments and permissions.
- Natural-language spatial queries translated into visible operations.

### 8B: Financial modeling, underwriting and project finance

Build on `lib/economics/model.ts`:
- assumption register (value, unit, source, date, owner, confidence, verification)
- model versions and locked cases
- development budget and capex line items linked to workbench quantities
- revenue streams tagged contracted / forecast / merchant / speculative
- CFADS, DSCR sizing and sculpting, LLCR/PLCR
- sources = uses
- waterfall
- sensitivities, tornado, breakevens, stress cases
- value bridge
- model health checks
- lender, equity and IC outputs; XLSX export

Decimal-safe arithmetic, with unit tests for IRR, NPV, debt sizing, DSCR, waterfall, escalation, FX and tax.

### 8C: Commercial operations

Service catalogue:
- The spec's families, each at SCREEN / ASSESS / EXECUTE depth.
- Billing types.
- Internal default price bands, marked as internal defaults, not market facts.

Also:
- scope builder
- proposals (existing generator) and engagements (lifecycle, deliverables, change orders, time, expenses, margin)
- MSA + SOW
- vendors and partners
- billing and invoice states, with reminders as notifications
- profitability by service
- a Settings → Accounts registry (the existing integration registry extended with owner, entity, environment, cost and renewal)
- corporate entities

External systems stay adapters, each NOT CONNECTED until a credential is supplied:
- Stripe
- QuickBooks / Xero
- DocuSign
- banking
- KYC
