// Global search (docs/master-spec.md part VIII): one scoped query per record type, names and titles only.
// Private investors are included for owners only.
import { and, isNull, like, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  capitalOpportunities, capitalProfiles, contacts, contracts, deals, documents, fundingOpportunities, organizations, privateCapitalProfiles, projects,
} from "@/db/schema";
import { isOwner, mandateCondition, type UserScope } from "@/lib/db/scoped";

export type SearchHit = { type: string; label: string; sub: string; href: string };

export async function globalSearch(db: Db, scope: UserScope, q: string): Promise<SearchHit[]> {
  const term = q.trim().toLowerCase().slice(0, 80);
  if (term.length < 2) return [];
  const pat = `%${term}%`;
  const L = 5;
  const [ps, people, orgs, partners, opps, cons, funding, docs, deal] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, country: projects.country, stage: projects.stage }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt), like(sql`lower(${projects.name})`, pat))).limit(L),
    db.select({ id: contacts.id, name: contacts.fullName, title: contacts.title }).from(contacts).where(and(mandateCondition(scope, contacts.mandateId), or(like(sql`lower(${contacts.fullName})`, pat), like(sql`lower(coalesce(${contacts.email}, ''))`, pat)))).limit(L),
    db.select({ id: organizations.id, name: organizations.name, country: organizations.country }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt), or(like(sql`lower(${organizations.name})`, pat), like(sql`lower(coalesce(${organizations.domain}, ''))`, pat)))).limit(L),
    db.select({ id: capitalProfiles.id, name: capitalProfiles.name, type: capitalProfiles.capitalType }).from(capitalProfiles).where(and(mandateCondition(scope, capitalProfiles.mandateId), like(sql`lower(${capitalProfiles.name})`, pat))).limit(L),
    db.select({ id: capitalOpportunities.id, title: capitalOpportunities.title, gate: capitalOpportunities.gateState }).from(capitalOpportunities).where(and(mandateCondition(scope, capitalOpportunities.mandateId), like(sql`lower(${capitalOpportunities.title})`, pat))).limit(L),
    db.select({ id: contracts.id, title: contracts.title, lifecycle: contracts.lifecycle }).from(contracts).where(and(mandateCondition(scope, contracts.mandateId), like(sql`lower(${contracts.title})`, pat))).limit(L),
    db.select({ id: fundingOpportunities.id, title: fundingOpportunities.title, deadline: fundingOpportunities.deadline }).from(fundingOpportunities).where(and(mandateCondition(scope, fundingOpportunities.mandateId), sql`${fundingOpportunities.status} != 'closed'`, or(like(sql`lower(${fundingOpportunities.title})`, pat), like(sql`lower(coalesce(${fundingOpportunities.funder}, ''))`, pat)))).limit(L),
    db.select({ id: documents.id, title: documents.title, url: documents.url, version: documents.version }).from(documents).where(and(mandateCondition(scope, documents.mandateId), sql`${documents.status} != 'superseded'`, like(sql`lower(${documents.title})`, pat))).limit(L),
    db.select({ id: deals.id, name: deals.name, stage: deals.stage }).from(deals).where(and(mandateCondition(scope, deals.mandateId), isNull(deals.archivedAt), like(sql`lower(${deals.name})`, pat))).limit(L),
  ]);
  const priv = isOwner(scope)
    ? await db.select({ id: privateCapitalProfiles.id, name: contacts.fullName }).from(privateCapitalProfiles).innerJoin(contacts, sql`${contacts.id} = ${privateCapitalProfiles.contactId}`)
      .where(and(mandateCondition(scope, privateCapitalProfiles.mandateId), like(sql`lower(${contacts.fullName})`, pat))).limit(L)
    : [];
  return [
    ...ps.map(x => ({ type: "Project", label: x.name, sub: [x.stage.replace(/_/g, " "), x.country].filter(Boolean).join(" · "), href: `/projects/${x.id}` })),
    ...opps.map(x => ({ type: "Capital opportunity", label: x.title, sub: `gate ${x.gate.replace(/_/g, " ")}`, href: `/capital/opportunities/${x.id}` })),
    ...partners.map(x => ({ type: "Capital partner", label: x.name, sub: x.type.replace(/_/g, " "), href: `/capital/partners/${x.id}` })),
    ...priv.map(x => ({ type: "Private investor", label: x.name, sub: "owners only", href: `/capital/private/${x.id}` })),
    ...orgs.map(x => ({ type: "Company", label: x.name, sub: x.country ?? "", href: `/companies/${x.id}` })),
    ...people.map(x => ({ type: "Person", label: x.name, sub: x.title ?? "", href: `/people/${x.id}` })),
    ...deal.map(x => ({ type: "Opportunity", label: x.name, sub: x.stage.replace(/_/g, " "), href: "/deals?view=table" })),
    ...cons.map(x => ({ type: "Contract", label: x.title, sub: x.lifecycle.replace(/_/g, " "), href: `/contracts/${x.id}` })),
    ...funding.map(x => ({ type: "Funding", label: x.title, sub: x.deadline ? `closes ${x.deadline}` : "rolling", href: `/funding/${x.id}` })),
    ...docs.map(x => ({ type: "Document", label: x.title, sub: `v${x.version}`, href: x.url ?? "/documents" })),
  ];
}
