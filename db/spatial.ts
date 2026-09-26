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
