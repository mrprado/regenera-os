import type { Db } from "@/db";
import { setState } from "@/lib/state";
import type { Job } from "./queue";

export type JobContext = { db: Db; job: Job; now: Date };
export type JobHandler = (ctx: JobContext) => Promise<void>;

// One handler per job type. Phase 0 only proves the engine; later phases register real work here.
export const handlers: Record<string, JobHandler> = {
  "system.heartbeat": async ({ db, now }) => {
    await setState(db, "last_heartbeat_at", now.toISOString());
  },
};

// Recurring jobs seeded at startup and editable later in Settings (SPEC section 23).
export const DEFAULT_SCHEDULES: Record<string, string> = {
  "system.heartbeat": "every:5m",
};
