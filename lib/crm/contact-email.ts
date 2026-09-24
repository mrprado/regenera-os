// Getting an address for a contact: Apollo enrichment (1 credit when found, budget-guarded) or free inference
// from the organization's known address pattern plus an MX check. Inferred addresses are never "verified".
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, organizations } from "@/db/schema";
import { upsertContact } from "@/lib/crm/entities";
import { type ApolloConfig, apolloEmailStatus, enrichPerson } from "@/lib/sources/apollo";
import { applyPattern, domainAcceptsMail, inferPattern } from "@/lib/sources/email";
import { SourceError } from "@/lib/sources/http";

export type EnrichResult = { ok: true; email: boolean; credits: number } | { ok: false; error: string; stop: boolean };

export async function enrichContactWithApollo(db: Db, cfg: ApolloConfig | null, contactId: string, fetchImpl?: typeof fetch): Promise<EnrichResult> {
  if (!cfg) return { ok: false, error: "Apollo is not connected (APOLLO_API_KEY).", stop: true };
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return { ok: false, error: "Contact not found", stop: false };
  const [org] = c.orgId ? await db.select().from(organizations).where(eq(organizations.id, c.orgId)) : [];
  try {
    const r = await enrichPerson(db, cfg, c.apolloPersonId ? { id: c.apolloPersonId } : {
      first_name: c.firstName, last_name: c.lastName, domain: org?.domain ?? undefined, organization_name: org?.name, linkedin_url: c.linkedinUrl ?? undefined,
    }, fetchImpl);
    const p = r.person;
    if (!p || r.match_confidence === "none") return { ok: true, email: false, credits: 0 };
    await upsertContact(db, c.mandateId, {
      fullName: c.fullName, apolloPersonId: p.id, email: p.email, emailStatus: apolloEmailStatus(p.email_status), title: p.title, linkedinUrl: p.linkedin_url,
    }, "apollo", { source: "apollo", confidence: r.match_confidence === "high" ? "high" : "medium" });
    return { ok: true, email: !!p.email, credits: p.email || p.title ? 1 : 0 };
  } catch (error) {
    if (error instanceof SourceError) return { ok: false, error: error.message.replace(/^apollo: /, "Apollo: "), stop: error.status === 402 || error.status === 429 };
    throw error;
  }
}

/** Free: learns the pattern from 2+ known addresses at the organization's domain. Returns the address or null. */
export async function inferContactEmail(db: Db, contactId: string, fetchImpl?: typeof fetch): Promise<string | null> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c || c.emailLower || !c.orgId || !c.firstName || !c.lastName) return null;
  const [org] = await db.select({ domain: organizations.domain }).from(organizations).where(eq(organizations.id, c.orgId));
  if (!org?.domain) return null;
  const known = await db.select({ first: contacts.firstName, last: contacts.lastName, email: contacts.emailLower }).from(contacts)
    .where(and(eq(contacts.orgId, c.orgId), isNotNull(contacts.emailLower)));
  const pattern = inferPattern(known.filter(k => k.first && k.last && k.email?.endsWith(`@${org.domain}`)).map(k => ({ first: k.first!, last: k.last!, email: k.email! })));
  if (!pattern) return null;
  const email = applyPattern(pattern, c.firstName, c.lastName, org.domain);
  if (!email || !(await domainAcceptsMail(db, org.domain, fetchImpl))) return null;
  // Written onto this contact directly: an upsert by name alone could match or create the wrong record.
  const [taken] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.mandateId, c.mandateId), eq(contacts.emailLower, email)));
  if (taken) return null;
  const sources = { ...(c.fieldSources ?? {}), email: { source: "pattern", confidence: "low" as const, at: new Date().toISOString() } };
  await db.update(contacts).set({ email, emailLower: email, emailStatus: "inferred", fieldSources: sources, updatedAt: new Date().toISOString() }).where(eq(contacts.id, c.id));
  return email;
}
