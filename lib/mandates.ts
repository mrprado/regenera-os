// Mandates (docs/plans/phase-4.md items 5 and 9). Owners of the Regenera mandate administer every mandate
// (create, rules, members, counsel confirmation) but only see a mandate's data if they are a member of it.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { mandateMembers, mandates } from "@/db/schema";
import type { UserScope } from "@/lib/db/scoped";
import { REGENERA_MANDATE_ID } from "@/lib/membership";

export const INVESTMENT_MANDATES = [
  { id: "mandate_ra_esg", slug: "ra-esg", name: "RA-ESG" },
  { id: "mandate_gwce", slug: "gwce", name: "GWCe" },
] as const;

/** Idempotent. Investment mandates: manual only, no mass tier, sending off until counsel confirms. No members yet. */
export async function ensureInvestmentMandates(db: Db) {
  for (const m of INVESTMENT_MANDATES) {
    await db.insert(mandates).values({ id: m.id, slug: m.slug, name: m.name, type: "investment", rules: { massAllowed: false, approvalRequired: true } }).onConflictDoNothing();
  }
}

export function isMandateAdmin(scope: UserScope) {
  return (scope.memberOf ?? scope.mandateIds).length > 0 && (scope.ownerOfAll ?? scope.ownerOf).includes(REGENERA_MANDATE_ID);
}

export async function mandateAdminList(db: Db) {
  const rows = await db.select().from(mandates).orderBy(asc(mandates.type), asc(mandates.name));
  const members = await db.select().from(mandateMembers).orderBy(asc(mandateMembers.email));
  return rows.map(m => ({ ...m, members: members.filter(x => x.mandateId === m.id) }));
}

/** Investment-mandate sending gate (SPEC section 13). Advisory and development mandates are unaffected. */
export async function sendingAllowed(db: Db, mandateId: string): Promise<{ ok: true; investment: boolean } | { ok: false; reason: "counsel_not_confirmed" }> {
  const [m] = await db.select({ type: mandates.type, counsel: mandates.counselConfirmedAt }).from(mandates).where(eq(mandates.id, mandateId));
  if (m?.type !== "investment") return { ok: true, investment: false };
  return m.counsel ? { ok: true, investment: true } : { ok: false, reason: "counsel_not_confirmed" };
}

export async function addMember(db: Db, mandateId: string, email: string, role: "owner" | "member") {
  await db.insert(mandateMembers).values({ mandateId, email: email.trim().toLowerCase(), role })
    .onConflictDoUpdate({ target: [mandateMembers.mandateId, mandateMembers.email], set: { role, updatedAt: new Date().toISOString() } });
}

/** Refuses to remove the last owner of the Regenera mandate, so the OS can never lock itself out. */
export async function removeMember(db: Db, mandateId: string, email: string): Promise<boolean> {
  if (mandateId === REGENERA_MANDATE_ID) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(mandateMembers)
      .where(and(eq(mandateMembers.mandateId, mandateId), eq(mandateMembers.role, "owner"), sql`${mandateMembers.email} <> ${email.toLowerCase()}`));
    if (n === 0) return false;
  }
  await db.delete(mandateMembers).where(and(eq(mandateMembers.mandateId, mandateId), eq(mandateMembers.email, email.toLowerCase())));
  return true;
}

/** Narrows a scope to one mandate the user belongs to (header switcher). Unknown ids are ignored. */
export function narrowScope(scope: UserScope, focus: string | undefined | null): UserScope {
  const memberOf = scope.memberOf ?? scope.mandateIds;
  const ownerOfAll = scope.ownerOfAll ?? scope.ownerOf;
  if (!focus || !memberOf.includes(focus)) return { ...scope, memberOf, ownerOfAll };
  return { ...scope, mandateIds: [focus], ownerOf: ownerOfAll.filter(m => m === focus), memberOf, ownerOfAll };
}
