import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  capitalMandates, capitalMatches, capitalOpportunities, capitalProfiles, capitalRequirements, capitalTranches, commitmentEvents, commitments, contacts,
  investorQualifications, mandates, materialDeliveries, messages, organizations, privateCapitalProfiles, projectReadiness, projects, projectStageHistory,
} from "@/db/schema";
import {
  commercialFit, eligibilityFor, expireQualifications, formation, gateCheck, runMatches, setCommitment, setGate,
} from "@/lib/capital/engine";
import { sendClaimedMessage } from "@/lib/crm/send";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const NOW = new Date("2026-09-24T12:00:00Z");
let oppId = "", personId = "", privateId = "", profileId = "";

beforeEach(async () => {
  for (const x of [materialDeliveries, commitmentEvents, commitments, capitalMatches, capitalOpportunities, capitalMandates, capitalProfiles, investorQualifications, privateCapitalProfiles, messages,
    capitalTranches, capitalRequirements, projectReadiness, projectStageHistory, projects, contacts, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", country: "Mexico", sector: "energy", stage: "development" }, "alan");
  const [req] = await t.db.insert(capitalRequirements).values({ projectId: p.id, mandateId: M, purpose: "Development", instrument: "development_capital", target: 2_000_000 }).returning();
  const [tr] = await t.db.insert(capitalTranches).values({ projectId: p.id, requirementId: req.id, mandateId: M, name: "Dev A", instrument: "development_capital", target: 2_000_000, minParticipation: 250_000, maxParticipation: 1_000_000 }).returning();
  const [o] = await t.db.insert(capitalOpportunities).values({ mandateId: M, projectId: p.id, requirementId: req.id, trancheId: tr.id, title: "Valle Solar: Dev A", instrument: "development_capital", target: 2_000_000, jurisdictions: ["US"] }).returning();
  oppId = o.id;
  const [c] = await t.db.insert(contacts).values({ mandateId: M, fullName: "Private Person", nameNormalized: "private person", email: "pp@example.org", source: "other" }).returning();
  personId = c.id;
  const [pp] = await t.db.insert(privateCapitalProfiles).values({ mandateId: M, contactId: c.id, geographies: ["LATAM"], sectors: ["energy"], stages: ["development"], instruments: ["development_capital"], ticketMin: 250_000, ticketMax: 500_000, currency: "USD" }).returning();
  privateId = pp.id;
  const [cp] = await t.db.insert(capitalProfiles).values({ mandateId: M, name: "Andes Infra Fund", capitalType: "fund", geographies: ["Europe"], sectors: ["energy"], instruments: ["senior_debt"] }).returning();
  profileId = cp.id;
});

describe("capital relationships", () => {
  it("commercial fit is transparent: unknown criteria neither help nor hurt, regions expand to countries", () => {
    const target = { country: "Mexico", sector: "energy", stage: "development", instrument: "development_capital", ticketMin: 250_000, ticketMax: 1_000_000, currency: "USD" };
    const full = commercialFit({ geographies: ["LATAM"], sectors: ["energy"], stages: ["development"], instruments: ["development_capital"], ticketMin: 100_000, ticketMax: 500_000, currency: "USD" }, target);
    expect(full.score).toBe(100);
    const unknown = commercialFit({ geographies: [], sectors: [], stages: [], instruments: [], ticketMin: null, ticketMax: null, currency: null }, target);
    expect(unknown).toMatchObject({ score: 0, completeness: 0 });
    expect(unknown.reasons).toContain("Geography not known");
    const wrong = commercialFit({ geographies: ["Europe"], sectors: ["energy"], stages: [], instruments: ["senior_debt"], ticketMin: null, ticketMax: null, currency: null }, target);
    expect(wrong.score).toBe(20);
    expect(wrong.reasons.join(" ")).toMatch(/does not include Mexico.*Does not use development_capital/);
  });

  it("eligibility comes only from jurisdiction-specific, unexpired qualification records", async () => {
    expect((await eligibilityFor(t.db, { contactId: personId }, ["US"], NOW)).eligibility).toBe("unknown");
    await t.db.insert(investorQualifications).values({ mandateId: M, contactId: personId, jurisdiction: "GB", classification: "Certified sophisticated investor", verificationStatus: "self_certified" });
    expect((await eligibilityFor(t.db, { contactId: personId }, ["US"], NOW)).eligibility).toBe("unknown"); // a UK status says nothing about the US
    await t.db.insert(investorQualifications).values({ mandateId: M, contactId: personId, jurisdiction: "US", classification: "Accredited investor", verificationStatus: "third_party_verified", verifiedBy: "VerifyCo", expiresAt: "2026-09-01" });
    const expired = await eligibilityFor(t.db, { contactId: personId }, ["US"], NOW);
    expect(expired.eligibility).toBe("unknown");
    expect(expired.reasons.join(" ")).toContain("expired 2026-09-01");
    await t.db.update(investorQualifications).set({ expiresAt: "2027-09-01" }).where(eq(investorQualifications.jurisdiction, "US"));
    const ok = await eligibilityFor(t.db, { contactId: personId }, ["US"], NOW);
    expect(ok.eligibility).toBe("eligible");
    expect(ok.reasons.at(-1)).toContain("not a legal conclusion");
    expect(await expireQualifications(t.db, new Date("2027-10-01T00:00:00Z"))).toBe(1);
  });

  it("runs matching across partners (best mandate) and private investors, keeping each match's status", async () => {
    await t.db.insert(capitalMandates).values({ mandateId: M, profileId, name: "LATAM dev fund", geographies: ["LATAM"], sectors: ["energy"], stages: ["development"], instruments: ["development_capital"] });
    expect(await runMatches(t.db, oppId, NOW)).toBe(2);
    const ms = await t.db.select().from(capitalMatches);
    const fund = ms.find(m => m.capitalProfileId === profileId)!;
    expect(fund.commercialScore).toBe(80);
    expect(fund.commercialReasons[0]).toBe("Mandate: LATAM dev fund");
    expect(fund.eligibility).toBe("not_assessed");
    const priv = ms.find(m => m.privateProfileId === privateId)!;
    expect(priv).toMatchObject({ commercialScore: 100, eligibility: "unknown" });
    await t.db.update(capitalMatches).set({ status: "shortlisted" }).where(eq(capitalMatches.id, priv.id));
    await runMatches(t.db, oppId, NOW);
    expect((await t.db.select().from(capitalMatches).where(eq(capitalMatches.id, priv.id)))[0].status).toBe("shortlisted");
  });

  it("the ledger keeps one row per investor, needs evidence for commitments, and formation never double counts", async () => {
    await runMatches(t.db, oppId, NOW);
    const key = `private:${privateId}`;
    await setCommitment(t.db, { opportunityId: oppId, investorKey: key, stage: "interest", amount: 300_000, actor: "alan" }, NOW);
    await setCommitment(t.db, { opportunityId: oppId, investorKey: key, stage: "ioi", amount: 400_000, actor: "alan" }, NOW);
    await expect(setCommitment(t.db, { opportunityId: oppId, investorKey: key, stage: "commitment", amount: 400_000, actor: "alan" }, NOW)).rejects.toThrow("evidence");
    await setCommitment(t.db, { opportunityId: oppId, investorKey: key, stage: "commitment", amount: 400_000, evidence: "Signed commitment letter 2026-10-02", actor: "alan" }, NOW);
    await setCommitment(t.db, { opportunityId: oppId, investorKey: `profile:${profileId}`, stage: "ioi", amount: 1_000_000, actor: "alan" }, NOW);
    expect(await t.db.select().from(commitments)).toHaveLength(2);
    expect(await t.db.select().from(commitmentEvents)).toHaveLength(4);
    const f = await formation(t.db, oppId);
    expect(f.interested).toEqual({ investors: 2, amount: 1_400_000 });
    expect(f.ioi).toEqual({ investors: 2, amount: 1_400_000 });
    expect(f.committed).toEqual({ investors: 1, amount: 400_000 });
    expect(f.funded).toEqual({ investors: 0, amount: 0 });
  });

  it("the gate needs a named reviewer and evidence, and blocks investment communications until everything is in place", async () => {
    await expect(setGate(t.db, oppId, { state: "approved" }, "alan")).rejects.toThrow("who reviewed");
    const msg = { outreachType: "investment_communication", capitalOpportunityId: oppId, contactId: personId };
    expect((await gateCheck(t.db, { ...msg, capitalOpportunityId: null })).reasons).toEqual(["Investment communication without a capital opportunity"]);
    expect((await gateCheck(t.db, { outreachType: "relationship", capitalOpportunityId: null, contactId: personId })).ok).toBe(true);
    const blocked = await gateCheck(t.db, msg, NOW);
    expect(blocked.reasons).toEqual(expect.arrayContaining(["Gate is review required, not approved", "Recipient is not approved for outreach on this opportunity", "Recipient eligibility: unknown", "No approved materials on the opportunity"]));

    await setGate(t.db, oppId, { state: "approved", reviewer: "Jane Doe, counsel", evidence: "Memo 2026-09-20: Rule 506(c), verified accredited only" }, "alan", NOW);
    await t.db.update(capitalOpportunities).set({ approvedMaterials: [{ title: "Teaser", version: "v3", ref: "" }] }).where(eq(capitalOpportunities.id, oppId));
    await runMatches(t.db, oppId, NOW);
    await t.db.update(capitalMatches).set({ status: "approved_for_outreach" }).where(eq(capitalMatches.privateProfileId, privateId));
    await t.db.insert(investorQualifications).values({ mandateId: M, contactId: personId, jurisdiction: "US", classification: "Accredited investor", verificationStatus: "third_party_verified", verifiedBy: "VerifyCo", expiresAt: "2027-09-01" });
    expect(await gateCheck(t.db, msg, NOW)).toEqual({ ok: true, reasons: [] });
  });

  it("the send path holds a gated message and returns it to the approval queue", async () => {
    const [m] = await t.db.insert(messages).values({ mandateId: M, contactId: personId, channel: "email", direction: "out", mailboxRole: "primary", toEmail: "pp@example.org", subject: "Valle Solar", body: "Hello", status: "sending", outreachType: "investment_communication", capitalOpportunityId: oppId }).returning();
    let tokenAsked = false;
    const r = await sendClaimedMessage(t.db, m.id, async () => { tokenAsked = true; throw new Error("should not send"); }, { production: false, allowedDomains: ["example.org"], postalAddress: null });
    expect(r).toEqual({ sent: false, reason: "compliance_gate" });
    expect(tokenAsked).toBe(false);
    const [held] = await t.db.select().from(messages).where(eq(messages.id, m.id));
    expect(held.status).toBe("pending_approval");
    expect(held.error).toContain("Held by the compliance gate");
  });
});
