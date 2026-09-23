import { describe, expect, it } from "vitest";
import { nextRun, parseCadence } from "@/lib/time/cadence";
import { etToUtc } from "@/lib/time/et";

describe("etToUtc", () => {
  it("uses EDT (UTC-4) in summer and EST (UTC-5) in winter", () => {
    expect(etToUtc(2026, 7, 1, 6, 0).toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(etToUtc(2026, 1, 15, 6, 0).toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });
});

describe("nextRun", () => {
  it("daily 06:00 ET before and after the slot", () => {
    expect(nextRun("daily:06:00", new Date("2026-09-23T09:00:00Z")).toISOString()).toBe("2026-09-23T10:00:00.000Z");
    expect(nextRun("daily:06:00", new Date("2026-09-23T10:00:00Z")).toISOString()).toBe("2026-09-24T10:00:00.000Z");
  });

  it("crosses the November DST change (fall back)", () => {
    // Sat Oct 31 2026 07:00 ET (EDT) -> next 06:00 ET is Sun Nov 1, now EST.
    expect(nextRun("daily:06:00", new Date("2026-10-31T11:00:00Z")).toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });

  it("crosses the March DST change (spring forward)", () => {
    // Sat Mar 7 2026 07:00 EST -> Sun Mar 8 06:00 EDT.
    expect(nextRun("daily:06:00", new Date("2026-03-07T12:00:00Z")).toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  it("weekly Monday 06:30 ET", () => {
    // Wed Sep 23 2026 -> Mon Sep 28 06:30 EDT.
    expect(nextRun("weekly:mon:06:30", new Date("2026-09-23T15:00:00Z")).toISOString()).toBe("2026-09-28T10:30:00.000Z");
  });

  it("monthly on the 1st rolls into next month", () => {
    expect(nextRun("monthly:1:06:00", new Date("2026-09-23T15:00:00Z")).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(nextRun("monthly:1:06:00", new Date("2026-12-05T15:00:00Z")).toISOString()).toBe("2027-01-01T11:00:00.000Z");
  });

  it("fixed intervals", () => {
    expect(nextRun("every:5m", new Date("2026-09-23T15:00:00Z")).toISOString()).toBe("2026-09-23T15:05:00.000Z");
    expect(nextRun("every:1h", new Date("2026-09-23T15:00:00Z")).toISOString()).toBe("2026-09-23T16:00:00.000Z");
  });

  it("rejects malformed cadences", () => {
    for (const bad of ["daily:25:00", "weekly:funday:06:00", "monthly:31:06:00", "every:0m", "hourly"]) {
      expect(() => parseCadence(bad)).toThrow();
    }
  });
});
