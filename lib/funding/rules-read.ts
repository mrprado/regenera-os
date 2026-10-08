// Rules read for funding (phase 21 §1.1): when AI is unavailable, opportunities still get sectors, a category and a
// short summary from their structured fields, so search, matching and Command keep working. readAt stays null, so
// the AI read replaces this when it is back; `read.rules` marks what was done here.
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { fundingOpportunities } from "@/db/schema";
import { SECTORS } from "@/lib/vocab";

const SECTOR_RE: [RegExp, keyof typeof SECTORS][] = [
  [/solar|wind|renewable|energy|grid|electric|power|hydrogen|storage/i, "energy"],
  [/water|watershed|river|irrigation|sanitation|wastewater|restoration|forest|biodiversity|agricultur|food|nature|ecosystem/i, "water_food_nature"],
  [/waste|landfill|recycl|circular|biogas/i, "waste_resource_systems"],
  [/infrastructure|transport|road|port|bridge|resilien/i, "infrastructure"],
  [/urban|housing|building|brownfield|land use|tourism/i, "land_built_environment"],
];

/** Pure: sectors and a two-sentence summary from title + description. */
export function rulesRead(o: { title: string; description: string; funder: string | null; source: string; deadline: string | null }) {
  const text = `${o.title} ${o.description}`;
  const sectors = [...new Set(SECTOR_RE.filter(([re]) => re.test(text)).map(([, k]) => k))];
  const first = o.description.replace(/\s+/g, " ").split(/(?<=[.!?])\s/).slice(0, 2).join(" ").slice(0, 400);
  return {
    sectors,
    read: {
      summary: first || o.title,
      why: "Rules read (AI unavailable): sectors from keywords; eligibility not read yet.",
      caveats: ["Eligibility, applicant types and co-financing are as listed by the source: open the original before relying on them.", ...(o.deadline ? [] : ["No deadline stated by the source."])],
      rules: true,
    },
  };
}

export async function readFundingByRules(db: Db, limit = 60, now = new Date()) {
  const rows = await db.select().from(fundingOpportunities)
    .where(and(isNull(fundingOpportunities.readAt), isNull(fundingOpportunities.read), ne(fundingOpportunities.status, "closed")))
    .orderBy(asc(fundingOpportunities.deadline)).limit(limit);
  for (const o of rows) {
    const r = rulesRead(o);
    await db.update(fundingOpportunities).set({ sectors: o.sectors?.length ? o.sectors : r.sectors, read: r.read, updatedAt: now.toISOString() }).where(eq(fundingOpportunities.id, o.id));
  }
  return rows.length;
}

export async function fundingUnread(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(fundingOpportunities).where(and(isNull(fundingOpportunities.readAt), ne(fundingOpportunities.status, "closed")));
  return n;
}
