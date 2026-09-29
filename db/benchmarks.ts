// Technology library and cost benchmarks with full provenance. Benchmarks are never compared blindly: each carries
// currency, base year, price basis, scale, country and scope (included / excluded), and is normalised on read.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { BENCH_CONFIDENCE, MATURITY, PRICE_BASIS, SOURCE_QUALITY, TECH_CATEGORIES } from "../lib/benchmarks/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'[]'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));

export const technologies = sqliteTable("technologies", {
  id: id(), mandateId: text("mandate_id").notNull(), key: text("key").notNull(), name: text("name").notNull(),
  category: text("category", { enum: keys(TECH_CATEGORIES) }).notNull(), description: text("description").notNull().default(""),
  maturity: text("maturity", { enum: keys(MATURITY) }).notNull().default("mature"), trl: integer("trl"), typicalScale: text("typical_scale").notNull().default(""), usefulLifeYears: real("useful_life_years"),
  efficiency: text("efficiency").notNull().default(""), inputs: json<string[]>("inputs"), outputs: json<string[]>("outputs"),
  waterIntensity: text("water_intensity").notNull().default(""), landIntensity: text("land_intensity").notNull().default(""), energyIntensity: text("energy_intensity").notNull().default(""),
  technicalRisks: text("technical_risks").notNull().default(""), financingAvailability: text("financing_availability").notNull().default(""), geographicConstraints: text("geographic_constraints").notNull().default(""),
  certifications: text("certifications").notNull().default(""), suppliers: text("suppliers").notNull().default(""), source: text("source").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now),
}, t => [uniqueIndex("technologies_key").on(t.mandateId, t.key)]);

export const costBenchmarks = sqliteTable("cost_benchmarks", {
  id: id(), mandateId: text("mandate_id").notNull(), technology: text("technology").notNull(), metric: text("metric").notNull(),
  value: real("value").notNull(), currency: text("currency"), baseYear: integer("base_year"), priceBasis: text("price_basis", { enum: keys(PRICE_BASIS) }).notNull().default("nominal"),
  country: text("country"), region: text("region").notNull().default(""), scaleValue: real("scale_value"), scaleUnit: text("scale_unit").notNull().default(""),
  project: text("project").notNull().default(""), projectId: text("project_id"), included: text("included").notNull().default(""), excluded: text("excluded").notNull().default(""),
  source: text("source").notNull(), sourceUrl: text("source_url"), sourceDate: text("source_date"), sourceQuality: text("source_quality", { enum: keys(SOURCE_QUALITY) }).notNull().default("secondary"),
  confidence: text("confidence", { enum: keys(BENCH_CONFIDENCE) }).notNull().default("moderate"), notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), deletedAt: text("deleted_at"),
}, t => [index("cost_benchmarks_tech").on(t.technology, t.metric)]);
