// Phase 28B pipeline with deterministic mocked responses (these prove the pipeline, not that a live source works;
// the bounded live checks are in tests/integration/steward-sources.live.test.ts and run only with STEWARD_LIVE=1).
// Covers: licence exclusion, idempotency and revisions (Workflow D), failure and HTML detection (Workflow E), empty
// results as "no records", disabled sources, missing geometry, point-only limits, no-data values never stored as zero.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mandates, stewardSourceRecords, stewardSources } from "@/db/schema";
import { createPlace } from "@/lib/steward/engine";
import { placeSourceStates, runSourceForPlace, syncSourceRegister } from "@/lib/steward/sources/pipeline";
import { createTestDb } from "../helpers/d1";

const M = "e0000000-0000-4000-8000-000000000001";
const SQUARE = { type: "Polygon", coordinates: [[[-89.65, 20.85], [-89.55, 20.85], [-89.55, 20.95], [-89.65, 20.95], [-89.65, 20.85]]] };
let t: Awaited<ReturnType<typeof createTestDb>>;
const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const occ = (key: number, name: string, license: string, extra: Record<string, unknown> = {}) => ({ key, scientificName: name, license, decimalLatitude: 20.9, decimalLongitude: -89.6, coordinateUncertaintyInMeters: 30, eventDate: "2025-05-01T10:00:00", basisOfRecord: "HUMAN_OBSERVATION", datasetKey: "ds1", issues: [], ...extra });

beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(mandates).values({ id: M, slug: "m", name: "m", type: "advisory", rules: { massAllowed: false, approvalRequired: true } });
  await syncSourceRegister(t.db);
}, 120_000);
afterAll(async () => { await t?.dispose(); });

describe("steward source pipeline", () => {
  it("writes the register with rights kept apart and blocked sources disabled with their reason", async () => {
    const rows = await t.db.select().from(stewardSources);
    expect(rows.length).toBeGreaterThan(15);
    const pp = rows.find(r => r.key === "protected_planet")!;
    expect(pp).toMatchObject({ enabled: false, commercialUse: "prohibited", health: "license_required" });
    expect(rows.find(r => r.key === "gbif_occurrence")).toMatchObject({ enabled: true, commercialUse: "conditional" });
    expect(rows.find(r => r.key === "firms")!.blockedReason).toMatch(/MAP_KEY/);
  });

  it("stores only commercially usable records, is idempotent, and tracks revisions (Workflow D)", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Mérida test square", geometry: SQUARE, accuracy: "digitised" }, "test");
    const page = (recs: unknown[]) => json({ offset: 0, limit: 300, endOfRecords: true, count: recs.length, results: recs });
    const first = [occ(1, "Cardinalis cardinalis", "http://creativecommons.org/licenses/by/4.0/legalcode"), occ(2, "Crotophaga sulcirostris", "http://creativecommons.org/publicdomain/zero/1.0/legalcode"), occ(3, "Ortalis vetula", "http://creativecommons.org/licenses/by-nc/4.0/legalcode")];
    const a = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: page(first) });
    expect(a).toMatchObject({ state: "available", records: 2, added: 2, revised: 0, excluded: 1 });
    const again = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: page(first) });
    expect(again).toMatchObject({ added: 0, revised: 0 });
    expect((await t.db.select().from(stewardSourceRecords).where(eq(stewardSourceRecords.placeId, place.id)))).toHaveLength(2);
    const revisedPage = [occ(1, "Cardinalis cardinalis", "http://creativecommons.org/licenses/by/4.0/legalcode", { coordinateUncertaintyInMeters: 5 }), first[1]];
    const r = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: page(revisedPage) });
    expect(r).toMatchObject({ added: 0, revised: 1 });
    const rec = (await t.db.select().from(stewardSourceRecords).where(eq(stewardSourceRecords.recordId, "1")))[0];
    expect(rec).toMatchObject({ revision: 2, precisionM: 5, observedStart: "2025-05-01" });
    expect(rec.retrievedAt).not.toBe(rec.observedStart); // retrieval time never stands in for observation time
  });

  it("reports failures and web pages honestly, and never stores them as data (Workflow E)", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Failure square", geometry: SQUARE, accuracy: "digitised" }, "test");
    const html = (async () => new Response("<!DOCTYPE html><html><title>Just a moment...</title></html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const f = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: html });
    expect(f.state).toBe("failed");
    expect(f.message).toMatch(/web page instead of data/);
    expect((await t.db.select().from(stewardSources).where(eq(stewardSources.key, "gbif_occurrence")))[0].health).toBe("failing");
    const e = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: json({ error: "bad" }, 500) });
    expect(e.state).toBe("failed");
    const empty = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: json({ offset: 0, limit: 300, endOfRecords: true, count: 0, results: [] }) });
    expect(empty.state).toBe("no_records");
    expect(empty.message).toMatch(/not evidence of absence/);
    const states = await placeSourceStates(t.db, place.id);
    expect(states.find(x => x.source.key === "gbif_occurrence")!.state).toBe("no_records");
    expect(states.find(x => x.source.key === "soilgrids")!.state).toBe("not_queried");
    expect((await t.db.select().from(stewardSourceRecords).where(eq(stewardSourceRecords.placeId, place.id)))).toHaveLength(0);
  });

  it("refuses disabled sources and places without geometry with a stated reason", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "No geometry" }, "test");
    expect((await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: json({}) })).state).toBe("insufficient");
    const blocked = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "protected_planet", actor: "test", fetchImpl: json({}) });
    expect(blocked.state).toBe("restricted");
    expect(blocked.message).toMatch(/commercial/);
  });

  it("states point-only limits and skips no-data soil values instead of storing zero", async () => {
    const place = await createPlace(t.db, { mandateId: M, name: "Point", geometry: { type: "Point", coordinates: [-89.6, 20.9] }, accuracy: "project_point" }, "test");
    const soil = json({ type: "Feature", properties: { layers: [
      { name: "soc", unit_measure: { d_factor: 10, target_units: "g/kg" }, depths: [{ label: "0-5cm", values: { mean: 588, "Q0.05": 300, "Q0.95": 900 } }, { label: "5-15cm", values: { mean: null, "Q0.05": null, "Q0.95": null } }] },
    ] } });
    const r = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "soilgrids", actor: "test", fetchImpl: soil });
    expect(r).toMatchObject({ state: "available", records: 1 });
    const [rec] = await t.db.select().from(stewardSourceRecords).where(eq(stewardSourceRecords.placeId, place.id));
    expect(rec).toMatchObject({ value: "58.8", unit: "g/kg", observedStart: null });
    expect(rec.uncertainty).toMatch(/30–90 g\/kg/);
    const g = await runSourceForPlace(t.db, { placeId: place.id, sourceKey: "gbif_occurrence", actor: "test", fetchImpl: json({ offset: 0, limit: 300, endOfRecords: true, count: 0, results: [] }) });
    const states = await placeSourceStates(t.db, place.id);
    expect(states.find(x => x.source.key === "gbif_occurrence")!.last!.limitations).toMatch(/Place is a point/);
    expect(g.state).toBe("no_records");
  });
});
