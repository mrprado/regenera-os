import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bidLibrary, caseRecords, deals, fundingMatches, fundingOpportunities, mandates, organizations, providerCalls, segments, sourceCache, systemState, tasks } from "@/db/schema";
import { ensurePrompts } from "@/lib/ai/run";
import { upsertOrganization } from "@/lib/crm/entities";
import { draftProposal } from "@/lib/funding/bids";
import { applicantGroups, bidOnOpportunity, cleanText, bidPlan, closeExpired, countryMatches, matchApplicants, readFunding, scanFunding, upsertFunding } from "@/lib/funding/engine";
import { euBudgetRange, euFunding, grantsGov, ukContracts, usDate, type FundingItem } from "@/lib/funding/sources";
import { buildDigest } from "@/lib/outreach/digest";
import { ensureSegments } from "@/lib/segments";
import { createTestDb } from "../helpers/d1";
import { fakeAnthropic } from "../helpers/fake-anthropic";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); await ensureSegments(t.db); await ensurePrompts(t.db); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const NOW = new Date("2026-09-24T12:00:00Z");
const AI = { apiKey: "x", monthlyBudgetUsd: 50 };

beforeEach(async () => {
  for (const x of [fundingMatches, tasks, deals, fundingOpportunities, bidLibrary, caseRecords, organizations, providerCalls, sourceCache, systemState, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

const item = (over: Partial<FundingItem> = {}): FundingItem => ({
  source: "grants_gov", externalId: "1", title: "Watershed Restoration Grants", funder: "Bureau of Reclamation", programme: null, type: "grant",
  amountMin: 50_000, amountMax: 300_000, currency: "USD", openDate: "2026-06-10", deadline: "2026-12-15", status: "open",
  countries: ["United States"], applicantTypes: ["City or township governments"], url: "https://www.grants.gov/x", description: "Watershed restoration and water resilience.", ...over,
});

describe("sources", () => {
  it("Grants.gov keeps open and forecast calls with a future deadline, with details", async () => {
    const f = (async (url: string) => Response.json(url.includes("fetchOpportunity")
      ? { data: { synopsis: { awardCeiling: "300,000", awardFloor: 50000, applicantTypes: [{ description: "County governments" }], synopsisDesc: "<p>Restore <b>watersheds</b></p>" } } }
      : { data: { oppHits: [
        { id: "1", title: "Open call", agency: "DOI", openDate: "06/10/2026", closeDate: "02/15/2028", oppStatus: "posted" },
        { id: "2", title: "Forecast call", agency: "EPA", openDate: "", closeDate: "", oppStatus: "forecasted" },
        { id: "3", title: "Closed call", agency: "USDA", openDate: "01/01/2026", closeDate: "03/01/2026", oppStatus: "posted" },
      ] } })) as unknown as typeof fetch;
    const r = await grantsGov(t.db, "watershed", NOW, f);
    expect(r.map(x => [x.externalId, x.status])).toEqual([["1", "open"], ["2", "forthcoming"]]);
    expect(r[0]).toMatchObject({ deadline: "2028-02-15", amountMin: 50_000, amountMax: 300_000, applicantTypes: ["County governments"], description: "Restore watersheds" });
    expect(usDate("02/15/2028")).toBe("2028-02-15");
  });

  it("EU Funding & Tenders maps status, deadline and budget range", async () => {
    const budget = JSON.stringify({ budgetTopicActionMap: { a: [{ minContribution: 2_000_000, maxContribution: 5_000_000 }], b: [{ minContribution: 1_000_000, maxContribution: 3_000_000 }] } });
    const f = (async () => Response.json({ results: [
      { summary: "NBS demo", metadata: { identifier: ["HORIZON-X-01"], title: ["Nature-based solutions demo"], status: ["31094502"], deadlineDate: ["2027-01-20T00:00:00.000+0000"], startDate: ["2026-09-01T00:00:00.000+0000"], callIdentifier: ["HORIZON-X"], budgetOverview: [budget] } },
      { summary: "Closed", metadata: { identifier: ["OLD-1"], title: ["Old"], status: ["31094503"], deadlineDate: ["2024-01-01T00:00:00.000+0000"] } },
    ] })) as unknown as typeof fetch;
    const r = await euFunding(t.db, "nature-based solutions", NOW, f);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ externalId: "HORIZON-X-01", status: "open", deadline: "2027-01-20", amountMin: 1_000_000, amountMax: 5_000_000, currency: "EUR" });
    expect(euBudgetRange("not json")).toEqual({ min: null, max: null });
  });

  it("UK Contracts Finder keeps tenders still open", async () => {
    const f = (async () => Response.json({ releases: [
      { ocid: "ocds-b5fd17-a", tender: { title: "River restoration", value: { amount: 80000, currency: "GBP" }, tenderPeriod: { endDate: "2026-10-15T12:00:00+01:00" } }, parties: [{ name: "Environment Agency", roles: ["buyer"] }] },
      { ocid: "ocds-b5fd17-b", tender: { title: "Expired", tenderPeriod: { endDate: "2026-01-01T12:00:00Z" } } },
    ] })) as unknown as typeof fetch;
    const r = await ukContracts(t.db, "restoration", NOW, f);
    expect(r.map(x => x.title)).toEqual(["River restoration"]);
    expect(r[0]).toMatchObject({ funder: "Environment Agency", amountMax: 80000, deadline: "2026-10-15" });
  });
});

describe("engine", () => {
  it("de-duplicates the same call across sources, refreshes by source id, and closes expired ones", async () => {
    expect(await upsertFunding(t.db, M, item(), "watershed", NOW)).toBe("new");
    expect(await upsertFunding(t.db, M, item({ source: "eu_funding", externalId: "EU-1" }), "watershed", NOW)).toBe("duplicate");
    expect(await upsertFunding(t.db, M, item({ amountMax: 400_000 }), "watershed", NOW)).toBe("updated");
    await upsertFunding(t.db, M, item({ externalId: "2", title: "Short window", deadline: "2026-09-30" }), null, NOW);
    const rows = await t.db.select().from(fundingOpportunities);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.externalId === "1")?.amountMax).toBe(400_000);
    expect(rows.find(r => r.externalId === "1")!.fit).toBeGreaterThan(0); // keyword fit before Claude reads it
    expect(await closeExpired(t.db, new Date("2026-10-05T00:00:00Z"))).toBe(1);
  });

  it("cleans entities, zero-width characters and placeholder amounts", async () => {
    expect(cleanText("​​Youth Corps&nbsp;&nbsp; &amp; Trails&#39;")).toBe("Youth Corps & Trails'");
    await upsertFunding(t.db, M, item({ externalId: "9", title: "ERDC&nbsp;BAA", amountMin: null, amountMax: 999_999_999 }), null, NOW);
    const [o] = await t.db.select().from(fundingOpportunities);
    expect(o).toMatchObject({ title: "ERDC BAA", amountMax: null });
    await upsertFunding(t.db, M, item({ externalId: "10", title: "Standing BAA", deadline: "2076-01-01" }), null, NOW);
    expect((await t.db.select().from(fundingOpportunities).where(eq(fundingOpportunities.externalId, "10")))[0].deadline).toBeNull();
  });

  it("rotates through query and source pairs, and one failing source never stops the scan", async () => {
    const f = (async (url: string) => {
      if (url.includes("grants.gov")) throw new Error("network down");
      if (url.includes("search-api")) return Response.json({ results: [] });
      if (url.includes("contractsfinder")) return Response.json({ releases: [] });
      if (url.includes("ted.europa")) return Response.json({ notices: [] });
      return Response.json({ procnotices: [] });
    }) as unknown as typeof fetch;
    const r1 = await scanFunding(t.db, M, NOW, f, 5);
    expect(r1.runs + r1.errors.length).toBe(5);
    expect(r1.errors[0]).toContain("grants_gov");
    const [c1] = await t.db.select().from(systemState).where(eq(systemState.key, "funding_scan_cursor"));
    expect(c1.value).toBe("5");
    await scanFunding(t.db, M, NOW, f, 5);
    const [c2] = await t.db.select().from(systemState).where(eq(systemState.key, "funding_scan_cursor"));
    expect(c2.value).toBe("10");
  });

  it("skips off-topic items whose text names no service term", async () => {
    const f = (async () => Response.json({ releases: [
      { ocid: "ocds-x", tender: { title: "Taxi and minibus services", description: "Home to school transport", tenderPeriod: { endDate: "2026-12-01T12:00:00Z" } } },
      { ocid: "ocds-y", tender: { title: "Wetland restoration works", description: "Restore wetland habitat", tenderPeriod: { endDate: "2026-12-01T12:00:00Z" } } },
    ] })) as unknown as typeof fetch;
    const r = await scanFunding(t.db, M, NOW, f, 1, { query: "restoration", source: "uk_contracts" });
    expect(r).toMatchObject({ fresh: 1, offTopic: 1 });
  });

  it("Claude's read sets fit, route and eligibility", async () => {
    await upsertFunding(t.db, M, item(), "watershed", NOW);
    const fake = fakeAnthropic([{ fit: 88, route: "client_support", type: "grant", summary: "Funds watershed plans.", why: "Water systems are core.", eligible_applicants: ["local government"],
      eligible_countries: ["United States"], sectors: ["water_food_nature"], consortium_needed: false, caveats: ["Cost share 50%"], cofinancing_pct: 50 }]);
    expect(await readFunding(t.db, AI, 5, NOW, fake.client)).toBe(1);
    const [o] = await t.db.select().from(fundingOpportunities);
    expect(o).toMatchObject({ fit: 88, route: "client_support", cofinancingPct: 50, applicantTypes: ["local government"] });
    expect(o.read?.caveats).toEqual(["Cost share 50%"]);
  });

  it("finds eligible applicants by country, applicant type and sector", async () => {
    const pub = (await t.db.select().from(segments).where(eq(segments.key, "municipalities")))[0];
    const corp = (await t.db.select().from(segments).where(eq(segments.key, "energy_utilities")))[0];
    await upsertOrganization(t.db, M, { name: "City of Tucson", country: "United States", segmentId: pub.id, sector: "water_food_nature" }, "other", { source: "t" });
    await upsertOrganization(t.db, M, { name: "Lima Water", country: "Peru", segmentId: pub.id, sector: "water_food_nature" }, "other", { source: "t" });
    await upsertOrganization(t.db, M, { name: "US Power Co", country: "United States", segmentId: corp.id, sector: "energy" }, "other", { source: "t" });
    await upsertFunding(t.db, M, item(), "watershed", NOW);
    const [o] = await t.db.select().from(fundingOpportunities);
    await t.db.update(fundingOpportunities).set({ applicantTypes: ["local government"], sectors: ["water_food_nature"] }).where(eq(fundingOpportunities.id, o.id));
    expect(await matchApplicants(t.db, o.id)).toBe(1);
    const [m] = await t.db.select({ name: organizations.name, reason: fundingMatches.reason }).from(fundingMatches).innerJoin(organizations, eq(organizations.id, fundingMatches.orgId));
    expect(m.name).toBe("City of Tucson");
    expect(m.reason).toContain("public applicant");
    expect(countryMatches(["European Union"], "Madrid, Spain")).toBe(true);
    expect(countryMatches(["European Union"], "Lima, Peru")).toBe(false);
    expect(applicantGroups([])).toBeNull();
    expect([...applicantGroups(["Nonprofits having a 501(c)(3) status"])!]).toEqual(["community"]);
  });

  it("Bid opens one deal with tasks planned back from the deadline", async () => {
    await upsertFunding(t.db, M, item({ deadline: "2026-10-30" }), "watershed", NOW);
    const [o] = await t.db.select().from(fundingOpportunities);
    const dealId = await bidOnOpportunity(t.db, o.id, "alan", NOW);
    expect(await bidOnOpportunity(t.db, o.id, "alan", NOW)).toBe(dealId);
    const [d] = await t.db.select().from(deals).where(eq(deals.id, dealId));
    expect(d).toMatchObject({ opportunityId: o.id, expectedClose: "2026-10-30", source: "procurement" });
    const ts = await t.db.select().from(tasks).where(eq(tasks.dealId, dealId));
    expect(ts).toHaveLength(6);
    expect(ts.map(x => x.dueAt).sort()[0] >= "2026-09-25").toBe(true);
    expect((await t.db.select().from(fundingOpportunities))[0].decision).toBe("bidding");
    expect(bidPlan("2026-09-26", NOW).every(p => p.due >= "2026-09-25")).toBe(true); // never in the past
  });

  it("proposal drafts use past performance only when disclosure is authorized", async () => {
    await upsertFunding(t.db, M, item(), "watershed", NOW);
    const [o] = await t.db.select().from(fundingOpportunities);
    const [d] = await t.db.insert(deals).values({ mandateId: M, name: "Won", path: "project_diagnostic", stage: "signed" }).returning();
    const [c] = await t.db.insert(caseRecords).values({ mandateId: M, dealId: d.id, decision: "x", disclosureAuthorized: false }).returning();
    await t.db.insert(bidLibrary).values([
      { mandateId: M, kind: "profile", title: "Regenera profile", body: "Development office across energy and land." },
      { mandateId: M, kind: "past_performance", title: "Secret project", body: "Confidential client work", caseRecordId: c.id },
    ]);
    const fake = fakeAnthropic([{ sections: [{ heading: "Approach", body: "Diagnostic first [TO CONFIRM]" }], gaps: ["Team"] }]);
    const draft = await draftProposal(t.db, AI, o.id, fake.client);
    expect(draft.sections[0].heading).toBe("Approach");
    expect(String(fake.calls[0].content)).toContain("Regenera profile");
    expect(String(fake.calls[0].content)).not.toContain("Secret project");
    expect((await t.db.select().from(fundingOpportunities))[0].read?.proposal?.gaps).toEqual(["Team"]);
  });

  it("the digest lists bids and strong fits closing in 14 or 3 days", async () => {
    await upsertFunding(t.db, M, item({ externalId: "a", title: "Closing in three days", deadline: "2026-09-27" }), null, NOW);
    await upsertFunding(t.db, M, item({ externalId: "b", title: "Far away", deadline: "2027-03-01" }), null, NOW);
    await t.db.update(fundingOpportunities).set({ fit: 75 });
    const dg = await buildDigest(t.db, NOW);
    expect(dg.fundingDeadlines.map(f => [f.title, f.daysLeft])).toEqual([["Closing in three days", 3]]);
  });
});
