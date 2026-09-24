// Reply watcher and routing (docs/plans/phase-2.md items 8 and 9, SPEC section 10).
// Reads Gmail history since the stored cursor, keeps only mail from CRM contacts (thread first, then sender),
// classifies with Haiku, and routes. Any real reply stops every enrollment at that organization.
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { activities, contacts, dossiers, enrollments, mailboxState, messages, organizations, replies, suppression, tasks } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { advanceDeal } from "@/lib/crm/deals";
import { gmailGetMessage, gmailHistorySince, gmailProfile, header, plainBody } from "@/lib/google/gmail";
import { enqueue } from "@/lib/jobs/queue";
import { validateMessage } from "@/lib/style/validate";
import { REPLY_CLASSES } from "@/lib/vocab";
import { applyUnsubscribe } from "./unsubscribe";
import type { MailboxRoleName } from "./sender";

export type WatchDeps = {
  roles: MailboxRoleName[];
  getToken: (role: MailboxRoleName) => Promise<{ accessToken: string; email: string }>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

const PENDING = ["draft", "style_failed", "pending_approval", "approved"] as const;

export function parseAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function isBounce(from: string, subject: string) {
  return /mailer-daemon|postmaster/i.test(from) || /delivery status notification|undeliverable|delivery has failed|returned mail/i.test(subject);
}

/** One pass per connected mailbox. Returns the number of new CRM replies stored. */
export async function watchReplies(db: Db, deps: WatchDeps): Promise<number> {
  const now = deps.now ?? new Date();
  let stored = 0;
  for (const role of deps.roles) {
    const { accessToken, email: mailboxEmail } = await deps.getToken(role);
    const [st] = await db.select().from(mailboxState).where(eq(mailboxState.role, role));
    if (!st?.historyId) {
      const p = await gmailProfile(accessToken, deps.fetchImpl);
      await db.insert(mailboxState).values({ role, day: now.toISOString().slice(0, 10), historyId: p.historyId })
        .onConflictDoUpdate({ target: mailboxState.role, set: { historyId: p.historyId } });
      continue;
    }
    const h = await gmailHistorySince(accessToken, st.historyId, deps.fetchImpl);
    if (!h) { // cursor expired: restart from now (Gmail keeps about a week of history)
      const p = await gmailProfile(accessToken, deps.fetchImpl);
      await db.update(mailboxState).set({ historyId: p.historyId }).where(eq(mailboxState.role, role));
      continue;
    }
    for (const ref of h.messages) {
      const [seen] = await db.select({ id: replies.id }).from(replies).where(eq(replies.gmailMessageId, ref.id));
      if (seen) continue;
      const msg = await gmailGetMessage(accessToken, ref.id, "full", deps.fetchImpl);
      if (!msg) continue;
      const fromRaw = header(msg, "From") ?? "";
      const from = parseAddress(fromRaw);
      if (from === mailboxEmail.toLowerCase()) continue;
      const subject = header(msg, "Subject") ?? "";
      // Match: our outbound message in the same thread, else a contact with that address.
      const [out] = await db.select().from(messages).where(and(eq(messages.gmailThreadId, ref.threadId), eq(messages.direction, "out"))).orderBy(desc(messages.sentAt)).limit(1);
      const [contact] = out
        ? await db.select().from(contacts).where(eq(contacts.id, out.contactId))
        : await db.select().from(contacts).where(eq(contacts.emailLower, from)).limit(1);
      if (!contact) continue; // not CRM mail: never stored
      const bounce = isBounce(fromRaw, subject);
      const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : now.toISOString();
      const [r] = await db.insert(replies).values({
        mandateId: contact.mandateId, contactId: contact.id, orgId: contact.orgId, messageId: out?.id ?? null,
        gmailMessageId: ref.id, gmailThreadId: ref.threadId, fromEmail: from, subject, snippet: msg.snippet ?? "",
        body: plainBody(msg).slice(0, 20_000), receivedAt,
        classification: bounce ? "bounce" : null, needsHuman: !bounce,
      }).onConflictDoNothing().returning({ id: replies.id });
      if (!r) continue;
      stored++;
      if (bounce) await routeReply(db, r.id, { classification: "bounce", sentiment: "neutral", needs_human: false, summary: "Delivery failure", referral_name: "", referral_email: "", return_date: "", whole_org_unsubscribe: false }, now);
      else await enqueue(db, "reply.classify", { replyId: r.id }, { dedupeKey: `reply:${r.id}`, now });
    }
    await db.update(mailboxState).set({ historyId: h.historyId }).where(eq(mailboxState.role, role));
  }
  return stored;
}

export const zClassification = z.object({
  classification: z.enum(REPLY_CLASSES),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  needs_human: z.boolean(),
  summary: z.string().describe("One sentence"),
  referral_name: z.string().describe("Empty if none"),
  referral_email: z.string().describe("Empty if none"),
  return_date: z.string().describe("YYYY-MM-DD for out_of_office, else empty"),
  whole_org_unsubscribe: z.boolean(),
});
export type Classification = z.infer<typeof zClassification>;

export async function classifyReply(db: Db, cfg: AiConfig, replyId: string, client?: Anthropic, now = new Date()) {
  const [r] = await db.select().from(replies).where(eq(replies.id, replyId));
  if (!r || r.classification) return;
  const [orig] = r.messageId ? await db.select({ subject: messages.subject, body: messages.body }).from(messages).where(eq(messages.id, r.messageId)) : [];
  const input = `${orig ? `Our email:\nSubject: ${orig.subject}\n${orig.body}\n\n` : ""}Their reply (from ${r.fromEmail}):\nSubject: ${r.subject}\n${r.body.slice(0, 6000)}`;
  const c = await runStructured(db, cfg, "reply.classify", input, zClassification, { entity: "reply", entityId: r.id }, client);
  await routeReply(db, r.id, c, now);
}

async function stopOrgEnrollments(db: Db, contact: typeof contacts.$inferSelect, reason: string, now: Date) {
  const ids = contact.orgId
    ? (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.orgId, contact.orgId))).map(x => x.id)
    : [contact.id];
  await db.update(enrollments).set({ status: "stopped", stopReason: reason, updatedAt: now.toISOString() })
    .where(and(inArray(enrollments.contactId, ids), inArray(enrollments.status, ["drafting", "active", "paused"])));
  await db.update(messages).set({ status: "cancelled", updatedAt: now.toISOString() })
    .where(and(inArray(messages.contactId, ids), inArray(messages.status, [...PENDING]), eq(messages.direction, "out")));
  await db.update(tasks).set({ status: "skipped" }).where(and(inArray(tasks.contactId, ids), eq(tasks.status, "open"), inArray(tasks.type, ["linkedin_connect", "linkedin_message"])));
}

/** Routing per SPEC section 10. Idempotent on the reply's classification. */
export async function routeReply(db: Db, replyId: string, c: Classification, now = new Date()) {
  const [r] = await db.select().from(replies).where(eq(replies.id, replyId));
  if (!r?.contactId) return;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
  if (!contact) return;
  const iso = now.toISOString();
  await db.update(replies).set({
    classification: c.classification, sentiment: c.sentiment, needsHuman: c.needs_human,
    extracted: { summary: c.summary, referral_name: c.referral_name, referral_email: c.referral_email, return_date: c.return_date, whole_org_unsubscribe: c.whole_org_unsubscribe },
    handled: !c.needs_human, updatedAt: iso,
  }).where(eq(replies.id, replyId));
  await db.insert(activities).values({ mandateId: r.mandateId, contactId: contact.id, orgId: contact.orgId, type: "email", method: "gmail", detail: `Reply (${c.classification}): ${c.summary}`, source: "job", actor: "system" });

  const task = (type: "follow_up" | "other", title: string, dueAt: string, body = "") =>
    db.insert(tasks).values({ mandateId: r.mandateId, contactId: contact.id, orgId: contact.orgId, type, title, body, dueAt });

  switch (c.classification) {
    case "out_of_office": {
      // Not a real reply: the sequence continues, shifted past the return date.
      const back = /^\d{4}-\d{2}-\d{2}$/.test(c.return_date) ? new Date(`${c.return_date}T13:00:00Z`) : new Date(now.getTime() + 7 * 86_400_000);
      const pending = await db.select({ id: messages.id, at: messages.scheduledAt }).from(messages)
        .where(and(eq(messages.contactId, contact.id), inArray(messages.status, [...PENDING])));
      for (const p of pending) if (!p.at || p.at < back.toISOString()) {
        await db.update(messages).set({ scheduledAt: new Date(back.getTime() + 86_400_000).toISOString(), updatedAt: iso }).where(eq(messages.id, p.id));
      }
      return;
    }
    case "bounce": {
      if (contact.emailLower) await db.insert(suppression).values({ email: contact.emailLower, reason: "bounce" }).onConflictDoNothing();
      await db.update(contacts).set({ emailStatus: "invalid", updatedAt: iso }).where(eq(contacts.id, contact.id));
      await db.update(enrollments).set({ status: "stopped", stopReason: "bounce", updatedAt: iso }).where(and(eq(enrollments.contactId, contact.id), inArray(enrollments.status, ["drafting", "active", "paused"])));
      await db.update(messages).set({ status: "cancelled", updatedAt: iso }).where(and(eq(messages.contactId, contact.id), inArray(messages.status, [...PENDING])));
      return;
    }
    case "unsubscribe": {
      await stopOrgEnrollments(db, contact, "reply_unsubscribe", now);
      if (contact.emailLower) await applyUnsubscribe(db, { messageId: r.messageId ?? "", email: contact.emailLower });
      if (c.whole_org_unsubscribe && contact.emailLower) {
        const domain = contact.emailLower.split("@")[1];
        await db.insert(suppression).values({ domain, reason: "unsubscribe" }).onConflictDoNothing();
      }
      await db.update(replies).set({ handled: true, needsHuman: false }).where(eq(replies.id, replyId));
      return;
    }
    case "hostile": {
      await stopOrgEnrollments(db, contact, "reply_hostile", now);
      if (contact.emailLower) await db.insert(suppression).values({ email: contact.emailLower, reason: "manual" }).onConflictDoNothing();
      await db.update(contacts).set({ suppressed: true, leadState: "parked", updatedAt: iso }).where(eq(contacts.id, contact.id));
      return;
    }
    case "not_now": {
      await stopOrgEnrollments(db, contact, "reply_not_now", now);
      await db.update(contacts).set({ leadState: "nurture", updatedAt: iso }).where(eq(contacts.id, contact.id));
      await advanceDeal(db, { mandateId: r.mandateId, orgId: contact.orgId, contactId: contact.id, to: "nurture", actor: "system", source: "job", reason: "Replied: not now" });
      const due = /^\d{4}-\d{2}-\d{2}$/.test(c.return_date) ? c.return_date : new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
      await task("follow_up", `Check back with ${contact.fullName}`, due, c.summary);
      break;
    }
    case "referral": {
      await stopOrgEnrollments(db, contact, "reply_referral", now);
      await task("follow_up", `Referral from ${contact.fullName}: ${c.referral_name || "see reply"}${c.referral_email ? ` <${c.referral_email}>` : ""}`, iso.slice(0, 10), c.summary);
      break;
    }
    case "interested":
    case "question":
    case "objection":
    case "other": {
      await stopOrgEnrollments(db, contact, `reply_${c.classification}`, now);
      if (c.classification === "interested" || c.classification === "question") {
        await db.update(contacts).set({ leadState: "engaged", updatedAt: iso }).where(eq(contacts.id, contact.id));
        await advanceDeal(db, { mandateId: r.mandateId, orgId: contact.orgId, contactId: contact.id, to: "engaged", actor: "system", source: "job", reason: `Replied: ${c.classification}` });
      }
      break;
    }
  }
  if (c.needs_human) await enqueue(db, "reply.respond", { replyId }, { dedupeKey: `respond:${replyId}` });
}

export const zResponse = z.object({
  body: z.string(),
  next_action: z.string(),
  deal_stage: z.string(),
});

/** Suggested reply for the Inbox (Sonnet). Stored only; Prado edits and sends through the guarded send. */
export async function draftResponse(db: Db, cfg: AiConfig, replyId: string, bookingUrl: string | null, client?: Anthropic) {
  const [r] = await db.select().from(replies).where(eq(replies.id, replyId));
  if (!r || r.suggestedResponse || !r.contactId) return;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
  const [org] = contact?.orgId ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, contact.orgId)) : [];
  const [d] = contact?.orgId ? await db.select({ fields: dossiers.fields }).from(dossiers).where(and(eq(dossiers.orgId, contact.orgId), eq(dossiers.status, "ready"))).orderBy(desc(dossiers.refreshedAt)).limit(1) : [];
  const input = [
    `From: ${contact?.fullName ?? r.fromEmail}${contact?.title ? `, ${contact.title}` : ""}${org ? ` at ${org.name}` : ""}`,
    `Classification: ${r.classification}`,
    bookingUrl ? `Scoping-call link: ${bookingUrl}` : "No booking link: propose two times instead.",
    d?.fields ? `Dossier:\n${JSON.stringify(d.fields).slice(0, 6000)}` : "",
    `Their reply:\nSubject: ${r.subject}\n${r.body.slice(0, 6000)}`,
  ].filter(Boolean).join("\n\n");
  let out = await runStructured(db, cfg, "reply.respond", input, zResponse, { entity: "reply", entityId: r.id }, client);
  const issues = validateMessage({ subject: "", body: out.body }, { firstTouch: false, advisory: true });
  if (issues.length) out = await runStructured(db, cfg, "reply.respond", `${input}\n\nFix these house-style issues: ${issues.map(i => i.detail).join(" ")}`, zResponse, { entity: "reply", entityId: r.id }, client);
  await db.update(replies).set({ suggestedResponse: out.body, extracted: { ...(r.extracted ?? {}), next_action: out.next_action, proposed_stage: out.deal_stage }, updatedAt: new Date().toISOString() }).where(eq(replies.id, replyId));
}
