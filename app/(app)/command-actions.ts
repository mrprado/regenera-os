"use server";

// Command priority actions (phase 15 §3): assign and reschedule an underlying task where the user may write. Every
// action re-reads the task through the user's workspaces first.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { tasks } from "@/db/schema";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";

const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

async function scopedTask(user: { scope: { mandateIds: string[] } }, id: string) {
  const [t] = await appDb().select({ id: tasks.id, mandateId: tasks.mandateId, dueAt: tasks.dueAt }).from(tasks).where(eq(tasks.id, id));
  if (!t || !user.scope.mandateIds.includes(t.mandateId)) throw new Error("Not found");
  return t;
}

export async function assignTaskToMeAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await withOsUser(async user => {
    const t = await scopedTask(user, id);
    await appDb().update(tasks).set({ owner: user.email, updatedAt: new Date().toISOString() }).where(and(eq(tasks.id, id), eq(tasks.mandateId, t.mandateId)));
  });
  redirect(note("/today", "Assigned to you."));
}

export async function rescheduleTaskAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get("date"));
  await withOsUser(async user => {
    const t = await scopedTask(user, id);
    // Keep the original time of day; only the date moves.
    const time = t.dueAt.length > 10 ? t.dueAt.slice(10) : "T15:00:00.000Z";
    await appDb().update(tasks).set({ dueAt: `${date}${time}`, updatedAt: new Date().toISOString() }).where(and(eq(tasks.id, id), eq(tasks.mandateId, t.mandateId)));
  });
  redirect(note("/today", `Rescheduled to ${date}.`));
}
