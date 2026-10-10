// Pinned items (docs/plans/phase-25-pinned-items.md): up to six records a person keeps one click away in the header.
// Personal navigation only: never shown to others, never read by Ask, MCP or search. Access is re-checked on every read.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { PIN_TYPES } from "../lib/pins/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const pinnedItems = sqliteTable("pinned_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userEmail: text("user_email").notNull(),
  mandateId: text("mandate_id").notNull(),
  entityType: text("entity_type", { enum: keys(PIN_TYPES) }).notNull(),
  entityId: text("entity_id").notNull(),
  label: text("label").notNull(),          // cached name; the tray shows the current one
  href: text("href").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
}, t => [
  uniqueIndex("pinned_items_user_entity").on(t.userEmail, t.entityType, t.entityId),
  index("pinned_items_user").on(t.userEmail, t.position),
]);
