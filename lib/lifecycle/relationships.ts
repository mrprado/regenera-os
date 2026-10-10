// Relationship roles (phase 29A): overlapping labels on people and organizations. Client and former client are derived
// from engagements only (an engagement in delivery or later makes the organization and its primary contact a client;
// when none remains in delivery they become a former client). Meetings, proposals or shared material never do.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, engagements, relationshipRoles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DERIVED_ROLES, type RelationshipRole } from "./vocab";

const IN_DELIVERY = ["contracting", "active", "waiting_on_client", "on_hold", "renewal"] as const;
const DELIVERED = ["complete", "closed"] as const;

export async function rolesFor(db: Db, mandateId: string, entityType: "contact" | "organization", entityId: string) {
  return db.select().from(relationshipRoles).where(and(eq(relationshipRoles.mandateId, mandateId), eq(relationshipRoles.entityType, entityType), eq(relationshipRoles.entityId, entityId)));
}

/** Adds a stated or verified role. Client roles are refused: they come from engagements. */
export async function addRole(db: Db, input: { mandateId: string; entityType: "contact" | "organization"; entityId: string; role: RelationshipRole; basis?: "stated" | "verified"; source?: string; note?: string }, by: string) {
  if (DERIVED_ROLES.includes(input.role)) throw new Error("Client and former client come from agreed engagements; they cannot be set by hand.");
  await db.insert(relationshipRoles).values({ ...input, basis: input.basis ?? "stated", since: new Date().toISOString().slice(0, 10), createdBy: by })
    .onConflictDoUpdate({ target: [relationshipRoles.mandateId, relationshipRoles.entityType, relationshipRoles.entityId, relationshipRoles.role], set: { basis: input.basis ?? "stated", until: null, note: input.note ?? "", updatedAt: new Date().toISOString() } });
  await audit(db, { actor: by, action: "relationship_role_added", entity: input.entityType, entityId: input.entityId, after: { role: input.role } });
}

export async function removeRole(db: Db, mandateId: string, entityType: "contact" | "organization", entityId: string, role: RelationshipRole, by: string) {
  if (DERIVED_ROLES.includes(role)) throw new Error("Client roles follow engagements.");
  await db.update(relationshipRoles).set({ until: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString() }).where(and(eq(relationshipRoles.mandateId, mandateId), eq(relationshipRoles.entityType, entityType), eq(relationshipRoles.entityId, entityId), eq(relationshipRoles.role, role)));
  await audit(db, { actor: by, action: "relationship_role_ended", entity: entityType, entityId, after: { role } });
}

/** Recomputes client / former client for an organization (and the primary contacts on its engagements' deals). */
export async function deriveClientRoles(db: Db, mandateId: string, orgId: string, by: string) {
  const es = await db.select({ id: engagements.id, status: engagements.status, dealId: engagements.dealId }).from(engagements).where(and(eq(engagements.mandateId, mandateId), eq(engagements.orgId, orgId)));
  const live = es.filter(e => (IN_DELIVERY as readonly string[]).includes(e.status));
  const done = es.filter(e => (DELIVERED as readonly string[]).includes(e.status));
  const dealIds = es.map(e => e.dealId).filter((x): x is string => !!x);
  const contacts = dealIds.length ? (await db.select({ contactId: deals.contactId }).from(deals).where(inArray(deals.id, dealIds))).map(d => d.contactId).filter((x): x is string => !!x) : [];
  const today = new Date().toISOString().slice(0, 10);
  for (const [entityType, entityId] of [["organization", orgId] as const, ...contacts.map(c => ["contact", c] as const)]) {
    const set = async (role: "client" | "former_client", on: boolean, from: string | null) => {
      if (on) await db.insert(relationshipRoles).values({ mandateId, entityType, entityId, role, basis: "derived", derivedFrom: from, source: "engagement", since: today, createdBy: by })
        .onConflictDoUpdate({ target: [relationshipRoles.mandateId, relationshipRoles.entityType, relationshipRoles.entityId, relationshipRoles.role], set: { until: null, derivedFrom: from, basis: "derived", updatedAt: new Date().toISOString() } });
      else await db.update(relationshipRoles).set({ until: today, updatedAt: new Date().toISOString() }).where(and(eq(relationshipRoles.mandateId, mandateId), eq(relationshipRoles.entityType, entityType), eq(relationshipRoles.entityId, entityId), eq(relationshipRoles.role, role)));
    };
    await set("client", live.length > 0, live[0]?.id ?? null);
    await set("former_client", !live.length && done.length > 0, done[0]?.id ?? null);
  }
}
