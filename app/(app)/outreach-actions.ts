"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enrollments, listMembers, lists, messages, replies, sequences, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { sendPolicy } from "@/lib/config";
import { claimMessage, composeManualEmail, sendClaimedMessage } from "@/lib/crm/send";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { getAccessToken } from "@/lib/google/accounts";
import { googleConfig } from "@/lib/google/config";
import { enqueue } from "@/lib/jobs/queue";
import { pauseMailbox } from "@/lib/outreach/sender";
import { completeTask } from "@/lib/outreach/tasks";
import { approveMessage, enrollContacts, skipMessage, unapproveMessage } from "@/lib/outreach/sequences";

const safeBack = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
};
const withParam = (back: string, k: string, v: string) => `${back}${back.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const zId = z.string().uuid();
const ids = (fd: FormData) => z.array(zId).max(500).parse(fd.getAll("ids"));

const REASONS: Record<string, string> = {
  investment_mandate: "investment mandate", suppressed: "suppressed", mass_needs_verified_email: "no verified email (mass tier)",
  no_email: "no email", already_enrolled: "already in a sequence", not_in_mandate: "outside this sequence's mandate",
};

// ---------- enrollment ----------
export async function enrollAction(formData: FormData) {
  const chosen = ids(formData);
  const sequenceId = zId.optional().catch(undefined).parse(formData.get("sequenceId") || undefined);
  const back = safeBack(formData.get("back"), "/people");
  let notice = "";
  await withOsUser(async user => {
    if (!sequenceId) { notice = "Choose a sequence."; return; }
    if (!chosen.length) { notice = "Select people first."; return; }
    const db = appDb();
    const [s] = await db.select().from(sequences).where(and(eq(sequences.id, sequenceId), mandateCondition(user.scope, sequences.mandateId)));
    if (!s) throw new Error("Sequence not found");
    const r = await enrollContacts(db, { contactIds: chosen, sequenceId, actor: user.email });
    await audit(db, { actor: user.email, action: "enroll", entity: "sequences", entityId: sequenceId, after: r });
    const skipped = Object.entries(r.skipped).map(([k, n]) => `${n} ${REASONS[k] ?? k}`).join(", ");
    notice = `Enrolled ${r.enrolled} in "${s.name}".${r.enrolled ? " Drafts are being written and will appear in the approval queue." : ""}${skipped ? ` Skipped: ${skipped}.` : ""}`;
  });
  redirect(withParam(back, "notice", notice));
}

/** A People list as a sequence audience. */
export async function enrollListAction(formData: FormData) {
  const listId = zId.parse(formData.get("listId"));
  const sequenceId = zId.optional().catch(undefined).parse(formData.get("sequenceId") || undefined);
  let notice = "";
  await withOsUser(async user => {
    if (!sequenceId) { notice = "Choose a sequence."; return; }
    const db = appDb();
    const [l] = await db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.kind, "people"), mandateCondition(user.scope, lists.mandateId)));
    const [s] = await db.select().from(sequences).where(and(eq(sequences.id, sequenceId), mandateCondition(user.scope, sequences.mandateId)));
    if (!l || !s) throw new Error("List or sequence not found");
    const members = (await db.select({ id: listMembers.entityId }).from(listMembers).where(eq(listMembers.listId, listId))).map(m => m.id);
    const r = await enrollContacts(db, { contactIds: members, sequenceId, actor: user.email });
    await audit(db, { actor: user.email, action: "enroll_list", entity: "lists", entityId: listId, after: { sequenceId, ...r } });
    const skipped = Object.entries(r.skipped).map(([k, n]) => `${n} ${REASONS[k] ?? k}`).join(", ");
    notice = `Enrolled ${r.enrolled} from "${l.name}" in "${s.name}".${skipped ? ` Skipped: ${skipped}.` : ""}`;
  });
  redirect(`/lists?notice=${encodeURIComponent(notice)}`);
}

// ---------- approval queue ----------
async function scopedMessage(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [m] = await appDb().select().from(messages).where(and(eq(messages.id, id), mandateCondition(scope, messages.mandateId)));
  if (!m) throw new Error("Message not found");
  return m;
}

export async function approveAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const subject = z.string().max(300).optional().parse((formData.get("subject") as string | null) ?? undefined);
  const body = z.string().max(10_000).optional().parse((formData.get("body") as string | null) ?? undefined);
  const back = safeBack(formData.get("back"), "/queue");
  let target = back;
  await withOsUser(async user => {
    const m = await scopedMessage(user.scope, id);
    const edited = (subject !== undefined && subject !== m.subject) || (body !== undefined && body !== m.body);
    const r = await approveMessage(appDb(), id, user.email, edited ? { subject, body } : undefined);
    await audit(appDb(), { actor: user.email, action: r.ok ? "message_approve" : "message_style_fail", entity: "messages", entityId: id, after: { edited, approved: r.approved } });
    target = r.ok ? withParam(back, "undo", id) : withParam(withParam(back, "focus", id), "notice", `Not approved: ${r.issues?.map(i => i.detail).join(" ") ?? "no longer pending"}`);
  });
  redirect(target);
}

export async function undoAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const back = safeBack(formData.get("back"), "/queue");
  let notice = "";
  await withOsUser(async user => {
    await scopedMessage(user.scope, id);
    notice = (await unapproveMessage(appDb(), id)) ? "Approval undone." : "Too late to undo: the 60 seconds have passed.";
  });
  redirect(withParam(back.replace(/([?&])undo=[^&]*/g, "$1"), "notice", notice));
}

export async function skipAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const back = safeBack(formData.get("back"), "/queue");
  await withOsUser(async user => {
    await scopedMessage(user.scope, id);
    await skipMessage(appDb(), id);
    await audit(appDb(), { actor: user.email, action: "message_skip", entity: "messages", entityId: id });
  });
  redirect(back);
}

export async function regenerateAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const angleHint = z.string().trim().max(300).optional().parse((formData.get("angle") as string) || undefined);
  const back = safeBack(formData.get("back"), "/queue");
  await withOsUser(async user => {
    const m = await scopedMessage(user.scope, id);
    if (!m.enrollmentId || m.step === null) throw new Error("Only sequence drafts can be regenerated");
    await enqueue(appDb(), "outreach.draft", { enrollmentId: m.enrollmentId, onlyStep: m.step, angleHint: angleHint ?? `anything other than "${m.angleTag ?? "the last angle"}"` }, { dedupeKey: `regen:${id}:${Date.now()}` });
    await appDb().update(messages).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(messages.id, id));
    await appDb().update(tasks).set({ status: "skipped" }).where(and(eq(tasks.messageId, id), eq(tasks.status, "open")));
  });
  redirect(withParam(back, "notice", "Rewriting this step with a new angle. It will be back in the queue in a minute."));
}

/** Mass tier only (SPEC section 8): targeted drafts are always approved one by one. */
export async function bulkApproveMassAction(formData: FormData) {
  const chosen = ids(formData);
  const back = safeBack(formData.get("back"), "/queue");
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const rows = await db.select().from(messages).where(and(inArray(messages.id, chosen), mandateCondition(user.scope, messages.mandateId)));
    let ok = 0, refused = 0, failed = 0;
    for (const m of rows) {
      if (m.tier !== "mass") { refused++; continue; }
      const r = await approveMessage(db, m.id, user.email);
      if (r.ok) ok += r.approved; else if (r.issues) failed++; // no issues = already approved with an earlier step
    }
    await audit(db, { actor: user.email, action: "message_bulk_approve", entity: "messages", after: { ok, refused, failed } });
    notice = `Approved ${ok}.${refused ? ` ${refused} targeted drafts need one-by-one review.` : ""}${failed ? ` ${failed} failed house style.` : ""}`;
  });
  redirect(withParam(back, "notice", notice));
}

// ---------- sequences ----------
export async function toggleSequenceAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const db = appDb();
    const [s] = await db.select().from(sequences).where(and(eq(sequences.id, id), mandateCondition(user.scope, sequences.mandateId)));
    if (!s) throw new Error("Sequence not found");
    await db.update(sequences).set({ active: !s.active, updatedAt: new Date().toISOString() }).where(eq(sequences.id, id));
    // Pausing a sequence pauses its running enrollments; resuming resumes them.
    await db.update(enrollments).set({ status: s.active ? "paused" : "active", updatedAt: new Date().toISOString() })
      .where(and(eq(enrollments.sequenceId, id), eq(enrollments.status, s.active ? "active" : "paused")));
    await audit(db, { actor: user.email, action: s.active ? "sequence_pause" : "sequence_resume", entity: "sequences", entityId: id });
  }, { owner: true });
  redirect("/sequences");
}

// ---------- tasks ----------
export async function completeTaskAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const outcome = z.enum(["done", "skipped"]).parse(formData.get("outcome"));
  const back = safeBack(formData.get("back"), "/tasks");
  await withOsUser(async user => {
    const [t] = await appDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id), mandateCondition(user.scope, tasks.mandateId)));
    if (!t) throw new Error("Task not found");
    await completeTask(appDb(), id, outcome, user.email);
  });
  redirect(back);
}

// ---------- inbox ----------
export async function markReplyHandledAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await appDb().update(replies).set({ handled: true, updatedAt: new Date().toISOString() }).where(and(eq(replies.id, id), mandateCondition(user.scope, replies.mandateId)));
  });
  redirect("/inbox");
}

export async function sendReplyAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const body = z.string().trim().min(1).max(10_000).parse(formData.get("body"));
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const [r] = await db.select().from(replies).where(and(eq(replies.id, id), mandateCondition(user.scope, replies.mandateId)));
    if (!r?.contactId) throw new Error("Reply not found");
    const subject = r.subject.match(/^re:/i) ? r.subject : `Re: ${r.subject}`;
    // A reply to someone who wrote to us: their address is confirmed by their own email.
    // For investment mandates the inbound email itself is the prior-relationship evidence.
    const priorRelationship = { how: "They wrote to us (reply in the Inbox)", since: r.receivedAt.slice(0, 10), evidence: `Email from ${r.fromEmail} received ${r.receivedAt.slice(0, 16)} UTC, subject "${r.subject.slice(0, 120)}"` };
    const composed = await composeManualEmail(db, { contactId: r.contactId, subject, body, approvedBy: user.email, confirmUnverified: true, policy: sendPolicy(), priorRelationship });
    if (!composed.ok) { notice = composed.reason === "style" ? `House style: ${composed.issues?.map(i => i.detail).join(" ")}` : `Not sent: ${composed.reason.replace(/_/g, " ")}`; return; }
    const cfg = googleConfig();
    if (!cfg) { notice = "Google is not configured."; return; }
    if (!(await claimMessage(db, composed.messageId))) { notice = "The recipient is suppressed."; return; }
    const sent = await sendClaimedMessage(db, composed.messageId, () => getAccessToken(db, cfg, "primary"), sendPolicy(), undefined, { threadId: r.gmailThreadId ?? undefined });
    if (!sent.sent) { notice = `Send failed: ${sent.reason}`; return; }
    await db.update(replies).set({ handled: true, updatedAt: new Date().toISOString() }).where(eq(replies.id, id));
    await audit(db, { actor: user.email, action: "reply_send", entity: "replies", entityId: id });
    notice = "Reply sent in the same thread.";
  });
  redirect(`/inbox?notice=${encodeURIComponent(notice)}`);
}

// ---------- sending settings ----------
export async function mailboxPauseAction(formData: FormData) {
  const role = z.enum(["primary", "sending"]).parse(formData.get("role"));
  const resume = formData.get("resume") === "1";
  await withOsUser(async user => {
    await pauseMailbox(appDb(), role, resume ? new Date(0) : new Date(Date.now() + 7 * 86_400_000), resume ? "" : `Paused by ${user.email}`);
    await audit(appDb(), { actor: user.email, action: resume ? "mailbox_resume" : "mailbox_pause", entity: "mailbox_state", entityId: role });
  }, { owner: true });
  redirect("/settings/sending");
}

export async function deliverabilityNowAction() {
  await withOsUser(async () => {
    await enqueue(appDb(), "deliverability.check", {}, { dedupeKey: `deliv:${new Date().toISOString().slice(0, 15)}` });
  }, { owner: true });
  redirect("/settings/sending?notice=" + encodeURIComponent("Deliverability check queued. It runs on the next tick."));
}
