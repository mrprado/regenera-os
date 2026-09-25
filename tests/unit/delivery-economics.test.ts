import { describe, expect, it } from "vitest";
import { criticalPath } from "@/lib/delivery/cpm";
import { studyGaps } from "@/lib/delivery/engine";
import { irr, runCase, SCENARIOS, sensitivity } from "@/lib/economics/model";
import { DEFAULT_INPUTS, type CaseInputs } from "@/lib/economics/vocab";

const T = "2026-09-24";
const m = (id: string, durationDays: number, dependsOn: string[] = [], extra: Partial<{ dueDate: string; status: string; completedAt: string }> = {}) =>
  ({ id, name: id, durationDays, dependsOn, dueDate: extra.dueDate ?? null, status: extra.status ?? "planned", completedAt: extra.completedAt ?? null });

describe("critical path", () => {
  it("forward and backward pass: longest chain is critical, parallel work has slack, late against due date", () => {
    const r = criticalPath([m("A", 10), m("B", 5, ["A"]), m("C", 2, ["A"]), m("D", 3, ["B", "C"], { dueDate: "2026-10-09" })], T);
    expect(r.finish).toBe("2026-10-12");
    expect(r.criticalPath).toEqual(["A", "B", "D"]);
    expect(r.nodes.get("C")).toMatchObject({ slackDays: 3, critical: false, start: "2026-10-04", finish: "2026-10-06" });
    expect(r.nodes.get("D")).toMatchObject({ lateDays: 3, overdue: false, critical: true });
  });

  it("done milestones finish on completion; remaining work starts today; overdue and cycles are flagged; cancelled ignored", () => {
    const r = criticalPath([
      m("A", 10, [], { status: "done", completedAt: "2026-09-20" }), m("B", 5, ["A", "X"], { dueDate: "2026-09-01" }),
      m("X", 50, [], { status: "cancelled" }), m("E", 1, ["F"]), m("F", 1, ["E"]),
    ], T);
    expect(r.nodes.get("B")).toMatchObject({ start: T, finish: "2026-09-29", overdue: true, lateDays: 28 });
    expect(r.nodes.has("X")).toBe(false);
    expect(r.cycles.sort()).toEqual(["E", "F"]);
    expect(r.nodes.get("A")).toMatchObject({ critical: false });
  });
});

describe("study gaps", () => {
  it("expects core studies by asset class, adds ESIA from Development, and treats scoped studies as pending", () => {
    const g = studyGaps({ assetClass: "solar", stage: "development" }, [{ type: "topography", status: "final" }, { type: "grid", status: "procuring" }, { type: "flood", status: "not_required" }]);
    expect(g.due).toBe(true);
    expect(g.missing.sort()).toEqual(["esia", "geotechnical", "resource"]);
    expect(g.pending).toEqual(["grid"]);
    expect(studyGaps({ assetClass: null, stage: "screening" }, []).due).toBe(false);
  });
});

const base = (o: Partial<CaseInputs> = {}): CaseInputs => ({
  ...DEFAULT_INPUTS, currency: "USD", capex: 100, revenueYear1: 20, opexYear1: 5, lifeYears: 10, constructionMonths: 0,
  revenueEscalationPct: 0, opexEscalationPct: 0, taxRatePct: 0, gearingPct: 0, ...o,
});

describe("economics model", () => {
  it("IRR solves a one-period flow and returns null without a sign change", () => {
    expect(irr([{ t: 0, v: -100 }, { t: 1, v: 110 }])).toBeCloseTo(0.1, 6);
    expect(irr([{ t: 0, v: 100 }, { t: 1, v: 10 }])).toBeNull();
  });

  it("unlevered: project IRR of a 15/yr annuity on 100, payback 6.67 years", () => {
    const o = runCase(base());
    expect(o.projectIrr!).toBeCloseTo(0.0814, 3);
    expect(o.equityIrr!).toBeCloseTo(o.projectIrr!, 6);
    expect(o.paybackYears!).toBeCloseTo(100 / 15, 6);
    expect(o).toMatchObject({ debt: 0, debtSizedBy: "none", minDscr: null, ebitdaYear1: 15 });
  });

  it("sizes sculpted debt by DSCR when gearing allows, and by gearing (higher DSCR) when it binds", () => {
    const d = runCase(base({ gearingPct: 80, interestRatePct: 8, debtTenorYears: 10, targetDscr: 1.5 }));
    expect(d.debtSizedBy).toBe("dscr");
    expect(d.debt).toBeCloseTo(10 * 6.710081, 3);
    expect(d.minDscr!).toBeCloseTo(1.5, 6);
    expect(d.llcr!).toBeCloseTo(1.5, 6);
    expect(d.equityIrr!).toBeGreaterThan(d.projectIrr!);
    const g = runCase(base({ gearingPct: 50, interestRatePct: 8, debtTenorYears: 10, targetDscr: 1.5 }));
    expect(g.debtSizedBy).toBe("gearing");
    expect(g.debt).toBeCloseTo(50, 6);
    expect(g.minDscr!).toBeCloseTo(1.5 * 67.10081 / 50, 3);
  });

  it("downside is worse than base is worse than upside; sensitivities drop variables with no effect", () => {
    const b = base({ gearingPct: 60, taxRatePct: 25, constructionMonths: 12 });
    const [lo, mid, hi] = [runCase(SCENARIOS.downside.apply(b)), runCase(b), runCase(SCENARIOS.upside.apply(b))];
    expect(lo.equityIrr!).toBeLessThan(mid.equityIrr!);
    expect(mid.equityIrr!).toBeLessThan(hi.equityIrr!);
    const s = sensitivity(b);
    expect(s.map(x => x.key)).not.toContain("Carbon price");
    expect(s[0].swing).toBeGreaterThanOrEqual(s[s.length - 1].swing);
    expect(s.find(x => x.key === "CAPEX")!.lowIrr!).toBeGreaterThan(s.find(x => x.key === "CAPEX")!.highIrr!);
  });
});
