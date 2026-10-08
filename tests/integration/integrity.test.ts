// Phase 23 acceptance (Origination & Integrity Engine) against real local D1: source record → screening decision with
// seven readings → pathways → next action; protected-area overlap → redesign; exclusion blocks proposals; capital-first
// gates; waste-to-energy conditional; restoration; policy versioning; owner override with reason; fee independence.
import * as turf from "@turf/turf";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLog, capitalRequirements, claimEvidence, claims, engagements, events, fundingOpportunities, fundingProjectMatches, generatedDocuments, impactRecords, integrityFindings, mandates, organizations,
  originationHypotheses, originationItems, originationPolicies, policyDecisions, projectParties, projectReadiness, projects, projectStageHistory, providerCalls, redesignScenarios, services,
  siteIntelRuns, sourceCache, stewardshipObligations, systemState, tasks,
} from "@/db/schema";
import { ensureServices } from "@/lib/commercial/engine";
import { matchFundingToProjects } from "@/lib/funding/project-match";
import { clearIntegrationCache } from "@/lib/integrations/engine";
import { overrideDecision, screenProject } from "@/lib/integrity/engine";
import { IntegrityBlocked } from "@/lib/integrity/gate";
import { POLICY_V1 } from "@/lib/integrity/policy";
import { generateScenarios } from "@/lib/integrity/redesign";
import { completeObligation, stewardshipDue } from "@/lib/integrity/stewardship";
import { processWbProject } from "@/lib/intel/wb-projects";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { capitalPathways, proposeDiagnostic, syncOriginationQueue } from "@/lib/origination/engine";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = REGENERA_MANDATE_ID;

// Constraint fixtures (instead of a live Overpass call): a protected polygon around (17.05, -23.95).
const park = turf.polygon([[[17, -24], [17.1, -24], [17.1, -23.9], [17, -23.9], [17, -24]]]);
const withPark = async () => ({ layers: { protected: turf.featureCollection([park]) }, source: "fixture: protected area" });
const empty = async () => ({ layers: {}, source: "fixture: no constraints" });

const WB = { id: "P171750", project_name: "Rooftop Solar Program", countrycode: ["NA"], totalamt: "150,000,000", boardapprovaldate: "2022-06-28T00:00:00Z", status: "Active", borrower: "Ministry of Finance", impagency: "NamPower", lendinginstr: "Investment Project Financing", sector1: { Name: "Renewable Energy Solar" }, url: "https://projects.worldbank.org/en/projects-operations/project-detail/P171750" };
const fakeFetch = (async (url: string) => {
  if (String(url).includes("nominatim")) return new Response(JSON.stringify([{ lat: "-22.9", lon: "18.4", display_name: "Namibia", address: { country_code: "na" } }]), { status: 200 });
  return new Response(JSON.stringify({ total: "1", projects: { [WB.id]: WB } }), { status: 200 });
}) as typeof fetch;

const site = (name: string, technology: string, lng = 17.05, lat = -23.95, extra: Partial<typeof projects.$inferInsert> = {}) =>
  createProject(t.db, { mandateId: M, name, technology, country: "NAM", sector: "energy", stage: "screening", lat, lng, locationPrecision: "site", capex: 40_000_000, currency: "USD", ...extra }, "test");

beforeEach(async () => {
  for (const x of [stewardshipObligations, impactRecords, redesignScenarios, integrityFindings, policyDecisions, originationPolicies, originationItems, originationHypotheses, tasks, generatedDocuments, engagements, services,
    fundingProjectMatches, fundingOpportunities, events, auditLog, claimEvidence, claims, capitalRequirements, projectParties, projectReadiness, projectStageHistory, siteIntelRuns, projects, organizations, providerCalls, sourceCache, systemState, mandates]) await t.db.delete(x);
  clearIntegrationCache();
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  await ensureServices(t.db, M);
});

describe("Test 1 — public source → record → integrity readings → pathways → next action", () => {
  it("a World Bank solar record is screened honestly: country-level location means insufficient evidence, with seven readings", async () => {
    expect(await processWbProject(t.db, WB, new Date(), fakeFetch)).toBe("created");
    const [p] = await t.db.select().from(projects);
    const d = await screenProject(t.db, p.id, "test", { constraints: empty });
    expect(d.classification).toBe("regenerative_core");
    expect(d.state).toBe("insufficient_evidence");
    expect(d.readings).toHaveLength(7);
    expect(d.outstanding.join(" ")).toMatch(/Site location/);
    expect(d.policyVersion).toBe(1);
    expect(capitalPathways(p.country, "development").some(x => x.viable)).toBe(true);
    await syncOriginationQueue(t.db, M);
    const [item] = await t.db.select().from(originationItems).where(eq(originationItems.projectId, p.id));
    expect(item.serviceReason).toMatch(/integrity: insufficient evidence/);
    expect(item.nextAction).toBeTruthy();
    expect((await t.db.select().from(events)).some(e => e.type === "INTEGRITY_SCREENED")).toBe(true);
  });
});

describe("Test 2 — spatial constraint and exclusion gates", () => {
  it("protected-area overlap → redesign required, with remediation and redesign scenarios", async () => {
    const p = await site("Hardap Solar", "Solar PV");
    const d = await screenProject(t.db, p.id, "test", { constraints: withPark });
    expect(d.state).toBe("redesign_required");
    expect(d.remediation.join(" ")).toMatch(/protected area/);
    const fs = await t.db.select().from(integrityFindings).where(eq(integrityFindings.decisionId, d.id));
    expect(fs.some(f => f.domain === "biodiversity" && f.provenance === "third_party")).toBe(true);
    const g = await generateScenarios(t.db, p.id, "test");
    expect(g.method).toBe("renewable");
    const sc = await t.db.select().from(redesignScenarios).where(eq(redesignScenarios.projectId, p.id));
    expect(sc.map(s => s.variant).sort()).toEqual(["lower_impact", "original", "regenerative"]);
    expect(sc.every(s => s.status === "draft")).toBe(true);
  });

  it("an excluded project cannot receive a proposal and has no service or value in the queue", async () => {
    const p = await site("Coal-fired expansion", "Coal-fired power station", 18, -22);
    const d = await screenProject(t.db, p.id, "test", { constraints: empty });
    expect(d.state).toBe("excluded");
    await expect(proposeDiagnostic(t.db, p.id, "owner@test")).rejects.toBeInstanceOf(IntegrityBlocked);
    await syncOriginationQueue(t.db, M);
    const [item] = await t.db.select().from(originationItems).where(eq(originationItems.projectId, p.id));
    expect(item).toMatchObject({ recommendedService: null, expectedValueUsd: null });
    expect(item.nextAction).toMatch(/Integrity/);
    expect(await t.db.select().from(engagements)).toHaveLength(0);
  });
});

describe("Test 3 — capital first: hard gates", () => {
  it("open Namibia call matches; US-only and closed calls never become active matches", async () => {
    const p = await site("Hardap Solar", "Solar PV", 18, -22);
    await t.db.insert(capitalRequirements).values({ mandateId: M, projectId: p.id, purpose: "Development capital", instrument: "development_capital", target: 2_000_000, currency: "USD" });
    const base = { mandateId: M, type: "grant" as const, url: "https://example.org", sectors: ["energy"], applicantTypes: ["Businesses"], amountMax: 3_000_000, currency: "USD" };
    await t.db.insert(fundingOpportunities).values([
      { ...base, source: "worldbank", externalId: "A", dedupeKey: "a", title: "Renewable preparation facility", status: "open", deadline: "2099-12-31", countries: ["Namibia"] },
      { ...base, source: "grants_gov", externalId: "B", dedupeKey: "b", title: "US rural energy", status: "open", deadline: "2099-12-31", countries: ["United States"] },
      { ...base, source: "worldbank", externalId: "C", dedupeKey: "c", title: "Closed Namibia call", status: "closed", deadline: "2026-01-01", countries: ["Namibia"] },
    ]);
    await matchFundingToProjects(t.db, M, new Date("2026-10-08"));
    const ms = await t.db.select({ title: fundingOpportunities.title, e: fundingProjectMatches.eligibility }).from(fundingProjectMatches).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingProjectMatches.opportunityId));
    expect(ms.map(m => m.title)).toEqual(["Renewable preparation facility"]);
  });
});

describe("Test 4 — waste-to-energy is conditional, never regenerative by default", () => {
  it("names the evidence needed and routes to enhanced due diligence", async () => {
    const p = await site("Windhoek WtE", "Municipal waste-to-energy incineration", 18, -22, { sector: null });
    const d = await screenProject(t.db, p.id, "test", { constraints: empty });
    expect(d.classification).toBe("conditional_redesign");
    expect(d.state).toBe("enhanced_due_diligence");
    expect(d.outstanding).toEqual(expect.arrayContaining(["Evidence: feedstock", "Evidence: emissions", "Evidence: residues", "Evidence: technology"]));
  });
});

describe("Test 5 — restoration inside a protected area", () => {
  it("is regenerative core with a positive finding, not a redesign", async () => {
    const p = await site("Kuiseb watershed restoration", "Watershed restoration and agroforestry", 17.05, -23.95, { sector: "water_food_nature" });
    const d = await screenProject(t.db, p.id, "test", { constraints: withPark });
    expect(d.classification).toBe("regenerative_core");
    expect(d.state).not.toBe("redesign_required");
    const fs = await t.db.select().from(integrityFindings).where(eq(integrityFindings.decisionId, d.id));
    expect(fs.some(f => f.kind === "positive")).toBe(true);
  });
});

describe("governance", () => {
  it("a new policy version never rewrites earlier decisions", async () => {
    const p = await site("Hardap Solar", "Solar PV", 18, -22);
    const d1 = await screenProject(t.db, p.id, "test", { constraints: empty });
    await t.db.insert(originationPolicies).values({ version: 2, name: "v2", rules: { ...POLICY_V1, protectedNearKm: 5 } as unknown as Record<string, unknown>, publishedBy: "owner@test" });
    const d2 = await screenProject(t.db, p.id, "test", { constraints: empty });
    expect(d2.policyVersion).toBe(2);
    const [old] = await t.db.select().from(policyDecisions).where(eq(policyDecisions.id, d1.id));
    expect(old).toMatchObject({ policyVersion: 1, state: d1.state, current: false });
    expect((await t.db.select().from(policyDecisions).where(and(eq(policyDecisions.projectId, p.id), eq(policyDecisions.current, true))))).toHaveLength(1);
  });

  it("leaving an exclusion needs a documented reason; the override is audited and lifts the gate", async () => {
    const p = await site("Coal-fired expansion", "Coal-fired power station", 18, -22);
    await screenProject(t.db, p.id, "test", { constraints: empty });
    await expect(overrideDecision(t.db, p.id, "enhanced_due_diligence", "ok", "owner@test")).rejects.toThrow(/reason/);
    const o = await overrideDecision(t.db, p.id, "enhanced_due_diligence", "Record text was wrong: the project retires a coal unit and replaces it with solar", "owner@test");
    expect(o.overrides).toHaveLength(1);
    expect((await t.db.select().from(auditLog)).some(a => a.action === "integrity.override")).toBe(true);
    await expect(proposeDiagnostic(t.db, p.id, "owner@test")).resolves.toBeTruthy();
  });

  it("fee and capex potential do not change the integrity decision", async () => {
    const a = await site("Solar A", "Solar PV", 17.05, -23.95, { capex: 5_000_000 });
    const b = await site("Solar B", "Solar PV", 17.05, -23.95, { capex: 900_000_000 });
    const da = await screenProject(t.db, a.id, "test", { constraints: withPark });
    const db2 = await screenProject(t.db, b.id, "test", { constraints: withPark });
    expect([da.state, da.classification]).toEqual([db2.state, db2.classification]);
  });

  it("stewardship: overdue obligations create a task; completing a recurring one rolls it forward", async () => {
    const p = await site("Hardap Solar", "Solar PV", 18, -22);
    const [o] = await t.db.insert(stewardshipObligations).values({ mandateId: M, projectId: p.id, title: "Annual biodiversity monitoring", kind: "monitoring", dueAt: "2026-01-01T00:00:00.000Z", recurrenceMonths: 12, createdBy: "test" }).returning();
    expect((await stewardshipDue(t.db, new Date("2026-10-08"))).overdue).toBe(1);
    expect((await t.db.select().from(tasks)).some(x => x.title.includes("Annual biodiversity monitoring"))).toBe(true);
    await completeObligation(t.db, o.id, "Survey report v1", "test");
    const all = await t.db.select().from(stewardshipObligations).where(eq(stewardshipObligations.projectId, p.id));
    expect(all.map(x => x.status).sort()).toEqual(["done", "open"]);
    expect(all.find(x => x.status === "open")!.dueAt!.slice(0, 10)).toBe("2027-01-01");
  });
});
