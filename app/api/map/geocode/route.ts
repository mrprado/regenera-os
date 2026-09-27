import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { geocode } from "@/lib/sources/geocode";

// Guarded: explicit place search from the Atlas (on Enter only, never autocomplete: Nominatim usage policy).
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200);
  try {
    const r = await geocode(appDb(), q);
    if (r === "busy") return Response.json({ error: "Geocoder busy, try again in a second" }, { status: 429 });
    return Response.json({ result: r }, { headers: { "cache-control": "private, max-age=3600" } });
  } catch (error) {
    return Response.json({ error: `Geocoder unavailable: ${(error as Error).message.slice(0, 120)}` }, { status: 503 });
  }
}
