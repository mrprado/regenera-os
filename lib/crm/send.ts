// Manual email from a record (phase 1). Creating the message is Prado's approval; the send is claimed
// with one conditional UPDATE that also checks suppression, so a message can never go out twice.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, mandates, messages, oauthAccounts } from "@/db/schema";
import { buildRawMessage, gmailGetMessage, gmailSend, header } from "@/lib/google/gmail";
import { validateMessage, type StyleIssue } from "@/lib/style/validate";

export type SendPolicy = {
  production: boolean;
  allowedDomains: string[];       // non-production: recipients must be in these domains
  postalAddress: string | null;   // CAN-SPAM footer
};

export type ComposeResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_found" | "no_email" | "suppressed" | "investment_mandate" | "counsel_not_confirmed" | "needs_prior_relationship" | "recipient_not_allowed" | "needs_confirmation" | "style" | "no_mailbox"; issues?: StyleIssue[] };

export type PriorRelationship = { how: string; since: string; evidence: string };

export async function composeManualEmail(db: Db, input: {
  contactId: string; subject: string; body: string; approvedBy: string; confirmUnverified: boolean; policy: SendPolicy;
  priorRelationship?: PriorRelationship;
}): Promise<ComposeResult> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, input.contactId));
  if (!c) return { ok: false, reason: "not_found" };
  if (!c.emailLower) return { ok: false, reason: "no_email" };
  if (c.suppressed) return { ok: false, reason: "suppressed" };
  const [m] = await db.select().from(mandates).where(eq(mandates.id, c.mandateId));
  // Investment mandates (SPEC section 13): manual, relationship-only. Sending needs counsel's confirmation for the
  // mandate and, for every touch, the prior relationship with evidence (no general solicitation, Reg D 506(b)).
  const investment = m?.type === "investment";
  if (investment && !m.counselConfirmedAt) return { ok: false, reason: "counsel_not_confirmed" };
  const pr = input.priorRelationship;
  if (investment && !(pr && pr.how.trim().length >= 3 && pr.since.trim() && pr.evidence.trim().length >= 10)) return { ok: false, reason: "needs_prior_relationship" };
  const domain = c.emailLower.split("@")[1];
  if (!input.policy.production && !input.policy.allowedDomains.includes(domain)) return { ok: false, reason: "recipient_not_allowed" };
  if (c.emailStatus !== "verified_provider" && c.emailStatus !== "verified_manual" && !input.confirmUnverified) return { ok: false, reason: "needs_confirmation" };
  const [{ prior }] = await db.select({ prior: sql<number>`count(*)` }).from(messages).where(and(eq(messages.contactId, c.id), eq(messages.status, "sent")));
  // Securities terms are blocked in advisory outreach. Investment-mandate messages go to known relationships only.
  const issues = validateMessage({ subject: input.subject, body: input.body }, { firstTouch: prior === 0, advisory: !investment });
  if (issues.length) return { ok: false, reason: "style", issues };
  const [acct] = await db.select({ id: oauthAccounts.id }).from(oauthAccounts).where(eq(oauthAccounts.mailboxRole, "primary"));
  if (!acct) return { ok: false, reason: "no_mailbox" };
  const [row] = await db.insert(messages).values({
    mandateId: c.mandateId, contactId: c.id, channel: "email", mailboxRole: "primary", toEmail: c.emailLower,
    subject: input.subject.trim(), body: input.body.trim(), status: "approved", approvedBy: input.approvedBy,
    priorRelationship: investment ? { how: pr!.how.trim(), since: pr!.since.trim(), evidence: pr!.evidence.trim() } : null,
  }).returning({ id: messages.id });
  return { ok: true, messageId: row.id };
}

/** Atomic claim: approved -> sending, only if the recipient is not suppressed. Returns null if not claimable. */
export async function claimMessage(db: Db, messageId: string) {
  const rows = await db.all<{ id: string }>(sql`UPDATE messages SET status = 'sending', updated_at = ${new Date().toISOString()}
    WHERE id = ${messageId} AND status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM suppression s WHERE s.email = lower(messages.to_email) OR s.domain = substr(lower(messages.to_email), instr(messages.to_email, '@') + 1))
    RETURNING id`);
  return rows[0] ?? null;
}

export type SendOptions = {
  threadId?: string;            // explicit Gmail thread (sequence follow-ups); default: the contact's latest thread
  subject?: string;             // override (e.g. "Re: <first subject>" when threading)
  inReplyTo?: string;
  references?: string;
  extraHeaders?: Record<string, string>;
  footerExtra?: string;         // appended after the postal footer (unsubscribe line)
  activitySource?: "manual" | "job";
  now?: Date;
};

export async function sendClaimedMessage(db: Db, messageId: string, getToken: () => Promise<{ accessToken: string; email: string }>, policy: SendPolicy, fetchImpl?: typeof fetch, opts: SendOptions = {}) {
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!msg || msg.status !== "sending") return { sent: false as const, reason: "not_claimed" };
  const [thread] = await db.select({ threadId: messages.gmailThreadId }).from(messages)
    .where(and(eq(messages.contactId, msg.contactId), eq(messages.status, "sent"), isNotNull(messages.gmailThreadId))).orderBy(desc(messages.sentAt)).limit(1);
  try {
    const { accessToken, email } = await getToken();
    const footer = policy.postalAddress ? `\n\n--\nRegenera · ${policy.postalAddress}` : "";
    const extra = opts.footerExtra ? `${footer ? "\n" : "\n\n--\n"}${opts.footerExtra}` : "";
    const raw = buildRawMessage({ from: email, to: msg.toEmail, subject: opts.subject ?? msg.subject, text: `${msg.body}${footer}${extra}`, inReplyTo: opts.inReplyTo, references: opts.references, extraHeaders: opts.extraHeaders });
    const res = await gmailSend(accessToken, raw, opts.threadId ?? thread?.threadId ?? undefined, fetchImpl);
    // RFC Message-ID, used for In-Reply-To on follow-ups. Best effort: threading still works by threadId.
    let rfcMessageId: string | null = null;
    try { const meta = await gmailGetMessage(accessToken, res.id, "metadata", fetchImpl); rfcMessageId = meta ? header(meta, "Message-ID") ?? null : null; } catch { /* keep null */ }
    const now = (opts.now ?? new Date()).toISOString();
    await db.update(messages).set({ status: "sent", gmailMessageId: res.id, gmailThreadId: res.threadId, rfcMessageId, sentAt: now, updatedAt: now }).where(eq(messages.id, msg.id));
    const [c] = await db.select({ orgId: contacts.orgId, leadState: contacts.leadState }).from(contacts).where(eq(contacts.id, msg.contactId));
    const evidence = msg.priorRelationship ? ` | Prior relationship: ${msg.priorRelationship.how}, since ${msg.priorRelationship.since}. Evidence: ${msg.priorRelationship.evidence}` : "";
    await db.insert(activities).values({ mandateId: msg.mandateId, contactId: msg.contactId, orgId: c?.orgId ?? null, dealId: msg.dealId, type: "email", method: "gmail", detail: `Sent: ${opts.subject ?? msg.subject}${evidence}`, source: opts.activitySource ?? "manual", actor: msg.approvedBy });
    if (c && ["sourced", "researched", "qualified", "queued"].includes(c.leadState)) await db.update(contacts).set({ leadState: "contacted" }).where(eq(contacts.id, msg.contactId));
    return { sent: true as const, gmailId: res.id };
  } catch (error) {
    await db.update(messages).set({ status: "failed", error: (error as Error).message.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(messages.id, msg.id));
    return { sent: false as const, reason: (error as Error).message };
  }
}


