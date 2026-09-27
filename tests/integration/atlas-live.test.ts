// Atlas live feeds go through fetchJson: registry gate, compact cache, ledger and stale fallback.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { integrations, providerCalls, sourceCache } from "@/db/schema";
import { clearIntegrationCache, ensureIntegrations } from "@/lib/integrations/engine";
import { fires, flights, quakes, satellites } from "@/lib/map/live";
import { buildSats, position } from "@/app/(app)/map/satellites";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); await ensureIntegrations(t.db); });
afterAll(async () => { await t?.dispose(); });
beforeEach(() => clearIntegrationCache());

const json = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

it("quakes are cached compactly and served from cache; the ledger records the call", async () => {
  let calls = 0;
  const impl = (async () => { calls += 1; return new Response(JSON.stringify({ features: [{ id: "q1", geometry: { coordinates: [10, 20, 5] }, properties: { mag: 4.2, place: "Somewhere", time: Date.now() } }] }), { status: 200 }); }) as typeof fetch;
  expect((await quakes(t.db, impl)).features).toHaveLength(1);
  expect((await quakes(t.db, impl)).features).toHaveLength(1);
  expect(calls).toBe(1);
  const [cached] = await t.db.select().from(sourceCache).where(eq(sourceCache.key, "usgs_quakes:atlas:2.5_week"));
  expect(JSON.parse(cached.value)[0][0]).toBe("q1");
  expect((await t.db.select().from(providerCalls).where(eq(providerCalls.provider, "usgs_quakes"))).length).toBeGreaterThan(0);
});

it("a disabled integration is never called", async () => {
  await t.db.update(integrations).set({ featureState: "disabled" }).where(eq(integrations.key, "adsb_lol"));
  clearIntegrationCache();
  let called = false;
  await expect(flights(t.db, 51.5, -0.4, 100, (async () => { called = true; return new Response("{}"); }) as typeof fetch)).rejects.toThrow(/disabled/);
  expect(called).toBe(false);
  await t.db.update(integrations).set({ featureState: "enabled" }).where(eq(integrations.key, "adsb_lol"));
});

it("fires use the keyless MODIS file without a key and the VIIRS area API with one", async () => {
  const urls: string[] = [];
  const impl = (async (u: string) => { urls.push(String(u)); return new Response("latitude,longitude,frp,confidence,acq_date,acq_time\n10,10,40,90,2026-09-26,0100\n50,50,5,80,2026-09-26,0100", { status: 200 }); }) as unknown as typeof fetch;
  const global = await fires(t.db, undefined, [0, 0, 20, 20], impl);
  expect(global.meta).toMatchObject({ count: 1, source: "NASA FIRMS MODIS 1 km" });
  const viewport = await fires(t.db, "MAPKEY", [0, 0, 20, 20], impl);
  expect(viewport.meta.source).toBe("NASA FIRMS VIIRS 375 m");
  expect(urls[0]).toContain("MODIS_C6_1_Global_24h.csv");
  expect(urls[1]).toContain("/api/area/csv/MAPKEY/VIIRS_NOAA20_NRT/0,0,20,20/1");
});

it("satellite elements propagate to plausible LEO positions", async () => {
  const epoch = new Date().toISOString().replace("Z", "");
  const r = await satellites(t.db, "stations", json([{ OBJECT_NAME: "ISS (ZARYA)", OBJECT_ID: "1998-067A", EPOCH: epoch, MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.6, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 50, MEAN_ANOMALY: 300, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0 }]));
  const [iss] = buildSats(r.elements);
  const p = position(iss, new Date())!;
  expect(p.altKm).toBeGreaterThan(300);
  expect(p.altKm).toBeLessThan(500);
  expect(Math.abs(p.lat)).toBeLessThanOrEqual(51.7);
  expect(p.speedKms).toBeGreaterThan(7);
});
