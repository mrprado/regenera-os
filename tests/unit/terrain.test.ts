// Terrain engine and vector geoprocessing on synthetic surfaces with known answers.
import { describe, expect, it } from "vitest";
import {
  chooseZoom, contourLines, cutFill, decodeTerrarium, delineateWatershed, elevationProfile, lineOfSight, lngLatToTile, maskPolygons, polygonMask,
  sampleElevation, slopeAspect, stats, tileToLat, tileToLng, viewshed, type DemGrid,
} from "@/lib/geo/dem";
import { bearingDistance, buffer, circle, destination, developmentEnvelope, measure, nearest, quantities, rectangle, union } from "@/lib/geo/ops";
import { fromUtm, parseAnyCoordinate, toUtm, utmZone } from "@/lib/geo/crs";

// ~1.1 km square at the equator, 100 × 100 cells (~11 m)
function grid(f: (x: number, y: number) => number, n = 100): DemGrid {
  const values = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) values[r * n + c] = f(c, r);
  return { width: n, height: n, west: 0, south: -0.005, east: 0.01, north: 0.005, values, source: "synthetic", resolutionM: 11.1 };
}
const cell = 0.01 / 100 * 111_320; // ≈ 11.13 m

describe("terrain engine", () => {
  it("decodes terrarium pixels and tiles", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBeCloseTo(100.5);
    const t = lngLatToTile(-99.13, 19.43, 10);
    expect(tileToLng(t.x, 10)).toBeLessThanOrEqual(-99.13);
    expect(tileToLat(t.y, 10)).toBeGreaterThanOrEqual(19.43);
    expect(chooseZoom(-99.2, 19.4, -99.1, 19.5)).toBeGreaterThanOrEqual(11);
  });

  it("slope and aspect on a plane rising to the east (10 %), downslope faces west", () => {
    const g = grid(c => c * cell * 0.1);
    const { slopePct, aspect } = slopeAspect(g);
    expect(slopePct[50 * 100 + 50]).toBeCloseTo(10, 0);
    expect(aspect[50 * 100 + 50]).toBeCloseTo(270, 0);
    expect(sampleElevation(g, 0.005, 0)).toBeCloseTo(50 * cell * 0.1, -1);
  });

  it("contours of a plane are evenly spaced lines; interval guard", () => {
    const g = grid(c => c * 1); // 0..99 m west→east
    const fc = contourLines(g, 10, 5);
    expect(fc.features.map(f => f.properties.elevation)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(fc.features.find(f => f.properties.elevation === 50)?.properties.major).toBe(true);
    expect(() => contourLines(g, 0.01)).toThrow(/Interval too small/);
  });

  it("threshold polygons report area from the mask", () => {
    const g = grid(c => c * 1);
    const mask = new Uint8Array(100 * 100).map((_, i) => (i % 100 < 50 ? 1 : 0));
    const res = maskPolygons(g, mask);
    expect(res.cells).toBe(5000);
    expect(res.areaHa).toBeCloseTo((5000 * cell * cell) / 10_000, 0);
    expect(res.geometry.coordinates.length).toBe(1);
  });

  it("profile across the plane: length, gain, max slope", () => {
    const g = grid(c => c * cell * 0.05); // 5 %
    const p = elevationProfile(g, [[0.001, 0], [0.009, 0]], 100);
    expect(p.lengthM).toBeCloseTo(0.008 * 111_320, -1);
    expect(p.gainM).toBeCloseTo(p.lengthM * 0.05, -1);
    expect(p.maxSlopePct).toBeCloseTo(5, 0);
    expect(() => elevationProfile(g, [[0, 0], [0, 0]])).toThrow();
  });

  it("watershed of a valley draining south covers the valley; a side point has a small catchment", () => {
    const g = grid((c, r) => Math.abs(c - 50) * 2 + (99 - r) * 0.5); // V-shaped valley, falling toward the south edge
    const w = delineateWatershed(g, [0.00505, -0.00495]);           // outlet at the south edge, valley floor
    expect(w.cells).toBeGreaterThan(9000);
    expect(w.elevation.min).toBeCloseTo(0, 0);
    const side = delineateWatershed(g, [0.001, 0.004], 0);         // high on the west slope, near the top
    expect(side.cells).toBeLessThan(200);
  });

  it("viewshed behind a ridge is hidden; line of sight blocked", () => {
    const g = grid(c => (c === 50 ? 200 : 0));
    const v = viewshed(g, [0.002, 0], 2, 0);
    const behind = v.cells; expect(behind).toBeLessThan(100 * 100 * 0.6);
    expect(lineOfSight(g, [0.002, 0], [0.008, 0]).visible).toBe(false);
    expect(lineOfSight(g, [0.002, 0], [0.004, 0]).visible).toBe(true);
  });

  it("cut and fill to the mean balance on a plane", () => {
    const g = grid(c => c * 1);
    const mask = polygonMask(g, [[[0.002, -0.002], [0.008, -0.002], [0.008, 0.002], [0.002, 0.002], [0.002, -0.002]]]);
    const cf = cutFill(g, mask);
    expect(Math.abs(cf.netM3) / cf.cutM3).toBeLessThan(0.05);
    expect(stats(g.values, mask).count).toBeGreaterThan(0);
  });
});

describe("vector operations", () => {
  const site = rectangle([0, 0], [0.01, 0.01]); // ~123 ha
  it("measures areas and lengths in several units", () => {
    const m = measure(site.geometry) as { areaHa: number; areaAcres: number; perimeterM: number };
    expect(m.areaHa).toBeGreaterThan(120);
    expect(m.areaAcres).toBeCloseTo(m.areaHa * 2.471, 0);
    const l = measure({ type: "LineString", coordinates: [[0, 0], [0, 0.01]] }) as { lengthM: number };
    expect(l.lengthM).toBeCloseTo(1112, -1);
  });

  it("bearing/distance entry round-trips", () => {
    const p = destination([0, 0], 90, 1000);
    const bd = bearingDistance([0, 0], p);
    expect(bd.distanceM).toBeCloseTo(1000, 0);
    expect(bd.bearing).toBeCloseTo(90, 0);
  });

  it("development envelope: site minus buffered hard constraints; soft reported separately", () => {
    const river = { type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: [[0.005, -0.001], [0.005, 0.011]] }, properties: {} };
    const wetland = circle([0.002, 0.002], 150);
    const res = developmentEnvelope(site, [
      { id: "water", label: "Watercourse buffer", kind: "hard", features: [river], bufferM: 100, source: "test" },
      { id: "wet", label: "Wetland", kind: "soft", features: [wetland], source: "test" },
    ]);
    expect(res.hardExcludedHa).toBeCloseTo(0.2 * 1.113 * 100, -1); // ~200 m wide strip × ~1.11 km
    expect(res.netHa).toBeCloseTo(res.siteHa - res.hardExcludedHa, 0);
    expect(res.softHa).toBeGreaterThan(5);
    expect(res.byConstraint.map(c => c.id)).toEqual(["water", "wet"]);
  });

  it("buffers, union, nearest and quantities", () => {
    const b = buffer({ type: "Point", coordinates: [0, 0] }, 500)!;
    expect((measure(b.geometry) as { areaHa: number }).areaHa).toBeCloseTo(78.5, 0);
    expect(union([b, circle([0.001, 0], 500)])).not.toBeNull();
    const n = nearest([0, 0], { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0.01] }, properties: { name: "far" } },
      { type: "Feature", geometry: { type: "LineString", coordinates: [[0.001, -1], [0.001, 1]] }, properties: { name: "line" } },
    ] });
    expect(n?.props.name).toBe("line");
    expect(n?.distanceM).toBeCloseTo(111, 0);
    const q = quantities([{ kind: "road", geometry: { type: "LineString", coordinates: [[0, 0], [0, 0.01]] } }, { kind: "solar", geometry: site.geometry }]);
    expect(q.road.lengthM).toBeCloseTo(1112, -1);
    expect(q.solar.areaHa).toBeGreaterThan(120);
  });
});

describe("coordinates", () => {
  it("UTM zones, round trip and parsing", () => {
    expect(utmZone(-99.13, 19.43)).toMatchObject({ zone: 14, hemisphere: "N", epsg: 32614 });
    const u = toUtm(-99.13, 19.43);
    const back = fromUtm(u.zone, u.hemisphere, u.easting, u.northing);
    expect(back[0]).toBeCloseTo(-99.13, 6); expect(back[1]).toBeCloseTo(19.43, 6);
    expect(parseAnyCoordinate("19.43, -99.13")).toEqual([-99.13, 19.43]);
    const dms = parseAnyCoordinate(`19°25'48"N 99°07'48"W`)!; expect(dms[1]).toBeCloseTo(19.43, 3); expect(dms[0]).toBeCloseTo(-99.13, 3);
    const utm = parseAnyCoordinate(`14N ${Math.round(u.easting)} ${Math.round(u.northing)}`)!; expect(utm[1]).toBeCloseTo(19.43, 3);
    expect(parseAnyCoordinate("Mérida")).toBeNull();
  });
});

import { rasterEnvelope } from "@/lib/geo/raster-envelope";
describe("raster development envelope", () => {
  const site = rectangle([0, 0], [0.01, 0.01]);
  it("matches the vector envelope within a few percent", () => {
    const river = { type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: [[0.005, -0.001], [0.005, 0.011]] }, properties: {} };
    const r = rasterEnvelope(site.geometry, [{ id: "water", label: "Watercourse", kind: "hard", features: [river], bufferM: 100, source: "test" }], 500);
    const v = developmentEnvelope(site, [{ id: "water", label: "Watercourse", kind: "hard", features: [river], bufferM: 100, source: "test" }]);
    expect(Math.abs(r.siteHa - v.siteHa) / v.siteHa).toBeLessThan(0.03);
    expect(Math.abs(r.hardExcludedHa - v.hardExcludedHa) / v.hardExcludedHa).toBeLessThan(0.06);
    expect(r.envelope?.type).toBe("MultiPolygon");
    expect(r.cellM).toBeGreaterThan(2);
  });
  it("stays bounded with thousands of constraint features", () => {
    const many = Array.from({ length: 4000 }, (_, i) => ({ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [[[0.0001 * (i % 90), 0.0001 * Math.floor(i / 90)], [0.0001 * (i % 90) + 0.00005, 0.0001 * Math.floor(i / 90)], [0.0001 * (i % 90) + 0.00005, 0.0001 * Math.floor(i / 90) + 0.00005], [0.0001 * (i % 90), 0.0001 * Math.floor(i / 90)]]] }, properties: {} }));
    const t0 = Date.now();
    const r = rasterEnvelope(site.geometry, [{ id: "b", label: "Buildings", kind: "hard", features: many, bufferM: 20, source: "test" }], 600);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.netHa).toBeLessThan(r.siteHa);
    expect(r.byConstraint[0].features).toBe(4000);
  });
});
