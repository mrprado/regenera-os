import { env } from "cloudflare:workers";
import { bearerMatches } from "@/lib/crypto";
import { appDb } from "@/lib/db/scoped";
import { tick } from "@/lib/jobs/tick";

// Anonymous route (SPEC section 23): called by the external scheduler with a bearer token.
export async function POST(request: Request) {
  if (!bearerMatches(request, env.JOBS_TICK_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await tick(appDb());
    return Response.json(result);
  } catch (error) {
    console.error("Job tick failed", error);
    return Response.json({ error: "Tick failed" }, { status: 500 });
  }
}
