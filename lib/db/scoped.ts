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
