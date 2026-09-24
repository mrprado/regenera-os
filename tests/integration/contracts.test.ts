import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activities, contacts, contractMilestones, contracts, contractVersions, deals, mandates, organizations, partners } from "@/db/schema";
import { contractAlerts, createContract, markSent, markSigned, recordCounselReview, regenerateBody, scheduleRetainer, sendBlockers, updateContract } from "@/lib/contracts/engine";
import { openGaps, renderContract, TO_CONFIRM } from "@/lib/contracts/templates";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const INV = "mandate_inv";
const NOW = new Date("2026-09-24T12:00:00Z");
let orgId = "", dealId = "";

beforeEach(async () => {
  for (const x of [contractMilestones, contractVersions, contracts, activities, deals, partners, contacts, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: INV, slug: "fund", name: "Fund", type: "investment", rules: { massAllowed: false, approvalRequired: true } },
  ]);
  const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "Lima Water", nameNormalized: "lima water", location: "Lima, Peru", source: "other" }).returning();
  const [c] = await t.db.insert(contacts).values({ mandateId: M, orgId: org.id, fullName: "Ana Ruiz", nameNormalized: "ana ruiz", title: "CEO", email: "ana@limawater.example", source: "other" }).returning();
  const [d] = await t.db.insert(deals).values({ mandateId: M, orgId: org.id, contactId: c.id, name: "Lima Water: basin diagnostic", path: "project_diagnostic", stage: "engaged", engagement: "diagnostic", feeType: "one_time", feeTerms: { flatFee: "45,000" } }).returning();
  orgId = org.id; dealId = d.id;
});

/** Fills every gap and removes the template note, as a user would before sending. */
const finish = async (id: string) => {
  const [c] = await t.db.select().from(contracts).where(eq(contracts.id, id));
  const body = c.body.split("\n").filter(l => !l.startsWith("> Template")).join("\n").replaceAll(TO_CONFIRM, "Agreed");
  await updateContract(t.db, id, { body }, "alan", "Filled gaps");
};

describe("contracts", () => {
  it("drafts an engagement letter from the deal, with parties, scope, fees and visible gaps", async () => {
    const c = await createContract(t.db, { mandateId: M, kind: "engagement_letter", dealId, actor: "alan", now: NOW });
    expect(c).toMatchObject({ title: "Engagement letter: Lima Water: basin diagnostic", status: "draft", version: 1, counselRequired: false, value: 45000, orgId });
    expect(c.body).toContain("Lima Water, Lima, Peru");
    expect(c.body).toContain("A fixed fee of USD 45,000");
    expect(c.body).toContain("Diagnostic report with findings by territorial system");
    expect(c.body).toContain("is not a broker-dealer");
    expect(c.body).not.toMatch(/\{\{\w+\}\}/);
    expect(c.body).not.toContain("billed at cost.\n[TO CONFIRM]"); // no success-fee clause, no stray gap
    expect(openGaps(c.body)).toBe(3); // effective date, invoicing split, governing law
    expect(await t.db.select().from(contractVersions)).toHaveLength(1);
    expect((await t.db.select().from(activities).where(eq(activities.dealId, dealId)))[0].detail).toContain("Contract drafted");
  });

  it("requires counsel for success fees, equity, capital work and investment mandates", async () => {
    await t.db.update(deals).set({ feeType: "success_fee", feeTerms: { flatFee: "20,000", percentage: "2%" } }).where(eq(deals.id, dealId));
    const c = await createContract(t.db, { mandateId: M, kind: "engagement_letter", dealId, actor: "alan", now: NOW });
    expect(c.counselRequired).toBe(true);
    expect(c.body).toContain("[COUNSEL REVIEW REQUIRED]");
    const nda = await createContract(t.db, { mandateId: M, kind: "nda", dealId, actor: "alan", now: NOW });
    expect(nda.counselRequired).toBe(false);
    const [inv] = await t.db.insert(deals).values({ mandateId: INV, name: "Fund deal", path: "capital_mandate", engagement: "diagnostic" }).returning();
    expect((await createContract(t.db, { mandateId: INV, kind: "nda", dealId: inv.id, actor: "alan" })).counselRequired).toBe(true);
    // A deal from another mandate cannot be used.
    await expect(createContract(t.db, { mandateId: M, kind: "nda", dealId: inv.id, actor: "alan" })).rejects.toThrow("Deal not found");
  });

  it("blocks sending until gaps are filled, the template note is gone and counsel has reviewed", async () => {
    await t.db.update(deals).set({ engagement: "capital_advisory" }).where(eq(deals.id, dealId));
    const c = await createContract(t.db, { mandateId: M, kind: "engagement_letter", dealId, actor: "alan", now: NOW });
    const [fresh] = await t.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(sendBlockers(fresh)!.join(" ")).toMatch(/Counsel review.*gap.*template note/);
    await finish(c.id);
    await expect(markSent(t.db, c.id, "alan", NOW)).rejects.toThrow("Counsel review");
    await recordCounselReview(t.db, c.id, "alan", NOW);
    await markSent(t.db, c.id, "alan", NOW);
    const [sent] = await t.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(sent.status).toBe("sent");
    expect((await t.db.select().from(deals).where(eq(deals.id, dealId)))[0].stage).toBe("proposal");
    // Sent text is frozen: changes go through an amendment.
    await expect(updateContract(t.db, c.id, { body: "changed" }, "alan")).rejects.toThrow("amendment");
  });

  it("versions every text change and can rebuild the text from the terms", async () => {
    const c = await createContract(t.db, { mandateId: M, kind: "engagement_letter", dealId, actor: "alan", now: NOW });
    expect(await updateContract(t.db, c.id, { title: "Renamed" }, "alan")).toBe(1); // no text change, no version
    expect(await updateContract(t.db, c.id, { terms: { ...c.terms, governingLaw: "Peru" } }, "alan", "Law")).toBe(2);
    expect(await regenerateBody(t.db, c.id, "alan", NOW)).toBe(3);
    const [now] = await t.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(now.body).toContain("governed by the laws of Peru");
    expect((await t.db.select().from(contractVersions).where(eq(contractVersions.contractId, c.id))).map(v => v.version).sort()).toEqual([1, 2, 3]);
  });

  it("signing sets the term dates and moves the deal to Signed; retainers schedule monthly milestones", async () => {
    await t.db.update(deals).set({ feeType: "monthly_retainer", engagement: "development_office", feeTerms: { monthly: "8,000" }, monthlyValue: 8000 }).where(eq(deals.id, dealId));
    const c = await createContract(t.db, { mandateId: M, kind: "engagement_letter", dealId, actor: "alan", now: NOW });
    expect(c.terms).toMatchObject({ termMonths: 12, autoRenew: true });
    expect(c.value).toBe(96000);
    await finish(c.id);
    const r = await markSigned(t.db, c.id, { signedAt: "2026-09-30", effectiveDate: "2026-10-01", signedCopyUrl: "https://drive.example/signed.pdf" }, "alan", NOW);
    expect(r).toEqual({ effectiveDate: "2026-10-01", endDate: "2027-09-30" });
    expect((await t.db.select().from(deals).where(eq(deals.id, dealId)))[0].stage).toBe("signed");
    expect(await scheduleRetainer(t.db, c.id, 8000)).toBe(12);
    const ms = await t.db.select().from(contractMilestones).where(eq(contractMilestones.contractId, c.id));
    expect(ms.map(m => m.dueDate).sort().slice(0, 2)).toEqual(["2026-10-01", "2026-11-01"]);
    await expect(markSigned(t.db, c.id, { signedAt: "2026-10-02" }, "alan")).rejects.toThrow("already signed");
  });

  it("drafts referral agreements from a partner at the tier's fee, without touching deals", async () => {
    const [p] = await t.db.insert(partners).values({ mandateId: M, name: "Andes Advisory", tier: "strategic", email: "hi@andes.example" }).returning();
    const c = await createContract(t.db, { mandateId: M, kind: "referral_agreement", partnerId: p.id, actor: "alan", now: NOW });
    expect(c.body).toContain("15% (strategic tier)");
    expect(c.body).toContain("No fee is paid on any investment, loan or capital raised");
    expect(c.dealId).toBeNull();
    await expect(createContract(t.db, { mandateId: M, kind: "referral_agreement", dealId, actor: "alan" })).rejects.toThrow("Partner not found");
  });

  it("alerts on signatures waiting, renewal notice windows and payments due", async () => {
    const a = await createContract(t.db, { mandateId: M, kind: "nda", dealId, actor: "alan", now: NOW });
    await finish(a.id);
    await markSent(t.db, a.id, "alan", new Date("2026-09-10T12:00:00Z"));
    const b = await createContract(t.db, { mandateId: M, kind: "engagement_letter", dealId, actor: "alan", now: NOW });
    await updateContract(t.db, b.id, { terms: { ...b.terms, termMonths: 12, noticeDays: 30 } }, "alan");
    await finish(b.id);
    await markSigned(t.db, b.id, { signedAt: "2025-11-15", effectiveDate: "2025-11-15" }, "alan", NOW); // ends 2026-11-14, notice by 2026-10-15
    await t.db.insert(contractMilestones).values([
      { contractId: b.id, mandateId: M, title: "Final report", dueDate: "2026-09-20", amount: 5000 },
      { contractId: b.id, mandateId: M, title: "Later", dueDate: "2026-12-01", amount: 5000 },
    ]);
    const al = await contractAlerts(t.db, [M], NOW);
    expect(al.awaitingSignature.map(x => [x.id, x.days])).toEqual([[a.id, 14]]);
    expect(al.renewals).toEqual([expect.objectContaining({ id: b.id, endDate: "2026-11-14", noticeBy: "2026-10-15" })]);
    expect(al.milestonesDue.map(m => [m.title, m.overdue])).toEqual([["Final report", true]]);
    expect(await contractAlerts(t.db, [INV], NOW)).toEqual({ awaitingSignature: [], renewals: [], milestonesDue: [] });
  });

  it("templates render every placeholder for every kind", () => {
    const terms = { currency: "EUR", feeSummary: "x", paymentDays: 30, termMonths: null, noticeDays: 30, autoRenew: false, governingLaw: "Spain",
      counterparty: { name: "A", address: "B", signatoryName: "C", signatoryTitle: "D", signatoryEmail: "e@f.co" }, regenera: { signatoryName: "Alan Prado", signatoryTitle: "Founder" } };
    for (const kind of ["engagement_letter", "sow", "nda", "referral_agreement", "amendment"] as const) {
      const body = renderContract({ kind, engagement: "readiness_mandate", feeType: "milestone", project: "P", terms, effectiveDate: "2026-10-01", today: "2026-09-24" });
      expect(body, kind).not.toMatch(/\{\{\w+\}\}/);
      expect(body, kind).toContain("Template: review by counsel is required");
    }
  });
});
