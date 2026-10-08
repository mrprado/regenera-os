// Regulatory guardrails as data (phase 20 §7). Regulated products: a sponsor's bonds, shares or funds; an outbound
// draft that names one is held by the send gate (promoting securities is a regulated activity). Protected parties:
// non-circumvention protections with an end date; introductions to them are blocked while active. Both are checks a
// person can resolve, never silent rewrites.
import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import { protectedParties, regulatedProducts } from "@/db/schema";
import { normalizeAlias } from "@/lib/ontology/identity";

const words = (s: string) => ` ${normalizeAlias("name", s)} `;

/** Product names (and aliases) found in a text. Pure. */
export function productMentions(text: string, products: { name: string; aliases: string[] }[]) {
  const t = words(text);
  return products.filter(p => [p.name, ...p.aliases].some(n => { const w = normalizeAlias("name", n); return w.length >= 3 && t.includes(` ${w} `); })).map(p => p.name);
}

export async function messageGuardrails(db: Db, mandateId: string, text: string) {
  const products = await db.select({ name: regulatedProducts.name, aliases: regulatedProducts.aliases }).from(regulatedProducts).where(eq(regulatedProducts.mandateId, mandateId));
  const hits = productMentions(text, products);
  return hits.length ? { ok: false as const, reasons: [`Names a regulated product (${hits.join(", ")}): promotion needs counsel's approval and an eligible recipient`] } : { ok: true as const, reasons: [] as string[] };
}

/** Active protections covering an organization (by id or by name). */
export async function activeProtections(db: Db, mandateId: string, party: { orgId?: string | null; name?: string | null }, today = new Date().toISOString().slice(0, 10)) {
  const rows = await db.select().from(protectedParties).where(and(eq(protectedParties.mandateId, mandateId), or(isNull(protectedParties.until), gte(protectedParties.until, today))));
  const n = party.name ? normalizeAlias("name", party.name) : null;
  return rows.filter(r => (party.orgId && r.orgId === party.orgId) || (n && normalizeAlias("name", r.partyName) === n));
}
