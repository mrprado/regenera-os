import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLog, capitalRequirements, claimEvidence, claims, engagements, events, fundingOpportunities, fundingProjectMatches, generatedDocuments, mandates, organizations,
  originationHypotheses, originationItems, projectParties, projectReadiness, projects, projectStageHistory, segments, services, siteIntelRuns, tasks, triggers,
} from "@/db/schema";
import { ensureServices } from "@/lib/commercial/engine";
import { matchFundingToProjects } from "@/lib/funding/project-match";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { buildDossier, capitalPathways, generateHypotheses, proposeDiagnostic, syncOriginationQueue } from "@/lib/origination/engine";
import { createProject } from "@/lib/projects/engine";
import { ENGAGEMENT_PATHS } from "@/lib/vocab";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = REGENERA_MANDATE_ID;
let projectId = "", sponsorId = "";

beforeEach(async () => {
  for (const x of [originationItems, originationHypotheses, tasks, generatedDocuments, engagements, services, fundingProjectMatches, fundingOpportunities, events, auditLog, claimEvidence, claims, capitalRequirements, projectParties, projectReadiness, projectStageHistory, siteIntelRuns, triggers, projects, organizations, segments, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  await ensureServices(t.db, M);
  const [seg] = await t.db.insert(segments).values({ key: "test_developers", name: "Developers", group: "corporate", path: ENGAGEMENT_PATHS[0], sectors: ["energy"], titles: [], practices: [], apolloFilters: {} }).returning();
  const [o] = await t.db.insert(organizations).values({ mandateId: M, name: "Hardap Solar Developer", nameNormalized: "hardap solar developer", source: "other", country: "NAM", segmentId: seg.id, sector: "energy", roles: ["developer"] }).returning();
  sponsorId = o.id;
  const p = await createProject(t.db, { mandateId: M, name: "Hardap 50 MW Solar + BESS", technology: "Solar PV + BESS", country: "NAM", sector: "energy", stage: "screening", capex: 55_000_000, currency: "USD" }, "test");
  projectId = p.id;
  await t.db.insert(projectParties).values({ mandateId: M, projectId, orgId: sponsorId, role: "sponsor", confirmed: "confirmed" });
  await t.db.insert(capitalRequirements).values({ mandateId: M, projectId, purpose: "Development capital", instrument: "development_capital", target: 2_000_000, currency: "USD" });
  await t.db.insert(fundingOpportunities).values({ mandateId: M, source: "worldbank", externalId: "OP1", dedupeKey: "op1", title: "Renewable energy project preparation facility", funder: "World Bank-financed project", type: "grant", url: "https://example.org/op1", status: "open", deadline: "2099-12-31", countries: ["Namibia"], sectors: ["energy"], applicantTypes: ["Businesses"], amountMax: 3_000_000, currency: "USD" });
  await t.db.insert(fundingOpportunities).values({ mandateId: M, source: "grants_gov", externalId: "G1", dedupeKey: "g1", title: "US rural water grants", type: "grant", url: "https://example.org/g1", status: "open", deadline: "2099-12-31", countries: ["United States"], sectors: ["water_food_nature"] });
});

describe("Test A — capital first: real funding record → eligibility → dossier → proposal draft → CRM task", () => {
  it("persists hard-gate eligibility with checks and questions; the US-only call is not matched", async () => {
    await matchFundingToProjects(t.db, M, new Date("2026-10-08"));
    const ms = await t.db.select().from(fundingProjectMatches);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ eligibility: "eligible", capitalStage: "development" });
    expect(ms[0].checks!.find(c => c.rule === "Applicant type")).toMatchObject({ result: "pass" });
    expect(ms[0].checks!.find(c => c.rule === "Ticket size")).toMatchObject({ result: "pass" });
  });

  it("drafts a proposal: engagement + proposal document with outreach draft + approval task; nothing is sent", async () => {
    await matchFundingToProjects(t.db, M, new Date("2026-10-08"));
    await syncOriginationQueue(t.db, M);
    const r = await proposeDiagnostic(t.db, projectId, "owner@test");
    const [e] = await t.db.select().from(engagements).where(eq(engagements.id, r.engagementId));
    expect(e.status).toBe("prospect");
    const docs = await t.db.select().from(generatedDocuments);
    expect(docs.map(d => d.templateKey).sort()).toEqual(["diagnostic_proposal", "origination_dossier"]);
    expect(docs.find(d => d.templateKey === "diagnostic_proposal")!.body).toMatch(/FOR APPROVAL — not sent/);
    expect((await t.db.select().from(tasks)).some(x => x.title.startsWith("Approve proposal and outreach"))).toBe(true);
    const [item] = await t.db.select().from(originationItems).where(eq(originationItems.projectId, projectId));
    expect(item).toBeTruthy();
  });
});

describe("Test B — project first: readiness gaps and viable / ineligible capital pathways saved on the record", () => {
  it("scores with insufficient data, never favourable, and lists pathways by capital stage", async () => {
    const d = await buildDossier(t.db, projectId, "test");
    expect(d.readiness.reading).toBe("insufficient_evidence");
    expect(d.readiness.template).toBe("solar_bess");
    const paths = capitalPathways("NAM", "development");
    expect(paths.some(p => p.viable)).toBe(true);
    expect(paths.some(p => !p.viable && p.reasons.some(x => x.startsWith("Does not list")))).toBe(true);
    const [doc] = await t.db.select().from(generatedDocuments).where(eq(generatedDocuments.id, d.documentId));
    expect(doc.body).toMatch(/Not viable now/);
    expect(doc.body).toMatch(/Proximity to grid is not interconnection capacity/);
  });

  it("caps a 'ready' status without evidence at 1", async () => {
    await t.db.update(projectReadiness).set({ status: "ready" }).where(eq(projectReadiness.projectId, projectId));
    const d = await buildDossier(t.db, projectId, "test");
    const land = d.readiness.dims.find(x => x.dimension === "land")!;
    expect(land).toMatchObject({ score: 1, capped: true });
  });
});

describe("Test C — market first: clustered signals → labelled hypothesis queued for validation", () => {
  it("forms a hypothesis from three signals, never a project", async () => {
    for (let i = 0; i < 3; i++) await t.db.insert(triggers).values({ mandateId: M, orgId: sponsorId, type: "project", summary: `Namibia solar tender ${i}`, country: "Namibia", source: "worldbank", sourceUrl: `https://example.org/t${i}`, eventDate: "2026-10-01", suggestedEngagement: JSON.stringify({ sectors: ["energy"] }) });
    const r = await generateHypotheses(t.db, M, new Date());
    expect(r.created).toBe(1);
    const [h] = await t.db.select().from(originationHypotheses);
    expect(h.thesis).toMatch(/HYPOTHESIS/);
    expect(h.counterparts.map(c => c.name)).toContain("Hardap Solar Developer");
    const before = (await t.db.select().from(projects)).length;
    await syncOriginationQueue(t.db, M);
    expect((await t.db.select().from(projects)).length).toBe(before);
    expect((await t.db.select().from(originationItems)).some(x => x.entrance === "market_first" && x.title.startsWith("HYPOTHESIS"))).toBe(true);
    // Idempotent: a second run does not duplicate.
    expect((await generateHypotheses(t.db, M, new Date())).created).toBe(0);
  });
});

describe("Test F — reliability: repeated syncs do not duplicate", () => {
  it("queue and matches are idempotent", async () => {
    await matchFundingToProjects(t.db, M, new Date("2026-10-08"));
    await matchFundingToProjects(t.db, M, new Date("2026-10-08"));
    await syncOriginationQueue(t.db, M);
    const n = (await t.db.select().from(originationItems)).length;
    await syncOriginationQueue(t.db, M);
    expect((await t.db.select().from(originationItems)).length).toBe(n);
    expect((await t.db.select().from(fundingProjectMatches)).length).toBe(1);
  });
});
