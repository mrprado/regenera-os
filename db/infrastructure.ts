// Registry-listed infrastructure (phase 21 §3): assets from published registries (WRI Global Power Plant Database
// first), kept apart from OSM-mapped features so Atlas can show the evidence class. One row per source record;
// source + sourceId is the identity, never merged with other sources here.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const registryAssets = sqliteTable("registry_assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),                 // wri_gppd, ...
  sourceId: text("source_id").notNull(),            // e.g. gppd_idnr
  kind: text("kind").notNull().default("generation"), // generation | storage | substation | line
  name: text("name").notNull(),
  country: text("country"),                         // ISO3
  fuel: text("fuel"),                               // Solar, Wind, Hydro, Gas, Coal, Oil, Nuclear, Biomass, Geothermal, Storage, ...
  capacityMw: real("capacity_mw"),
  commissioningYear: integer("commissioning_year"),
  owner: text("owner"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  url: text("url"),
  sourceOfRecord: text("source_of_record"),         // the registry's own cited source (e.g. national agency)
  vintage: text("vintage"),                          // dataset version / year
  retrievedAt: text("retrieved_at").notNull().default(now),
}, t => [uniqueIndex("registry_assets_source_id").on(t.source, t.sourceId), index("registry_assets_lat_lng").on(t.lat, t.lng), index("registry_assets_fuel").on(t.fuel)]);
