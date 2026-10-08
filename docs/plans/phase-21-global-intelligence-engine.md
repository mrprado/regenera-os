# Phase 21 — Global intelligence infrastructure and the autonomous execution engine

Source: the founder's "Global API & Data Integration Master Registry" and "From Connected Dashboard to Autonomous
Operating System" briefs (2026-10-08). The briefs ask for Phase 0 (diagnose production) first, then the two critical
workstreams (visible infrastructure in Atlas, verified global funding) and one complete vertical loop before widening.
This plan follows that order. Status: **awaiting approval**.

## Phase 0 — production diagnosis (done 2026-10-08, live D1 + job ledger, read-only)

What exists and runs:
- 89 sources in the integration registry, 30 Atlas layers, a jobs table with schedules, retries and dead-letter
  status, an events dispatcher (1,132 runs / 7 days), provider_calls ledger, ontology + claims + evidence (phase 19).
- Funding ingestion works: 511 opportunities (Grants.gov 241, World Bank 118, EU Funding & Tenders 77, TED 40,
  UK Contracts Finder 35); last pulls within the past few hours. 31 funding-to-organization matches.
- 608 organizations; identity enrichment (GLEIF, Wikidata) and geocoding ran on ~495 of them.

**Where the pipeline stops (root causes):**

| # | Stop | Evidence | Effect |
|---|---|---|---|
| 1 | **Anthropic credit balance exhausted** | `funding.read` 74 dead, `triggers.classify` 16 dead, `reports.weekly` 3 dead, `funding.draft` 1 dead — all "Your credit balance is too low" | Funding calls are fetched but never read for eligibility/amount/sector, so matching starves; news/registry signals are stored but never become triggers (1 trigger in total); weekly reports stop. This is the main reason the OS "references data but does no work". |
| 2 | Every AI step is a hard gate | triggers are created only after classification; funding matching runs on the AI read | When AI is unavailable, deterministic work that needs no AI also stops. |
| 3 | Projects have no locations | 18 projects, 0 located | Atlas project layer, site checks, grid proximity and hazard screening have nothing to run on. |
| 4 | Infrastructure is picture-only | "Power grid" is OpenInfraMap raster tiles | Lines/substations are visible but not queryable, not inspectable and not usable in distance analysis. |
| 5 | Flaky sources fail silently | GDELT 85/484 ok (rate limit), GLEIF 179/527, SPP queue 0/90 (HTTP 522), OFAC 0/5 (HTTP 525) | Dead jobs are listed in Settings → Jobs only; Command shows nothing. |
| 6 | Claims table empty in production | 0 claims | The RA-ESG extraction has not been applied on live; evidence-backed fields are not yet in use. |

**Founder action (no code can fix it):** add credit at console.anthropic.com → Billing. After that, dead AI jobs
are re-queued (§1.3).

## Stack decision (no change)

- Keep Cloudflare Workers + D1 + R2 + the D1 jobs table. The jobs table already gives durable, idempotent,
  retried, dead-lettered work with dedupe keys; adding an events ledger on top gives the brief's event model.
- **Not adding** PostGIS, Temporal or LangGraph: Workers cannot host Temporal workers, and D1 + bbox-indexed
  feature tables + turf (already used in lib/spatial) cover screening-grade spatial work. If parcel-scale analytics
  outgrow this, a PostGIS service is a later, separately approved stack change.
- No paid service is activated in this phase. Tier 3 sources are registered as "license required" only.

## Scope

### 1. Unblock the pipeline (Phase 0 fixes)
1. **Deterministic fallbacks.** Signals become triggers by rules (source type + keyword families + entity match)
   marked `classified: rules`; AI classification upgrades them later. Funding gets a rules read (sector, country,
   amount, deadline from structured fields) so matching runs without AI; AI read upgrades it.
2. **AI budget awareness.** A credit/budget error pauses AI job types for an hour instead of burning retries to dead,
   raises one owner notification, and shows "AI paused: credit" on Command.
3. **Re-queue dead jobs** (owner button in Settings → Jobs, per type) once the cause is fixed.
4. **Source backoff.** GDELT spaced to its published rate; SPP/OFAC errors classified (upstream down vs our fault),
   OFAC falls back to the Treasury mirror URL; three consecutive failures → source marked degraded, visible.

### 2. Global source registry (machine-readable, honest)
- Extend `lib/integrations/registry.ts` entries with: access method (REST/GraphQL/STAC/WFS/WMS/OGC Features/bulk/
  RSS/commercial/manual), auth, rate limit, pricing tier (1 public · 2 regional/country · 3 commercial · 4 research),
  license + redistribution + attribution, freshness, incremental sync, spatial form, identifiers, ontology objects,
  dependencies and priority.
- Add every source named in the master registry (≈300) as **candidate** with documented access classification.
  Status ladder: candidate → documented → tested (a real authorized call succeeded) → ingesting → reaching records.
  Nothing is "connected" without a successful call; no scraping where reuse is restricted.
- Licensing flags carried through to the UI: e.g. WDPA non-commercial, IUCN, Earth Engine commercial terms,
  OpenSanctions, Electricity Maps, IEA, Convergence, PitchBook/Preqin.

### 3. Atlas: real, queryable infrastructure (workstream 01)
- `infra_features` table (bbox-indexed geometry, kind, attributes, source, source id, evidence class, retrieved at).
- **Evidence classes shown on every feature:** OSM-mapped · registry-listed (GEM / WRI GPPD / EIA / national)
  · modeled corridor · utility-confirmed. Never merged into one "transmission" truth.
- Connectors (free, documented):
  - OSM Overpass by viewport for lines ≥ 69 kV, substations and plants (cached per tile, ODbL attribution).
  - Global Energy Monitor trackers (solar, wind, coal, gas, hydro, storage; CC BY 4.0 downloads) → generation assets.
  - WRI Global Power Plant Database (CC BY 4.0) → generation assets (historic baseline, flagged as 2021 vintage).
  - U.S. EIA-860 plants (free key) and HIFLD transmission (public layers) for the U.S.
  - ENTSO-E transparency (free token) for European generation/cross-border flows.
  - Global Solar Atlas / Global Wind Atlas resource tiles (CC BY 4.0) and NREL where keyed.
- Environmental layers made inspectable: HydroBASINS/HydroRIVERS (free, attribution), Aqueduct (have), GFW (have),
  WDPA (non-commercial: shown with the restriction; commercial use needs IBAT, already registered).
- Click any feature → attributes, source link, licence, evidence class, retrieval date; "distance from project".
- **Place the 18 projects**: approximate placement from municipality/country (marked approximate), then site checks.

### 4. Global funding discovery (workstream 02)
- Opportunity **category** is first-class: open call · tender/procurement · upcoming · award/contract (historical)
  · institutional investment disclosure (historical) · programme (standing facility). Awards and past DFI
  investments are never shown as available money; they feed the developer/sponsor graph instead.
- New connectors (documented, free): IATI Datastore v3 (free subscription key), USAspending awards, SAM.gov
  opportunities (free key), UNGM notices (if the developer API grants access; otherwise RSS), World Bank procurement
  notices vs contract awards split, AfDB/ADB/EBRD/EIB/IDB/GCF/GEF project + procurement feeds where an open dataset,
  API or RSS exists (each documented in the registry; HTML pages are not scraped).
- Each record: source id + URL, category, status, financier, issuer, eligible geography, sector, amount + currency,
  instrument, deadline (**verified / unverified** flag), eligibility text, required documents, last verified.
- Deduplicate across sources; link to projects and commercial mandates by hard gates (geography, sector, applicant
  type, deadline) before any score; every match explains passes, exclusions and unknowns.

### 5. Development ecosystem graph (workstream 03, first slice)
- From World Bank/IATI/TED/USAspending awards and GEM owners: create or resolve organizations (GLEIF / registry ids
  first), with dated typed roles (owner, sponsor, implementing agency, EPC, consultant, financier) via the phase-19
  relations. No inferred financing needs; no fabricated contacts.

### 6. The autonomous loop (one vertical, end to end)
Event ledger `intel_events` (type, subject, source record, idempotency key, caused-by, status) on the jobs table.
Implemented loop — **World Bank / IATI infrastructure project → OS**:
1. Discover record → 2. dedupe against projects → 3. create/update project (claims `source_provided`, page/URL)
→ 4. resolve sponsor / implementing agency / financier orgs with roles → 5. place (exact only if coordinates exist,
else approximate) → 6. run site checks (grid distance from §3, hazards, water, protected areas)
→ 7. match programmes, funding calls and capital profiles (hard gates first) → 8. generate a **screening memo**
(deterministic figures; AI narrative marked preliminary) saved to Documents with versions
→ 9. record gaps/questions → 10. create a next-action task and, where a contact exists, a draft for the approval
queue (never sent) → 11. surface on Command, Projects, Capital, Atlas → 12. monitor the source for changes; a
material change marks dependent assessments stale and re-runs them.
Autonomy levels as in the brief: 1–3 automatic (audited, preliminary), 4–5 always approval. Existing gates (send gate,
sanctions, protected parties, counsel review, owner-only capital data) stay authoritative.

### 7. Command: "work the OS did"
From persisted events only: records created/enriched, assessments run, matches proposed, memos generated, approvals
waiting, errors and degraded sources, AI spend this month, stale assessments. No demo activity in production.

### 8. Integration Health console
Per connector: status, last sync, last success, records discovered/added/updated/merged, valid geometries, features
rendered, failed calls, credential expiry, licence restriction, coverage gaps, next run, and **records reaching a
downstream workflow** (a connector is not healthy otherwise).

## Not in this phase (later phases, same architecture)
Earth-observation processing (Copernicus openEO/STAC analytics), agriculture/soil suitability models, waste feedstock
& offtake model, carbon registries, research/patents, Microsoft Graph/Notion/Slack, regional procurement portals
(Compranet, ChileCompra, eTenders, AusTender …) beyond registry entries, financial-analyst scenarios beyond the existing
screening model. Mexico-specific (INEGI, RAN, CONAGUA, CENACE) registered as Tier 2 candidates.

## Cost (monthly, estimated)
- Data: $0 (all Tier 1/2 free; keys: IATI, SAM.gov, EIA, ENTSO-E, NREL — founder registers, free).
- Cloudflare: within Workers Paid; D1 growth ~50–150 MB for infra features (tile-cached, viewport-limited).
- Anthropic: the loop uses Haiku for extraction and Sonnet only for memos; expected $30–120/month at current volume,
  capped by AI_MONTHLY_BUDGET_USD. Rules-first design means AI outages degrade quality, not throughput.
- Tier 3 (not activated): Electricity Maps, Planet/Maxar, PitchBook, Preqin, Convergence, Earth Engine commercial,
  OpenCorporates, NewsAPI/Event Registry — each needs explicit approval.

## Definition of done (demonstrated on os.regenera.bio)
1. Atlas shows real transmission lines/substations/plants for a chosen country; a feature opens with attributes,
   source, licence and evidence class; layers toggle; coverage gaps are visible.
2. Funding search by sector + geography; open calls clearly separated from awards; original source opens.
3. A World Bank/IATI project flows through §6 with **no manual entry**, ending in a saved memo, linked orgs with
   roles, matches with reasons, and a task awaiting decision; re-ingesting a changed record marks it stale and re-runs.
4. Interrupting the loop mid-way and resuming creates no duplicates and no repeated external action.
5. Command and Integration Health show real counts, errors and last syncs; AI-paused state is visible.
6. Unit + integration tests per connector (fixtures of real responses), browser checks, deploy version + rollback.
Completion report lists: already working · repaired · newly integrated · verified in production · partial ·
blocked by licence/authorization · still to build.
