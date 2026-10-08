import { describe, expect, it } from "vitest";
import { matchFunding } from "@/lib/funding/project-match";
import { isAwardNotice, matchesAllWords } from "@/lib/funding/sources";

const opp = { id: "o", status: "open" as const, deadline: "2026-12-01", countries: ["Namibia"], sectors: ["energy"], amountMax: null, applicantTypes: ["Businesses"], type: "tender" as const, read: null };
const proj = { id: "p", country: "NAM", technology: "Solar PV + BESS", assetClass: null, name: "Hardap Solar", sector: null };

describe("phase 21 §4 funding ↔ project matching (hard gates first)", () => {
  it("matches a listed country and sector, keeping unknowns explicit", () => {
    const m = matchFunding(opp, proj, "2026-10-08");
    expect(m?.geography).toBe("listed");
    expect(m?.reasons.met.join(" ")).toMatch(/Sector: Energy/);
    expect(m?.reasons.unknown.join(" ")).toMatch(/Amount not stated/);
  });
  it("fails the gates: closed, past deadline, other country, other sector, no project country", () => {
    expect(matchFunding({ ...opp, status: "closed" }, proj, "2026-10-08")).toBeNull();
    expect(matchFunding({ ...opp, deadline: "2026-01-01" }, proj, "2026-10-08")).toBeNull();
    expect(matchFunding({ ...opp, countries: ["United States"] }, proj, "2026-10-08")).toBeNull();
    expect(matchFunding({ ...opp, sectors: ["waste_resource_systems"] }, proj, "2026-10-08")).toBeNull();
    expect(matchFunding(opp, { ...proj, country: null }, "2026-10-08")).toBeNull();
  });
  it("flags a missing deadline as unverified rather than rejecting it", () => {
    expect(matchFunding({ ...opp, deadline: null }, proj, "2026-10-08")?.reasons.unknown.join(" ")).toMatch(/unverified/);
  });
});

describe("awards are kept apart from opportunities", () => {
  it("recognizes award notices", () => {
    expect(isAwardNotice("Contract Award")).toBe(true);
    expect(isAwardNotice("Invitation for Bids")).toBe(false);
    expect(isAwardNotice("Request for Expression of Interest")).toBe(false);
  });
  it("Find a Tender keyword filter needs every word", () => {
    expect(matchesAllWords("Solar PV installation framework", "solar framework")).toBe(true);
    expect(matchesAllWords("Detergent dosing system", "solar")).toBe(false);
  });
});
