// Generated documents and e-signature envelopes (master build instruction §27–30). Legal documents stay "DRAFT —
// COUNSEL REVIEW REQUIRED" until an owner records counsel's approval; versions are never overwritten.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const generatedDocuments = sqliteTable("generated_documents", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  templateKey: text("template_key").notNull(),
  title: text("title").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  values: text("values", { mode: "json" }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  previousId: text("previous_id"),
  legal: integer("legal", { mode: "boolean" }).notNull().default(false),
  legalReviewStatus: text("legal_review_status", { enum: ["pending", "approved", "not_required"] }).notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  confidential: integer("confidential", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("generated_documents_entity").on(t.entityType, t.entityId), index("generated_documents_mandate").on(t.mandateId, t.createdAt)]);

export const esignEnvelopes = sqliteTable("esign_envelopes", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  generatedId: text("generated_id").notNull(),
  provider: text("provider").notNull(),             // mock, docusign, dropbox_sign, adobe_sign, upload
  providerRef: text("provider_ref"),
  status: text("status", { enum: ["created", "sent", "completed", "declined", "voided"] }).notNull().default("created"),
  recipients: text("recipients", { mode: "json" }).$type<{ name: string; email: string; role: string; signedAt?: string | null }[]>().notNull(),
  signedDocumentUrl: text("signed_document_url"),
  events: text("events", { mode: "json" }).$type<{ at: string; event: string; by: string }[]>().notNull().default(sql`'[]'`),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [index("esign_envelopes_doc").on(t.generatedId)]);
