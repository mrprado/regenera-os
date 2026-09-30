// Google Earth Engine provider (server-only). Official REST API: a service account signs a JWT (RS256, WebCrypto) for
// an OAuth token with the earthengine scope, and computations are sent as expression graphs to
// projects/{project}:value:compute. Nothing here runs in the browser; the key is a Worker secret.
// Status: NOT CONNECTED until EARTH_ENGINE_SERVICE_ACCOUNT (the JSON key) and EARTH_ENGINE_PROJECT_ID are set.
// The expression builders follow the documented serialisation of the Earth Engine client libraries; each analysis
// is verified against a live account by `testConnection` and the first run, and failures are reported, never masked.

export type EeConfig = { projectId: string; clientEmail: string; privateKey: string };
export type EeStatus = { connected: boolean; reason: string };

export function eeConfig(env: Record<string, string | undefined>): EeConfig | null {
  const raw = env.EARTH_ENGINE_SERVICE_ACCOUNT, project = env.EARTH_ENGINE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT_ID;
  if (!raw || !project) return null;
  try {
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!j.client_email || !j.private_key) return null;
    return { projectId: project, clientEmail: j.client_email, privateKey: j.private_key };
  } catch { return null; }
}
export function eeStatus(env: Record<string, string | undefined>): EeStatus {
  if (!env.EARTH_ENGINE_SERVICE_ACCOUNT) return { connected: false, reason: "NOT CONNECTED: set EARTH_ENGINE_SERVICE_ACCOUNT (service-account JSON) as a Worker secret" };
  if (!(env.EARTH_ENGINE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT_ID)) return { connected: false, reason: "NOT CONNECTED: set EARTH_ENGINE_PROJECT_ID (a Cloud project registered for Earth Engine)" };
  return eeConfig(env) ? { connected: true, reason: "Configured" } : { connected: false, reason: "EARTH_ENGINE_SERVICE_ACCOUNT is not a valid service-account JSON key" };
}

// ---------- OAuth (service-account JWT) ----------
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function pemToDer(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
let cached: { token: string; exp: number; key: string } | null = null;
export async function accessToken(cfg: EeConfig, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string> {
  if (cached && cached.key === cfg.clientEmail && cached.exp - 60_000 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: cfg.clientEmail, scope: "https://www.googleapis.com/auth/earthengine", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(cfg.privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const r = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }) });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Earth Engine auth failed: ${j.error_description ?? j.error ?? r.status}`);
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000, key: cfg.clientEmail };
  return j.access_token;
}

// ---------- Expression graph builder ----------
type Node = { constantValue: unknown } | { functionInvocationValue: { functionName: string; arguments: Record<string, Node> } } | { arrayValue: { values: Node[] } } | { dictionaryValue: { values: Record<string, Node> } };
export const K = (v: unknown): Node => ({ constantValue: v });
export const F = (functionName: string, args: Record<string, Node | undefined>): Node => ({ functionInvocationValue: { functionName, arguments: Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) as Record<string, Node> } });
export const A = (values: Node[]): Node => ({ arrayValue: { values } });
export function expression(root: Node) { return { expression: { result: "0", values: { "0": root } } }; }

export type SiteGeometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
export const geometry = (g: SiteGeometry): Node => F(g.type === "Polygon" ? "GeometryConstructors.Polygon" : "GeometryConstructors.MultiPolygon", { coordinates: K(g.coordinates), evenOdd: K(true) });
const loadCollection = (id: string) => F("ImageCollection.load", { id: K(id) });
const filterDate = (c: Node, start: string, end: string) => F("Collection.filter", { collection: c, filter: F("Filter.dateRangeContains", { leftValue: F("DateRange", { start: K(start), end: K(end) }), rightField: K("system:time_start") }) });
const filterBounds = (c: Node, g: Node) => F("Collection.filter", { collection: c, filter: F("Filter.intersects", { leftField: K(".all"), rightValue: g }) });
const reduceCollection = (c: Node, reducer: string) => F("ImageCollection.reduce", { collection: c, reducer: F(reducer, {}) });
const reduceRegion = (image: Node, g: Node, reducer: Node, scale: number) => F("Image.reduceRegion", { image, reducer, geometry: g, scale: K(scale), maxPixels: K(1e9), bestEffort: K(true) });
const meanStd = () => F("Reducer.combine", { reducer1: F("Reducer.mean", {}), reducer2: F("Reducer.stdDev", {}), sharedInputs: K(true) });

export async function computeValue(cfg: EeConfig, root: Node, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const token = await accessToken(cfg, fetchImpl);
  const r = await fetchImpl(`https://earthengine.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/value:compute`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(expression(root)) });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (!r.ok) throw new Error(`Earth Engine: ${j.error?.message ?? r.status}`);
  return j.result;
}

/** Smallest possible round trip: proves credentials, project registration and the compute endpoint. */
export async function testConnection(cfg: EeConfig, fetchImpl: typeof fetch = fetch) {
  const v = await computeValue(cfg, F("Number.add", { left: K(1), right: K(1) }), fetchImpl);
  if (v !== 2) throw new Error(`Unexpected test result ${JSON.stringify(v)}`);
  return { ok: true };
}

// ---------- Analyses (each reduces over the exact site geometry) ----------
export async function vegetation(cfg: EeConfig, g: SiteGeometry, start: string, end: string, fetchImpl?: typeof fetch) {
  const geo = geometry(g);
  const s2 = filterBounds(filterDate(loadCollection("COPERNICUS/S2_SR_HARMONIZED"), start, end), geo);
  const median = reduceCollection(s2, "Reducer.median");
  const ndvi = F("Image.normalizedDifference", { input: median, bandNames: K(["B8_median", "B4_median"]) });
  const v = (await computeValue(cfg, reduceRegion(ndvi, geo, meanStd(), 10), fetchImpl)) as Record<string, number | null>;
  return { ndviMean: v.nd_mean ?? null, ndviStd: v.nd_stdDev ?? null, dataset: "COPERNICUS/S2_SR_HARMONIZED", scaleM: 10, start, end };
}

export async function ndviChange(cfg: EeConfig, g: SiteGeometry, base: [string, string], compare: [string, string], fetchImpl?: typeof fetch) {
  const [a, b] = await Promise.all([vegetation(cfg, g, base[0], base[1], fetchImpl), vegetation(cfg, g, compare[0], compare[1], fetchImpl)]);
  return { baseline: a, comparison: b, delta: a.ndviMean !== null && b.ndviMean !== null ? b.ndviMean - a.ndviMean : null };
}

export async function surfaceWater(cfg: EeConfig, g: SiteGeometry, fetchImpl?: typeof fetch) {
  const geo = geometry(g);
  const occ = F("Image.select", { input: F("Image.load", { id: K("JRC/GSW1_4/GlobalSurfaceWater") }), bandSelectors: K(["occurrence"]) });
  const v = (await computeValue(cfg, reduceRegion(occ, geo, F("Reducer.combine", { reducer1: F("Reducer.mean", {}), reducer2: F("Reducer.max", {}), sharedInputs: K(true) }), 30), fetchImpl)) as Record<string, number | null>;
  return { occurrenceMeanPct: v.occurrence_mean ?? null, occurrenceMaxPct: v.occurrence_max ?? null, dataset: "JRC/GSW1_4/GlobalSurfaceWater", scaleM: 30 };
}

export async function terrain(cfg: EeConfig, g: SiteGeometry, fetchImpl?: typeof fetch) {
  const geo = geometry(g);
  const dem = F("ImageCollection.mosaic", { collection: F("Collection.filter", { collection: loadCollection("COPERNICUS/DEM/GLO30"), filter: F("Filter.intersects", { leftField: K(".all"), rightValue: geo }) }) });
  const elev = F("Image.select", { input: dem, bandSelectors: K(["DEM"]) });
  const slope = F("Terrain.slope", { input: elev });
  const both = F("Image.addBands", { dstImg: elev, srcImg: slope });
  const red = F("Reducer.combine", { reducer1: F("Reducer.minMax", {}), reducer2: F("Reducer.mean", {}), sharedInputs: K(true) });
  const v = (await computeValue(cfg, reduceRegion(both, geo, red, 30), fetchImpl)) as Record<string, number | null>;
  return { elevationMin: v.DEM_min ?? null, elevationMax: v.DEM_max ?? null, elevationMean: v.DEM_mean ?? null, slopeMeanDeg: v.slope_mean ?? null, slopeMaxDeg: v.slope_max ?? null, dataset: "COPERNICUS/DEM/GLO30", scaleM: 30 };
}

/** AlphaEarth Foundations annual embedding (64 bands A00–A63), averaged over the site. Backend-only representation. */
export async function siteEmbedding(cfg: EeConfig, g: SiteGeometry, year: number, fetchImpl?: typeof fetch) {
  const geo = geometry(g);
  const col = filterBounds(filterDate(loadCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"), `${year}-01-01`, `${year + 1}-01-01`), geo);
  const img = F("ImageCollection.mosaic", { collection: col });
  const v = (await computeValue(cfg, reduceRegion(img, geo, F("Reducer.mean", {}), 10), fetchImpl)) as Record<string, number | null>;
  const vec = Array.from({ length: 64 }, (_, i) => v[`A${String(i).padStart(2, "0")}`]);
  if (vec.some(x => x === null || x === undefined)) throw new Error("Embedding unavailable for this site and year");
  return { year, vector: vec as number[], dataset: "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL", scaleM: 10 };
}

export function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
