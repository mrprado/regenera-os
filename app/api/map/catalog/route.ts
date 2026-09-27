import { env } from "cloudflare:workers";
import { integrations } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { offerCatalog } from "@/lib/map/catalog";

// Guarded: the Atlas layer catalogue, filtered by the integration registry and configured keys. Browser-side keys
// (Esri) are referrer-restricted at the provider; server-only keys never leave the Worker.
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  let states = new Map<string, string>();
  try {
    const rows = await appDb().select({ key: integrations.key, state: integrations.featureState }).from(integrations);
    states = new Map(rows.map(r => [r.key, r.state]));
  } catch { /* registry not migrated: offer everything that needs no key */ }
  const layers = offerCatalog(states, { ESRI_API_KEY: env.ESRI_API_KEY });
  return Response.json({ layers, firmsKey: Boolean(env.NASA_FIRMS_MAP_KEY), generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=300" } });
}
