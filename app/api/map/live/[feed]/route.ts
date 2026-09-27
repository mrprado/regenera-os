import { env } from "cloudflare:workers";
import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { cyclones, eonet, fires, flights, militaryFlights, parseBbox, quakes, SAT_GROUPS, satellites, type SatGroup } from "@/lib/map/live";

// Guarded: Atlas live feeds. Every provider call goes through fetchJson (registry gate, cache, ledger). Short
// browser caching matches each feed's refresh; failures say "unavailable", never "none".
const CACHE: Record<string, number> = { quakes: 120, events: 900, cyclones: 600, fires: 600, flights: 10, military: 20, sat: 3600 };

export async function GET(request: Request, { params }: { params: Promise<{ feed: string }> }) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const { feed } = await params;
  const q = new URL(request.url).searchParams;
  const db = appDb();
  try {
    let body: unknown;
    if (feed === "quakes") body = await quakes(db);
    else if (feed === "events") body = await eonet(db);
    else if (feed === "cyclones") body = await cyclones(db);
    else if (feed === "fires") body = await fires(db, env.NASA_FIRMS_MAP_KEY, parseBbox(q.get("bbox")));
    else if (feed === "military") body = await militaryFlights(db);
    else if (feed === "flights") {
      const lat = Number(q.get("lat")), lng = Number(q.get("lng")), dist = Number(q.get("dist") ?? 150);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Response.json({ error: "lat and lng required" }, { status: 400 });
      body = await flights(db, lat, lng, Number.isFinite(dist) ? dist : 150);
    } else if (feed.startsWith("sat:")) {
      const group = feed.slice(4) as SatGroup;
      if (!SAT_GROUPS.includes(group)) return Response.json({ error: "Unknown group" }, { status: 404 });
      body = await satellites(db, group);
    } else return Response.json({ error: "Unknown feed" }, { status: 404 });
    const ttl = CACHE[feed.startsWith("sat:") ? "sat" : feed] ?? 60;
    return Response.json(body, { headers: { "cache-control": `private, max-age=${ttl}` } });
  } catch (error) {
    return Response.json({ error: `Feed unavailable: ${(error as Error).message.slice(0, 160)}` }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
