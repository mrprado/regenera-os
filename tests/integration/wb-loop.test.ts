import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimEvidence, claims, events, generatedDocuments, mandates, organizations, projectParties, projects, providerCalls, siteIntelRuns, sourceCache, systemState, tasks } from "@/db/schema";
import { runNextStage } from "@/lib/site-intel/engine";
import { clearIntegrationCache } from "@/lib/integrations/engine";
import { MARKET_PREFIX, normalizeWb, processWbProject, runWbLoop } from "@/lib/intel/wb-projects";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const WB = { id: "P171750", project_name: "Rooftop Solar Program", countrycode: ["NA"], totalamt: "150,000,000", boardapprovaldate: "2022-06-28T00:00:00Z", status: "Active", borrower: "Ministry of Finance", impagency: "NamPower", lendinginstr: "Investment Project Financing", sector1: { Name: "Renewable Energy Solar" }, url: "https://projects.worldbank.org/en/projects-operations/project-detail/P171750" };
const fakeFetch = (async (url: string) => {
  if (String(url).includes("nominatim")) return new Response(JSON.stringify([{ lat: "-22.9", lon: "18.4", display_name: "Namibia", address: { country_code: "na" } }]), { status: 200 });
  return new Response(JSON.stringify({ total: "1", projects: { [WB.id]: WB } }), { status: 200 });
}) as typeof fetch;

beforeEach(async () => {
  for (const x of [generatedDocuments, tasks, claimEvidence, claims, events, projectParties, siteIntelRuns, projects, organizations, providerCalls, sourceCache, systemState, mandates]) await t.db.delete(x);
  clearIntegrationCache();
  await t.db.insert(mandates).values({ id: REGENERA_MANDATE_ID, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

describe("phase 21 §6 autonomous loop: World Bank project → OS (no manual entry)", () => {
  it("normalizes and scopes: drops small, closed or countryless projects", () => {
    expect(normalizeWb(WB)).toMatchObject({ iso3: "NAM", usd: 150_000_000, status: "Active" });
    expect(normalizeWb({ ...WB, totalamt: "5,000,000" })).toBeNull();
    expect(normalizeWb({ ...WB, status: "Dropped" })).toBeNull();
    expect(normalizeWb({ ...WB, countrycode: undefined })).toBeNull();
  });

  it("creates the project with evidence-backed claims, typed parties, placement and a screening run; re-ingest is idempotent", async () => {
    const r = await runWbLoop(t.db, new Date(), 8, fakeFetch);
    expect(r.created).toBe(1);
    const [p] = await t.db.select().from(projects).where(like(projects.originationSource, `${MARKET_PREFIX}%`));
    expect(p).toMatchObject({ country: "NAM", capex: 150_000_000, locationPrecision: "country" });
    const cs = await t.db.select().from(claims).where(eq(claims.entityId, p.id));
    expect(cs.map(c => c.field).sort()).toEqual(["board_approval", "capex", "instrument", "status"]);
    expect(cs.every(c => c.status === "source_provided")).toBe(true);
    const ev = await t.db.select().from(claimEvidence);
    expect(ev.every(e => e.sourceUrl === WB.url && e.method === "api")).toBe(true);
    const parties = await t.db.select({ role: projectParties.role, name: organizations.name }).from(projectParties).innerJoin(organizations, eq(organizations.id, projectParties.orgId)).where(eq(projectParties.projectId, p.id));
    expect(parties.map(x => `${x.role}:${x.name}`).sort()).toEqual(["government:Ministry of Finance", "government:NamPower", "lender:World Bank"]);
    const [run] = await t.db.select().from(siteIntelRuns).where(eq(siteIntelRuns.projectId, p.id));
    expect(run.stages.map(s => s.key)).toEqual(["finance", "capital", "partners", "assessment"]);
    expect((await t.db.select().from(events)).some(e => e.type === "PROJECT_CREATED")).toBe(true);
    // Same record again: nothing duplicated.
    expect(await processWbProject(t.db, WB, new Date(), fakeFetch)).toBe("unchanged");
    expect((await t.db.select().from(projects)).length).toBe(1);
  });

  it("Test G: source → record → screening → saved assessment and review task, with no manual step", async () => {
    await runWbLoop(t.db, new Date(), 8, fakeFetch);
    const [run] = await t.db.select().from(siteIntelRuns);
    for (let i = 0; i < 6; i++) await runNextStage(t.db, run.id);
    const [done] = await t.db.select().from(siteIntelRuns).where(eq(siteIntelRuns.id, run.id));
    expect(done.stages.every(s => s.status === "done")).toBe(true);
    const [doc] = await t.db.select().from(generatedDocuments);
    expect(doc).toMatchObject({ templateKey: "site_assessment", entityType: "project", version: 1, confidential: true });
    expect(doc.body).toMatch(/SCREENING GRADE/);
    expect(doc.body).toMatch(/not evidence of available interconnection capacity/);
    expect((await t.db.select().from(tasks)).map(x => x.title)).toEqual(["Review site assessment: Rooftop Solar Program"]);
  });

  it("a material change adds new claims, keeps the old ones and re-runs the assessment", async () => {
    await processWbProject(t.db, WB, new Date(), fakeFetch);
    const before = (await t.db.select().from(claims)).length;
    expect(await processWbProject(t.db, { ...WB, totalamt: "200,000,000" }, new Date(), fakeFetch)).toBe("updated");
    const after = await t.db.select().from(claims);
    expect(after.length).toBe(before + 2);
    expect(after.filter(c => c.field === "capex").map(c => c.value).sort()).toEqual(["150000000", "200000000"]);
    expect((await t.db.select().from(siteIntelRuns)).length).toBe(2);
    expect((await t.db.select().from(events)).some(e => e.type === "SOURCE_RECORD_UPDATED")).toBe(true);
  });
});
