// Portal view models (master build instruction §35–37, §94). Each returns an explicit, whitelisted shape built from
// granted entities only. Internal notes, match algorithms, investor identities, other parties' bids and compliance
// discussion never enter these objects, so a page cannot leak them by accident.
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  bids, brokerProfiles, capitalMatches, capitalOpportunities, commissionEvents, dataRoomDocuments, dataRooms, documentRequests, documents,
  ndaAcceptances, portalMessages, portalUsers, procurementPackages, projects, projectUpdates, referralRegistrations,
} from "@/db/schema";
import { PACKAGE_CATEGORIES, PACKAGE_STAGES } from "@/lib/procurement/vocab";
import { stageLabel } from "@/lib/projects/labels";
import { brokerStanding, grantedIds, visibleOpportunities } from "./access";
import { DATA_ROOM_FOLDERS, type PortalKind } from "./vocab";

type PortalUser = typeof portalUsers.$inferSelect;

async function updatesFor(db: Db, projectIds: string[], audience: PortalKind) {
  if (!projectIds.length) return [];
  const rows = await db.select({ id: projectUpdates.id, projectId: projectUpdates.projectId, title: projectUpdates.title, body: projectUpdates.body, publishedAt: projectUpdates.publishedAt, audiences: projectUpdates.audiences })
    .from(projectUpdates).where(and(inArray(projectUpdates.projectId, projectIds), isNotNull(projectUpdates.publishedAt), isNotNull(projectUpdates.approvedBy))).orderBy(desc(projectUpdates.publishedAt)).limit(50);
  return rows.filter(r => r.audiences.includes(audience)).map(r => ({ id: r.id, projectId: r.projectId, title: r.title, body: r.body, publishedAt: r.publishedAt }));
}

export async function portalRequests(db: Db, user: PortalUser) {
  return db.select({ id: documentRequests.id, projectId: documentRequests.projectId, title: documentRequests.title, description: documentRequests.description, folder: documentRequests.folder, dueDate: documentRequests.dueDate, status: documentRequests.status, responseNote: documentRequests.responseNote })
    .from(documentRequests).where(and(eq(documentRequests.portalUserId, user.id), sql`${documentRequests.status} <> 'cancelled'`)).orderBy(asc(documentRequests.status), asc(documentRequests.dueDate));
}

export async function portalMessagesFor(db: Db, user: PortalUser) {
  return db.select({ id: portalMessages.id, direction: portalMessages.direction, body: portalMessages.body, author: portalMessages.author, createdAt: portalMessages.createdAt })
    .from(portalMessages).where(eq(portalMessages.portalUserId, user.id)).orderBy(desc(portalMessages.createdAt)).limit(100);
}

/** Documents reachable through grants or open data rooms (titles only; opening goes through canOpenDocument). */
export async function portalDocuments(db: Db, user: PortalUser, now = new Date()) {
  const direct = await grantedIds(db, user, "document", now);
  const roomIds = await grantedIds(db, user, "data_room", now);
  const rooms = roomIds.length ? await db.select().from(dataRooms).where(and(inArray(dataRooms.id, roomIds), eq(dataRooms.status, "open"), eq(dataRooms.mandateId, user.mandateId))) : [];
  const accepted = rooms.length ? await db.select({ roomId: ndaAcceptances.dataRoomId, v: ndaAcceptances.ndaVersion }).from(ndaAcceptances).where(and(eq(ndaAcceptances.portalUserId, user.id), inArray(ndaAcceptances.dataRoomId, rooms.map(r => r.id)))) : [];
  const roomDocs = rooms.length ? await db.select({ roomId: dataRoomDocuments.dataRoomId, documentId: dataRoomDocuments.documentId, folder: dataRoomDocuments.folder }).from(dataRoomDocuments).where(inArray(dataRoomDocuments.dataRoomId, rooms.map(r => r.id))) : [];
  const ids = [...new Set([...direct, ...roomDocs.map(d => d.documentId)])];
  const docs = ids.length ? await db.select({ id: documents.id, title: documents.title, version: documents.version, status: documents.status, updatedAt: documents.updatedAt }).from(documents).where(and(inArray(documents.id, ids), eq(documents.mandateId, user.mandateId))) : [];
  return {
    rooms: rooms.map(r => ({
      id: r.id, name: r.name, ndaRequired: r.ndaRequired, ndaText: r.ndaText, ndaVersion: r.ndaVersion,
      ndaAccepted: !r.ndaRequired || accepted.some(a => a.roomId === r.id && a.v === r.ndaVersion),
      folders: Object.entries(DATA_ROOM_FOLDERS).map(([k, label]) => ({ key: k, label, docs: roomDocs.filter(d => d.roomId === r.id && d.folder === k).map(d => docs.find(x => x.id === d.documentId)).filter(Boolean) as typeof docs })).filter(f => f.docs.length),
    })),
    direct: docs.filter(d => direct.includes(d.id)),
  };
}

export async function sponsorView(db: Db, user: PortalUser, now = new Date()) {
  const ids = await grantedIds(db, user, "project", now);
  const ps = ids.length ? await db.select({ id: projects.id, name: projects.name, stage: projects.stage, status: projects.status, country: projects.country, subdivision: projects.subdivision, stageChangedAt: projects.stageChangedAt })
    .from(projects).where(and(inArray(projects.id, ids), eq(projects.mandateId, user.mandateId))) : [];
  const opps = ps.length ? await db.select({ id: capitalOpportunities.id, projectId: capitalOpportunities.projectId, title: capitalOpportunities.title, instrument: capitalOpportunities.instrument, target: capitalOpportunities.target, currency: capitalOpportunities.currency, status: capitalOpportunities.status })
    .from(capitalOpportunities).where(inArray(capitalOpportunities.projectId, ps.map(p => p.id))) : [];
  // Capital process as counts only: no investor names, no match reasoning.
  const counts = opps.length ? await db.select({ opportunityId: capitalMatches.opportunityId, status: capitalMatches.status, n: sql<number>`count(*)` }).from(capitalMatches).where(inArray(capitalMatches.opportunityId, opps.map(o => o.id))).groupBy(capitalMatches.opportunityId, capitalMatches.status) : [];
  return {
    projects: ps.map(p => ({ ...p, stageLabel: stageLabel(p.stage) })),
    capital: opps.map(o => ({ ...o, investorsApproached: counts.filter(c => c.opportunityId === o.id && c.status === "approved_for_outreach").reduce((s, c) => s + c.n, 0) })),
    updates: await updatesFor(db, ps.map(p => p.id), "sponsor"),
    requests: await portalRequests(db, user),
  };
}

export async function capitalView(db: Db, user: PortalUser, now = new Date()) {
  const opps = await visibleOpportunities(db, user, now);
  const ps = opps.length ? await db.select({ id: projects.id, name: projects.name, sector: projects.sector, assetClass: projects.assetClass, country: projects.country, stage: projects.stage, description: projects.description, capacity: projects.capacity, capacityUnit: projects.capacityUnit })
    .from(projects).where(inArray(projects.id, opps.map(o => o.projectId))) : [];
  return {
    opportunities: opps.map(o => {
      const p = ps.find(x => x.id === o.projectId);
      return {
        id: o.id, title: o.title, instrument: o.instrument, target: o.target, currency: o.currency, offering: o.offering, jurisdictions: o.jurisdictions,
        approvedMaterials: o.approvedMaterials.map(m => ({ title: m.title, version: m.version })),
        project: p ? { name: p.name, sector: p.sector, assetClass: p.assetClass, country: p.country, stage: stageLabel(p.stage), description: p.description, capacity: p.capacity, capacityUnit: p.capacityUnit } : null,
      };
    }),
    updates: await updatesFor(db, opps.map(o => o.projectId), "capital"),
  };
}

export async function brokerView(db: Db, user: PortalUser, now = new Date()) {
  const standing = await brokerStanding(db, user, now);
  const brokerId = standing.profile?.id ?? "-";
  const [regs, fees, opps] = await Promise.all([
    db.select({ id: referralRegistrations.id, targetType: referralRegistrations.targetType, name: referralRegistrations.name, organization: referralRegistrations.organization, status: referralRegistrations.status, createdAt: referralRegistrations.createdAt, expiresAt: referralRegistrations.expiresAt, decisionNote: referralRegistrations.decisionNote })
      .from(referralRegistrations).where(eq(referralRegistrations.brokerId, brokerId)).orderBy(desc(referralRegistrations.createdAt)),
    db.select({ id: commissionEvents.id, amount: commissionEvents.amount, currency: commissionEvents.currency, status: commissionEvents.status, registrationId: commissionEvents.registrationId, paidAt: commissionEvents.paidAt, createdAt: commissionEvents.createdAt })
      .from(commissionEvents).where(eq(commissionEvents.brokerId, brokerId)).orderBy(desc(commissionEvents.createdAt)),
    visibleOpportunities(db, user, now),
  ]);
  const profile = standing.profile;
  return {
    standing: { active: standing.active, reasons: standing.reasons, securities: standing.securities },
    profile: profile ? { roleType: profile.roleType, jurisdictions: profile.jurisdictions, complianceStatus: profile.complianceStatus, agreementStatus: profile.agreementStatus, agreementExpiresAt: profile.agreementExpiresAt, licenseStatus: profile.licenseStatus, specialties: profile.specialties, geographies: profile.geographies } : null,
    referrals: regs,
    fees,
    opportunities: opps.map(o => ({ id: o.id, title: o.title, instrument: o.instrument, target: o.target, currency: o.currency })),
  };
}

export async function brokerIdFor(db: Db, user: PortalUser) {
  const [b] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.portalUserId, user.id));
  return b?.id ?? null;
}

/** Partner sees granted packages and only its own bid (matched by its organization). */
export async function partnerView(db: Db, user: PortalUser, now = new Date()) {
  const ids = await grantedIds(db, user, "procurement_package", now);
  const pkgs = ids.length ? await db.select({ p: procurementPackages, project: projects.name, country: projects.country }).from(procurementPackages).innerJoin(projects, eq(projects.id, procurementPackages.projectId))
    .where(and(inArray(procurementPackages.id, ids), eq(procurementPackages.mandateId, user.mandateId))) : [];
  const own = pkgs.length && user.orgId ? await db.select().from(bids).where(and(inArray(bids.packageId, pkgs.map(x => x.p.id)), eq(bids.orgId, user.orgId))) : [];
  return {
    packages: pkgs.map(({ p, project, country }) => {
      const b = own.find(x => x.packageId === p.id);
      return {
        id: p.id, name: p.name, category: PACKAGE_CATEGORIES[p.category], stage: PACKAGE_STAGES[p.stage], scope: p.scope, project, country, bidsDueAt: p.bidsDueAt, requiredOnSiteAt: p.requiredOnSiteAt,
        esRequirements: p.esRequirements, localContentTargetPct: p.localContentTargetPct, open: ["rfi", "rfp", "clarification", "bafo"].includes(p.stage),
        bid: b ? { status: b.status, price: b.price, currency: b.currency, scheduleWeeks: b.scheduleWeeks, leadTimeWeeks: b.leadTimeWeeks, warrantyYears: b.warrantyYears, exceptions: b.exceptions, submittedAt: b.submittedAt } : null,
      };
    }),
    requests: await portalRequests(db, user),
  };
}

export const stakeholderUpdates = (db: Db, projectIds: string[]) => updatesFor(db, projectIds, "stakeholder");
