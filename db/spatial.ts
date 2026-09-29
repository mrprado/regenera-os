// Imported spatial layers for Atlas (master build instruction §18–19, §91). Every layer carries provider, dates,
// licence, resolution, coverage, confidence; demo/sample layers say so. Features are served clipped to the viewport.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const LAYER_CATEGORIES = ["grid", "transmission", "substations", "solar", "wind", "land_use", "parcels", "topography", "roads", "ports", "water", "watersheds", "water_stress", "biodiversity", "protected_areas", "climate", "agriculture", "communities", "regulatory", "project_area", "other"] as const;

export const spatialLayers = sqliteTable("spatial_layers", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: LAYER_CATEGORIES }).notNull().default("other"),
  provider: text("provider").notNull().default(""),
  sourceDate: text("source_date"),
  retrievedAt: text("retrieved_at").notNull().default(now),
  license: text("license").notNull().default(""),
  resolution: text("resolution").notNull().default(""),
  coverage: text("coverage").notNull().default(""),
  confidence: text("confidence", { enum: ["high", "medium", "low", "unknown"] }).notNull().default("unknown"),
  projectId: text("project_id"),
  geojson: text("geojson").notNull(),
  featureCount: integer("feature_count").notNull(),
  west: real("west"), south: real("south"), east: real("east"), north: real("north"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("spatial_layers_mandate").on(t.mandateId, t.category), index("spatial_layers_bbox").on(t.west, t.east, t.south, t.north)]);

// ATLAS workbench (advanced geospatial extension): saved typed geometries, analysis runs (auditable: datasets,
// parameters, model version, grade) and field observations tied to coordinates.
export const FEATURE_PURPOSES = ["project_boundary", "parcel", "development_envelope", "conservation_area", "solar_array", "battery_storage", "substation", "building", "road", "transmission_route", "pipeline", "water_infrastructure", "restoration_area", "survey_area", "exclusion_zone", "buffer", "annotation", "custom"] as const;
export const VISIBILITY = ["private", "team", "project", "client", "partner", "public"] as const;
export const DATA_GRADES = ["screening", "preliminary", "validated", "engineering", "client_provided"] as const;

export const siteFeatures = sqliteTable("site_features", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  scenario: text("scenario").notNull().default(""),        // design scenario membership (e.g. "A — 100 MW")
  purpose: text("purpose", { enum: FEATURE_PURPOSES }).notNull().default("custom"),
  name: text("name").notNull().default(""),
  geometry: text("geometry").notNull(),                     // GeoJSON geometry, WGS84
  measures: text("measures", { mode: "json" }).$type<Record<string, number>>().notNull().default(sql`'{}'`),
  notes: text("notes").notNull().default(""),
  assumptions: text("assumptions", { mode: "json" }).$type<Record<string, string | number>>().notNull().default(sql`'{}'`),
  visibility: text("visibility", { enum: VISIBILITY }).notNull().default("team"),
  grade: text("grade", { enum: DATA_GRADES }).notNull().default("screening"),
  sourceAnalysisId: text("source_analysis_id"),
  west: real("west"), south: real("south"), east: real("east"), north: real("north"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("site_features_project").on(t.projectId), index("site_features_mandate").on(t.mandateId, t.purpose)]);

export const spatialAnalyses = sqliteTable("spatial_analyses", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  kind: text("kind").notNull(),                             // contours, profile, slope_filter, watershed, viewshed, cut_fill, envelope, nearest, suitability …
  title: text("title").notNull(),
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  datasets: text("datasets", { mode: "json" }).$type<{ source: string; resolution: string; date?: string; license?: string }[]>().notNull(),
  results: text("results", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  geometry: text("geometry"),                               // result geometry (GeoJSON), when small enough to keep
  grade: text("grade", { enum: DATA_GRADES }).notNull().default("screening"),
  limitation: text("limitation").notNull().default(""),
  modelVersion: text("model_version").notNull().default("atlas-workbench-1"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("spatial_analyses_project").on(t.projectId, t.createdAt), index("spatial_analyses_mandate").on(t.mandateId, t.kind)]);

export const OBSERVATION_CATEGORIES = ["observation", "issue", "access", "water", "vegetation", "soil", "infrastructure", "community", "hazard", "sample", "photo_point", "other"] as const;
export const fieldObservations = sqliteTable("field_observations", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  lng: real("lng").notNull(), lat: real("lat").notNull(),
  accuracyM: real("accuracy_m"),
  headingDeg: real("heading_deg"),
  category: text("category", { enum: OBSERVATION_CATEGORIES }).notNull().default("observation"),
  note: text("note").notNull(),
  mediaUrl: text("media_url"),                              // link (Drive/data room) until R2 uploads are enabled
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull().default("medium"),
  visibility: text("visibility", { enum: VISIBILITY }).notNull().default("team"),
  observedAt: text("observed_at").notNull().default(now),
  observer: text("observer").notNull(),
  convertedTo: text("converted_to"),                        // task:<id> / risk:<id> / constraint:<id>
  createdAt: text("created_at").notNull().default(now),
}, t => [index("field_observations_project").on(t.projectId, t.observedAt)]);

// Named ATLAS views (position, basemap, layers, mode) shared within the entity, e.g. "Yucatán ecological constraints".
export const atlasViews = sqliteTable("atlas_views", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  view: text("view").notNull(),                              // encodeView() string
  projectId: text("project_id"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
