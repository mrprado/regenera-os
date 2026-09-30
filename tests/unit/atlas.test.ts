// Atlas catalogue and live-feed normalizers against recorded response shapes (no network in CI).
import { describe, expect, it } from "vitest";
import { CATALOG, decodeView, encodeView, offerCatalog, parseCoordinates, productDate, tileUrl } from "@/lib/map/catalog";
import { aircraftFeatures, compactFires, compactQuakes, eonetFeatures, fireFeatures, nhcFeatures, parseBbox, quakeFeatures, zAdsb, zEonet, zNhc, zOmmList, zQuakes } from "@/lib/map/live";
import { INTEGRATIONS } from "@/lib/integrations/registry";

describe("Atlas catalogue", () => {
  it("every layer names a registered integration and a unique id", () => {
    const keys = new Set(INTEGRATIONS.map(i => i.key));
    for (const l of CATALOG) expect(keys.has(l.registry), `${l.id} → ${l.registry}`).toBe(true);
    expect(new Set(CATALOG.map(l => l.id)).size).toBe(CATALOG.length);
    for (const l of CATALOG.filter(x => x.kind === "raster")) expect(l.tiles).toMatch(/\{z\}.*\{[xy]\}.*\{[xy]\}/);
  });

  it("offers only registry-allowed layers and injects browser keys server-side", () => {
    const none = offerCatalog(new Map(), {});
    expect(none.find(l => l.id === "esri")?.tiles).toContain("server.arcgisonline.com");   // keyless public imagery
    expect(none.some(l => l.id === "street_imagery")).toBe(false);                          // needs MAPILLARY_TOKEN
    expect(none.every(l => !("needsEnv" in l) && !("keyEnv" in l) && !("keyedTiles" in l))).toBe(true);
    const withKey = offerCatalog(new Map(), { ESRI_API_KEY: "k&y" });
    expect(withKey.find(l => l.id === "esri")?.tiles).toContain("token=k%26y");
    const gated = offerCatalog(new Map([["adsb_lol", "disabled"], ["nasa_gibs", "license_required"]]), {});
    expect(gated.some(l => l.registry === "adsb_lol" || l.registry === "nasa_gibs")).toBe(false);
    expect(gated.some(l => l.id === "quakes")).toBe(true);
  });

  it("daily products resolve to a UTC date", () => {
    expect(productDate(new Date("2026-09-27T02:00:00Z"), 1)).toBe("2026-09-26");
    const ndvi = CATALOG.find(l => l.id === "ndvi")!;
    expect(tileUrl(ndvi, "2026-09-20")).toContain("/default/2026-09-20/");
  });

  it("share links round-trip camera, basemap, layers, look and target; junk is dropped", () => {
    const hash = encodeView({ lng: -99.1332, lat: 19.4326, zoom: 12.5, bearing: 30, pitch: 60, base: "s2cloudless", layers: ["quakes", "projects"], mode: "nvg", track: "flights|a1b2c3" });
    expect(decodeView(`#${hash}`)).toEqual({ lat: 19.4326, lng: -99.1332, zoom: 12.5, bearing: 30, pitch: 60, base: "s2cloudless", mode: "nvg", layers: ["quakes", "projects"], track: "flights|a1b2c3" });
    expect(decodeView("#c=999,0,2&b=nope&m=<script>&l=quakes,evil")).toEqual({ layers: ["quakes"] });
  });

  it("parses coordinates in common forms", () => {
    expect(parseCoordinates("19.4326, -99.1332")).toEqual({ lat: 19.4326, lng: -99.1332 });
    expect(parseCoordinates("19.43 N 99.13 W")).toEqual({ lat: 19.43, lng: -99.13 });
    expect(parseCoordinates("-99.13, 19.43")).toEqual({ lat: 19.43, lng: -99.13 });
    expect(parseCoordinates("Mérida")).toBeNull();
    expect(parseCoordinates("95, 200")).toBeNull();
  });
});

describe("live feed normalizers", () => {
  it("USGS: compact rows, age and event links", () => {
    const rows = compactQuakes(zQuakes.parse({ features: [
      { id: "us7000abcd", geometry: { coordinates: [142.1, 38.3, 24.5] }, properties: { mag: 5.4, place: "off the east coast of Honshu", time: Date.parse("2026-09-26T20:00:00Z"), alert: "green", tsunami: 0 } },
      { id: "bad", geometry: null, properties: { mag: 3, place: null, time: 0 } },
    ] }));
    expect(rows).toHaveLength(1);
    const fc = quakeFeatures(rows, Date.parse("2026-09-27T02:00:00Z"));
    expect(fc.features[0].properties).toMatchObject({ mag: 5.4, depthKm: 24.5, ageH: 6, alert: "green", tsunami: false, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd" });
    expect(fc.meta.count).toBe(1);
  });

  it("EONET: latest position plus a track, polygons by centroid", () => {
    const fc = eonetFeatures(zEonet.parse({ events: [
      { id: "E1", title: "Tropical Storm Gonzalo", categories: [{ id: "severeStorms", title: "Severe Storms" }], sources: [{ id: "NOAA_NHC", url: "https://nhc" }], geometry: [
        { date: "2026-09-25T09:00:00Z", type: "Point", coordinates: [-22.4, 14.2], magnitudeValue: 40, magnitudeUnit: "kts" },
        { date: "2026-09-25T03:00:00Z", type: "Point", coordinates: [-22.1, 13.2], magnitudeValue: 35, magnitudeUnit: "kts" },
      ] },
      { id: "E2", title: "Fire", categories: [{ id: "wildfires", title: "Wildfires" }], geometry: [{ date: "2026-09-20T00:00:00Z", type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }] },
    ] }));
    const pts = fc.features.filter(f => f.geometry.type === "Point");
    expect(pts[0].properties).toMatchObject({ id: "E1", magnitude: 40, date: "2026-09-25T09:00:00Z", url: "https://nhc" });
    expect((pts[0].geometry as { coordinates: number[] }).coordinates).toEqual([-22.4, 14.2]);
    expect(fc.features.some(f => f.geometry.type === "LineString")).toBe(true);
    expect((pts[1].geometry as { coordinates: number[] }).coordinates).toEqual([1, 1]);
  });

  it("NHC: storm class, wind and advisory", () => {
    const fc = nhcFeatures(zNhc.parse({ activeStorms: [{ id: "al062026", name: "Fay", classification: "TD", intensity: "30", pressure: "1009", latitudeNumeric: 29.8, longitudeNumeric: -43.9, movementDir: 180, movementSpeed: 2, lastUpdate: "2026-09-26T21:00:00.000Z", publicAdvisory: { url: "https://www.nhc.noaa.gov/text/MIATCPAT1.shtml" } }] }));
    expect(fc.features[0].properties).toMatchObject({ name: "Fay", classLabel: "Tropical depression", windKt: 30, pressureMb: 1009 });
  });

  it("FIRMS: drops low confidence, clips to the view, keeps the strongest when capped", () => {
    const csv = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight\n" +
      "10,10,330,1,1,2026-09-26,0100,T,85,6.1NRT,300,50,D\n10.5,10.5,320,1,1,2026-09-26,0105,T,20,6.1NRT,300,90,D\n40,40,320,1,1,2026-09-26,0110,A,60,6.1NRT,300,5,N";
    const rows = compactFires(csv);
    expect(rows).toHaveLength(2);
    expect(fireFeatures(rows, [0, 0, 20, 20], "MODIS").meta).toMatchObject({ count: 1, shown: 1 });
    expect(fireFeatures(rows, null, "MODIS", 1).features[0].properties).toMatchObject({ frp: 50 });
    expect(compactFires("latitude,longitude,frp,confidence,acq_date,acq_time\n1,1,3,h,2026-09-26,0100")[0][3]).toBe(90);
  });

  it("adsb.lol: aircraft properties, ground, military flag and stale positions dropped", () => {
    const fc = aircraftFeatures(zAdsb.parse({ ac: [
      { hex: "3c6518", flight: "DLH417  ", r: "D-AIHX", t: "A346", alt_baro: 38000, gs: 485.4, track: 100.7, lat: 51.59, lon: -1.05, squawk: "2006", emergency: "none", seen_pos: 0.5 },
      { hex: "ae1234", flight: "RCH123", alt_baro: "ground", lat: 40, lon: -75, dbFlags: 1 },
      { hex: "old", lat: 1, lon: 1, seen_pos: 600 },
      { hex: "nopos" },
    ] }));
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties).toMatchObject({ callsign: "DLH417", altFt: 38000, speedKt: 485, heading: 101, emergency: null, military: false });
    expect(fc.features[1].properties).toMatchObject({ ground: true, military: true });
  });

  it("CelesTrak OMM and bbox parsing", () => {
    const omm = { OBJECT_NAME: "ISS (ZARYA)", OBJECT_ID: "1998-067A", EPOCH: "2026-09-26T12:00:00.000", MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.6, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 50, MEAN_ANOMALY: 300, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0, EXTRA: "dropped" };
    const [e] = zOmmList.parse([omm]);
    expect(e.NORAD_CAT_ID).toBe(25544);
    expect("EXTRA" in e).toBe(false);
    expect(parseBbox("-10,20,10,30")).toEqual([-10, 20, 10, 30]);
    expect(parseBbox("0,50,1,40")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
  });
});

describe("provenance and freshness", () => {
  it("every catalogue layer has provenance with a valid tier; none is left unknown", async () => {
    const { PROVENANCE, TIERS } = await import("@/lib/map/provenance");
    const missing = CATALOG.filter(l => !PROVENANCE[l.id]).map(l => l.id);
    expect(missing).toEqual([]);
    for (const l of CATALOG) {
      const p = PROVENANCE[l.id];
      expect(Object.keys(TIERS)).toContain(String(p.tier));
      expect(p.provider && p.sourceUrl.startsWith("https://") && p.geography && p.resolution && p.period).toBeTruthy();
    }
    expect(Object.keys(PROVENANCE).filter(k => !CATALOG.some(l => l.id === k))).toEqual([]);
  });

  it("freshness is measured from the ledger, never assumed", async () => {
    const { freshnessOf, PROVENANCE } = await import("@/lib/map/provenance");
    const now = new Date("2026-09-29T12:00:00Z");
    const q = PROVENANCE.quakes;                                   // expected within 1 h
    expect(freshnessOf(q, true, "2026-09-29T11:30:00Z", null, now).status).toBe("current");
    expect(freshnessOf(q, true, "2026-09-29T10:00:00Z", null, now).status).toBe("aging");
    expect(freshnessOf(q, true, "2026-09-28T10:00:00Z", null, now).status).toBe("stale");
    expect(freshnessOf(q, true, "2026-09-28T10:00:00Z", "2026-09-29T11:00:00Z", now).status).toBe("unavailable");
    expect(freshnessOf(q, true, null, null, now).status).toBe("not_tracked");
    expect(freshnessOf(PROVENANCE.s2cloudless, false, null, null, now).status).toBe("reference");
    expect(freshnessOf(PROVENANCE.streets, false, null, null, now).status).toBe("not_tracked");   // browser tiles: not guessed
  });
});
