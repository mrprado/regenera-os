// Source parsers against recorded response shapes; checks the current-data policy is applied at the source.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tedSignals, worldBankSignals, gdeltSignals, formDSignals } from "@/lib/sources/signals";
import { enrichPerson, searchPeople } from "@/lib/sources/apollo";
import { providerCalls } from "@/db/schema";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const NOW = new Date("2026-09-23T15:00:00Z");
const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("current-data policy at the source", () => {
  it("World Bank: keeps this year's open notices, drops old or closed ones", async () => {
    const f = respond({ procnotices: [
      { id: "A", noticedate: "22-Sep-2026", submission_deadline_date: "2026-10-14T00:00:00Z", bid_description: "ESIA water", project_ctry_name: "Nepal" },
      { id: "B", noticedate: "10-Sep-2026", submission_deadline_date: "2026-09-15T00:00:00Z", bid_description: "closed" },
      { id: "C", noticedate: "02-Jan-2025", submission_deadline_date: "2026-12-01T00:00:00Z", bid_description: "old notice" },
    ] });
    const out = await worldBankSignals(t.db, "water", NOW, f);
    expect(out.map(s => s.externalId)).toEqual(["A"]);
    expect(out[0].publishedAt).toBe("2026-09-22T00:00:00Z");
  });

  it("TED: keeps open notices, drops closed deadlines", async () => {
    const f = respond({ notices: [
      { "publication-number": "1-2026", "publication-date": "2026-09-01+02:00", "notice-title": { fra: "Étude de faisabilité" }, "buyer-country": ["FRA"], "deadline-receipt-tender-date-lot": ["2026-10-20+02:00"] },
      { "publication-number": "2-2026", "publication-date": "2026-08-03+02:00", "notice-title": { eng: "Closed" }, "deadline-receipt-tender-date-lot": ["2026-08-12+02:00"] },
    ] });
    const out = await tedSignals(t.db, "feasibility study", NOW, f);
    expect(out.map(s => s.externalId)).toEqual(["1-2026"]);
    expect(out[0].title).toBe("Étude de faisabilité");
  });

  it("GDELT: parses seen dates and drops articles outside the news window", async () => {
    const f = respond({ articles: [
      { url: "https://a", title: "Fund closes", seendate: "20260920T101500Z", domain: "a.com" },
      { url: "https://b", title: "Old", seendate: "20260601T000000Z", domain: "b.com" },
    ] });
    const out = await gdeltSignals(t.db, "q", NOW, f);
    expect(out.map(s => s.url)).toEqual(["https://a"]);
  });

  it("EDGAR Form D: maps filings to capital signals", async () => {
    const f = respond({ hits: { total: { value: 1 }, hits: [{ _id: "0002147569-26-000001:primary_doc.xml", _source: {
      ciks: ["0002147569"], display_names: ["Natural Capital Fund III-A, L.P.  (CIK 0002147569)"], file_date: "2026-07-29", form: "D", biz_locations: ["Fayetteville, AR"], adsh: "0002147569-26-000001",
    } }] } });
    const out = await formDSignals(t.db, "natural capital", NOW, f);
    expect(out[0]).toMatchObject({ source: "edgar_form_d", orgName: "Natural Capital Fund III-A, L.P.", publishedAt: "2026-07-29T00:00:00Z" });
    expect(out[0].url).toBe("https://www.sec.gov/Archives/edgar/data/2147569/000214756926000001/");
  });
});

describe("Apollo free plan guards", () => {
  const cfg = { apiKey: "k", monthlyCreditBudget: 2 };

  it("search spends no credits; enrichment records one credit and never asks for phone numbers", async () => {
    let lastUrl = "";
    const f = (async (url: string) => {
      lastUrl = url;
      return new Response(JSON.stringify(url.includes("people/match")
        ? { person: { id: "p1", email: "a@b.co", email_status: "verified", title: "CIO" }, match_confidence: "high" }
        : { people: [{ id: "p1", first_name: "A", title: "CIO" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = await searchPeople(t.db, cfg, { person_titles: ["cio"] }, f);
    expect(s.people).toHaveLength(1);
    const e = await enrichPerson(t.db, cfg, { id: "p1" }, f);
    expect(e.person?.email).toBe("a@b.co");
    expect(lastUrl).toContain("reveal_phone_number=false");
    const ledger = await t.db.select().from(providerCalls);
    expect(ledger.filter(r => r.provider === "apollo").reduce((a, r) => a + r.credits, 0)).toBe(1);
  });

  it("refuses enrichment past the monthly credit budget", async () => {
    const f = respond({ person: { id: "p2", email: "c@d.co", title: "x" }, match_confidence: "high" });
    await enrichPerson(t.db, cfg, { id: "p2" }, f); // 2nd credit this month
    await expect(enrichPerson(t.db, cfg, { id: "p3" }, f)).rejects.toThrow(/credit budget/);
  });
});
