// Completing a task, shared by the Tasks screen and the LinkedIn extension's "Mark sent". Idempotent: a task
// that is already done or skipped is left alone, so a repeated click advances the sequence once.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, messages, tasks } from "@/db/schema";

export async function completeTask(db: Db, taskId: string, outcome: "done" | "skipped", actor: string, method = "manual"): Promise<"completed" | "already" | "missing"> {
  const now = new Date().toISOString();
  const [t] = await db.update(tasks).set({ status: outcome, completedAt: now, updatedAt: now })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "open"))).returning();
  if (!t) return (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId))).length ? "already" : "missing";
  if (t.messageId) {
    // An assisted LinkedIn step: Prado sent it by hand. Record it so the sequence moves on.
    await db.update(messages).set(outcome === "done" ? { status: "sent", sentAt: now, approvedBy: actor, approvedAt: now, updatedAt: now } : { status: "cancelled", updatedAt: now })
      .where(and(eq(messages.id, t.messageId), inArray(messages.status, ["pending_approval", "style_failed", "approved"])));
  }
  if (outcome === "done" && t.contactId) {
    const linkedin = t.type.startsWith("linkedin");
    await db.insert(activities).values({ mandateId: t.mandateId, contactId: t.contactId, orgId: t.orgId, type: linkedin ? "linkedin" : "note", method, detail: t.title, source: "manual", actor });
    if (linkedin) await db.update(contacts).set({ leadState: "contacted", updatedAt: now }).where(and(eq(contacts.id, t.contactId), inArray(contacts.leadState, ["sourced", "researched", "qualified", "queued"])));
  }
  return "completed";
}
