import { getOsApiUser } from "@/lib/auth";
import { mapFeatures } from "@/lib/map/features";

// Guarded: the signed-in member's mandates only.
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  return Response.json(await mapFeatures(user.scope), { headers: { "cache-control": "private, max-age=60" } });
}
