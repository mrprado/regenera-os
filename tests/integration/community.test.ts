// Community rights and knowledge governance: existence-only records, authority-gated permissions (the sharer is not
// the authority), restrictive AI defaults, withdrawal and expiry propagation, consent vs consultation, community
// economics through the project model, separate ledgers, misclassified compensation, gates and capital fit.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  communities, communityAuthorities, communityLedger, consentRecords, knowledgePermissions, knowledgeRecords, knowledgeUses, mandates, participationStructures, projects, tasks,
} from "@/db/schema";
import {
  checkPermission, communityEconomics, communityFit, consentLabel, createKnowledgeRecord, expirePermissions, ledgerTotals, misclassified, publicView, recordUse, setConsentStatus,
  setPermission, withCommunityTerms, withdraw,
} from "@/lib/community/engine";
import type { ModelDefinition, Provenance } from "@/lib/finance/types";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
let projectId = "", communityId = "", authorityId = "";
beforeEach(async () => {
  for (const x of [knowledgeUses, knowledgePermissions, knowledgeRecords, consentRecords, communityAuthorities, communityLedger, participationStructures, communities, tasks, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  projectId = (await createProject(t.db, { mandateId: M, name: "Valle" }, "alan")).id;
  [{ id: communityId }] = await t.db.insert(communities).values({ mandateId: M, projectId, name: "DEMO Ejido", communityType: "ejido", createdBy: "alan", isDemo: true }).returning();
  [{ id: authorityId }] = await t.db.insert(communityAuthorities).values({ mandateId: M, communityId, name: "Asamblea ejidal", authorityType: "assembly", powers: ["consent", "publication", "ai", "digitization"], verificationStatus: "verified", createdBy: "alan" }).returning();
});

const rec = (over: Partial<typeof knowledgeRecords.$inferInsert> = {}) => createKnowledgeRecord(t.db, { mandateId: M, projectId, communityId, title: "Spring management", category: "hydrological", descriptionPublic: "Seasonal spring use", accessStatus: "restricted", ...over }, "alan");

describe("knowledge governance", () => {
  it("existence-only records keep no content and can never be opened", async () => {
    const r = await rec({ accessStatus: "sacred", descriptionPublic: "should not be stored", protectedContentRef: "drive://x", generalizedArea: "north ridge" });
    expect(r).toMatchObject({ descriptionPublic: "", protectedContentRef: null, generalizedArea: "", governanceStatus: "sacred_do_not_digitize" });
    expect(publicView(r)).toMatchObject({ title: "Culturally governed knowledge exists", location: null });
    await expect(setPermission(t.db, { recordId: r.id, activity: "internal_research", status: "allowed", authorityId, evidence: "minutes" }, "alan")).rejects.toThrow(/Existence-only/);
    expect((await checkPermission(t.db, r.id, "internal_research")).allowed).toBe(false);
  });

  it("AI use is prohibited by default and needs an authority holding the AI power", async () => {
    const r = await rec();
    expect((await checkPermission(t.db, r.id, "ai_summarization")).reason).toMatch(/prohibited/);
    const [weak] = await t.db.insert(communityAuthorities).values({ mandateId: M, communityId, name: "Elder", authorityType: "elder", powers: ["publication"], verificationStatus: "verified", createdBy: "alan" }).returning();
    await expect(setPermission(t.db, { recordId: r.id, activity: "ai_summarization", status: "allowed", authorityId: weak.id, evidence: "x" }, "alan")).rejects.toThrow(/AI use/);
    await expect(setPermission(t.db, { recordId: r.id, activity: "ai_summarization", status: "allowed", authorityId: null, evidence: "x" }, "alan")).rejects.toThrow(/not an authority/);
    await expect(setPermission(t.db, { recordId: r.id, activity: "ai_summarization", status: "allowed", authorityId, evidence: "" }, "alan")).rejects.toThrow(/evidence/);
    await setPermission(t.db, { recordId: r.id, activity: "ai_summarization", status: "allowed", authorityId, evidence: "Assembly minutes 2026-08-02" }, "alan");
    expect((await checkPermission(t.db, r.id, "ai_summarization")).allowed).toBe(true);
    expect((await checkPermission(t.db, r.id, "ai_training")).allowed).toBe(false);
  });

  it("withdrawal restricts the record, flags derivative outputs and creates remediation tasks", async () => {
    const r = await rec();
    await setPermission(t.db, { recordId: r.id, activity: "internal_research", status: "allowed", authorityId, evidence: "minutes" }, "alan");
    await recordUse(t.db, r.id, "internal_research", { type: "site_report", ref: "Site report v2" }, "alan");
    await expect(recordUse(t.db, r.id, "public_publication", { type: "field_note", ref: "x" }, "alan")).rejects.toThrow(/Not permitted/);
    const w = await withdraw(t.db, r.id, "alan", "Assembly instruction 2026-09-20");
    expect(w.flagged).toBe(1);
    expect((await t.db.select().from(knowledgeUses))[0].status).toBe("flagged");
    expect((await t.db.select().from(tasks)).length).toBe(1);
    expect((await checkPermission(t.db, r.id, "internal_research")).allowed).toBe(false);
    await expect(setPermission(t.db, { recordId: r.id, activity: "internal_research", status: "allowed", authorityId, evidence: "m" }, "alan")).rejects.toThrow(/withdrawn/);
  });

  it("expired permissions stop working and propagate", async () => {
    const r = await rec();
    await setPermission(t.db, { recordId: r.id, activity: "internal_research", status: "allowed", authorityId, evidence: "m", expiryDate: "2026-01-01" }, "alan");
    expect((await checkPermission(t.db, r.id, "internal_research", new Date("2026-06-01"))).reason).toMatch(/expired/);
    const e = await expirePermissions(t.db, new Date("2026-06-01"));
    expect(e.expired).toBe(1);
  });
});

describe("consent", () => {
  it("consultation is not consent; a grant needs a verified authority with the power, evidence and a date", async () => {
    expect(consentLabel("consultation_underway")).toMatch(/not consent/);
    const [c] = await t.db.insert(consentRecords).values({ mandateId: M, projectId, communityId, consentType: "fpic", createdBy: "alan" }).returning();
    await expect(setConsentStatus(t.db, c.id, "granted", "alan", { evidence: "x", date: "2026-09-01" })).rejects.toThrow(/verified authority/);
    await t.db.update(consentRecords).set({ authorityId }).where(eq(consentRecords.id, c.id));
    await expect(setConsentStatus(t.db, c.id, "granted", "alan", { date: "2026-09-01" })).rejects.toThrow(/evidence/);
    const r = await setConsentStatus(t.db, c.id, "granted", "alan", { evidence: "Signed assembly act", date: "2026-09-01" });
    expect(r.warnings[0]).toMatch(/Not disclosed/);
    await expect(setConsentStatus(t.db, c.id, "withdrawn", "alan")).rejects.toThrow(/communicated/);
  });
});

describe("community economics and ledgers", () => {
  const P: Provenance = { source: "test", date: null, owner: null, confidence: "moderate", status: "supported" };
  const def: ModelDefinition = {
    currency: "USD", basis: "nominal", constructionMonths: 12, operatingYears: 10, codDelayMonths: 0,
    capex: [{ id: "c", category: "equipment", label: "Plant", quantity: 1, unit: "lot", unitCost: 1000, contingencyPct: 0, ...P }],
    development: [], opex: [], generation: null, debt: null, grants: [],
    revenue: [{ id: "r", label: "Offtake", type: "offtake", certainty: "contracted", basis: "fixed", annualVolume: 1, unit: "u", price: 200, escalationPct: 0, startYear: 1, termYears: 0, tailPrice: 0, shareOfGeneration: 0, ...P }],
    tax: { ratePct: 0, depreciationYears: 10, lossCarryforward: true, interestDeductible: true, ...P }, discountRatePct: 8, equityHurdlePct: 10, residualValue: 0, decommissioning: 0, includeSpeculative: false, stageDiscountRates: [],
  };
  const s = (type: string, terms: Record<string, unknown>) => ({ id: crypto.randomUUID(), type, terms, name: type, inflationIndexed: false, scenario: "A" }) as never;

  it("revenue share runs through the model; carried equity dilutes investors without a community contribution", () => {
    const base = communityEconomics(def, [], { inflationPct: 0, discountPct: 8 });
    const share = communityEconomics(def, [s("gross_revenue_share", { revenueSharePct: 2 })], { inflationPct: 0, discountPct: 8 });
    expect(share.communityNominal).toBeCloseTo(10 * 4, 6);        // 2% of 200 for 10 years
    expect(share.projectIrr!).toBeLessThan(base.projectIrr!);
    const carried = communityEconomics(def, [s("carried_equity", { equityPct: 5 })], { inflationPct: 0, discountPct: 8 });
    expect(carried.rows.every(r => r.stakeFlow === 0)).toBe(true);
    expect(carried.communityNominal).toBeCloseTo(0.05 * 2000, 6);
    expect(carried.investorMoic!).toBeCloseTo(0.95 * 2, 6);
    const direct = communityEconomics(def, [s("direct_equity", { equityPct: 10, stakeFunding: "direct" })], { inflationPct: 0, discountPct: 8 });
    expect(direct.communityIrr!).toBeCloseTo(base.investorIrr!, 4);
    const w = withCommunityTerms(def, [s("land_lease", { leasePerYear: 10, leaseEscalationPct: 2 })]);
    expect(w.opex[0]).toMatchObject({ kind: "fixed", amount: 10, escalationPct: 2 });
  });

  it("keeps ledgers separate and flags compensation recorded as participation", () => {
    const e = (ledger: string, category: string, amount: number, status = "paid") => ({ ledger, category, description: "", amount, status }) as never;
    const entries = [e("mitigation", "Land access compensation", 100), e("participation", "Revenue share Q1", 50), e("participation", "Crop damage compensation", 20), e("development", "School", 30, "scheduled")];
    const tot = ledgerTotals(entries);
    expect(tot.mitigation.paid).toBe(100); expect(tot.participation.paid).toBe(70); expect(tot.development.scheduled).toBe(30);
    expect(misclassified(entries)).toHaveLength(1);
  });

  it("explains capital fit per dimension instead of scoring", () => {
    const f = communityFit({ flags: ["blended"], preference: "preferred", supported: ["revenue_share"] }, [{ type: "carried_equity" }, { type: "gross_revenue_share" }] as never);
    expect(f.find(x => x.dimension === "Community equity")?.result).toBe("conditional");
    expect(f.find(x => x.dimension === "Revenue share / royalty")?.result).toBe("fit");
    expect(communityFit({ flags: [], preference: "required", supported: [] }, [])[0].result).toBe("no_fit");
  });
});
