import { describe, expect, it } from "vitest";
import { enforceSources, screeningQuadrant, tierFor, totalScore, type DossierFields } from "@/lib/crm/research";

const base = (over: Partial<DossierFields> = {}): DossierFields => ({
  mandate: { value: "Deploy into natural capital", sources: ["https://fund.example/strategy"], confidence: "high" },
  investment_focus: { value: "Regenerative agriculture, LatAm", sources: ["https://invented.example/x"], confidence: "medium" },
  ticket_and_structure: { value: "$5-25M equity", sources: [], confidence: "low" },
  development_mandate: { value: "", sources: [], confidence: "low" },
  recent_activity: [
    { date: "2026-07-14", fact: "First close of Fund II", source: "https://news.example/close" },
    { date: "2025-03-01", fact: "Old news", source: "https://news.example/old" },
    { date: "2026-08-01", fact: "Unsourced claim", source: "https://made-up.example" },
  ],
  live_opportunities: [],
  partner_ecosystem: { value: ["EPC Co"], sources: ["https://fund.example/strategy"], confidence: "medium" },
  decision_map: { value: "CIO decides", sources: ["https://fund.example/team"], confidence: "medium" },
  headquarters: { city: "Mexico City", country: "Mexico", source: "https://fund.example/strategy" },
  regenerative_angle: "x", decision_read: "y", overall_confidence: "medium",
  ...over,
});

const NOTES = `Mandate: deploy into natural capital (2026-05) <https://fund.example/strategy>
Recent activity: first close of Fund II (2026-07-14) <https://news.example/close>
Old: (2025-03-01) <https://news.example/old>
Team: CIO <https://fund.example/team>.`;

describe("enforceSources", () => {
  it("keeps only facts whose sources appear in the notes, and only this year's activity", () => {
    const { fields, removed } = enforceSources(base(), NOTES, new Date("2026-09-23T00:00:00Z"));
    expect(fields.mandate.sources).toEqual(["https://fund.example/strategy"]);
    expect(fields.investment_focus.value).toBe("");            // invented source -> emptied
    expect(fields.investment_focus.confidence).toBe("low");
    expect(fields.recent_activity.map(a => a.fact)).toEqual(["First close of Fund II"]);
    expect(fields.decision_map.sources).toEqual(["https://fund.example/team"]); // trailing "." in notes tolerated
    expect(removed).toBeGreaterThan(0);
  });
});

describe("scoring", () => {
  it("weights 40/35/25 and tiers at 75/50/30", () => {
    expect(totalScore({ fit: 90, trigger: 80, access: 40 })).toBe(Math.round(36 + 28 + 10));
    expect(tierFor(75)).toBe("targeted");
    expect(tierFor(74)).toBe("mass");
    expect(tierFor(50)).toBe("mass");
    expect(tierFor(49)).toBe("watchlist");
    expect(tierFor(29)).toBe("parked");
  });

  it("screening matrix keeps readiness and alignment separate", () => {
    const high = { control: "high", technical: "high", commercial: "medium", institutional: "high", capital: "medium" } as const;
    const low = { control: "low", technical: "low", commercial: "medium", institutional: "low", capital: "low" } as const;
    expect(screeningQuadrant(high, "high")).toBe("proceed");
    expect(screeningQuadrant(low, "high")).toBe("develop");
    expect(screeningQuadrant(high, "low")).toBe("redirect");
    expect(screeningQuadrant(low, "low")).toBe("decline");
  });
});
