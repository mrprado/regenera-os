import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { integrations, mandates, placeFacts, projectReadiness, projects, projectStageHistory, providerCalls, sourceCache, systemState } from "@/db/schema";
import { clearIntegrationCache, ensureIntegrations, integrationHealth } from "@/lib/integrations/engine";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { gbifBiodiversity, haversineKm, nasaPower, overpassInfrastructure, usgsSeismic, wbIndicators } from "@/lib/place/adapters";
import { buildPlaceProfile } from "@/lib/place/engine";
import { createProject } from "@/lib/projects/engine";
import { fetchJson } from "@/lib/sources/http";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera";
const NOW = new Date("2026-09-24T12:00:00Z");

beforeEach(async () => {
  for (const x of [placeFacts, projectReadiness, projectStageHistory, projects, integrations, providerCalls, sourceCache, systemState, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  clearIntegrationCache();
});

/** A fake fetch that answers by URL; records calls. */
const fake = (routes: [RegExp, unknown | ((url: string) => Response)][]) => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const r = routes.find(([re]) => re.test(url));
    if (!r) return new Response("not found", { status: 404 });
    return typeof r[1] === "function" ? (r[1] as (u: string) => Response)(url) : Response.json(r[1]);
  }) as unknown as typeof fetch;
  return { f, calls };
};

const POWER = { properties: { parameter: { ALLSKY_SFC_SW_DWN: { ANN: 5.87 }, T2M: { ANN: 26.1 }, PRECTOTCORR: { ANN: 3.2 }, WS10M: { ANN: 3.4 } } } };
const PVGIS = { inputs: { location: { latitude: 20.97, longitude: -89.62 } }, outputs: { totals: { fixed: { E_y: 1712.4, "H(i)_y": 2210.2, SD_y: 41.3 } } } };
const WB_COUNTRIES = [{}, [{ id: "MEX", iso2Code: "MX", name: "Mexico" }, { id: "PER", iso2Code: "PE", name: "Peru" }]];
const WB_VALUE = [{}, [{ date: "2023", value: 99.4 }]];
const OVERPASS = { elements: [
  { type: "count", tags: { total: "3" } }, { type: "count", tags: { total: "12" } }, { type: "count", tags: { total: "7" } }, { type: "count", tags: { total: "2" } },
  { type: "node", lat: 20.99, lon: -89.62 }, { type: "way", center: { lat: 21.3, lon: -89.6 } },
] };

describe("integration registry", () => {
  it("seeds every provider and keeps an owner's override on reseed", async () => {
    expect(await ensureIntegrations(t.db)).toBe(INTEGRATIONS.length);
    await t.db.update(integrations).set({ featureState: "disabled", stateOverridden: true }).where(eq(integrations.key, "gbif"));
    await ensureIntegrations(t.db);
    expect((await t.db.select().from(integrations).where(eq(integrations.key, "gbif")))[0].featureState).toBe("disabled");
    expect((await t.db.select().from(integrations).where(eq(integrations.key, "open_meteo")))[0].featureState).toBe("license_required");
  });

  it("never calls a licence-required or disabled source, and serves the last good copy when a source fails", async () => {
    await ensureIntegrations(t.db);
    const { f, calls } = fake([[/.*/, { ok: true }]]);
    await expect(fetchJson(t.db, { provider: "open_meteo", endpoint: "x", url: "https://api.open-meteo.com/x", schema: z.object({ ok: z.boolean() }), fetchImpl: f })).rejects.toThrow("licence");
    expect(calls).toHaveLength(0);
    const ok = fake([[/.*/, { v: 1 }]]);
    await fetchJson(t.db, { provider: "nasa_power", endpoint: "x", url: "https://power.test/x", schema: z.object({ v: z.number() }), cacheKey: "k", cacheTtlMs: 1, fetchImpl: ok.f, now: new Date("2026-01-01T00:00:00Z") });
    const down = fake([[/.*/, () => new Response("down", { status: 503 })]]);
    const stale = await fetchJson(t.db, { provider: "nasa_power", endpoint: "x", url: "https://power.test/x", schema: z.object({ v: z.number() }), cacheKey: "k", cacheTtlMs: 1, fetchImpl: down.f, staleOnError: true, retries: 0 });
    expect(stale).toEqual({ v: 1 });
    const h = await integrationHealth(t.db, new Date());
    expect(h.get("nasa_power")).toMatchObject({ failures24h: 1 });
  });
});

describe("place adapters", () => {
  it("NASA POWER turns climatology into solar, temperature, rain and wind facts", async () => {
    const facts = await nasaPower(t.db, 20.97, -89.62, fake([[/power\.larc\.nasa\.gov/, POWER]]).f);
    expect(facts.find(f => f.key === "solar_ghi")).toMatchObject({ numeric: 5.87, value: "5.87 kWh/m²/day (2,142.6 kWh/m²/year)", tier: 2, dimension: "climate" });
    expect(facts.find(f => f.key === "precip")).toMatchObject({ numeric: 1168, dimension: "water" });
  });

  it("World Bank resolves country names and returns dated country indicators", async () => {
    const facts = await wbIndicators(t.db, "Mexico", fake([[/country\?format/, WB_COUNTRIES], [/indicator/, WB_VALUE]]).f);
    expect(facts).toHaveLength(6);
    expect(facts.find(f => f.key === "country_elec_access")).toMatchObject({ value: "99.4%", observedFor: "2023", license: "CC BY 4.0, World Bank" });
    expect(await wbIndicators(t.db, "Atlantis", fake([[/country\?format/, WB_COUNTRIES]]).f)).toEqual([]);
  });

  it("Overpass counts infrastructure and finds the nearest substation", async () => {
    const facts = await overpassInfrastructure(t.db, 20.97, -89.62, fake([[/overpass-api/, OVERPASS]]).f);
    expect(facts.find(f => f.key === "substations_20km")?.numeric).toBe(3);
    expect(facts.find(f => f.key === "nearest_substation")?.numeric).toBe(2.2);
    expect(Math.round(haversineKm([0, 0], [0, 1]))).toBe(111);
  });

  it("USGS and GBIF return seismic history and aggregate biodiversity counts", async () => {
    const q = await usgsSeismic(t.db, 20.97, -89.62, fake([[/count\?/, { count: 4 }], [/query\?/, { features: [{ properties: { mag: 6.1, place: "Gulf of Mexico", time: Date.parse("2019-03-01") } }] }]]).f);
    expect(q.map(f => f.value)).toEqual(["4", "M6.1, Gulf of Mexico (2019-03-01)"]);
    const g = await gbifBiodiversity(t.db, 20.97, -89.62, fake([
      [/iucnRedListCategory/, { count: 40, facets: [{ counts: [{ name: "1", count: 30 }, { name: "2", count: 10 }] }] }],
      [/occurrence\/search/, { count: 15230, facets: [{ counts: Array.from({ length: 812 }, (_, i) => ({ name: String(i), count: 1 })) }] }],
    ]).f);
    expect(g.map(f => [f.key, f.numeric])).toEqual([["gbif_occurrences", 15230], ["gbif_species", 812], ["gbif_threatened", 2]]);
    expect(g[0].license).toContain("not reproduced");
  });
});

describe("place profile", () => {
  it("writes facts with provenance; a failing source keeps its old facts, marked stale", async () => {
    await ensureIntegrations(t.db);
    const p = await createProject(t.db, { mandateId: M, name: "Valle Solar", country: "Mexico", lat: 20.97, lng: -89.62 }, "alan");
    const all = fake([[/power\.larc/, POWER], [/re\.jrc/, PVGIS], [/country\?format/, WB_COUNTRIES], [/indicator/, WB_VALUE], [/overpass-api/, OVERPASS], [/count\?/, { count: 0 }], [/occurrence/, { count: 10, facets: [{ counts: [] }] }]]);
    const first = await buildPlaceProfile(t.db, p.id, all.f, NOW);
    expect(first.failed).toEqual([]);
    expect(first.written).toBeGreaterThan(15);
    const [ghi] = await t.db.select().from(placeFacts).where(eq(placeFacts.key, "solar_ghi"));
    expect(ghi).toMatchObject({ integrationKey: "nasa_power", tier: 2, state: "api_derived", retrievedAt: NOW.toISOString() });

    await t.db.delete(sourceCache); // force live calls
    const nasaDown = fake([[/power\.larc/, () => new Response("down", { status: 503 })], [/re\.jrc/, PVGIS], [/country\?format/, WB_COUNTRIES], [/indicator/, WB_VALUE], [/overpass-api/, OVERPASS], [/count\?/, { count: 0 }], [/occurrence/, { count: 10, facets: [{ counts: [] }] }]]);
    const second = await buildPlaceProfile(t.db, p.id, nasaDown.f, new Date("2026-10-24T12:00:00Z"));
    expect(second.failed.map(f => f.source)).toEqual(["nasa_power"]);
    expect((await t.db.select().from(placeFacts).where(eq(placeFacts.key, "solar_ghi")))[0].state).toBe("stale");
    expect((await t.db.select().from(placeFacts).where(eq(placeFacts.key, "substations_20km")))[0].state).toBe("api_derived");
  });
});
