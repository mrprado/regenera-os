// Calendar sync (docs/plans/phase-2.md item 10). Attendees are matched to contacts. A matched meeting is
// logged once, moves the deal to call_booked, stops outreach at that organization and gets a brief
// written 24 hours before it starts.
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import * as z4 from "zod/v4";
import type { Db } from "@/db";
import { activities, contacts, deals as dealsTable, dossiers, enrollments, meetingBriefs, messages, organizations, triggers } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { advanceDeal } from "@/lib/crm/deals";
import { enqueue } from "@/lib/jobs/queue";
import { recordTouch } from "./relationships";

const zEvents = z.object({
  items: z.array(z.object({
    id: z.string(),
    status: z.string().optional(),
    summary: z.string().optional(),
    start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
    attendees: z.array(z.object({ email: z.string().optional(), self: z.boolean().optional(), responseStatus: z.string().optional() })).optional(),
  })).default([]),
});
export type CalendarEvent = z.infer<typeof zEvents>["items"][number];

export async function listEvents(accessToken: string, timeMin: Date, timeMax: Date, fetchImpl: typeof fetch = fetch): Promise<CalendarEvent[]> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Calendar events returned ${res.status}`);
  return zEvents.parse(await res.json()).items;
}

/** Processes events from yesterday to 14 days ahead. Idempotent on (mandate, event id). */
export async function syncCalendarEvents(db: Db, events: CalendarEvent[], mailbox: string, now = new Date()) {
  let matched = 0;
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const startsAt = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T12:00:00Z` : null);
    if (!startsAt) continue;
    const emails = (ev.attendees ?? []).filter(a => !a.self && a.email && a.responseStatus !== "declined").map(a => a.email!.toLowerCase());
    if (!emails.length) continue;
    const people = await db.select().from(contacts).where(inArray(contacts.emailLower, emails));
    if (!people.length) continue;
    const c = people[0];
    const [created] = await db.insert(meetingBriefs).values({
      mandateId: c.mandateId, eventId: ev.id, contactId: c.id, orgId: c.orgId, title: ev.summary ?? "Meeting", startsAt: new Date(startsAt).toISOString(),
    }).onConflictDoNothing().returning({ id: meetingBriefs.id });
    if (!created) continue; // already processed
    matched++;
    for (const p of people) {
      await db.insert(activities).values({ mandateId: p.mandateId, contactId: p.id, orgId: p.orgId, type: "meeting", method: "calendar", detail: `${ev.summary ?? "Meeting"} (${startsAt.slice(0, 16).replace("T", " ")})`, source: "calendar", actor: mailbox });
      if (p.emailLower) await recordTouch(db, { mandateId: p.mandateId, email: p.emailLower, mailbox, kind: "meeting", at: new Date(startsAt).toISOString() });
    }
    const orgIds = [...new Set(people.map(p => p.orgId).filter((x): x is string => !!x))];
    const contactIds = orgIds.length
      ? (await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.orgId, orgIds))).map(x => x.id)
      : people.map(p => p.id);
    await db.update(enrollments).set({ status: "stopped", stopReason: "meeting_booked", updatedAt: now.toISOString() })
      .where(and(inArray(enrollments.contactId, contactIds), inArray(enrollments.status, ["drafting", "active", "paused"])));
    await db.update(messages).set({ status: "cancelled", updatedAt: now.toISOString() })
      .where(and(inArray(messages.contactId, contactIds), inArray(messages.status, ["draft", "style_failed", "pending_approval", "approved"])));
    await db.update(contacts).set({ leadState: "engaged", updatedAt: now.toISOString() }).where(inArray(contacts.id, people.map(p => p.id)));
    const deal = await advanceDeal(db, { mandateId: c.mandateId, orgId: c.orgId, contactId: c.id, to: "call_booked", actor: "system", source: "calendar", reason: ev.summary ?? "Meeting booked", now });
    if (deal) await db.update(meetingBriefs).set({ dealId: deal.dealId }).where(eq(meetingBriefs.id, created.id));
  }
  return matched;
}

/** Queues briefs for matched meetings starting in the next 24 hours that do not have one yet. */
export async function queueDueBriefs(db: Db, now = new Date()) {
  const due = await db.select({ id: meetingBriefs.id }).from(meetingBriefs).where(and(
    isNull(meetingBriefs.brief), gte(meetingBriefs.startsAt, now.toISOString()), lte(meetingBriefs.startsAt, new Date(now.getTime() + 24 * 3_600_000).toISOString()),
  ));
  for (const b of due) await enqueue(db, "meeting.brief", { briefId: b.id }, { dedupeKey: `brief:${b.id}`, now });
  return due.length;
}

export const zBrief = z4.object({
  context: z4.string(),
  priorities: z4.array(z4.string()),
  decision_they_hold: z4.string(),
  regenera_angle: z4.string(),
  entry_engagement: z4.string(),
  questions: z4.array(z4.string()),
  risks: z4.array(z4.string()),
});

export async function writeBrief(db: Db, cfg: AiConfig, briefId: string, client?: Anthropic) {
  const [b] = await db.select().from(meetingBriefs).where(eq(meetingBriefs.id, briefId));
  if (!b || b.brief) return;
  const [c] = b.contactId ? await db.select().from(contacts).where(eq(contacts.id, b.contactId)) : [];
  const [org] = b.orgId ? await db.select().from(organizations).where(eq(organizations.id, b.orgId)) : [];
  const [d] = b.orgId ? await db.select({ fields: dossiers.fields }).from(dossiers).where(and(eq(dossiers.orgId, b.orgId), eq(dossiers.status, "ready"))).orderBy(desc(dossiers.refreshedAt)).limit(1) : [];
  const trig = b.orgId ? await db.select().from(triggers).where(eq(triggers.orgId, b.orgId)).orderBy(desc(triggers.eventDate)).limit(5) : [];
  const touches = b.contactId ? await db.select().from(activities).where(eq(activities.contactId, b.contactId)).orderBy(desc(activities.createdAt)).limit(15) : [];
  const [deal] = b.dealId ? await db.select().from(dealsTable).where(eq(dealsTable.id, b.dealId)) : [];
  const input = [
    `Meeting: ${b.title} at ${b.startsAt}`,
    c ? `With: ${c.fullName}${c.title ? `, ${c.title}` : ""}` : "",
    org ? `Organization: ${org.name}${org.domain ? ` (${org.domain})` : ""}` : "",
    deal ? `Deal: stage ${deal.stage}, engagement ${deal.engagement}, next action ${deal.nextAction ?? "none"}` : "",
    trig.length ? `Triggers:\n${trig.map(t => `- ${t.eventDate} ${t.type}: ${t.summary}`).join("\n")}` : "",
    touches.length ? `Touch history:\n${touches.map(t => `- ${t.createdAt.slice(0, 10)} ${t.type}: ${t.detail}`).join("\n")}` : "",
    d?.fields ? `Dossier:\n${JSON.stringify(d.fields).slice(0, 12000)}` : "No dossier.",
  ].filter(Boolean).join("\n\n");
  const brief = await runStructured(db, cfg, "meeting.brief", input, zBrief, { entity: "meeting_brief", entityId: b.id }, client);
  await db.update(meetingBriefs).set({ brief, updatedAt: new Date().toISOString() }).where(eq(meetingBriefs.id, b.id));
}
