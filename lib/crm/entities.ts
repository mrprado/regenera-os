// Find-or-create for organizations and contacts with multi-source merge (SPEC section 12b):
// match on strong IDs first, fill empty fields only, keep per-field provenance, flag conflicts.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, organizations, type FieldSources } from "@/db/schema";
import { canonicalLinkedin, normalizeEmail, normalizeOrgName, normalizePersonName, registrableDomain, splitName } from "@/lib/dedupe/normalize";
import { enqueue } from "@/lib/jobs/queue";
import type { LEAD_SOURCES } from "@/lib/vocab";

type Source = keyof typeof LEAD_SOURCES;
type Provenance = { source: string; confidence?: "high" | "medium" | "low"; url?: string };

export type OrgInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  country?: string | null;
  location?: string | null;
  sector?: string | null;
  industry?: string | null;
  headcount?: number | null;
  foundedYear?: number | null;
  description?: string | null;
  linkedinUrl?: string | null;
  apolloOrgId?: string | null;
  lei?: string | null;
  wikidataId?: string | null;
  secCik?: string | null;
  segmentId?: string | null;
  lat?: number | null;
  lng?: number | null;
  geoSource?: string | null;
  /** True when `domain` was guessed from a person's email rather than stated as the company website. */
  domainInferred?: boolean;
};

const namesCompatible = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);

const ORG_FIELDS = ["domain", "website", "country", "location", "sector", "industry", "headcount", "foundedYear", "description", "linkedinUrl", "apolloOrgId", "lei", "wikidataId", "secCik", "segmentId", "lat", "lng", "geoSource"] as const;

export type MergeResult<T> = { row: T; created: boolean; conflicts: string[] };

function fill<T extends Record<string, unknown>>(existing: T, incoming: Partial<T>, fields: readonly (keyof T & string)[], prov: Provenance, now: string) {
  const set: Partial<T> = {};
  const sources: FieldSources = { ...((existing.fieldSources as FieldSources) ?? {}) };
  const conflicts: string[] = [];
  for (const f of fields) {
    const v = incoming[f];
    if (v === undefined || v === null || v === "") continue;
    const cur = existing[f];
    if (cur === undefined || cur === null || cur === "") {
      (set as Record<string, unknown>)[f] = v;
      sources[f] = { source: prov.source, at: now, ...(prov.confidence ? { confidence: prov.confidence } : {}), ...(prov.url ? { url: prov.url } : {}) };
    } else if (String(cur).toLowerCase() !== String(v).toLowerCase() && !["lat", "lng", "geoSource", "description"].includes(f)) {
      conflicts.push(`${f}: kept "${cur}" (${sources[f]?.source ?? "earlier"}), ${prov.source} says "${v}"`);
    }
  }
  return { set, sources, conflicts };
}

export async function upsertOrganization(db: Db, mandateId: string, input: OrgInput, source: Source, prov: Provenance): Promise<MergeResult<typeof organizations.$inferSelect>> {
  const now = new Date().toISOString();
  const domain = registrableDomain(input.domain ?? input.website ?? null);
  const normalized = normalizeOrgName(input.name);
  const clean: OrgInput = { ...input, domain };
  delete clean.domainInferred;

  let existing: typeof organizations.$inferSelect | undefined;
  if (input.apolloOrgId) [existing] = await db.select().from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.apolloOrgId, input.apolloOrgId)));
  if (!existing && domain) {
    const [byDomain] = await db.select().from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.domain, domain)));
    // An email-derived domain (shared or group mailboxes) only merges when the names also agree.
    if (byDomain && input.domainInferred && !namesCompatible(byDomain.nameNormalized, normalized)) clean.domain = null;
    else existing = byDomain;
  }
  if (!existing && input.lei) [existing] = await db.select().from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.lei, input.lei)));
  if (!existing && normalized) {
    // Name-only matches merge only when neither side has a conflicting domain.
    const candidates = await db.select().from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.nameNormalized, normalized)));
    existing = candidates.find(c => !c.domain || !domain || c.domain === domain);
  }

  if (!existing) {
    const sources: FieldSources = {};
    for (const f of ORG_FIELDS) if (clean[f] !== undefined && clean[f] !== null && clean[f] !== "") sources[f] = { source: prov.source, at: now, ...(prov.confidence ? { confidence: prov.confidence } : {}), ...(prov.url ? { url: prov.url } : {}) };
    const [row] = await db.insert(organizations).values({
      mandateId, name: input.name.trim(), nameNormalized: normalized, source, fieldSources: sources,
      ...Object.fromEntries(ORG_FIELDS.map(f => [f, clean[f] ?? null])),
    }).returning();
    // Every new organization gets free identity enrichment, which then places it on the map.
    await enqueue(db, "identity.enrich", { orgId: row.id }, { dedupeKey: `identity:${row.id}` });
    return { row, created: true, conflicts: [] };
  }

  const { set, sources, conflicts } = fill(existing as unknown as Record<string, unknown>, clean as Record<string, unknown>, ORG_FIELDS as unknown as string[], prov, now);
  if (Object.keys(set).length > 0) {
    const [row] = await db.update(organizations).set({ ...set, fieldSources: sources, updatedAt: now }).where(eq(organizations.id, existing.id)).returning();
    return { row, created: false, conflicts };
  }
  return { row: existing, created: false, conflicts };
}

export type ContactInput = {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  seniority?: string | null;
  email?: string | null;
  emailStatus?: (typeof contacts.$inferInsert)["emailStatus"];
  linkedinUrl?: string | null;
  location?: string | null;
  country?: string | null;
  apolloPersonId?: string | null;
  segmentId?: string | null;
  orgId?: string | null;
};

// emailStatus is not merged field by field: it always follows the email it describes (below).
const CONTACT_FIELDS = ["firstName", "lastName", "title", "seniority", "email", "emailLower", "linkedinUrl", "location", "country", "apolloPersonId", "segmentId", "orgId"] as const;

export async function upsertContact(db: Db, mandateId: string, input: ContactInput, source: Source, prov: Provenance): Promise<MergeResult<typeof contacts.$inferSelect>> {
  const now = new Date().toISOString();
  const email = normalizeEmail(input.email);
  const linkedin = canonicalLinkedin(input.linkedinUrl);
  const names = input.firstName || input.lastName ? { first: input.firstName ?? "", last: input.lastName ?? "" } : splitName(input.fullName);
  const clean = {
    ...input, firstName: names.first, lastName: names.last, email: input.email?.trim() || null, emailLower: email, linkedinUrl: linkedin,
    emailStatus: email ? (input.emailStatus ?? "unverified") : undefined,
  };
  const normalized = normalizePersonName(input.fullName);

  let existing: typeof contacts.$inferSelect | undefined;
  if (input.apolloPersonId) [existing] = await db.select().from(contacts).where(and(eq(contacts.mandateId, mandateId), eq(contacts.apolloPersonId, input.apolloPersonId)));
  if (!existing && email) [existing] = await db.select().from(contacts).where(and(eq(contacts.mandateId, mandateId), eq(contacts.emailLower, email)));
  if (!existing && linkedin) [existing] = await db.select().from(contacts).where(and(eq(contacts.mandateId, mandateId), eq(contacts.linkedinUrl, linkedin)));
  if (!existing && input.orgId && normalized) {
    // Same name at the same organization merges only when the emails do not conflict.
    const candidates = await db.select().from(contacts).where(and(eq(contacts.mandateId, mandateId), eq(contacts.orgId, input.orgId), eq(contacts.nameNormalized, normalized)));
    existing = candidates.find(c => !c.emailLower || !email || c.emailLower === email);
  }

  if (!existing) {
    const sources: FieldSources = {};
    for (const f of CONTACT_FIELDS) if (clean[f] !== undefined && clean[f] !== null && clean[f] !== "") sources[f] = { source: prov.source, at: now };
    const [row] = await db.insert(contacts).values({
      mandateId, fullName: input.fullName.trim(), nameNormalized: normalized, source, fieldSources: sources,
      firstName: clean.firstName, lastName: clean.lastName, title: clean.title ?? null, seniority: clean.seniority ?? null,
      email: clean.email, emailLower: clean.emailLower, emailStatus: clean.emailStatus ?? "unknown", linkedinUrl: clean.linkedinUrl,
      location: clean.location ?? null, country: clean.country ?? null, apolloPersonId: clean.apolloPersonId ?? null,
      segmentId: clean.segmentId ?? null, orgId: clean.orgId ?? null,
    }).returning();
    return { row, created: true, conflicts: [] };
  }

  const { set, sources, conflicts } = fill(existing as unknown as Record<string, unknown>, clean as Record<string, unknown>, CONTACT_FIELDS as unknown as string[], prov, now);
  // The status follows the email: a newly added address brings its status, and a provider-verified
  // result upgrades a weaker status on the same address.
  if ((set as Record<string, unknown>).emailLower && clean.emailStatus) {
    (set as Record<string, unknown>).emailStatus = clean.emailStatus;
    sources.emailStatus = { source: prov.source, at: now };
  } else if (clean.emailStatus === "verified_provider" && existing.emailLower === email && existing.emailStatus !== "verified_provider") {
    (set as Record<string, unknown>).emailStatus = "verified_provider";
    sources.emailStatus = { source: prov.source, at: now };
  }
  if (Object.keys(set).length > 0) {
    const [row] = await db.update(contacts).set({ ...set, fieldSources: sources, updatedAt: now }).where(eq(contacts.id, existing.id)).returning();
    return { row, created: false, conflicts };
  }
  return { row: existing, created: false, conflicts };
}
