// Commercial operations: catalogue seeding, pricing lines and margin floor, engagement creation from services,
// conflict gates, invoices (numbering, derived status, payments), economics and Command items.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { engagements, expenses, invoices, mandates, organizations, projectParties, projects, services, timeEntries } from "@/db/schema";
import { commercialAttention, commercialOverview, createEngagement, derivedInvoiceStatus, engagementConflicts, engagementEconomics, ensureServices, invoiceFromSchedule, priceService, proposalMarkdown, recordPayment, setEngagementStatus } from "@/lib/commercial/engine";
import { suggestWorkstreams } from "@/lib/commercial/catalog";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [timeEntries, expenses, invoices, engagements, services, projectParties, projects, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

describe("catalogue and pricing", () => {
  it("seeds once, with depths and internal price bands", async () => {
    const n = await ensureServices(t.db, M);
    expect(n).toBeGreaterThan(15);
    expect(await ensureServices(t.db, M)).toBe(0);
    const site = await t.db.select().from(services).where(eq(services.key, "site_intel_assess"));
    expect(site[0]).toMatchObject({ depth: "assess", bandLow: 10_000, bandHigh: 30_000, minPrice: 10_000, listPrice: 20_000 });
    expect(suggestWorkstreams("screening", "screen")).toContain("site_intel_assess");
  });

  it("pricing shows its lines, raises to the margin floor and flags low margin", () => {
    const s = { listPrice: 20_000, minPrice: 10_000, bandLow: 10_000, bandHigh: 30_000, expectedHours: 70, expectedExternalCost: 2_000, targetMarginPct: 55, perMonth: false };
    const a = priceService(s, { complexity: "standard", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: 100 });
    expect(a.expectedCost).toBe(9_000);
    expect(a.suggested).toBe(20_000);
    expect(a.expectedMarginPct).toBeCloseTo(55, 0);
    const b = priceService(s, { complexity: "standard", urgency: false, travelCost: 3_000, specialistCost: 5_000, hourlyCost: 150 });
    expect(b.lines.some(([k]) => /target margin/.test(k))).toBe(true);
    expect(b.suggested).toBeGreaterThan(20_000);
    expect(priceService({ ...s, targetMarginPct: 90 }, { complexity: "low", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: null }).lines.some(([, v]) => /no cost rate/.test(v))).toBe(true);
  });
});

describe("engagements", () => {
  it("from services: deliverables, schedule, approvals, conflict gate, invoices, payments, economics and Command", async () => {
    await ensureServices(t.db, M);
    const svc = await t.db.select().from(services);
    const pick = (k: string) => svc.find(s => s.key === k)!.id;
    const [client] = await t.db.insert(organizations).values({ mandateId: M, name: "Costa Verde", nameNormalized: "costa verde", source: "other" }).returning();
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar" }, "alan");
    const e = await createEngagement(t.db, { mandateId: M, name: "Valle pre-feasibility", orgId: client.id, projectId: p.id, serviceIds: [pick("site_intel_assess"), pick("development_management")], months: 3 }, "alan");
    expect(e.fee).toBe(20_000); expect(e.monthlyFee).toBe(16_500); expect(e.billingType).toBe("hybrid");
    expect(e.paymentSchedule.map(l => l.amount)).toEqual([10_000, 10_000, 16_500, 16_500, 16_500]);
    expect(e.deliverables.length).toBeGreaterThan(4);

    await expect(setEngagementStatus(t.db, e.id, "active", "alan")).rejects.toThrow(/conflict check/);
    const c = await engagementConflicts(t.db, e);
    expect(c.status).toBe("clear");
    await t.db.update(engagements).set({ conflictStatus: c.status }).where(eq(engagements.id, e.id));
    await setEngagementStatus(t.db, e.id, "active", "alan");

    const inv = await invoiceFromSchedule(t.db, e.id, e.paymentSchedule[0].id, "2026-09-01", 30, "alan");
    expect(inv.number).toBe("REG-2026-0001"); expect(inv.dueDate).toBe("2026-10-01");
    await expect(invoiceFromSchedule(t.db, e.id, e.paymentSchedule[0].id, "2026-09-01", 30, "alan")).rejects.toThrow(/Already/);
    await expect(recordPayment(t.db, inv.id, 1000, "2026-09-10", "alan")).rejects.toThrow(/Send/);
    await t.db.update(invoices).set({ status: "sent" }).where(eq(invoices.id, inv.id));
    expect(derivedInvoiceStatus({ status: "sent", dueDate: "2026-10-01", amount: 10_000, paidAmount: 0 }, "2026-09-27")).toBe("due");
    expect(derivedInvoiceStatus({ status: "sent", dueDate: "2026-10-01", amount: 10_000, paidAmount: 0 }, "2026-11-05")).toBe("overdue");
    await recordPayment(t.db, inv.id, 4_000, "2026-09-20", "alan");
    await expect(recordPayment(t.db, inv.id, 7_000, "2026-09-21", "alan")).rejects.toThrow(/exceeds/);

    await t.db.update(engagements).set({ hourlyCost: 100 }).where(eq(engagements.id, e.id));
    await t.db.insert(timeEntries).values({ mandateId: M, engagementId: e.id, person: "alan", hours: 40, date: "2026-09-15" });
    await t.db.insert(expenses).values([{ mandateId: M, engagementId: e.id, category: "flights", classification: "reimbursable", amount: 800, date: "2026-09-12", createdBy: "alan" }, { mandateId: M, engagementId: e.id, category: "data", classification: "pass_through", amount: 500, date: "2026-09-12", createdBy: "alan" }]);
    const [fresh] = await t.db.select().from(engagements).where(eq(engagements.id, e.id));
    const econ = engagementEconomics(fresh, await t.db.select().from(invoices), await t.db.select().from(expenses), await t.db.select().from(timeEntries));
    expect(econ).toMatchObject({ contractValue: 69_500, invoiced: 10_000, collected: 4_000, outstanding: 6_000, internalCost: 4_000, externalCost: 800 });
    expect(econ.grossMargin).toBe(69_500 + 800 - 4_800);

    const overview = await commercialOverview(t.db, [M], "2026-11-05");
    expect(overview!.mrr).toBe(16_500); expect(overview!.receivables).toBe(6_000);
    const items = await commercialAttention(t.db, [M], "2026-11-05");
    expect(items.find(i => i.key === `inv:${inv.id}`)?.severity).toBe("critical"); // 35 days overdue
    expect(proposalMarkdown(fresh, "Costa Verde", "Valle Solar", svc.filter(s => fresh.workstreams.includes(s.key)))).toMatch(/Fixed fee: USD 20,000[\s\S]*Monthly fee: USD 16,500 for 3 months/);
  });

  it("flags a client that is a counterparty on a project where Regenera acts for someone else", async () => {
    const [a] = await t.db.insert(organizations).values({ mandateId: M, name: "Sponsor A", nameNormalized: "sponsor a", source: "other" }).returning();
    const [b] = await t.db.insert(organizations).values({ mandateId: M, name: "Lender B", nameNormalized: "lender b", source: "other" }).returning();
    const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
    const ea = await createEngagement(t.db, { mandateId: M, name: "Sponsor mandate", orgId: a.id, projectId: p.id, serviceIds: [] }, "alan");
    await t.db.update(engagements).set({ status: "active", conflictStatus: "clear" }).where(eq(engagements.id, ea.id));
    await t.db.insert(projectParties).values({ projectId: p.id, mandateId: M, orgId: b.id, role: "lender" });
    const eb = await createEngagement(t.db, { mandateId: M, name: "Lender advisory", orgId: b.id, serviceIds: [] }, "alan");
    const c = await engagementConflicts(t.db, eb);
    expect(c.status).toBe("conflict");
    await t.db.update(engagements).set({ conflictStatus: "conflict" }).where(eq(engagements.id, eb.id));
    await expect(setEngagementStatus(t.db, eb.id, "contracting", "alan")).rejects.toThrow(/Conflict flagged/);
  });
});
