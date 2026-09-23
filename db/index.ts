import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// Raw access. App code must go through lib/db/scoped.ts (enforced by lint).
export function getDb(): Db {
  if (!env.DB) {
    throw new Error("D1 binding `DB` is unavailable. Check .openai/hosting.json (d1: \"DB\").");
  }
  return drizzle(env.DB, { schema });
}
