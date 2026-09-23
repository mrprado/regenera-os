import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobs, jobSchedules } from "@/db/schema";
import { enqueue, retryDead } from "@/lib/jobs/queue";
import { tick } from "@/lib/jobs/tick";
import { getState } from "@/lib/state";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(jobSchedules);
});

const NOW = new Date("2026-09-23T15:00:00Z");

describe("job engine", () => {
  it("runs each job exactly once under overlapping ticks", async () => {
    const runs = new Map<string, number>();
    const handlers = {
      "test.count": async ({ job }: { job: { id: string } }) => {
        await new Promise(r => setTimeout(r, 5));
        runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      },
    };
    for (let i = 0; i < 30; i++) await enqueue(t.db, "test.count", { i }, { now: NOW });

    const opts = { now: () => NOW, handlers, schedules: {}, batch: 3 };
    await Promise.all([tick(t.db, opts), tick(t.db, opts), tick(t.db, opts)]);

    expect(runs.size).toBe(30);
    expect([...runs.values()].every(n => n === 1)).toBe(true);
    const done = await t.db.select().from(jobs).where(eq(jobs.status, "done"));
    expect(done).toHaveLength(30);
  });

  it("dedupe keys make enqueue idempotent", async () => {
    await enqueue(t.db, "test.x", {}, { dedupeKey: "k1", now: NOW });
    await enqueue(t.db, "test.x", {}, { dedupeKey: "k1", now: NOW });
    expect(await t.db.select().from(jobs)).toHaveLength(1);
  });

  it("retries with backoff, then marks dead after max attempts, and can be retried manually", async () => {
    const handlers = { "test.fail": async () => { throw new Error("boom"); } };
    await enqueue(t.db, "test.fail", {}, { now: NOW, maxAttempts: 3 });
    let clock = NOW.getTime();
    const opts = { now: () => new Date(clock), handlers, schedules: {} };

    const first = await tick(t.db, opts);
    expect(first.retried).toBe(1);
    let [row] = await t.db.select().from(jobs);
    expect(row.status).toBe("queued");
    expect(row.lastError).toBe("boom");
    expect(new Date(row.runAfter).getTime()).toBe(clock + 30_000);

    // Not due yet: nothing runs.
    expect((await tick(t.db, opts)).retried).toBe(0);

    clock += 31_000;
    expect((await tick(t.db, opts)).retried).toBe(1);
    clock += 61_000;
    expect((await tick(t.db, opts)).dead).toBe(1);
    [row] = await t.db.select().from(jobs);
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(3);

    await retryDead(t.db, row.id, new Date(clock));
    [row] = await t.db.select().from(jobs);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
  });

  it("fails unknown job types instead of dropping them", async () => {
    await enqueue(t.db, "test.unknown", {}, { now: NOW, maxAttempts: 1 });
    const r = await tick(t.db, { now: () => NOW, handlers: {}, schedules: {} });
    expect(r.dead).toBe(1);
    const [row] = await t.db.select().from(jobs);
    expect(row.lastError).toMatch(/No handler/);
  });

  it("reclaims jobs whose lock expired", async () => {
    await enqueue(t.db, "test.ok", {}, { now: NOW });
    await t.db.update(jobs).set({ status: "running", lockedUntil: new Date(NOW.getTime() - 1000).toISOString() });
    const r = await tick(t.db, { now: () => NOW, handlers: { "test.ok": async () => {} }, schedules: {} });
    expect(r.ran).toBe(1);
  });

  it("materializes a schedule slot once even when ticks overlap, and records ticks", async () => {
    const handlers = { "system.heartbeat": async () => {} };
    const schedules = { "system.heartbeat": "every:5m" };
    const opts = { now: () => NOW, handlers, schedules };
    await Promise.all([tick(t.db, opts), tick(t.db, opts)]);
    const created = await t.db.select().from(jobs).where(eq(jobs.type, "system.heartbeat"));
    expect(created).toHaveLength(1);
    const [s] = await t.db.select().from(jobSchedules);
    expect(s.nextRunAt).toBe("2026-09-23T15:05:00.000Z");
    expect(await getState(t.db, "last_tick_at")).toBe(NOW.toISOString());
  });

  it("stops at the time budget and leaves work queued", async () => {
    const handlers = { "test.slow": async () => { await new Promise(r => setTimeout(r, 30)); } };
    for (let i = 0; i < 10; i++) await enqueue(t.db, "test.slow", { i }, { now: NOW });
    const r = await tick(t.db, { now: () => NOW, handlers, schedules: {}, batch: 1, budgetMs: 50 });
    expect(r.stoppedForBudget).toBe(true);
    expect(r.ran).toBeLessThan(10);
    const queued = await t.db.select().from(jobs).where(eq(jobs.status, "queued"));
    expect(queued.length).toBe(10 - r.ran);
  });
});
