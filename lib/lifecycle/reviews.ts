// Review queue for conflicting extracted values (phase 29E). Ingestion fills empty fields only (lib/crm/entities.ts);
// when a source disagrees with a value already held, the disagreement is queued here with both values and their
// sources. Accepting writes the proposed value with its provenance and the reviewer; rejecting keeps the current one.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, fieldReviews, organizations } from "@/db/schema";
import { audit } from "@/lib/audit";

export type FieldConflict = { field: string; current: string; currentSource: string; proposed: string; source: string; url?: string | null; confidence?: string | null; at: string };

export async function queueFieldConflicts(db: Db, mandateId: string, entityType: "organization" | "contact", entityId: string, items: FieldConflict[]) {
  for (const c of items) {
    const pendingKey = [entityType, entityId, c.field, c.proposed.toLowerCase()].join("|");
    await db.insert(fieldReviews).values({ mandateId, entityType, entityId, field: c.field, currentValue: c.current, currentSource: c.currentSource, proposedValue: c.proposed, source: c.source, sourceUrl: c.url ?? null, confidence: c.confidence ?? null, retrievedAt: c.at, pendingKey }).onConflictDoNothing();
  }
}

export async function pendingReviews(db: Db, mandateIds: string[], limit = 200) {
  if (!mandateIds.length) return [];
  return db.select().from(fieldReviews).where(and(inArray(fieldReviews.mandateId, mandateIds), eq(fieldReviews.status, "pending"))).orderBy(desc(fieldReviews.createdAt)).limit(limit);
}

const NUMERIC = new Set(["headcount", "foundedYear", "lat", "lng"]);

export async function decideFieldReview(db: Db, id: string, decision: "accepted" | "rejected", note: string, by: string) {
  const [r] = await db.select().from(fieldReviews).where(eq(fieldReviews.id, id));
  if (!r || r.status !== "pending") throw new Error("This review is no longer pending.");
  const now = new Date().toISOString();
  if (decision === "accepted") {
    const table = r.entityType === "organization" ? organizations : contacts;
    const [row] = await db.select({ fieldSources: table.fieldSources }).from(table).where(eq(table.id, r.entityId));
    if (!row) throw new Error("The record no longer exists.");
    const value = NUMERIC.has(r.field) ? Number(r.proposedValue) : r.proposedValue;
    const sources = { ...(row.fieldSources ?? {}), [r.field]: { source: `${r.source} (accepted by ${by})`, at: now, confidence: "high" as const, ...(r.sourceUrl ? { url: r.sourceUrl } : {}) } };
    await db.update(table).set({ [r.field]: value, fieldSources: sources, updatedAt: now } as never).where(eq(table.id, r.entityId));
  }
  await db.update(fieldReviews).set({ status: decision, decidedBy: by, decidedAt: now, note, pendingKey: null }).where(eq(fieldReviews.id, id));
  await audit(db, { actor: by, action: `field_review_${decision}`, entity: r.entityType === "organization" ? "organizations" : "contacts", entityId: r.entityId, before: { [r.field]: r.currentValue }, after: decision === "accepted" ? { [r.field]: r.proposedValue, source: r.source } : { kept: r.currentValue } });
}
