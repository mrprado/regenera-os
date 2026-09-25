# Integration licensing

The live matrix is Settings → Integrations (source of truth: lib/integrations/registry.ts). Rules:

- A public API is not an unrestricted commercial API. Each source records: licence and URL, commercial use (yes,
  conditional, no, verify), attribution, caching, redistribution, credential, rate limit, refresh and source tier.
- Feature states: **Enabled**, **Development only** (built or planned, not used in production outputs yet),
  **Licence required** (never called until a licence exists: Open-Meteo commercial, Protected Planet, IBAT, EC3,
  OpenCorporates) and **Disabled** (e.g. SAM.gov, skipped).
- ODbL (OpenStreetMap): attribution "© OpenStreetMap contributors"; share-alike applies to derived databases we
  distribute. GBIF: per-record licences (CC0, CC BY, CC BY-NC); the OS stores aggregate counts only and never
  reproduces CC BY-NC records in commercial outputs.
- Fallback order when no API exists: official API → official bulk dataset → official feed → official file → manual
  verified entry → licensed provider. No unauthorized scraping as infrastructure.
- Entries marked "verify" are re-checked against the provider's current terms before any production use.
