// Identity resolution: one Regenera ID per real-world thing; names and external identifiers map into it.
// "CMEC", "China Machinery Engineering Corporation" and "CMEC Group" resolve to one organization once an alias says so.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { entityAliases } from "@/db/schema";
import type { ALIAS_SCHEMES } from "./taxonomies";

export type AliasScheme = keyof typeof ALIAS_SCHEMES;

const LEGAL_SUFFIXES = /\b(incorporated|inc|corp|corporation|co|company|ltd|limited|llc|llp|lp|plc|sa|s\.a|sas|sarl|srl|spa|gmbh|ag|bv|nv|ab|oy|as|pty|pte|sl|sapi|de|cv|s de rl|group|holdings?)\b/g;

/** Comparable form of a value. Names lose accents, punctuation and legal suffixes; identifiers lose spacing and case. */
export function normalizeAlias(scheme: AliasScheme, value: string): string {
  const v = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  // Dotted abbreviations collapse first ("S.A. de C.V." → "sa de cv"), so the suffix list can remove them.
  if (scheme === "name") return v.replace(/\b(?:[a-z]\.\s?){2,}/g, m => ` ${m.replace(/[.\s]/g, "")} `).replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
  if (scheme === "domain") return v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return v.replace(/[\s\-./]+/g, "");
}

/** Records an alias. A (scheme, value) already held by a different record is a conflict to resolve, not overwritten. */
export async function addAlias(db: Db, a: { mandateId: string; entityType: string; entityId: string; scheme: AliasScheme; value: string; source?: string; createdBy: string; validFrom?: string | null; validTo?: string | null }) {
  const normalized = normalizeAlias(a.scheme, a.value);
  if (!normalized) throw new Error("That identifier is empty once normalized.");
  const [held] = await db.select().from(entityAliases).where(and(eq(entityAliases.mandateId, a.mandateId), eq(entityAliases.scheme, a.scheme), eq(entityAliases.normalized, normalized)));
  if (held && (held.entityType !== a.entityType || held.entityId !== a.entityId)) {
    return { ok: false as const, conflict: held };
  }
  if (held) return { ok: true as const, alias: held, existed: true };
  const [alias] = await db.insert(entityAliases).values({ ...a, value: a.value.trim(), normalized, source: a.source ?? "manual" }).returning();
  return { ok: true as const, alias, existed: false };
}

/** The record an identifier or name points to, if any. */
export async function resolveAlias(db: Db, mandateId: string, scheme: AliasScheme, value: string) {
  const [hit] = await db.select().from(entityAliases).where(and(eq(entityAliases.mandateId, mandateId), eq(entityAliases.scheme, scheme), eq(entityAliases.normalized, normalizeAlias(scheme, value))));
  return hit ? { entityType: hit.entityType, entityId: hit.entityId, alias: hit } : null;
}

export async function aliasesOf(db: Db, entityType: string, entityId: string) {
  return db.select().from(entityAliases).where(and(eq(entityAliases.entityType, entityType), eq(entityAliases.entityId, entityId)));
}
