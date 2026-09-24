import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activities, contacts, deals, organizations, partners, siteEvents } from "@/db/schema";
import { applySiteEvent, importTracker, signSiteBody, verifySiteSignature, zTrackerEntry } from "@/lib/crm/site-intake";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
beforeEach(async () => { for (const x of [siteEvents, activities, deals, contacts, organizations, partners]) await t.db.delete(x); });

const inquiry = { id: 41, kind: "capital" as const, audienceType: "Family Office", name: "Ana Ruiz", email: "ana@terrafo.mx", organization: "Terra Family Office", role: "Managing Partner / Principal", sector: "Water, Food & Nature", geography: "Mexico", stage: "Development", ticket: "$5M to $25M", structure: "Equity", summary: "Seeking regenerative ag projects", createdAt: "2026-09-20 14:02:11" };
const referral = { id: 7, partnerName: "Luis EPC", partnerEmail: "luis@epc.co", partnerOrg: "EPC Co", type: "opportunity" as const, refName: "Marta Solar", refOrg: "Solar Norte", sector: "Energy", context: "Grid delay on 80 MW", tier: "institutional" as const, status: "submitted" as const, date: "2026-09-18", createdAt: "2026-09-18 10:00:00" };

describe("site webhook signatures", () => {
  it("accepts a fresh valid signature and rejects tampering, wrong secret and replays", async () => {
    const body = JSON.stringify({ event: "inquiry.created", data: inquiry });
    const now = Date.now();
    const sig = await signSiteBody("s3cret", body, now);
    expect(await verifySiteSignature("s3cret", sig, body, now)).toBe(true);
    expect(await verifySiteSignature("s3cret", sig, body.replace("Ana", "Eve"), now)).toBe(false);
    expect(await verifySiteSignature("other", sig, body, now)).toBe(false);
    expect(await verifySiteSignature("s3cret", sig, body, now + 6 * 60_000)).toBe(false);
    expect(await verifySiteSignature(undefined, sig, body, now)).toBe(false);
  });
});

describe("applySiteEvent", () => {
  it("creates org, contact and a capital-mandate deal once, however many times it is delivered", async () => {
    const a = await applySiteEvent(t.db, { event: "inquiry.created", data: inquiry });
    const b = await applySiteEvent(t.db, { event: "inquiry.created", data: inquiry });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    const d = await t.db.select().from(deals);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ path: "capital_mandate", engagement: "capital_screening", stage: "lead", sector: "water_food_nature", source: "website" });
    const [c] = await t.db.select().from(contacts);
    expect(c).toMatchObject({ emailLower: "ana@terrafo.mx", emailStatus: "unverified", consentBasis: "legitimate_interest" });
  });

  it("tracks referral status changes onto the deal", async () => {
    await applySiteEvent(t.db, { event: "referral.created", data: referral });
    await applySiteEvent(t.db, { event: "referral.updated", data: { ...referral, status: "mandate_signed" } });
    const [d] = await t.db.select().from(deals);
    expect(d.stage).toBe("signed");
    expect(d.source).toBe("referral");
    const [p] = await t.db.select().from(partners);
    expect(p).toMatchObject({ tier: "institutional", referralStatus: "mandate_signed" });
  });
});

describe("importTracker", () => {
  const entries = [
    { id: 1, name: "Jon", organization: "Acme Water", email: "jon@acmewater.com", type: "opportunity", engagement: "diagnostic", sector: "Water, Food & Nature", source: "linkedin", fee: "one_time", stage: "call_booked", notes: "n", date: "2026-05-01", contacts: [{ contactedAt: "2026-05-02T10:00:00Z", method: "email", note: "intro" }] },
    { id: 2, name: "Kim", organization: "Blue Fund", email: "", type: "capital", engagement: "capital_advisory", sector: "", source: "referral", fee: "success_fee", percentage: "2", stage: "renewed", notes: "", date: "2026-04-01", contacts: [] },
  ].map(e => zTrackerEntry.parse(e));

  it("maps every stage, engagement and fee, and is idempotent", async () => {
    const r1 = await importTracker(t.db, entries);
    expect(r1).toEqual({ created: 2, updated: 0, byStage: { call_booked: 1, expansion: 1 } });
    const r2 = await importTracker(t.db, entries);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(2);
    const all = await t.db.select().from(deals);
    expect(all).toHaveLength(2);
    const blue = all.find(d => d.legacyPipelineEntryId === 2)!;
    expect(blue).toMatchObject({ stage: "expansion", engagement: "capital_advisory", feeType: "success_fee", path: "capital_mandate" });
    expect(blue.feeTerms).toEqual({ percentage: "2" });
    const acts = await t.db.select().from(activities).where(eq(activities.source, "import"));
    expect(acts).toHaveLength(1); // re-import replaced, not duplicated
  });
});
