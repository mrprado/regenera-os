import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { systemState } from "@/db/schema";

export async function setState(db: Db, key: string, value: string): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.insert(systemState).values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt } });
}

export async function getState(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(systemState).where(eq(systemState.key, key));
  return row?.value ?? null;
}
