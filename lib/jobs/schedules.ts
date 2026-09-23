import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { jobSchedules } from "@/db/schema";
import { nextRun, parseCadence } from "@/lib/time/cadence";
import { enqueue } from "./queue";

/** Upserts a schedule; the first run is the next cadence occurrence after `now`. */
export async function upsertSchedule(db: Db, jobType: string, cadence: string, now = new Date()): Promise<void> {
  parseCadence(cadence);
  const next = nextRun(cadence, now).toISOString();
  await db.insert(jobSchedules).values({ jobType, cadence, nextRunAt: next })
    .onConflictDoUpdate({ target: jobSchedules.jobType, set: { cadence, nextRunAt: next, updatedAt: now.toISOString() } });
}

/** Creates any missing default schedules without touching existing ones (Settings edits win). */
export async function ensureSchedules(db: Db, defaults: Record<string, string>, now: Date): Promise<void> {
  for (const [jobType, cadence] of Object.entries(defaults)) {
    await db.insert(jobSchedules).values({ jobType, cadence, nextRunAt: now.toISOString() }).onConflictDoNothing();
  }
}

/**
 * Turns every due schedule into one job. The dedupe key is the slot time, so two overlapping
 * ticks materializing the same slot still produce exactly one job.
 */
export async function materializeDue(db: Db, now: Date): Promise<number> {
  const due = await db.select().from(jobSchedules)
    .where(and(eq(jobSchedules.enabled, true), lte(jobSchedules.nextRunAt, now.toISOString())));
  for (const s of due) {
    await enqueue(db, s.jobType, { slot: s.nextRunAt }, { dedupeKey: `schedule:${s.jobType}:${s.nextRunAt}`, now });
    await db.update(jobSchedules)
      .set({ nextRunAt: nextRun(s.cadence, now).toISOString(), lastRunAt: now.toISOString(), updatedAt: now.toISOString() })
      .where(and(eq(jobSchedules.id, s.id), eq(jobSchedules.nextRunAt, s.nextRunAt)));
  }
  return due.length;
}
