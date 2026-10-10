// Phase 29B on synthetic records: Scenario A (casual relationship: source, referrer, next action, nurture, never a
// client), Scenario C (partnership: verified capability, arrangement, agreement, introduction with authorization,
// duplicate refused, outcome; never counted as a paying client), and intake (duplicate submission is one record,
// attribution kept, conversion matches an existing organization by domain, creates the opportunity and a qualification
// task, and a failed conversion keeps the submission with its error).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { attributions, contacts, deals, intakeSubmissions, mandates, organizations, relationshipIntroductions, relationshipStatus, tasks } from "@/db/schema";
import { captureContact, createIntroduction, movePartnership, setIntroductionOutcome, setRelationshipStage, upsertPartnership } from "@/lib/lifecycle/network";
import { stageHistory } from "@/lib/lifecycle/pipeline";
import { rolesFor } from "@/lib/lifecycle/relationships";
import { convertIntake, submitIntake } from "@/lib/portal/intake";
import { createTestDb } from "../helpers/d1";

const M = "d2910000-0000-4000-8000-000000000001";
const by = "owner@example.com";
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(mandates).values({ id: M, slug: "s29b", name: "s29b", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("Scenario A: casual relationship", () => {
  it("keeps source and referrer, creates a next action, moves to nurture, and never makes a client", async () => {
    await expect(captureContact(t.db, M, { name: "TEST Dana Field", channel: "event", nextAction: "" }, by)).rejects.toThrow(/next action/);
    const r = await captureContact(t.db, M, { name: "TEST Dana Field", email: "dana@field-energy.example", organization: "TEST Field Energy", channel: "informal_introduction", referrerName: "TEST Sam Friend", note: "Met at a dinner", nextAction: "Send intro note", nextActionDue: "2026-10-20" }, by);
    const src = await t.db.select().from(attributions).where(and(eq(attributions.entityType, "contact"), eq(attributions.entityId, r.contactId)));
    expect(src[0]).toMatchObject({ kind: "original", channel: "referral" });
    expect(src[0].introducerContactId).toBeTruthy();
    expect((await t.db.select().from(tasks).where(eq(tasks.contactId, r.contactId)))[0].title).toMatch(/Send intro note/);
    const roles = await rolesFor(t.db, M, "contact", r.contactId);
    expect(roles.map(x => x.role)).toEqual(["acquaintance"]);
    await expect(setRelationshipStage(t.db, M, "contact", r.contactId, "nurture", { nextAction: "", noActionReason: "" }, by)).rejects.toThrow(/next action/);
    await setRelationshipStage(t.db, M, "contact", r.contactId, "nurture", {}, by); // keeps the existing next action
    await expect(setRelationshipStage(t.db, M, "contact", r.contactId, "closed", {}, by)).rejects.toThrow(/reason/);
    const [s] = await t.db.select().from(relationshipStatus).where(eq(relationshipStatus.entityId, r.contactId));
    expect(s.stage).toBe("nurture");
    expect((await stageHistory(t.db, "contact", r.contactId)).map(h => h.toStage)).toEqual(["identified", "nurture"]);
    expect((await rolesFor(t.db, M, "contact", r.contactId)).some(x => x.role === "client")).toBe(false);
    expect(await t.db.select().from(deals).where(eq(deals.contactId, r.contactId))).toHaveLength(0);
    // Same email again matches the person instead of creating a duplicate.
    const again = await captureContact(t.db, M, { name: "Dana F.", email: "DANA@field-energy.example", channel: "linkedin", nextAction: "Comment on post" }, by);
    expect(again).toMatchObject({ contactId: r.contactId, matched: "email" });
  });
});

describe("Scenario C: partnership", () => {
  it("verifies capability, agrees an arrangement, tracks an introduction, and is never a paying client", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "TEST GridWorks EPC", nameNormalized: "test gridworks epc", source: "referral" } as never).returning();
    const [target] = await t.db.insert(organizations).values({ mandateId: M, name: "TEST Solar Sponsor", nameNormalized: "test solar sponsor", source: "referral" } as never).returning();
    const p = await upsertPartnership(t.db, M, org.id, "technical", { capabilities: ["EPC", "BESS integration"] }, by);
    await expect(movePartnership(t.db, p.id, "discussion", {}, by)).rejects.toThrow(/Verify/);
    await expect(movePartnership(t.db, p.id, "capability_verified", {}, by)).rejects.toThrow(/evidence/);
    await movePartnership(t.db, p.id, "capability_verified", { evidence: "Two references, 120 MW delivered" }, by);
    await movePartnership(t.db, p.id, "discussion", {}, by);
    await expect(movePartnership(t.db, p.id, "proposed_arrangement", {}, by)).rejects.toThrow(/arrangement/);
    await movePartnership(t.db, p.id, "proposed_arrangement", { arrangement: "Joint bids on Yucatán solar diagnostics" }, by);
    await expect(movePartnership(t.db, p.id, "active", {}, by)).rejects.toThrow(/agreed/);
    await expect(movePartnership(t.db, p.id, "agreed", {}, by)).rejects.toThrow(/agreement/);
    const agreed = await movePartnership(t.db, p.id, "agreed", { evidence: "Signed teaming letter 2026-10-08" }, by);
    expect(agreed.commercialTerms ?? "").toBe("");
    await movePartnership(t.db, p.id, "active", {}, by);
    expect((await stageHistory(t.db, "partnership", p.id)).map(h => h.toStage)).toEqual(["potential", "capability_verified", "discussion", "proposed_arrangement", "agreed", "active"]);

    await expect(createIntroduction(t.db, { mandateId: M, fromOrgId: org.id, toOrgId: target.id, purpose: "EPC for the Sponsor site", materialsShared: ["Capability deck"] }, by)).rejects.toThrow(/authorized/);
    const intro = await createIntroduction(t.db, { mandateId: M, fromOrgId: org.id, toOrgId: target.id, partnershipId: p.id, purpose: "EPC for the Sponsor site", authorization: "Sponsor CEO agreed by email 2026-10-09", materialsShared: ["Capability deck"] }, by);
    await expect(createIntroduction(t.db, { mandateId: M, fromOrgId: org.id, toOrgId: target.id, purpose: "EPC  for the sponsor site" }, by)).rejects.toThrow(/already open/);
    await setIntroductionOutcome(t.db, intro.id, "engaged", "Site visit booked", by);
    expect((await t.db.select().from(relationshipIntroductions).where(eq(relationshipIntroductions.id, intro.id)))[0]).toMatchObject({ outcome: "engaged", openKey: null });
    const roles = await rolesFor(t.db, M, "organization", org.id);
    expect(roles.map(x => x.role)).toContain("technical_partner");
    expect(roles.some(x => x.role === "client")).toBe(false);
  });
});

describe("intake", () => {
  it("dedupes, keeps attribution, matches by domain, creates the opportunity and task, and keeps failures", async () => {
    const [existing] = await t.db.insert(organizations).values({ mandateId: M, name: "TEST Agro Coop", nameNormalized: "test agro coop", domain: "agrocoop.example", source: "other" } as never).returning();
    const raw = { name: "TEST Rosa Campo", email: "rosa@agrocoop.example", organization: "Agro Cooperative (TEST)", need: "Regenerative transition plan for 400 ha", timing: "Q1" };
    const meta = { attribution: { utm_source: "newsletter", utm_campaign: "oct", landing: "/intake/advisory", heard: "A friend" }, consent: "updates" };
    const a = await submitIntake(t.db, "advisory", raw, "ip-test", new Date(), meta);
    const b = await submitIntake(t.db, "advisory", raw, "ip-test", new Date(), meta);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(await t.db.select().from(intakeSubmissions).where(eq(intakeSubmissions.email, "rosa@agrocoop.example"))).toHaveLength(1);
    const [sub] = await t.db.select().from(intakeSubmissions).where(eq(intakeSubmissions.id, a.id));
    expect(sub).toMatchObject({ consent: "updates", attribution: { utm_source: "newsletter", utm_campaign: "oct", landing: "/intake/advisory", heard: "A friend" } });
    expect((await t.db.select().from(tasks).where(eq(tasks.workstream, `intake:${a.id}`)))).toHaveLength(1);

    const conv = await convertIntake(t.db, a.id, M, by);
    expect(conv.type).toBe("deal");
    const [deal] = await t.db.select().from(deals).where(eq(deals.id, conv.id));
    expect(deal).toMatchObject({ orgId: existing.id, commercialStage: "need_identified" });
    const [person] = await t.db.select().from(contacts).where(eq(contacts.emailLower, "rosa@agrocoop.example"));
    expect(person.orgId).toBe(existing.id);
    expect((await t.db.select().from(tasks).where(eq(tasks.dealId, deal.id)))[0].title).toMatch(/Qualify/);
    const src = await t.db.select().from(attributions).where(and(eq(attributions.entityType, "deal"), eq(attributions.entityId, deal.id)));
    expect(src[0]).toMatchObject({ channel: "inbound", campaign: "newsletter / oct" });
    expect((await rolesFor(t.db, M, "contact", person.id)).map(r => r.role)).toEqual(["prospect"]);
    await expect(convertIntake(t.db, a.id, M, by)).rejects.toThrow(/Already converted/);

    // A conversion that fails keeps the submission, unconverted, with the error.
    const [broken] = await t.db.insert(intakeSubmissions).values({ kind: "project", name: "TEST Broken", email: "broken@example.com", payload: {} }).returning();
    await expect(convertIntake(t.db, broken.id, M, by)).rejects.toThrow();
    const [after] = await t.db.select().from(intakeSubmissions).where(eq(intakeSubmissions.id, broken.id));
    expect(after.status).toBe("new");
    expect(after.conversionError).toBeTruthy();
  });
});
