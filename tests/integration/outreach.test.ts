import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activities, contacts, deals, enrollments, jobs, mailboxState, mandates, meetingBriefs, messages, organizations, relationships, replies, sequences, suppression, tasks,
} from "@/db/schema";
import { ensurePrompts } from "@/lib/ai/run";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import type { SendPolicy } from "@/lib/crm/send";
import { syncCalendarEvents } from "@/lib/outreach/calendar";
import { buildDigest, renderDigest } from "@/lib/outreach/digest";
import { recordTouch, warmPaths } from "@/lib/outreach/relationships";
import { routeReply, watchReplies, type Classification } from "@/lib/outreach/replies";
import { reserveMailboxSlot, runSender, type SenderDeps } from "@/lib/outreach/sender";
import { approveMessage, draftEnrollment, enrollContacts, ensureSequences, unapproveMessage } from "@/lib/outreach/sequences";
import { applyUnsubscribe, signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe";
import { createTestDb } from "../helpers/d1";
import { fakeAnthropic } from "../helpers/fake-anthropic";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const AI = { apiKey: "test", monthlyBudgetUsd: 50 };
const POLICY: SendPolicy = { production: false, allowedDomains: ["test.regenera.bio"], postalAddress: "Test address" };
// Wednesday 2026-09-23 15:00 UTC = 11:00 New York (EDT): inside the 08:30 to 11:30 window.
const IN_WINDOW = new Date("2026-09-23T15:00:00Z");
const CLEAN = "Your closure plan filing points to a land decision this year. A short diagnostic would map the watershed and grid conditions first. Would a 20 minute call next week be useful?";

async function seed() {
  for (const x of [activities, tasks, replies, messages, enrollments, sequences, suppression, deals, meetingBriefs, relationships, mailboxState, jobs, contacts, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: "m_adv", slug: "adv", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: "m_inv", slug: "inv", name: "RA-ESG", type: "investment", rules: { massAllowed: false, approvalRequired: true } },
  ]);
  await ensureSequences(t.db, "m_adv");
  await ensureSequences(t.db, "m_inv");
}

async function person(email: string, opts: { status?: "verified_provider" | "unverified"; mandateId?: string; orgId?: string; name?: string } = {}) {
  return (await upsertContact(t.db, opts.mandateId ?? "m_adv", { fullName: opts.name ?? `Person ${email}`, email, emailStatus: opts.status ?? "verified_provider", country: "US", orgId: opts.orgId }, "other", { source: "test" })).row;
}

async function seq(mandateId: string, key: "mass_default" | "targeted_default") {
  const [s] = await t.db.select().from(sequences).where(and(eq(sequences.mandateId, mandateId), eq(sequences.key, key)));
  return s;
}

const draftOut = (overrides: Record<number, string> = {}) => ({
  messages: [
    { step: 0, channel: "email", subject: "Closure plan and land", body: overrides[0] ?? CLEAN, angle_tag: "trigger", personalization_refs: ["filing"] },
    { step: 1, channel: "linkedin_connect", subject: "", body: "Saw the closure plan filing. Regenera works on post-mining land decisions. Happy to connect.", angle_tag: "trigger", personalization_refs: [] },
    { step: 2, channel: "email", subject: "Proof point", body: "One recent Field Note covers a similar watershed question. Worth a look before any design work.", angle_tag: "proof", personalization_refs: [] },
    { step: 3, channel: "email", subject: "A direct question", body: "Is the land decision on your desk this year or with the asset team?", angle_tag: "question", personalization_refs: [] },
    { step: 4, channel: "email", subject: "Closing the loop", body: "I will leave it here. If the timing changes, the offer of a short diagnostic stands.", angle_tag: "breakup", personalization_refs: [] },
  ],
});

beforeEach(seed);

describe("enrollment guards", () => {
  it("refuses investment mandates, suppressed contacts, unverified email on mass tier and double enrollment", async () => {
    const ok = await person("ok@test.regenera.bio");
    const unverified = await person("u@test.regenera.bio", { status: "unverified" });
    const supp = await person("s@test.regenera.bio");
    await t.db.update(contacts).set({ suppressed: true }).where(eq(contacts.id, supp.id));
    const mass = await seq("m_adv", "mass_default");
    const r = await enrollContacts(t.db, { contactIds: [ok.id, unverified.id, supp.id], sequenceId: mass.id, actor: "alan" });
    expect(r.enrolled).toBe(1);
    expect(r.skipped).toMatchObject({ mass_needs_verified_email: 1, suppressed: 1 });
    const again = await enrollContacts(t.db, { contactIds: [ok.id], sequenceId: (await seq("m_adv", "targeted_default")).id, actor: "alan" });
    expect(again.skipped).toEqual({ already_enrolled: 1 });
    const inv = await person("i@test.regenera.bio", { mandateId: "m_inv" });
    const invR = await enrollContacts(t.db, { contactIds: [inv.id], sequenceId: (await seq("m_inv", "targeted_default")).id, actor: "alan" });
    expect(invR.skipped).toEqual({ investment_mandate: 1 });
    // The draft job was queued.
    expect((await t.db.select().from(jobs)).map(j => j.type)).toEqual(["outreach.draft"]);
  });
});

describe("drafting and approval", () => {
  it("retries once on a house-style failure, then queues drafts and LinkedIn tasks", async () => {
    await ensurePrompts(t.db);
    const c = await person("d@test.regenera.bio");
    const mass = await seq("m_adv", "mass_default");
    await enrollContacts(t.db, { contactIds: [c.id], sequenceId: mass.id, actor: "alan", startAt: IN_WINDOW });
    const [e] = await t.db.select().from(enrollments);
    const fake = fakeAnthropic([draftOut({ 0: "Great timing — let us talk!" }), draftOut()]);
    await draftEnrollment(t.db, AI, e.id, {}, fake.client);
    expect(fake.calls).toHaveLength(2);
    expect(String(fake.calls[1].content)).toContain("broke house style");
    const msgs = await t.db.select().from(messages).where(eq(messages.enrollmentId, e.id));
    expect(msgs).toHaveLength(5);
    expect(msgs.every(m => m.status === "pending_approval")).toBe(true);
    expect(msgs.find(m => m.step === 2)?.scheduledAt).toBe(new Date(IN_WINDOW.getTime() + 5 * 86_400_000).toISOString());
    expect(await t.db.select().from(tasks)).toHaveLength(1);
    const [enr] = await t.db.select().from(enrollments);
    expect(enr.status).toBe("active");
  });

  it("approving the first email approves the later advisory emails, edits are re-validated, undo works for 60 seconds", async () => {
    await ensurePrompts(t.db);
    const c = await person("a@test.regenera.bio");
    await enrollContacts(t.db, { contactIds: [c.id], sequenceId: (await seq("m_adv", "mass_default")).id, actor: "alan", startAt: IN_WINDOW });
    const [e] = await t.db.select().from(enrollments);
    await draftEnrollment(t.db, AI, e.id, {}, fakeAnthropic([draftOut()]).client);
    const first = (await t.db.select().from(messages).where(and(eq(messages.enrollmentId, e.id), eq(messages.step, 0))))[0];
    const bad = await approveMessage(t.db, first.id, "alan", { body: "Quick one; can we talk" });
    expect(bad.ok).toBe(false);
    expect(bad.issues?.map(i => i.rule)).toEqual(["no_semicolons"]);
    const ok = await approveMessage(t.db, first.id, "alan", { body: CLEAN }, IN_WINDOW);
    expect(ok).toEqual({ ok: true, approved: 4 }); // step 0 plus emails at steps 2, 3, 4
    const linkedin = (await t.db.select().from(messages).where(and(eq(messages.enrollmentId, e.id), eq(messages.step, 1))))[0];
    expect(linkedin.status).toBe("pending_approval");
    expect(await unapproveMessage(t.db, first.id, new Date(IN_WINDOW.getTime() + 30_000))).toBe(true);
    await approveMessage(t.db, first.id, "alan", undefined, IN_WINDOW);
    expect(await unapproveMessage(t.db, first.id, new Date(IN_WINDOW.getTime() + 90_000))).toBe(false);
  });
});

describe("sender", () => {
  type Sent = { raw: string; threadId?: string };
  function fakeGmail() {
    const sent: Sent[] = [];
    let n = 0;
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { raw: string; threadId?: string };
        const raw = new TextDecoder().decode(Uint8Array.from(atob(body.raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((body.raw.length + 3) % 4)), c => c.charCodeAt(0)));
        sent.push({ raw, threadId: body.threadId });
        n++;
        return Response.json({ id: `gm${n}`, threadId: body.threadId ?? `th${n}` });
      }
      const id = url.match(/messages\/(gm\d+)/)?.[1] ?? "x";
      return Response.json({ id, threadId: "th1", payload: { headers: [{ name: "Message-ID", value: `<${id}@mail.gmail.com>` }] } });
    }) as unknown as typeof fetch;
    return { f, sent };
  }

  async function approvedSequence(email: string, tier: "mass" | "targeted" = "mass") {
    await ensurePrompts(t.db);
    const c = await person(email);
    await enrollContacts(t.db, { contactIds: [c.id], sequenceId: (await seq("m_adv", tier === "mass" ? "mass_default" : "targeted_default")).id, actor: "alan", startAt: new Date(IN_WINDOW.getTime() - 30 * 86_400_000) });
    const [e] = await t.db.select().from(enrollments).where(eq(enrollments.contactId, c.id));
    const out = draftOut();
    if (tier === "targeted") out.messages = out.messages.map((m, i) => ({ ...m, channel: ["linkedin_connect", "email", "linkedin_message", "email", "email"][i] }));
    await draftEnrollment(t.db, AI, e.id, {}, fakeAnthropic([out]).client);
    const [first] = await t.db.select().from(messages).where(and(eq(messages.enrollmentId, e.id), eq(messages.channel, "email"))).orderBy(messages.step).limit(1);
    await approveMessage(t.db, first.id, "alan", undefined, new Date(IN_WINDOW.getTime() - 3_600_000));
    return { c, e };
  }

  const deps = (f: typeof fetch, over: Partial<SenderDeps> = {}): SenderDeps => ({
    policy: POLICY, getToken: async role => ({ accessToken: "t", email: role === "primary" ? "alanprado@regenera.bio" : "alan@send.regenera.bio" }),
    unsubscribe: { secret: "unsub-secret", baseUrl: "https://os.regenera.bio" },
    caps: { primary: 25, sendingCeiling: 40, warmupStartedOn: null }, fetchImpl: f, now: IN_WINDOW, ...over,
  });

  it("sends step by step inside the window, in one thread, with unsubscribe headers on the mass tier", async () => {
    const { e } = await approvedSequence("seq@test.regenera.bio");
    const g = fakeGmail();
    const r1 = await runSender(t.db, deps(g.f));
    expect(r1.sent).toBe(1); // only step 0: later emails wait for it
    expect(r1.deferred).toMatchObject({ spacing: 1, waiting_for_earlier_step: 2 });
    expect(g.sent[0].raw).toMatch(/List-Unsubscribe: <https:\/\/os\.regenera\.bio\/api\/unsubscribe\/[^>]+>/);
    expect(g.sent[0].raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect((await runSender(t.db, deps(g.f))).deferred.spacing).toBe(1); // step 2 is day 5: not yet
    // Monday 2026-09-28 15:00 UTC = 11:00 New York, five days after the first send.
    const r2 = await runSender(t.db, deps(g.f, { now: new Date("2026-09-28T15:00:00Z") }));
    expect(r2.sent).toBe(1);
    expect(g.sent[1].threadId).toBe("th1");
    expect(g.sent[1].raw).toContain("In-Reply-To: <gm1@mail.gmail.com>");
    expect(g.sent[1].raw).toContain("Subject: Re: Closure plan and land");
    const [m0] = await t.db.select().from(messages).where(and(eq(messages.enrollmentId, e.id), eq(messages.step, 0)));
    expect(m0).toMatchObject({ status: "sent", rfcMessageId: "<gm1@mail.gmail.com>", mailboxRole: "sending" });
  });

  it("defers outside the recipient's window and during the 60 second undo", async () => {
    await approvedSequence("w@test.regenera.bio");
    const g = fakeGmail();
    expect((await runSender(t.db, deps(g.f, { now: new Date("2026-09-26T15:00:00Z") }))).deferred.outside_window).toBeGreaterThan(0); // Saturday
    await t.db.update(messages).set({ approvedAt: new Date(IN_WINDOW.getTime() - 10_000).toISOString() });
    expect((await runSender(t.db, deps(g.f))).sent).toBe(0);
    expect(g.sent).toHaveLength(0);
  });

  it("sends exactly once under concurrent sender runs and respects the warm-up cap", async () => {
    for (let i = 0; i < 4; i++) await approvedSequence(`c${i}@test.regenera.bio`);
    const g = fakeGmail();
    const cap = { primary: 25, sendingCeiling: 40, warmupStartedOn: "2026-09-23" }; // day 1 of warm-up = 10
    await t.db.insert(mailboxState).values({ role: "sending", day: "2026-09-23", sentToday: 8 });
    const results = await Promise.all([runSender(t.db, deps(g.f, { caps: cap })), runSender(t.db, deps(g.f, { caps: cap })), runSender(t.db, deps(g.f, { caps: cap }))]);
    expect(results.reduce((a, r) => a + r.sent, 0)).toBe(2);
    expect(g.sent).toHaveLength(2);
    const ids = (await t.db.select().from(messages).where(eq(messages.status, "sent"))).map(m => m.id);
    expect(new Set(ids).size).toBe(2);
    expect(await reserveMailboxSlot(t.db, "sending", 10, IN_WINDOW)).toBe("cap");
  });

  it("never sends mass tier without unsubscribe configured, and fails non-allow-listed recipients outside production", async () => {
    await approvedSequence("n@test.regenera.bio");
    const g = fakeGmail();
    expect((await runSender(t.db, deps(g.f, { unsubscribe: null }))).deferred.unsubscribe_not_configured).toBe(1);
    await t.db.update(messages).set({ toEmail: "someone@realcompany.com" });
    expect((await runSender(t.db, deps(g.f))).failed).toBeGreaterThan(0);
    expect(g.sent).toHaveLength(0);
  });
});

describe("unsubscribe", () => {
  it("signs, rejects tampering, suppresses and stops enrollments idempotently", async () => {
    const tok = await signUnsubscribeToken("s3", "msg1", "Person@Test.Regenera.bio");
    expect(await verifyUnsubscribeToken("s3", tok)).toEqual({ messageId: "msg1", email: "person@test.regenera.bio" });
    expect(await verifyUnsubscribeToken("other", tok)).toBeNull();
    expect(await verifyUnsubscribeToken("s3", tok.replace(/^./, "x"))).toBeNull();
    const c = await person("person@test.regenera.bio");
    await enrollContacts(t.db, { contactIds: [c.id], sequenceId: (await seq("m_adv", "mass_default")).id, actor: "alan" });
    await applyUnsubscribe(t.db, { messageId: "msg1", email: "person@test.regenera.bio" });
    await applyUnsubscribe(t.db, { messageId: "msg1", email: "person@test.regenera.bio" });
    const [e] = await t.db.select().from(enrollments);
    expect(e.status).toBe("stopped");
    expect(await t.db.select().from(suppression)).toHaveLength(1);
    expect((await t.db.select().from(contacts).where(eq(contacts.id, c.id)))[0].suppressed).toBe(true);
  });
});

describe("reply routing", () => {
  const base: Classification = { classification: "interested", sentiment: "positive", needs_human: true, summary: "s", referral_name: "", referral_email: "", return_date: "", whole_org_unsubscribe: false };

  async function withReply(email: string) {
    const org = (await upsertOrganization(t.db, "m_adv", { name: `Org ${email}`, domain: email.split("@")[1] }, "other", { source: "test" })).row;
    const c = await person(email, { orgId: org.id });
    const colleague = await person(`colleague.${email}`, { orgId: org.id, name: `Colleague ${email}` });
    const mass = await seq("m_adv", "mass_default");
    await enrollContacts(t.db, { contactIds: [c.id, colleague.id], sequenceId: mass.id, actor: "alan" });
    await t.db.update(enrollments).set({ status: "active" });
    const [r] = await t.db.insert(replies).values({ mandateId: "m_adv", contactId: c.id, orgId: org.id, gmailMessageId: `g-${email}`, fromEmail: email, receivedAt: IN_WINDOW.toISOString() }).returning();
    return { org, c, colleague, r };
  }

  it("interested: stops every enrollment at the organization and opens an engaged deal", async () => {
    const { org, r } = await withReply("yes@test.regenera.bio");
    await routeReply(t.db, r.id, base, IN_WINDOW);
    expect((await t.db.select().from(enrollments)).every(e => e.status === "stopped")).toBe(true);
    const [d] = await t.db.select().from(deals).where(eq(deals.orgId, org.id));
    expect(d.stage).toBe("engaged");
    expect((await t.db.select().from(jobs)).some(j => j.type === "reply.respond")).toBe(true);
  });

  it("out of office: keeps the sequence running and shifts it past the return date", async () => {
    const { c, r } = await withReply("ooo@test.regenera.bio");
    await t.db.insert(messages).values({ mandateId: "m_adv", contactId: c.id, channel: "email", toEmail: "ooo@test.regenera.bio", subject: "s", body: "b", status: "approved", scheduledAt: IN_WINDOW.toISOString() });
    await routeReply(t.db, r.id, { ...base, classification: "out_of_office", needs_human: false, return_date: "2026-10-05" }, IN_WINDOW);
    expect((await t.db.select().from(enrollments)).every(e => e.status === "active")).toBe(true);
    const [m] = await t.db.select().from(messages).where(eq(messages.contactId, c.id));
    expect(m.scheduledAt! > "2026-10-05").toBe(true);
  });

  it("bounce suppresses the address and marks it invalid, unsubscribe can cover the whole domain", async () => {
    const b = await withReply("bounce@test.regenera.bio");
    await routeReply(t.db, b.r.id, { ...base, classification: "bounce", needs_human: false }, IN_WINDOW);
    expect((await t.db.select().from(contacts).where(eq(contacts.id, b.c.id)))[0].emailStatus).toBe("invalid");
    expect((await t.db.select().from(suppression)).map(s => s.reason)).toEqual(["bounce"]);
    await seed();
    const u = await withReply("stop@other.regenera.bio");
    await routeReply(t.db, u.r.id, { ...base, classification: "unsubscribe", needs_human: false, whole_org_unsubscribe: true }, IN_WINDOW);
    expect((await t.db.select().from(suppression)).map(s => s.domain ?? s.email).sort()).toEqual(["other.regenera.bio", "stop@other.regenera.bio"]);
  });

  it("not now: nurture with a check-back task; hostile: suppressed and parked", async () => {
    const n = await withReply("later@test.regenera.bio");
    await routeReply(t.db, n.r.id, { ...base, classification: "not_now", return_date: "2027-01-15" }, IN_WINDOW);
    expect((await t.db.select().from(contacts).where(eq(contacts.id, n.c.id)))[0].leadState).toBe("nurture");
    expect((await t.db.select().from(tasks).where(eq(tasks.type, "follow_up")))[0].dueAt).toBe("2027-01-15");
    await seed();
    const h = await withReply("angry@test.regenera.bio");
    await routeReply(t.db, h.r.id, { ...base, classification: "hostile" }, IN_WINDOW);
    expect((await t.db.select().from(contacts).where(eq(contacts.id, h.c.id)))[0]).toMatchObject({ suppressed: true, leadState: "parked" });
  });

  it("the watcher stores only CRM mail, matches by thread, and handles bounces without the model", async () => {
    const c = await person("thread@test.regenera.bio");
    await t.db.insert(messages).values({ mandateId: "m_adv", contactId: c.id, channel: "email", toEmail: c.emailLower!, subject: "s", body: "b", status: "sent", gmailThreadId: "T1", sentAt: IN_WINDOW.toISOString() });
    await t.db.insert(mailboxState).values({ role: "primary", day: "2026-09-23", historyId: "100" });
    const msgs: Record<string, unknown> = {
      r1: { id: "r1", threadId: "T1", internalDate: String(IN_WINDOW.getTime()), payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Someone <other.address@elsewhere.com>" }, { name: "Subject", value: "Re: s" }], body: { data: btoa("Sounds good").replace(/=+$/, "") } } },
      r2: { id: "r2", threadId: "T9", payload: { headers: [{ name: "From", value: "news@randomlist.com" }, { name: "Subject", value: "Newsletter" }] } },
      r3: { id: "r3", threadId: "T1", payload: { headers: [{ name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }, { name: "Subject", value: "Delivery Status Notification (Failure)" }] } },
    };
    const f = (async (url: string) => {
      if (url.includes("/history")) return Response.json({ historyId: "200", history: [{ messagesAdded: ["r1", "r2", "r3"].map(id => ({ message: { id, threadId: (msgs[id] as { threadId: string }).threadId, labelIds: ["INBOX"] } })) }] });
      const id = url.match(/messages\/(r\d)/)![1];
      return Response.json(msgs[id]);
    }) as unknown as typeof fetch;
    const n = await watchReplies(t.db, { roles: ["primary"], getToken: async () => ({ accessToken: "t", email: "alanprado@regenera.bio" }), fetchImpl: f, now: IN_WINDOW });
    expect(n).toBe(2);
    const rows = await t.db.select().from(replies);
    expect(rows.find(r => r.gmailMessageId === "r1")).toMatchObject({ contactId: c.id, body: "Sounds good", classification: null });
    expect(rows.find(r => r.gmailMessageId === "r3")?.classification).toBe("bounce");
    expect((await t.db.select().from(mailboxState))[0].historyId).toBe("200");
    expect((await t.db.select().from(jobs)).filter(j => j.type === "reply.classify")).toHaveLength(1);
  });
});

describe("calendar, relationships and digest", () => {
  it("a calendar event with a contact moves the deal to call_booked once", async () => {
    const org = (await upsertOrganization(t.db, "m_adv", { name: "Cal Org", domain: "cal.test" }, "other", { source: "test" })).row;
    await person("guest@cal.test", { orgId: org.id });
    const ev = { id: "ev1", summary: "Scoping call", start: { dateTime: "2026-09-24T14:00:00Z" }, attendees: [{ email: "alanprado@regenera.bio", self: true }, { email: "Guest@cal.test" }] };
    expect(await syncCalendarEvents(t.db, [ev], "alanprado@regenera.bio", IN_WINDOW)).toBe(1);
    expect(await syncCalendarEvents(t.db, [ev], "alanprado@regenera.bio", IN_WINDOW)).toBe(0);
    const [d] = await t.db.select().from(deals);
    expect(d.stage).toBe("call_booked");
    expect(await t.db.select().from(activities).where(eq(activities.type, "meeting"))).toHaveLength(1);
    expect((await warmPaths(t.db, "m_adv", "cal.test"))[0]).toMatchObject({ email: "guest@cal.test", meetings: 1 });
  });

  it("relationship strength aggregates two-way touches", async () => {
    for (const kind of ["sent", "received", "sent"] as const) await recordTouch(t.db, { mandateId: "m_adv", email: "cfo@fund.test", mailbox: "alanprado@regenera.bio", kind, at: IN_WINDOW.toISOString() });
    const [r] = await t.db.select().from(relationships);
    expect(r).toMatchObject({ emailsSent: 2, emailsReceived: 1 });
    expect(r.strength).toBeGreaterThan(10);
  });

  it("the digest counts the queue, replies and meetings", async () => {
    const c = await person("dg@test.regenera.bio");
    await t.db.insert(messages).values({ mandateId: "m_adv", contactId: c.id, channel: "email", toEmail: "dg@test.regenera.bio", subject: "s", body: "b", status: "pending_approval" });
    await t.db.insert(replies).values({ mandateId: "m_adv", contactId: c.id, gmailMessageId: "dg1", fromEmail: "dg@test.regenera.bio", subject: "Question", receivedAt: IN_WINDOW.toISOString(), classification: "question" });
    await t.db.insert(meetingBriefs).values({ mandateId: "m_adv", eventId: "e", title: "Call <with> A&B", startsAt: new Date(IN_WINDOW.getTime() + 3_600_000).toISOString() });
    const d = await buildDigest(t.db, IN_WINDOW);
    expect(d.queue.pending).toBe(1);
    expect(d.replies).toHaveLength(1);
    expect(d.meetings).toHaveLength(1);
    const mail = renderDigest(d, "https://os.regenera.bio");
    expect(mail.subject).toBe("Regenera OS digest: 1 to approve, 1 replies, 1 meetings");
    expect(mail.html).toContain("Call &lt;with&gt; A&amp;B");
  });
});

