// Per-person interface preferences (phase 26). Takes a Db so it is testable.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { userPreferences } from "@/db/schema";
import { themeOrDefault, type Theme } from "@/lib/theme";

export async function getTheme(db: Db, email: string): Promise<Theme> {
  const [row] = await db.select({ theme: userPreferences.theme }).from(userPreferences).where(eq(userPreferences.email, email.toLowerCase())).limit(1);
  return themeOrDefault(row?.theme);
}

export async function setTheme(db: Db, email: string, theme: Theme) {
  const now = new Date().toISOString();
  await db.insert(userPreferences).values({ email: email.toLowerCase(), theme, updatedAt: now })
    .onConflictDoUpdate({ target: userPreferences.email, set: { theme, updatedAt: now } });
}
