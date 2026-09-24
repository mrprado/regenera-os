// Conflict check (SPEC section 7): before a lead is queued, check every mandate, every existing relationship and
// every Partner Network referral. Matches are flagged for Prado's decision, never sent automatically.
// Other mandates' records are only reported as "another mandate", never with their details.
import { and, eq, gte, inArray, ne, notInArray, or } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, deals, enrollments, organizations, relationships, siteEvents, suppression } from "@/db/schema";

export type Conflict = { kind: "open_deal" | "other_mandate" | "partner_referral" | "active_sequence" | "recent_touch" | "warm_path" | "suppressed"; detail: string; blocking: boolean };

const CLOSED = ["completed", "churned", "lost"] as const;

export async function checkConflicts(db: Db, mandateId: string, input: { orgId?: string | null; domain?: string | null; name?: string | null; excludeContactIds?: string[] }, now = new Date()): Promise<Conflict[]> {
  const out: Conflict[] = [];
  const org = input.orgId ? (await db.select().from(organizations).where(eq(organizations.id, input.orgId)))[0] : undefined;
  const domain = (input.domain ?? org?.domain ?? "").toLowerCase() || null;
  const normalized = org?.nameNormalized ?? null;

  if (domain) {
    const [s] = await db.select().from(suppression).where(eq(suppression.domain, domain));
    if (s) out.push({ kind: "suppressed", detail: `The whole domain ${domain} is suppressed (${s.reason}).`, blocking: true });
  }
  if (org) {
    const open = await db.select({ name: deals.name, stage: deals.stage, source: deals.source }).from(deals)
      .where(and(eq(deals.mandateId, mandateId), eq(deals.orgId, org.id), notInArray(deals.stage, [...CLOSED])));
    for (const d of open) out.push({ kind: d.source === "referral" ? "partner_referral" : "open_deal", detail: `Open deal "${d.name}" at ${d.stage}.`, blocking: true });
    const refs = await db.select({ id: siteEvents.id }).from(siteEvents).innerJoin(contacts, eq(contacts.id, siteEvents.contactId))
      .where(and(eq(siteEvents.kind, "referral"), eq(contacts.orgId, org.id)));
    if (refs.length && !out.some(c => c.kind === "partner_referral")) out.push({ kind: "partner_referral", detail: "A Partner Network partner referred this organization. Contact goes through the partner.", blocking: true });
    const orgContacts = (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.orgId, org.id))).map(c => c.id).filter(id => !input.excludeContactIds?.includes(id));
    if (orgContacts.length) {
      const [active] = await db.select({ id: enrollments.id }).from(enrollments).where(and(inArray(enrollments.contactId, orgContacts), inArray(enrollments.status, ["drafting", "active", "paused"]))).limit(1);
      if (active) out.push({ kind: "active_sequence", detail: "Someone at this organization is already in a sequence.", blocking: true });
      const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
      const [touch] = await db.select({ detail: activities.detail, at: activities.occurredAt }).from(activities)
        .where(and(inArray(activities.contactId, orgContacts), gte(activities.occurredAt, since), inArray(activities.type, ["email", "call", "meeting", "linkedin"]))).limit(1);
      if (touch) out.push({ kind: "recent_touch", detail: `Touched in the last 30 days: ${touch.detail.slice(0, 80)}`, blocking: false });
    }
  }
  // Other mandates: same domain or same normalized name, reported without details.
  if (domain || normalized) {
    const [other] = await db.select({ id: organizations.id }).from(organizations)
      .where(and(ne(organizations.mandateId, mandateId), or(domain ? eq(organizations.domain, domain) : undefined, normalized ? eq(organizations.nameNormalized, normalized) : undefined))).limit(1);
    if (other) out.push({ kind: "other_mandate", detail: "This organization is also a record in another mandate. Check before contacting.", blocking: true });
  }
  if (domain) {
    const warm = await db.select({ email: relationships.email, mailbox: relationships.mailbox, strength: relationships.strength }).from(relationships)
      .where(and(eq(relationships.mandateId, mandateId), eq(relationships.domain, domain))).limit(3);
    for (const w of warm) out.push({ kind: "warm_path", detail: `Warm path: ${w.email} via ${w.mailbox} (strength ${w.strength}). Consider an introduction instead of a cold sequence.`, blocking: false });
  }
  return out;
}
