// Phase 29C client workspace on synthetic records: a client sees only engagements granted to them in their own
// workspace, only client-facing fields, and can accept or request revisions, answer requests and decide changes only
// on their own engagement; another client, a revoked grant or a cross-workspace grant sees nothing. Scenario D (AI
// implementation) runs through acceptance and support with the client's actions recorded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { changeRequests, clientRequests, engagementDeliverables, engagements, invoices, mandates, portalAccessLog, portalGrants, portalUsers } from "@/db/schema";
import { decideChange, ensureTemplates, instantiateTemplate, moveDeliverable, proposeChange, templatesFor } from "@/lib/lifecycle/delivery";
import { grantAccess, revokeGrant } from "@/lib/portal/access";
import { clientDecideChange, clientDecideDeliverable, clientRespondRequest, clientView } from "@/lib/portal/client";
import { createTestDb } from "../helpers/d1";

const M = "d2920000-0000-4000-8000-000000000001", OTHER = "d2920000-0000-4000-8000-000000000002";
const by = "owner@example.com";
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [[M, "s29c"], [OTHER, "s29c-other"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
  await ensureTemplates(t.db, M);
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("client workspace", () => {
  it("isolates clients, hides internal fields, and records client decisions (Scenario D)", async () => {
    const [mine] = await t.db.insert(engagements).values({ mandateId: M, name: "TEST AI system for Coop", status: "active", currency: "USD", fee: 30_000, hourlyCost: 90, conflictNote: "INTERNAL conflict note", priceOverrideReason: "INTERNAL price reason", startDate: "2026-10-01" }).returning();
    const [theirs] = await t.db.insert(engagements).values({ mandateId: M, name: "TEST Other client work", status: "active", currency: "USD" }).returning();
    const [foreign] = await t.db.insert(engagements).values({ mandateId: OTHER, name: "TEST Foreign", status: "active", currency: "USD" }).returning();
    const tpl = (await templatesFor(t.db, M)).find(x => x.key === "ai_implementation")!;
    await instantiateTemplate(t.db, mine.id, tpl.id, "2026-10-01", by);
    await t.db.insert(invoices).values([{ mandateId: M, engagementId: mine.id, number: "TEST-1", amount: 15_000, status: "sent", currency: "USD" }, { mandateId: M, engagementId: mine.id, number: "TEST-DRAFT", amount: 1, status: "draft", currency: "USD" }, { mandateId: M, engagementId: theirs.id, number: "TEST-2", amount: 9, status: "sent", currency: "USD" }]);
    const [a] = await t.db.insert(portalUsers).values({ mandateId: M, email: "a@client.example", name: "TEST Client A", kind: "client", status: "active" }).returning();
    const [b] = await t.db.insert(portalUsers).values({ mandateId: M, email: "b@client.example", name: "TEST Client B", kind: "client", status: "active" }).returning();
    await grantAccess(t.db, { portalUserId: a.id, entityType: "engagement", entityId: mine.id }, by);
    await grantAccess(t.db, { portalUserId: b.id, entityType: "engagement", entityId: theirs.id }, by);
    await expect(grantAccess(t.db, { portalUserId: a.id, entityType: "engagement", entityId: foreign.id }, by)).rejects.toThrow(/workspace/);

    const va = await clientView(t.db, a);
    expect(va.engagements.map(e => e.name)).toEqual(["TEST AI system for Coop"]);
    const json = JSON.stringify(va);
    for (const secret of ["INTERNAL", "hourlyCost", "conflictNote", "TEST-2", "TEST-DRAFT", "Other client"]) expect(json).not.toContain(secret);
    expect(va.engagements[0].invoices.map(i => i.number)).toEqual(["TEST-1"]);
    expect(va.engagements[0].milestones).toHaveLength(4);

    // Client B cannot act on A's records.
    const [req] = await t.db.select().from(clientRequests).where(eq(clientRequests.engagementId, mine.id));
    await expect(clientRespondRequest(t.db, b, req.id, "sneaky")).rejects.toThrow(/Not authorized/);
    await clientRespondRequest(t.db, a, req.id, "Access granted to the data warehouse (link in email)");
    expect((await t.db.select().from(clientRequests).where(eq(clientRequests.id, req.id)))[0]).toMatchObject({ status: "submitted" });

    // Deliverable: only after Regenera sends it for review can the client accept or ask for a revision.
    const [d] = await t.db.select().from(engagementDeliverables).where(eq(engagementDeliverables.engagementId, mine.id));
    await expect(clientDecideDeliverable(t.db, a, d.id, "accept", "")).rejects.toThrow(/not waiting/);
    await moveDeliverable(t.db, d.id, "in_progress", { by });
    await moveDeliverable(t.db, d.id, "internal_done", { by, evidence: "Requirements v1" });
    await moveDeliverable(t.db, d.id, "in_client_review", { by });
    await expect(clientDecideDeliverable(t.db, b, d.id, "accept", "")).rejects.toThrow(/Not authorized/);
    await clientDecideDeliverable(t.db, a, d.id, "revise", "Add the second data source");
    await moveDeliverable(t.db, d.id, "in_progress", { by });
    await moveDeliverable(t.db, d.id, "internal_done", { by, evidence: "Requirements v2" });
    await moveDeliverable(t.db, d.id, "in_client_review", { by });
    await clientDecideDeliverable(t.db, a, d.id, "accept", "Signed off");
    expect((await t.db.select().from(engagementDeliverables).where(eq(engagementDeliverables.id, d.id)))[0]).toMatchObject({ status: "accepted", acceptedBy: "TEST Client A", version: 2 });

    // Change request decided by the client in the portal; the decision is the evidence.
    const ch = await proposeChange(t.db, mine.id, { title: "Add support retainer", description: "", scopeEffect: "Three months of support after acceptance", feeImpact: 4_500, timelineWeeks: 0, addDeliverables: ["Support report"] }, by);
    await expect(clientDecideChange(t.db, b, ch.id, "approved")).rejects.toThrow(/Not authorized/);
    await clientDecideChange(t.db, a, ch.id, "approved");
    expect((await t.db.select().from(changeRequests).where(eq(changeRequests.id, ch.id)))[0].decisionEvidence).toMatch(/client portal by TEST Client A/);
    await expect(decideChange(t.db, ch.id, "rejected", "x", by)).rejects.toThrow(/proposed/);

    // Revoking the grant removes access; denied attempts are logged.
    const [g] = await t.db.select().from(portalGrants).where(eq(portalGrants.portalUserId, a.id));
    await revokeGrant(t.db, g.id, by);
    expect((await clientView(t.db, a)).engagements).toHaveLength(0);
    await expect(clientRespondRequest(t.db, a, req.id, "after revoke")).rejects.toThrow(/Not authorized/);
    expect((await t.db.select().from(portalAccessLog).where(eq(portalAccessLog.portalUserId, b.id))).some(l => !l.allowed)).toBe(true);
  });
});
