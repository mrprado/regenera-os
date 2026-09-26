// Tables are added phase by phase per docs/plans/phase-N.md (SPEC sections 9 and 21).
// Conventions: text UUID ids, ISO-8601 UTC text timestamps, closed sets as enum + CHECK.
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { MANDATE_TYPES } from "../lib/vocab";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map(v => `'${v}'`).join(", ")})`);

export const MEMBER_ROLES = ["owner", "member"] as const;
export const MAILBOX_ROLES = ["primary", "sending"] as const;
export const JOB_STATUSES = ["queued", "running", "done", "dead"] as const;

export const mandates = sqliteTable("mandates", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: MANDATE_TYPES }).notNull(),
  rules: text("rules", { mode: "json" }).$type<{ massAllowed: boolean; approvalRequired: boolean }>().notNull(),
  sendingIdentity: text("sending_identity").notNull().default(""),
  feeTerms: text("fee_terms").notNull().default(""),
  // Investment mandates cannot send until an owner records that counsel confirmed the outreach rules (SPEC section 13).
  counselConfirmedAt: text("counsel_confirmed_at"),
  counselConfirmedBy: text("counsel_confirmed_by"),
  ...timestamps,
}, () => [check("mandates_type_check", inList("type", MANDATE_TYPES))]);

export const mandateMembers = sqliteTable("mandate_members", {
  id: id(),
  mandateId: text("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  // Sites user id (oai-authenticated-user-id); filled on first sign-in.
  userId: text("user_id"),
  role: text("role", { enum: MEMBER_ROLES }).notNull().default("member"),
  ...timestamps,
}, t => [
  uniqueIndex("mandate_members_mandate_email").on(t.mandateId, t.email),
  index("mandate_members_email").on(t.email),
  check("mandate_members_role_check", inList("role", MEMBER_ROLES)),
]);

export const auditLog = sqliteTable("audit_log", {
  id: id(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull().default(""),
  entityId: text("entity_id").notNull().default(""),
  before: text("before", { mode: "json" }),
  after: text("after", { mode: "json" }),
  createdAt: timestamps.createdAt,
}, t => [index("audit_log_created").on(t.createdAt)]);

export const oauthAccounts = sqliteTable("oauth_accounts", {
  id: id(),
  provider: text("provider").notNull().default("google"),
  mailboxRole: text("mailbox_role", { enum: MAILBOX_ROLES }).notNull(),
  email: text("email").notNull(),
  // AES-GCM ciphertexts (lib/crypto.ts); never store plaintext tokens.
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  accessTokenExpiresAt: text("access_token_expires_at").notNull(),
  scopes: text("scopes").notNull(),
  dailyCap: integer("daily_cap").notNull().default(10),
  warmupStartedOn: text("warmup_started_on"),
  pausedUntil: text("paused_until"),
  ...timestamps,
}, t => [
  uniqueIndex("oauth_accounts_provider_role").on(t.provider, t.mailboxRole),
  check("oauth_accounts_role_check", inList("mailbox_role", MAILBOX_ROLES)),
]);

export const jobs = sqliteTable("jobs", {
  id: id(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
  runAfter: text("run_after").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lockedUntil: text("locked_until"),
  lastError: text("last_error"),
  dedupeKey: text("dedupe_key"),
  ...timestamps,
}, t => [
  index("jobs_status_run_after").on(t.status, t.runAfter),
  uniqueIndex("jobs_dedupe_key").on(t.dedupeKey),
  check("jobs_status_check", inList("status", JOB_STATUSES)),
]);

export const jobSchedules = sqliteTable("job_schedules", {
  id: id(),
  jobType: text("job_type").notNull().unique(),
  // Cadence in ET: "every:5m", "daily:06:00", "weekly:mon:06:30", "monthly:1:06:00" (lib/time/cadence.ts).
  cadence: text("cadence").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  nextRunAt: text("next_run_at").notNull(),
  lastRunAt: text("last_run_at"),
  ...timestamps,
});

export const systemState = sqliteTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamps.updatedAt,
});

export * from "./crm";
export * from "./automation";
export * from "./radar";
export * from "./intel";
export * from "./funding";
export * from "./auth";
export * from "./contracts";
export * from "./projects";
export * from "./capital";
export * from "./regulatory";
export * from "./integrations";
export * from "./delivery";
export * from "./economics";
export * from "./procurement";
export * from "./portal";
export * from "./playbooks";
export * from "./evidence";
export * from "./systems";
export * from "./events";
export * from "./spatial";
export * from "./generated";
