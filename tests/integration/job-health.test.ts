// Phase 16 §10 against local D1: a schedule is "working" only when its jobs complete. Queued-but-not-completed is
// overdue, a newer failure than success is failing, expired leases are visible and then reclaimed, and a configured
// provider with no successful call is "configured, not verified".
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobs, jobSchedules } from "@/db/schema";
import { queueHealth, scheduleHealth } from "@/lib/jobs/health";
import { claim, complete, enqueue, fail, reclaimStale } from "@/lib/jobs/queue";
import { serviceReading } from "@/lib/readiness";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const NOW = new Date("2026-10-02T18:00:00Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

describe("schedule and queue health", () => {
  it("separates queued, completed, overdue and failing", async () => {
    for (const type of ["health.ok", "health.overdue", "health.failing"]) await t.db.insert(jobSchedules).values({ jobType: type, cadence: "daily:02:30", nextRunAt: h(10).toISOString(), lastRunAt: h(-3).toISOString() });
    await enqueue(t.db, "health.ok", {}, { now: h(-3) });
    await enqueue(t.db, "health.overdue", {}, { now: h(-3) });
    await enqueue(t.db, "health.failing", {}, { now: h(-3), maxAttempts: 1 });
    for (const j of await claim(t.db, h(-2.9), 10, 60_000)) {
      if (j.type === "health.ok") await complete(t.db, j.id, h(-2.8));
      else if (j.type === "health.failing") await fail(t.db, j, new Error("Upstream 503"), h(-2.8));
      else await t.db.update(jobs).set({ status: "queued", lockedUntil: null }).where(eq(jobs.id, j.id)); // put back untouched
    }
    const by = Object.fromEntries((await scheduleHealth(t.db, NOW)).map(s => [s.jobType, s]));
    expect(by["health.ok"].state).toBe("ok");
    expect(by["health.ok"].lastCompletedAt).not.toBeNull();
    expect(by["health.overdue"].state).toBe("overdue");             // queued 3 h ago, never completed
    expect(by["health.failing"].state).toBe("failing");
    expect(by["health.failing"].lastError).toMatch(/503/);
  });

  it("shows expired leases, then the tick reclaims them", async () => {
    await enqueue(t.db, "health.lease", {}, { now: h(-1) });
    const [j] = await claim(t.db, h(-1), 1, 60_000);                 // lease expires one minute later
    expect(j).toBeTruthy();
    expect((await queueHealth(t.db, NOW)).expiredLeases).toBeGreaterThanOrEqual(1);
    await reclaimStale(t.db, NOW);
    expect((await queueHealth(t.db, NOW)).expiredLeases).toBe(0);
  });
});

describe("provider readiness", () => {
  it("a configured key is unverified until a call succeeds; a newer failure is failing", () => {
    expect(serviceReading(null, null, null, NOW).status).toBe("unverified");
    expect(serviceReading(h(-1).toISOString(), null, null, NOW).status).toBe("ok");
    expect(serviceReading(h(-5).toISOString(), h(-1).toISOString(), "401 invalid key", NOW)).toMatchObject({ status: "failed" });
    expect(serviceReading(h(-1).toISOString(), h(-5).toISOString(), "timeout", NOW).status).toBe("ok");
  });
});
