import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "@/db/schema";
import type { Db } from "@/db";

const ROOT = join(__dirname, "..", "..");

/** A fresh in-memory local D1 with all migrations applied. Call dispose() in afterAll. */
export async function createTestDb(): Promise<{ db: Db; d1: D1Database; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(ROOT, "tests", "wrangler.test.jsonc"),
    persist: false,
  });
  const d1 = proxy.env.DB;
  const dir = join(ROOT, "drizzle");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await d1.prepare(statement).run();
  }
  return { db: drizzle(d1, { schema }), d1, dispose: () => proxy.dispose() };
}
