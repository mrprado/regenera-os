// Portal access control (master build instruction §34, §40, §46, §93–94). Every external read goes through here:
// an explicit grant, plus the gates that apply to the audience (broker standing, capital gate, NDA, distribution
// approval with jurisdiction and dates). Every decision on documents and capital materials is logged.
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import {
  brokerProfiles, capitalOpportunities, dataRoomDocuments, dataRooms, distributionApprovals, documents, investorQualifications, ndaAcceptances,
  organizations, portalAccessLog, portalGrants, portalUsers,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { SECURITIES_ROLES, type GrantEntity } from "./vocab";

type PortalUser = typeof portalUsers.$inferSelect;
const day = (d: Date) => d.toISOString().slice(0, 10);
const live = (now: Date) => and(isNull(portalGrants.revokedAt), or(isNull(portalGrants.expiresAt), gt(portalGrants.expiresAt, now.toISOString())));

export async function logAccess(db: Db, user: Pick<PortalUser, "id">, action: string, entityType: string | null, entityId: string | null, allowed: boolean, reason = "", ip: string | null = null) {
  await db.insert(portalAccessLog).values({ portalUserId: user.id, action, entityType, entityId, allowed, reason, ip });
}

export async function grantAccess(db: Db, input: { portalUserId: string; entityType: GrantEntity; entityId: string; canDownload?: boolean; expiresAt?: string | null; note?: string }, actor: string) {
  const [u] = await db.select().from(portalUsers).where(eq(portalUsers.id, input.portalUserId));
  if (!u) throw new Error("Portal user not found");
  const [existing] = await db.select().from(portalGrants).where(and(eq(portalGrants.portalUserId, u.id), eq(portalGrants.entityType, input.entityType), eq(portalGrants.entityId, input.entityId), isNull(portalGrants.revokedAt)));
  if (existing) {
    await db.update(portalGrants).set({ canDownload: input.canDownload ?? existing.canDownload, expiresAt: input.expiresAt ?? existing.expiresAt }).where(eq(portalGrants.id, existing.id));
    return existing.id;
  }
  const [g] = await db.insert(portalGrants).values({ mandateId: u.mandateId, portalUserId: u.id, entityType: input.entityType, entityId: input.entityId, canDownload: input.canDownload ?? false, expiresAt: input.expiresAt ?? null, note: input.note ?? "", grantedBy: actor }).returning();
  await audit(db, { actor, action: "portal_grant", entity: "portal_grants", entityId: g.id, after: { portalUserId: u.id, entityType: input.entityType, entityId: input.entityId } });
  return g.id;
}

export async function revokeGrant(db: Db, grantId: string, actor: string, now = new Date()) {
  await db.update(portalGrants).set({ revokedAt: now.toISOString() }).where(eq(portalGrants.id, grantId));
  await audit(db, { actor, action: "portal_grant_revoked", entity: "portal_grants", entityId: grantId });
}

export async function activeGrant(db: Db, user: PortalUser, entityType: GrantEntity, entityId: string, now = new Date()) {
  if (user.status !== "active") return null;
  const [g] = await db.select().from(portalGrants).where(and(eq(portalGrants.portalUserId, user.id), eq(portalGrants.entityType, entityType), eq(portalGrants.entityId, entityId), live(now)));
  return g ?? null;
}

export async function grantedIds(db: Db, user: PortalUser, entityType: GrantEntity, now = new Date()) {
  if (user.status !== "active") return [];
  return (await db.select({ id: portalGrants.entityId }).from(portalGrants).where(and(eq(portalGrants.portalUserId, user.id), eq(portalGrants.entityType, entityType), live(now)))).map(r => r.id);
}

export type BrokerStanding = { profile: typeof brokerProfiles.$inferSelect | null; active: boolean; reasons: string[]; securities: boolean };

/** A broker may see deals and materials only while approved, under a signed, unexpired agreement. */
export async function brokerStanding(db: Db, user: PortalUser, now = new Date()): Promise<BrokerStanding> {
  const [profile] = await db.select().from(brokerProfiles).where(eq(brokerProfiles.portalUserId, user.id));
  const reasons: string[] = [];
  if (!profile) return { profile: null, active: false, reasons: ["No broker profile"], securities: false };
  if (profile.complianceStatus !== "approved") reasons.push(`Compliance status: ${profile.complianceStatus.replace(/_/g, " ")}`);
  if (profile.agreementStatus !== "signed") reasons.push("No signed referral agreement");
  if (profile.agreementExpiresAt && profile.agreementExpiresAt < day(now)) reasons.push(`Agreement expired ${profile.agreementExpiresAt}`);
  const securities = SECURITIES_ROLES.has(profile.roleType) && profile.licenseStatus === "verified";
  return { profile, active: reasons.length === 0, reasons, securities };
}

/** Jurisdictions a portal user is known to sit in (broker profile, else their organization's country). */
async function userJurisdictions(db: Db, user: PortalUser) {
  if (user.kind === "broker") {
    const [b] = await db.select({ j: brokerProfiles.jurisdictions }).from(brokerProfiles).where(eq(brokerProfiles.portalUserId, user.id));
    if (b?.j.length) return b.j.map(x => x.toUpperCase());
  }
  if (user.orgId) {
    const [o] = await db.select({ country: organizations.country }).from(organizations).where(eq(organizations.id, user.orgId));
    if (o?.country) return [o.country.toUpperCase()];
  }
  return [];
}

/** Capital users need a current, verified qualification to receive securities-related material. */
async function capitalQualified(db: Db, user: PortalUser, jurisdictions: string[], now: Date) {
  const conds = [user.orgId ? eq(investorQualifications.orgId, user.orgId) : undefined, user.contactId ? eq(investorQualifications.contactId, user.contactId) : undefined].filter(Boolean);
  if (!conds.length) return false;
  const rows = await db.select().from(investorQualifications).where(and(or(...conds), inArray(investorQualifications.verificationStatus, ["third_party_verified", "professionally_verified"])));
  return rows.some(q => (!q.expiresAt || q.expiresAt >= day(now)) && (!jurisdictions.length || jurisdictions.map(j => j.toUpperCase()).includes(q.jurisdiction.toUpperCase())));
}

export type Decision = { allowed: boolean; reason: string; download: boolean; url: string | null; title: string };

/** Can this portal user open this document? Checks, in order: account, grant (direct or through a data room with NDA),
 * audience gates (broker standing), distribution approval (audience, jurisdiction, dates, securities rules). Logged. */
export async function canOpenDocument(db: Db, user: PortalUser, documentId: string, now = new Date(), ip: string | null = null): Promise<Decision> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  const decide = async (allowed: boolean, reason: string, download = false): Promise<Decision> => {
    await logAccess(db, user, allowed ? "document_open" : "document_denied", "document", documentId, allowed, reason, ip);
    return { allowed, reason, download, url: allowed ? doc?.url ?? null : null, title: doc?.title ?? "" };
  };
  if (!doc || doc.mandateId !== user.mandateId) return decide(false, "Not found");
  if (user.status !== "active") return decide(false, "Account not active");

  let download = false, via = "";
  const direct = await activeGrant(db, user, "document", doc.id, now);
  if (direct) { download = direct.canDownload; via = "document grant"; }
  else {
    const roomIds = await grantedIds(db, user, "data_room", now);
    const rooms = roomIds.length ? await db.select({ room: dataRooms }).from(dataRoomDocuments).innerJoin(dataRooms, eq(dataRooms.id, dataRoomDocuments.dataRoomId))
      .where(and(eq(dataRoomDocuments.documentId, doc.id), inArray(dataRooms.id, roomIds), eq(dataRooms.status, "open"))) : [];
    for (const { room } of rooms) {
      if (room.ndaRequired) {
        const [nda] = await db.select({ id: ndaAcceptances.id }).from(ndaAcceptances).where(and(eq(ndaAcceptances.dataRoomId, room.id), eq(ndaAcceptances.portalUserId, user.id), eq(ndaAcceptances.ndaVersion, room.ndaVersion)));
        if (!nda) continue;
      }
      const g = await activeGrant(db, user, "data_room", room.id, now);
      download = download || !!g?.canDownload; via = `data room ${room.name}`;
    }
    if (!via) return decide(false, rooms.length ? "Confidentiality undertaking not accepted" : "No grant");
  }

  if (user.kind === "broker") {
    const s = await brokerStanding(db, user, now);
    if (!s.active) return decide(false, s.reasons.join("; "));
  }
  if (user.kind === "broker" || user.kind === "capital") {
    const approvals = await db.select().from(distributionApprovals).where(and(eq(distributionApprovals.documentId, doc.id), eq(distributionApprovals.audience, user.kind), eq(distributionApprovals.complianceStatus, "approved")));
    const today = day(now);
    const juris = await userJurisdictions(db, user);
    let why = approvals.length ? "" : `No distribution approval for ${user.kind} audiences`;
    for (const a of approvals) {
      if (a.validFrom && a.validFrom > today) { why = `Distribution approved from ${a.validFrom}`; continue; }
      if (a.validUntil && a.validUntil < today) { why = `Distribution approval expired ${a.validUntil}`; continue; }
      if (a.jurisdictions.length && !juris.some(j => a.jurisdictions.map(x => x.toUpperCase()).includes(j))) { why = `Not approved for your jurisdiction${juris.length ? ` (${juris.join(", ")})` : " (unknown)"}`; continue; }
      if (a.securitiesRelated) {
        if (user.kind === "broker" && !(await brokerStanding(db, user, now)).securities) { why = "Securities-related material: requires a verified licensed role"; continue; }
        if (user.kind === "capital" && !(await capitalQualified(db, user, a.jurisdictions, now))) { why = "Securities-related material: requires a current verified investor qualification"; continue; }
      }
      why = "";
      break;
    }
    if (why) return decide(false, why);
  }
  return decide(true, `via ${via}`, download);
}

/** Capital opportunities a capital or broker user may see: granted AND the opportunity's compliance gate is approved
 * AND it is active. A grant alone never overrides the gate. */
export async function visibleOpportunities(db: Db, user: PortalUser, now = new Date()) {
  if (user.kind === "broker" && !(await brokerStanding(db, user, now)).active) return [];
  const ids = await grantedIds(db, user, "capital_opportunity", now);
  if (!ids.length) return [];
  return db.select().from(capitalOpportunities).where(and(inArray(capitalOpportunities.id, ids), eq(capitalOpportunities.gateState, "approved"), eq(capitalOpportunities.status, "active"), eq(capitalOpportunities.mandateId, user.mandateId)));
}
