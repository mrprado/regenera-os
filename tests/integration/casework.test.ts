import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  capitalProfiles, claimEvidence, claims, docExtractions, docRequestItems, docRequests, entityAliases, integrations, mandates, notifications, organizations, projectParties,
  projects, protectedParties, providerCalls, registrySnapshots, regulatedProducts, sourceCache,
} from "@/db/schema";
import { importProgrammes } from "@/lib/capital/providers";
import { PROGRAMMES } from "@/lib/capital/programmes";
import { activeProtections, messageGuardrails } from "@/lib/compliance/guardrails";
import { applyExtraction } from "@/lib/documents/extract";
import { createRequest, openCount, requestProgress } from "@/lib/documents/requests";
import { clearIntegrationCache } from "@/lib/integrations/engine";
import { screenPortfolio } from "@/lib/portfolio/screen";
import { checkCompaniesHouse } from "@/lib/registry/companies-house";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
let sponsorId = "";

beforeEach(async () => {
  for (const x of [claimEvidence, claims, docExtractions, docRequestItems, docRequests, entityAliases, registrySnapshots, notifications, regulatedProducts, protectedParties, capitalProfiles, projectParties, projects, organizations, integrations, providerCalls, sourceCache, mandates]) await t.db.delete(x);
  clearIntegrationCache();
  for (const [id, slug] of [[M, "regenera"], [OTHER, "other"]]) await t.db.insert(mandates).values({ id, slug, name: slug, type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  const [o] = await t.db.insert(organizations).values({ mandateId: M, name: "RA-ESG PLC", nameNormalized: "ra esg", source: "other" }).returning();
  sponsorId = o.id;
});

const extraction = { sponsor: { name: "RA-ESG PLC", country: "GBR" }, statements: [], projects: [
  { name: "Keetmanshoop (NAM1)", country: "NAM", locality: "Keetmanshoop", capacityMw: 54, annualGwh: 100, storage: null, tariff: "$0.08/kWh", capexUsd: 60_000_000, financing: null, offtake: "NamPower", status: null, page: 18 },
  { name: "Brandvlei (RSA1)", country: "ZAF", locality: "Brandvlei", capacityMw: 1000, annualGwh: 3200, storage: null, tariff: null, capexUsd: null, financing: null, offtake: null, status: null, page: 22 },
] };

describe("document extraction", () => {
  it("applies only selected projects, matches existing names, links the sponsor and records source-provided claims with pages", async () => {
    await t.db.insert(projects).values({ mandateId: M, name: "Brandvlei (RSA1)", stage: "opportunity" });
    const [ex] = await t.db.insert(docExtractions).values({ mandateId: M, fileName: "group-report.pdf", result: extraction, createdBy: "a@x" }).returning();
    const r = await applyExtraction(t.db, { extractionId: ex.id, mandateId: M, selected: [0, 1], sponsorOrgId: sponsorId, actor: "a@x" });
    expect(r).toEqual({ created: 1, matched: 1, claims: 7 }); // 5 stated figures + 2
    const all = await t.db.select().from(claims);
    expect(all.every(c => c.status === "source_provided")).toBe(true);
    expect(all.find(c => c.field === "annual_energy" && c.value === "100")?.unit).toBe("GWh");
    expect((await t.db.select().from(claimEvidence)).every(e => e.method === "document")).toBe(true);
    expect(await t.db.select().from(projectParties)).toHaveLength(2);
    await expect(applyExtraction(t.db, { extractionId: ex.id, mandateId: OTHER, selected: [0], sponsorOrgId: null, actor: "a@x" })).rejects.toThrow(/not found/);
  });
});

describe("portfolio screening", () => {
  it("finds the sponsor's projects and reads stated energy from claims", async () => {
    const [ex] = await t.db.insert(docExtractions).values({ mandateId: M, fileName: "g.pdf", result: extraction, createdBy: "a@x" }).returning();
    await applyExtraction(t.db, { extractionId: ex.id, mandateId: M, selected: [0], sponsorOrgId: sponsorId, actor: "a@x" });
    const s = await screenPortfolio(t.db, [M], sponsorId);
    expect(s?.rows).toHaveLength(1);
    expect(s?.rows[0]).toMatchObject({ name: "Keetmanshoop (NAM1)", capacityMw: 54, energyGwh: 100, located: false, roomTotal: 11 });
    expect(s?.rows[0].programmes).toBeGreaterThan(5);
    expect(await screenPortfolio(t.db, [OTHER], sponsorId)).toBeNull();
  });
});

describe("document requests", () => {
  it("creates the checklist and counts open items", async () => {
    const req = await createRequest(t.db, { mandateId: M, orgId: sponsorId, projectId: null, title: "Data room", template: "institutional", dueDate: null, ndaDocumentId: null, actor: "a@x" });
    const items = await t.db.select().from(docRequestItems).where(eq(docRequestItems.requestId, req.id));
    expect(items.length).toBeGreaterThan(25);
    await t.db.update(docRequestItems).set({ status: "received" }).where(eq(docRequestItems.id, items[0].id));
    const p = (await requestProgress(t.db, [req.id])).get(req.id);
    expect(p?.received).toBe(1);
    expect(openCount(p)).toBe(items.length - 1);
  });
});

describe("capital providers", () => {
  it("imports programmes once and refreshes on re-import", async () => {
    const first = await importProgrammes(t.db, M, "a@x", PROGRAMMES.slice(0, 4));
    expect(first).toEqual({ created: 4, updated: 0 });
    expect(await importProgrammes(t.db, M, "a@x", PROGRAMMES.slice(0, 4))).toEqual({ created: 0, updated: 4 });
    const rows = await t.db.select().from(capitalProfiles);
    expect(rows.every(r => r.programmeKey && r.routingStage === "new" && r.geographies.length > 0)).toBe(true);
  });
});

describe("guardrails", () => {
  it("holds drafts naming a regulated product and blocks introductions to active protected parties", async () => {
    await t.db.insert(regulatedProducts).values({ mandateId: M, name: "RA-ESG Income Bond", kind: "bond", aliases: ["Growth Bond"], createdBy: "a@x" });
    expect((await messageGuardrails(t.db, M, "Hi, our Growth Bond pays monthly")).ok).toBe(false);
    expect((await messageGuardrails(t.db, M, "Fit check on project debt")).ok).toBe(true);
    expect((await messageGuardrails(t.db, OTHER, "Growth Bond")).ok).toBe(true);
    await t.db.insert(protectedParties).values([{ mandateId: M, partyName: "Fund One", protectedFor: "RA-ESG", until: "2030-01-01", createdBy: "a@x" }, { mandateId: M, partyName: "Old Bank", protectedFor: "RA-ESG", until: "2020-01-01", createdBy: "a@x" }]);
    expect(await activeProtections(t.db, M, { name: "FUND ONE Ltd" }, "2026-10-08")).toHaveLength(1);
    expect(await activeProtections(t.db, M, { name: "Old Bank" }, "2026-10-08")).toHaveLength(0);
  });
});

describe("registry checks", () => {
  it("snapshots Companies House and notifies on changes", async () => {
    let resigned: string | null = null;
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/officers?items_per_page=100")) return Response.json({ items: [{ name: "VIEIRA, David", officer_role: "director", appointed_on: "2023-09-05", resigned_on: resigned }] });
      if (url.includes("/charges")) return Response.json({ items: [] });
      if (url.includes("/filing-history")) return Response.json({ items: [] });
      return Response.json({ company_status: "active", accounts: { overdue: false } });
    }) as unknown as typeof fetch;
    await expect(checkCompaniesHouse(t.db, undefined, { mandateId: M, orgId: sponsorId, orgName: "RA-ESG PLC", companyNumber: "15115086" }, fetchImpl)).rejects.toThrow(/COMPANIES_HOUSE_API_KEY/);
    const s1 = await checkCompaniesHouse(t.db, "k", { mandateId: M, orgId: sponsorId, orgName: "RA-ESG PLC", companyNumber: "15115086" }, fetchImpl);
    expect(s1.changes).toEqual([]);
    resigned = "2026-04-20";
    await t.db.delete(sourceCache);
    const s2 = await checkCompaniesHouse(t.db, "k", { mandateId: M, orgId: sponsorId, orgName: "RA-ESG PLC", companyNumber: "15115086" }, fetchImpl);
    expect(s2.changes.map(c => c.detail)).toEqual(["director resigned: VIEIRA, David (2026-04-20)"]);
    expect(await t.db.select().from(notifications)).toHaveLength(1);
  });
});
