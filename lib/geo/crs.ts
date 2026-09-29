// Coordinate reference helpers: WGS84 ↔ UTM (proj4), coordinate parsing (decimal, DMS, UTM) and formatting.
// Measurements are geodesic in WGS84; UTM is offered for entry, display and exports that need metres.
import proj4 from "proj4";

export function utmZone(lng: number, lat: number) {
  let zone = Math.floor((lng + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;           // Norway exception
  if (lat >= 72 && lat < 84) zone = lng < 9 ? 31 : lng < 21 ? 33 : lng < 33 ? 35 : 37; // Svalbard
  return { zone, hemisphere: lat >= 0 ? "N" as const : "S" as const, epsg: (lat >= 0 ? 32600 : 32700) + zone };
}
const utmDef = (zone: number, south: boolean) => `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;

export function toUtm(lng: number, lat: number) {
  const z = utmZone(lng, lat);
  const [easting, northing] = proj4("WGS84", utmDef(z.zone, z.hemisphere === "S"), [lng, lat]);
  return { ...z, easting, northing, label: `${z.zone}${z.hemisphere} ${Math.round(easting)} E ${Math.round(northing)} N (EPSG:${z.epsg})` };
}
export function fromUtm(zone: number, hemisphere: "N" | "S", easting: number, northing: number): [number, number] {
  if (zone < 1 || zone > 60) throw new Error("UTM zone must be 1–60");
  const [lng, lat] = proj4(utmDef(zone, hemisphere === "S"), "WGS84", [easting, northing]);
  return [lng, lat];
}

/** Parses "19.43, -99.13", "19°25'48\"N 99°07'48\"W", or UTM "14N 486000 2148000". Returns [lng, lat]. */
export function parseAnyCoordinate(input: string): [number, number] | null {
  const s = input.trim().toUpperCase();
  const utm = s.match(/^(\d{1,2})\s*([NS])\s+(\d+(?:\.\d+)?)\s*(?:E|MEE)?[\s,]+(\d+(?:\.\d+)?)\s*(?:N|MN)?$/);
  if (utm) { try { return fromUtm(Number(utm[1]), utm[2] as "N" | "S", Number(utm[3]), Number(utm[4])); } catch { return null; } }
  const dms = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])/g)];
  if (dms.length === 2) {
    const val = (m: RegExpMatchArray) => (Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600) * (m[4] === "S" || m[4] === "W" ? -1 : 1);
    const lat = dms.find(m => m[4] === "N" || m[4] === "S"), lng = dms.find(m => m[4] === "E" || m[4] === "W");
    if (lat && lng) return [val(lng), val(lat)];
  }
  const dec = s.match(/^(-?\d+(?:\.\d+)?)\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*([EW])?$/);
  if (!dec) return null;
  let a = Number(dec[1]), b = Number(dec[3]);
  if (dec[2] === "S") a = -Math.abs(a);
  if (dec[4] === "W") b = -Math.abs(b);
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [b, a];
}

export function formatDms(v: number, pos: string, neg: string) {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}′${s.toFixed(1).padStart(4, "0")}″${v >= 0 ? pos : neg}`;
}
