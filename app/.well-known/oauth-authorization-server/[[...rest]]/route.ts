import { outreachConfig } from "@/lib/config";
import { metadata } from "@/lib/mcp/oauth";

// OAuth authorization server metadata (RFC 8414) for the MCP server. Public by definition.
export function GET() {
  return Response.json(metadata(outreachConfig().appBaseUrl).authorizationServer, { headers: { "access-control-allow-origin": "*" } });
}
