// Sequence sender (docs/plans/phase-2.md item 6). Runs every tick. For each due, approved sequence email:
// recipient window -> earlier steps sent -> mailbox not paused and under its cap (reserved atomically) ->
// atomic claim with suppression check -> send in the same thread. A message can only ever be sent once.
import { and, asc, desc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, enrollments, mailboxState, messages, sequences } from "@/db/schema";
import { claimMessage, sendClaimedMessage, type SendPolicy } from "@/lib/crm/send";
import { etParts } from "@/lib/time/et";
import { inWindow, timeZoneFor, warmupCap } from "@/lib/time/windows";
import { signUnsubscribeToken, unsubscribeUrl } from "./unsubscribe";

export type MailboxRoleName = "primary" | "sending";

export type SenderDeps = {
  policy: SendPolicy;
  getToken: (role: MailboxRoleName) => Promise<{ accessToken: string; email: string }>;
  unsubscribe: { secret: string; baseUrl: string } | null;
  caps: { primary: number; sendingCeiling: number; warmupStartedOn: string | null };
  fetchImpl?: typeof fetch;
  now?: Date;
  limit?: number;
};

export const UNDO_WINDOW_MS = 60_000;

export function etDay(d: Date) {
  const p = etParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function capFor(role: MailboxRoleName, caps: SenderDeps["caps"], now: Date) {
  return role === "primary" ? caps.primary : warmupCap(caps.warmupStartedOn, now, caps.sendingCeiling);
}

/** Reserves one send against the mailbox's daily cap. Resets the counter on a new ET day. */
export async function reserveMailboxSlot(db: Db, role: MailboxRoleName, cap: number, now: Date): Promise<"ok" | "paused" | "cap"> {
  const day = etDay(now);
  await db.insert(mailboxState).values({ role, day, sentToday: 0 }).onConflictDoNothing();
  await db.update(mailboxState).set({ day, sentToday: 0, updatedAt: now.toISOString() }).where(and(eq(mailboxState.role, role), sql`${mailboxState.day} <> ${day}`));
  const [st] = await db.select().from(mailboxState).where(eq(mailboxState.role, role));
  if (st?.pausedUntil && st.pausedUntil > now.toISOString()) return "paused";
  const rows = await db.all<{ role: string }>(sql`UPDATE mailbox_state SET sent_today = sent_today + 1, updated_at = ${now.toISOString()}
    WHERE role = ${role} AND day = ${day} AND sent_today < ${cap} RETURNING role`);
  return rows.length ? "ok" : "cap";
}

async function releaseMailboxSlot(db: Db, role: MailboxRoleName) {
  await db.run(sql`UPDATE mailbox_state SET sent_today = max(0, sent_today - 1) WHERE role = ${role}`);
}

export async function pauseMailbox(db: Db, role: MailboxRoleName, until: Date, reason: string) {
  await db.insert(mailboxState).values({ role, day: etDay(new Date()), pausedUntil: until.toISOString(), pauseReason: reason })
    .onConflictDoUpdate({ target: mailboxState.role, set: { pausedUntil: until.toISOString(), pauseReason: reason } });
}

export type SenderResult = { sent: number; deferred: Record<string, number>; failed: number };

export async function runSender(db: Db, deps: SenderDeps): Promise<SenderResult> {
  const now = deps.now ?? new Date();
  const out: SenderResult = { sent: 0, deferred: {}, failed: 0 };
  const defer = (why: string) => { out.deferred[why] = (out.deferred[why] ?? 0) + 1; };
  const due = await db.select({
    m: messages,
    country: contacts.country, timezone: contacts.timezone,
    enrollmentStatus: enrollments.status, sequenceSteps: sequences.steps,
  }).from(messages)
    .leftJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .leftJoin(sequences, eq(sequences.id, enrollments.sequenceId))
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(
      // Sequence steps, plus one-off drafts queued for approval (Ask the OS): those carry a scheduled time.
      // Manual sends from a record (no schedule) are sent by their own action and never picked up here.
      eq(messages.channel, "email"), eq(messages.status, "approved"), or(isNotNull(messages.enrollmentId), isNotNull(messages.scheduledAt)),
      lte(messages.scheduledAt, now.toISOString()),
      lte(messages.approvedAt, new Date(now.getTime() - UNDO_WINDOW_MS).toISOString()),
    ))
    .orderBy(asc(messages.scheduledAt)).limit(deps.limit ?? 25);

  const fullRoles = new Set<MailboxRoleName>();
  for (const row of due) {
    const m = row.m;
    const oneOff = !m.enrollmentId;
    if (!oneOff && row.enrollmentStatus !== "active") {
      if (row.enrollmentStatus === "stopped" || row.enrollmentStatus === "completed") {
        await db.update(messages).set({ status: "cancelled", updatedAt: now.toISOString() }).where(and(eq(messages.id, m.id), eq(messages.status, "approved")));
      }
      defer("enrollment_not_active"); continue;
    }
    const tz = timeZoneFor({ timezone: row.timezone, country: row.country });
    if (!inWindow(now, tz)) { defer("outside_window"); continue; }
    // Follow-ups wait for every earlier email step to be sent (or skipped).
    const [earlier] = oneOff ? [{ n: 0 }] : await db.select({ n: sql<number>`count(*)` }).from(messages).where(and(
      eq(messages.enrollmentId, m.enrollmentId!), eq(messages.channel, "email"), sql`${messages.step} < ${m.step}`,
      inArray(messages.status, ["draft", "style_failed", "pending_approval", "approved", "sending"]),
    ));
    if (earlier.n > 0) { defer("waiting_for_earlier_step"); continue; }
    // Keep the sequence's spacing from the previous actual send (a late first send delays the follow-ups).
    // 12 hours of slack so a follow-up can land in the same day's window as the day-N mark.
    const [prev] = oneOff ? [] : await db.select({ step: messages.step, sentAt: messages.sentAt }).from(messages)
      .where(and(eq(messages.enrollmentId, m.enrollmentId!), eq(messages.channel, "email"), eq(messages.status, "sent"))).orderBy(desc(messages.step)).limit(1);
    if (prev?.sentAt && prev.step !== null && m.step !== null) {
      const gapDays = (row.sequenceSteps?.[m.step]?.day ?? 0) - (row.sequenceSteps?.[prev.step]?.day ?? 0);
      if (now.getTime() < Date.parse(prev.sentAt) + gapDays * 86_400_000 - 12 * 3_600_000) { defer("spacing"); continue; }
    }
    const domain = m.toEmail.split("@")[1]?.toLowerCase() ?? "";
    if (!deps.policy.production && !deps.policy.allowedDomains.includes(domain)) {
      await db.update(messages).set({ status: "failed", error: "Recipient not in SEND_ALLOWED_DOMAINS (non-production)", updatedAt: now.toISOString() }).where(eq(messages.id, m.id));
      out.failed++; continue;
    }
    if (m.tier === "mass" && !deps.unsubscribe) { defer("unsubscribe_not_configured"); continue; }
    const role: MailboxRoleName = m.mailboxRole;
    if (fullRoles.has(role)) { defer("mailbox_cap"); continue; }
    const slot = await reserveMailboxSlot(db, role, capFor(role, deps.caps, now), now);
    if (slot !== "ok") { fullRoles.add(role); defer(slot === "paused" ? "mailbox_paused" : "mailbox_cap"); continue; }
    if (!(await claimMessage(db, m.id))) { await releaseMailboxSlot(db, role); defer("not_claimable"); continue; }

    // Threading: follow-ups reply in the first sent email's thread.
    const [first] = oneOff ? [] : await db.select({ subject: messages.subject, threadId: messages.gmailThreadId, rfc: messages.rfcMessageId }).from(messages)
      .where(and(eq(messages.enrollmentId, m.enrollmentId!), eq(messages.status, "sent"), eq(messages.channel, "email"))).orderBy(asc(messages.step)).limit(1);
    const refs = first ? (await db.select({ rfc: messages.rfcMessageId }).from(messages)
      .where(and(eq(messages.enrollmentId, m.enrollmentId!), eq(messages.status, "sent"), isNotNull(messages.rfcMessageId))).orderBy(asc(messages.step))).map(r => r.rfc!) : [];
    const extraHeaders: Record<string, string> = {};
    let footerExtra: string | undefined;
    if (m.tier === "mass" && deps.unsubscribe) {
      const url = unsubscribeUrl(deps.unsubscribe.baseUrl, await signUnsubscribeToken(deps.unsubscribe.secret, m.id, m.toEmail));
      extraHeaders["List-Unsubscribe"] = `<${url}>`;
      extraHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      footerExtra = `To stop these emails: ${url}`;
    }
    const res = await sendClaimedMessage(db, m.id, () => deps.getToken(role), deps.policy, deps.fetchImpl, {
      threadId: first?.threadId ?? undefined,
      subject: first ? `Re: ${first.subject.replace(/^re:\s*/i, "")}` : undefined,
      inReplyTo: refs.at(-1), references: refs.length ? refs.join(" ") : undefined,
      extraHeaders, footerExtra, activitySource: "job", now,
    });
    if (!res.sent) {
      out.failed++;
      if (/429|rate limit/i.test(res.reason)) { await pauseMailbox(db, role, new Date(now.getTime() + 24 * 3_600_000), "Gmail rate limit"); fullRoles.add(role); }
      continue;
    }
    out.sent++;
    if (oneOff) continue;
    const lastStep = (row.sequenceSteps ?? []).reduce((acc, st, i) => (st.channel === "email" ? i : acc), 0);
    await db.update(enrollments).set({ currentStep: m.step ?? 0, status: (m.step ?? 0) >= lastStep ? "completed" : "active", updatedAt: now.toISOString() })
      .where(eq(enrollments.id, m.enrollmentId!));
  }
  return out;
}
