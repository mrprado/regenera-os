// Prospecting compliance: campaigns (purpose, jurisdictions, recipients, channel, capital / securities flags, data
// sources) with computed activity class, permission state, risk tier and a legal brief; a jurisdiction-rule registry
// (authoritative source, effective date, counsel review); and contact preferences (opt-outs, legal hold).
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CAMPAIGN_STATUS, COUNSEL_STATUS, PREFERENCE_STATUS, RULE_TOPICS } from "../lib/compliance/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'[]'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));
const bool = (name: string) => integer(name, { mode: "boolean" }).notNull().default(false);

export const campaigns = sqliteTable("campaigns", {
  id: id(), mandateId: text("mandate_id").notNull(), name: text("name").notNull(), service: text("service").notNull().default(""), purpose: text("purpose").notNull().default(""),
  countries: json<string[]>("countries"), recipientTypes: json<string[]>("recipient_types"), channel: text("channel").notNull().default("email"),
  commercial: integer("commercial", { mode: "boolean" }).notNull().default(true), capitalRelated: bool("capital_related"), securitiesRelated: bool("securities_related"), successFee: bool("success_fee"),
  maOrAssetSale: bool("ma_or_asset_sale"), partnership: bool("partnership"), research: bool("research"),
  dataSources: json<string[]>("data_sources"), cta: text("cta").notNull().default(""), sequenceId: text("sequence_id"),
  status: text("status", { enum: keys(CAMPAIGN_STATUS) }).notNull().default("draft"),
  assessment: json<Record<string, unknown>>("assessment", "'{}'"), approvedBy: text("approved_by"), approvedAt: text("approved_at"), approvalNote: text("approval_note").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now),
}, t => [index("campaigns_mandate").on(t.mandateId, t.status)]);

export const jurisdictionRules = sqliteTable("jurisdiction_rules", {
  id: id(), mandateId: text("mandate_id").notNull(), jurisdiction: text("jurisdiction").notNull(), topic: text("topic", { enum: keys(RULE_TOPICS) }).notNull(),
  summary: text("summary").notNull(), requirements: text("requirements").notNull().default(""), optOut: text("opt_out").notNull().default(""), disclosures: text("disclosures").notNull().default(""),
  recipientScope: text("recipient_scope").notNull().default(""), sourceUrl: text("source_url").notNull(), sourceTitle: text("source_title").notNull().default(""),
  effectiveDate: text("effective_date"), lastReviewed: text("last_reviewed"), counselStatus: text("counsel_status", { enum: keys(COUNSEL_STATUS) }).notNull().default("not_reviewed"), counsel: text("counsel").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(now),
}, t => [index("jurisdiction_rules_j").on(t.jurisdiction, t.topic)]);

export const contactPreferences = sqliteTable("contact_preferences", {
  id: id(), mandateId: text("mandate_id").notNull(), contactId: text("contact_id"), email: text("email"), orgId: text("org_id"),
  status: text("status", { enum: keys(PREFERENCE_STATUS) }).notNull(), channel: text("channel").notNull().default("all"), jurisdiction: text("jurisdiction").notNull().default(""),
  reason: text("reason").notNull().default(""), recordedBy: text("recorded_by").notNull(), recordedAt: text("recorded_at").notNull().default(now), liftedAt: text("lifted_at"),
}, t => [index("contact_preferences_contact").on(t.contactId), index("contact_preferences_email").on(t.email)]);
