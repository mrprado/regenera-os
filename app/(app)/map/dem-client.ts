// Browser loader for the terrain engine: fetches AWS Terrain Tiles (terrarium PNG, the same DEM the globe uses),
// decodes them and resamples to a regular lng/lat grid over the requested bbox. Cached per tile for the session.
import { chooseZoom, decodeTerrarium, lngLatToTile, tileResolutionM, type DemGrid } from "@/lib/geo/dem";

const TILE = 256;
const URL_T = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const cache = new Map<string, Promise<Float32Array | null>>();
export const DEM_SOURCE = "AWS Terrain Tiles (Mapzen terrarium; SRTM, GMTED, ETOPO1, national DEMs where available)";

async function tile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const r = await fetch(URL_T(z, x, y));
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const c = new OffscreenCanvas(TILE, TILE), ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, TILE, TILE).data, out = new Float32Array(TILE * TILE);
    for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    return out;
  })().catch(() => null));
  return cache.get(key)!;
}

const worldPx = (lng: number, lat: number, z: number) => {
  const s = TILE * 2 ** z, sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
};

/** Elevation grid over a bbox (≤ maxCells on the longer side). Throws when tiles cannot be loaded. */
export async function loadDem(bbox: [number, number, number, number], maxCells = 320): Promise<DemGrid> {
  const [west, south, east, north] = bbox;
  if (!(east > west && north > south)) throw new Error("Empty area");
  const z = chooseZoom(west, south, east, north, maxCells);
  const a = lngLatToTile(west, north, z), b = lngLatToTile(east, south, z);
  if ((b.x - a.x + 1) * (b.y - a.y + 1) > 36) throw new Error("Area too large for terrain analysis in the browser; draw a smaller area");
  const tiles = new Map<string, Float32Array | null>();
  await Promise.all(Array.from({ length: b.x - a.x + 1 }, (_, i) => a.x + i).flatMap(x => Array.from({ length: b.y - a.y + 1 }, (_, j) => a.y + j).map(async y => { tiles.set(`${x}/${y}`, await tile(z, x, y)); })));
  if ([...tiles.values()].every(t => !t)) throw new Error("Terrain tiles unavailable (network or provider). No terrain result was produced.");
  const p0 = worldPx(west, north, z), p1 = worldPx(east, south, z);
  const spanPx = Math.max(p1.x - p0.x, p1.y - p0.y);
  const scale = Math.min(1, maxCells / spanPx);
  const width = Math.max(8, Math.round((p1.x - p0.x) * scale)), height = Math.max(8, Math.round((p1.y - p0.y) * scale));
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const lat = north - ((r + 0.5) / height) * (north - south);
    for (let c = 0; c < width; c++) {
      const lng = west + ((c + 0.5) / width) * (east - west);
      const p = worldPx(lng, lat, z), tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      const t = tiles.get(`${tx}/${ty}`);
      values[r * width + c] = t ? t[Math.min(TILE - 1, Math.floor(p.y - ty * TILE)) * TILE + Math.min(TILE - 1, Math.floor(p.x - tx * TILE))] : NaN;
    }
  }
  const midLat = (north + south) / 2;
  const nativeRes = tileResolutionM(z, midLat);
  const cellRes = Math.max(nativeRes, ((east - west) * 111_320 * Math.cos((midLat * Math.PI) / 180)) / width);
  // Terrarium z≤14 is ~10 m at best; the true source resolution is often coarser (SRTM ~30 m).
  return { width, height, west, south, east, north, values, source: DEM_SOURCE, resolutionM: Math.max(cellRes, 30), zoom: z };
}
