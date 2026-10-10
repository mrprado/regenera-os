// After a meeting (phase 29D): the notes, decisions, action items with owners and dates, an optional follow-up email
// draft for approval (it passes the style validator and never sends itself), and a suggested stage change that a
// person reviews. The relationship's last meaningful interaction is updated.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { contacts, deals, mandates, meetingNotes, messages, relationshipStatus, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { validateMessage } from "@/lib/style/validate";
import { commercialStageOf } from "./pipeline";
import { COMMERCIAL_STAGES, type CommercialStage } from "./vocab";

export type MeetingReview = {
  dealId?: string | null; orgId?: string | null; contactId?: string | null;
  title: string; heldOn: string; participants: string; notes: string;
  decisions: string[]; actions: { title: string; owner: string; due: string }[];
  followUp?: { subject: string; body: string } | null;
  suggestedStage?: CommercialStage | null;
};

export async function reviewMeeting(db: Db, mandateId: string, input: MeetingReview, by: string) {
  if (!input.notes.trim()) throw new Error("Add the meeting notes.");
  for (const a of input.actions) if (!a.title.trim() || !a.owner.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(a.due)) throw new Error(`Each action needs a title, an owner and a due date ("${a.title || "untitled"}").`);
  const [deal] = input.dealId ? await db.select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.mandateId, mandateId))) : [];
  const orgId = input.orgId ?? deal?.orgId ?? null, contactId = input.contactId ?? deal?.contactId ?? null;
  const body = [input.notes.trim(), input.decisions.length ? `Decisions:\n${input.decisions.map(d => `- ${d}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  const [note] = await db.insert(meetingNotes).values({ mandateId, orgId, dealId: deal?.id ?? null, title: input.title || "Meeting", heldOn: input.heldOn, participants: input.participants, notes: body, status: "reviewed", createdBy: by }).returning();
  for (const a of input.actions) await db.insert(tasks).values({ mandateId, dealId: deal?.id ?? null, orgId, contactId, type: "follow_up", title: a.title, body: `From meeting "${note.title}" on ${input.heldOn}`, dueAt: `${a.due}T09:00:00.000Z`, owner: a.owner, workstream: `meeting:${note.id}` });
  if (deal && input.actions[0]) await db.update(deals).set({ nextAction: input.actions[0].title, nextActionDate: input.actions[0].due, updatedAt: new Date().toISOString() }).where(eq(deals.id, deal.id));
  const t = new Date().toISOString();
  for (const [entityType, entityId] of [["contact", contactId], ["organization", orgId]] as const) if (entityId) await db.update(relationshipStatus).set({ lastMeaningfulAt: `${input.heldOn}T12:00:00.000Z`, updatedAt: t }).where(and(eq(relationshipStatus.mandateId, mandateId), eq(relationshipStatus.entityType, entityType), eq(relationshipStatus.entityId, entityId)));

  let messageId: string | null = null, styleIssues: string[] = [];
  if (input.followUp?.subject.trim() && input.followUp.body.trim()) {
    if (!contactId) throw new Error("A follow-up needs a contact on the opportunity.");
    const [c] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, contactId));
    if (!c?.email) throw new Error("The contact has no email address for the follow-up.");
    const [m] = await db.select({ type: mandates.type }).from(mandates).where(eq(mandates.id, mandateId));
    const issues = validateMessage(input.followUp, { firstTouch: false, advisory: m?.type !== "investment" });
    styleIssues = issues.map(i => `${i.rule}: ${i.detail}`);
    // The draft waits in the approval queue; it is never sent from here.
    const [msg] = await db.insert(messages).values({ mandateId, contactId, dealId: deal?.id ?? null, toEmail: c.email, subject: input.followUp.subject, body: input.followUp.body, status: issues.length ? "style_failed" : "pending_approval", styleIssues: issues } as never).returning({ id: messages.id });
    messageId = msg.id;
  }
  let suggestion: string | null = null;
  if (deal && input.suggestedStage && input.suggestedStage !== commercialStageOf(deal)) {
    suggestion = `${COMMERCIAL_STAGES[commercialStageOf(deal)]} → ${COMMERCIAL_STAGES[input.suggestedStage]}`;
    await db.insert(tasks).values({ mandateId, dealId: deal.id, orgId, contactId, type: "other", title: `Review suggested stage change: ${suggestion}`, body: `Suggested after the meeting "${note.title}" on ${input.heldOn}. Move it on the opportunity if the evidence supports it.`, dueAt: `${input.heldOn}T17:00:00.000Z`, owner: by, workstream: `meeting:${note.id}` });
  }
  await audit(db, { actor: by, action: "meeting_reviewed", entity: "meeting_notes", entityId: note.id, after: { actions: input.actions.length, decisions: input.decisions.length, followUp: !!messageId, suggestion } });
  return { noteId: note.id, messageId, styleIssues, suggestion };
}
