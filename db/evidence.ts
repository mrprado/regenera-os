// Claims and evidence (master build instruction §24, §74). A claim is a statement about an entity with a status; its
// evidence rows say where it comes from. AI inference never becomes Verified without non-AI evidence and a named
// verifier (lib/evidence/engine.ts). Temporal validity lets the OS answer "what was true on date X".
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const CLAIM_STATUSES = ["verified", "source_provided", "calculated", "ai_inferred", "assumption", "unverified", "disputed"] as const;
export const CLAIM_TYPES = ["fact", "metric", "assumption", "forecast", "legal", "technical", "commercial"] as const;
export const EVIDENCE_METHODS = ["document", "api", "registry", "site_visit", "interview", "calculation", "ai", "other"] as const;

export const claims = sqliteTable("claims", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type").notNull(),          // project, organization, capital_opportunity, deal …
  entityId: text("entity_id").notNull(),
  statement: text("statement").notNull(),
  claimType: text("claim_type", { enum: CLAIM_TYPES }).notNull().default("fact"),
  field: text("field"),                               // e.g. "capacity", "land_control"
  value: text("value"),
  unit: text("unit"),
  status: text("status", { enum: CLAIM_STATUSES }).notNull().default("unverified"),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  verifiedBy: text("verified_by"),
  verifiedAt: text("verified_at"),
  supersededById: text("superseded_by_id"),
  createdBy: text("created_by").notNull(),
  ...timestamps,
}, t => [index("claims_entity").on(t.entityType, t.entityId, t.status)]);

export const claimEvidence = sqliteTable("claim_evidence", {
  id: id(),
  claimId: text("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default(""),
  sourceId: text("source_id"),
  sourceUrl: text("source_url"),
  documentId: text("document_id"),
  documentPage: text("document_page"),
  section: text("section"),
  excerpt: text("excerpt").notNull().default(""),
  retrievedAt: text("retrieved_at"),
  sourceDate: text("source_date"),
  rawHash: text("raw_hash"),
  method: text("method", { enum: EVIDENCE_METHODS }).notNull(),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull().default("medium"),
  license: text("license"),
  addedBy: text("added_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("claim_evidence_claim").on(t.claimId)]);
