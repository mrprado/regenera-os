// Site briefs (Atlas Site Diagram Studio, 2D first): an annotated, comparable, exportable site diagram attached to a
// project or opportunity. Every annotation says what kind of content it is (measured, modeled, conceptual, field-observed
// or an open question) and what it rests on; scenarios share the same boundary, scale and rings so they compare; versions
// are kept, never overwritten. A brief records analysis inputs; it is not an engineering, energy-yield or legal finding.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const arr = <T>(name: string) => text(name, { mode: "json" }).$type<T[]>().notNull().default(sql`'[]'`);

export const CONTENT_CLASSES = { measured: "Measured", modeled: "Modeled", conceptual: "Conceptual", observed: "Field-observed", unknown: "Open question" } as const;
export type ContentClass = keyof typeof CONTENT_CLASSES;
export type BriefAnnotation = {
  id: string; scenarioId: string | null; kind: string; label: string; note: string; contentClass: ContentClass;
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] };
  evidence: string; source: string; by: string; at: string;
};
export type BriefScenario = { id: string; name: string; assumptions: string };
export type BriefLayer = { key: string; label: string; source: string; observedAt: string | null; tier: string };

export const siteBriefs = sqliteTable("site_briefs", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id"),
  dealId: text("deal_id"),
  title: text("title").notNull(),
  template: text("template").notNull(),                  // BRIEF_TEMPLATES
  boundary: text("boundary"),                            // GeoJSON (Polygon / MultiPolygon) or null
  crs: text("crs").notNull().default("EPSG:4326"),
  centerLat: real("center_lat").notNull(), centerLng: real("center_lng").notNull(),
  zoom: integer("zoom").notNull().default(14),
  rings: arr<number>("rings"),                            // distance rings in km from the center
  locationAccuracy: text("location_accuracy", { enum: ["boundary", "point", "approximate", "country"] }).notNull().default("point"),
  layers: arr<BriefLayer>("layers"),
  scenarios: arr<BriefScenario>("scenarios"),
  annotations: arr<BriefAnnotation>("annotations"),
  assumptions: text("assumptions").notNull().default(""),
  decisionId: text("decision_id"),                        // the decision this brief informs (project decision log)
  author: text("author").notNull(),
  version: integer("version").notNull().default(1),
  previousId: text("previous_id"),
  reviewStatus: text("review_status", { enum: ["draft", "in_review", "approved"] }).notNull().default("draft"),
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now),
}, t => [index("site_briefs_project").on(t.mandateId, t.projectId), index("site_briefs_deal").on(t.mandateId, t.dealId)]);
