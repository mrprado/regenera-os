// Manual relationship edges (master build instruction §14). Most edges are derived from existing records (contacts at
// organizations, introductions, project and contract parties, bids, mailbox relationships); this table holds the ones
// only a person knows (founded, owns, advises, invested in, partnered with, financed, met at, referred, knows).
import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const EDGE_TYPES = ["works_at", "founded", "owns", "advises", "introduced_by", "invested_in", "partnered_with", "financed", "develops", "supplies", "contracts_with", "referred", "met_at", "knows"] as const;

export const relationshipEdges = sqliteTable("relationship_edges", {
  id: id(),
  mandateId: text("mandate_id").notNull(),
  fromType: text("from_type", { enum: ["person", "organization", "project"] }).notNull(),
  fromId: text("from_id").notNull(),
  toType: text("to_type", { enum: ["person", "organization", "project"] }).notNull(),
  toId: text("to_id").notNull(),
  type: text("type", { enum: EDGE_TYPES }).notNull(),
  strength: real("strength").notNull().default(0.5),     // 0–1, as judged by the person recording it
  since: text("since"),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default("manual"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("relationship_edges_from").on(t.fromType, t.fromId), index("relationship_edges_to").on(t.toType, t.toId)]);
