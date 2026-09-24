import { appDb } from "@/lib/db/scoped";
import { exchangeToken } from "@/lib/mcp/oauth";

// Anonymous route: OAuth token endpoint. exchangeToken checks the single-use code, the client, the redirect URI
// and the PKCE verifier (or rotates a refresh token).
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const form = type.includes("application/json")
    ? new URLSearchParams(Object.entries((await request.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await request.text());
  const r = await exchangeToken(appDb(), form);
  return Response.json(r.body, { status: r.ok ? 200 : 400, headers: { ...CORS, "cache-control": "no-store" } });
}
