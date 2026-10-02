import { env } from "cloudflare:workers";
import { and, inArray, sql } from "drizzle-orm";
import { integrations, providerCalls } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { offerCatalog } from "@/lib/map/catalog";
import { freshnessOf, PROVENANCE } from "@/lib/map/provenance";
import { DATASETS, providerOf } from "@/lib/data-providers/catalog";

// Layers whose data passes through the Worker (fetchJson → provider_calls), so their freshness is measured, not assumed.
const SERVED_KINDS = new Set(["feed", "satellites"]);
const ALSO_LEDGERED: Record<string, string[]> = { nasa_firms_public: ["nasa_firms"] };

// Guarded: the Atlas layer catalogue, filtered by the integration registry and configured keys, with each layer's
// tier, provenance, licence terms (from the registry) and measured freshness. Browser-side keys (Esri) are
// referrer-restricted at the provider; server-only keys never leave the Worker.
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const db = appDb();
  let states = new Map<string, string>();
  let registry = new Map<string, typeof integrations.$inferSelect>();
  try {
    const rows = await db.select().from(integrations);
    states = new Map(rows.map(r => [r.key, r.featureState]));
    registry = new Map(rows.map(r => [r.key, r]));
  } catch { /* registry not migrated: offer everything that needs no key */ }
  const e = env as unknown as Record<string, string | undefined>;
  const offered = offerCatalog(states, { ESRI_API_KEY: e.ESRI_API_KEY, MAPILLARY_TOKEN: e.MAPILLARY_TOKEN });

  const served = offered.filter(l => SERVED_KINDS.has(l.kind));
  const keys = [...new Set(served.flatMap(l => [l.registry, ...(ALSO_LEDGERED[l.registry] ?? [])]))];
  const ledger = keys.length ? await db.select({ provider: providerCalls.provider, ok: providerCalls.ok, last: sql<string>`max(${providerCalls.createdAt})` })
    .from(providerCalls).where(and(inArray(providerCalls.provider, keys), sql`${providerCalls.createdAt} > ${new Date(Date.now() - 30 * 86_400_000).toISOString()}`))
    .groupBy(providerCalls.provider, providerCalls.ok) : [];
  const last = (provider: string, ok: boolean) => [provider, ...(ALSO_LEDGERED[provider] ?? [])].map(p => ledger.find(r => r.provider === p && Boolean(r.ok) === ok)?.last ?? null).filter(Boolean).sort().at(-1) ?? null;

  const layers = offered.map(l => {
    const p = PROVENANCE[l.id];
    const r = registry.get(l.registry);
    // Served feeds are fetched (through the cache) when switched on, so age between visits is not staleness; what the
    // ledger can tell honestly is whether the most recent fetch failed. The panel shows each load's time as it happens.
    const served = SERVED_KINDS.has(l.kind);
    const ok = last(l.registry, true), fail = last(l.registry, false);
    const fresh = !p ? { status: "not_tracked" as const, ageH: null }
      : served ? { status: fail && (!ok || fail > ok) ? "unavailable" as const : "on_demand" as const, ageH: ok ? (Date.now() - Date.parse(ok)) / 3_600_000 : null }
      : freshnessOf(p, false, null, null);
    return {
      ...l,
      provenance: p ?? null,
      dataset: (() => { const d = DATASETS.find(x => x.atlasLayer === l.id); if (!d) return null; const pv = providerOf(d.provider); return { id: d.id, provider: pv?.name ?? d.provider, platform: pv?.platforms.find(x => x.key === d.platform)?.name ?? null, name: d.name, version: d.version ?? null, role: d.analyticalRole, limitation: d.limitations[0] ?? null, evidenceLevel: d.evidenceLevel, localValidation: d.localValidationRequired }; })(),
      terms: r ? { license: r.license, licenseUrl: r.licenseUrl, commercialUse: r.commercialUse, redistribution: r.redistribution, attribution: r.attribution } : null,
      freshness: { ...fresh, lastOk: SERVED_KINDS.has(l.kind) ? last(l.registry, true) : null },
    };
  });
  // Street-level providers in order of preference. Only browser-safe, referrer-restricted keys are sent.
  const streetView = e.GOOGLE_MAPS_BROWSER_KEY ? { provider: "google" as const, key: e.GOOGLE_MAPS_BROWSER_KEY } : e.MAPILLARY_TOKEN ? { provider: "mapillary" as const, key: e.MAPILLARY_TOKEN } : { provider: "none" as const, key: "" };
  return Response.json({ layers, firmsKey: Boolean(e.NASA_FIRMS_MAP_KEY), streetView, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=120" } });
}
