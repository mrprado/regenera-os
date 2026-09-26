import { describe, expect, it } from "vitest";
import { bboxOf, clipToBBox, geometryAreaKm2, lineLengthKm, parseCsvPoints, parseGeoJSON, parseKml, parseSpatial, ringAreaKm2 } from "@/lib/geo/geo";

describe("geo helpers", () => {
  it("geodesic area and length", () => {
    // 0.01° × 0.01° square at the equator ≈ 1.2364 km²
    const sq = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
    expect(ringAreaKm2(sq)).toBeCloseTo(1.2364, 2);
    expect(geometryAreaKm2({ type: "Polygon", coordinates: [sq] })).toBeCloseTo(1.2364, 2);
    expect(lineLengthKm([[0, 0], [0, 1]])).toBeCloseTo(111.2, 0);
  });

  it("parses GeoJSON, drops invalid geometries, and rejects lat/lng swaps beyond range", () => {
    const fc = parseGeoJSON(JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [-89.6, 20.9] }, properties: { a: 1 } },
      { type: "Feature", geometry: { type: "Point", coordinates: [200, 20] }, properties: {} },
    ] }));
    expect(fc.features).toHaveLength(1);
    expect(() => parseGeoJSON(JSON.stringify({ type: "Point", coordinates: [20.9, -189.6] }))).toThrow(/No valid features/);
  });

  it("parses KML placemarks and CSV points", () => {
    const kml = `<kml><Document><Placemark><name>Site A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-89.6,20.9,0 -89.5,20.9,0 -89.5,21.0,0 -89.6,20.9,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark><Placemark><name>Sub</name><Point><coordinates>-89.55,20.95</coordinates></Point></Placemark></Document></kml>`;
    const k = parseKml(kml);
    expect(k.features.map(f => [f.geometry.type, f.properties?.name])).toEqual([["Polygon", "Site A"], ["Point", "Sub"]]);
    const c = parseCsvPoints("name,latitude,longitude\nA,20.9,-89.6\nB,bad,-89.5");
    expect(c.features).toHaveLength(1);
    expect(c.features[0].properties).toEqual({ name: "A" });
    expect(() => parseSpatial("x.zip", "PK")).toThrow(/convert to GeoJSON/);
  });

  it("bbox and viewport clipping", () => {
    const fc = parseGeoJSON(JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [-89.6, 20.9] }, properties: {} },
      { type: "Feature", geometry: { type: "Point", coordinates: [10, 45] }, properties: {} },
    ] }));
    expect(bboxOf(fc)).toEqual([-89.6, 20.9, 10, 45]);
    expect(clipToBBox(fc, [-90, 20, -89, 21]).features).toHaveLength(1);
  });
});
