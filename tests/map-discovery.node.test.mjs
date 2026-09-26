// Run with: npm run test:map
// Uses Node's built-in runner so these pure domain checks do not require workerd or esbuild.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinateLabel, discoveryOptions, filterRecords, mapRecords, safeWebsite, validCoordinates } from "../lib/map/discovery.ts";

const point = (properties, coordinates = [-99, 19]) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
const data = {
  projects: { features: [point({ id: "p", name: "Solar + storage", description: "Grid flexibility", sector: "energy", country: "MEX", topics: "energy_resource_flows|community_health" })] },
  organizations: { features: [point({ id: "o", name: "Seaweed Works", description: "Marine packaging", sector: "water_food_nature", country: "GBR", topics: "Biomaterials" }), point({ id: "bad", name: "Invalid" }, [190, 0])] },
  deals: { features: [point({ id: "d", name: "Development mandate", sector: "energy", country: "MEX" })] },
  triggers: { features: [] },
  procurement: { features: [point({ id: "f", summary: "Grant", source: "funding" }), point({ id: "f", summary: "Tender", source: "official" })] },
};
const all = mapRecords(data);
const empty = { query: "", country: "", sector: "", topic: "" };

test("directory includes opportunities and rejects invalid coordinates without rejecting the equator", () => {
  assert.equal(all.length, 5);
  assert.ok(all.some(r => r.layer === "deals"));
  assert.equal(new Set(all.map(r => r.key)).size, 5);
  assert.ok(validCoordinates(0, 0));
  for (const [lng, lat] of [[null, 1], [1, null], [NaN, 2], [Infinity, 0], [-181, 0], [0, 91]]) assert.equal(validCoordinates(lng, lat), false);
});
test("country, sector, recorded topics, text and layer visibility intersect", () => {
  const filters = { ...empty, country: "MEX", sector: "energy", topic: "community_health", query: "solar flexibility" };
  assert.deepEqual(filterRecords(all, filters, {}).map(r => r.feature.properties.id), ["p"]);
  assert.equal(filterRecords(all, filters, { projects: false }).length, 0);
  assert.equal(filterRecords(all, { ...empty, query: "  MARINE   packaging " }, {}).length, 1);
  assert.equal(filterRecords(all, { ...empty, query: "nonexistent" }, {}).length, 0);
  assert.equal(filterRecords(all, empty, {}).length, 5);
});
test("options derive from canonical values without manufacturing classifications", () => {
  assert.deepEqual(discoveryOptions(all, "country"), ["GBR", "MEX"]);
  assert.deepEqual(discoveryOptions(all, "topic"), ["Biomaterials", "community_health", "energy_resource_flows"]);
  assert.equal(filterRecords(all, { ...empty, country: "MEX" }, {}).length, 2);
});
test("coordinates use correct hemispheres", () => {
  assert.equal(coordinateLabel([-77.5, -33.7]), "33.700° S · 77.500° W");
  assert.equal(coordinateLabel([151.1, 51.5]), "51.500° N · 151.100° E");
});
test("external website links reject script, relative and credential-bearing URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "/private", "https://user:secret@example.com", null]) assert.equal(safeWebsite(value), null);
  assert.equal(safeWebsite("https://example.com/about"), "https://example.com/about");
});
