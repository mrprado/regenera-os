# Atlas

A 3D globe for spatial intelligence at `/os/map`. It works like an analyst console: live public signals and daily
Earth observation sit on the same globe as Regenera's own records (projects, opportunities, partners, triggers,
funding calls, imported layers).

## What is on the globe

The layer catalogue lives in `lib/map/catalog.ts`. Every layer names its registry key.

`/api/map/catalog` offers only the layers whose integration is not disabled or waiting for a licence, and only
those whose key is configured. A browser key (Esri) is injected server-side. Server-only keys never reach the
browser.

| Group | Layers | Source (registry key) | Refresh |
|---|---|---|---|
| Basemap | Satellite HD (with `ESRI_API_KEY`) | Esri World Imagery (`esri`) | periodic |
| Basemap | Sentinel-2 cloudless 2016 | EOX (`eox_s2cloudless`, CC BY 4.0) | static |
| Basemap | Yesterday from orbit (VIIRS true colour) | NASA GIBS (`nasa_gibs`) | daily |
| Basemap | Earth at night | NASA GIBS (`nasa_gibs`) | static |
| Basemap | Blue Marble relief | NASA GIBS (`nasa_gibs`) | static |
| Basemap | Tactical vector | OpenFreeMap (`openfreemap`) | weekly |
| Earth observation | NDVI (8-day), land surface temperature, night lights overlay | NASA GIBS | daily / 8-day |
| Hazards and events | Earthquakes M2.5+ over 7 days | USGS (`usgs_quakes`) | 5 min |
| Hazards and events | Active fires, 24 h: MODIS global keyless, or VIIRS 375 m for the view with `NASA_FIRMS_MAP_KEY` | NASA FIRMS (`nasa_firms_public`, `nasa_firms`) | 3 h |
| Hazards and events | Natural events | NASA EONET (`nasa_eonet`) | hourly |
| Hazards and events | Tropical cyclones | NOAA NHC (`noaa_nhc`) | 30 min |
| Hazards and events | GDACS alerts | GDACS (`gdacs`) | hourly |
| Movement | Live aircraft (≤ 250 nm of the view centre) | adsb.lol (`adsb_lol`, ODbL) | 15 s |
| Movement | Military aircraft | adsb.lol (`adsb_lol`, ODbL) | 30 s |
| Space | Earth-observation, weather, station and GNSS satellites, SGP4-propagated in the browser | CelesTrak (`celestrak`) | elements 6 h; positions 1 s |
| Nature and land | Tree cover loss | Hansen/UMD via GFW tiles (`gfw_tiles`, CC BY 4.0) | annual |
| Nature and land | Protected areas | OSM via OpenFreeMap | weekly |
| Infrastructure | Power grid: lines by voltage, plants by source, substations | Open Infrastructure Map (`openinframap`) | daily |
| Infrastructure | 3D buildings | OpenFreeMap | weekly |
| Weather and air | Precipitation (IMERG), aerosol | NASA GIBS | daily |

Point feeds go through `/api/map/live/[feed]` (`lib/map/live.ts`). Each call passes through `fetchJson`, which
provides:
- the registry gate
- a compact D1 cache
- retries
- the provider ledger (Settings → Integrations health)
- a stale fallback

A failed feed shows "unavailable", never "none".

Tiles load directly in the browser from the providers above. They are registered, licensed and listed in the
attribution control.

## Working the globe

- **Missions** set up a basemap, layers, records, sensor look and camera in one click: Portfolio, Site scout,
  Hazard watch, Energy transition, Forest and land, Live traffic, Orbital watch.
- **Sensor looks**, keys 1–6: Normal, CRT, NVG, FLIR (white-hot), Thermal (ironbow) and Noir. These are
  screen-space filters; the data underneath is unchanged.
- **HUD** (H): shows UTC time, coordinates in DMS, camera altitude, heading and tilt, the source, and live counts.
  A compass tape runs along the bottom and the tracked target's telemetry appears alongside.
- **Detection** (D): screen-space boxes and IDs on the aircraft, satellites, quakes, events, cyclones and projects
  in view.
- **Click-to-track**: a tracked aircraft gets a trail and camera lock. **Chase cam** rides behind it in 3D. A
  tracked satellite gets its ground track (−30 to +60 minutes) and the camera follows.
- **Orbit** (O) and **Tour** (a cinematic fly-through of every project in 3D). **Globe or flat** (G), **terrain**
  (T), **tilt** (P), **north up** (N), **reset** (R).
- **Share links**: the URL hash carries the camera, basemap, layers, look and tracked target. Copy it with the share
  button.
- **Search**: records, then coordinates in any common form, then places (Nominatim, on Enter only).
- **Imagery date**: a slider goes back up to 30 days for the daily NASA products.
- The directory, layer library (import with provenance), drawing and measuring, boundaries, and site context with
  *Run site intelligence* remain.

## Honesty rules

- Aircraft positions come from community receivers. Gaps are not absence of aircraft.
- Satellite positions are computed, not observed.
- A thermal anomaly is not always a wildfire.
- OSM protected areas are not the legal boundary; the WDPA needs a commercial licence.
- The power grid is community-mapped.

Each layer's info panel carries its source, licence, refresh, date and caveat.

## Not built (and why)

- **Photorealistic 3D cities** (Google 3D Tiles, or Cesium ion): these need a metered Google Maps key, or a
  Cesium ion token whose free tier is non-commercial. Adopting them would also mean moving to CesiumJS, which is a
  stack change and needs approval.
- **Vessels** (AISStream): needs a key and a websocket client.
- **Animated wind** (GFS grids): needs a grid decoder.
- **Public CCTV**: out of scope for Regenera.

## Code

- `app/(app)/map/map-client.tsx`: orchestration.
- `atlas-engine.ts`: style anchors, basemaps, overlays and icons.
- `hud.tsx`: looks, HUD and detection.
- `intel-panel.tsx`: missions and layer groups.
- `detail.tsx`: selected-item cards.
- `satellites.ts`: SGP4 propagation.
- `atlas-tools.tsx`: library, drawing and site context.

The satellite.js WASM runtimes are aliased to a stub in `vite.config.ts`.

Tests: `tests/unit/atlas.test.ts` and `tests/integration/atlas-live.test.ts`.
