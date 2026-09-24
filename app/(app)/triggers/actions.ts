"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { triggerQueries, triggers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { enqueue } from "@/lib/jobs/queue";
import { apolloConfig } from "@/lib/config";
import { pursueTrigger } from "@/lib/triggers/pursue";

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

const zPick = z.object({
  id: z.string(), first_name: z.string().nullish(), last_name: z.string().nullish(), name: z.string().nullish(), title: z.string().nullish(),
  seniority: z.string().nullish(), linkedin_url: z.string().nullish(), city: z.string().nullish(), country: z.string().nullish(),
});

/** Pursue (docs/plans/phase-3.md item 1): save the picked people, find addresses, enroll unless a conflict blocks it. */
export async function pursueAction(formData: FormData) {
  const triggerId = z.string().uuid().parse(formData.get("triggerId"));
  const people = formData.getAll("pick").map(v => zPick.parse(JSON.parse(String(v))));
  const sequenceId = z.string().uuid().optional().catch(undefined).parse(formData.get("sequenceId") || undefined) ?? null;
  const back = `/triggers/${triggerId}`;
  if (!people.length) redirect(`${back}?notice=${encodeURIComponent("Select at least one person.")}`);
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const [t] = await db.select({ id: triggers.id }).from(triggers).where(and(eq(triggers.id, triggerId), mandateCondition(user.scope, triggers.mandateId)));
    if (!t) throw new Error("Trigger not found");
    const r = await pursueTrigger(db, apolloConfig(), {
      triggerId, people, sequenceId, apolloEnrich: formData.get("enrich") === "1", overrideConflicts: formData.get("override") === "1", actor: user.email,
    });
    await audit(db, { actor: user.email, action: "trigger_pursue", entity: "triggers", entityId: triggerId, after: { saved: r.saved, emails: r.emails, credits: r.credits, blocked: r.blocked, enrolled: r.enrolled?.enrolled ?? 0 } });
    const parts = [`Saved ${r.saved}, ${r.emails} with an address${r.credits ? ` (${r.credits} Apollo credits)` : ""}.`];
    if (r.blocked) parts.push("Not enrolled: resolve the conflicts below, or tick override.");
    else if (r.enrolled) {
      parts.push(`Enrolled ${r.enrolled.enrolled}.`);
      const skipped = Object.entries(r.enrolled.skipped).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
      if (skipped) parts.push(`Skipped: ${skipped}.`);
    }
    if (r.errors.length) parts.push(r.errors[0]);
    notice = parts.join(" ");
  });
  redirect(`${back}?notice=${encodeURIComponent(notice)}`);
}
