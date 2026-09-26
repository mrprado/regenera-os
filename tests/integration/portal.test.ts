import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bids, brokerProfiles, capitalMatches, capitalOpportunities, commissionEvents, commissionSchedules, dataRoomDocuments, dataRooms, distributionApprovals, documents,
  intakeSubmissions, investorQualifications, mandates, ndaAcceptances, organizations, portalAccessLog, portalGrants, portalInvites, portalSessions, portalUsers,
  procurementPackages, projects, projectUpdates, referralAgreements, referralRegistrations,
} from "@/db/schema";
import { canOpenDocument, grantAccess, visibleOpportunities } from "@/lib/portal/access";
import { acceptInvite, invitePortalUser, portalSessionUser, portalSignIn, setPortalUserStatus } from "@/lib/portal/auth";
import { approveCommission, estimateCommission, expireBrokerRecords, recordCommission, registerReferral, reviewReferral } from "@/lib/portal/broker";
import { convertIntake, submitIntake } from "@/lib/portal/intake";
import { brokerView, capitalView, partnerView, sponsorView } from "@/lib/portal/views";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const NOW = new Date("2026-09-26T12:00:00Z");
const PW = "correct horse 42 battery";

beforeEach(async () => {
  for (const x of [portalAccessLog, ndaAcceptances, dataRoomDocuments, dataRooms, distributionApprovals, commissionEvents, commissionSchedules, referralAgreements, referralRegistrations, brokerProfiles,
    portalGrants, portalSessions, portalInvites, portalUsers, intakeSubmissions, investorQualifications, capitalMatches, capitalOpportunities, bids, procurementPackages, projectUpdates, documents, projects, organizations, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

async function activeUser(email: string, kind: "sponsor" | "capital" | "broker" | "partner", orgId: string | null = null) {
  const { token } = await invitePortalUser(t.db, { mandateId: M, email, name: email, kind, orgId }, "alan", NOW);
  const r = await acceptInvite(t.db, token, PW, NOW);
  if (!r.ok) throw new Error(r.reason);
  return (await t.db.select().from(portalUsers).where(eq(portalUsers.email, email)))[0];
}
async function approvedBroker(email: string, extra: Partial<typeof brokerProfiles.$inferInsert> = {}) {
  const u = await activeUser(email, "broker");
  const [b] = await t.db.insert(brokerProfiles).values({ mandateId: M, portalUserId: u.id, jurisdictions: ["MX"], complianceStatus: "approved", agreementStatus: "signed", agreementExpiresAt: "2027-12-31", ...extra }).returning();
  return { u, b };
}
async function doc(title: string) {
  return (await t.db.insert(documents).values({ mandateId: M, title, category: "financial", url: "https://drive.example/doc" }).returning())[0];
}

describe("portal auth", () => {
  it("invite → password → session; weak passwords refused; wrong password and revoked users cannot sign in", async () => {
    const { token } = await invitePortalUser(t.db, { mandateId: M, email: "Sponsor@Example.com", name: "S", kind: "sponsor" }, "alan", NOW);
    expect(await acceptInvite(t.db, token, "short1", NOW)).toMatchObject({ ok: false });
    const ok = await acceptInvite(t.db, token, PW, NOW);
    expect(ok).toMatchObject({ ok: true, kind: "sponsor" });
    expect(await acceptInvite(t.db, token, PW, NOW)).toMatchObject({ ok: false }); // single use
    const [u] = await t.db.select().from(portalUsers);
    expect(u.passwordHash).toMatch(/^100000\$/);
    expect(await portalSignIn(t.db, "sponsor@example.com", "wrong password 1", NOW)).toBeNull();
    const s = await portalSignIn(t.db, "sponsor@example.com", PW, NOW);
    expect(await portalSessionUser(t.db, s!.session, NOW)).toMatchObject({ email: "sponsor@example.com" });
    await setPortalUserStatus(t.db, u.id, "revoked", "alan", NOW);
    expect(await portalSessionUser(t.db, s!.session, NOW)).toBeNull();
    expect(await portalSignIn(t.db, "sponsor@example.com", PW, NOW)).toBeNull();
    await expect(invitePortalUser(t.db, { mandateId: M, email: "sponsor@example.com", name: "S", kind: "capital" }, "alan", NOW)).rejects.toThrow(/already has a sponsor/);
  });
});

describe("broker security (§93)", () => {
  it("cannot access unapproved deals; approved sees only gate-approved, active, granted opportunities", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "P" }, "alan");
    const [approved, gated] = await t.db.insert(capitalOpportunities).values([
      { mandateId: M, projectId: p.id, title: "Approved", instrument: "project_equity", gateState: "approved", status: "active" },
      { mandateId: M, projectId: p.id, title: "Gate pending", instrument: "project_equity", gateState: "review_required", status: "active" },
    ]).returning();
    const pending = await activeUser("pending@b.com", "broker");
    await t.db.insert(brokerProfiles).values({ mandateId: M, portalUserId: pending.id, complianceStatus: "under_review" });
    for (const o of [approved, gated]) await grantAccess(t.db, { portalUserId: pending.id, entityType: "capital_opportunity", entityId: o.id }, "alan");
    expect(await visibleOpportunities(t.db, pending, NOW)).toEqual([]);
    const { u } = await approvedBroker("ok@b.com");
    for (const o of [approved, gated]) await grantAccess(t.db, { portalUserId: u.id, entityType: "capital_opportunity", entityId: o.id }, "alan");
    expect((await visibleOpportunities(t.db, u, NOW)).map(o => o.title)).toEqual(["Approved"]);
  });

  it("cannot see another broker's referrals or commissions; unapproved cannot open investment materials; expiry removes access", async () => {
    const a = await approvedBroker("a@b.com");
    const b = await approvedBroker("b@b.com");
    await registerReferral(t.db, a.b.id, { targetType: "company", name: "Acme Energy", organization: "Acme Energy" }, NOW);
    const [ag] = await t.db.insert(referralAgreements).values({ mandateId: M, brokerId: a.b.id, title: "A agreement", status: "active", legalReviewStatus: "approved" }).returning();
    const [sch] = await t.db.insert(commissionSchedules).values({ agreementId: ag.id, type: "percentage", rate: 1, approvalStatus: "approved" }).returning();
    await recordCommission(t.db, { brokerId: a.b.id, scheduleId: sch.id, basisAmount: 1_000_000 }, "alan");
    const vb = await brokerView(t.db, b.u, NOW);
    expect(vb.referrals).toEqual([]);
    expect(vb.fees).toEqual([]);
    expect((await brokerView(t.db, a.u, NOW)).fees).toEqual([expect.objectContaining({ amount: 10_000, status: "estimated" })]);
    await expect(recordCommission(t.db, { brokerId: b.b.id, scheduleId: sch.id, basisAmount: 1 }, "alan")).rejects.toThrow(/not found for this introducer/);

    const teaser = await doc("Investor teaser");
    await t.db.insert(distributionApprovals).values({ mandateId: M, documentId: teaser.id, audience: "broker", jurisdictions: ["MX"], complianceStatus: "approved", validUntil: "2027-06-30" });
    await grantAccess(t.db, { portalUserId: a.u.id, entityType: "document", entityId: teaser.id }, "alan");
    expect(await canOpenDocument(t.db, a.u, teaser.id, NOW)).toMatchObject({ allowed: true, url: "https://drive.example/doc" });
    const unapproved = await activeUser("new@b.com", "broker");
    await t.db.insert(brokerProfiles).values({ mandateId: M, portalUserId: unapproved.id, jurisdictions: ["MX"], complianceStatus: "applied" });
    await grantAccess(t.db, { portalUserId: unapproved.id, entityType: "document", entityId: teaser.id }, "alan");
    expect(await canOpenDocument(t.db, unapproved, teaser.id, NOW)).toMatchObject({ allowed: false, url: null, reason: expect.stringContaining("Compliance status: applied") });

    await t.db.update(brokerProfiles).set({ agreementExpiresAt: "2026-09-01" }).where(eq(brokerProfiles.id, a.b.id));
    expect(await expireBrokerRecords(t.db, NOW)).toMatchObject({ agreements: 1 });
    expect(await canOpenDocument(t.db, a.u, teaser.id, NOW)).toMatchObject({ allowed: false });
    expect((await t.db.select().from(portalAccessLog)).filter(l => !l.allowed).length).toBeGreaterThanOrEqual(2);
  });

  it("securities-related material needs a verified licensed role; jurisdiction and dates are enforced", async () => {
    const { u, b } = await approvedBroker("lic@b.com", { roleType: "introducer" });
    const d = await doc("Offering memorandum");
    await grantAccess(t.db, { portalUserId: u.id, entityType: "document", entityId: d.id }, "alan");
    await t.db.insert(distributionApprovals).values({ mandateId: M, documentId: d.id, audience: "broker", securitiesRelated: true, complianceStatus: "approved" });
    expect((await canOpenDocument(t.db, u, d.id, NOW)).reason).toMatch(/verified licensed role/);
    await t.db.update(brokerProfiles).set({ roleType: "licensed_broker", licenseStatus: "verified" }).where(eq(brokerProfiles.id, b.id));
    expect((await canOpenDocument(t.db, u, d.id, NOW)).allowed).toBe(true);
    const d2 = await doc("US-only deck");
    await grantAccess(t.db, { portalUserId: u.id, entityType: "document", entityId: d2.id }, "alan");
    await t.db.insert(distributionApprovals).values({ mandateId: M, documentId: d2.id, audience: "broker", jurisdictions: ["US"], complianceStatus: "approved" });
    expect((await canOpenDocument(t.db, u, d2.id, NOW)).reason).toMatch(/jurisdiction/);
  });

  it("registration runs duplicate, competing-claim, jurisdiction and role checks and never approves itself", async () => {
    const a = await approvedBroker("a@b.com");
    const b = await approvedBroker("b@b.com");
    await t.db.insert(organizations).values({ mandateId: M, name: "Known Fund", nameNormalized: "known fund", source: "other" });
    const clean = await registerReferral(t.db, a.b.id, { targetType: "company", name: "New Developer", organization: "New Developer SA", jurisdiction: "MX" }, NOW);
    expect(clean).toMatchObject({ status: "submitted", conflicts: [] });
    const known = await registerReferral(t.db, a.b.id, { targetType: "investor", name: "Known Fund", organization: "Known Fund", jurisdiction: "US" }, NOW);
    expect(known.status).toBe("conflict_review");
    expect(known.conflicts.map(c => c.kind).sort()).toEqual(["existing_record", "jurisdiction", "role"]);
    await reviewReferral(t.db, clean.id, "approved", "ok", "alan", NOW);
    const second = await registerReferral(t.db, b.b.id, { targetType: "company", name: "New Developer", organization: "New Developer SA" }, NOW);
    expect(second.conflicts.map(c => c.kind)).toContain("competing_claim");
    expect((await t.db.select().from(referralRegistrations).where(eq(referralRegistrations.id, clean.id)))[0].expiresAt).toBe("2027-09-26");
  });

  it("commission estimates respect rate, cap and minimum; approval needs approved schedule, agreement legal review and registration", async () => {
    expect(estimateCommission({ type: "bps", rate: 50, amount: null, cap: 20_000, minimum: null }, 10_000_000)).toBe(20_000);
    expect(estimateCommission({ type: "percentage", rate: 1, amount: null, cap: null, minimum: 5_000 }, 100_000)).toBe(5_000);
    expect(estimateCommission({ type: "custom", rate: null, amount: null, cap: null, minimum: null }, 1)).toBeNull();
    const a = await approvedBroker("a@b.com");
    const [ag] = await t.db.insert(referralAgreements).values({ mandateId: M, brokerId: a.b.id, title: "Draft", status: "active", legalReviewStatus: "pending" }).returning();
    const [sch] = await t.db.insert(commissionSchedules).values({ agreementId: ag.id, type: "fixed", amount: 15_000, approvalStatus: "approved" }).returning();
    const e = await recordCommission(t.db, { brokerId: a.b.id, scheduleId: sch.id, basisAmount: null }, "alan");
    await expect(approveCommission(t.db, e.id, "alan")).rejects.toThrow(/legal review not approved/);
    await t.db.update(referralAgreements).set({ legalReviewStatus: "approved" }).where(eq(referralAgreements.id, ag.id));
    await approveCommission(t.db, e.id, "alan");
    expect((await t.db.select().from(commissionEvents))[0].status).toBe("approved");
  });
});

describe("portal isolation (§94)", () => {
  it("capital cannot open sponsor-only documents; data rooms need the NDA; capital securities material needs a verified qualification", async () => {
    const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "Fund", nameNormalized: "fund", country: "US", source: "other" }).returning();
    const sponsor = await activeUser("s@x.com", "sponsor");
    const capital = await activeUser("c@x.com", "capital", org.id);
    const sponsorOnly = await doc("Sponsor land title");
    await grantAccess(t.db, { portalUserId: sponsor.id, entityType: "document", entityId: sponsorOnly.id }, "alan");
    expect((await canOpenDocument(t.db, sponsor, sponsorOnly.id, NOW)).allowed).toBe(true);
    expect(await canOpenDocument(t.db, capital, sponsorOnly.id, NOW)).toMatchObject({ allowed: false, reason: "No grant" });

    const [room] = await t.db.insert(dataRooms).values({ mandateId: M, name: "Valle DR", audience: "capital", status: "open", ndaRequired: true }).returning();
    const model = await doc("Financial model");
    await t.db.insert(dataRoomDocuments).values({ dataRoomId: room.id, documentId: model.id, folder: "financial", addedBy: "alan" });
    await t.db.insert(distributionApprovals).values({ mandateId: M, documentId: model.id, audience: "capital", securitiesRelated: true, complianceStatus: "approved" });
    await grantAccess(t.db, { portalUserId: capital.id, entityType: "data_room", entityId: room.id, canDownload: true }, "alan");
    expect((await canOpenDocument(t.db, capital, model.id, NOW)).reason).toMatch(/Confidentiality undertaking/);
    await t.db.insert(ndaAcceptances).values({ dataRoomId: room.id, portalUserId: capital.id, ndaVersion: 1, name: "C" });
    expect((await canOpenDocument(t.db, capital, model.id, NOW)).reason).toMatch(/verified investor qualification/);
    await t.db.insert(investorQualifications).values({ mandateId: M, orgId: org.id, jurisdiction: "US", classification: "Qualified institutional buyer", verificationStatus: "professionally_verified", expiresAt: "2027-01-01" });
    expect(await canOpenDocument(t.db, capital, model.id, NOW)).toMatchObject({ allowed: true, download: true });
  });

  it("sponsor view carries counts, not investor identities or internal notes; partner sees only its own bid", async () => {
    const p = await createProject(t.db, { mandateId: M, name: "Valle", description: "INTERNAL: sponsor is slow" }, "alan");
    const sponsor = await activeUser("s@x.com", "sponsor");
    await grantAccess(t.db, { portalUserId: sponsor.id, entityType: "project", entityId: p.id }, "alan");
    const [o] = await t.db.insert(capitalOpportunities).values({ mandateId: M, projectId: p.id, title: "Equity", instrument: "project_equity" }).returning();
    await t.db.insert(capitalMatches).values([
      { opportunityId: o.id, mandateId: M, investorKey: "profile:secret-fund", commercialScore: 80, commercialReasons: ["Secret Fund invests in Mexican solar"], eligibility: "unknown", eligibilityReasons: [], status: "approved_for_outreach" },
    ]);
    await t.db.insert(projectUpdates).values([
      { mandateId: M, projectId: p.id, title: "Published", body: "Grid study done", audiences: ["sponsor"], approvedBy: "alan", publishedAt: "2026-09-20", createdBy: "alan" },
      { mandateId: M, projectId: p.id, title: "Draft", body: "not approved", audiences: ["sponsor"], createdBy: "alan" },
      { mandateId: M, projectId: p.id, title: "Capital only", body: "x", audiences: ["capital"], approvedBy: "alan", publishedAt: "2026-09-21", createdBy: "alan" },
    ]);
    const v = await sponsorView(t.db, sponsor, NOW);
    const json = JSON.stringify(v);
    expect(json).not.toContain("Secret Fund");
    expect(json).not.toContain("INTERNAL");
    expect(v.capital[0].investorsApproached).toBe(1);
    expect(v.updates.map(u => u.title)).toEqual(["Published"]);
    expect((await capitalView(t.db, sponsor, NOW)).opportunities).toEqual([]);

    const [epc1, epc2] = await t.db.insert(organizations).values([{ mandateId: M, name: "EPC One", nameNormalized: "epc one", source: "other" }, { mandateId: M, name: "EPC Two", nameNormalized: "epc two", source: "other" }]).returning();
    const partner = await activeUser("p@x.com", "partner", epc1.id);
    const [pkg] = await t.db.insert(procurementPackages).values({ projectId: p.id, mandateId: M, name: "EPC", category: "epc", stage: "rfp" }).returning();
    await t.db.insert(bids).values([
      { packageId: pkg.id, projectId: p.id, mandateId: M, orgId: epc1.id, bidder: "EPC One", status: "invited" },
      { packageId: pkg.id, projectId: p.id, mandateId: M, orgId: epc2.id, bidder: "EPC Two", status: "received", price: 9_999 },
    ]);
    expect((await partnerView(t.db, partner, NOW)).packages).toEqual([]);
    await grantAccess(t.db, { portalUserId: partner.id, entityType: "procurement_package", entityId: pkg.id }, "alan");
    const pv = await partnerView(t.db, partner, NOW);
    expect(pv.packages[0]).toMatchObject({ open: true, bid: { status: "invited" } });
    expect(JSON.stringify(pv)).not.toContain("9999");
  });

  it("expired and revoked grants stop access", async () => {
    const sponsor = await activeUser("s@x.com", "sponsor");
    const d = await doc("Old");
    await grantAccess(t.db, { portalUserId: sponsor.id, entityType: "document", entityId: d.id, expiresAt: "2026-09-01T00:00:00Z" }, "alan");
    expect((await canOpenDocument(t.db, sponsor, d.id, NOW)).allowed).toBe(false);
  });
});

describe("public intake", () => {
  it("validates, rate-limits per IP and converts a broker into an Applied profile with an invite", async () => {
    expect(await submitIntake(t.db, "broker", { name: "X" }, "ip1", NOW)).toMatchObject({ ok: false, reason: "invalid" });
    const r = await submitIntake(t.db, "broker", { name: "Ana Ruiz", email: "ana@intro.mx", organization: "Intro MX", jurisdictions: "mx, us", licenses: "" }, "ip1", NOW);
    expect(r.ok).toBe(true);
    for (let i = 0; i < 4; i++) await submitIntake(t.db, "capital", { name: "Fund Person", email: `f${i}@fund.com` }, "ip1", NOW);
    expect(await submitIntake(t.db, "capital", { name: "Fund Person", email: "g@fund.com" }, "ip1", NOW)).toMatchObject({ ok: false, reason: "rate" });
    const c = await convertIntake(t.db, r.ok ? r.id : "", M, "alan");
    expect(c.token).toBeTruthy();
    const [b] = await t.db.select().from(brokerProfiles);
    expect(b).toMatchObject({ complianceStatus: "applied", jurisdictions: ["MX", "US"], agreementStatus: "none" });
    const pr = await submitIntake(t.db, "project", { name: "Sponsor Person", email: "s@dev.mx", organization: "Dev MX", projectName: "Yucatán agrivoltaics", country: "MEX" }, "ip2", NOW);
    const pc = await convertIntake(t.db, pr.ok ? pr.id : "", M, "alan");
    expect((await t.db.select().from(projects).where(eq(projects.id, pc.id)))[0]).toMatchObject({ name: "Yucatán agrivoltaics", originationSource: "Public intake" });
  });
});
