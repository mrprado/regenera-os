// Institutional data providers (docs/data/WRI.md, docs/data/DATA_PROVENANCE.md). The dataset registry mirrors
// lib/data-providers/catalog.ts and adds live state: connection, last sync, failures, the provider's own dataset id
// once resolved. Project links, screening flags and evidence-backed impact attributes point at datasets by id.
// Global reference data (providers, datasets, sync jobs) has no workspace; project rows belong to the project's.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { RegeneraDataset } from "../lib/data-providers/types";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const dataProviders = sqliteTable("data_providers", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  tier: integer("tier").notNull(),
  licenseReviewedBy: text("license_reviewed_by"),
  licenseReviewedAt: text("license_reviewed_at"),
  ...timestamps,
});

export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey(),                           // catalogue id, e.g. wri.aqueduct.baseline_water_stress
  provider: text("provider").notNull(),
  platform: text("platform"),
  name: text("name").notNull(),
  category: text("category").notNull(),
  record: text("record", { mode: "json" }).$type<RegeneraDataset>().notNull(),   // catalogue snapshot (licence, role, limits)
  connection: text("connection").notNull().default("not_connected"),              // CONNECTION key, computed from real results
  resolvedRef: text("resolved_ref"),                                               // provider dataset id found by a sync
  providerUpdatedAt: text("provider_updated_at"),                                  // the provider's own last update
  lastSyncedAt: text("last_synced_at"),
  lastSuccessAt: text("last_success_at"),
  failures: integer("failures").notNull().default(0),
  lastError: text("last_error"),
  schemaHash: text("schema_hash"),                                                 // detects a changed upstream schema
  deprecated: integer("deprecated", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, t => [index("datasets_provider").on(t.provider, t.platform)]);

export const datasetSyncJobs = sqliteTable("dataset_sync_jobs", {
  id: id(),
  datasetId: text("dataset_id").notNull(),
  status: text("status", { enum: ["ok", "failed", "skipped"] }).notNull(),
  detail: text("detail").notNull().default(""),
  newRecords: integer("new_records").notNull().default(0),
  startedAt: text("started_at").notNull().default(now),
  finishedAt: text("finished_at"),
}, t => [index("dataset_sync_jobs_dataset").on(t.datasetId, t.startedAt)]);

export const projectDatasetLinks = sqliteTable("project_dataset_links", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  datasetId: text("dataset_id").notNull(),
  role: text("role").notNull().default("screening"),        // screening | development | investment
  ...timestamps,
}, t => [uniqueIndex("project_dataset_links_pair").on(t.projectId, t.datasetId)]);

/** §11 Automated screening flags. Observations with sources, never legal conclusions. */
export const projectScreeningFlags = sqliteTable("project_screening_flags", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  flag: text("flag").notNull(),                               // SCREENING_FLAGS key
  observed: text("observed").notNull(),                       // what the data shows
  implication: text("implication").notNull().default(""),     // potential risk / opportunity (inference)
  diligence: text("diligence").notNull().default(""),         // what must be checked locally
  datasetId: text("dataset_id"),
  value: text("value"),
  evidenceLevel: integer("evidence_level").notNull().default(1),
  confidence: text("confidence").notNull().default("screening"),
  status: text("status", { enum: ["open", "reviewed", "dismissed"] }).notNull().default("open"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note").notNull().default(""),
  ...timestamps,
}, t => [uniqueIndex("project_screening_flags_key").on(t.projectId, t.flag), index("project_screening_flags_project").on(t.projectId)]);

/** §12, §23 (Built environment) Evidence-backed impact / ESG attributes and sustainability claims. */
export const projectAttributes = sqliteTable("project_attributes", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  subjectType: text("subject_type").notNull().default("project"),   // project | company | technology | material
  subjectId: text("subject_id"),
  attribute: text("attribute").notNull(),                          // IMPACT_ATTRIBUTES key or claim type
  claim: text("claim").notNull(),
  source: text("source").notNull(),
  methodology: text("methodology").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  datasetId: text("dataset_id"),
  scope: text("scope").notNull().default(""),
  confidence: text("confidence").notNull().default("unknown"),
  verification: text("verification").notNull().default("unverified"),   // CLAIM_STATES
  verifier: text("verifier"),
  claimDate: text("claim_date"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("project_attributes_project").on(t.projectId), index("project_attributes_subject").on(t.subjectType, t.subjectId)]);
