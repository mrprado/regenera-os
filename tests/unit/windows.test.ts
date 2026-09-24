import { describe, expect, it } from "vitest";
import { inWindow, nextWindowStart, timeZoneFor, warmupCap } from "@/lib/time/windows";

describe("send windows", () => {
  it("uses the recipient's local time", () => {
    // Wed 2026-09-23 15:00 UTC = 10:00 Lima (UTC-5) -> inside; = 17:00 Madrid (CEST) -> outside.
    const t = new Date("2026-09-23T15:00:00Z");
    expect(inWindow(t, "America/Lima")).toBe(true);
    expect(inWindow(t, "Europe/Madrid")).toBe(false);
  });

  it("never sends on weekends and moves to the next window", () => {
    const sat = new Date("2026-09-26T15:00:00Z"); // Saturday
    expect(inWindow(sat, "America/Mexico_City")).toBe(false);
    const next = nextWindowStart(sat, "America/Mexico_City");
    // Monday 09:30 Mexico City (UTC-6) = 15:30 UTC
    expect(next.toISOString()).toBe("2026-09-28T15:30:00.000Z");
  });

  it("handles the US DST change (Nov 1, 2026)", () => {
    // Tue Nov 3 2026 08:30 EST = 13:30 UTC (was 12:30 UTC in EDT).
    expect(inWindow(new Date("2026-11-03T13:30:00Z"), "America/New_York")).toBe(true);
    expect(inWindow(new Date("2026-11-03T13:25:00Z"), "America/New_York")).toBe(false);
  });

  it("derives time zones from country, with a safe default", () => {
    expect(timeZoneFor({ country: "Peru" })).toBe("America/Lima");
    expect(timeZoneFor({ country: "AE" })).toBe("Asia/Dubai");
    expect(timeZoneFor({ timezone: "Europe/Lisbon", country: "Peru" })).toBe("Europe/Lisbon");
    expect(timeZoneFor({ country: "Atlantis" })).toBe("America/New_York");
    expect(timeZoneFor({ timezone: "Not/AZone" })).toBe("America/New_York");
  });
});

describe("warm-up", () => {
  it("ramps 10 +3/day to the ceiling", () => {
    expect(warmupCap("2026-09-20", new Date("2026-09-20T12:00:00Z"), 40)).toBe(10);
    expect(warmupCap("2026-09-20", new Date("2026-09-23T12:00:00Z"), 40)).toBe(19);
    expect(warmupCap("2026-09-01", new Date("2026-09-23T12:00:00Z"), 40)).toBe(40);
    expect(warmupCap(null, new Date(), 25)).toBe(25);
  });
});
