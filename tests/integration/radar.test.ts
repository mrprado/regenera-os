import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activities, contacts, deals, enrollments, extensionTokens, jobs, listEntries, listSources, mandateMembers, mandates, messages, organizations, partners,
  providerCalls, relationships, replies, reports, savedSearches, searchResults, segments, sequences, siteEvents, sourceCache, suppression, tasks, triggers,
} from "@/db/schema";
import { ensurePrompts } from "@/lib/ai/run";
import { checkConflicts } from "@/lib/crm/conflicts";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { applySiteEvent, syncPartnerAccounts, zPartnerAccount } from "@/lib/crm/site-intake";
import { handleExtensionRequest, issueExtensionToken, revokeExtensionToken, verifyExtensionToken } from "@/lib/extension";
import { ensureSequences } from "@/lib/outreach/sequences";
import { applyListEntries, ensureListSources, type ListEntry } from "@/lib/radar/lists";
import { ensureSavedSearches, runSavedSearch } from "@/lib/radar/saved-searches";
import { computeMetrics } from "@/lib/reports/metrics";
import { buildWeeklyReport } from "@/lib/reports/weekly";
import { ensureSegments } from "@/lib/segments";
import { findPeopleForTrigger, pursueTrigger } from "@/lib/triggers/pursue";
import { createTestDb } from "../helpers/d1";
import { fakeAnthropic } from "../helpers/fake-anthropic";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); await ensureSegments(t.db); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const APOLLO = { apiKey: "k", monthlyCreditBudget: 5 };
const NOW = new Date("2026-09-23T15:00:00Z");

beforeEach(async () => {
  for (const x of [activities, tasks, replies, messages, enrollments, sequences, suppression, deals, relationships, siteEvents, partners, searchResults, savedSearches,
    listEntries, listSources, extensionTokens, mandateMembers, reports, triggers, jobs, contacts, organizations, providerCalls, sourceCache, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory" as const, rules: { massAllowed: true, approvalRequired: true } },
    { id: "m_other", slug: "other", name: "Other", type: "investment" as const, rules: { massAllowed: false, approvalRequired: true } },
  ]);
  await ensureSequences(t.db, M);
});

async function trigger(orgName: string, domain: string) {
  const org = (await upsertOrganization(t.db, M, { name: orgName, domain, country: "Peru" }, "trigger", { source: "test" })).row;
  const [tr] = await t.db.insert(triggers).values({
    mandateId: M, orgId: org.id, type: "capital", summary: `${orgName} closes a regenerative fund`, eventDate: "2026-09-20", source: "gdelt", urgency: 4,
    suggestedEngagement: JSON.stringify({ titles: ["Chief Investment Officer", "Head of Impact"] }), decisionRead: "Deployment pressure this year.",
  }).returning();
  return { org, tr };
}

const apolloPeople = (people: unknown[]) => {
  const calls: string[] = [];
  const f = (async (url: string) => { calls.push(url); return Response.json({ people }); }) as unknown as typeof fetch;
  return { f, calls };
};

describe("conflict check", () => {
  it("flags open deals, active sequences, other mandates, suppressed domains and warm paths", async () => {
    const { org } = await trigger("Andes Capital", "andes.test");
    expect(await checkConflicts(t.db, M, { orgId: org.id })).toEqual([]);
    await t.db.insert(deals).values({ mandateId: M, orgId: org.id, name: "Existing", path: "capital_mandate", stage: "engaged" });
    await upsertOrganization(t.db, "m_other", { name: "Andes Capital", domain: "andes.test" }, "other", { source: "test" });
    await t.db.insert(suppression).values({ domain: "andes.test", reason: "legal" });
    await t.db.insert(relationships).values({ mandateId: M, email: "cio@andes.test", domain: "andes.test", mailbox: "alanprado@regenera.bio", emailsSent: 3, strength: 40 });
    const c = await checkConflicts(t.db, M, { orgId: org.id });
    expect(c.map(x => x.kind).sort()).toEqual(["open_deal", "other_mandate", "suppressed", "warm_path"]);
    expect(c.find(x => x.kind === "other_mandate")?.detail).not.toContain("Other"); // no details from the other mandate
    expect(c.find(x => x.kind === "warm_path")?.blocking).toBe(false);
  });
});

describe("pursue a trigger", () => {
  const person = (id: string, first: string) => ({ id, first_name: first, last_name: "Quispe", name: `${first} Quispe`, title: "Chief Investment Officer", linkedin_url: `https://www.linkedin.com/in/${first.toLowerCase()}-quispe` });

  it("searches by the trigger's titles (free), saves the picks, enrolls them and marks the trigger pursued", async () => {
    const { org, tr } = await trigger("Inca Fund", "inca.test");
    // Two known addresses teach the pattern, so the new person's address is inferred without Apollo credits.
    for (const [f, l] of [["Ana", "Mamani"], ["Luis", "Rojas"]]) await upsertContact(t.db, M, { fullName: `${f} ${l}`, firstName: f, lastName: l, email: `${f.toLowerCase()}.${l.toLowerCase()}@inca.test`, orgId: org.id, emailStatus: "verified_manual" }, "other", { source: "test" });
    const mx = (async (url: string) => (String(url).includes("dns-query") ? Response.json({ Status: 0, Answer: [{ type: 15, data: "1 mx.inca.test." }] }) : Response.json({ people: [person("ap1", "Rosa")] }))) as unknown as typeof fetch;
    const found = await findPeopleForTrigger(t.db, APOLLO, tr.id, mx);
    expect(found?.searchedBy).toBe("titles");
    expect(found?.people.map(p => p.id)).toEqual(["ap1"]);
    const seq = (await t.db.select().from(sequences).where(eq(sequences.key, "targeted_default")))[0];
    const r = await pursueTrigger(t.db, APOLLO, { triggerId: tr.id, people: [person("ap1", "Rosa")], sequenceId: seq.id, apolloEnrich: false, overrideConflicts: false, actor: "alan" }, mx);
    expect(r).toMatchObject({ saved: 1, emails: 1, credits: 0, blocked: false });
    expect(r.enrolled?.enrolled).toBe(1);
    const [c] = await t.db.select().from(contacts).where(eq(contacts.apolloPersonId, "ap1"));
    expect(c).toMatchObject({ sourceTriggerId: tr.id, source: "trigger", emailLower: "rosa.quispe@inca.test", emailStatus: "inferred" });
    expect((await t.db.select().from(triggers).where(eq(triggers.id, tr.id)))[0].status).toBe("pursued");
    expect((await t.db.select().from(providerCalls).where(eq(providerCalls.provider, "apollo"))).reduce((a, x) => a + x.credits, 0)).toBe(0);
  });

  it("a blocking conflict saves the people but does not enroll, unless overridden", async () => {
    const { org, tr } = await trigger("Puna Energy", "puna.test");
    await t.db.insert(deals).values({ mandateId: M, orgId: org.id, name: "Referral deal", path: "project_diagnostic", stage: "lead", source: "referral" });
    const seq = (await t.db.select().from(sequences).where(eq(sequences.key, "targeted_default")))[0];
    const blocked = await pursueTrigger(t.db, APOLLO, { triggerId: tr.id, people: [person("ap2", "Juan")], sequenceId: seq.id, apolloEnrich: false, overrideConflicts: false, actor: "alan" }, apolloPeople([]).f);
    expect(blocked.blocked).toBe(true);
    expect(blocked.enrolled).toBeNull();
    expect(blocked.conflicts.map(c => c.kind)).toContain("partner_referral");
    expect(await t.db.select().from(enrollments)).toHaveLength(0);
    const ok = await pursueTrigger(t.db, APOLLO, { triggerId: tr.id, people: [person("ap2", "Juan")], sequenceId: seq.id, apolloEnrich: false, overrideConflicts: true, actor: "alan" }, apolloPeople([]).f);
    expect(ok.blocked).toBe(false);
    expect(ok.enrolled?.skipped).toEqual({ no_email: 1 }); // no address found and no credits spent: enrollment still refuses
  });
});

describe("saved searches", () => {
  it("returns only people not already in the CRM, and re-runs add nothing new", async () => {
    await ensureSavedSearches(t.db, M);
    const all = await t.db.select().from(savedSearches);
    expect(all.filter(s => s.kind === "xray").length).toBeGreaterThan(5);
    const s = all.find(x => x.kind === "apollo_people")!;
    await upsertContact(t.db, M, { fullName: "Known Person", apolloPersonId: "known" }, "apollo", { source: "test" });
    const { f, calls } = apolloPeople([{ id: "known", name: "Known Person" }, { id: "fresh", name: "Fresh Person", title: "CIO", organization: { name: "Fresh Co" } }]);
    expect(await runSavedSearch(t.db, APOLLO, s.id, NOW, f)).toBe(1);
    expect(calls[0]).toContain("mixed_people/api_search");
    await t.db.delete(sourceCache);
    expect(await runSavedSearch(t.db, APOLLO, s.id, NOW, f)).toBe(0);
    const [r] = await t.db.select().from(searchResults);
    expect(r).toMatchObject({ externalId: "fresh", name: "Fresh Person", subtitle: "CIO · Fresh Co", status: "new" });
  });
});

describe("public list diffs", () => {
  const entry = (key: string, name: string, updated: string | null, inScope = true): ListEntry => ({ key, name, country: "Chile", sector: "Water Utilities", inScope, leadSource: "compliance", detail: { updated } });

  it("records a baseline (recent entries only count as new), then flags only unseen entries", async () => {
    await ensureListSources(t.db);
    const first = await applyListEntries(t.db, "sbti", [entry("1", "Old Water Co", "2024-02-01"), entry("2", "Recent Water Co", "2026-09-01"), entry("3", "Software Co", "2026-09-10", false)], M, NOW);
    expect(first).toMatchObject({ baseline: true, count: 3, newEntries: 1, orgsCreated: 1 });
    expect(await t.db.select().from(listEntries)).toHaveLength(2); // out-of-scope entries are not tracked
    const second = await applyListEntries(t.db, "sbti", [entry("1", "Old Water Co", "2024-02-01"), entry("2", "Recent Water Co", "2026-09-01"), entry("4", "New Water Co", null)], M, NOW);
    expect(second).toMatchObject({ baseline: false, newEntries: 1, orgsCreated: 1 });
    const orgs = await t.db.select({ name: organizations.name, source: organizations.source }).from(organizations);
    expect(orgs.map(o => o.name).sort()).toEqual(["New Water Co", "Recent Water Co"]);
    expect(orgs.every(o => o.source === "compliance")).toBe(true);
    const third = await applyListEntries(t.db, "sbti", [entry("4", "New Water Co", null)], M, NOW);
    expect(third.newEntries).toBe(0);
  });
});

describe("LinkedIn extension", () => {
  it("rejects bad and revoked tokens", async () => {
    await t.db.insert(mandateMembers).values({ mandateId: M, email: "alanprado@regenera.bio", role: "owner" });
    expect(await verifyExtensionToken(t.db, null)).toBeNull();
    expect(await verifyExtensionToken(t.db, "Bearer rox_notarealtokenatallxxxxxxxx")).toBeNull();
    const token = await issueExtensionToken(t.db, "alanprado@regenera.bio");
    expect(await verifyExtensionToken(t.db, `Bearer ${token}`)).toEqual({ email: "alanprado@regenera.bio", mandateIds: [M] });
    const [row] = await t.db.select().from(extensionTokens);
    expect(row.tokenHash).not.toContain(token.slice(4, 20)); // only the hash is stored
    await revokeExtensionToken(t.db, row.id, "alanprado@regenera.bio");
    expect(await verifyExtensionToken(t.db, `Bearer ${token}`)).toBeNull();
  });

  it("captures by URL then by name and organization, and mark sent advances the step once", async () => {
    const user = { email: "alanprado@regenera.bio", mandateIds: [M] };
    const created = await handleExtensionRequest(t.db, user, { action: "capture", profile: { url: "https://www.linkedin.com/in/maria-lopez/?trk=x", name: "María López", headline: "CFO at Agua Viva", location: "Lima", company: "Agua Viva", title: "CFO" } });
    expect(created.body).toMatchObject({ created: true, contact: { fullName: "María López", orgName: "Agua Viva" } });
    const again = await handleExtensionRequest(t.db, user, { action: "capture", profile: { url: "https://www.linkedin.com/in/maria-lopez", name: "María López", headline: "", location: "", company: "Agua Viva", title: "CFO" } });
    expect(again.body).toMatchObject({ created: false });
    expect(await t.db.select().from(contacts)).toHaveLength(1);
    // Same person saved earlier without a URL (e.g. from a CSV) matches by name and organization.
    const org = (await t.db.select().from(organizations))[0];
    await upsertContact(t.db, M, { fullName: "Pedro Ruiz", orgId: org.id }, "other", { source: "test" });
    const byName = await handleExtensionRequest(t.db, user, { action: "capture", profile: { url: "https://www.linkedin.com/in/pedro-ruiz", name: "Pedro Ruiz", headline: "", location: "", company: "Agua Viva", title: "COO" } });
    expect(byName.body).toMatchObject({ created: false });
    expect(await t.db.select().from(contacts)).toHaveLength(2);

    const c = (await t.db.select().from(contacts).where(eq(contacts.fullName, "María López")))[0];
    const [m] = await t.db.insert(messages).values({ mandateId: M, contactId: c.id, channel: "linkedin_connect", toEmail: "", subject: "", body: "Hola María", status: "approved" }).returning();
    const [task] = await t.db.insert(tasks).values({ mandateId: M, contactId: c.id, messageId: m.id, type: "linkedin_connect", title: "Send note", body: "Hola María", dueAt: "2026-09-24" }).returning();
    const look = await handleExtensionRequest(t.db, user, { action: "lookup", url: "https://www.linkedin.com/in/maria-lopez" });
    expect((look.body as { tasks: unknown[] }).tasks).toHaveLength(1);
    expect((await handleExtensionRequest(t.db, user, { action: "mark_sent", taskId: task.id })).body).toMatchObject({ result: "completed", tasks: [] });
    expect((await handleExtensionRequest(t.db, user, { action: "mark_sent", taskId: task.id })).body).toMatchObject({ result: "already" });
    expect((await t.db.select().from(messages).where(eq(messages.id, m.id)))[0].status).toBe("sent");
    expect(await t.db.select().from(activities).where(eq(activities.type, "linkedin"))).toHaveLength(1);
    // Another mandate's user cannot touch the task.
    expect((await handleExtensionRequest(t.db, { email: "x@y.z", mandateIds: ["m_other"] }, { action: "mark_sent", taskId: task.id })).status).toBe(404);
  });
});

describe("Partner Network sync", () => {
  const ref = (status: string, tier = "standard") => ({
    id: 7, partnerName: "Carla Díaz", partnerEmail: "Carla@EPC.test", partnerOrg: "EPC Andina", type: "opportunity" as const, refName: "Jorge Paz", refOrg: "Minera Sur",
    sector: "Land & Built Environment", context: "Closure plan", tier: tier as "standard", status: status as "submitted", date: "2026-09-20", createdAt: "2026-09-20 10:00:00",
  });

  it("creates the deal linked to the partner, moves it forward on status changes and ignores replays", async () => {
    const created = await applySiteEvent(t.db, { event: "referral.created", data: ref("submitted") });
    const [d0] = await t.db.select().from(deals).where(eq(deals.id, created.dealId!));
    const [p] = await t.db.select().from(partners);
    expect(d0).toMatchObject({ stage: "lead", source: "referral", partnerId: p.id });
    await applySiteEvent(t.db, { event: "referral.updated", data: ref("scoped") });
    expect((await t.db.select().from(deals).where(eq(deals.id, d0.id)))[0].stage).toBe("engaged");
    const before = (await t.db.select().from(activities)).length;
    await applySiteEvent(t.db, { event: "referral.updated", data: ref("scoped") }); // hourly reconcile replay
    expect(await t.db.select().from(activities)).toHaveLength(before);
    await applySiteEvent(t.db, { event: "referral.updated", data: ref("mandate_signed", "strategic") });
    expect((await t.db.select().from(deals).where(eq(deals.id, d0.id)))[0].stage).toBe("signed");
    expect((await t.db.select().from(partners))[0].tier).toBe("strategic");
    await applySiteEvent(t.db, { event: "referral.updated", data: ref("scoped", "strategic") }); // out of order: never moves back
    expect((await t.db.select().from(deals).where(eq(deals.id, d0.id)))[0].stage).toBe("signed");
  });

  it("declined closes the deal as lost", async () => {
    const created = await applySiteEvent(t.db, { event: "referral.created", data: ref("submitted") });
    await applySiteEvent(t.db, { event: "referral.updated", data: ref("declined") });
    expect((await t.db.select().from(deals).where(eq(deals.id, created.dealId!)))[0]).toMatchObject({ stage: "lost", lostReason: "Declined (Partner Network referral)" });
  });

  it("partner accounts sync, and the schema refuses any password field", async () => {
    expect(zPartnerAccount.safeParse({ id: 1, name: "A", organization: "", email: "a@b.c", createdAt: "x", passwordHash: "h" }).success).toBe(false);
    await syncPartnerAccounts(t.db, [{ id: 3, name: "Carla Díaz", organization: "EPC Andina", email: "carla@epc.test", createdAt: "2026-09-01" }], M);
    await syncPartnerAccounts(t.db, [{ id: 3, name: "Carla Díaz", organization: "EPC Andina", email: "carla@epc.test", createdAt: "2026-09-01" }], M);
    const rows = await t.db.select().from(partners);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ siteAccountId: 3, organization: "EPC Andina", status: "active" });
  });
});

describe("reports", () => {
  it("computes reply rates, pipeline weighting and time from trigger to first touch", async () => {
    const seg = (await t.db.select().from(segments))[0];
    const { tr } = await trigger("Rio Fund", "rio.test");
    const mk = async (name: string, reply: string | null) => {
      const c = (await upsertContact(t.db, M, { fullName: name, email: `${name.toLowerCase()}@rio.test`, segmentId: seg.id }, "trigger", { source: "test" })).row;
      await t.db.update(contacts).set({ sourceTriggerId: tr.id }).where(eq(contacts.id, c.id));
      await t.db.insert(messages).values({ mandateId: M, contactId: c.id, channel: "email", toEmail: c.emailLower!, subject: "s", body: "b", status: "sent", sentAt: "2026-09-21T15:00:00Z", tier: "targeted", angleTag: "trigger" });
      if (reply) await t.db.insert(replies).values({ mandateId: M, contactId: c.id, gmailMessageId: `g-${name}`, fromEmail: c.emailLower!, receivedAt: "2026-09-22T10:00:00Z", classification: reply as "interested" });
    };
    await mk("Ana", "interested");
    await mk("Bea", "not_now");
    await mk("Cai", "out_of_office");
    await mk("Dan", null);
    await t.db.update(triggers).set({ createdAt: "2026-09-20T15:00:00Z" }).where(eq(triggers.id, tr.id));
    await t.db.insert(deals).values([
      { mandateId: M, name: "A", path: "capital_mandate", stage: "proposal", valueEstimate: 100_000, practice: "capital_partnerships" },
      { mandateId: M, name: "B", path: "capital_mandate", stage: "engaged", valueEstimate: 50_000, probability: 40 },
    ]);
    const m = await computeMetrics(t.db, [M], { from: "2026-09-16T00:00:00Z", to: "2026-09-24T00:00:00Z" });
    expect(m.outreach).toMatchObject({ contactsEmailed: 4, replied: 2, positive: 1, replyRate: 50, positiveRate: 25 });
    expect(m.outreach.byDim.angle[0]).toMatchObject({ key: "trigger", sent: 4, replies: 2 });
    expect(m.outreach.byDim.funnel[0].key).toBe("trigger");
    expect(m.pipeline.weighted).toBe(50_000 + 20_000); // 50% default for proposal, 40% set explicitly
    expect(m.triggerToFirstTouchHours).toEqual([{ type: "capital", triggers: 1, medianHours: 24 }]);
  });

  it("the weekly report stores numbers, and Claude's narrative validates against its schema", async () => {
    await ensurePrompts(t.db);
    const numbersOnly = await buildWeeklyReport(t.db, null, M, new Date("2026-09-28T12:00:00Z"));
    expect(numbersOnly).toMatchObject({ periodStart: "2026-09-21", periodEnd: "2026-09-28", body: null });
    const fake = fakeAnthropic([{ headline: "Quiet week", pipeline_movement: "No stage changes.", wins: [], stalled: [], best_angles: [], worst_angles: [], triggers_worth_attention: [], recommended_actions: ["One", "Two", "Three"] }]);
    const r = await buildWeeklyReport(t.db, { apiKey: "x", monthlyBudgetUsd: 50 }, M, new Date("2026-09-28T12:00:00Z"), fake.client);
    expect((r?.body as { recommended_actions: string[] }).recommended_actions).toHaveLength(3);
    expect(await t.db.select().from(reports)).toHaveLength(1);
    expect(String(fake.calls[0].content)).toContain("Metrics JSON");
  });
});

