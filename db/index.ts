import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Raw access. App code must go through lib/db/scoped.ts (enforced by lint).
export function getDb() {
  if (!env.DB) {
    throw new Error("D1 binding `DB` is unavailable. Check .openai/hosting.json (d1: \"DB\").");
  }
  return drizzle(env.DB, { schema });
}
