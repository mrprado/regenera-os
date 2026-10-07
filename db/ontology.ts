// Canonical ontology v1.0 and the records the founder's gap review found missing (docs/plans/phase-19-ontology-data-fabric.md).
// Additive only. Mandate-scoped tables carry mandate_id and are read through lib/db/scoped.ts; sanctions_lists is a
// system table (public list data shared by every workspace).
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ALIAS_SCHEMES, CONFIDENCE, EQUIPMENT_CATEGORIES, EQUIPMENT_STATUS, LAND_CONTROL_TYPES, LEVELS_3, MATCH_KINDS, QUEUE_RELATIONS, RIGHT_STATES,
  SANCTIONS_REVIEW, STAKEHOLDER_CATEGORIES, STAKEHOLDER_POSITIONS, TITLE_EVIDENCE,
} from "../lib/ontology/taxonomies";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

/** Identity resolution: one Regenera record, many names and external identifiers. A (scheme, value) pair belongs to
 *  one record per workspace, so a second record claiming the same LEI is caught instead of silently duplicated. */
export const entityAliases = sqliteTable("entity_aliases", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type").notNull(),            // lib/ontology/entities key
  entityId: text("entity_id").notNull(),
  scheme: text("scheme", { enum: keys(ALIAS_SCHEMES) }).notNull(),
  value: text("value").notNull(),
  normalized: text("normalized").notNull(),
  source: text("source").notNull().default("manual"),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [
  uniqueIndex("entity_aliases_identifier").on(t.mandateId, t.scheme, t.normalized),
  index("entity_aliases_entity").on(t.entityType, t.entityId),
]);

/** Public sanctions lists (OFAC SDN + aliases, UK, EU, UN), stored as compact JSON parts so a refresh is a few
 *  dozen writes, not tens of thousands. Each entry: [listId, name, kind, programme, country]. */
export const sanctionsLists = sqliteTable("sanctions_lists", {
  list: text("list").notNull(),
  part: integer("part").notNull(),
  entries: text("entries", { mode: "json" }).$type<[string, string, string, string, string][]>().notNull(),
  entryCount: integer("entry_count").notNull(),
  sourceDate: text("source_date"),
  refreshedAt: text("refreshed_at").notNull().default(now),
}, t => [uniqueIndex("sanctions_lists_part").on(t.list, t.part)]);

/** One screening of one record's name. A possible match is a flag for a person, never an automatic decision. */
export const sanctionsChecks = sqliteTable("sanctions_checks", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type").notNull(),            // organization | person
  entityId: text("entity_id").notNull(),
  name: text("name").notNull(),
  result: text("result", { enum: ["clear", "possible_match"] }).notNull(),
  matches: text("matches", { mode: "json" }).$type<{ list: string; listId: string; name: string; kind: string; programme: string; country: string; score: number; how: string }[]>().notNull().default(sql`'[]'`),
  listsChecked: text("lists_checked", { mode: "json" }).$type<{ list: string; entries: number; refreshedAt: string }[]>().notNull().default(sql`'[]'`),
  review: text("review", { enum: keys(SANCTIONS_REVIEW) }),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  reviewNote: text("review_note").notNull().default(""),
  checkedBy: text("checked_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("sanctions_checks_entity").on(t.mandateId, t.entityType, t.entityId, t.createdAt)]);

/** Project stakeholder register (influence / interest / position). Governed community matters stay in db/community.ts;
 *  a stakeholder can point at a community record instead of copying it. */
export const stakeholders = sqliteTable("stakeholders", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: keys(STAKEHOLDER_CATEGORIES) }).notNull().default("other"),
  orgId: text("org_id"),
  contactId: text("contact_id"),
  communityId: text("community_id"),
  relationship: text("relationship").notNull().default(""),
  influence: text("influence", { enum: keys(LEVELS_3) }).notNull().default("medium"),
  interest: text("interest", { enum: keys(LEVELS_3) }).notNull().default("medium"),
  position: text("position", { enum: keys(STAKEHOLDER_POSITIONS) }).notNull().default("unknown"),
  consentRequired: integer("consent_required", { mode: "boolean" }).notNull().default(false),
  consultationRequired: integer("consultation_required", { mode: "boolean" }).notNull().default(false),
  commitments: text("commitments").notNull().default(""),
  lastEngagementAt: text("last_engagement_at"),
  nextAction: text("next_action").notNull().default(""),
  nextActionDue: text("next_action_due"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("stakeholders_project").on(t.mandateId, t.projectId)]);

/** Canonical equipment (a make and model), linked to projects through project_equipment. */
export const equipment = sqliteTable("equipment", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  category: text("category", { enum: keys(EQUIPMENT_CATEGORIES) }).notNull(),
  manufacturer: text("manufacturer").notNull(),
  manufacturerOrgId: text("manufacturer_org_id"),
  model: text("model").notNull(),
  rating: real("rating"),
  ratingUnit: text("rating_unit"),                      // W, kW, MW, kWh, MVA …
  countryOfOrigin: text("country_of_origin"),
  certifications: text("certifications").notNull().default(""),
  leadTimeWeeks: integer("lead_time_weeks"),
  warrantyYears: real("warranty_years"),
  bankable: integer("bankable", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull().default(""),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("equipment_category").on(t.mandateId, t.category)]);

export const projectEquipment = sqliteTable("project_equipment", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  equipmentId: text("equipment_id").notNull(),
  quantity: real("quantity"),
  status: text("status", { enum: keys(EQUIPMENT_STATUS) }).notNull().default("considered"),
  price: real("price"),
  currency: text("currency"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("project_equipment_project").on(t.mandateId, t.projectId)]);

/** Land control per parcel. Replaces any "land secured" yes/no with what is actually held, and on what evidence. */
export const landControls = sqliteTable("land_controls", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  parcelRef: text("parcel_ref").notNull().default(""),
  areaHa: real("area_ha"),
  controlType: text("control_type", { enum: keys(LAND_CONTROL_TYPES) }).notNull().default("none"),
  counterparty: text("counterparty").notNull().default(""),
  counterpartyOrgId: text("counterparty_org_id"),
  termMonths: integer("term_months"),
  startsOn: text("starts_on"),
  expiresOn: text("expires_on"),
  extension: text("extension").notNull().default(""),
  titleEvidence: text("title_evidence", { enum: keys(TITLE_EVIDENCE) }).notNull().default("none"),
  encumbrances: integer("encumbrances"),
  rightsOfWay: text("rights_of_way", { enum: keys(RIGHT_STATES) }).notNull().default("unknown"),
  waterRights: text("water_rights", { enum: keys(RIGHT_STATES) }).notNull().default("unknown"),
  mineralRights: text("mineral_rights", { enum: keys(RIGHT_STATES) }).notNull().default("unknown"),
  legalConfidence: text("legal_confidence", { enum: keys(CONFIDENCE) }).notNull().default("low"),
  documentId: text("document_id"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("land_controls_project").on(t.mandateId, t.projectId)]);

/** A project's link to a public interconnection-queue position (queue_projects key). */
export const projectQueueLinks = sqliteTable("project_queue_links", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  queueKey: text("queue_key").notNull(),
  relation: text("relation", { enum: keys(QUEUE_RELATIONS) }).notNull().default("own_position"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("project_queue_links_unique").on(t.projectId, t.queueKey)]);

/** One reusable match shape for project ↔ organization: the criteria met and failed, never a bare score. */
export const ontologyMatches = sqliteTable("ontology_matches", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  kind: text("kind", { enum: keys(MATCH_KINDS) }).notNull(),
  orgId: text("org_id").notNull(),
  met: text("met", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  failed: text("failed", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  unknown: text("unknown", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  status: text("status", { enum: ["suggested", "shortlisted", "dismissed"] }).notNull().default("suggested"),
  decidedBy: text("decided_by"),
  ...timestamps,
}, t => [uniqueIndex("ontology_matches_unique").on(t.projectId, t.kind, t.orgId)]);

/** Permit dependencies: the permitting critical path (permit B cannot be filed before permit A is approved). */
export const permitDependencies = sqliteTable("permit_dependencies", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  projectId: text("project_id").notNull(),
  permitId: text("permit_id").notNull(),
  dependsOnId: text("depends_on_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [uniqueIndex("permit_dependencies_unique").on(t.permitId, t.dependsOnId)]);
