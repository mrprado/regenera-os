// Place profile builder (docs/plans/phase-6.md M6). Every fact carries its source, tier, licence and retrieval date.
// A failing source never blocks the others; its previous facts stay, marked stale.
import { and, asc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { placeFacts, projects } from "@/db/schema";
import { gbifBiodiversity, nasaPower, overpassInfrastructure, usgsSeismic, wbIndicators, type PlaceFact } from "./adapters";

export type PlaceBuild = { written: number; failed: { source: string; error: string }[] };

export async function buildPlaceProfile(db: Db, projectId: string, fetchImpl?: typeof fetch, now = new Date()): Promise<PlaceBuild> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const out: PlaceBuild = { written: 0, failed: [] };
  const hasPoint = p.lat !== null && p.lng !== null;
  const tasks: [string, () => Promise<PlaceFact[]>][] = [
    ...(hasPoint ? [
      ["nasa_power", () => nasaPower(db, p.lat!, p.lng!, fetchImpl)],
      ["overpass", () => overpassInfrastructure(db, p.lat!, p.lng!, fetchImpl)],
      ["usgs_quakes", () => usgsSeismic(db, p.lat!, p.lng!, fetchImpl)],
      ["gbif", () => gbifBiodiversity(db, p.lat!, p.lng!, fetchImpl)],
    ] as [string, () => Promise<PlaceFact[]>][] : []),
    ...(p.country ? [["wb_indicators", () => wbIndicators(db, p.country!, fetchImpl)]] as [string, () => Promise<PlaceFact[]>][] : []),
  ];
  for (const [source, run] of tasks) {
    try {
      for (const f of await run()) {
        const row = { ...f, projectId, mandateId: p.mandateId, state: "api_derived" as const, retrievedAt: now.toISOString() };
        await db.insert(placeFacts).values(row).onConflictDoUpdate({ target: [placeFacts.projectId, placeFacts.key], set: { ...row, updatedAt: now.toISOString() } });
        out.written++;
      }
    } catch (e) {
      out.failed.push({ source, error: (e as Error).message.slice(0, 200) });
      await db.update(placeFacts).set({ state: "stale", updatedAt: now.toISOString() }).where(and(eq(placeFacts.projectId, projectId), eq(placeFacts.integrationKey, source)));
    }
  }
  return out;
}

/** Projects with a location whose place profile is missing or older than 30 days (oldest first). */
export async function projectsNeedingPlace(db: Db, now = new Date(), limit = 3) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const rows = await db.select({ id: projects.id, oldest: sql<string | null>`(select min(${placeFacts.retrievedAt}) from ${placeFacts} where ${placeFacts.projectId} = ${projects.id})` })
    .from(projects).where(and(isNull(projects.archivedAt), isNotNull(projects.lat), isNotNull(projects.lng))).orderBy(asc(projects.updatedAt)).limit(200);
  return rows.filter(r => !r.oldest || r.oldest < cutoff).slice(0, limit).map(r => r.id);
}

export const PLACE_DIMENSIONS = { land: "Land", water: "Water", climate: "Climate", ecology: "Ecology", human: "Human", infrastructure: "Infrastructure" } as const;

/** What the automated sources cannot tell: shown as open questions, never guessed. */
export const PLACE_GAPS: Record<keyof typeof PLACE_DIMENSIONS, string[]> = {
  land: ["Parcel identifiers, registry authority and dated boundary/survey evidence", "Ownership, tenure and land assembly across parcels", "Lease/option, easements, rights of way and legal access", "Planning zoning, assessed land use and actual use (record separately)", "Soil classes and area coverage, slope and geotechnical conditions", "Contamination and recorded title restrictions", "Indicative developable area after sourced exclusions and setbacks"],
  water: ["Watershed and aquifer", "Floodplain and wetlands with source dates and coverage", "Water rights, wells and quality"],
  climate: ["Flood, drought, wildfire, cyclone and heat exposure at site level"],
  ecology: ["Protected areas and critical habitat (licensed data: Protected Planet, IBAT)", "Land cover and connectivity"],
  human: ["Communities and settlements", "Indigenous and cultural heritage considerations"],
  infrastructure: ["Grid capacity and interconnection queue (utility)", "Legal road access, utility servicing and easement corridors", "Ports, rail and logistics routes"],
};

export async function staleFacts(db: Db, projectId: string) {
  return db.select().from(placeFacts).where(and(eq(placeFacts.projectId, projectId), lt(placeFacts.retrievedAt, new Date(Date.now() - 180 * 86_400_000).toISOString())));
}
