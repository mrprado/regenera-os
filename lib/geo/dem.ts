// Terrain engine (ATLAS workbench): pure functions over an elevation grid in geographic coordinates. Used in the
// browser on decoded terrain tiles (AWS Terrain Tiles / Mapzen, terrarium encoding) and in tests with synthetic grids.
// Every output is SCREENING grade: the grid resolution and source are carried on the result, never survey-grade.
import { contours as d3Contours } from "d3-contour";

export type DemGrid = {
  width: number; height: number;
  west: number; south: number; east: number; north: number;   // grid covers this bbox; row 0 = north
  values: Float32Array;                                        // metres, NaN = no data
  source: string; resolutionM: number; zoom?: number;
};
export type LngLat = [number, number];

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Terrarium PNG encoding: (R × 256 + G + B / 256) − 32768 metres. */
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Slippy-map tile covering a coordinate. */
export function lngLatToTile(lng: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}
export const tileToLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const tileToLat = (y: number, z: number) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

/** Approximate ground resolution of a 256 px tile at a zoom and latitude. */
export const tileResolutionM = (z: number, lat: number) => (40_075_016.686 * Math.cos(rad(lat))) / (256 * 2 ** z);

/** Picks the zoom so the bbox spans at most `maxCells` cells on its longer side (terrain tiles stop at z14). */
export function chooseZoom(west: number, south: number, east: number, north: number, maxCells = 384) {
  for (let z = 14; z >= 1; z--) {
    const a = lngLatToTile(west, north, z), b = lngLatToTile(east, south, z);
    if (Math.max(b.x - a.x + 1, b.y - a.y + 1) * 256 <= maxCells * 1.9) return z;
  }
  return 1;
}

// ---------- grid geometry ----------
export const cellLng = (g: DemGrid, col: number) => g.west + ((col + 0.5) / g.width) * (g.east - g.west);
export const cellLat = (g: DemGrid, row: number) => g.north - ((row + 0.5) / g.height) * (g.north - g.south);
/** Cell size in metres (x at the grid's mid-latitude, y). */
export function cellSizeM(g: DemGrid) {
  const midLat = (g.north + g.south) / 2;
  return { dx: (rad(g.east - g.west) * R * Math.cos(rad(midLat))) / g.width, dy: (rad(g.north - g.south) * R) / g.height };
}
export function toCell(g: DemGrid, lng: number, lat: number) {
  return { col: ((lng - g.west) / (g.east - g.west)) * g.width - 0.5, row: ((g.north - lat) / (g.north - g.south)) * g.height - 0.5 };
}
const at = (g: DemGrid, c: number, r: number) => g.values[Math.min(g.height - 1, Math.max(0, r)) * g.width + Math.min(g.width - 1, Math.max(0, c))];

/** Bilinear elevation at a coordinate; NaN outside the grid or on no-data. */
export function sampleElevation(g: DemGrid, lng: number, lat: number) {
  if (lng < g.west || lng > g.east || lat < g.south || lat > g.north) return NaN;
  const { col, row } = toCell(g, lng, lat);
  const c0 = Math.floor(col), r0 = Math.floor(row), fx = col - c0, fy = row - r0;
  const v = (1 - fx) * (1 - fy) * at(g, c0, r0) + fx * (1 - fy) * at(g, c0 + 1, r0) + (1 - fx) * fy * at(g, c0, r0 + 1) + fx * fy * at(g, c0 + 1, r0 + 1);
  return v;
}

export function haversine(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- slope, aspect, roughness, TPI ----------
/** Horn (1981) slope in percent and degrees and aspect (degrees clockwise from north, downslope direction). */
export function slopeAspect(g: DemGrid) {
  const { dx, dy } = cellSizeM(g);
  const n = g.width * g.height;
  const slopePct = new Float32Array(n), slopeDeg = new Float32Array(n), aspect = new Float32Array(n);
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const a = at(g, c - 1, r - 1), b = at(g, c, r - 1), cc = at(g, c + 1, r - 1), d = at(g, c - 1, r), f = at(g, c + 1, r), gg = at(g, c - 1, r + 1), h = at(g, c, r + 1), i = at(g, c + 1, r + 1);
    const dzdx = ((cc + 2 * f + i) - (a + 2 * d + gg)) / (8 * dx);
    const dzdy = ((gg + 2 * h + i) - (a + 2 * b + cc)) / (8 * dy); // positive = rising to the south
    const k = r * g.width + c;
    const s = Math.hypot(dzdx, dzdy);
    slopePct[k] = s * 100;
    slopeDeg[k] = (Math.atan(s) * 180) / Math.PI;
    // downslope direction: opposite of gradient (x east, y south)
    let asp = (Math.atan2(-dzdx, dzdy) * 180) / Math.PI; // angle from north toward east of the downhill vector
    asp = (asp + 360) % 360;
    aspect[k] = s < 1e-6 ? NaN : asp;
  }
  return { slopePct, slopeDeg, aspect };
}

/** Terrain Ruggedness Index (mean absolute difference to 8 neighbours) and Topographic Position Index (cell − mean). */
export function roughness(g: DemGrid) {
  const n = g.width * g.height, tri = new Float32Array(n), tpi = new Float32Array(n);
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const z = at(g, c, r); let sum = 0, diff = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) { const v = at(g, c + dc, r + dr); sum += v; diff += Math.abs(v - z); }
    tri[r * g.width + c] = diff / 8; tpi[r * g.width + c] = z - sum / 8;
  }
  return { tri, tpi };
}

export function stats(values: ArrayLike<number>, mask?: ArrayLike<number>) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    const v = values[i]; if (!Number.isFinite(v)) continue;
    if (v < min) min = v; if (v > max) max = v; sum += v; n++;
  }
  return n ? { min, max, mean: sum / n, count: n } : { min: NaN, max: NaN, mean: NaN, count: 0 };
}

// ---------- contours and threshold polygons ----------
type Ring = [number, number][];
const toLngLatRing = (g: DemGrid, ring: number[][]): Ring =>
  ring.map(([x, y]) => [g.west + (x / g.width) * (g.east - g.west), g.north - (y / g.height) * (g.north - g.south)] as [number, number]);

/** Contour lines at `interval` metres; every `majorEvery`-th level is major. Lines are the isoband boundaries. */
export function contourLines(g: DemGrid, interval: number, majorEvery = 5, smooth = true) {
  if (!(interval > 0)) throw new Error("Contour interval must be positive");
  const s = stats(g.values);
  if (!Number.isFinite(s.min)) return { type: "FeatureCollection" as const, features: [] };
  const levels: number[] = [];
  for (let v = Math.ceil(s.min / interval) * interval; v <= s.max; v += interval) levels.push(Math.round(v * 1000) / 1000);
  if (levels.length > 400) throw new Error(`Interval too small for this relief (${levels.length} levels). Use a larger interval.`);
  const filled = Array.from(g.values, v => (Number.isFinite(v) ? v : s.min - interval));
  const gen = d3Contours().size([g.width, g.height]).smooth(smooth).thresholds(levels);
  const features = gen(filled).flatMap(mp => {
    const lines = mp.coordinates.flatMap(poly => poly.map(ring => toLngLatRing(g, ring)))
      .filter(ring => ring.length > 3 && !ring.every(([x, y]) => x <= g.west + 1e-9 || x >= g.east - 1e-9 || y <= g.south + 1e-9 || y >= g.north - 1e-9));
    if (!lines.length) return [];
    const idx = Math.round(mp.value / interval);
    return [{ type: "Feature" as const, geometry: { type: "MultiLineString" as const, coordinates: lines }, properties: { elevation: mp.value, major: idx % majorEvery === 0 } }];
  });
  return { type: "FeatureCollection" as const, features };
}

/** Polygons where a per-cell predicate holds (e.g. slope < 5 % and elevation 10–40 m). Area in hectares. */
export function maskPolygons(g: DemGrid, mask: Uint8Array, minCells = 4) {
  const gen = d3Contours().size([g.width, g.height]).smooth(false).thresholds([0.5]);
  const [band] = gen(Array.from(mask));
  const { dx, dy } = cellSizeM(g);
  let cells = 0; for (let i = 0; i < mask.length; i++) cells += mask[i];
  const polys = (band?.coordinates ?? []).filter(p => p[0] && p[0].length >= minCells).map(p => p.map(ring => toLngLatRing(g, ring)));
  return { geometry: { type: "MultiPolygon" as const, coordinates: polys }, areaHa: (cells * dx * dy) / 10_000, cells };
}

// ---------- elevation profile ----------
export type ProfilePoint = { distanceM: number; elevation: number; lng: number; lat: number };
export function elevationProfile(g: DemGrid, line: LngLat[], samples = 200) {
  const segLen = line.slice(1).map((p, i) => haversine(line[i], p));
  const total = segLen.reduce((a, b) => a + b, 0);
  if (!total) throw new Error("Draw a line with at least two distinct points");
  const pts: ProfilePoint[] = [];
  for (let s = 0; s <= samples; s++) {
    let d = (s / samples) * total, i = 0;
    while (i < segLen.length - 1 && d > segLen[i]) { d -= segLen[i]; i++; }
    const t = segLen[i] ? d / segLen[i] : 0;
    const lng = line[i][0] + t * (line[i + 1][0] - line[i][0]), lat = line[i][1] + t * (line[i + 1][1] - line[i][1]);
    pts.push({ distanceM: (s / samples) * total, elevation: sampleElevation(g, lng, lat), lng, lat });
  }
  const valid = pts.filter(p => Number.isFinite(p.elevation));
  let gain = 0, loss = 0, maxSlope = 0;
  for (let i = 1; i < valid.length; i++) {
    const dz = valid[i].elevation - valid[i - 1].elevation, dd = valid[i].distanceM - valid[i - 1].distanceM;
    if (dz > 0) gain += dz; else loss -= dz;
    if (dd > 0) maxSlope = Math.max(maxSlope, Math.abs(dz / dd) * 100);
  }
  const els = valid.map(p => p.elevation);
  return {
    points: pts, lengthM: total, minElevation: Math.min(...els), maxElevation: Math.max(...els), gainM: gain, lossM: loss,
    averageSlopePct: valid.length > 1 ? (Math.abs(valid[valid.length - 1].elevation - valid[0].elevation) / total) * 100 : 0, maxSlopePct: maxSlope,
  };
}

// ---------- hydrology: fill, D8, accumulation, watershed ----------
const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const; // E, SE, S, SW, W, NW, N, NE (dc, dr)

/** Priority-flood depression filling (Barnes et al. 2014, with a small epsilon so flats drain). */
export function fillDepressions(g: DemGrid, epsilon = 1e-3) {
  const { width: w, height: h } = g, n = w * h;
  const z = Float32Array.from(g.values, v => (Number.isFinite(v) ? v : -1e6));
  const done = new Uint8Array(n);
  // binary heap on elevation
  const heap: number[] = [];
  const push = (i: number) => { heap.push(i); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (z[heap[p]] <= z[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && z[heap[l]] < z[heap[m]]) m = l; if (r < heap.length && z[heap[r]] < z[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let c = 0; c < w; c++) { for (const r of [0, h - 1]) { const i = r * w + c; if (!done[i]) { done[i] = 1; push(i); } } }
  for (let r = 1; r < h - 1; r++) { for (const c of [0, w - 1]) { const i = r * w + c; if (!done[i]) { done[i] = 1; push(i); } } }
  while (heap.length) {
    const i = pop(), r = Math.floor(i / w), c = i % w;
    for (const [dc, dr] of D8) {
      const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue;
      const j = rr * w + cc; if (done[j]) continue;
      done[j] = 1; if (z[j] <= z[i]) z[j] = z[i] + epsilon; push(j);
    }
  }
  return z;
}

/** D8 flow direction (index into D8, −1 = outlet / edge sink) on a filled surface. */
export function flowDirection(g: DemGrid, filled: Float32Array) {
  const { width: w, height: h } = g, { dx, dy } = cellSizeM(g), diag = Math.hypot(dx, dy);
  const dir = new Int8Array(w * h).fill(-1);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c; let best = 0, bd = -1;
    for (let k = 0; k < 8; k++) {
      const [dc, dr] = D8[k], cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue;
      const dist = dc && dr ? diag : dc ? dx : dy, drop = (filled[i] - filled[rr * w + cc]) / dist;
      if (drop > best) { best = drop; bd = k; }
    }
    dir[i] = bd;
  }
  return dir;
}

/** Flow accumulation in cells (each cell contributes one). */
export function flowAccumulation(g: DemGrid, filled: Float32Array, dir: Int8Array) {
  const n = g.width * g.height, order = Array.from({ length: n }, (_, i) => i).sort((a, b) => filled[b] - filled[a]);
  const acc = new Float32Array(n).fill(1);
  for (const i of order) { const k = dir[i]; if (k < 0) continue; const r = Math.floor(i / g.width), c = i % g.width; acc[(r + D8[k][1]) * g.width + c + D8[k][0]] += acc[i]; }
  return acc;
}

/** Drainage lines where accumulation exceeds `minCells` (as polylines of cell centres). */
export function drainageLines(g: DemGrid, dir: Int8Array, acc: Float32Array, minCells: number) {
  const lines: LngLat[][] = [];
  for (let i = 0; i < acc.length; i++) {
    if (acc[i] < minCells || dir[i] < 0) continue;
    const r = Math.floor(i / g.width), c = i % g.width, k = dir[i];
    lines.push([[cellLng(g, c), cellLat(g, r)], [cellLng(g, c + D8[k][0]), cellLat(g, r + D8[k][1])]]);
  }
  return lines;
}

/** Watershed upstream of a pour point, snapped to the highest accumulation within `snapCells`. */
export function delineateWatershed(g: DemGrid, pour: LngLat, snapCells = 3) {
  const filled = fillDepressions(g), dir = flowDirection(g, filled), acc = flowAccumulation(g, filled, dir);
  const p = toCell(g, pour[0], pour[1]);
  let best = -1, bestAcc = -1;
  for (let dr = -snapCells; dr <= snapCells; dr++) for (let dc = -snapCells; dc <= snapCells; dc++) {
    const r = Math.round(p.row) + dr, c = Math.round(p.col) + dc; if (r < 0 || c < 0 || r >= g.height || c >= g.width) continue;
    const i = r * g.width + c; if (acc[i] > bestAcc) { bestAcc = acc[i]; best = i; }
  }
  if (best < 0) throw new Error("Pour point is outside the analysed area");
  // upstream = cells whose flow path reaches `best`; walk the inverse graph
  const mask = new Uint8Array(g.width * g.height); mask[best] = 1;
  const stack = [best];
  while (stack.length) {
    const i = stack.pop()!, r = Math.floor(i / g.width), c = i % g.width;
    for (let k = 0; k < 8; k++) {
      const cc = c - D8[k][0], rr = r - D8[k][1]; if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height) continue;
      const j = rr * g.width + cc; if (!mask[j] && dir[j] === k) { mask[j] = 1; stack.push(j); }
    }
  }
  const poly = maskPolygons(g, mask, 1);
  const el = stats(g.values, mask);
  const touchesEdge = (() => { for (let c = 0; c < g.width; c++) if (mask[c] || mask[(g.height - 1) * g.width + c]) return true; for (let r = 0; r < g.height; r++) if (mask[r * g.width] || mask[r * g.width + g.width - 1]) return true; return false; })();
  const outlet: LngLat = [cellLng(g, best % g.width), cellLat(g, Math.floor(best / g.width))];
  return { ...poly, outlet, upstreamCells: bestAcc, elevation: el, truncated: touchesEdge, drainage: drainageLines(g, dir, acc, Math.max(20, bestAcc / 40)).slice(0, 4000) };
}

// ---------- visibility ----------
/** Viewshed from an observer (height above ground), target height above ground, radius in cells. 1 = visible. */
export function viewshed(g: DemGrid, observer: LngLat, observerHeightM = 2, targetHeightM = 0) {
  const { width: w, height: h } = g, { dx, dy } = cellSizeM(g);
  const o = toCell(g, observer[0], observer[1]), oc = Math.round(o.col), or = Math.round(o.row);
  if (oc < 0 || or < 0 || oc >= w || or >= h) throw new Error("Observer is outside the analysed area");
  const oz = at(g, oc, or) + observerHeightM;
  const vis = new Uint8Array(w * h); vis[or * w + oc] = 1;
  const perimeter: [number, number][] = [];
  for (let c = 0; c < w; c++) perimeter.push([c, 0], [c, h - 1]);
  for (let r = 1; r < h - 1; r++) perimeter.push([0, r], [w - 1, r]);
  for (const [tc, tr] of perimeter) {
    const steps = Math.max(Math.abs(tc - oc), Math.abs(tr - or)); let maxAngle = -Infinity;
    for (let s = 1; s <= steps; s++) {
      const c = Math.round(oc + ((tc - oc) * s) / steps), r = Math.round(or + ((tr - or) * s) / steps);
      const dist = Math.hypot((c - oc) * dx, (r - or) * dy); if (!dist) continue;
      const z = at(g, c, r), angle = (z - oz) / dist, tAngle = (z + targetHeightM - oz) / dist;
      if (tAngle >= maxAngle) vis[r * w + c] = 1;
      if (angle > maxAngle) maxAngle = angle;
    }
  }
  const poly = maskPolygons(g, vis, 1);
  return { ...poly, observerElevation: oz - observerHeightM };
}

/** Line of sight between two points: blocked where terrain rises above the sight line. */
export function lineOfSight(g: DemGrid, a: LngLat, b: LngLat, heightA = 2, heightB = 2, samples = 200) {
  const za = sampleElevation(g, a[0], a[1]) + heightA, zb = sampleElevation(g, b[0], b[1]) + heightB, total = haversine(a, b);
  for (let s = 1; s < samples; s++) {
    const t = s / samples, lng = a[0] + t * (b[0] - a[0]), lat = a[1] + t * (b[1] - a[1]);
    const z = sampleElevation(g, lng, lat), sight = za + t * (zb - za);
    if (z > sight) return { visible: false, blockedAt: [lng, lat] as LngLat, blockedDistanceM: t * total, clearanceM: sight - z };
  }
  return { visible: true, blockedAt: null, blockedDistanceM: null, clearanceM: null };
}

// ---------- earthworks ----------
/** Cut/fill screening to a level platform at `targetElevation` (defaults to the mean) inside a mask. */
export function cutFill(g: DemGrid, mask: Uint8Array, targetElevation?: number) {
  const { dx, dy } = cellSizeM(g), cellArea = dx * dy, s = stats(g.values, mask);
  const t = targetElevation ?? s.mean;
  let cut = 0, fill = 0, cells = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue; const z = g.values[i]; if (!Number.isFinite(z)) continue;
    cells++; if (z > t) cut += (z - t) * cellArea; else fill += (t - z) * cellArea;
  }
  return { targetElevation: t, cutM3: cut, fillM3: fill, netM3: cut - fill, areaHa: (cells * cellArea) / 10_000 };
}

/** Rasterises a polygon (outer ring + holes, lng/lat) onto the grid. */
export function polygonMask(g: DemGrid, rings: number[][][]) {
  const mask = new Uint8Array(g.width * g.height);
  const inside = (x: number, y: number, ring: number[][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const x = cellLng(g, c), y = cellLat(g, r);
    if (inside(x, y, rings[0]) && !rings.slice(1).some(hole => inside(x, y, hole))) mask[r * g.width + c] = 1;
  }
  return mask;
}

/** Plain-language limitation string carried by every terrain output. */
export function demLimitation(g: DemGrid) {
  return `SCREENING: ${g.source}, ~${Math.round(g.resolutionM)} m cells. Not survey-grade; not for final engineering design. Vertical datum: EGM96 geoid (source default).`;
}
