// Funding origination, pure part (phase 11): readiness without scores, evidence flags instead of award odds,
// ideal applicant profile, economics, capacity warnings, hiring guidance, scenarios, stack double counting, positioning.
import { describe, expect, it } from "vitest";
import {
  blankReadiness, capacityWarnings, consortiumGaps, contingentWarning, deliveryEconomics, evidenceFlags, funnel, hiringGuidance, inferredProfile, kindOf, originatedValue, pathwaysToAdd,
  plannedVsActual, profileMatch, readinessSummary, runScenario, SCENARIO_TEMPLATES, timingCell, weekCapacity,
} from "@/lib/funding/origination";
import { promiseIssues } from "@/lib/funding/vocab";
import { outreachText } from "@/lib/funding/pipeline";

describe("readiness", () => {
  it("headline is the worst state, with no percentage, and 'ready' needs a source", () => {
    const cells = { ...blankReadiness(), eligibility: { status: "ready", note: "", source: "" }, timing: { status: "blocked", note: "", source: "deadline" } };
    const s = readinessSummary(cells);
    expect(s.headline).toBe("blocked");
    expect(s.holding).toEqual(["timing"]);
    expect(s.unsourced).toEqual(["eligibility"]);
    expect(JSON.stringify(s)).not.toMatch(/%|score/);
    expect(readinessSummary(blankReadiness()).headline).toBe("unknown");
  });
  it("timing is derived from the deadline", () => {
    expect(timingCell("2026-10-05", "2026-10-01").status).toBe("blocked");
    expect(timingCell("2026-10-20", "2026-10-01").status).toBe("ready_conditions");
    expect(timingCell("2026-12-20", "2026-10-01").status).toBe("ready");
    expect(timingCell(null, "2026-10-01").status).toBe("unknown");
  });
});

describe("no award-probability theater", () => {
  it("flags are categorical", () => {
    expect(evidenceFlags({ deadlineDays: 10, eligibilityConfirmed: false, missingEvidence: 2, consortiumGaps: 1, matchGap: true, registrationGaps: 0 })).toEqual(["missing_evidence", "deadline_risk", "partner_gap", "match_gap"]);
  });
  it("positioning never promises an award", () => {
    expect(promiseIssues("We can get you this grant.")).toHaveLength(1);
    expect(promiseIssues("It's basically free money")).toHaveLength(1);
    const t = outreachText({ first: "Ana", orgName: "Metro Water", title: "Water Workforce Program", funder: "EPA", deadline: "2026-12-01" });
    expect(promiseIssues(`${t.subject} ${t.body}`)).toEqual([]);
    expect(t.body).toMatch(/funding pathway that appears aligned/);
  });
});

describe("ideal applicant profile", () => {
  const o = { applicantTypes: ["Water utilities", "Municipal governments", "Community colleges", "Nonprofits with 501(c)(3) status"], countries: ["United States"], sectors: ["water_food_nature"], description: "Workforce training with employer partnerships and placement outcomes.", cofinancingPct: null, details: {}, read: null };
  it("reads entity classes and titles from the call metadata, labelled inferred", () => {
    const p = inferredProfile(o, "a@regenera.bio");
    expect(p.basis).toBe("inferred");
    expect(p.entityClasses).toEqual(expect.arrayContaining(["Utility", "Municipality", "Nonprofit", "University / college"]));
    expect(p.capabilities).toContain("Workforce training delivery");
    expect(p.decisionMakerTitles).toContain("General manager");
  });
  it("matches organizations dimension by dimension and never claims eligibility", () => {
    const p = inferredProfile(o, "a");
    const m = profileMatch(p, { name: "Metro Water Utility District", country: "United States", location: "Denver", sector: "water_food_nature", industry: "Water utility", description: null });
    expect(m).toMatchObject({ classMatch: "match", geo: "match", sector: "match", eligibility: "likely" });
    expect(profileMatch(p, { name: "Acme", country: null, location: null, sector: null, industry: null, description: null }).eligibility).toBe("uncertain");
  });
});

describe("economics", () => {
  it("diagnostic example: fee 7,500, direct cost 2,800 → GP 4,700, GM 62.7%", () => {
    const e = deliveryEconomics({ fee: 7500, lines: [{ role: "analyst", hours: 20, rate: 40 }, { role: "proposal_manager", hours: 5, rate: 100 }, { role: "lead", hours: 5, rate: 200 }, { role: "sme", hours: 2.5, rate: 200 }] });
    expect(e.cost).toBe(2800);
    expect(e.grossProfit).toBe(4700);
    expect(e.grossMarginPct).toBe(62.7);
    expect(e.effectiveRate).toBe(230.77);
  });
  it("planned vs actual flags people without a cost rate", () => {
    const r = plannedVsActual({ fee: 1000, budget: [{ role: "analyst", hours: 10, rate: 40 }], time: [{ person: "a@x", hours: 12 }, { person: "b@x", hours: 1 }], rates: new Map([["a@x", 40]]), otherCost: 0 });
    expect(r.actual.cost).toBe(480);
    expect(r.unratedPeople).toEqual(["b@x"]);
    expect(r.hoursVariance).toBe(3);
  });
  it("contingent fees always carry the legal / program review flag", () => {
    expect(contingentWarning("fixed", "grant")).toBeNull();
    expect(contingentWarning("contingent", "grant")).toMatch(/LEGAL \/ PROGRAM REVIEW REQUIRED/);
    expect(contingentWarning("contingent", "tender")).toMatch(/Procurement/);
  });
});

describe("capacity", () => {
  const m = { id: "pm", name: "Pat", role: "proposal_manager", weeklyHours: 40, utilizationTarget: 80, leave: [{ from: "2026-10-08", to: "2026-10-09" }] };
  it("leave reduces availability and utilization is allocated / available", () => {
    const c = weekCapacity(m, [{ memberId: "pm", weekStart: "2026-10-05", hours: 29, kind: "client" }], "2026-10-05");
    expect(c.available).toBe(24);
    expect(c.utilizationPct).toBe(120.8);
  });
  it("warns over target, on role saturation and on deadline clusters", () => {
    const w = capacityWarnings([m], [{ memberId: "pm", weekStart: "2026-10-12", hours: 37, kind: "client" }], ["2026-10-12"], [{ date: "2026-10-13", label: "a" }, { date: "2026-10-14", label: "b" }, { date: "2026-10-16", label: "c" }]);
    expect(w.map(x => x.key)).toEqual(["util:pm:2026-10-12", "role:proposal_manager:2026-10-12", "cluster:2026-10-12"]);
  });
  it("hiring guidance follows the utilization bands", () => {
    expect(hiringGuidance([20, 25]).guidance).toMatch(/contract/);
    expect(hiringGuidance([45, 50]).guidance).toMatch(/fractional/);
    expect(hiringGuidance(Array(12).fill(70)).guidance).toMatch(/full-time/);
  });
});

describe("scenarios", () => {
  it("computes revenue, cost, margin and staffing from inputs", () => {
    const r = runScenario(SCENARIO_TEMPLATES.base);
    expect(r.revenue).toBe(2 * 12 * 7500 + 10 * 30000 + 2 * 75000 + 3 * 12 * 6000 + 2 * 12 * 10000 + 4 * 24000 + 3 * 30000);
    expect(r.grossMarginPct).not.toBeNull();
    expect(r.fteNeeded).toBeGreaterThan(0);
  });
});

describe("capital stack", () => {
  it("never double counts a pathway already in the stack", () => {
    const add = pathwaysToAdd([{ id: "L1", layer: "grant", amount: 10, source: "" }], [
      { id: "P1", name: "in stack", sourceType: "grant", amount: 10, status: "approved", structureLayerId: "L1" },
      { id: "P2", name: "new", sourceType: "dfi", amount: 20, status: "identified", structureLayerId: null },
      { id: "P3", name: "declined", sourceType: "grant", amount: 5, status: "declined", structureLayerId: null },
    ]);
    expect(add.map(p => p.id)).toEqual(["P2"]);
  });
});

describe("classification, consortium, revenue", () => {
  it("derives kind from legacy type and says so", () => {
    expect(kindOf({ kind: null, type: "tender", title: "RFP for water audit" })).toEqual({ kind: "rfp", derived: true });
    expect(kindOf({ kind: "tax_credit", type: "grant", title: "" })).toEqual({ kind: "tax_credit", derived: false });
  });
  it("consortium gaps compare required partners with members", () => {
    const g = consortiumGaps(["university", "utility", "workforce provider"], [{ role: "utility", name: "Metro Water", status: "confirmed", capability: "" }, { role: "partner", name: "Jobs Now", status: "interested", capability: "workforce training" }]);
    expect(g.map(x => x.status)).toEqual(["missing", "confirmed", "in_discussion"]);
  });
  it("funding-originated value counts every later engagement for the account", () => {
    const base = { entryPoint: null, originOpportunityId: null, fundingLine: null, revenueCategory: null, monthlyFee: 0, months: 0 };
    const v = originatedValue([
      { ...base, orgId: "o1", entryPoint: "funding", originOpportunityId: "f1", status: "complete", fee: 7500, createdAt: "2026-01-01T00:00:00Z", fundingLine: "diagnostic" },
      { ...base, orgId: "o1", status: "active", fee: 30000, createdAt: "2026-03-01T00:00:00Z", fundingLine: "full_bid" },
      { ...base, orgId: "o1", status: "active", fee: 0, monthlyFee: 2000, months: 12, createdAt: "2027-06-01T00:00:00Z", revenueCategory: "subscription" },
      { ...base, orgId: "o2", status: "active", fee: 99999, createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ total: 61500, year1: 37500, engagements: 3 });
    expect(v[0].lines).toEqual({ diagnostic: 7500, full_bid: 30000, subscription: 24000 });
  });
  it("funnel conversion is step to step", () => {
    expect(funnel([{ key: "a", label: "A", n: 10 }, { key: "b", label: "B", n: 4 }, { key: "c", label: "C", n: 0 }, { key: "d", label: "D", n: 0 }]).map(x => x.conversionPct)).toEqual([null, 40, 0, null]);
  });
});
