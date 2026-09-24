// Privacy requests (GDPR, LGPD, PECR; docs/plans/phase-4.md item 7). Access: everything held about one person as
// JSON. Erasure: personal data deleted, activities anonymized, and only a SHA-256 of the address kept as a
// suppression entry so the person is never imported and emailed again. Both are logged without the address.
import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db";
import {
  activities, contacts, deals, dossiers, enrollments, listMembers, meetingBriefs, messages, organizations, privacyRequests, relationships,
  replies, scores, searchResults, siteEvents, suppression, tasks,
} from "@/db/schema";

export async function emailHash(email: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const hashedSuppressionKey = async (email: string) => `sha256:${await emailHash(email)}`;

export async function isErasedAddress(db: Db, email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const [row] = await db.select({ id: suppression.id }).from(suppression).where(eq(suppression.email, await hashedSuppressionKey(email)));
  return !!row;
}

export async function exportPerson(db: Db, mandateIds: string[], contactId: string, actor: string) {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), inArray(contacts.mandateId, mandateIds)));
  if (!c) return null;
  const [org] = c.orgId ? await db.select({ name: organizations.name, domain: organizations.domain }).from(organizations).where(eq(organizations.id, c.orgId)) : [];
  const data = {
    exportedAt: new Date().toISOString(),
    person: { ...c },
    organization: org ?? null,
    activities: await db.select().from(activities).where(eq(activities.contactId, c.id)),
    messages: await db.select().from(messages).where(eq(messages.contactId, c.id)),
    replies: await db.select().from(replies).where(eq(replies.contactId, c.id)),
    sequences: await db.select().from(enrollments).where(eq(enrollments.contactId, c.id)),
    tasks: await db.select().from(tasks).where(eq(tasks.contactId, c.id)),
    scores: await db.select().from(scores).where(eq(scores.contactId, c.id)),
    lists: await db.select({ listId: listMembers.listId }).from(listMembers).where(eq(listMembers.entityId, c.id)),
    siteForms: await db.select({ kind: siteEvents.kind, payload: siteEvents.payload, receivedAt: siteEvents.receivedAt }).from(siteEvents).where(eq(siteEvents.contactId, c.id)),
    meetings: await db.select({ title: meetingBriefs.title, startsAt: meetingBriefs.startsAt }).from(meetingBriefs).where(eq(meetingBriefs.contactId, c.id)),
    correspondenceMetadata: c.emailLower ? await db.select({ mailbox: relationships.mailbox, sent: relationships.emailsSent, received: relationships.emailsReceived, meetings: relationships.meetings, last: relationships.lastContactAt })
      .from(relationships).where(eq(relationships.email, c.emailLower)) : [],
  };
  await db.insert(privacyRequests).values({ mandateId: c.mandateId, kind: "access", subjectHash: c.emailLower ? await emailHash(c.emailLower) : `contact:${c.id}`, actor, detail: { sections: Object.keys(data).length } });
  return data;
}

export async function erasePerson(db: Db, mandateIds: string[], contactId: string, actor: string) {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), inArray(contacts.mandateId, mandateIds)));
  if (!c) return null;
  const now = new Date().toISOString();
  const subjectHash = c.emailLower ? await emailHash(c.emailLower) : `contact:${c.id}`;
  if (c.emailLower) {
    await db.insert(suppression).values({ email: await hashedSuppressionKey(c.emailLower), reason: "legal" }).onConflictDoNothing();
    // A plain suppression row for this address (e.g. an earlier unsubscribe) would keep the address itself.
    await db.delete(suppression).where(eq(suppression.email, c.emailLower));
    await db.delete(relationships).where(eq(relationships.email, c.emailLower));
  }
  const counts = {
    activities: (await db.update(activities).set({ contactId: null, detail: "[erased on request]" }).where(eq(activities.contactId, c.id)).returning({ id: activities.id })).length,
    messages: (await db.delete(messages).where(eq(messages.contactId, c.id)).returning({ id: messages.id })).length,
    replies: (await db.delete(replies).where(eq(replies.contactId, c.id)).returning({ id: replies.id })).length,
  };
  await db.delete(enrollments).where(eq(enrollments.contactId, c.id));
  await db.delete(tasks).where(eq(tasks.contactId, c.id));
  await db.delete(scores).where(eq(scores.contactId, c.id));
  await db.delete(listMembers).where(eq(listMembers.entityId, c.id));
  await db.update(siteEvents).set({ payload: { erased: true }, contactId: null, updatedAt: now }).where(eq(siteEvents.contactId, c.id));
  await db.update(meetingBriefs).set({ contactId: null, brief: null, updatedAt: now }).where(eq(meetingBriefs.contactId, c.id));
  await db.update(deals).set({ contactId: null, updatedAt: now }).where(eq(deals.contactId, c.id));
  await db.update(dossiers).set({ contactId: null }).where(eq(dossiers.contactId, c.id));
  if (c.apolloPersonId) await db.delete(searchResults).where(or(eq(searchResults.externalId, c.apolloPersonId)));
  await db.delete(contacts).where(eq(contacts.id, c.id));
  await db.insert(privacyRequests).values({ mandateId: c.mandateId, kind: "erasure", subjectHash, actor, detail: counts });
  return counts;
}
