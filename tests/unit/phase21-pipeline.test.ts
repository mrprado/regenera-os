import { describe, expect, it } from "vitest";
import { isCreditError } from "@/lib/ai/run";
import { rulesRead } from "@/lib/funding/rules-read";
import { cooldownMs } from "@/lib/sources/http";
import { rulesClassify } from "@/lib/triggers/rules";

describe("phase 21 §1: the pipeline keeps moving without AI", () => {
  it("recognizes the Anthropic no-credit error (as seen in production) and nothing else", () => {
    expect(isCreditError(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'))).toBe(true);
    expect(isCreditError(new Error("HTTP 500: overloaded"))).toBe(false);
    expect(isCreditError(new Error("output was cut off at max_tokens"))).toBe(false);
  });

  it("rules-classifies an official solar tender as a relevant procurement signal", () => {
    const r = rulesClassify({ title: "Invitation to bid: 50 MW solar PV plant with battery storage, Namibia", summary: "", source: "worldbank" }, null);
    expect(r.type).toBe("procurement");
    expect(r.sectors).toContain("energy");
    expect(r.relevance).toBeGreaterThanOrEqual(60);
  });

  it("uses the finding query's trigger type and leaves off-topic news below the threshold", () => {
    expect(rulesClassify({ title: "Utility appoints new CEO", summary: null, source: "gdelt" }, "people").type).toBe("people");
    expect(rulesClassify({ title: "Football club signs striker", summary: null, source: "gdelt" }, null).relevance).toBeLessThan(60);
  });

  it("rules-reads funding into sectors and an honest summary", () => {
    const r = rulesRead({ title: "Watershed restoration and irrigation resilience grants", description: "Funds restoration of degraded watersheds. Open to local governments and nonprofits. Third sentence.", funder: "USDA", source: "grants_gov", deadline: null });
    expect(r.sectors).toContain("water_food_nature");
    expect(r.read.rules).toBe(true);
    expect(r.read.summary).toBe("Funds restoration of degraded watersheds. Open to local governments and nonprofits.");
    expect(r.read.caveats.join(" ")).toMatch(/No deadline/);
  });

  it("cools a failing source down with doubling backoff capped at 6 hours", () => {
    expect(cooldownMs(1)).toBe(5 * 60_000);
    expect(cooldownMs(2)).toBe(10 * 60_000);
    expect(cooldownMs(20)).toBe(6 * 3_600_000);
  });
});
