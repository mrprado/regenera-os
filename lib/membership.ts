import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { mandateMembers, mandates } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { UserScope } from "@/lib/db/scoped";
import { ensureRegeneraTenant, resolveAccess } from "@/lib/tenancy/engine";

export const REGENERA_MANDATE_ID = "mandate_regenera";

/** Idempotently creates the Regenera advisory mandate (also in seed/seed.sql). */
export async function ensureRegeneraMandate(db: Db) {
  await db.insert(mandates).values({
    id: REGENERA_MANDATE_ID,
    slug: "regenera",
    name: "Regenera",
    type: "advisory",
    rules: { massAllowed: true, approvalRequired: true },
  }).onConflictDoNothing();
}

export function parseAllowlist(value: string | undefined): Set<string> {
  return new Set((value || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean));
}

/**
 * Resolves a signed-in Sites user to their mandate scope, or null if not permitted.
 * While mandate_members is empty, the first allowlisted sign-in becomes the Regenera owner.
 * After that, only mandate_members grants access; the allowlist no longer does.
 */
export async function resolveMembership(
  db: Db,
  user: { userId: string; email: string },
  bootstrapAllowlist: Set<string>,
): Promise<UserScope | null> {
  const email = user.email.toLowerCase();
  let rows = await db.select().from(mandateMembers).where(eq(mandateMembers.email, email));

  if (rows.length === 0) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(mandateMembers);
    if (count > 0 || !bootstrapAllowlist.has(email)) return null;
    await ensureRegeneraMandate(db);
    await ensureRegeneraTenant(db);
    await db.insert(mandateMembers).values({ mandateId: REGENERA_MANDATE_ID, email, userId: user.userId, role: "owner" }).onConflictDoNothing();
    await audit(db, { actor: email, action: "bootstrap_owner", entity: "mandate_members", entityId: REGENERA_MANDATE_ID });
    rows = await db.select().from(mandateMembers).where(eq(mandateMembers.email, email));
  }

  // Bind the durable Sites user id on first sign-in; refuse if the email is bound to a different id.
  if (rows.some(r => r.userId && r.userId !== user.userId)) return null;
  if (rows.some(r => !r.userId)) {
    await db.update(mandateMembers).set({ userId: user.userId }).where(and(eq(mandateMembers.email, email), isNull(mandateMembers.userId)));
  }

  // Tenant state (lib/tenancy): deactivated members and suspended client organizations lose their grants here.
  const access = await resolveAccess(db, email, rows);
  if (!access) return null;
  const live = new Set(access.mandateIds);
  return {
    kind: "user",
    userId: user.userId,
    email,
    mandateIds: access.mandateIds,
    ownerOf: rows.filter(r => r.role === "owner" && live.has(r.mandateId)).map(r => r.mandateId),
    userType: access.userType,
    persona: access.persona,
    tenantIds: access.tenantIds,
    adminOf: access.adminOf,
    modules: access.modules,
  };
}
