// Intelligence depth: signal assessments (interpretation, per-dimension relevance, related objects, actions and
// outcomes), layered mandate evidence, theses, and watches. Everything links to canonical organizations / contacts.
import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { EVIDENCE_LAYERS, SIGNAL_TYPES, THESIS_THEMES, WATCH_KINDS } from "../lib/intelligence/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'[]'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));
const meta = { createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type RelevanceItem = { dimension: string; rating: string; reason: string; evidence: string; confidence: string; by: "derived" | "person" | "ai" };
export type SignalAction = { id: string; action: string; status: string; owner: string | null; note: string; outcome: string; at: string };
export type Interpretation = { whatChanged: string; whyItMatters: string; affectedSectors: string; affectedGeographies: string; implications: string };
export type Classification = { sector?: string; subsector?: string; geography?: string; transactionType?: string; capitalType?: string; technology?: string; policyRelevance?: string; projectStage?: string };

export const signalAssessments = sqliteTable("signal_assessments", {
  id: id(), mandateId: text("mandate_id").notNull(), triggerId: text("trigger_id").notNull(),
  signalType: text("signal_type", { enum: keys(SIGNAL_TYPES) }).notNull().default("other"),
  classification: json<Classification>("classification", "'{}'"), interpretation: json<Interpretation>("interpretation", "'{}'"),
  relevance: json<RelevanceItem[]>("relevance"), related: json<{ projectIds: string[]; profileIds: string[]; contactIds: string[]; services: string[] }>("related", `'{"projectIds":[],"profileIds":[],"contactIds":[],"services":[]}'`),
  actions: json<SignalAction[]>("actions"), learning: text("learning").notNull().default(""), reviewedBy: text("reviewed_by"), ...meta,
}, t => [uniqueIndex("signal_assessments_trigger").on(t.triggerId)]);

export const mandateEvidence = sqliteTable("mandate_evidence", {
  id: id(), mandateId: text("mandate_id").notNull(), profileId: text("profile_id").notNull(),
  layer: text("layer", { enum: keys(EVIDENCE_LAYERS) }).notNull(), field: text("field").notNull(), statement: text("statement").notNull(),
  source: text("source").notNull().default(""), sourceUrl: text("source_url"), date: text("date"), confidence: text("confidence").notNull().default("moderate"),
  transactionRef: text("transaction_ref").notNull().default(""), triggerId: text("trigger_id"), verifiedAt: text("verified_at"), ...meta,
}, t => [index("mandate_evidence_profile").on(t.profileId, t.layer)]);

export const theses = sqliteTable("theses", {
  id: id(), mandateId: text("mandate_id").notNull(), orgId: text("org_id"), contactId: text("contact_id"), profileId: text("profile_id"),
  theme: text("theme", { enum: keys(THESIS_THEMES) }).notNull(), thesis: text("thesis").notNull(), evidence: text("evidence").notNull().default(""), sourceUrl: text("source_url"), date: text("date"),
  sectors: json<string[]>("sectors"), geography: text("geography").notNull().default(""), implications: text("implications").notNull().default(""), contradictions: text("contradictions").notNull().default(""),
  relatedTransactions: text("related_transactions").notNull().default(""), interpretation: text("interpretation").notNull().default(""), ...meta,
}, t => [index("theses_org").on(t.orgId)]);

export const watches = sqliteTable("watches", {
  id: id(), mandateId: text("mandate_id").notNull(), kind: text("kind", { enum: keys(WATCH_KINDS) }).notNull(),
  orgId: text("org_id"), contactId: text("contact_id"), sourceKey: text("source_key"), label: text("label").notNull(),
  reason: text("reason").notNull().default(""), owner: text("owner"), events: json<string[]>("events"), lastReviewedAt: text("last_reviewed_at"), active: text("active").notNull().default("yes"), ...meta,
}, t => [index("watches_mandate").on(t.mandateId, t.kind)]);
