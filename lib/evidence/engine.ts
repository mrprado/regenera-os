// Claims and evidence rules (master build instruction §24, §74, §88).
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/db";
import { claimEvidence, claims } from "@/db/schema";
import { audit } from "@/lib/audit";

type Claim = typeof claims.$inferSelect;
type Status = Claim["status"];

/** The five labels the spec asks the project overview to distinguish. */
export const SOURCE_LABEL: Record<Status, "Verified" | "Sponsor provided" | "Regenera analysis" | "Assumption" | "Unknown"> = {
  verified: "Verified", source_provided: "Sponsor provided", calculated: "Regenera analysis", ai_inferred: "Regenera analysis",
  assumption: "Assumption", unverified: "Unknown", disputed: "Unknown",
};
export const STATUS_LABEL: Record<Status, string> = {
  verified: "Verified", source_provided: "Source provided", calculated: "Calculated", ai_inferred: "AI inferred", assumption: "Assumption", unverified: "Unverified", disputed: "Disputed",
};

export async function addClaim(db: Db, input: Omit<typeof claims.$inferInsert, "id" | "status" | "verifiedBy" | "verifiedAt"> & { status?: Exclude<Status, "verified"> }, actor: string) {
  const [c] = await db.insert(claims).values({ ...input, status: input.status ?? "unverified", createdBy: actor }).returning();
  await audit(db, { actor, action: "claim_added", entity: "claims", entityId: c.id, after: { statement: c.statement, status: c.status } });
  return c;
}

export async function addEvidence(db: Db, claimId: string, input: Omit<typeof claimEvidence.$inferInsert, "id" | "claimId" | "addedBy">, actor: string) {
  if (input.sourceUrl && !/^https?:\/\//.test(input.sourceUrl)) throw new Error("Source URL must be http(s)");
  const [e] = await db.insert(claimEvidence).values({ ...input, claimId, addedBy: actor }).returning();
  return e;
}

/** Status changes. Verified needs at least one non-AI evidence row and a human verifier; AI-only evidence can at most
 * support "AI inferred". Every change is audited. */
export async function setClaimStatus(db: Db, claimId: string, status: Status, actor: string, now = new Date()) {
  const [c] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!c) throw new Error("Claim not found");
  if (status === "verified") {
    if (actor.startsWith("ai:") || actor.startsWith("tool:") || actor === "system") throw new Error("Only a person can verify a claim");
    const ev = await db.select({ method: claimEvidence.method }).from(claimEvidence).where(eq(claimEvidence.claimId, c.id));
    if (!ev.some(e => e.method !== "ai")) throw new Error("Verification needs evidence that is not AI output (document, registry, API, site visit …)");
  }
  await db.update(claims).set({ status, verifiedBy: status === "verified" ? actor : null, verifiedAt: status === "verified" ? now.toISOString() : null, updatedAt: now.toISOString() }).where(eq(claims.id, c.id));
  await audit(db, { actor, action: "claim_status", entity: "claims", entityId: c.id, before: { status: c.status }, after: { status } });
}

/** Replaces a claim with a new value from a date; the old one stays for history ("what was true on date X"). */
export async function supersedeClaim(db: Db, claimId: string, next: { statement: string; value?: string | null; validFrom: string }, actor: string) {
  const [c] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!c) throw new Error("Claim not found");
  const n = await addClaim(db, { mandateId: c.mandateId, entityType: c.entityType, entityId: c.entityId, statement: next.statement, claimType: c.claimType, field: c.field, value: next.value ?? null, unit: c.unit, validFrom: next.validFrom, createdBy: actor }, actor);
  await db.update(claims).set({ validTo: next.validFrom, supersededById: n.id, updatedAt: new Date().toISOString() }).where(eq(claims.id, c.id));
  return n;
}

/** Claims about an entity that were in force on a date (validity window, not yet superseded then). */
export async function claimsAsOf(db: Db, entityType: string, entityId: string, date: string) {
  return db.select().from(claims).where(and(eq(claims.entityType, entityType), eq(claims.entityId, entityId),
    or(isNull(claims.validFrom), lte(claims.validFrom, date)), or(isNull(claims.validTo), gt(claims.validTo, date))));
}
