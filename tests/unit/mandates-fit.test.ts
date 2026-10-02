// Mandate matching + qualification (docs/plans/phase-14-mandates.md §7–9, §17, §21): readings carry a basis,
// inferences are labelled, the machine never qualifies, stage advancement needs the stage's criteria, and the
// public SPP file parses.
import { describe, expect, it } from "vitest";
import { canAdvance, estimateEpc, evaluate, machineChecks, machineStage, mergeChecks, priorityOf, probabilityOf, procurementWindow, stageFromQueue, tally, technologyOf, type MandateLike } from "@/lib/mandates/fit";
import { normalizeSpp } from "@/lib/mandates/queues";
import { simulate, simulateAll } from "@/lib/mandates/simulation";

const NOW = new Date("2026-09-30T12:00:00Z");
const epc: MandateLike = { type: "epc_origination", technologies: ["solar", "bess", "solar_bess"], geography: { isos: ["SPP", "MISO"], states: [] }, criteria: { minSolarMw: 50, minStorageMw: 50, stages: ["mid_development", "late_development"], procurementHorizonMonths: 30, minEpcValue: 40_000_000 } };
const late = { technology: "solar", mw: 200, state: "OK", iso: "SPP", country: "US", ...(() => { const s = stageFromQueue("SPP", "IA FULLY EXECUTED/ON SCHEDULE", "", "IA FULLY EXECUTED/ON SCHEDULE"); return { stage: s.stage, stageBasis: s.basis, epcAwarded: s.epcAwarded }; })(), cod: "2028-06-01", sponsorKnown: false };

describe("queue normalization", () => {
  it("maps fuel text to technology keys", () => {
    expect(technologyOf("Hybrid", "Solar/Storage")).toBe("solar_bess");
    expect(technologyOf("Solar", "Photovoltaic")).toBe("solar");
    expect(technologyOf("Battery/Storage", "")).toBe("bess");
    expect(technologyOf("Wind", "")).toBe("wind");
  });
  it("reads interconnection status as a stage with its basis; construction means EPC likely awarded", () => {
    expect(stageFromQueue("SPP", "IA FULLY EXECUTED/ON SCHEDULE", "", "IA FULLY EXECUTED/ON SCHEDULE").stage).toBe("late_development");
    expect(stageFromQueue("SPP", "DISIS STAGE", "", "").stage).toBe("early_development");
    expect(stageFromQueue("MISO", "Active", "DPP-2022 · Phase 3", "").stage).toBe("mid_development");
    // MISO shows "Post-GIA: Not Started" on positions still in study: the study phase wins.
    expect(stageFromQueue("MISO", "Active", "DPP-2025 · Phase 1", "Post-GIA: Not Started").stage).toBe("early_development");
    expect(stageFromQueue("MISO", "Active", "", "Post-GIA: Not Started").basis).toMatch(/inference/);
    const c = stageFromQueue("MISO", "Active", "", "Post-GIA: Under Construction");
    expect(c.stage).toBe("construction");
    expect(c.epcAwarded).toBe(true);
  });
  it("parses the SPP active-requests CSV (header after a Last Updated line)", () => {
    const csv = `"Last Updated On",9/30/2026,\nGeneration Interconnection Number,IFS Queue Number,Current Cluster,Cluster Group, Nearest Town or County,State,TO at POI,In-Service Date,Commercial Operation Date,Cessation Date,Original Generator Commercial Op Date,Capacity,MAX Summer MW,MAX Winter MW,Service Type,Requested Maximum Injection Capability (MW),Requested Network Resource Deliverability (MW),Nameplate Capacity,Generation Type,Fuel Type,Substation or Line,Request Received,Date Withdrawn,Status,JTIQ Participant,JTIQ Commitment,Cause of Delay\n"GEN-2023-1","","C1","","Weld County,","co","PSCO","","6/1/2028","","","","200","200","ER","","","","Solar","","Sub A","1/2/2023","","IA FULLY EXECUTED/ON SCHEDULE","","",""`;
    const [r] = normalizeSpp(csv);
    expect(r.key).toBe("SPP:GEN-2023-1");
    expect(r.state).toBe("CO");
    expect(r.county).toBe("Weld County");
    expect(r.technology).toBe("solar");
    expect(r.mw).toBe(200);
    expect(r.inServiceDate).toBe("2028-06-01");
    expect(r.iaStatus).toMatch(/IA FULLY EXECUTED/);
  });
});

describe("fit and qualification", () => {
  it("every fit dimension has a reading and a basis; sponsor-unknown leaves strategic fit unknown", () => {
    const fit = evaluate(epc, late, { now: NOW });
    for (const v of Object.values(fit)) { expect(v.reading).toBeTruthy(); expect(v.basis.length).toBeGreaterThan(5); }
    expect(fit.technical.reading).not.toBe("fail");
    expect(fit.geographic.reading).toBe("strong");
    expect(fit.strategic.reading).toBe("unknown");
  });
  it("labels EPC value and procurement window as inferences", () => {
    expect(estimateEpc(late).basis).toMatch(/^Inference/);
    const w = procurementWindow(late);
    expect(w.basis).toMatch(/^Inference/);
    expect(w.end! < "2028-06-01").toBe(true);
    expect(w.start! < w.end!).toBe(true);
  });
  it("fails size and geography with the reason stated", () => {
    const fit = evaluate(epc, { ...late, mw: 20, iso: "PJM", state: "VA" }, { now: NOW });
    expect(fit.technical.reading).toBe("fail");
    expect(fit.technical.basis).toMatch(/20 MW < 50 MW/);
    expect(fit.geographic.reading).toBe("fail");
  });
  it("construction or operating projects fail timing (EPC procurement has likely passed)", () => {
    const s = stageFromQueue("MISO", "Active", "", "Post-GIA: Under Construction");
    expect(evaluate(epc, { ...late, stage: s.stage, stageBasis: s.basis, epcAwarded: true }, { now: NOW }).timing.reading).toBe("fail");
  });
  it("the machine stops at pre-qualified; human criteria stay unknown", () => {
    const fit = evaluate(epc, late, { now: NOW });
    const checks = machineChecks(epc, late, fit, true, "Identify sponsor");
    expect(checks.sponsor).toBeUndefined();
    expect(machineStage("epc_origination", checks)).toBe("pre_qualified");
    expect(canAdvance("epc_origination", "qualified", checks, {}).ok).toBe(false);
    expect(canAdvance("epc_origination", "qualified", checks, {}).missing.map(m => m.label)).toContain("Sponsor / developer identified and credible");
  });
  it("a person's answers win over machine answers and unlock the next stage", () => {
    const fit = evaluate(epc, late, { now: NOW });
    const machine = machineChecks(epc, late, fit, true, "Identify sponsor");
    const human = { sponsor: { met: "yes" as const, basis: "County filing names the developer", by: "a@regenera.bio" }, epc_open: { met: "yes" as const, basis: "No EPC announced; developer confirmed by phone", by: "a@regenera.bio" }, blockers: { met: "yes" as const, basis: "Reviewed: none material", by: "a@regenera.bio" } };
    const merged = mergeChecks(human, machine);
    expect(merged.sponsor.machine).toBeFalsy();
    expect(canAdvance("epc_origination", "qualified", merged, {}).ok).toBe(true);
    expect(canAdvance("epc_origination", "approved", merged, {}).ok).toBe(false);
    expect(canAdvance("epc_origination", "approved", merged, { clientApproved: true }).ok).toBe(true);
    expect(tally("epc_origination", merged).unknown).toBe(0);
  });
  it("priority states its reason; probability is a stage default unless overridden", () => {
    const p = priorityOf(evaluate(epc, late, { now: NOW }));
    expect(p.why.length).toBeGreaterThan(5);
    expect(probabilityOf("epc", "rfp").base).toBe(20);
    expect(probabilityOf("epc", "rfp", 35)).toEqual({ base: 20, effective: 35, overridden: true });
  });
});

describe("counterparty simulation", () => {
  it("reports insufficient information without facts and names what is missing", () => {
    const r = simulate("lender", { readiness: {} });
    expect(r.reading).toBe("unknown");
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.documents.length).toBeGreaterThan(0);
  });
  it("a blocked dimension makes a lens not ready, with an action", () => {
    const r = simulate("epc", { readiness: { engineering: "ready", technical: "ready", grid: "blocked", procurement: "in_progress", construction: "early", land: "ready" }, sponsorKnown: true });
    expect(r.reading).toBe("not_ready");
    expect(r.objections.join(" ")).toMatch(/grid is blocked/);
    expect(r.actions.join(" ")).toMatch(/grid/);
  });
  it("covers all nine lenses", () => { expect(simulateAll({ readiness: {} }).length).toBe(9); });
});
