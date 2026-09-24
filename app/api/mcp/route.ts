import { outreachConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { handleMcp } from "@/lib/mcp/server";

// Anonymous route (SPEC section 23): the Regenera OS MCP server. handleMcp verifies the bearer token
// (verifyMcpToken: OAuth access token or personal token) before anything runs.
const run = (request: Request) => handleMcp(appDb(), request, outreachConfig().appBaseUrl);
export const GET = run;
export const POST = run;
export const DELETE = run;
