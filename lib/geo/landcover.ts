// Site land-cover composition from ESA WorldCover 10 m (2021, v200), read as Cloud-Optimised GeoTIFF windows from
// AWS Open Data with geotiff.js. Free replacement for an Earth Engine / AlphaEarth composition call. Screening grade:
// a satellite classification, not a habitat survey.
import { fromUrl } from "geotiff";

export const WORLDCOVER_CLASSES: Record<number, { label: string; natural: boolean; color: string }> = {
  10: { label: "Tree cover", natural: true, color: "#006400" },
  20: { label: "Shrubland", natural: true, color: "#ffbb22" },
  30: { label: "Grassland", natural: true, color: "#ffff4c" },
  40: { label: "Cropland", natural: false, color: "#f096ff" },
  50: { label: "Built-up", natural: false, color: "#fa0000" },
  60: { label: "Bare / sparse vegetation", natural: false, color: "#b4b4b4" },
  70: { label: "Snow and ice", natural: false, color: "#f0f0f0" },
  80: { label: "Permanent water", natural: false, color: "#0064c8" },
  90: { label: "Herbaceous wetland", natural: true, color: "#0096a0" },
  95: { label: "Mangroves", natural: true, color: "#00cf75" },
  100: { label: "Moss and lichen", natural: true, color: "#fae6a0" },
};
export const WORLDCOVER_ATTRIBUTION = "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0)";
const BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map";

type Ring = number[][];
type Poly = Ring[];
export type SiteGeometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

export function tileName(lat: number, lng: number) {
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lng / 3) * 3;
  return `${la < 0 ? "S" : "N"}${String(Math.abs(la)).padStart(2, "0")}${lo < 0 ? "W" : "E"}${String(Math.abs(lo)).padStart(3, "0")}`;
}

function polygons(g: SiteGeometry): Poly[] { return g.type === "Polygon" ? [g.coordinates] : g.coordinates; }

export function bboxOf(g: SiteGeometry): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polygons(g)) for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

/** Even-odd point in polygon across all polygons and their holes. */
export function inside(polys: Poly[], x: number, y: number) {
  for (const p of polys) {
    let c = false;
    for (const ring of p) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    if (c) return true;
  }
  return false;
}

/** Tally class counts on a raster grid covering bbox, masked by the site polygons. Pure; used by tests. */
export function tally(values: ArrayLike<number>, width: number, height: number, bbox: [number, number, number, number], polys: Poly[]) {
  const [w, s, e, n] = bbox, dx = (e - w) / width, dy = (n - s) / height;
  const counts = new Map<number, number>(); let cells = 0, areaHa = 0;
  const cellHa = (lat: number) => (dx * 111_320 * Math.cos((lat * Math.PI) / 180)) * (dy * 110_574) / 10_000;
  for (let r = 0; r < height; r++) {
    const y = n - (r + 0.5) * dy, ha = cellHa(y);
    for (let c = 0; c < width; c++) {
      if (!inside(polys, w + (c + 0.5) * dx, y)) continue;
      const v = values[r * width + c];
      counts.set(v, (counts.get(v) ?? 0) + ha); cells++; areaHa += ha;
    }
  }
  return { counts, cells, areaHa };
}

export type Composition = {
  source: string; attribution: string; grade: "SCREENING"; resolutionM: number; siteHa: number;
  classes: { code: number; label: string; ha: number; pct: number; natural: boolean; color: string }[];
  naturalHa: number; naturalPct: number; convertedHa: number; waterHa: number; noDataHa: number; tiles: string[]; limitation: string;
};

/** Land-cover composition of a site polygon. Reads at native 10 m for small sites, downsampled to ≤ maxCells per side. */
export async function landCoverComposition(g: SiteGeometry, maxCells = 700, open: typeof fromUrl = fromUrl): Promise<Composition> {
  const polys = polygons(g), [w, s, e, n] = bboxOf(g);
  if (!(e > w && n > s)) throw new Error("Site geometry has no area");
  const total = new Map<number, number>(); let siteHa = 0, cellsAll = 0; const tiles: string[] = []; let resolutionM = 10;
  for (let la = Math.floor(s / 3) * 3; la < n; la += 3) for (let lo = Math.floor(w / 3) * 3; lo < e; lo += 3) {
    const bb: [number, number, number, number] = [Math.max(w, lo), Math.max(s, la), Math.min(e, lo + 3), Math.min(n, la + 3)];
    if (!(bb[2] > bb[0] && bb[3] > bb[1])) continue;
    const name = tileName(la + 1.5, lo + 1.5);
    const native = [(bb[2] - bb[0]) * 12_000, (bb[3] - bb[1]) * 12_000];
    const k = Math.max(1, Math.max(...native) / maxCells);
    const width = Math.max(1, Math.round(native[0] / k)), height = Math.max(1, Math.round(native[1] / k));
    resolutionM = Math.max(resolutionM, Math.round(10 * k));
    let values: ArrayLike<number>;
    try {
      const tif = await open(`${BASE}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`);
      const r = await tif.readRasters({ bbox: bb, width, height, resampleMethod: "nearest", interleave: false });
      values = (r as unknown as ArrayLike<number>[])[0];
      tiles.push(name);
    } catch {
      values = new Uint8Array(width * height); // no tile (open ocean) or unreachable: counted as no data
    }
    const t = tally(values, width, height, bb, polys);
    for (const [c, ha] of t.counts) total.set(c, (total.get(c) ?? 0) + ha);
    siteHa += t.areaHa; cellsAll += t.cells;
  }
  if (cellsAll === 0) throw new Error("Site is smaller than one analysis cell");
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const classes = [...total].filter(([c]) => WORLDCOVER_CLASSES[c]).map(([code, ha]) => ({ code, ...WORLDCOVER_CLASSES[code], ha: r1(ha), pct: r1((ha / siteHa) * 100) })).sort((a, b) => b.ha - a.ha);
  const sum = (f: (c: number) => boolean) => r1([...total].filter(([c]) => f(c)).reduce((a, [, ha]) => a + ha, 0));
  const naturalHa = sum(c => !!WORLDCOVER_CLASSES[c]?.natural);
  return {
    source: "ESA WorldCover 10 m 2021 v200", attribution: WORLDCOVER_ATTRIBUTION, grade: "SCREENING", resolutionM, siteHa: r1(siteHa), classes,
    naturalHa, naturalPct: r1((naturalHa / siteHa) * 100), convertedHa: sum(c => c === 40 || c === 50), waterHa: sum(c => c === 80), noDataHa: sum(c => !WORLDCOVER_CLASSES[c]), tiles,
    limitation: `Satellite land-cover classification (2021, ~${resolutionM} m cells, reported accuracy ~75% globally). Natural cover is a screening proxy for habitat, not a habitat or biodiversity survey; field verification is required before any habitat-loss figure is relied on.`,
  };
}
