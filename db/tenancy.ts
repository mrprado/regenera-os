// Client operating layer (docs/plans/phase-10-client-os.md): tenants (client organizations and Regenera), their
// hierarchy, members with user type / persona / teams / status, module entitlements, OS invitations and credentials
// for client users (PBKDF2, never plaintext), and login history. Data isolation stays on workspaces (`mandates`).
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { MODULES, ORG_TYPES, OS_USER_TYPES, PERSONAS, SUPPORT_TIERS, TEAM_KINDS, TENANT_STATUSES, UNIT_KINDS, UNIT_SYSTEMS } from "../lib/tenancy/vocab";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const json = <T>(name: string, dflt = "'[]'") => text(name, { mode: "json" }).$type<T>().notNull().default(sql.raw(dflt));
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export type Branding = { logoUrl?: string; accent?: string; reportFooter?: string; customDomain?: string };
export type TenantStepState = { done: string[]; note?: string; completedAt?: string | null };

export const tenants = sqliteTable("tenants", {
  id: id(),
  kind: text("kind", { enum: ["regenera", "client"] }).notNull().default("client"),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  orgType: text("org_type", { enum: keys(ORG_TYPES) }).notNull(),
  jurisdiction: text("jurisdiction").notNull().default(""),
  headquarters: text("headquarters").notNull().default(""),
  website: text("website").notNull().default(""),
  crmOrgId: text("crm_org_id"),                                    // the same organization in the CRM, when there is one
  branding: json<Branding>("branding", "'{}'"),
  baseCurrency: text("base_currency").notNull().default("USD"),
  units: text("units", { enum: keys(UNIT_SYSTEMS) }).notNull().default("metric"),
  timezone: text("timezone").notNull().default("UTC"),
  languages: json<string[]>("languages", `'["en"]'`),
  dateFormat: text("date_format").notNull().default("YYYY-MM-DD"),
  reportingPrefs: text("reporting_prefs").notNull().default(""),
  status: text("status", { enum: keys(TENANT_STATUSES) }).notNull().default("prospect"),
  clientSince: text("client_since"),
  accountOwner: text("account_owner"),
  supportTier: text("support_tier", { enum: keys(SUPPORT_TIERS) }).notNull().default("standard"),
  plan: text("plan", { enum: ["core", "professional", "enterprise", "custom"] }).notNull().default("custom"),
  seatsPurchased: integer("seats_purchased").notNull().default(0),
  externalSeats: integer("external_seats").notNull().default(0),
  storageGb: integer("storage_gb").notNull().default(0),
  apiDailyLimit: integer("api_daily_limit").notNull().default(0),
  onboarding: json<Record<string, TenantStepState>>("onboarding", "'{}'"),
  offboarding: json<Record<string, TenantStepState>>("offboarding", "'{}'"),
  terminationDate: text("termination_date"),
  renewalDate: text("renewal_date"),
  renewalLikelihood: text("renewal_likelihood"),                  // entered by the account owner; never computed
  requestedModules: json<string[]>("requested_modules"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("tenants_status").on(t.status)]);

export const orgUnits = sqliteTable("org_units", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  kind: text("kind", { enum: keys(UNIT_KINDS) }).notNull(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull().default(""),
  ownershipPct: text("ownership_pct"),
  workspaceId: text("workspace_id"),                              // the mandate holding this unit's data, when separate
  corporateEntityId: text("corporate_entity_id"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, t => [index("org_units_tenant").on(t.tenantId, t.parentId)]);

export const teams = sqliteTable("teams", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: keys(TEAM_KINDS) }).notNull().default("other"),
  description: text("description").notNull().default(""),
  ...timestamps,
}, t => [uniqueIndex("teams_name").on(t.tenantId, t.name)]);

export const tenantMembers = sqliteTable("tenant_members", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  userType: text("user_type", { enum: OS_USER_TYPES }).notNull(),
  persona: text("persona", { enum: keys(PERSONAS) }).notNull().default("general"),
  teams: json<string[]>("teams"),
  moduleDeny: json<string[]>("module_deny"),                     // admin-set restrictions inside the tenant's entitlement
  status: text("status", { enum: ["invited", "active", "deactivated"] }).notNull().default("active"),
  invitedBy: text("invited_by"),
  lastLoginAt: text("last_login_at"),
  deactivatedAt: text("deactivated_at"), deactivatedBy: text("deactivated_by"),
  ...timestamps,
}, t => [uniqueIndex("tenant_members_email").on(t.tenantId, t.email), index("tenant_members_by_email").on(t.email)]);

export const tenantModules = sqliteTable("tenant_modules", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  module: text("module", { enum: keys(MODULES) }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  source: text("source", { enum: ["plan", "contract", "trial", "beta"] }).notNull().default("contract"),
  expiresAt: text("expires_at"),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at").notNull().default(now),
}, t => [primaryKey({ columns: [t.tenantId, t.module] })]);

/** OS credentials for invited users who do not use the Regenera password. PBKDF2-SHA256 "iterations$salt$hash". */
export const osCredentials = sqliteTable("os_credentials", {
  email: text("email").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

export const osInvites = sqliteTable("os_invites", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  tokenHash: text("token_hash").notNull().unique(),
  userType: text("user_type", { enum: OS_USER_TYPES }).notNull(),
  persona: text("persona", { enum: keys(PERSONAS) }).notNull().default("general"),
  workspaceIds: json<string[]>("workspace_ids"),
  teams: json<string[]>("teams"),
  invitedBy: text("invited_by").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"), revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(now),
}, t => [index("os_invites_tenant").on(t.tenantId)]);

export const loginEvents = sqliteTable("login_events", {
  id: id(),
  email: text("email").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  method: text("method").notNull().default(""),                    // credential | regenera
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  at: text("at").notNull().default(now),
}, t => [index("login_events_email").on(t.email, t.at)]);
