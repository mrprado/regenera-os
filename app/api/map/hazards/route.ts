import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { gdacsSignals } from "@/lib/sources/signals";

// Guarded proxy: current GDACS red/orange alerts (via regenera.bio's intelligence API), cached 1h.
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  try {
    const events = await gdacsSignals(appDb());
    return Response.json({
      type: "FeatureCollection",
      features: events.filter(e => e.lat != null && e.lng != null).map(e => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.lng, e.lat] },
        properties: { id: e.externalId, title: e.title, url: e.url, date: e.publishedAt, country: e.country, level: e.title.startsWith("Red") ? "Red" : "Orange", kind: e.summary },
      })),
    }, { headers: { "cache-control": "private, max-age=900" } });
  } catch {
    return Response.json({ type: "FeatureCollection", features: [] });
  }
}
