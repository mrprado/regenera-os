// Phase 29D on synthetic records: next-action and stall detection for Today, the meeting follow-up (tasks with owners
// and dates, a follow-up draft that waits for approval, a stage suggestion that is not applied), and engagement
// completion (acceptance required, open work recorded with a reason, review scheduled, asks only when chosen).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clientRequests, contacts, deals, engagementCloseouts, engagementDeliverables, engagements, invoices, mandates, messages, offerProposals, offerProposalVersions, organizations, relationshipStatus, tasks } from "@/db/schema";
import { lifecycleAttention } from "@/lib/lifecycle/attention";
import { completeEngagement } from "@/lib/lifecycle/closeout";
import { reviewMeeting } from "@/lib/lifecycle/meetings";
import { rolesFor } from "@/lib/lifecycle/relationships";
import { createTestDb } from "../helpers/d1";

const M = "d2930000-0000-4000-8000-000000000001";
const by = "owner@example.com";
const TODAY = "2026-11-20";
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(mandates).values({ id: M, slug: "s29d", name: "s29d", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("next actions and stalls", () => {
  it("lists missing and overdue next actions, waiting proposals, client gaps, renewals and quiet relationships", async () => {
    const [noNext] = await t.db.insert(deals).values({ mandateId: M, name: "TEST no next", path: "project_diagnostic", stage: "engaged" } as never).returning();
    const [late] = await t.db.insert(deals).values({ mandateId: M, name: "TEST late", path: "project_diagnostic", stage: "engaged", nextAction: "Call back", nextActionDate: "2026-11-01" } as never).returning();
    const [p] = await t.db.insert(offerProposals).values({ mandateId: M, dealId: late.id, title: "TEST waiting proposal", status: "sent", createdBy: by }).returning();
    await t.db.insert(offerProposalVersions).values({ mandateId: M, proposalId: p.id, version: 1, status: "sent", sentAt: "2026-11-05T10:00:00.000Z", validUntil: "2026-12-31", createdBy: by });
    const [e] = await t.db.insert(engagements).values({ mandateId: M, name: "TEST live", status: "active", currency: "USD", renewalDate: "2026-12-15" }).returning();
    await t.db.insert(clientRequests).values({ mandateId: M, engagementId: e.id, label: "Site lease", dueDate: "2026-11-10", createdBy: by });
    await t.db.insert(engagementDeliverables).values({ mandateId: M, engagementId: e.id, label: "Report", status: "in_client_review", updatedAt: "2026-11-01T00:00:00.000Z", createdBy: by });
    const [c] = await t.db.insert(contacts).values({ mandateId: M, fullName: "TEST Quiet", nameNormalized: "test quiet", source: "other" } as never).returning();
    await t.db.insert(relationshipStatus).values({ mandateId: M, entityType: "contact", entityId: c.id, stage: "engaged", nextAction: "Check in", stageChangedAt: "2026-07-01T00:00:00.000Z", createdBy: by });
    const items = await lifecycleAttention(t.db, [M], TODAY);
    const keys = items.map(i => i.key);
    expect(keys).toContain(`lc:deal-next:${noNext.id}`);
    expect(keys).toContain(`lc:deal-late:${late.id}`);
    expect(keys).toContain(`lc:prop-wait:${p.id}`);
    expect(items.find(i => i.issue.startsWith("Missing from the client"))).toBeTruthy();
    expect(items.find(i => i.issue.startsWith("Waiting for the client's review"))).toBeTruthy();
    expect(keys).toContain(`lc:renew:${e.id}`);
    expect(items.find(i => i.issue.startsWith("No meaningful contact"))).toBeTruthy();
    expect(items.every(i => i.href.startsWith("/"))).toBe(true);
  });
});

describe("meeting follow-up", () => {
  it("creates owned, dated tasks, a draft for approval, and a stage suggestion that is not applied", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "TEST Meet Co", nameNormalized: "test meet co", source: "other" } as never).returning();
    const [c] = await t.db.insert(contacts).values({ mandateId: M, orgId: org.id, fullName: "TEST Ana Meet", nameNormalized: "test ana meet", email: "ana@meet.example", emailLower: "ana@meet.example", source: "other" } as never).returning();
    const [d] = await t.db.insert(deals).values({ mandateId: M, orgId: org.id, contactId: c.id, name: "TEST meeting deal", path: "project_diagnostic", stage: "engaged" } as never).returning();
    await expect(reviewMeeting(t.db, M, { dealId: d.id, title: "Discovery", heldOn: "2026-11-18", participants: "Ana", notes: "Talked", decisions: [], actions: [{ title: "Send scope", owner: "", due: "2026-11-25" }] }, by)).rejects.toThrow(/owner/);
    const r = await reviewMeeting(t.db, M, {
      dealId: d.id, title: "Discovery", heldOn: "2026-11-18", participants: "Ana", notes: "Need a diagnostic for a 30 MW site.", decisions: ["Proceed to scope"],
      actions: [{ title: "Send scope summary", owner: by, due: "2026-11-25" }, { title: "Share site documents", owner: "ana@meet.example", due: "2026-11-27" }],
      followUp: { subject: "Thanks for today", body: "Ana, thank you for the conversation. I will send the scope summary by Tuesday.\n\nAlan" }, suggestedStage: "scope_agreed",
    }, by);
    const ts = await t.db.select().from(tasks).where(eq(tasks.workstream, `meeting:${r.noteId}`));
    expect(ts.map(x => x.title).sort()).toEqual(["Review suggested stage change: Discovery → Scope agreed", "Send scope summary", "Share site documents"]);
    const [m] = await t.db.select().from(messages).where(eq(messages.id, r.messageId!));
    expect(["pending_approval", "style_failed"]).toContain(m.status);
    expect(m.sentAt).toBeNull();
    const [after] = await t.db.select().from(deals).where(eq(deals.id, d.id));
    expect(after).toMatchObject({ stage: "engaged", nextAction: "Send scope summary", nextActionDate: "2026-11-25" });
  });
});

describe("completion and continuity", () => {
  it("needs acceptance, records open work with a reason, keeps the relationship, and asks only when chosen", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "TEST Done Co", nameNormalized: "test done co", source: "other" } as never).returning();
    const [e] = await t.db.insert(engagements).values({ mandateId: M, orgId: org.id, name: "TEST finishing", status: "active", currency: "USD", fee: 10_000 }).returning();
    await t.db.insert(engagementDeliverables).values([{ mandateId: M, engagementId: e.id, label: "Final report", status: "accepted", createdBy: by }, { mandateId: M, engagementId: e.id, label: "Optional annex", status: "in_progress", createdBy: by }]);
    await t.db.insert(clientRequests).values({ mandateId: M, engagementId: e.id, label: "Last photos", createdBy: by });
    await t.db.insert(invoices).values({ mandateId: M, engagementId: e.id, number: "TEST-D1", amount: 5_000, status: "sent", currency: "USD" });
    await expect(completeEngagement(t.db, e.id, { outcome: "Delivered", acceptanceEvidence: "" }, by)).rejects.toThrow(/acceptance/);
    await expect(completeEngagement(t.db, e.id, { outcome: "Delivered", acceptanceEvidence: "Email 2026-11-19" }, by)).rejects.toThrow(/Still open/);
    const r = await completeEngagement(t.db, e.id, { outcome: "Diagnostic delivered", acceptanceEvidence: "Email 2026-11-19", outstandingReason: "Client dropped the annex", continuation: "Monitoring retainer", lessons: "Ask for grid data at kick-off", reviewInDays: 30 }, by);
    expect(r.unpaid).toHaveLength(1);
    expect((await t.db.select().from(engagements).where(eq(engagements.id, e.id)))[0].status).toBe("complete");
    const [co] = await t.db.select().from(engagementCloseouts).where(eq(engagementCloseouts.engagementId, e.id));
    expect(co.outstanding.join(" ")).toMatch(/Optional annex[\s\S]*Last photos[\s\S]*TEST-D1/);
    expect((await t.db.select().from(clientRequests).where(eq(clientRequests.engagementId, e.id)))[0].status).toBe("cancelled");
    const titles = (await t.db.select().from(tasks).where(eq(tasks.workstream, `engagement:${e.id}`))).map(x => x.title);
    expect(titles).toEqual(expect.arrayContaining(["TEST finishing: relationship review", "TEST finishing: propose continuation", "TEST finishing: collect invoice TEST-D1"]));
    expect(titles.some(x => /case-study|referral/.test(x))).toBe(false);
    const [rel] = await t.db.select().from(relationshipStatus).where(and(eq(relationshipStatus.entityType, "organization"), eq(relationshipStatus.entityId, org.id)));
    expect(rel).toMatchObject({ stage: "active", nextActionDue: r.reviewDue });
    expect((await rolesFor(t.db, M, "organization", org.id)).find(x => x.role === "former_client" && !x.until)).toBeTruthy();
    await expect(completeEngagement(t.db, e.id, { outcome: "again", acceptanceEvidence: "x" }, by)).rejects.toThrow(/already complete/);
  });
});
