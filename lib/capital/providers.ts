// Capital providers as records (phase 20 §6): the public programme catalogue imported as organizations plus capital
// profiles, re-import updates rather than duplicates (matched by programme key). Routing tags follow the three-lane
// method: lane, preference (operating vs development), ticket band, routing stage. Institutions only, no people.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalProfiles, organizations } from "@/db/schema";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { PROGRAMMES, REGIONS, type Programme } from "./programmes";

const TYPE_OF: Record<Programme["kind"], "dfi" | "bank" | "fund" | "strategic" | "government" | "other"> = { mdb: "dfi", dfi: "dfi", bank: "bank", fund: "fund", guarantor: "other", insurer: "other", ipp: "strategic", facility: "government" };
/** Region keys expanded to ISO3 codes, so the existing capital matching (by geography) sees them. */
const geographiesOf = (p: Programme) => [...new Set(p.regions.flatMap(r => REGIONS[r] ?? [r]))];

export const ROUTING = {
  lane: { credit: "Credit / structured", equity: "Equity / anchor", strategic: "Strategic / de-risking", prep: "Preparation", acquisition: "Acquisition" },
  preference: { operating: "Operating cash-flow", development: "Development-stage", both: "Both", unknown: "Unknown" },
  ticketBand: { lt250k: "< $250k", "250k_2m": "$250k – $2m", "2m_10m": "$2m – $10m", gt10m: "$10m +", unknown: "Unknown" },
  routingStage: { new: "New", engaged: "Engaged", fit_check: "Fit-check booked", qualified: "Qualified", terms: "Terms / diligence", closed: "Closed", declined: "Declined" },
} as const;

const LANE_OF: Record<string, keyof typeof ROUTING.lane> = { credit: "credit", equity: "equity", derisk: "strategic", prep: "prep", acquisition: "acquisition" };
const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; } };

/** Imports (or refreshes) programmes into one workspace. Returns counts. */
export async function importProgrammes(db: Db, mandateId: string, actor: string, list: Programme[] = PROGRAMMES) {
  let created = 0, updated = 0;
  for (const p of list) {
    const [prof] = await db.select().from(capitalProfiles).where(and(eq(capitalProfiles.mandateId, mandateId), eq(capitalProfiles.programmeKey, p.key)));
    const notes = `${p.instruments}. Fit: ${p.fit}.${p.verify ? ` Verify: ${p.verify}.` : ""} Source: ${p.url}`;
    if (prof) {
      await db.update(capitalProfiles).set({ name: p.name, notes, updatedAt: new Date().toISOString() }).where(eq(capitalProfiles.id, prof.id));
      updated++; continue;
    }
    const domain = domainOf(p.url);
    const [existingOrg] = domain ? await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, mandateId), eq(organizations.domain, domain))) : [];
    const orgId = existingOrg?.id ?? (await db.insert(organizations).values({ mandateId, name: p.owner.slice(0, 200), nameNormalized: normalizeOrgName(p.owner), domain, website: p.url, source: "other", description: p.fit, roles: ["capital_provider"] }).onConflictDoNothing().returning({ id: organizations.id }))[0]?.id ?? null;
    await db.insert(capitalProfiles).values({ mandateId, orgId, name: p.name, capitalType: TYPE_OF[p.kind], geographies: geographiesOf(p), technologies: ["solar", "storage"], programmeKey: p.key, lane: LANE_OF[p.lanes[0]] ?? null, preference: "unknown", ticketBand: "unknown", routingStage: "new", source: `Programme catalogue (${actor})`, notes });
    created++;
  }
  return { created, updated };
}
