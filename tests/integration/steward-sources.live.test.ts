// Bounded LIVE smoke test for the enabled Steward connectors (phase 28B). Skipped unless STEWARD_LIVE=1. Uses a public
// location (Mérida city centre) in an isolated test database: an explicitly labelled integration test, never production.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mandates, stewardSourceRecords } from "@/db/schema";
import { createPlace } from "@/lib/steward/engine";
import { placeSourceStates, runSourceForPlace, syncSourceRegister } from "@/lib/steward/sources/pipeline";
import { createTestDb } from "../helpers/d1";

const LIVE = process.env.STEWARD_LIVE === "1";
const M = "f0000000-0000-4000-8000-000000000001";
let t: Awaited<ReturnType<typeof createTestDb>>;
let placeId = "";

describe.skipIf(!LIVE)("steward connectors, live", () => {
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(mandates).values({ id: M, slug: "live-test", name: "Live integration test", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
    await syncSourceRegister(t.db);
    const p = await createPlace(t.db, { mandateId: M, name: "LIVE TEST: Mérida centre (public location)", geometry: { type: "Polygon", coordinates: [[[-89.63, 20.96], [-89.61, 20.96], [-89.61, 20.98], [-89.63, 20.98], [-89.63, 20.96]]] }, accuracy: "approximate" }, "live-test");
    placeId = p.id;
  }, 240_000);
  afterAll(async () => { await t?.dispose(); });

  for (const key of ["gbif_occurrence", "soilgrids", "cdse_stac"]) {
    it(`${key}: real bounded query, persisted with provenance, idempotent on refresh`, async () => {
      const first = await runSourceForPlace(t.db, { placeId, sourceKey: key, actor: "live-test" });
      console.log(`[live] ${key}: ${first.state} · ${first.message}`);
      expect(["available", "no_records"]).toContain(first.state);
      const second = await runSourceForPlace(t.db, { placeId, sourceKey: key, actor: "live-test" });
      console.log(`[live] ${key} refresh: ${second.message}`);
      expect(second.added).toBe(0);
      const rows = await t.db.select().from(stewardSourceRecords).where(eq(stewardSourceRecords.sourceKey, key));
      if (rows.length) {
        const r = rows[0];
        console.log(`[live] ${key} sample: ${r.title} · value ${r.value ?? "—"} ${r.unit} · observed ${r.observedStart ?? "undated/modelled"} · ${r.license} · ${r.sourceUrl}`);
        expect(r.retrievedAt).toBeTruthy();
        expect(r.license).toBeTruthy();
      }
      const state = (await placeSourceStates(t.db, placeId)).find(x => x.source.key === key)!;
      console.log(`[live] ${key} latest observation: ${state.last?.latestObservation ?? "none"} · limitations: ${state.last?.limitations}`);
    }, 240_000);
  }
});
