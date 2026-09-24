import { appDb } from "@/lib/db/scoped";
import { handleExtensionRequest, verifyExtensionToken, zExtensionRequest } from "@/lib/extension";

// Anonymous route (SPEC section 23): the LinkedIn extension, authenticated by a per-user token from Settings.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const db = appDb();
  const user = await verifyExtensionToken(db, request.headers.get("authorization"));
  if (!user) return Response.json({ error: "Invalid or revoked token. Issue a new one in Settings, Extension." }, { status: 401, headers: CORS });
  const parsed = zExtensionRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unrecognized request" }, { status: 400, headers: CORS });
  const r = await handleExtensionRequest(db, user, parsed.data);
  return Response.json(r.body, { status: r.status, headers: CORS });
}
