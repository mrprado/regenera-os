// Confirming a proposal (docs/plans/phase-4.md items 1 to 3). Runs only for a signed-in member of the proposal's
// mandate, only once, only before it expires, and through the same guards as the screens.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, deals, listMembers, lists, mandates, messages, organizations, proposals, tasks, QUALIFICATION_FIELDS, COVERAGE_ROLES, type QualificationField } from "@/db/schema";
import { setCoverage, setQualificationField } from "@/lib/flow/commercial";
import { audit } from "@/lib/audit";
import type { UserScope } from "@/lib/db/scoped";
import { enrollContacts } from "@/lib/outreach/sequences";
import { validateMessage } from "@/lib/style/validate";
import { DEAL_STAGES } from "@/lib/vocab";
import { applyLearningChange } from "@/lib/learning/apply";

export type ConfirmResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

export async function confirmProposal(db: Db, scope: UserScope, actor: string, id: string, now = new Date()): Promise<ConfirmResult> {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
  if (!p || !scope.mandateIds.includes(p.mandateId)) return { ok: false, error: "Proposal not found" };
  if (p.status !== "pending") return { ok: false, error: `This proposal is already ${p.status}` };
  if (p.expiresAt && p.expiresAt < now.toISOString()) {
    await db.update(proposals).set({ status: "expired", updatedAt: now.toISOString() }).where(eq(proposals.id, id));
    return { ok: false, error: "This proposal expired. Ask again." };
  }
  if (p.kind !== "action" && !scope.ownerOf.includes(p.mandateId)) return { ok: false, error: "Only an owner can apply learning-loop changes" };
  // Claim first so a double click or two clients can never apply it twice.
  const claimed = await db.update(proposals).set({ status: "applied", decidedBy: actor, decidedAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(and(eq(proposals.id, id), eq(proposals.status, "pending"))).returning({ id: proposals.id });
  if (!claimed.length) return { ok: false, error: "This proposal was already handled" };
  try {
    const result = p.kind === "action" ? await applyAction(db, p.mandateId, actor, p.change) : await applyLearningChange(db, p.mandateId, actor, p.kind, p.change);
    await db.update(proposals).set({ result }).where(eq(proposals.id, id));
    await audit(db, { actor, action: `proposal_${p.change.action}`, entity: "proposals", entityId: id, after: { source: p.source, result } });
    return { ok: true, result };
  } catch (error) {
    await db.update(proposals).set({ status: "failed", reason: (error as Error).message.slice(0, 300) }).where(eq(proposals.id, id));
    return { ok: false, error: (error as Error).message };
  }
}

export async function rejectProposal(db: Db, scope: UserScope, actor: string, id: string, reason: string) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
  if (!p || !scope.mandateIds.includes(p.mandateId) || p.status !== "pending") return false;
  await db.update(proposals).set({ status: "rejected", decidedBy: actor, decidedAt: new Date().toISOString(), reason: reason.slice(0, 300) }).where(eq(proposals.id, id));
  return true;
}

async function contactInMandate(db: Db, mandateId: string, id: string) {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.mandateId, mandateId)));
  if (!c) throw new Error("Person not found in this mandate");
  return c;
}

async function applyAction(db: Db, mandateId: string, actor: string, change: { action: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const a = change.args;
  const now = new Date().toISOString();
  switch (change.action) {
    case "add_to_list": {
      const ids = (a.contactIds as string[]).slice(0, 90);
      const [l] = await db.insert(lists).values({ mandateId, name: String(a.listName), kind: "people", createdBy: actor })
        .onConflictDoUpdate({ target: [lists.mandateId, lists.kind, lists.name], set: { updatedAt: now } }).returning();
      let added = 0;
      for (const id of ids) { await contactInMandate(db, mandateId, id); await db.insert(listMembers).values({ listId: l.id, entityId: id }).onConflictDoNothing(); added++; }
      return { listId: l.id, added };
    }
    case "enroll": {
      const r = await enrollContacts(db, { contactIds: (a.contactIds as string[]).slice(0, 90), sequenceId: String(a.sequenceId), actor });
      return r as unknown as Record<string, unknown>;
    }
    case "move_deal": {
      const [d] = await db.select().from(deals).where(and(eq(deals.id, String(a.dealId)), eq(deals.mandateId, mandateId)));
      if (!d) throw new Error("Deal not found in this mandate");
      const stage = a.stage as keyof typeof DEAL_STAGES;
      if (!(stage in DEAL_STAGES)) throw new Error("Unknown stage");
      await db.update(deals).set({ stage, stageChangedAt: now, updatedAt: now }).where(eq(deals.id, d.id));
      await db.insert(activities).values({ mandateId, dealId: d.id, orgId: d.orgId, contactId: d.contactId, type: "stage_change", detail: `${DEAL_STAGES[d.stage]} → ${DEAL_STAGES[stage]} (confirmed from Ask the OS)`, source: "manual", actor });
      return { dealId: d.id, from: d.stage, to: stage };
    }
    case "next_action": {
      const [d] = await db.update(deals).set({ nextAction: String(a.action).slice(0, 300), nextActionDate: String(a.date), updatedAt: now })
        .where(and(eq(deals.id, String(a.dealId)), eq(deals.mandateId, mandateId))).returning({ id: deals.id });
      if (!d) throw new Error("Deal not found in this mandate");
      return { dealId: d.id };
    }
    case "note": {
      const c = await contactInMandate(db, mandateId, String(a.contactId));
      await db.insert(activities).values({ mandateId, contactId: c.id, orgId: c.orgId, type: "note", method: "ask", detail: String(a.text).slice(0, 2000), source: "manual", actor });
      return { contactId: c.id };
    }
    case "draft_email": {
      const c = await contactInMandate(db, mandateId, String(a.contactId));
      const [m] = await db.select({ type: mandates.type }).from(mandates).where(eq(mandates.id, mandateId));
      if (m?.type === "investment") throw new Error("Investment mandates send only from the person's record, with the prior relationship recorded");
      if (!c.emailLower) throw new Error(`${c.fullName} has no email address`);
      if (c.suppressed) throw new Error(`${c.fullName} is suppressed`);
      const subject = String(a.subject), body = String(a.body);
      const issues = validateMessage({ subject, body }, { firstTouch: false, advisory: true });
      // Goes to the approval queue like every other draft. The sender picks it up after approval (it has a schedule).
      const [msg] = await db.insert(messages).values({
        mandateId, contactId: c.id, channel: "email", direction: "out", mailboxRole: "primary", toEmail: c.emailLower, subject, body,
        status: issues.length ? "style_failed" : "pending_approval", tier: "targeted", angleTag: "ask", scheduledAt: now, styleIssues: issues.length ? issues : null,
      }).returning({ id: messages.id });
      return { messageId: msg.id, queued: true, styleIssues: issues.length };
    }
    // Meeting-to-action proposals (phase 15): applied only after a person confirms each one.
    case "create_task": {
      const dealId = a.dealId ? String(a.dealId) : null, orgId = a.orgId ? String(a.orgId) : null;
      if (dealId) { const [d] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, dealId), eq(deals.mandateId, mandateId))); if (!d) throw new Error("Opportunity not found in this workspace"); }
      if (orgId) { const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.mandateId, mandateId))); if (!o) throw new Error("Organization not found in this workspace"); }
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(a.due ?? "")) ? String(a.due) : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const [t] = await db.insert(tasks).values({ mandateId, dealId, orgId, type: "follow_up", title: String(a.title).slice(0, 300), body: String(a.body ?? "").slice(0, 2000), dueAt: `${due}T15:00:00.000Z`, owner: a.owner ? String(a.owner) : actor, workstream: a.workstream ? String(a.workstream).slice(0, 120) : null }).returning({ id: tasks.id });
      return { taskId: t.id, due };
    }
    case "qualification_field": {
      const field = String(a.field) as QualificationField;
      if (!(field in QUALIFICATION_FIELDS)) throw new Error("Unknown qualification field");
      const [d] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, String(a.dealId)), eq(deals.mandateId, mandateId)));
      if (!d) throw new Error("Opportunity not found in this workspace");
      await setQualificationField(db, mandateId, d.id, field, String(a.text), String(a.evidence ?? ""), actor);
      return { dealId: d.id, field };
    }
    case "coverage_role": {
      const role = String(a.role);
      if (!(role in COVERAGE_ROLES)) throw new Error("Unknown coverage role");
      await setCoverage(db, mandateId, String(a.orgId), role, { contactId: a.contactId ? String(a.contactId) : null, relationshipOwner: a.owner ? String(a.owner) : actor, nextAction: String(a.nextAction ?? ""), evidence: String(a.evidence ?? "") }, actor);
      return { orgId: String(a.orgId), role };
    }
    default:
      throw new Error(`Unknown action ${change.action}`);
  }
}
