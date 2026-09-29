// Prospecting compliance: classification, permission states with reasons, escalation when rules are missing or not
// reviewed, scenario H (success-fee equity raise → legal review, never auto-launch), approval rules, and the
// enrollment gate (unapproved campaign blocks; unknown provenance and preferences filter the audience).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { campaigns, contactPreferences, contacts, enrollments, jobs, jurisdictionRules, mandates, sequences } from "@/db/schema";
import { approveCampaign, assessCampaign, classifyActivity, legalBrief, refreshAssessment } from "@/lib/compliance/engine";
import { enrollContacts } from "@/lib/outreach/sequences";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [enrollments, jobs, contactPreferences, campaigns, jurisdictionRules, contacts, sequences, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});
const camp = (o: Partial<typeof campaigns.$inferInsert> = {}) => ({ mandateId: M, name: "Developers LATAM", service: "Project screening", countries: ["MEX", "COL"], recipientTypes: ["developer"], channel: "email", dataSources: ["public_corporate"], createdBy: "alan", ...o });
const rule = (o: Partial<typeof jurisdictionRules.$inferInsert>) => ({ mandateId: M, jurisdiction: "MEX", topic: "b2b_email" as const, summary: "s", sourceUrl: "https://example.org/law", counselStatus: "reviewed" as const, lastReviewed: new Date().toISOString().slice(0, 10), createdBy: "alan", ...o });

describe("classification and permission", () => {
  it("escalates when rules are missing, then allows with conditions once reviewed rules exist (scenario G)", async () => {
    const [c] = await t.db.insert(campaigns).values(camp()).returning();
    let r = await refreshAssessment(t.db, c.id);
    expect(r.a.activity).toBe("advisory_marketing");
    expect(r.a.permission).toBe("legal_review_required");
    expect(r.a.missing.length).toBe(4);
    for (const j of ["MEX", "COL"]) for (const topic of ["b2b_email", "data_protection"] as const) await t.db.insert(jurisdictionRules).values(rule({ jurisdiction: j, topic, requirements: "Identify sender", optOut: "One-click unsubscribe" }));
    r = await refreshAssessment(t.db, c.id);
    expect(r.a.permission).toBe("allowed_with_conditions");
    expect(r.a.risk).toBe("low");
    const b = legalBrief(r.c, r.rules, r.a);
    expect(b.disclaimer).toMatch(/not legal advice/);
    expect(b.sections.find(s => s.heading === "Sources")!.lines).toHaveLength(4);
  });

  it("scenario H: an equity raise with a success fee needs legal review and cannot be self-approved", async () => {
    const [c] = await t.db.insert(campaigns).values(camp({ name: "Find equity investors for Project X", countries: ["USA"], recipientTypes: ["institutional_investor"], capitalRelated: true, successFee: true, service: "Capital raise" })).returning();
    const { a } = await refreshAssessment(t.db, c.id);
    expect(a.activity).toBe("institutional_introduction");
    expect(a.permission).toBe("legal_review_required");
    expect(a.permissionReasons.join(" ")).toMatch(/broker/);
    await expect(approveCampaign(t.db, c.id, "alan", "ok", "")).rejects.toThrow(/counsel/);
    await expect(approveCampaign(t.db, c.id, "alan", "ok", "Counsel X, 2026-09-20")).rejects.toThrow(/other than their creator/);
    await approveCampaign(t.db, c.id, "partner@regenera.bio", "Reviewed", "Counsel X, 2026-09-20");
    expect((await t.db.select().from(campaigns).where(eq(campaigns.id, c.id)))[0].status).toBe("approved");
  });

  it("blocks securities solicitation of individual investors", () => {
    const a = assessCampaign({ ...camp({ securitiesRelated: true, recipientTypes: ["individual_investor"] }), id: "x", status: "draft", commercial: true, capitalRelated: true, successFee: false, maOrAssetSale: false, partnership: false, research: false, cta: "", sequenceId: null, assessment: {}, approvedBy: null, approvedAt: null, approvalNote: "", createdAt: "", updatedAt: "" } as never, []);
    expect(a.permission).toBe("blocked");
    expect(classifyActivity({ securitiesRelated: false, maOrAssetSale: false, capitalRelated: true, research: false, partnership: false, service: "Senior debt", recipientTypes: ["institutional_investor"], commercial: true })).toBe("debt_introduction");
  });
});

describe("enrollment gate", () => {
  it("blocks enrollment until the linked campaign is approved, then filters unknown provenance and opt-outs", async () => {
    const [seq] = await t.db.insert(sequences).values({ mandateId: M, key: "k", name: "Seq", tier: "targeted", steps: [{ step: 1, channel: "email", delayDays: 0 }] as never }).returning();
    const mk = (email: string, source: string) => t.db.insert(contacts).values({ mandateId: M, fullName: email, nameNormalized: email, email, emailLower: email, source } as never).returning();
    const [[a], [b], [c]] = await Promise.all([mk("a@x.com", "referral"), mk("b@x.com", "other"), mk("c@x.com", "event")]);
    await t.db.insert(contactPreferences).values({ mandateId: M, contactId: c.id, status: "email_opt_out", recordedBy: "alan" });
    const [cp] = await t.db.insert(campaigns).values(camp({ sequenceId: seq.id })).returning();
    await expect(enrollContacts(t.db, { contactIds: [a.id], sequenceId: seq.id, actor: "alan" })).rejects.toThrow(/approve it/);
    await t.db.update(campaigns).set({ status: "approved" }).where(eq(campaigns.id, cp.id));
    const out = await enrollContacts(t.db, { contactIds: [a.id, b.id, c.id], sequenceId: seq.id, actor: "alan" });
    expect(out.enrolled).toBe(1);
    expect(out.skipped).toMatchObject({ unknown_provenance: 1, preference_email_opt_out: 1 });
  });
});
