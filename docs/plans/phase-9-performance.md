# Phase 9 — Performance architecture and ATLAS experience

Source: "Performance architecture, live interaction model and ATLAS / map experience" prompt (2026-09-29).
Rule: everything may be connected in the data model; nothing loads at once. ATLAS keeps maximum practical spatial
fidelity and solves performance architecturally; every other screen optimises aggressively for speed.

## Stack mapping (standing rules win: no Supabase, no Tailwind, no paid services or stack changes without approval)

| Prompt suggests | Regenera OS uses | Why |
|---|---|---|
| Supabase Realtime / WebSockets | Server-Sent Events from the Worker for job completion and alerts | No Supabase, ever |
| Tailwind + shadcn/ui | CSS Modules + tokens (house rule) | Design-system rule |
| PostgreSQL + PostGIS | D1 (SQLite) with bbox columns + indexes, Turf / raster analysis in the Worker and browser; PostGIS stays a later, approved migration (D1 in phase-8 plan) | No paid services / stack change for now |
| Redis | Worker Cache API + `source_cache` table with validity metadata | Already live, free |
| Trigger.dev / Inngest / Temporal / BullMQ | Existing durable D1 job queue + cron tick (claim, retry, backoff) | Already live, free |
| Typesense / Meilisearch / OpenSearch | Existing search (lib/search.ts); D1 FTS5 index when volume requires | Free; no extra service |
| TanStack Query / Virtual | Server components + streaming; own virtualised table primitive (D4 in phase-8 plan) | Avoid new dependencies unless approved |
| Sentry / OpenTelemetry | Worker logs + `provider_calls` ledger + client Web Vitals beacon to the OS | Sentry registry entry stays NOT CONNECTED |
| Cesium / deck.gl | MapLibre 6 GPU globe + terrain + extrusions (live); Cesium / deck.gl only loaded inside ATLAS if added | Never loaded outside ATLAS |

## Audit findings (2026-09-29)

- ATLAS dependencies (maplibre-gl, satellite.js, d3-contour) are imported only under `app/(app)/map` → other routes do not ship them. Keep it that way (tested).
- No `loading.tsx` / `error.tsx` anywhere → navigation waits for every server query and one failing module blanks the page. Fix: route-group skeleton + per-module error boundaries (ATLAS, projects, capital, community, power, commercial).
- Today (Command) runs ~15 query groups before first byte → stream sections with Suspense.
- Large lists (companies, people, triggers) are server-paginated; check the long tables without limits.
- Site intelligence runs inline in server actions (land-cover baseline, GBIF plants) → move to the job queue with progressive status.

## Build order

1. Loading skeletons and module error boundaries (done first).
2. Command streaming (Suspense sections) and cached counts.
3. ATLAS: layer metadata (source, date, resolution, licence, confidence) in the panel; per-layer failure isolation; persisted and named saved views; LOD rules per layer group; community / knowledge layers generalised and permission-gated.
4. Site intelligence as a background job with staged progress (queued → spatial → energy → grid → water → ecology → land → infrastructure → climate → community → regulatory → finance) and progressive panel population; precomputed metrics refreshed on geometry change.
5. Freshness metadata surfaced in the UI (source timestamp, retrieved, valid until).
6. Performance tests (1k / 10k projects, 100k contacts) and a bundle-isolation test.
