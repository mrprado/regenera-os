// Steward source register, fetch log and persisted source records (docs/plans/phase-28-steward-ecosystem.md, 28B).
// The register is global reference data (no workspace); fetches and records belong to the place's workspace.
// Health is kept apart from freshness: "last checked", "last successful fetch", "latest observation" and the
// provider's release are separate fields, and retrieval time is never used as observation time.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const stewardSources = sqliteTable("steward_sources", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(), name: text("name").notNull(), region: text("region").notNull().default("global"),
  homepage: text("homepage").notNull(), docsUrl: text("docs_url").notNull().default(""), accessMethod: text("access_method").notNull(), // api | download | reference | manual | licensed
  serviceUrl: text("service_url"), geographicCoverage: text("geographic_coverage").notNull().default(""), temporalCoverage: text("temporal_coverage").notNull().default(""),
  variables: text("variables").notNull().default(""), resolution: text("resolution").notNull().default(""), cadence: text("cadence").notNull().default(""),
  datasetVersion: text("dataset_version").notNull().default(""), licenseName: text("license_name").notNull().default(""), licenseUrl: text("license_url").notNull().default(""),
  // Three separate rights, each: allowed | conditional | prohibited | unknown | license_required
  commercialUse: text("commercial_use").notNull().default("unknown"), redistribution: text("redistribution").notNull().default("unknown"), aiProcessing: text("ai_processing").notNull().default("unknown"),
  attribution: text("attribution").notNull().default(""), auth: text("auth").notNull().default("none"), quotas: text("quotas").notNull().default(""),
  coverageLimits: text("coverage_limits").notNull().default(""), support: text("support").notNull().default(""),
  // Health: unverified | verified | credential_required | license_required | unsupported | unavailable | failing
  health: text("health").notNull().default("unverified"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(false), blockedReason: text("blocked_reason").notNull().default(""),
  verifiedAt: text("verified_at"), verificationNote: text("verification_note").notNull().default(""),
  lastCheckedAt: text("last_checked_at"), lastSuccessAt: text("last_success_at"), latestObservation: text("latest_observation"),
  refreshDays: integer("refresh_days").notNull().default(30),             // application policy, not the provider's cadence
  updatedAt: text("updated_at").notNull().default(now),
});

/** Every query made for a place, including ones that failed or found nothing: the context is kept, never a silent zero. */
export const stewardSourceFetches = sqliteTable("steward_source_fetches", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(), sourceKey: text("source_key").notNull(),
  query: json<Record<string, unknown>>("query").notNull(),
  state: text("state").notNull(),                                       // DATA_STATES key
  startedAt: text("started_at").notNull().default(now), finishedAt: text("finished_at"),
  httpStatus: integer("http_status"), recordCount: integer("record_count").notNull().default(0), newCount: integer("new_count").notNull().default(0),
  revisedCount: integer("revised_count").notNull().default(0), excludedCount: integer("excluded_count").notNull().default(0),
  latestObservation: text("latest_observation"), limitations: text("limitations").notNull().default(""), error: text("error"),
  payloadHash: text("payload_hash"), transformVersion: text("transform_version").notNull().default("1"), actor: text("actor").notNull(),
}, t => [index("steward_source_fetches_place").on(t.placeId, t.sourceKey, t.startedAt)]);

/** Source observations persisted for a place. One row per provider record; a changed record is a revision, not a duplicate. */
export const stewardSourceRecords = sqliteTable("steward_source_records", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(), placeId: text("place_id").notNull(), sourceKey: text("source_key").notNull(),
  recordId: text("record_id").notNull(),                                // provider identity, or a deterministic fingerprint
  fingerprint: text("fingerprint").notNull(), contentHash: text("content_hash").notNull(), revision: integer("revision").notNull().default(1),
  title: text("title").notNull(), value: text("value"), unit: text("unit").notNull().default(""),
  observedStart: text("observed_start"), observedEnd: text("observed_end"), publishedAt: text("published_at"), retrievedAt: text("retrieved_at").notNull(),
  geometry: json<Record<string, unknown>>("geometry"), precisionM: integer("precision_m"), resolution: text("resolution").notNull().default(""),
  method: text("method").notNull().default(""), qualityFlags: json<string[]>("quality_flags"), uncertainty: text("uncertainty").notNull().default(""),
  license: text("license").notNull().default(""), sourceUrl: text("source_url").notNull().default(""), datasetVersion: text("dataset_version").notNull().default(""),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false), // obscured / generalised by the provider
  payload: json<Record<string, unknown>>("payload"), fetchId: text("fetch_id").notNull(), reviewStatus: text("review_status").notNull().default("unreviewed"),
  firstSeenAt: text("first_seen_at").notNull().default(now), lastSeenAt: text("last_seen_at").notNull().default(now),
}, t => [uniqueIndex("steward_source_records_identity").on(t.placeId, t.sourceKey, t.recordId), index("steward_source_records_place").on(t.placeId, t.sourceKey)]);
