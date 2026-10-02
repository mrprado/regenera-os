// Test-record separation (phase 15 §8): records created for testing stay in the database (never deleted to clean a
// dashboard) but carry test_record = 1, which keeps them out of Command, landing-page metrics, campaign economics, the
// approval queue, the inbox and task lists. Candidates are found by explicit patterns only (example / test domains,
// names that say "test"); an owner reviews and flags them.
import { and, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, deals, organizations, replies, tasks } from "@/db/schema";
import { chunk } from "@/lib/db/chunk";

const TEST_EMAIL = sql`(lower(coalesce(${contacts.emailLower}, '')) like '%@example.%' or lower(coalesce(${contacts.emailLower}, '')) like '%@test.%' or lower(coalesce(${contacts.emailLower}, '')) like '%.test' or lower(coalesce(${contacts.emailLower}, '')) like 'test%@%')`;
const TEST_NAME = (col: unknown) => sql`(lower(${col}) like 'test %' or lower(${col}) like '% test' or lower(${col}) like '%(test)%' or lower(${col}) like 'test-%' or lower(${col}) = 'test' or lower(${col}) like '%testing%' or lower(${col}) like 'demo %')`;

export async function testCandidates(db: Db, mandateIds: string[]) {
  const ids = mandateIds.length ? mandateIds : ["-"];
  const [people, orgs, ds, reps] = await Promise.all([
    db.select({ id: contacts.id, name: contacts.fullName, email: contacts.emailLower, flagged: contacts.testRecord }).from(contacts).where(and(inArray(contacts.mandateId, ids), or(TEST_EMAIL, TEST_NAME(contacts.fullName)))).limit(200),
    db.select({ id: organizations.id, name: organizations.name, domain: organizations.domain, flagged: organizations.testRecord }).from(organizations).where(and(inArray(organizations.mandateId, ids), or(TEST_NAME(organizations.name), sql`lower(coalesce(${organizations.domain}, '')) like 'example.%'`, sql`lower(coalesce(${organizations.domain}, '')) like '%.test'`))).limit(200),
    db.select({ id: deals.id, name: deals.name, flagged: deals.testRecord }).from(deals).where(and(inArray(deals.mandateId, ids), TEST_NAME(deals.name))).limit(200),
    db.select({ id: replies.id, from: replies.fromEmail, subject: replies.subject, flagged: replies.testRecord }).from(replies).where(and(inArray(replies.mandateId, ids), or(sql`lower(${replies.fromEmail}) like '%@example.%'`, sql`lower(${replies.fromEmail}) like '%.test'`, TEST_NAME(replies.subject)))).limit(200),
  ]);
  return { people, orgs, deals: ds, replies: reps };
}

/** Flags (or unflags) records, cascading a person's flag to their replies and tasks. Scoped to the given workspaces. */
export async function setTestRecords(db: Db, mandateIds: string[], input: { contactIds: string[]; orgIds: string[]; dealIds: string[]; replyIds: string[] }, on: boolean) {
  const ws = mandateIds.length ? mandateIds : ["-"];
  let n = 0;
  for (const part of chunk(input.contactIds, 80)) {
    n += (await db.update(contacts).set({ testRecord: on }).where(and(inArray(contacts.mandateId, ws), inArray(contacts.id, part))).returning({ id: contacts.id })).length;
    await db.update(replies).set({ testRecord: on }).where(and(inArray(replies.mandateId, ws), inArray(replies.contactId, part)));
    await db.update(tasks).set({ testRecord: on }).where(and(inArray(tasks.mandateId, ws), inArray(tasks.contactId, part)));
  }
  for (const part of chunk(input.orgIds, 80)) n += (await db.update(organizations).set({ testRecord: on }).where(and(inArray(organizations.mandateId, ws), inArray(organizations.id, part))).returning({ id: organizations.id })).length;
  for (const part of chunk(input.dealIds, 80)) {
    n += (await db.update(deals).set({ testRecord: on }).where(and(inArray(deals.mandateId, ws), inArray(deals.id, part))).returning({ id: deals.id })).length;
    await db.update(tasks).set({ testRecord: on }).where(and(inArray(tasks.mandateId, ws), inArray(tasks.dealId, part)));
  }
  for (const part of chunk(input.replyIds, 80)) n += (await db.update(replies).set({ testRecord: on }).where(and(inArray(replies.mandateId, ws), inArray(replies.id, part))).returning({ id: replies.id })).length;
  return n;
}

export const isTestFlagged = (r: { testRecord?: boolean | null }) => r.testRecord === true || (r.testRecord as unknown) === 1;
