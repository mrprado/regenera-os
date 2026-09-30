// The only sanctioned way for app code to reach the database (SPEC sections 9 and 21).
// Mandate-scoped tables are filtered with mandateCondition(); unscoped system tables
// (jobs, job_schedules, system_state, oauth_accounts, audit_log) use appDb() directly.
import { inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb, type Db } from "@/db";
import { audit } from "@/lib/audit";

export type UserScope = {
  kind: "user";
  userId: string;
  email: string;
  mandateIds: string[];
  ownerOf: string[];
  /** Every mandate the user belongs to, before the header switcher narrows `mandateIds`. */
  memberOf?: string[];
  ownerOfAll?: string[];
  /** Client operating layer (lib/tenancy). Absent on scopes built before it, which behave as Regenera internal. */
  userType?: "regenera_internal" | "client_admin" | "client_user" | "read_only";
  persona?: string;
  tenantIds?: string[];
  adminOf?: string[];
  modules?: string[] | "all";
};
export type SystemScope = { kind: "system"; reason: string };
export type Scope = UserScope | SystemScope;

export function appDb(): Db {
  return getDb();
}

/** WHERE fragment restricting a mandate_id column to the scope's mandates. System scope sees all. */
export function mandateCondition(scope: Scope, column: SQLiteColumn): SQL {
  if (scope.kind === "system") return sql`1 = 1`;
  if (scope.mandateIds.length === 0) return sql`0 = 1`;
  return inArray(column, scope.mandateIds);
}

/** Explicit, audited escape hatch for jobs that must act across mandates. */
export async function systemScope(db: Db, reason: string): Promise<SystemScope> {
  await audit(db, { actor: "system", action: "system_scope", entity: "scope", after: { reason } });
  return { kind: "system", reason };
}

export function isOwner(scope: Scope, mandateId?: string): boolean {
  if (scope.kind === "system") return true;
  return mandateId ? scope.ownerOf.includes(mandateId) : scope.ownerOf.length > 0;
}

/** Regenera staff (or a system job). Client users, read-only users and client admins are not. */
export function isInternal(scope: Scope): boolean {
  return scope.kind === "system" || scope.userType === undefined || scope.userType === "regenera_internal";
}
