// Institutional data-provider framework (docs/data/DATA_PROVENANCE.md, docs/data/EVIDENCE_LEVELS.md). Client-safe.
// Every dataset Regenera uses is described once, with its licence and analytical role, so ATLAS layers, site
// intelligence, exports and AI answers all cite the same record. Nothing here claims live connectivity: status is
// computed from adapter configuration and the last real sync.

export const DATA_CATEGORIES = {
  water: "Water", forest: "Forest", land: "Land", ecology: "Ecology", energy: "Energy", community: "Community", climate: "Climate", agriculture: "Agriculture",
  infrastructure: "Infrastructure", air: "Air quality", population: "Population", economy: "Economy", regulatory: "Regulatory", built: "Built environment",
} as const;
export type DataCategory = keyof typeof DATA_CATEGORIES;

/** §2 Connection states as shown to people. */
export const CONNECTION = {
  connected: { label: "Connected", note: "An adapter has returned data from this dataset." },
  api_available: { label: "API available", note: "A public or keyed API exists and an adapter is written; not yet synced or queried successfully." },
  download_only: { label: "Download only", note: "Distributed as files; metadata and source link are kept." },
  external: { label: "External source", note: "Viewed on the provider's platform; Regenera keeps metadata and the link." },
  not_connected: { label: "Not yet connected", note: "Registered for provenance; no adapter yet." },
} as const;
export type Connection = keyof typeof CONNECTION;

/** §18 Fallback of a single read, shown next to any value. */
export const READ_MODES = { live: "Live", cached: "Cached", last_known: "Last known", source_link: "Source link only", unavailable: "Unavailable" } as const;
export type ReadMode = keyof typeof READ_MODES;

/** §9 Evidence hierarchy. */
export const EVIDENCE_LEVELS = {
  1: { label: "Level 1 · Global screening", use: "Opportunity screening, site prioritization, portfolio comparison, preliminary risk" },
  2: { label: "Level 2 · Jurisdictional diligence", use: "Permitting, development assessment, legal / regulatory diligence" },
  3: { label: "Level 3 · Project-specific evidence", use: "Investment diligence, IC review, financing, closing" },
} as const;
export type EvidenceLevel = keyof typeof EVIDENCE_LEVELS;

/** §17 The normalized dataset record. */
export interface RegeneraDataset {
  id: string;
  provider: string;                 // provider key
  platform?: string;                // platform key within the provider
  name: string;
  category: DataCategory;
  subcategory?: string;
  sourceType: "api" | "tiles" | "download" | "earth-engine" | "manual";
  adapter?: string;                 // lib/data-providers adapter key; absent = metadata only
  externalId?: string;              // provider dataset id or slug
  sourceUrl: string;
  apiUrl?: string;
  tileUrl?: string;
  downloadUrl?: string;
  earthEngineAsset?: string;
  version?: string;
  geography: string;
  spatialResolution?: string;
  temporalCoverage?: string;
  scenarios?: string[];
  license: string;
  licenseUrl?: string;
  commercialUse: boolean | null;    // null = verify
  redistribution: boolean | null;
  derivatives: boolean | null;
  cacheAllowed: boolean | null;
  attributionRequired: boolean;
  attributionText: string;
  methodologyUrl?: string;
  evidenceLevel: EvidenceLevel;
  screeningOnly: boolean;
  localValidationRequired: boolean;
  analyticalRole: string;
  limitations: string[];
  applicability: ("screening" | "development" | "investment")[];
  envVar?: string;                  // credential, server-side only
  atlasLayer?: string;              // lib/map catalog key when drawn in Atlas
  atlasGroup?: string;              // §15 layer library group
}

export type DataProvider = {
  key: string; name: string; tagline: string; tier: 1 | 2 | 3 | 4 | 5; kind: "institutional" | "government" | "scientific" | "open_community" | "commercial";
  url: string; platforms: { key: string; name: string; url: string; note: string }[];
};

/** A value read from a dataset, carrying its provenance everywhere it goes (site intel, exports, AI). */
export type SourcedValue = {
  label: string; value: string; datasetId: string; provider: string; platform?: string; version?: string; mode: ReadMode; retrievedAt: string | null;
  kind: "observed" | "modelled" | "inference" | "conclusion"; evidenceLevel: EvidenceLevel; limitation?: string;
};
