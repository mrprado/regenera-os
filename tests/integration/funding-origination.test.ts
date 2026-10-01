// Funding-to-client acceptance (phase 11 §66–69) against real local D1: open call → profile → applicant → prospect
// (deduplicated org, client opportunity) → outreach draft in the approval queue → discovery → diagnostic → bid /
// no-bid with explicit economics → application with workplan and consortium → human approval → recorded submission →
// award → capital-stack pathway (once) and post-award engagement → funding-originated revenue.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activities, applicationTasks, auditLog, bidReviews, capitalStackLayers, capitalStructures, consortiumMembers, contacts, deals, engagements, fundingApplications, fundingAwards, fundingDates,
  fundingOpportunities, fundingPathways, fundingProspects, fundingReadiness, mandates, messages, organizations, projects, services, tasks,
} from "@/db/schema";
import { createProject } from "@/lib/projects/engine";
import { createStructure } from "@/lib/capital/stack";
import {
  addMember, addProspect, advanceApplication, applicantCandidates, applicationGaps, buildProfile, createApplication, decideBid, draftOutreach, findOrCreateOrg, logTouch, opportunityToPathway,
  pathwayToStack, proposeDiagnostic, recordAward, saveBidReview, saveReadiness, seniorApprove, setProspectStage,
} from "@/lib/funding/pipeline";
import { originatedValue } from "@/lib/funding/origination";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera", U = "founder@regenera.bio", R = "pm@regenera.bio";
let oppId = "", orgId = "";

beforeEach(async () => {
  for (const x of [applicationTasks, consortiumMembers, fundingDates, fundingAwards, fundingApplications, bidReviews, fundingReadiness, fundingProspects, capitalStackLayers, capitalStructures, fundingPathways, messages, tasks, activities, deals, engagements, services, contacts, fundingOpportunities, organizations, projects, auditLog, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  const [o] = await t.db.insert(fundingOpportunities).values({
    mandateId: M, source: "grants_gov", externalId: "EPA-1", dedupeKey: "epa", title: "EPA Water Workforce Program", funder: "EPA", type: "grant", amountMax: 1_000_000, currency: "USD",
    deadline: "2027-01-30", countries: ["United States"], applicantTypes: ["Water utilities", "Municipal governments", "Community colleges", "Nonprofits"], sectors: ["water_food_nature"],
    url: "https://www.grants.gov/x", description: "Workforce training for the water sector with employer partnerships and placement outcomes.", fit: 12,
    details: { requiredPartners: ["university", "workforce provider"] },
  }).returning();
  oppId = o.id;
  const [org] = await t.db.insert(organizations).values({ mandateId: M, name: "Metro Water Utility District", nameNormalized: "metro water utility district", country: "United States", location: "Denver, Colorado", sector: "water_food_nature", industry: "Water utility", source: "other" }).returning();
  orgId = org.id;
  await t.db.insert(contacts).values({ mandateId: M, orgId, firstName: "Ana", lastName: "Ruiz", fullName: "Ana Ruiz", nameNormalized: "ana ruiz", title: "General Manager", email: "ana@metrowater.example", emailLower: "ana@metrowater.example", source: "other" });
});

describe("funding → client", () => {
  it("runs the whole origination path without claiming eligibility or submitting for anyone", async () => {
    const profile = await buildProfile(t.db, oppId, U);
    expect(profile.basis).toBe("inferred");

    const cands = await applicantCandidates(t.db, oppId);
    expect(cands[0].org.id).toBe(orgId);
    expect(cands[0].decisionMaker?.name).toBe("Ana Ruiz");
    expect(cands[0].match.eligibility).toBe("likely");

    // External prospect dedupes against the CRM by normalized name.
    expect((await findOrCreateOrg(t.db, M, { name: "Metro Water Utility District" }, U)).created).toBe(false);
    await expect(addProspect(t.db, { opportunityId: oppId, orgId, eligibility: "confirmed" }, U)).rejects.toThrow(/basis/);
    const { prospect } = await addProspect(t.db, { opportunityId: oppId, orgId, eligibility: "likely", rationale: cands[0].rationale }, U);
    expect((await addProspect(t.db, { opportunityId: oppId, orgId }, U)).created).toBe(false);
    const [eng] = await t.db.select().from(engagements).where(eq(engagements.id, prospect.engagementId!));
    expect(eng).toMatchObject({ entryPoint: "funding", originOpportunityId: oppId, status: "prospect" });

    const out = await draftOutreach(t.db, prospect.id, U);
    expect(out.ok).toBe(true);
    const [msg] = await t.db.select().from(messages);
    expect(msg.status).toBe("pending_approval");
    expect(msg.body).not.toMatch(/get you this grant/i);

    await logTouch(t.db, prospect.id, "outreach", U, {});
    await logTouch(t.db, prospect.id, "discovery", U, { date: "2026-10-20" });
    expect((await t.db.select().from(fundingProspects))[0].stage).toBe("discovery");
    await setProspectStage(t.db, prospect.id, "qualified", U);

    const engagementId = await proposeDiagnostic(t.db, prospect.id, U);
    const [dx] = await t.db.select().from(engagements).where(eq(engagements.id, engagementId));
    expect(dx).toMatchObject({ fee: 7500, fundingLine: "diagnostic", feeBasis: "fixed", status: "proposal" });
    await setProspectStage(t.db, prospect.id, "diagnostic_won", U);

    await saveReadiness(t.db, { opportunityId: oppId, orgId, prospectId: prospect.id, cells: { eligibility: { status: "ready", note: "Utility listed as eligible", source: "Call §C.1" } } }, U);
    const [rd] = await t.db.select().from(fundingReadiness);
    expect(rd.cells.timing.source).toBe("call deadline");

    // Bid / no-bid with economics; ≥ 25k needs senior approval first; AI cannot decide.
    const bidId = await saveBidReview(t.db, { opportunityId: oppId, prospectId: prospect.id, applicantOrgId: orgId, strategicFit: "Water workforce, core sector", eligibility: "likely", readinessSummary: "Incomplete: consortium", hours: 0, specialists: ["workforce"], fee: 30000, feeBasis: "milestone", costLines: [{ role: "analyst", hours: 40, rate: 45 }, { role: "proposal_manager", hours: 35, rate: 95 }, { role: "sme", hours: 12, rate: 150 }], otherCost: 500, relationshipValue: "Utility with a capital plan", crossSell: "Capital planning", risks: "University partner missing", opportunityCost: "" }, U);
    const [br] = await t.db.select().from(bidReviews);
    expect(br).toMatchObject({ deliveryCost: 1800 + 3325 + 1800 + 500, seniorApprovalRequired: true });
    await expect(decideBid(t.db, bidId, "bid", "claude:agent")).rejects.toThrow(/person/);
    await expect(decideBid(t.db, bidId, "bid", U)).rejects.toThrow(/senior approval/);
    await seniorApprove(t.db, bidId, R);
    await decideBid(t.db, bidId, "bid", U);

    const project = await createProject(t.db, { mandateId: M, name: "Metro Water Workforce Center", country: "United States" }, U);
    const app = await createApplication(t.db, { opportunityId: oppId, leadOrgId: orgId, projectId: project.id, engagementId, bidReviewId: bidId }, U, new Date("2026-10-01T12:00:00Z"));
    const plan = await t.db.select().from(applicationTasks).where(eq(applicationTasks.applicationId, app.id));
    expect(plan.length).toBe(14);
    expect(plan.find(x => x.title === "Eligibility confirmation")!.dependsOn).toBe(plan.find(x => x.title === "Program interpretation")!.id);
    expect((await t.db.select().from(fundingDates)).map(d => d.kind).sort()).toEqual(["deadline", "draft", "review"]);

    let gaps = await applicationGaps(t.db, app.id);
    expect(gaps.map(g => g.status)).toEqual(["confirmed", "missing", "missing"]);
    await addMember(t.db, app.id, { name: "Front Range Community College", role: "research", capability: "university workforce programs" }, U);
    gaps = await applicationGaps(t.db, app.id);
    expect(gaps[1]).toMatchObject({ requirement: "university", status: "in_discussion" });

    // Review ladder: one step at a time; approval needs a person and a finished workplan; submission is recorded, never automatic.
    await expect(advanceApplication(t.db, app.id, "commercial_review", U)).rejects.toThrow(/one review step/);
    for (const s of ["technical_review", "commercial_review", "compliance_review", "senior_review", "client_review", "final_qa"] as const) await advanceApplication(t.db, app.id, s, U);
    await expect(advanceApplication(t.db, app.id, "approved", U)).rejects.toThrow(/workplan/);
    await t.db.update(applicationTasks).set({ status: "done" });
    await t.db.update(applicationTasks).set({ status: "todo" }).where(eq(applicationTasks.title, "Submission"));
    await expect(advanceApplication(t.db, app.id, "approved", "ai:drafter")).rejects.toThrow(/person/);
    await advanceApplication(t.db, app.id, "approved", U);
    await expect(advanceApplication(t.db, app.id, "submitted", U, "", {})).rejects.toThrow(/confirmation/);
    await advanceApplication(t.db, app.id, "submitted", R, "", { portal: "Grants.gov", confirmationId: "GRANT1234" });
    const [sub] = await t.db.select().from(fundingApplications);
    expect(sub.submission).toMatchObject({ portal: "Grants.gov", confirmationId: "GRANT1234", submittedBy: R });

    const award = await recordAward(t.db, app.id, { amount: 850_000, agreementRef: "EPA-AG-1", reporting: [{ label: "Q1 report", due: "2027-07-15" }], milestones: [{ label: "Cohort 1 enrolled", due: "2027-09-01" }], postAward: true, monthlyFee: 8000 }, U);
    expect(award.pathwayId).toBeTruthy();
    expect(award.engagementId).toBeTruthy();

    const s = await createStructure(t.db, project.id, "Base case", U);
    expect((await pathwayToStack(t.db, award.pathwayId!, s.id, U)).added).toBe(true);
    expect((await pathwayToStack(t.db, award.pathwayId!, s.id, U)).added).toBe(false);
    expect((await t.db.select().from(capitalStackLayers).where(eq(capitalStackLayers.structureId, s.id))).filter(l => l.amount === 850_000)).toHaveLength(1);

    const all = await t.db.select().from(engagements);
    await t.db.update(engagements).set({ status: "complete" }).where(eq(engagements.id, engagementId));
    const value = originatedValue((await t.db.select().from(engagements)).map(e => ({ ...e, status: e.id === award.engagementId ? "active" : e.status })));
    expect(all.length).toBe(2);
    expect(value[0]).toMatchObject({ orgId, engagements: 2 });
    expect(value[0].total).toBeGreaterThan(7500);
  });

  it("client-first: a call becomes a project pathway once", async () => {
    const project = await createProject(t.db, { mandateId: M, name: "Canal restoration", country: "United States" }, U);
    expect((await opportunityToPathway(t.db, oppId, project.id, U)).created).toBe(true);
    expect((await opportunityToPathway(t.db, oppId, project.id, U)).created).toBe(false);
  });
});
