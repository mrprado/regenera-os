# Integrations

Canonical spec: docs/master-spec.md parts LXVIII–LXXIV. Registry: lib/integrations/registry.ts (seeded into the
`integrations` table on every code version); licensing detail: docs/integration-licensing.md.

## Architecture
external source → adapter (lib/sources/*, lib/place/adapters.ts, lib/funding/sources.ts) → `fetchJson` (registry
gate, identification, timeout, retry with backoff, zod validation, cache, call ledger) → normalization and
provenance (source, tier, licence, retrieval date on every fact) → canonical tables → pages. No page component calls a
provider; everything runs through jobs or server actions.

- **Registry gate:** `fetchJson` refuses providers whose feature state is Disabled or Licence required. Owners can
  change a state in Settings → Integrations; a changed state survives reseeding.
- **Failure:** `staleOnError` returns the last cached copy when a source is down; the place profile keeps previous
  values, marks them stale and says "Source unavailable — showing values synchronized earlier".
- **Health:** Settings → Integrations shows, per provider, calls and failures in the last 24 hours, last success and
  last error (from `provider_calls`), whether its credential is set ("Integration ready: credential required"),
  licence, commercial use, attribution, caching, redistribution, rate limit and refresh.
- **Refresh cadence:** funding every 2 h; triggers every 15 min; place profiles daily sweep for projects whose facts
  are older than 30 days (3 per run); qualifications and permits daily expiry jobs.

## Place profile (M6)
Project → Place tab. From the project's coordinates and country: NASA POWER (solar resource, temperature,
precipitation, wind), World Bank Indicators (population, GDP per capita, electricity access, renewable share, water
stress, forest area, each dated), OpenStreetMap Overpass (substations, power lines, major roads, rivers and canals
nearby; nearest mapped substation), USGS (M5+ earthquakes within 200 km since 1990, largest event) and GBIF (recorded
occurrences, distinct species and IUCN threatened species within about 11 km, aggregate counts only). What the sources
cannot tell (ownership, zoning, soils, floodplain, protected areas under licence, communities, grid capacity) is
listed as open, never guessed.
