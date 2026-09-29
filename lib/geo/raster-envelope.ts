// Development envelope on a bounded raster (server-safe): site and constraints are rasterised onto a grid over the
// site (≤ maxCells a side), buffers are applied with a Euclidean distance transform, areas come from cell counts and
// the envelope polygon is traced from the mask. Memory and time stay bounded however dense the OSM data is, which the
// vector union/difference approach is not. Result resolution is reported with the areas.
import type { Feature, Geometry, Position } from "geojson";
import { maskPolygons, type DemGrid } from "./dem";

export type RasterConstraint = { id: string; label: string; kind: "hard" | "soft" | "opportunity"; features: Feature[]; bufferM?: number; source: string };

type Grid = { w: number; h: number; west: number; south: number; east: number; north: number; dx: number; dy: number };

function makeGrid(site: Geometry, padM: number, maxCells: number): Grid {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (x: unknown): void => { if (Array.isArray(x) && typeof x[0] === "number") { const [a, b] = x as number[]; if (a < w) w = a; if (a > e) e = a; if (b < s) s = b; if (b > n) n = b; } else if (Array.isArray(x)) x.forEach(walk); };
  walk((site as { coordinates: unknown }).coordinates);
  const mid = (s + n) / 2, mLat = 111_320, mLng = 111_320 * Math.cos((mid * Math.PI) / 180);
  const padLat = padM / mLat, padLng = padM / mLng;
  w -= padLng; e += padLng; s -= padLat; n += padLat;
  const widthM = (e - w) * mLng, heightM = (n - s) * mLat;
  const cell = Math.max(Math.max(widthM, heightM) / maxCells, 2);
  const gw = Math.max(4, Math.ceil(widthM / cell)), gh = Math.max(4, Math.ceil(heightM / cell));
  return { w: gw, h: gh, west: w, south: s, east: w + (gw * cell) / mLng, north: s + (gh * cell) / mLat, dx: cell, dy: cell };
}
const colOf = (g: Grid, lng: number) => ((lng - g.west) / (g.east - g.west)) * g.w;
const rowOf = (g: Grid, lat: number) => ((g.north - lat) / (g.north - g.south)) * g.h;

/** Scanline fill of polygon rings (even-odd, so holes subtract) into `mask`. */
function fillRings(g: Grid, rings: Position[][], mask: Uint8Array) {
  let minR = Infinity, maxR = -Infinity;
  for (const ring of rings) for (const p of ring) { const r = rowOf(g, p[1]); if (r < minR) minR = r; if (r > maxR) maxR = r; }
  const r0 = Math.max(0, Math.floor(minR)), r1 = Math.min(g.h - 1, Math.ceil(maxR));
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5, xs: number[] = [];
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = rowOf(g, ring[i][1]), yj = rowOf(g, ring[j][1]);
      if ((yi > y) !== (yj > y)) { const xi = colOf(g, ring[i][0]), xj = colOf(g, ring[j][0]); xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi)); }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(g.w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * g.w + c] = 1;
    }
  }
}
/** Marks cells along a polyline (DDA at half-cell steps). */
function burnLine(g: Grid, line: Position[], mask: Uint8Array) {
  for (let i = 1; i < line.length; i++) {
    const x0 = colOf(g, line[i - 1][0]), y0 = rowOf(g, line[i - 1][1]), x1 = colOf(g, line[i][0]), y1 = rowOf(g, line[i][1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const c = Math.floor(x0 + ((x1 - x0) * s) / steps), r = Math.floor(y0 + ((y1 - y0) * s) / steps);
      if (c >= 0 && r >= 0 && c < g.w && r < g.h) mask[r * g.w + c] = 1;
    }
  }
}
function rasterise(g: Grid, geom: Geometry, mask: Uint8Array) {
  switch (geom.type) {
    case "Polygon": fillRings(g, geom.coordinates, mask); burnLine(g, geom.coordinates[0], mask); break;
    case "MultiPolygon": geom.coordinates.forEach(p => { fillRings(g, p, mask); burnLine(g, p[0], mask); }); break;
    case "LineString": burnLine(g, geom.coordinates, mask); break;
    case "MultiLineString": geom.coordinates.forEach(l => burnLine(g, l, mask)); break;
    case "Point": { const c = Math.floor(colOf(g, geom.coordinates[0])), r = Math.floor(rowOf(g, geom.coordinates[1])); if (c >= 0 && r >= 0 && c < g.w && r < g.h) mask[r * g.w + c] = 1; break; }
    case "MultiPoint": geom.coordinates.forEach(p => rasterise(g, { type: "Point", coordinates: p }, mask)); break;
    case "GeometryCollection": geom.geometries.forEach(x => rasterise(g, x, mask)); break;
  }
}

/** Exact Euclidean distance transform (Felzenszwalb–Huttenlocher), in cells, from set cells. */
function distanceTransform(mask: Uint8Array, w: number, h: number) {
  const INF = 1e20, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const out = new Float64Array(w * h);
  const edt1 = (n: number) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let c = 0; c < w; c++) { for (let r = 0; r < h; r++) f[r] = mask[r * w + c] ? 0 : INF; edt1(h); for (let r = 0; r < h; r++) out[r * w + c] = d[r]; }
  for (let r = 0; r < h; r++) { for (let c = 0; c < w; c++) f[c] = out[r * w + c]; edt1(w); for (let c = 0; c < w; c++) out[r * w + c] = Math.sqrt(d[c]); }
  return out;
}

export type RasterEnvelope = {
  cellM: number; siteHa: number; hardExcludedHa: number; softHa: number; netHa: number;
  envelope: Geometry | null; soft: Geometry | null;
  byConstraint: { id: string; label: string; kind: string; overlapHa: number; features: number; source: string }[];
};

export function rasterEnvelope(site: Geometry, constraints: RasterConstraint[], maxCells = 600): RasterEnvelope {
  const maxBuffer = Math.max(0, ...constraints.map(c => c.bufferM ?? 0));
  const g = makeGrid(site, maxBuffer + 10, maxCells);
  const n = g.w * g.h, cellHa = (g.dx * g.dy) / 10_000;
  const siteMask = new Uint8Array(n); rasterise(g, site, siteMask);
  const hard = new Uint8Array(n), soft = new Uint8Array(n);
  const byConstraint: RasterEnvelope["byConstraint"] = [];
  for (const c of constraints) {
    const m = new Uint8Array(n);
    for (const f of c.features) if (f.geometry) rasterise(g, f.geometry, m);
    const buf = (c.bufferM ?? 0) / g.dx;
    const dist = buf > 0 ? distanceTransform(m, g.w, g.h) : null;
    let overlap = 0;
    for (let i = 0; i < n; i++) {
      const hit = dist ? dist[i] <= buf : m[i] === 1;
      if (!hit || !siteMask[i]) continue;
      overlap++;
      if (c.kind === "hard") hard[i] = 1; else if (c.kind === "soft") soft[i] = 1;
    }
    byConstraint.push({ id: c.id, label: c.label, kind: c.kind, overlapHa: overlap * cellHa, features: c.features.length, source: c.source });
  }
  let siteCells = 0, hardCells = 0, netCells = 0, softCells = 0;
  const env = new Uint8Array(n), softIn = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!siteMask[i]) continue;
    siteCells++;
    if (hard[i]) { hardCells++; continue; }
    env[i] = 1; netCells++;
    if (soft[i]) { softIn[i] = 1; softCells++; }
  }
  const asDem = { width: g.w, height: g.h, west: g.west, south: g.south, east: g.east, north: g.north, values: new Float32Array(0), source: "raster", resolutionM: g.dx } as DemGrid;
  return {
    cellM: g.dx, siteHa: siteCells * cellHa, hardExcludedHa: hardCells * cellHa, softHa: softCells * cellHa, netHa: netCells * cellHa,
    envelope: netCells ? maskPolygons(asDem, env, 1).geometry : null, soft: softCells ? maskPolygons(asDem, softIn, 1).geometry : null, byConstraint,
  };
}
