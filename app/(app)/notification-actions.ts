"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { notificationMutes, notifications, stageGates, triggerRules, type RuleAction } from "@/db/schema";
import { NOTIFICATION_CATEGORIES } from "@/db/events";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { dispatchEvents, EVENT_TYPES } from "@/lib/events/engine";

const zId = z.string().uuid();
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const back = (tab: string, text: string) => `/notifications?tab=${tab}&notice=${encodeURIComponent(text)}`;

export async function notificationAction(formData: FormData) {
  const id = zId.parse(formData.get("notificationId"));
  const op = z.enum(["read", "resolve", "snooze", "assign"]).parse(formData.get("op"));
  await withOsUser(async user => {
    const [n] = await appDb().select().from(notifications).where(and(eq(notifications.id, id), mandateCondition(user.scope, notifications.mandateId)));
    if (!n) throw new Error("Not found");
    const at = new Date().toISOString();
    const patch = op === "read" ? { readAt: at } : op === "resolve" ? { resolvedAt: at, readAt: n.readAt ?? at }
      : op === "snooze" ? { snoozedUntil: new Date(Date.now() + z.coerce.number().int().min(1).max(30).catch(1).parse(formData.get("days")) * 86_400_000).toISOString() }
      : { assignedTo: str(formData, "assignedTo", 254) || user.email };
    await appDb().update(notifications).set(patch).where(eq(notifications.id, n.id));
  });
  redirect("/notifications");
}

export async function readAllAction() {
  await withOsUser(async user => { await appDb().update(notifications).set({ readAt: new Date().toISOString() }).where(and(mandateCondition(user.scope, notifications.mandateId), isNull(notifications.readAt))); });
  redirect("/notifications");
}

export async function muteAction(formData: FormData) {
  const category = z.enum(NOTIFICATION_CATEGORIES).parse(formData.get("category"));
  const on = formData.get("mute") === "on";
  await withOsUser(async user => {
    await appDb().delete(notificationMutes).where(and(eq(notificationMutes.email, user.email), eq(notificationMutes.category, category)));
    if (on) await appDb().insert(notificationMutes).values({ email: user.email, category });
  });
  redirect(back("rules", on ? `Muted ${category} notifications addressed to you.` : `Unmuted ${category}.`));
}

export async function ruleToggleAction(formData: FormData) {
  const id = zId.parse(formData.get("ruleId"));
  await withOsUser(async user => {
    const [r] = await appDb().select().from(triggerRules).where(and(eq(triggerRules.id, id), mandateCondition(user.scope, triggerRules.mandateId)));
    if (!r) throw new Error("Not found");
    await appDb().update(triggerRules).set({ enabled: !r.enabled, updatedAt: new Date().toISOString() }).where(eq(triggerRules.id, r.id));
    await audit(appDb(), { actor: user.email, action: "trigger_rule_toggled", entity: "trigger_rules", entityId: r.id, after: { enabled: !r.enabled } });
  }, { owner: true });
  redirect(back("rules", "Rule updated."));
}

/** A simple rule: when EVENT (optionally with field = value), notify and/or create a task and/or run a playbook. */
export async function createRuleAction(formData: FormData) {
  const name = z.string().trim().min(3).max(120).parse(formData.get("name"));
  const eventType = z.enum(EVENT_TYPES).parse(formData.get("eventType"));
  await withOsUser(async user => {
    const actions: RuleAction[] = [];
    const title = str(formData, "title", 200) || `${eventType.replace(/_/g, " ").toLowerCase()}: {name}`;
    if (formData.get("notify") === "on") actions.push({ type: "notify", priority: z.enum(["critical", "action", "information"]).catch("action").parse(formData.get("priority")), category: z.enum(NOTIFICATION_CATEGORIES).catch("system").parse(formData.get("category")), title });
    if (formData.get("task") === "on") actions.push({ type: "task", title, dueDays: 2 });
    const pb = str(formData, "playbook", 60);
    if (pb) actions.push({ type: "playbook", key: pb });
    if (!actions.length) throw new Error("Choose at least one action");
    const field = str(formData, "field", 60), value = str(formData, "value", 200);
    await appDb().insert(triggerRules).values({ mandateId: user.scope.mandateIds[0], name, eventType, conditions: field && value ? [{ field, op: "eq", value }] : [], actions, owner: user.email });
  }, { owner: true });
  redirect(back("rules", "Rule created."));
}

export async function gateAction(formData: FormData) {
  const id = zId.parse(formData.get("gateId"));
  await withOsUser(async user => {
    const [g] = await appDb().select().from(stageGates).where(and(eq(stageGates.id, id), mandateCondition(user.scope, stageGates.mandateId)));
    if (!g) throw new Error("Not found");
    const enforce = z.enum(["block", "warn"]).catch(g.enforce).parse(formData.get("enforce"));
    await appDb().update(stageGates).set({ enforce, enabled: formData.get("enabled") === "on", updatedAt: new Date().toISOString() }).where(eq(stageGates.id, g.id));
    await audit(appDb(), { actor: user.email, action: "stage_gate_updated", entity: "stage_gates", entityId: g.id, before: { enforce: g.enforce, enabled: g.enabled }, after: { enforce, enabled: formData.get("enabled") === "on" } });
  }, { owner: true });
  redirect(back("gates", "Gate updated."));
}

export async function dispatchNowAction() {
  let r = { events: 0, actions: 0 };
  await withOsUser(async () => { r = await dispatchEvents(appDb()); });
  redirect(back("events", `Processed ${r.events} events, ${r.actions} actions.`));
}
