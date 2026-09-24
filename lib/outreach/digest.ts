// Daily digest (docs/plans/phase-2.md item 12): 07:00 ET via Resend, system notification only.
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { deals, deliverabilityChecks, fundingOpportunities, mailboxState, meetingBriefs, messages, replies, tasks, triggers } from "@/db/schema";
import { deliverabilityIssues } from "./deliverability";

export type Digest = {
  date: string;
  newTriggers: { summary: string; type: string; urgency: number }[];
  queue: { pending: number; styleFailed: number };
  replies: { classification: string | null; fromEmail: string; subject: string }[];
  meetings: { title: string; startsAt: string }[];
  overdue: { name: string; nextAction: string | null; nextActionDate: string | null }[];
  tasksDue: number;
  alerts: string[];
  fundingDeadlines: { title: string; deadline: string; decision: string; daysLeft: number }[];
};

export async function buildDigest(db: Db, now = new Date()): Promise<Digest> {
  const day = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const newTriggers = await db.select({ summary: triggers.summary, type: triggers.type, urgency: triggers.urgency }).from(triggers)
    .where(and(gte(triggers.createdAt, since), eq(triggers.status, "new"))).orderBy(desc(triggers.urgency)).limit(10);
  const q = await db.select({ status: messages.status, n: sql<number>`count(*)` }).from(messages).where(inArray(messages.status, ["pending_approval", "style_failed"])).groupBy(messages.status);
  const rep = await db.select({ classification: replies.classification, fromEmail: replies.fromEmail, subject: replies.subject }).from(replies)
    .where(and(eq(replies.handled, false), eq(replies.needsHuman, true))).orderBy(desc(replies.receivedAt)).limit(20);
  const meetings = await db.select({ title: meetingBriefs.title, startsAt: meetingBriefs.startsAt }).from(meetingBriefs)
    .where(and(gte(meetingBriefs.startsAt, now.toISOString()), lte(meetingBriefs.startsAt, new Date(now.getTime() + 24 * 3_600_000).toISOString()))).orderBy(meetingBriefs.startsAt);
  const overdue = await db.select({ name: deals.name, nextAction: deals.nextAction, nextActionDate: deals.nextActionDate }).from(deals)
    .where(and(lte(deals.nextActionDate, day), sql`${deals.archivedAt} is null`, sql`${deals.stage} not in ('completed','churned','lost')`)).limit(20);
  const [{ tasksDue }] = await db.select({ tasksDue: sql<number>`count(*)` }).from(tasks).where(and(eq(tasks.status, "open"), lte(tasks.dueAt, `${day}T23:59:59Z`)));
  const alerts: string[] = [];
  const latest = await db.select().from(deliverabilityChecks).orderBy(desc(deliverabilityChecks.checkedAt)).limit(4);
  const seen = new Set<string>();
  for (const c of latest) { if (seen.has(c.domain)) continue; seen.add(c.domain); alerts.push(...deliverabilityIssues(c)); }
  for (const m of await db.select().from(mailboxState)) if (m.pausedUntil && m.pausedUntil > now.toISOString()) alerts.push(`${m.role} mailbox paused until ${m.pausedUntil.slice(0, 16).replace("T", " ")} UTC: ${m.pauseReason ?? ""}`);
  // Funding deadlines 14 and 3 days out: anything being bid on or watched, or a strong fit (60+).
  const in14 = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const funding = await db.select({ title: fundingOpportunities.title, deadline: fundingOpportunities.deadline, decision: fundingOpportunities.decision, fit: fundingOpportunities.fit }).from(fundingOpportunities)
    .where(and(ne(fundingOpportunities.status, "closed"), gte(fundingOpportunities.deadline, day), lte(fundingOpportunities.deadline, in14), ne(fundingOpportunities.decision, "dismissed")))
    .orderBy(fundingOpportunities.deadline).limit(30);
  const fundingDeadlines = funding
    .filter(f => f.decision === "bidding" || f.decision === "watching" || f.decision === "matched" || (f.fit ?? 0) >= 60)
    .map(f => ({ title: f.title, deadline: f.deadline!, decision: f.decision, daysLeft: Math.round((Date.parse(`${f.deadline}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000) }))
    .filter(f => f.decision === "bidding" || f.daysLeft === 14 || f.daysLeft <= 3)
    .slice(0, 10);
  return {
    fundingDeadlines,
    date: day, newTriggers,
    queue: { pending: q.find(x => x.status === "pending_approval")?.n ?? 0, styleFailed: q.find(x => x.status === "style_failed")?.n ?? 0 },
    replies: rep, meetings, overdue, tasksDue, alerts,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderDigest(d: Digest, appBaseUrl: string): { subject: string; html: string; text: string } {
  const link = (path: string, label: string) => `<a href="${esc(appBaseUrl + path)}" style="color:#131b13">${esc(label)}</a>`;
  const section = (title: string, items: string[], empty: string) =>
    `<h3 style="font:600 14px Helvetica Neue,Arial;margin:18px 0 6px">${esc(title)}</h3>${items.length ? `<ul style="margin:0;padding-left:18px">${items.map(i => `<li style="margin:3px 0">${i}</li>`).join("")}</ul>` : `<p style="color:#666;margin:0">${esc(empty)}</p>`}`;
  const html = `<div style="font:14px/1.5 Helvetica Neue,Arial;color:#131b13;max-width:640px">
<h2 style="font:600 18px Helvetica Neue,Arial;margin:0 0 4px">Regenera OS · ${esc(d.date)}</h2>
${d.alerts.length ? section("Alerts", d.alerts.map(esc), "") : ""}
${section("Approval queue", [`${d.queue.pending} drafts waiting, ${d.queue.styleFailed} need a style fix · ${link("/queue", "Open queue")}`], "")}
${section("Replies to handle", d.replies.map(r => `${esc(r.classification ?? "unclassified")} · ${esc(r.fromEmail)} · ${esc(r.subject)}`), "No replies waiting.")}
${section("Funding deadlines", d.fundingDeadlines.map(f => `${esc(f.deadline)} (${f.daysLeft} days) · ${esc(f.decision)} · ${esc(f.title)} · ${link("/funding", "Open Funding")}`), "No funding deadlines in the next two weeks.")}
${section("Meetings in the next 24 hours", d.meetings.map(m => `${esc(m.startsAt.slice(11, 16))} UTC · ${esc(m.title)}`), "No meetings.")}
${section("New triggers", d.newTriggers.map(t => `[${esc(t.type)} · ${t.urgency}] ${esc(t.summary)}`), "No new triggers.")}
${section("Overdue next actions", d.overdue.map(o => `${esc(o.name)}: ${esc(o.nextAction ?? "no next action")} (${esc(o.nextActionDate ?? "")})`), "Nothing overdue.")}
<p style="margin-top:18px">${d.tasksDue} tasks due today · ${link("/tasks", "Open tasks")}</p></div>`;
  const text = [
    `Regenera OS · ${d.date}`, ...d.alerts.map(a => `ALERT: ${a}`),
    `Queue: ${d.queue.pending} waiting, ${d.queue.styleFailed} need a style fix`,
    `Replies to handle: ${d.replies.length}`, `Meetings next 24h: ${d.meetings.length}`,
    `New triggers: ${d.newTriggers.length}`, `Overdue next actions: ${d.overdue.length}`, `Tasks due: ${d.tasksDue}`,
  ].join("\n");
  const subject = `Regenera OS digest: ${d.queue.pending} to approve, ${d.replies.length} replies, ${d.meetings.length} meetings`;
  return { subject, html, text };
}

export async function sendViaResend(cfg: { apiKey: string; from: string; to: string }, mail: { subject: string; html: string; text: string }, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}`);
}
