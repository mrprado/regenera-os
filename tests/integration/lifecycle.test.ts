// Phase 29A, Scenario B (solar developer diagnostic) on synthetic records: qualification gates, versioned proposals that
// freeze when sent, acceptance with evidence, agreement → contract + engagement + delivery plan + Signed, client role
// derived (never set by hand), payments with evidence that are not duplicated, internal completion vs client acceptance,
// change requests that leave the accepted scope intact, and owner economics per currency with no probability weighting.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  clientRequests, contracts, deals, engagementDeliverables, engagementMilestones, engagements, invoices, mandates, offerProposalVersions, opportunityQualifications, organizations, payments, relationshipRoles, services,
} from "@/db/schema";
import { ensureServices, invoiceFromSchedule } from "@/lib/commercial/engine";
import { decideChange, deliveryPlan, ensureTemplates, moveDeliverable, newTemplateVersion, proposeChange, templatesFor } from "@/lib/lifecycle/delivery";
import { ownerEconomics } from "@/lib/lifecycle/economics";
import { recordInvoicePayment } from "@/lib/lifecycle/payments";
import { commercialStageOf, moveCommercialStage, stageHistory } from "@/lib/lifecycle/pipeline";
import { createProposal, decideVersion, recordAgreement, saveVersion, sendVersion, versions } from "@/lib/lifecycle/proposals";
import { addRole, deriveClientRoles, rolesFor } from "@/lib/lifecycle/relationships";
import { createTestDb } from "../helpers/d1";

const M = "d2900000-0000-4000-8000-000000000001";
const by = "owner@example.com";
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(mandates).values({ id: M, slug: "s29", name: "s29", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
  await ensureServices(t.db, M);
  await ensureTemplates(t.db, M);
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("Scenario B: solar developer diagnostic", () => {
  it("runs from opportunity to accepted, paid delivery with every gate enforced", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "TEST Sunfield Developments", nameNormalized: "test sunfield developments", domain: "sunfield.example", source: "referral" } as never).returning();
    const [deal] = await t.db.insert(deals).values({ mandateId: M, orgId: org.id, name: "TEST Sunfield diagnostic", path: "project_diagnostic", stage: "lead" } as never).returning();
    expect(commercialStageOf(deal)).toBe("need_identified");

    // Pipeline gates: qualification before scope, a sent proposal before Proposal, reasons for closing, no manual Signed.
    await moveCommercialStage(t.db, deal.id, "discovery", { evidence: "Call 2026-10-01" }, by);
    await expect(moveCommercialStage(t.db, deal.id, "scope_agreed", {}, by)).rejects.toThrow(/not qualified/);
    await expect(moveCommercialStage(t.db, deal.id, "lost", {}, by)).rejects.toThrow(/needs a reason/);
    await expect(moveCommercialStage(t.db, deal.id, "signed", { override: true, reason: "skip please" }, by)).rejects.toThrow(/Record agreement|accepted proposal/);
    await t.db.insert(opportunityQualifications).values({ mandateId: M, dealId: deal.id, decision: "qualified", decidedBy: by, decidedAt: new Date().toISOString(), reason: "Need, buyer, budget path and timing recorded" });
    await moveCommercialStage(t.db, deal.id, "scope_agreed", {}, by);

    // Proposal: a draft service blocks sending; sent versions are frozen; edits create new versions.
    const [svc] = await t.db.select().from(services).where(and(eq(services.mandateId, M), eq(services.key, "project_diagnostic")));
    expect(svc.offerStatus).toBe("draft");
    const tpl = (await templatesFor(t.db, M)).find(x => x.key === "solar_diagnostic")!;
    const p = await createProposal(t.db, { dealId: deal.id, title: "TEST Sunfield diagnostic", serviceIds: [svc.id], scope: "Diagnostic of the 40 MW Sunfield site.", deliverables: [{ label: "Diagnostic report" }], feeStructure: "fixed", currency: "USD", fee: 12_000, paymentSchedule: [{ label: "Deposit", amount: 6_000, trigger: "on signature" }, { label: "Balance", amount: 6_000, trigger: "on acceptance" }], templateId: tpl.id }, by);
    await expect(sendVersion(t.db, p.id, by)).rejects.toThrow(/draft service[\s\S]*|valid/);
    await t.db.update(services).set({ offerStatus: "approved", approvedBy: by }).where(eq(services.id, svc.id));
    await expect(sendVersion(t.db, p.id, by)).rejects.toThrow(/valid/);
    await saveVersion(t.db, p.id, { validUntil: "2099-12-31" }, by);
    await expect(moveCommercialStage(t.db, deal.id, "proposal", {}, by)).rejects.toThrow(/No proposal version has been sent/);
    await sendVersion(t.db, p.id, by);
    await moveCommercialStage(t.db, deal.id, "proposal", {}, by);
    const v2 = await saveVersion(t.db, p.id, { fee: 14_000, paymentSchedule: [{ label: "Deposit", amount: 7_000, trigger: "on signature" }, { label: "Balance", amount: 7_000, trigger: "on acceptance" }] }, by);
    expect(v2.version).toBe(2);
    const [v1] = (await versions(t.db, p.id)).filter(v => v.version === 1);
    expect(v1).toMatchObject({ status: "sent", fee: 12_000 });
    await sendVersion(t.db, p.id, by);
    expect((await versions(t.db, p.id)).find(v => v.version === 1)!.status).toBe("superseded");

    // Acceptance needs who and evidence; later edits never touch the accepted version.
    const sent = (await versions(t.db, p.id)).find(v => v.version === 2)!;
    await expect(decideVersion(t.db, sent.id, "accepted", { decidedBy: "", evidence: "" }, by)).rejects.toThrow(/who decided/);
    await decideVersion(t.db, sent.id, "accepted", { decidedBy: "TEST Client CEO", evidence: "Signed acceptance email 2026-10-05" }, by);
    const v3 = await saveVersion(t.db, p.id, { fee: 99_000 }, by);
    expect(v3.version).toBe(3);
    expect((await t.db.select().from(offerProposalVersions).where(eq(offerProposalVersions.id, sent.id)))[0]).toMatchObject({ status: "accepted", fee: 14_000 });

    // A meeting or proposal never makes a client; only the agreed engagement does.
    expect((await rolesFor(t.db, M, "organization", org.id)).some(r => r.role === "client")).toBe(false);
    await expect(addRole(t.db, { mandateId: M, entityType: "organization", entityId: org.id, role: "client" }, by)).rejects.toThrow(/agreed engagements/);

    // Agreement: contract, engagement from the accepted version, delivery plan, Signed; repeating it changes nothing.
    await expect(recordAgreement(t.db, p.id, { executionDate: "2026-10-06", evidence: " " }, by)).rejects.toThrow(/evidence/);
    const a = await recordAgreement(t.db, p.id, { executionDate: "2026-10-06", evidence: "Countersigned PDF in Drive", startDate: "2026-10-07" }, by);
    const again = await recordAgreement(t.db, p.id, { executionDate: "2026-10-06", evidence: "again", startDate: "2026-10-07" }, by);
    expect(again.engagementId).toBe(a.engagementId);
    expect(await t.db.select().from(engagements).where(eq(engagements.proposalId, p.id))).toHaveLength(1);
    const [e] = await t.db.select().from(engagements).where(eq(engagements.id, a.engagementId));
    expect(e).toMatchObject({ fee: 14_000, currency: "USD", acceptedVersionId: sent.id, status: "contracting", templateVersion: 1 });
    const [c] = await t.db.select().from(contracts).where(eq(contracts.id, a.contractId));
    expect(c).toMatchObject({ lifecycle: "effective", value: 14_000 });
    const plan = await deliveryPlan(t.db, e.id);
    expect(plan.milestones).toHaveLength(3);
    expect(plan.deliverables).toHaveLength(3);
    expect(plan.requests.length).toBe(4);
    const [d2] = await t.db.select().from(deals).where(eq(deals.id, deal.id));
    expect(d2).toMatchObject({ commercialStage: "signed", stage: "signed" });
    expect((await stageHistory(t.db, "deal", deal.id)).map(h => h.toStage)).toEqual(["discovery", "scope_agreed", "proposal", "signed"]);
    expect((await rolesFor(t.db, M, "organization", org.id)).find(r => r.role === "client")).toMatchObject({ basis: "derived", until: null });

    // Template edits are new versions; the live engagement keeps its own copy.
    const tv2 = await newTemplateVersion(t.db, tpl.id, { milestones: [{ key: "only", label: "Changed", offsetWeeks: 0 }] }, by);
    expect(tv2.version).toBe(2);
    expect((await t.db.select().from(engagementMilestones).where(eq(engagementMilestones.engagementId, e.id)))).toHaveLength(3);

    // Payments: evidence required, a repeated provider event is recorded once, status derived.
    const inv = await invoiceFromSchedule(t.db, e.id, e.paymentSchedule[0].id, "2026-10-07", 30, by);
    await expect(recordInvoicePayment(t.db, { invoiceId: inv.id, amount: 7_000, receivedOn: "2026-10-10", evidence: "x" }, by)).rejects.toThrow(/Issue the invoice/);
    await t.db.update(invoices).set({ status: "sent" }).where(eq(invoices.id, inv.id));
    const first = await recordInvoicePayment(t.db, { invoiceId: inv.id, amount: 7_000, receivedOn: "2026-10-10", evidence: "TEST provider event", provider: "test_provider", providerPaymentId: "evt_1" }, by);
    const dup = await recordInvoicePayment(t.db, { invoiceId: inv.id, amount: 7_000, receivedOn: "2026-10-10", evidence: "TEST provider event", provider: "test_provider", providerPaymentId: "evt_1" }, by);
    expect(first.duplicate).toBe(false); expect(dup.duplicate).toBe(true);
    expect(await t.db.select().from(payments).where(eq(payments.invoiceId, inv.id))).toHaveLength(1);
    expect((await t.db.select().from(invoices).where(eq(invoices.id, inv.id)))[0]).toMatchObject({ status: "paid", paidAmount: 7_000 });
    await recordInvoicePayment(t.db, { invoiceId: inv.id, amount: 1_000, kind: "refund", receivedOn: "2026-10-11", evidence: "TEST refund ref" }, by);
    expect((await t.db.select().from(invoices).where(eq(invoices.id, inv.id)))[0]).toMatchObject({ status: "partially_paid", paidAmount: 6_000 });

    // Delivery: evidence for internal completion, client review before acceptance, blocked needs a reason and a party.
    const report = plan.deliverables.find(d => d.label.startsWith("Diagnostic report"))!;
    await moveDeliverable(t.db, report.id, "in_progress", { by });
    await expect(moveDeliverable(t.db, report.id, "blocked", { by, blockedReason: "Waiting" })).rejects.toThrow(/party/);
    await expect(moveDeliverable(t.db, report.id, "internal_done", { by })).rejects.toThrow(/evidence/);
    await moveDeliverable(t.db, report.id, "internal_done", { by, evidence: "Report v1 in Drive" });
    await expect(moveDeliverable(t.db, report.id, "accepted", { by, clientName: "TEST Client CEO", note: "ok" })).rejects.toThrow(/client for review/);
    await moveDeliverable(t.db, report.id, "in_client_review", { by });
    await moveDeliverable(t.db, report.id, "revision_requested", { by, note: "Add grid section" });
    await moveDeliverable(t.db, report.id, "in_progress", { by });
    await moveDeliverable(t.db, report.id, "internal_done", { by, evidence: "Report v2" });
    await moveDeliverable(t.db, report.id, "in_client_review", { by });
    await moveDeliverable(t.db, report.id, "accepted", { by, clientName: "TEST Client CEO", note: "Acceptance email 2026-11-02" });
    expect((await t.db.select().from(engagementDeliverables).where(eq(engagementDeliverables.id, report.id)))[0]).toMatchObject({ status: "accepted", version: 2, acceptedBy: "TEST Client CEO" });
    expect((await t.db.select().from(clientRequests).where(eq(clientRequests.engagementId, e.id))).every(r => r.status === "open")).toBe(true);

    // Change request: approved change adds work and fee; the accepted proposal version is unchanged.
    const ch = await proposeChange(t.db, e.id, { title: "Add BESS sizing", description: "", scopeEffect: "Adds a storage sizing note", feeImpact: 3_000, timelineWeeks: 1, addDeliverables: ["BESS sizing note"] }, by);
    await expect(decideChange(t.db, ch.id, "approved", "", by)).rejects.toThrow(/approval/);
    await decideChange(t.db, ch.id, "approved", "Client email 2026-11-03", by);
    expect((await t.db.select().from(engagements).where(eq(engagements.id, e.id)))[0].fee).toBe(17_000);
    expect((await t.db.select().from(offerProposalVersions).where(eq(offerProposalVersions.id, sent.id)))[0].fee).toBe(14_000);

    // Completion turns client into former client; the relationship stays.
    await t.db.update(engagements).set({ status: "complete" }).where(eq(engagements.id, e.id));
    await deriveClientRoles(t.db, M, org.id, by);
    const roles = await rolesFor(t.db, M, "organization", org.id);
    expect(roles.find(r => r.role === "client")?.until).toBeTruthy();
    expect(roles.find(r => r.role === "former_client")).toMatchObject({ basis: "derived", until: null });

    // Owner economics: per currency, nothing weighted, nothing converted.
    await t.db.insert(engagements).values({ mandateId: M, name: "TEST EUR retainer", status: "active", currency: "EUR", monthlyFee: 2_000, months: 6 });
    const econ = await ownerEconomics(t.db, [M], "2026-11-05");
    expect(econ.lines.map(l => l.currency)).toEqual(["EUR", "USD"]);
    expect(econ.lines.find(l => l.currency === "USD")).toMatchObject({ contracted: 17_000, invoiced: 7_000, collected: 6_000, outstanding: 1_000 });
    expect(econ.lines.find(l => l.currency === "EUR")).toMatchObject({ contracted: 12_000, recurringMonthly: 2_000, invoiced: 0 });
    expect(await t.db.select().from(relationshipRoles).where(eq(relationshipRoles.entityId, org.id))).toHaveLength(2);
  });
});
