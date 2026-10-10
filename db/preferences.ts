// Per-person interface preferences (phase 26). Keyed by sign-in email, so it works for every kind of user whether or
// not they have a tenant membership row. Personal settings only; never a business record.
import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userPreferences = sqliteTable("user_preferences", {
  email: text("email").primaryKey(),
  theme: text("theme", { enum: ["light", "dark", "system"] }).notNull().default("light"),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
