import { outreachConfig } from "@/lib/config";
import { metadata } from "@/lib/mcp/oauth";

// OAuth protected resource metadata (RFC 9728) for /api/mcp. Public by definition.
export function GET() {
  return Response.json(metadata(outreachConfig().appBaseUrl).protectedResource, { headers: { "access-control-allow-origin": "*" } });
}
