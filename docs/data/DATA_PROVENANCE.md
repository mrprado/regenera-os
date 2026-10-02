# Data provenance

Every value Regenera shows from outside data carries where it came from. One schema, used everywhere.

## Dataset record

`RegeneraDataset` (lib/data-providers/types.ts), mirrored in the `datasets` table:

provider · platform · dataset name · dataset id · version · category / subcategory · source type (api, tiles, download,
earth-engine, manual) · source URL · API URL · tile URL · download URL · Earth Engine asset · geography · spatial and
temporal resolution / coverage · scenarios · licence and licence URL · commercial use · derivative use · redistribution ·
caching · attribution required and text · methodology URL · evidence level · screening only · local validation
required · analytical role · limitations · applicability (screening / development / investment).

Live state in the table: connection, resolved provider id, the provider's last update, last sync, last success,
failures, last error, schema hash, deprecated. Sync history: `dataset_sync_jobs`. Project links:
`project_dataset_links`. Flags: `project_screening_flags`. Evidence-backed attributes and claims: `project_attributes`.

## Values in use

- Site-intelligence facts (`StageFact`) carry `datasetId`, the `source` text and, for machine use, `data`.
- Atlas layers show a Source block: provider, platform, dataset, version, resolution, period, licence, analytical role,
  limitation (lib/map/provenance.ts + the dataset record).
- AI answers distinguish observed data, model-derived signal, Regenera inference and analyst conclusion
  (`SourcedValue.kind`).
- Reports, memos and site-intelligence exports end with a **Data sources** block (`dataSourcesBlock()`): dataset,
  citation, version, date accessed, licence, methodology, analytical limitation, and whether raw data is redistributed.

## Read fallback

Live → Cached → Last known → Source link only → Unavailable. The mode travels with the value. Original sources are
never overwritten by an AI interpretation: funding call text, dataset values and documents are kept as retrieved.
