// Stewardship (phase 23): obligations past due become overdue with a task; recurring ones roll forward when done.
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { stewardshipObligations, tasks } from "@/db/schema";

export async function stewardshipDue(db: Db, now = new Date()) {
  const due = await db.select().from(stewardshipObligations).where(and(eq(stewardshipObligations.status, "open"), lt(stewardshipObligations.dueAt, now.toISOString())));
  for (const o of due) {
    await db.update(stewardshipObligations).set({ status: "overdue", updatedAt: now.toISOString() }).where(eq(stewardshipObligations.id, o.id));
    await db.insert(tasks).values({ mandateId: o.mandateId, projectId: o.projectId, type: "follow_up", title: `Stewardship overdue: ${o.title}`, body: `${o.kind} obligation was due ${o.dueAt?.slice(0, 10)}.`, dueAt: now.toISOString(), owner: o.owner });
  }
  return { overdue: due.length };
}

/** Marks an obligation done; a recurring one creates its next occurrence. */
export async function completeObligation(db: Db, id: string, evidence: string, by: string, now = new Date()) {
  const [o] = await db.select().from(stewardshipObligations).where(eq(stewardshipObligations.id, id));
  if (!o) throw new Error("Obligation not found");
  await db.update(stewardshipObligations).set({ status: "done", evidence: evidence.slice(0, 1000), updatedAt: now.toISOString() }).where(eq(stewardshipObligations.id, id));
  if (o.recurrenceMonths) {
    const next = new Date(o.dueAt ?? now.toISOString());
    next.setUTCMonth(next.getUTCMonth() + o.recurrenceMonths);
    await db.insert(stewardshipObligations).values({ mandateId: o.mandateId, projectId: o.projectId, title: o.title, kind: o.kind, dueAt: next.toISOString(), recurrenceMonths: o.recurrenceMonths, owner: o.owner, indicator: o.indicator, createdBy: by });
  }
}
