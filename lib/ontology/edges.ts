// Typed edges: the only way new ontology relationships are written. The grammar (lib/ontology/relations) is checked
// first, and an edge can carry validity dates and the claim that supports it.
import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db";
import { relationshipEdges } from "@/db/schema";
import { allowedEdge, PREDICATES } from "./relations";

export type EdgeInput = {
  mandateId: string; fromType: string; fromId: string; predicate: string; toType: string; toId: string; createdBy: string;
  validFrom?: string | null; validTo?: string | null; evidenceClaimId?: string | null; note?: string; strength?: number; source?: string;
};

export async function addOntologyEdge(db: Db, e: EdgeInput) {
  if (!allowedEdge(e.predicate, e.fromType, e.toType)) {
    const p = (PREDICATES as Record<string, { label: string; from: readonly string[]; to: readonly string[] }>)[e.predicate];
    throw new Error(p ? `"${p.label}" runs from ${p.from.join(" / ")} to ${p.to.join(" / ")}, not ${e.fromType} to ${e.toType}.` : `Unknown relationship "${e.predicate}".`);
  }
  if (e.validFrom && e.validTo && e.validTo < e.validFrom) throw new Error("The end date is before the start date.");
  const [row] = await db.insert(relationshipEdges).values({
    mandateId: e.mandateId, fromType: e.fromType as never, fromId: e.fromId, toType: e.toType as never, toId: e.toId, type: e.predicate,
    strength: e.strength ?? 0.5, note: e.note ?? "", source: e.source ?? "manual", createdBy: e.createdBy,
    validFrom: e.validFrom ?? null, validTo: e.validTo ?? null, evidenceClaimId: e.evidenceClaimId ?? null,
  }).returning();
  return row;
}

/** Edges touching a record, optionally only those valid on a date ("what did we know on 1 March?"). */
export async function edgesOf(db: Db, mandateIds: string[], type: string, id: string, asOf?: string) {
  if (!mandateIds.length) return [];
  const rows = await db.select().from(relationshipEdges).where(and(inArray(relationshipEdges.mandateId, mandateIds),
    or(and(eq(relationshipEdges.fromType, type as never), eq(relationshipEdges.fromId, id)), and(eq(relationshipEdges.toType, type as never), eq(relationshipEdges.toId, id)))));
  return asOf ? rows.filter(r => (!r.validFrom || r.validFrom <= asOf) && (!r.validTo || r.validTo >= asOf)) : rows;
}
