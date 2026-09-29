// Global search (docs/master-spec.md part VIII): one scoped query per record type, names and titles only.
// Private investors are included for owners only.
import { and, isNull, like, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  capitalOpportunities, capitalProfiles, capitalStructures, contacts, contracts, dataRooms, deals, decisions, documents, fundingOpportunities, fundingPathways, generatedDocuments,
  interventions, organizations, permits, playbooks, privateCapitalProfiles, procurementPackages, projectMilestones, projects, spatialLayers, studies,
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
  // Delivery, capital structuring and workspace records (master build instruction §42).
  const T = (col: Parameters<typeof sql>[1]) => like(sql`lower(${col})`, pat);
  const [paths, structs, miles, studs, perms, decs, pkgs, ivs, gens, layers, rooms, books] = await Promise.all([
    db.select({ id: fundingPathways.id, name: fundingPathways.name, projectId: fundingPathways.projectId, status: fundingPathways.status }).from(fundingPathways).where(and(mandateCondition(scope, fundingPathways.mandateId), or(T(fundingPathways.name), T(fundingPathways.provider)))).limit(L),
    db.select({ id: capitalStructures.id, name: capitalStructures.name, projectId: capitalStructures.projectId }).from(capitalStructures).where(and(mandateCondition(scope, capitalStructures.mandateId), T(capitalStructures.name))).limit(L),
    db.select({ id: projectMilestones.id, name: projectMilestones.name, projectId: projectMilestones.projectId, status: projectMilestones.status }).from(projectMilestones).where(and(mandateCondition(scope, projectMilestones.mandateId), T(projectMilestones.name))).limit(L),
    db.select({ id: studies.id, title: studies.title, projectId: studies.projectId, status: studies.status }).from(studies).where(and(mandateCondition(scope, studies.mandateId), T(studies.title))).limit(L),
    db.select({ id: permits.id, name: permits.name, projectId: permits.projectId, status: permits.status }).from(permits).where(and(mandateCondition(scope, permits.mandateId), or(T(permits.name), T(permits.authority)))).limit(L),
    db.select({ id: decisions.id, title: decisions.title, projectId: decisions.projectId, status: decisions.status }).from(decisions).where(and(mandateCondition(scope, decisions.mandateId), T(decisions.title))).limit(L),
    db.select({ id: procurementPackages.id, name: procurementPackages.name, projectId: procurementPackages.projectId }).from(procurementPackages).where(and(mandateCondition(scope, procurementPackages.mandateId), T(procurementPackages.name))).limit(L),
    db.select({ id: interventions.id, issue: interventions.systemIssue, projectId: interventions.projectId }).from(interventions).where(and(mandateCondition(scope, interventions.mandateId), or(T(interventions.systemIssue), T(interventions.description)))).limit(L),
    db.select({ id: generatedDocuments.id, title: generatedDocuments.title }).from(generatedDocuments).where(and(mandateCondition(scope, generatedDocuments.mandateId), T(generatedDocuments.title))).limit(L),
    db.select({ id: spatialLayers.id, name: spatialLayers.name, category: spatialLayers.category }).from(spatialLayers).where(and(mandateCondition(scope, spatialLayers.mandateId), T(spatialLayers.name))).limit(L),
    db.select({ id: dataRooms.id, name: dataRooms.name }).from(dataRooms).where(and(mandateCondition(scope, dataRooms.mandateId), T(dataRooms.name))).limit(L),
    db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).where(and(mandateCondition(scope, playbooks.mandateId), T(playbooks.name))).limit(L),
  ]);
  const workspace: SearchHit[] = [
    ...paths.map(x => ({ type: "Funding pathway", label: x.name, sub: x.status.replace(/_/g, " "), href: `/projects/${x.projectId}?tab=pathways` })),
    ...structs.map(x => ({ type: "Capital structure", label: x.name, sub: "stack scenario", href: `/projects/${x.projectId}?tab=stack&structure=${x.id}` })),
    ...miles.map(x => ({ type: "Milestone", label: x.name, sub: x.status.replace(/_/g, " "), href: `/projects/${x.projectId}?tab=plan` })),
    ...studs.map(x => ({ type: "Study", label: x.title, sub: x.status.replace(/_/g, " "), href: `/projects/${x.projectId}?tab=engineering` })),
    ...perms.map(x => ({ type: "Permit", label: x.name, sub: x.status.replace(/_/g, " "), href: `/projects/${x.projectId}?tab=regulatory` })),
    ...decs.map(x => ({ type: "Decision", label: x.title, sub: x.status.replace(/_/g, " "), href: `/projects/${x.projectId}?tab=plan` })),
    ...pkgs.map(x => ({ type: "Procurement package", label: x.name, sub: "", href: `/projects/${x.projectId}?tab=procurement&pkg=${x.id}` })),
    ...ivs.map(x => ({ type: "Intervention", label: x.issue, sub: "", href: `/projects/${x.projectId}?tab=systems` })),
    ...gens.map(x => ({ type: "Generated document", label: x.title, sub: "", href: `/documents/generator/${x.id}` })),
    ...layers.map(x => ({ type: "Atlas layer", label: x.name, sub: x.category.replace(/_/g, " "), href: "/map" })),
    ...rooms.map(x => ({ type: "Data room", label: x.name, sub: "", href: "/portals?tab=rooms" })),
    ...books.map(x => ({ type: "Playbook", label: x.name, sub: "", href: `/playbooks/${x.id}` })),
  ];
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
    ...deal.map(x => ({ type: "Opportunity", label: x.name, sub: x.stage.replace(/_/g, " "), href: `/deals/${x.id}` })),
    ...cons.map(x => ({ type: "Contract", label: x.title, sub: x.lifecycle.replace(/_/g, " "), href: `/contracts/${x.id}` })),
    ...funding.map(x => ({ type: "Funding", label: x.title, sub: x.deadline ? `closes ${x.deadline}` : "rolling", href: `/funding/${x.id}` })),
    ...docs.map(x => ({ type: "Document", label: x.title, sub: `v${x.version}`, href: x.url ?? "/documents" })),
    ...workspace,
  ];
}
