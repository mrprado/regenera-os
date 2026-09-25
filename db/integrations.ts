// Integration registry, sources, verifications and place facts (docs/plans/phase-6.md M5–M6).
// Global reference data (integrations, sources) has no entity; place facts belong to a project's entity.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const integrations = sqliteTable("integrations", {
  key: text("key").primaryKey(),              // matches provider_calls.provider
  provider: text("provider").notNull(),
  dataset: text("dataset").notNull(),
  category: text("category").notNull(),
  coverage: text("coverage").notNull().default(""),
  baseUrl: text("base_url").notNull().default(""),
  auth: text("auth").notNull().default("none"),
  envVar: text("env_var"),
  license: text("license").notNull(),
  licenseUrl: text("license_url"),
  commercialUse: text("commercial_use").notNull(),
  attribution: text("attribution").notNull().default(""),
  caching: text("caching").notNull().default(""),
  redistribution: text("redistribution").notNull().default(""),
  rateLimit: text("rate_limit").notNull().default(""),
  refresh: text("refresh").notNull().default(""),
  featureState: text("feature_state", { enum: ["enabled", "development_only", "license_required", "disabled"] }).notNull(),
  stateOverridden: integer("state_overridden", { mode: "boolean" }).notNull().default(false),   // an owner changed it; the seed leaves it alone
  sourceTier: integer("source_tier").notNull(),
  notes: text("notes").notNull().default(""),
  ...timestamps,
});

export const sources = sqliteTable("sources", {
  id: id(),
  type: text("type", { enum: ["government", "regulator", "multilateral", "utility", "sponsor", "developer", "engineer", "counsel", "api", "research", "regenera", "media", "social"] }).notNull(),
  organization: text("organization").notNull().default(""),
  title: text("title").notNull(),
  url: text("url"),
  documentId: text("document_id"),
  tier: integer("tier").notNull(),
  publishedAt: text("published_at"),
  retrievedAt: text("retrieved_at"),
  effectiveAt: text("effective_at"),
  expiresAt: text("expires_at"),
  jurisdiction: text("jurisdiction"),
  license: text("license"),
  integrationKey: text("integration_key"),
  ...timestamps,
}, t => [index("sources_integration").on(t.integrationKey)]);

/** A fact about a project's place (land, water, climate, ecology, human, infrastructure), always with its source. */
export const placeFacts = sqliteTable("place_facts", {
  id: id(),
  projectId: text("project_id").notNull(),
  mandateId: text("mandate_id").notNull(),
  dimension: text("dimension", { enum: ["land", "water", "climate", "ecology", "human", "infrastructure"] }).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  numeric: real("numeric"),
  unit: text("unit"),
  integrationKey: text("integration_key").notNull(),
  sourceUrl: text("source_url"),
  tier: integer("tier").notNull(),
  state: text("state", { enum: ["api_derived", "verified", "estimated", "stale", "conflicting"] }).notNull().default("api_derived"),
  license: text("license"),
  observedFor: text("observed_for"),     // the period or year the value describes
  retrievedAt: text("retrieved_at").notNull(),
  ...timestamps,
}, t => [uniqueIndex("place_facts_unique").on(t.projectId, t.key), index("place_facts_project").on(t.projectId, t.dimension)]);

/** Verification of a material fact on any record (principle: every fact knows its source). */
export const verifications = sqliteTable("verifications", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  field: text("field").notNull(),
  sourceId: text("source_id"),
  state: text("state", { enum: ["known", "unknown", "estimated", "sponsor_provided", "api_derived", "verified", "stale", "conflicting"] }).notNull(),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }),
  value: text("value"),
  verifiedBy: text("verified_by"),
  verifiedAt: text("verified_at"),
  nextVerification: text("next_verification"),
  ...timestamps,
}, t => [index("verifications_entity").on(t.entity, t.entityId, t.field)]);
