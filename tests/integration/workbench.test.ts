// ATLAS workbench records: typed features with measures, auditable analysis runs, field observations → task/risk,
// OSM element conversion and export writers.
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { fieldObservations, mandates, projects, risks, siteFeatures, spatialAnalyses, tasks } from "@/db/schema";
import { toFeature } from "@/lib/geo/osm";
import { toCsv, toDxf, toKml } from "@/lib/geo/export";
import { addObservation, convertObservation, listAnalyses, listFeatures, recordAnalysis, saveFeature } from "@/lib/geo/workbench";
import { createProject } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const M = "mandate_regenera";
beforeEach(async () => {
  for (const x of [fieldObservations, spatialAnalyses, siteFeatures, risks, tasks, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
});

const square = { type: "Polygon" as const, coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] };

it("saves typed features with geodesic measures and finds them by bbox and project", async () => {
  const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
  const f = await saveFeature(t.db, { mandateId: M, projectId: p.id, purpose: "development_envelope", name: "Envelope A", geometry: square, scenario: "A" }, "alan");
  expect(f.measures.areaHa).toBeGreaterThan(120);
  expect(f.grade).toBe("screening");
  expect((await listFeatures(t.db, [M], { bbox: [-1, -1, 1, 1] })).length).toBe(1);
  expect((await listFeatures(t.db, [M], { bbox: [10, 10, 11, 11] })).length).toBe(0);
  expect((await listFeatures(t.db, ["other"], { projectId: p.id })).length).toBe(0);
});

it("records analysis runs with datasets, parameters, grade and limitation", async () => {
  const r = await recordAnalysis(t.db, { mandateId: M, kind: "terrain", title: "Terrain", params: { interval: 5 }, datasets: [{ source: "AWS Terrain Tiles", resolution: "~30 m" }], results: { elevation: { min: 1, max: 2 } }, limitation: "SCREENING" }, "alan");
  const [row] = await listAnalyses(t.db, [M]);
  expect(row).toMatchObject({ id: r.id, kind: "terrain", grade: "screening", modelVersion: "atlas-workbench-1", params: { interval: 5 } });
  expect(await listAnalyses(t.db, [])).toEqual([]);
});

it("field observations validate coordinates and convert once to a task or a project risk", async () => {
  const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
  await expect(addObservation(t.db, { mandateId: M, lng: 200, lat: 0, category: "issue", note: "x" }, "alan")).rejects.toThrow(/Invalid/);
  const o = await addObservation(t.db, { mandateId: M, projectId: p.id, lng: -89.6, lat: 20.9, category: "water", note: "Possible wetland at the access track" }, "alan");
  const ref = await convertObservation(t.db, o.id, "risk", "alan");
  expect(ref).toMatch(/^risk:/);
  expect(await convertObservation(t.db, o.id, "task", "alan")).toBe(ref); // idempotent
  const [risk] = await t.db.select().from(risks);
  expect(risk.description).toContain("20.90000, -89.60000");
  const loose = await addObservation(t.db, { mandateId: M, lng: 1, lat: 1, category: "access", note: "Gate locked" }, "alan");
  await expect(convertObservation(t.db, loose.id, "risk", "alan")).rejects.toThrow(/project/);
  expect(await convertObservation(t.db, loose.id, "task", "alan")).toMatch(/^task:/);
});

it("OSM elements become GeoJSON; exports carry grade and CRS", () => {
  const way = toFeature({ type: "way", id: 1, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }], tags: { natural: "wetland", name: "Ciénaga" } } as never, "wetland", true);
  expect(way?.geometry.type).toBe("Polygon");
  expect(way?.properties).toMatchObject({ osmId: "way/1", name: "Ciénaga" });
  const line = toFeature({ type: "way", id: 2, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }], tags: { power: "line", voltage: "230000" } } as never, "transmission");
  expect(line?.geometry.type).toBe("LineString");
  const fc = { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: [[-99.1, 19.4], [-99.2, 19.5]] }, properties: { elevation: 2300, major: true, name: "=cmd" } }] };
  const meta = { title: "Contours", source: "AWS", grade: "SCREENING", crs: "WGS84", generatedAt: "2026-09-29" };
  expect(toKml(fc, meta)).toContain("<coordinates>-99.1,19.4 -99.2,19.5</coordinates>");
  expect(toCsv(fc, meta)).toContain("'=cmd"); // formula injection neutralised
  const dxf = toDxf(fc, meta, { utm: true, layerOf: () => "CONTOUR_MAJOR" });
  expect(dxf).toContain("UTM 14N");
  expect(dxf).toContain("CONTOUR_MAJOR");
  expect(dxf.trim().endsWith("EOF")).toBe(true);
});
