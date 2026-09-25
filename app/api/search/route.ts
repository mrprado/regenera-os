// Global search for Cmd+K (signed-in users; every query mandate-scoped).
import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { globalSearch } from "@/lib/search";

export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ hits: await globalSearch(appDb(), user.scope, q) }, { headers: { "cache-control": "private, no-store" } });
}
