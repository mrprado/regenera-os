// Source conflicts: "EIA says 100 MW, the developer says 104 MWdc, GEM says 95 MW". Every value stays, side by side,
// with its source and status; the canonical value is the strongest claim, chosen by rule and shown with why. Nothing is
// overwritten and nothing is averaged.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { claimEvidence, claims } from "@/db/schema";

/** Strongest first. Verified beats source-provided beats calculated …; AI inference never wins over a sourced value. */
const STATUS_RANK: Record<string, number> = { verified: 6, source_provided: 5, calculated: 4, unverified: 3, assumption: 2, ai_inferred: 1, disputed: 0 };
const METHOD_RANK: Record<string, number> = { registry: 5, document: 5, site_visit: 4, api: 3, calculation: 3, interview: 2, other: 1, ai: 0 };

export type FieldValue = { claimId: string; value: string; unit: string | null; status: string; sources: string[]; method: string | null; validFrom: string | null; validTo: string | null; createdAt: string };
export type FieldView = { field: string; values: FieldValue[]; canonical: FieldValue | null; why: string; conflict: boolean };

export function pickCanonical(values: FieldValue[], asOf = new Date().toISOString().slice(0, 10)): { canonical: FieldValue | null; why: string } {
  const live = values.filter(v => v.status !== "disputed" && (!v.validTo || v.validTo >= asOf) && (!v.validFrom || v.validFrom <= asOf));
  if (!live.length) return { canonical: null, why: values.length ? "Every value is disputed or out of date." : "No value recorded." };
  const ranked = [...live].sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || (METHOD_RANK[b.method ?? "other"] ?? 0) - (METHOD_RANK[a.method ?? "other"] ?? 0) || b.createdAt.localeCompare(a.createdAt));
  const top = ranked[0];
  return { canonical: top, why: `Strongest status (${top.status.replace(/_/g, " ")})${top.method ? `, ${top.method} evidence` : ""}${ranked.length > 1 ? `, chosen over ${ranked.length - 1} other value(s)` : ""}.` };
}

const comparable = (v: FieldValue) => `${v.value.trim().toLowerCase()}|${(v.unit ?? "").toLowerCase()}`;

/** Values by source for every field of one record that has claims. */
export async function valuesBySource(db: Db, mandateIds: string[], entityType: string, entityId: string): Promise<FieldView[]> {
  if (!mandateIds.length) return [];
  const rows = await db.select().from(claims).where(and(inArray(claims.mandateId, mandateIds), eq(claims.entityType, entityType), eq(claims.entityId, entityId), isNull(claims.supersededById)));
  const withField = rows.filter(r => r.field && r.value !== null);
  if (!withField.length) return [];
  const ev = await db.select().from(claimEvidence).where(inArray(claimEvidence.claimId, withField.map(r => r.id).slice(0, 90)));
  const byField = new Map<string, FieldValue[]>();
  for (const r of withField) {
    const e = ev.filter(x => x.claimId === r.id);
    const v: FieldValue = { claimId: r.id, value: r.value!, unit: r.unit, status: r.status, sources: [...new Set(e.map(x => x.provider || x.sourceUrl || x.method))], method: e.sort((a, b) => (METHOD_RANK[b.method] ?? 0) - (METHOD_RANK[a.method] ?? 0))[0]?.method ?? null, validFrom: r.validFrom, validTo: r.validTo, createdAt: r.createdAt };
    byField.set(r.field!, [...(byField.get(r.field!) ?? []), v]);
  }
  return [...byField.entries()].map(([field, values]) => {
    const { canonical, why } = pickCanonical(values);
    return { field, values, canonical, why, conflict: new Set(values.filter(v => v.status !== "disputed").map(comparable)).size > 1 };
  }).sort((a, b) => Number(b.conflict) - Number(a.conflict) || a.field.localeCompare(b.field));
}
