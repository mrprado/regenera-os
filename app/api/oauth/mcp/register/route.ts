import { appDb } from "@/lib/db/scoped";
import { registerClient, zRegistration } from "@/lib/mcp/oauth";

// Anonymous route: OAuth dynamic client registration (RFC 7591) for MCP clients such as claude.ai.
// Registering grants nothing: a client still needs a signed-in member's consent and PKCE to get a token.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const parsed = zRegistration.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_client_metadata", error_description: "client_name and redirect_uris are required" }, { status: 400, headers: CORS });
  try {
    return Response.json(await registerClient(appDb(), parsed.data), { status: 201, headers: CORS });
  } catch (e) {
    return Response.json({ error: "invalid_redirect_uri", error_description: (e as Error).message }, { status: 400, headers: CORS });
  }
}
