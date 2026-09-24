"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { triggerQueries, triggers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { enqueue } from "@/lib/jobs/queue";

const zStatus = z.enum(["pursued", "watched", "dismissed", "new"]);

export async function setTriggerStatus(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const status = zStatus.parse(formData.get("status"));
  const reason = z.string().max(300).optional().parse(formData.get("reason") ?? undefined);
  const back = z.string().startsWith("/triggers").catch("/triggers").parse(formData.get("back"));
  await withOsUser(async user => {
    const db = appDb();
    const [row] = await db.update(triggers)
      .set({ status, dismissReason: status === "dismissed" ? reason ?? "not a fit" : null, updatedAt: new Date().toISOString() })
      .where(and(eq(triggers.id, id), mandateCondition(user.scope, triggers.mandateId)))
      .returning({ id: triggers.id });
    if (!row) throw new Error("Trigger not found");
    await audit(db, { actor: user.email, action: `trigger_${status}`, entity: "triggers", entityId: id, after: { reason } });
  });
  redirect(back);
}

export async function toggleQuery(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await withOsUser(async user => {
    const db = appDb();
    const [q] = await db.select().from(triggerQueries).where(eq(triggerQueries.id, id));
    if (!q) throw new Error("Query not found");
    await db.update(triggerQueries).set({ enabled: !q.enabled, updatedAt: new Date().toISOString() }).where(eq(triggerQueries.id, id));
    await audit(db, { actor: user.email, action: q.enabled ? "trigger_query_disabled" : "trigger_query_enabled", entity: "trigger_queries", entityId: id });
  }, { owner: true });
  redirect("/triggers?tab=sources");
}

export async function scanNow() {
  await withOsUser(async user => {
    const db = appDb();
    await enqueue(db, "triggers.scan", { manual: true }, { dedupeKey: `manual-scan:${new Date().toISOString().slice(0, 16)}` });
    await audit(db, { actor: user.email, action: "trigger_scan_requested", entity: "jobs" });
  }, { owner: true });
  redirect("/triggers?tab=sources&scan=queued");
}
