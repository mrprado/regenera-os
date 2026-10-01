// Read model for /intelligence/mail (docs/plans/phase-13-mail-intelligence.md). Mail is the owner's correspondence:
// every query is scoped to workspaces the user owns, never to plain membership, and none of it reaches Ask or MCP.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { mailAttachments, mailCampaigns, mailFacts, mailIngestionRuns, mailIntroductions, mailMessages as mailMessagesT, mailObligations, mailPeople, mailReviewItems, mailSources, mailThreads } from "@/db/schema";
import type { UserScope } from "@/lib/db/scoped";
import { LOW_SIGNAL } from "./classify";

/** Workspaces whose mail this user may read: owners only. */
export const mailMandates = (scope: UserScope) => scope.ownerOf;

export async function mailOverview(db: Db, scope: UserScope) {
  const ms = mailMandates(scope);
  if (!ms.length) return null;
  const sources = await db.select().from(mailSources).where(inArray(mailSources.mandateId, ms));
  if (!sources.length) return { sources, runs: [], counts: null };
  const accounts = sources.map(s => s.account);
  const n = async (t: typeof mailThreads | typeof mailPeople | typeof mailObligations | typeof mailReviewItems | typeof mailMessagesT, extra?: ReturnType<typeof sql>) => {
    const [r] = await db.select({ n: sql<number>`count(*)` }).from(t).where(and(inArray(t.mandateId, ms), extra ?? sql`1 = 1`));
    return r?.n ?? 0;
  };
  const notLow = sql`mail_class not in (${sql.join(LOW_SIGNAL.map(m => sql`${m}`), sql`, `)})`;
  const [runs, threads, substantive, messages, people, openObligations, awaitingMe, openReviews] = await Promise.all([
    db.select().from(mailIngestionRuns).where(inArray(mailIngestionRuns.account, accounts)).orderBy(desc(mailIngestionRuns.startedAt)).limit(10),
    n(mailThreads), n(mailThreads, notLow), n(mailMessagesT), n(mailPeople, sql`low_signal = 0 and kind = 'person'`),
    n(mailObligations, sql`status = 'open'`), n(mailThreads, sql`awaiting_reply_from = 'me'`), n(mailReviewItems, sql`status = 'open'`),
  ]);
  const c = { threads, substantive, messages, people, openObligations, awaitingMe, openReviews };
  return { sources, runs, counts: c };
}

export async function mailThreadList(db: Db, scope: UserScope, opts: { q?: string; cls?: string; awaiting?: string; all?: boolean }) {
  const ms = mailMandates(scope);
  if (!ms.length) return [];
  const where = [inArray(mailThreads.mandateId, ms)];
  if (!opts.all) where.push(sql`${mailThreads.mailClass} not in (${sql.join(LOW_SIGNAL.map(m => sql`${m}`), sql`, `)})`);
  if (opts.cls) where.push(eq(mailThreads.mailClass, opts.cls));
  if (opts.awaiting) where.push(eq(mailThreads.awaitingReplyFrom, opts.awaiting));
  if (opts.q) where.push(sql`(lower(${mailThreads.subject}) like ${`%${opts.q.toLowerCase()}%`} or lower(${mailThreads.summary}) like ${`%${opts.q.toLowerCase()}%`} or lower(${mailThreads.participants}) like ${`%${opts.q.toLowerCase()}%`})`);
  return db.select().from(mailThreads).where(and(...where)).orderBy(desc(mailThreads.lastAt)).limit(300);
}

export async function mailPeopleList(db: Db, scope: UserScope, all = false) {
  const ms = mailMandates(scope);
  if (!ms.length) return [];
  return db.select().from(mailPeople).where(and(inArray(mailPeople.mandateId, ms), all ? sql`1 = 1` : and(eq(mailPeople.lowSignal, false), eq(mailPeople.kind, "person"))))
    .orderBy(desc(mailPeople.lastAt)).limit(400);
}

export async function mailLedgers(db: Db, scope: UserScope) {
  const ms = mailMandates(scope);
  if (!ms.length) return { obligations: [], introductions: [], facts: [], attachments: [], reviews: [], campaigns: [] };
  const [obligations, introductions, facts, attachments, reviews, campaigns] = await Promise.all([
    db.select().from(mailObligations).where(inArray(mailObligations.mandateId, ms)).orderBy(sql`${mailObligations.status} = 'open' desc`, desc(mailObligations.createdAt)).limit(300),
    db.select().from(mailIntroductions).where(inArray(mailIntroductions.mandateId, ms)).orderBy(desc(mailIntroductions.date)).limit(200),
    db.select().from(mailFacts).where(inArray(mailFacts.mandateId, ms)).orderBy(desc(mailFacts.createdAt)).limit(300),
    db.select().from(mailAttachments).where(inArray(mailAttachments.mandateId, ms)).orderBy(desc(mailAttachments.createdAt)).limit(300),
    db.select().from(mailReviewItems).where(inArray(mailReviewItems.mandateId, ms)).orderBy(sql`${mailReviewItems.status} = 'open' desc`, desc(mailReviewItems.createdAt)).limit(200),
    db.select().from(mailCampaigns).where(inArray(mailCampaigns.mandateId, ms)).orderBy(desc(mailCampaigns.startedAt)).limit(100),
  ]);
  return { obligations, introductions, facts, attachments, reviews, campaigns };
}

/** Command / Today items: replies owed and open obligations, owner only. */
export async function mailCommand(db: Db, scope: UserScope) {
  const ms = mailMandates(scope);
  if (!ms.length) return { awaiting: [], obligations: [] };
  const [awaiting, obligations] = await Promise.all([db.select({ key: mailThreads.key, subject: mailThreads.subject, lastAt: mailThreads.lastAt, summary: mailThreads.summary }).from(mailThreads)
    .where(and(inArray(mailThreads.mandateId, ms), eq(mailThreads.awaitingReplyFrom, "me"), sql`${mailThreads.mailClass} not in (${sql.join(LOW_SIGNAL.map(m => sql`${m}`), sql`, `)})`))
    .orderBy(desc(mailThreads.lastAt)).limit(8),
  db.select().from(mailObligations).where(and(inArray(mailObligations.mandateId, ms), eq(mailObligations.status, "open"))).orderBy(desc(mailObligations.createdAt)).limit(8)]);
  return { awaiting, obligations };
}

export async function setObligationStatus(db: Db, scope: UserScope, id: string, status: "open" | "done" | "dropped") {
  await db.update(mailObligations).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(mailObligations.id, id), inArray(mailObligations.mandateId, mailMandates(scope))));
}

export async function resolveReview(db: Db, scope: UserScope, id: string, status: "accepted" | "rejected") {
  await db.update(mailReviewItems).set({ status, resolvedBy: scope.email, resolvedAt: new Date().toISOString() }).where(and(eq(mailReviewItems.id, id), inArray(mailReviewItems.mandateId, mailMandates(scope))));
}
