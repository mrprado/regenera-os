// Read models for People, Companies, Lists and records. Every query is mandate-scoped.
import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { accountQualifications, activities, contacts, deals, dossiers, listMembers, lists, organizations, scores, segments, triggers } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { freshnessSince } from "@/lib/freshness";

const PAGE = 50;
const like_ = (q: string) => `%${q.toLowerCase()}%`;

export type OrgFilters = { q?: string; sector?: string; country?: string; segment?: string; source?: string; trigger?: string; list?: string; sort?: string; page?: number; qualification?: string; missing?: string; tests?: string };

export async function listOrganizations(scope: Scope, f: OrgFilters) {
  const db = appDb();
  const since = freshnessSince().toISOString().slice(0, 10);
  const triggerCount = sql<number>`(select count(*) from ${triggers} t where t.org_id = ${organizations.id} and t.event_date >= ${since} and t.status <> 'dismissed')`;
  const peopleCount = sql<number>`(select count(*) from ${contacts} c where c.org_id = ${organizations.id} and c.archived_at is null)`;
  const openDeals = sql<number>`(select count(*) from ${deals} d where d.org_id = ${organizations.id} and d.stage not in ('lost','churned','completed'))`;
  const conds: (SQL | undefined)[] = [
    mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt),
    f.q ? or(like(sql`lower(${organizations.name})`, like_(f.q)), like(organizations.domain, like_(f.q)), like(sql`lower(coalesce(${organizations.location}, ''))`, like_(f.q))) : undefined,
    f.sector ? eq(organizations.sector, f.sector) : undefined,
    f.country ? like(sql`lower(coalesce(${organizations.country}, '') || ' ' || coalesce(${organizations.location}, ''))`, like_(f.country)) : undefined,
    f.segment ? eq(organizations.segmentId, f.segment) : undefined,
    f.source ? eq(organizations.source, f.source as never) : undefined,
    f.trigger === "yes" ? sql`${triggerCount} > 0` : undefined,
    f.list ? inArray(organizations.id, db.select({ id: listMembers.entityId }).from(listMembers).where(eq(listMembers.listId, f.list))) : undefined,
    f.qualification ? inArray(organizations.id, db.select({ id: accountQualifications.orgId }).from(accountQualifications).where(eq(accountQualifications.status, f.qualification as never))) : undefined,
    f.missing === "location" ? or(isNull(organizations.lat), isNull(organizations.lng)) : f.missing === "website" ? and(isNull(organizations.website), isNull(organizations.domain)) : undefined,
    f.tests === "1" ? undefined : eq(organizations.testRecord, false),
  ];
  const where = and(...conds);
  const order = f.sort === "name" ? asc(organizations.name) : f.sort === "recent" ? desc(organizations.createdAt) : desc(triggerCount);
  const page = Math.max(1, f.page ?? 1);
  const rows = await db.select({
    id: organizations.id, name: organizations.name, domain: organizations.domain, sector: organizations.sector, industry: organizations.industry,
    country: organizations.country, location: organizations.location, headcount: organizations.headcount, source: organizations.source,
    lei: organizations.lei, wikidataId: organizations.wikidataId, lat: organizations.lat, createdAt: organizations.createdAt,
    triggers: triggerCount, people: peopleCount, openDeals,
  }).from(organizations).where(where).orderBy(order, asc(organizations.name)).limit(PAGE).offset((page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(organizations).where(where);
  return { rows, total, page, pageSize: PAGE };
}

export type PeopleFilters = { q?: string; title?: string; seniority?: string; emailStatus?: string; tier?: string; state?: string; segment?: string; source?: string; list?: string; org?: string; sort?: string; page?: number };

export async function listContacts(scope: Scope, f: PeopleFilters) {
  const db = appDb();
  const conds: (SQL | undefined)[] = [
    mandateCondition(scope, contacts.mandateId), isNull(contacts.archivedAt),
    f.q ? or(like(sql`lower(${contacts.fullName})`, like_(f.q)), like(contacts.emailLower, like_(f.q)), like(sql`lower(coalesce(${organizations.name}, ''))`, like_(f.q))) : undefined,
    f.title ? like(sql`lower(coalesce(${contacts.title}, ''))`, like_(f.title)) : undefined,
    f.seniority ? eq(contacts.seniority, f.seniority) : undefined,
    f.emailStatus ? eq(contacts.emailStatus, f.emailStatus as never) : undefined,
    f.tier ? eq(contacts.tier, f.tier as never) : undefined,
    f.state ? eq(contacts.leadState, f.state as never) : undefined,
    f.segment ? eq(contacts.segmentId, f.segment) : undefined,
    f.source ? eq(contacts.source, f.source as never) : undefined,
    f.org ? eq(contacts.orgId, f.org) : undefined,
    f.list ? inArray(contacts.id, db.select({ id: listMembers.entityId }).from(listMembers).where(eq(listMembers.listId, f.list))) : undefined,
  ];
  const where = and(...conds);
  const order = f.sort === "name" ? asc(contacts.fullName) : f.sort === "recent" ? desc(contacts.createdAt) : desc(sql`coalesce(${contacts.score}, -1)`);
  const page = Math.max(1, f.page ?? 1);
  const rows = await db.select({
    id: contacts.id, fullName: contacts.fullName, title: contacts.title, seniority: contacts.seniority, email: contacts.email,
    emailStatus: contacts.emailStatus, linkedinUrl: contacts.linkedinUrl, location: contacts.location, score: contacts.score, tier: contacts.tier,
    leadState: contacts.leadState, source: contacts.source, orgId: organizations.id, orgName: organizations.name, orgDomain: organizations.domain,
  }).from(contacts).leftJoin(organizations, eq(organizations.id, contacts.orgId)).where(where).orderBy(order, asc(contacts.fullName)).limit(PAGE).offset((page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(contacts).leftJoin(organizations, eq(organizations.id, contacts.orgId)).where(where);
  return { rows, total, page, pageSize: PAGE };
}

export async function listSegments() {
  return appDb().select({ id: segments.id, key: segments.key, name: segments.name, group: segments.group, enabled: segments.enabled, apolloFilters: segments.apolloFilters, titles: segments.titles })
    .from(segments).orderBy(asc(segments.group), asc(segments.name));
}

export async function listLists(scope: Scope, kind?: "people" | "companies") {
  const db = appDb();
  return db.select({
    id: lists.id, name: lists.name, kind: lists.kind, createdAt: lists.createdAt,
    count: sql<number>`(select count(*) from ${listMembers} m where m.list_id = ${lists.id})`,
  }).from(lists).where(and(mandateCondition(scope, lists.mandateId), kind ? eq(lists.kind, kind) : undefined)).orderBy(asc(lists.name));
}

export async function getOrganization(scope: Scope, id: string) {
  const db = appDb();
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, id), mandateCondition(scope, organizations.mandateId)));
  if (!org) return null;
  const since = freshnessSince().toISOString().slice(0, 10);
  const [people, orgTriggers, orgDeals, timeline, [dossier], parent, segment] = await Promise.all([
    db.select().from(contacts).where(and(eq(contacts.orgId, id), isNull(contacts.archivedAt))).orderBy(desc(sql`coalesce(${contacts.score}, -1)`)),
    db.select().from(triggers).where(and(eq(triggers.orgId, id), gte(triggers.eventDate, since))).orderBy(desc(triggers.eventDate)),
    db.select().from(deals).where(and(eq(deals.orgId, id), isNull(deals.archivedAt))).orderBy(desc(deals.updatedAt)),
    db.select().from(activities).where(eq(activities.orgId, id)).orderBy(desc(activities.occurredAt)).limit(100),
    db.select().from(dossiers).where(eq(dossiers.orgId, id)).orderBy(desc(dossiers.createdAt)).limit(1),
    org.parentOrgId ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, org.parentOrgId)) : Promise.resolve([]),
    org.segmentId ? db.select().from(segments).where(eq(segments.id, org.segmentId)) : Promise.resolve([]),
  ]);
  return { org, people, triggers: orgTriggers, deals: orgDeals, timeline, dossier: dossier ?? null, parent: parent[0] ?? null, segment: segment[0] ?? null };
}

export async function getContact(scope: Scope, id: string) {
  const db = appDb();
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, id), mandateCondition(scope, contacts.mandateId)));
  if (!c) return null;
  const [org] = c.orgId ? await db.select().from(organizations).where(eq(organizations.id, c.orgId)) : [];
  const [[score], timeline, contactDeals] = await Promise.all([
    db.select().from(scores).where(eq(scores.contactId, id)).orderBy(desc(scores.scoredAt)).limit(1),
    db.select().from(activities).where(eq(activities.contactId, id)).orderBy(desc(activities.occurredAt)).limit(100),
    db.select().from(deals).where(eq(deals.contactId, id)).orderBy(desc(deals.updatedAt)),
  ]);
  const [dossier] = c.orgId ? await db.select().from(dossiers).where(eq(dossiers.orgId, c.orgId)).orderBy(desc(dossiers.createdAt)).limit(1) : [];
  return { contact: c, org: org ?? null, score: score ?? null, timeline, deals: contactDeals, dossier: dossier ?? null };
}
