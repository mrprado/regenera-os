// Phase 15: explainable matching, Command grouping and buckets, meeting-to-action extraction, qualification rules,
// open-web source enforcement, map country normalization and AI contract completeness. Pure functions only.
import { describe, expect, it } from "vitest";
import { matchCandidate, techTokens, type CandidateFacts } from "@/lib/flow/matching";
import { bucketOf, groupPriorities, localDate, type Priority } from "@/lib/command/desk";
import { extractMarked } from "@/lib/flow/meetings";
import { requirementsFor } from "@/lib/scan/qualification";
import { qualificationGaps } from "@/lib/flow/commercial";
import { keepSourced } from "@/lib/scan/web";
import { recordCountry } from "@/lib/map/discovery";
import { CONTRACTS } from "@/lib/ai/contracts";
import { PROMPTS } from "@/lib/ai/prompts";

const crit = { geography: ["MEX"], capabilities: ["solar PV", "BESS"], sizeMin: 20, sizeMax: 300, sizeUnit: "MW", stages: [], exclusions: ["coal"] };
const cand = (o: Partial<CandidateFacts> = {}): CandidateFacts => ({ kind: "procurement", name: "EPC for 100 MW PV", country: "MEX", technologies: ["solar photovoltaic"], size: 100, sizeUnit: "MW", stage: "rfp", deadline: "2026-12-01", open: true, text: "", buyer: "Sponsor SA", source: "test", ...o });

describe("objective matching", () => {
  it("supports a candidate only on evidence and keeps confidence separate", () => {
    const m = matchCandidate(crit, cand(), "2026-10-01");
    expect(m.match).toBe("supported");
    expect(m.confidence).toBe("high");
  });
  it("a closed call is a hard exclusion that never averages away", () => {
    const m = matchCandidate(crit, cand({ deadline: "2026-09-01" }), "2026-10-01");
    expect(m.match).toBe("excluded");
    expect(m.hardExclusion).toMatch(/Closed/);
  });
  it("a missing deadline is unknown, never rolling unless the source says so", () => {
    const m = matchCandidate(crit, cand({ deadline: null }), "2026-10-01");
    expect(m.criteria.find(c => c.key === "deadline")!.evidence).toBe("Deadline unknown");
  });
  it("different units are unknown, not converted; exclusions are hard; announcements carry caveats", () => {
    expect(matchCandidate(crit, cand({ sizeUnit: "USD", size: 5e6 }), "2026-10-01").criteria.find(c => c.key === "size")!.result).toBe("unknown");
    expect(matchCandidate(crit, cand({ text: "coal plant retrofit" }), "2026-10-01").match).toBe("excluded");
    expect(matchCandidate(crit, cand({ kind: "queue_project", deadline: null, open: null }), "2026-10-01").caveats.join(" ")).toMatch(/not an open procurement/);
    expect(matchCandidate(crit, cand({ kind: "funding_call" }), "2026-10-01").caveats.join(" ")).toMatch(/not a delivery contract/);
  });
  it("normalizes technology words", () => {
    expect([...techTokens(["Solar PV + BESS hybrid"])].sort()).toEqual(["solar", "storage"]);
  });
});

describe("Command priorities", () => {
  const p = (key: string, due: string | null, ws: string | null = null, type = "Task"): Priority => ({ key, type, record: "Bid", href: "/deals/1", reason: key, severity: "medium", basis: "", owner: null, due, action: key, workstream: ws, workstreamLabel: ws ? "Opportunity: Bid" : null });
  it("separates overdue, today and upcoming; blockers without a date are blocked", () => {
    expect(bucketOf("2026-09-30", "2026-10-01")).toBe("overdue");
    expect(bucketOf("2026-10-01", "2026-10-01")).toBe("today");
    expect(bucketOf("2026-10-05", "2026-10-01")).toBe("upcoming");
    expect(bucketOf(null, "2026-10-01", true)).toBe("blocked");
  });
  it("groups six tasks of one bid into one workstream, bucketed by its earliest date", () => {
    const g = groupPriorities([1, 2, 3, 4, 5, 6].map(i => p(`t${i}`, `2026-09-2${i}`, "deal:1")), "2026-10-01");
    expect(g.overdue).toHaveLength(1);
    expect(g.overdue[0].items).toHaveLength(6);
    expect(g.overdue[0].overdueDays).toBe(10);
  });
  it("uses the workspace time zone for 'today'", () => {
    expect(localDate(new Date("2026-10-02T05:00:00Z"))).toBe("2026-10-01");
  });
});

describe("meeting-to-action", () => {
  it("proposes only from marked lines, each quoting its line", () => {
    const out = extractMarked("Discussed pipeline.\nAction: send capability statement 2026-10-08\nNeed: pre-qualified projects in MISO\nNext step: scoping call 2026-10-15\nThey seem keen.", { dealId: "d1", orgId: "o1" });
    expect(out.map(o => o.action)).toEqual(["create_task", "qualification_field", "next_action", "qualification_field"]);
    expect(out[0].args.due).toBe("2026-10-08");
    expect(out.every(o => o.quote.length > 0)).toBe(true);
  });
  it("proposes nothing from unmarked prose", () => {
    expect(extractMarked("They seem keen and will probably buy.", { dealId: "d1", orgId: null })).toEqual([]);
  });
});

describe("qualification rules", () => {
  const q = (dimensions: Record<string, { reading: "strong" | "partial" | "weak" | "unknown"; basis: string; by?: string }>, status = "human_reviewed") => ({ status: status as never, dimensions });
  it("needs a reason and a person's fit reading plus a contact route before outreach", () => {
    expect(requirementsFor("ready_for_outreach", q({}), "")).toContain("A reason is required for every human status change.");
    expect(requirementsFor("ready_for_outreach", q({ accountFit: { reading: "strong", basis: "x", by: "scan" } }), "ok").join(" ")).toMatch(/assessed by a person/);
    expect(requirementsFor("ready_for_outreach", q({ accountFit: { reading: "strong", basis: "x", by: "a@b" }, contactReadiness: { reading: "partial", basis: "y", by: "a@b" } }), "ok")).toEqual([]);
  });
  it("commercial qualification needs evidence on need, buyer, timing, budget path and an agreed next step", () => {
    expect(qualificationGaps({ need: { text: "x", evidence: "" } })).toHaveLength(5);
    const full = Object.fromEntries(["need", "buyer", "timing", "budgetPath", "agreedNextStep"].map(k => [k, { text: "t", evidence: "e" }]));
    expect(qualificationGaps(full)).toEqual([]);
  });
});

describe("open-web discovery", () => {
  it("drops candidates whose sources are not in the notes, and LinkedIn-only candidates", () => {
    const notes = "Acme EPC <https://acme.mx/about> and Beta <https://www.linkedin.com/company/beta>";
    const kept = keepSourced([
      { name: "Acme EPC", website: "acme.mx", country: "Mexico", evidence: "", sources: ["<https://acme.mx/about>"] },
      { name: "Beta", website: "", country: "", evidence: "", sources: ["https://www.linkedin.com/company/beta"] },
      { name: "Ghost", website: "", country: "", evidence: "", sources: ["https://invented.example/page"] },
    ], notes);
    expect(kept.map(k => k.name)).toEqual(["Acme EPC"]);
  });
});

describe("Atlas directory country filter", () => {
  it("normalizes codes and falls back to the location text", () => {
    expect(recordCountry({ country: "MEX" })).toBe("Mexico");
    expect(recordCountry({ country: null, location: "Monterrey, Mexico" })).toBe("Mexico");
    expect(recordCountry({ country: "CA" })).toBe("Canada");
    expect(recordCountry({ country: null, location: null })).toBeNull();
  });
});

describe("AI action contracts", () => {
  it("every contract is complete and every wired contract names an existing prompt", () => {
    for (const c of CONTRACTS) {
      for (const k of ["purpose", "sources", "evidence", "unknowns", "humanBoundary"] as const) expect(c[k].length, `${c.key}.${k}`).toBeGreaterThan(5);
      expect(c.output.length && c.prohibited.length && c.inputs.length, c.key).toBeTruthy();
      if (c.status === "wired") expect(c.promptKey && c.promptKey in PROMPTS, c.key).toBeTruthy();
    }
  });
});
