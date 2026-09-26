# Data sources

- Provider list, licences, authentication, rate limits, refresh, fallback, environment variables and status:
  [API_INTEGRATIONS.md](API_INTEGRATIONS.md) (generated from the registry).
- Licensing principles and states (Enabled, Development only, Licence required, Disabled): [integration-licensing.md](integration-licensing.md).
- Provenance (source tiers, claims, verification, freshness): [source-provenance.md](source-provenance.md) and [PLAYBOOKS.md](PLAYBOOKS.md).
- Place profile facts (NASA POWER, PVGIS, World Bank, OpenStreetMap, USGS, GBIF; FIRMS with a key) keep provider, tier,
  licence, period, retrieval date and stale state; gaps are listed as unknowns, never estimated.
- Imported spatial layers (Atlas) carry provider, source and retrieval dates, licence, resolution, coverage and
  confidence; demo layers say DEMO / SAMPLE DATA.
- Not used: LinkedIn scraping; public Nominatim beyond low-volume cached use; Protected Planet / IBAT / PJM / Open-Meteo
  without a licence; SoilGrids REST (paused); Google Places/Solar (paid, off).
