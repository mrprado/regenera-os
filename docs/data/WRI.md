# World Resources Institute in Regenera OS

WRI is registered as a **Tier 1 institutional data provider**. WRI data appears as provenance, not as a co-branded
product. It is one provider in the general framework (`lib/data-providers/`), which NASA, World Bank, Copernicus, FAO,
IRENA, government portals and future commercial providers use the same way.

## Architecture

```
Provider adapter (lib/data-providers/wri/*)
  → raw source (Resource Watch API, GFW Data API, Earth Engine asset, download, platform link)
  → normalization (RegeneraDataset in lib/data-providers/catalog.ts; datasets table for live state)
  → geospatial registry (Atlas layer ↔ dataset via atlasLayer)
  → site intelligence (water and ecology stages: lib/site-intel/engine.ts)
  → project risk / opportunity (screening flags: lib/data-providers/evidence.ts, site.ts)
  → capital / transaction workflow (impact attributes, mandate-alignment signal, data-sources block in exports)
```

Screens: Intelligence → Data catalogue (`/intelligence/data`), the WRI provider page (`/intelligence/data/wri`), the
Health tab (Regenera internal; also Settings → Data providers), Project 360 → Site & land → Environmental & spatial
screening, and the Atlas layer Source block.

## Platforms and status

| Platform | Adapter | Access | Key | Status rule |
|---|---|---|---|---|
| Aqueduct 4.0 (water risk) | `aqueduct.ts` via `resource-watch.ts` | Resource Watch dataset search + SQL point query | none | Connected only after a real resolve or query succeeds |
| Aqueduct Floods | Earth Engine asset `WRI/Aqueduct_Flood_Hazard_Maps/V2` (verify version) | Earth Engine | Earth Engine service account | External until Earth Engine is configured |
| Global Forest Watch | `global-forest-watch.ts` | Data API zonal query over the boundary | `GFW_API_KEY` (free) | "API available · key needed" until set |
| Resource Watch | `resource-watch.ts` | Public catalogue and query API | none | Connected after a sync |
| Land & Carbon Lab | GFW Data API (same adapter); some downloads | Data API / download | `GFW_API_KEY` | As GFW; downloads are "Download only" |
| Energy Access Explorer | `energy-access-explorer.ts` (metadata, opportunity panel) | Platform | n/a | External source: no public query API is wired |
| WRI Data Explorer | catalogue link | Platform | n/a | External source |

No adapter returns fixture data in production. When a call fails, site intelligence writes an explicit
"Unavailable: … Source link: …" line and the dataset's failure count rises (Health tab).

## Environment variables

- `GFW_API_KEY`: Global Forest Watch Data API (free registration at data-api.globalforestwatch.org). Server-side only.
- Resource Watch and Aqueduct via Resource Watch need **no key**. `RESOURCE_WATCH_API_KEY` and `WRI_API_KEY` are not read
  by any adapter.
- Earth Engine (optional): `EARTH_ENGINE_SERVICE_ACCOUNT`, `EARTH_ENGINE_PROJECT_ID` (lib/providers/earth-engine.ts).

## Licensing and attribution

WRI datasets are mostly CC BY 4.0: commercial use and derivatives are allowed with attribution. Concession layers,
Resource Watch third-party datasets and Energy Access Explorer country layers carry their source's licence and are
marked **Verify** (`null`) until checked. Exports run `exportCheck()`: datasets without redistribution rights are cited,
never packaged raw. Attribution text is stored per dataset and printed in the Data sources block.

## Update cadence

- Resource Watch metadata: on sync (WRI page → Sync now), cached 7 days.
- Point and polygon queries: on site-intelligence runs, cached 30 days per location.
- Health: "Stale" after 45 days without a success; "Failing" after 3 consecutive failures.

## Known limitations and diligence caveats

- Aqueduct values are sub-basin averages. **Not project-level hydrological proof**: local hydrological, water-rights and
  regulatory diligence is always required.
- Tree cover loss includes plantation harvest and fire; tree cover is not natural forest.
- Concession maps are not legal tenure records.
- Energy access indicators from the World Bank are country-level.
- Every WRI value is Level 1 evidence (global screening). See EVIDENCE_LEVELS.md.

## Adding a WRI dataset

1. Add a `RegeneraDataset` row to `lib/data-providers/catalog.ts` (licence fields, role, limitations, evidence level).
2. On Resource Watch: set `adapter: "resource_watch"` and `externalId` to the search phrase; Sync resolves the id.
3. On the GFW Data API: set `adapter: "gfw"` and the dataset slug; add a query function next to `treeCoverLoss`.
4. To draw in Atlas: add the layer to `lib/map/catalog.ts` and `PROVENANCE`, then set `atlasLayer` on the dataset.
5. `tests/unit/data-providers.test.ts` checks every dataset has provenance, licence fields, a role and a limitation.

## Troubleshooting

- "No Resource Watch dataset matched": the dataset name changed upstream; update `externalId`.
- "Dataset has no queryable table": the Resource Watch record is not SQL-backed; use its source link or a download.
- "GFW_API_KEY not set": add the Worker secret (`wrangler secret put GFW_API_KEY`).
- Calls blocked: check Settings → Integrations for the `resource_watch` and `gfw` feature states.
