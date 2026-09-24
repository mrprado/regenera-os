// Weekly report (SPEC section 14): Mondays, one page. Numbers come from computeMetrics; Claude only writes
// the narrative from them. Stored in `reports`, shown in Reports, emailed via Resend when configured.
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { deals, organizations, reports, triggers } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { computeMetrics, type Metrics } from "./metrics";

export const zWeekly = z.object({
  headline: z.string(),
  pipeline_movement: z.string(),
  wins: z.array(z.string()),
  stalled: z.array(z.string()),
  best_angles: z.array(z.string()),
  worst_angles: z.array(z.string()),
  triggers_worth_attention: z.array(z.string()),
  recommended_actions: z.array(z.string()).length(3),
});
export type WeeklyBody = z.infer<typeof zWeekly>;

/** Last full Monday-to-Monday week before `now` (dates in UTC; the job runs Monday morning ET). */
export function lastWeek(now: Date) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const to = new Date(d.getTime() - sinceMonday * 86_400_000);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function buildWeeklyReport(db: Db, cfg: AiConfig | null, mandateId: string, now = new Date(), client?: Anthropic) {
  const period = lastWeek(now);
  const periodStart = period.from.slice(0, 10);
  const [existing] = await db.select().from(reports).where(and(eq(reports.mandateId, mandateId), eq(reports.kind, "weekly"), eq(reports.periodStart, periodStart)));
  if (existing?.body) return existing;
  const metrics = await computeMetrics(db, [mandateId], period);
  const stalledBefore = new Date(now.getTime() - 21 * 86_400_000).toISOString();
  const stalled = await db.select({ name: deals.name, stage: deals.stage, since: deals.stageChangedAt, next: deals.nextAction }).from(deals)
    .where(and(eq(deals.mandateId, mandateId), lte(deals.stageChangedAt, stalledBefore), notInArray(deals.stage, ["lead", "lost", "churned", "completed", "active", "nurture"])))
    .orderBy(asc(deals.stageChangedAt)).limit(10);
  const newTriggers = await db.select({ summary: triggers.summary, type: triggers.type, urgency: triggers.urgency, org: organizations.name, read: triggers.decisionRead }).from(triggers)
    .innerJoin(organizations, eq(organizations.id, triggers.orgId))
    .where(and(eq(triggers.mandateId, mandateId), gte(triggers.createdAt, period.from), inArray(triggers.status, ["new", "watched"])))
    .orderBy(desc(triggers.urgency), desc(triggers.relevance)).limit(8);
  const [row] = await db.insert(reports).values({ mandateId, kind: "weekly", periodStart, periodEnd: period.to.slice(0, 10), metrics: metrics as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: [reports.mandateId, reports.kind, reports.periodStart], set: { metrics: metrics as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() } }).returning();
  if (!cfg) return row; // numbers only until an Anthropic key exists
  const input = [
    `Week ${periodStart} to ${period.to.slice(0, 10)}. Metrics JSON:\n${JSON.stringify(slim(metrics))}`,
    stalled.length ? `Stalled deals (no stage change for 21+ days):\n${stalled.map(s => `- ${s.name}: ${s.stage} since ${s.since.slice(0, 10)}, next action: ${s.next ?? "none"}`).join("\n")}` : "No stalled deals.",
    newTriggers.length ? `New triggers:\n${newTriggers.map(t => `- [${t.type}, urgency ${t.urgency}] ${t.org}: ${t.summary}${t.read ? ` (${t.read})` : ""}`).join("\n")}` : "No new triggers.",
  ].join("\n\n");
  const body = await runStructured(db, cfg, "weekly.report", input, zWeekly, { entity: "report", entityId: row.id }, client);
  const [done] = await db.update(reports).set({ body, updatedAt: new Date().toISOString() }).where(eq(reports.id, row.id)).returning();
  return done;
}

/** Keeps the prompt small: top rows only. */
function slim(m: Metrics) {
  const top = <T,>(a: T[], n = 8) => a.slice(0, n);
  return {
    outreach: { ...m.outreach, byDim: Object.fromEntries(Object.entries(m.outreach.byDim).map(([k, v]) => [k, top(v)])) },
    triggerToFirstTouchHours: m.triggerToFirstTouchHours, pipeline: { ...m.pipeline, byStage: top(m.pipeline.byStage), byPractice: m.pipeline.byPractice, byFeeType: m.pipeline.byFeeType },
    winRate: m.winRate, partners: m.partners, deliverability: m.deliverability,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderWeekly(r: { periodStart: string; periodEnd: string; body: WeeklyBody; metrics: Metrics }, appBaseUrl: string) {
  const b = r.body, m = r.metrics;
  const list = (title: string, items: string[]) => items.length ? `<h3 style="font:600 14px Helvetica Neue,Arial;margin:16px 0 6px">${esc(title)}</h3><ul style="margin:0;padding-left:18px">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
  const html = `<div style="font:14px/1.5 Helvetica Neue,Arial;color:#131b13;max-width:640px">
<h2 style="font:600 18px Helvetica Neue,Arial;margin:0">Regenera OS weekly · ${esc(r.periodStart)} to ${esc(r.periodEnd)}</h2>
<p style="margin:6px 0 12px">${esc(b.headline)}</p>
<p style="margin:0;color:#555">${m.outreach.contactsEmailed} people emailed · reply rate ${m.outreach.replyRate}% · positive ${m.outreach.positiveRate}% · ${m.pipeline.openDeals} open deals, weighted ${Math.round(m.pipeline.weighted).toLocaleString("en-US")}</p>
<h3 style="font:600 14px Helvetica Neue,Arial;margin:16px 0 6px">Pipeline</h3><p style="margin:0">${esc(b.pipeline_movement)}</p>
${list("Wins", b.wins)}${list("Stalled", b.stalled)}${list("Best angles", b.best_angles)}${list("Weakest angles", b.worst_angles)}
${list("Triggers worth attention", b.triggers_worth_attention)}${list("Three actions this week", b.recommended_actions)}
<p style="margin-top:16px"><a href="${esc(appBaseUrl)}/reports" style="color:#131b13">Open Reports</a></p></div>`;
  const text = [`Regenera OS weekly ${r.periodStart} to ${r.periodEnd}`, b.headline, "", "Actions:", ...b.recommended_actions.map((a, i) => `${i + 1}. ${a}`)].join("\n");
  return { subject: `Regenera OS weekly: ${b.headline.slice(0, 90)}`, html, text };
}
