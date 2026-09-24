// Email + password sign-in (docs/DEPLOY.md). Only SHA-256 hashes of session tokens are stored.
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("auth_sessions_email_idx").on(t.email)]);

/** Failed sign-ins, for lockout per email and per IP. Pruned after a day. */
export const authFailures = sqliteTable("auth_failures", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  ip: text("ip").notNull(),
  at: text("at").notNull(),
}, t => [index("auth_failures_email_idx").on(t.email, t.at), index("auth_failures_ip_idx").on(t.ip, t.at)]);
