// Atlas contents-panel filters (2026-10-06): multi-type union, intersection across dimensions, lifecycle mapping, map-area
// filtering across the antimeridian, boundary containment, chip counts, and objective suggestions that only add layers.
// Run: node --experimental-strip-types tests/atlas-filters.node.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetTypesOf, filterRecords, inBounds, lifecycleOf, mapRecords, pointInArea, typeCounts } from "../lib/map/discovery.ts";
import { OBJECTIVES, objectiveById, suggestion } from "../lib/map/objectives.ts";

const pt = (properties, coordinates) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
const data = {
  projects: { features: [
    pt({ id: "a", name: "Desert Sun", assetClass: "solar", technology: "PV + BESS 4h", stage: "development", country: "MEX", region: "Sonora" }, [-110, 29]),
    pt({ id: "b", name: "Coast Wind", assetClass: "wind", stage: "operations", country: "MEX", region: "Oaxaca" }, [-95, 16]),
    pt({ id: "c", name: "Solar Named Farm", stage: "opportunity", country: "FJI" }, [179.5, -17]),   // no recorded class: never typed from its name
    pt({ id: "d", name: "Old Mill", assetClass: "industrial", stage: "repowering", country: "GBR" }, [0, 51.5]),
  ] },
  organizations: { features: [pt({ id: "o", name: "Solar Org", country: "MEX" }, [-99, 19])] },
  deals: { features: [pt({ id: "x", name: "Deal", stage: "development", country: "MEX" }, [-100, 20])] },
  triggers: { features: [] }, procurement: { features: [] },
};
const all = mapRecords(data);
const base = { query: "", country: "", sector: "", topic: "" };
const ids = rs => rs.map(r => r.feature.properties.id).sort();

test("types come from recorded class and technology only; a project can have several", () => {
  assert.deepEqual(assetTypesOf({ assetClass: "solar", technology: "PV + BESS 4h" }).sort(), ["solar", "solar_storage", "storage"]);
  assert.deepEqual(assetTypesOf({ name: "Solar Named Farm" }), []);
  assert.deepEqual(assetTypesOf({ assetClass: "industrial" }), ["industrial_redevelopment"]);
});
test("types are a union within the dimension and intersect with other filters", () => {
  assert.deepEqual(ids(filterRecords(all, { ...base, types: ["wind", "storage"] }, {})), ["a", "b"]);
  assert.deepEqual(ids(filterRecords(all, { ...base, types: ["wind", "storage"], region: "Oaxaca" }, {})), ["b"]);
  assert.deepEqual(ids(filterRecords(all, { ...base, types: ["solar"] }, { projects: false })), []);
});
test("lifecycle maps canonical stages and applies to projects only", () => {
  assert.equal(lifecycleOf("financial_close"), "development");
  assert.equal(lifecycleOf("repowering"), "redevelopment");
  assert.equal(lifecycleOf("unknown"), null);
  assert.deepEqual(ids(filterRecords(all, { ...base, lifecycle: "development" }, {})), ["a"]);   // the deal at stage development is excluded
});
test("map area handles the antimeridian, the equator and prime meridian", () => {
  const pacific = { west: 170, south: -30, east: -170, north: 0 };
  assert.ok(inBounds([179.5, -17], pacific));
  assert.ok(inBounds([-175, -5], pacific));
  assert.ok(!inBounds([0, -5], pacific));
  assert.ok(inBounds([0, 0], { west: -1, south: -1, east: 1, north: 1 }));
  assert.ok(inBounds([120, 10], { west: -400, south: -90, east: 400, north: 90 }));
  assert.deepEqual(ids(filterRecords(all, { ...base, bounds: pacific }, {})), ["c"]);
});
test("boundary filtering uses containment and excludes holes", () => {
  const sq = { type: "Polygon", coordinates: [[[-111, 28], [-109, 28], [-109, 30], [-111, 30], [-111, 28]], [[-110.2, 28.8], [-109.8, 28.8], [-109.8, 29.2], [-110.2, 29.2], [-110.2, 28.8]]] };
  assert.ok(pointInArea([-110.9, 28.1], sq));
  assert.ok(!pointInArea([-110, 29], sq));                      // inside the hole
  assert.ok(!pointInArea([-95, 16], sq));
  assert.deepEqual(ids(filterRecords(all, { ...base, boundary: { type: "MultiPolygon", coordinates: [[[[-96, 15], [-94, 15], [-94, 17], [-96, 17], [-96, 15]]]] } }, {})), ["b"]);
});
test("chip counts reflect records and report unclassified projects", () => {
  const { counts, unclassified } = typeCounts(filterRecords(all, base, {}));
  assert.equal(counts.solar, 1); assert.equal(counts.wind, 1); assert.equal(counts.solar_storage, 1);
  assert.equal(unclassified, 1);
  assert.equal(counts.ev_charging, undefined);
});
test("objective suggestions only add available layers and never remove manual ones", () => {
  const s = suggestion(objectiveById("site"), new Set(["power", "protected", "esri"]), new Set(["power", "flights"]));
  assert.deepEqual(s.add, ["protected"]);
  assert.deepEqual(s.already, ["power"]);
  assert.deepEqual(s.unavailable.sort(), ["fires", "ndvi"]);
  assert.equal(s.base, "esri");
  assert.ok(OBJECTIVES.some(o => o.id === "grid" && o.layers.includes("power")));
  assert.equal(objectiveById("nope").id, "portfolio");
});
