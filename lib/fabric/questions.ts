// Question layers (phase 19 part B): the user asks "Water risk", not "which provider". Each question has a source
// hierarchy (global screening → country pack → project evidence), answers from the stored place facts with provenance,
// lists the official sources to verify with for the project's country, and names what no automated source can tell.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { placeFacts, type projects } from "@/db/schema";
import { aqueductForSite } from "@/lib/data-providers/site";
import { PLACE_GAPS } from "@/lib/place/engine";
import { resolveIso3, type PlaceFact } from "@/lib/place/adapters";
import { levelCode } from "@/lib/ontology/taxonomies";
import { adminChain, climateTraceNear, soilgridsAt } from "./adapters";
import { packFor, type PackSource } from "./packs";
import { SOURCE_META } from "./sources";

type Project = typeof projects.$inferSelect;

export type Question = {
  label: string; asks: string;
  /** place_facts keys (exact) or prefixes ending in "*". */
  facts: string[];
  /** Pack domains to verify with at L2. */
  verify: string[];
  gaps: (keyof typeof PLACE_GAPS)[];
  /** Live connectors run on request; results are stored as place facts. */
  live: ("aqueduct" | "soilgrids" | "climate_trace" | "admin")[];
  hierarchy: string[];
  caution?: string;
};

export const QUESTIONS: Record<string, Question> = {
  water_risk: { label: "Water risk", asks: "Is water scarce, variable or flood-prone here?", facts: ["aq_*", "precip", "country_water_stress"], verify: ["water"], gaps: ["water"], live: ["aqueduct"],
    hierarchy: ["L1 WRI Aqueduct 4.0 (sub-basin)", "L1 NASA POWER precipitation", "L2 national water authority (pack)", "L3 hydrology study, water rights"] },
  grid_access: { label: "Grid access", asks: "How close is the grid, and what is queued there?", facts: ["nearest_substation", "country_elec_access", "country_renewable_share"], verify: ["grid"], gaps: ["infrastructure"], live: [],
    hierarchy: ["L0 OpenStreetMap power features", "L2 system operator and queue (pack)", "L3 interconnection study / agreement"],
    caution: "OpenStreetMap shows where infrastructure is mapped, not its capacity. Capacity comes from the system operator." },
  land_nature: { label: "Land & nature constraints", asks: "What land, habitat and species issues are likely?", facts: ["gbif_*", "country_forest", "admin_*"], verify: ["ecology", "land"], gaps: ["land", "ecology"], live: ["admin"],
    hierarchy: ["L1 GBIF occurrences", "L1 Global Forest Watch (boundary needed)", "L2 protected-area and land registries (pack)", "L3 ecological survey, title"],
    caution: "Absence of observations is not evidence of absence: few GBIF records can mean few surveys, not few species." },
  hazards: { label: "Hazards", asks: "Fire, earthquake, flood and storm exposure.", facts: ["quake*", "active_fires", "temp_mean"], verify: ["water"], gaps: ["climate"], live: [],
    hierarchy: ["L1 USGS earthquakes, NASA FIRMS fires, GDACS alerts", "L2 national hazard maps (pack)", "L3 site hazard assessment"] },
  resource: { label: "Solar & wind resource", asks: "How much sun and wind does the site get?", facts: ["solar_ghi", "pv_*", "wind_10m"], verify: ["resource"], gaps: [], live: [],
    hierarchy: ["L1 NASA POWER, PVGIS", "L2 NREL NSRDB / national met service (pack)", "L3 on-site measurement campaign, energy yield report"] },
  soils: { label: "Soils", asks: "Soil carbon, pH and texture for agriculture, restoration and foundations.", facts: ["soil_*"], verify: ["land"], gaps: ["land"], live: ["soilgrids"],
    hierarchy: ["L1 ISRIC SoilGrids (250 m model)", "L2 national soil survey (e.g. USDA SSURGO)", "L3 soil sampling, geotechnical report"],
    caution: "SoilGrids is a modelled estimate, not a measurement; foundations need a geotechnical investigation." },
  population: { label: "People & economy", asks: "Who lives around the site, and the country context.", facts: ["country_population", "country_gdp_pc", "admin_*"], verify: [], gaps: ["human"], live: ["admin"],
    hierarchy: ["L1 World Bank indicators", "L2 national census (pack)", "L3 stakeholder mapping and engagement records"],
    caution: "Communities and Indigenous rights are recorded in the Community / rights tab under their consent rules, never inferred from data." },
  emissions: { label: "Emitting assets nearby", asks: "Large emitters within 50 km (industry, power, extraction).", facts: ["ct_*"], verify: ["regulation"], gaps: [], live: ["climate_trace"],
    hierarchy: ["L1 Climate TRACE assets", "L2 national emissions / facility registers (pack)"] },
};
export type QuestionKey = keyof typeof QUESTIONS;

const matches = (key: string, patterns: string[]) => patterns.some(p => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));

export type Answer = { key: QuestionKey; q: Question; facts: (typeof placeFacts.$inferSelect & { level: string })[]; verify: PackSource[]; pack: string | null; gaps: string[] };

export function answer(key: QuestionKey, project: Project, stored: (typeof placeFacts.$inferSelect)[]): Answer {
  const q = QUESTIONS[key];
  const pack = packFor(project.country);
  return {
    key, q, pack: pack?.label ?? null,
    facts: stored.filter(f => matches(f.key, q.facts)).map(f => ({ ...f, level: levelCode(SOURCE_META[f.integrationKey]?.level ?? 1) })),
    verify: pack ? q.verify.flatMap(d => pack.domains[d] ?? []) : [],
    gaps: q.gaps.flatMap(g => PLACE_GAPS[g]),
  };
}

export async function answers(db: Db, project: Project) {
  const stored = await db.select().from(placeFacts).where(eq(placeFacts.projectId, project.id));
  return (Object.keys(QUESTIONS) as QuestionKey[]).map(k => answer(k, project, stored));
}

async function store(db: Db, project: Project, facts: PlaceFact[], now: Date) {
  for (const f of facts) {
    const row = { ...f, projectId: project.id, mandateId: project.mandateId, state: "api_derived" as const, retrievedAt: now.toISOString() };
    await db.insert(placeFacts).values(row).onConflictDoUpdate({ target: [placeFacts.projectId, placeFacts.key], set: { ...row, updatedAt: now.toISOString() } });
  }
  return facts.length;
}

/** Runs a question's live connectors for a project and stores what they return as place facts. */
export async function runLive(db: Db, project: Project, key: QuestionKey, fetchImpl?: typeof fetch, now = new Date()) {
  if (project.lat === null || project.lng === null) throw new Error("Add the project's location first (Place tab or Atlas).");
  const lat = project.lat, lng = project.lng;
  const out: PlaceFact[] = []; const failed: string[] = [];
  for (const live of QUESTIONS[key].live) {
    try {
      if (live === "soilgrids") out.push(...await soilgridsAt(db, lat, lng, fetchImpl));
      if (live === "aqueduct") {
        const r = await aqueductForSite(db, lat, lng, fetchImpl);
        for (const x of r.readings) out.push({ dimension: "water", key: `aq_${x.indicator}`, label: `${x.label} (Aqueduct 4.0)`, value: x.categoryLabel ?? (x.score !== null ? `score ${x.score.toFixed(1)} of 5` : "no value"), numeric: x.score, unit: "score 0–5", integrationKey: "resource_watch", sourceUrl: "https://www.wri.org/aqueduct", tier: 2, license: "CC BY 4.0, WRI", observedFor: `Baseline, sub-basin${r.basin ? ` ${r.basin}` : ""}` });
      }
      if (live === "admin") {
        const c = await adminChain(db, lat, lng, fetchImpl);
        if (!c) { failed.push("OpenStreetMap reverse lookup is busy; try again in a few seconds."); continue; }
        const chain = [c.municipality, c.county, c.state, c.country].filter(Boolean).join(" → ");
        if (chain) out.push({ dimension: "human", key: "admin_chain", label: "Administrative hierarchy", value: chain, numeric: null, unit: null, integrationKey: "nominatim", sourceUrl: "https://www.openstreetmap.org/copyright", tier: 3, license: "ODbL, © OpenStreetMap contributors", observedFor: "Current boundaries" });
      }
      if (live === "climate_trace") {
        const iso3 = project.country ? await resolveIso3(db, project.country, fetchImpl) : null;
        if (!iso3) { failed.push("Climate TRACE needs the project's country."); continue; }
        const r = await climateTraceNear(db, iso3, lat, lng, 50, fetchImpl);
        const top = r.assets.slice(0, 5).map(a => `${a.name} (${a.km} km${a.co2eTonnes ? `, ${Math.round(a.co2eTonnes / 1000).toLocaleString("en-US")} kt CO₂e` : ""})`).join("; ");
        out.push({ dimension: "infrastructure", key: "ct_assets_50km", label: "Emitting assets within 50 km (Climate TRACE)", value: r.assets.length ? `${r.assets.length}: ${top}` : `None among the ${r.sampled} assets returned for ${iso3}`, numeric: r.assets.length, unit: "assets", integrationKey: "climate_trace", sourceUrl: "https://climatetrace.org", tier: 2, license: "CC BY 4.0, Climate TRACE", observedFor: `First ${r.sampled} assets listed for the country` });
      }
    } catch (e) { failed.push(`${live}: ${(e as Error).message.slice(0, 160)}`); }
  }
  return { stored: await store(db, project, out, now), failed };
}

/** Stored facts for one project and one key pattern, for tests and the Atlas inspector. */
export async function factsFor(db: Db, projectId: string, key: QuestionKey) {
  const rows = await db.select().from(placeFacts).where(and(eq(placeFacts.projectId, projectId)));
  return rows.filter(f => matches(f.key, QUESTIONS[key].facts));
}
