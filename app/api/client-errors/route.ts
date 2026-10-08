import { z } from "zod";
import { clientErrors } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";

// Browser error reports from signed-in sessions (phase 20 §10): stored for Settings → Jobs and written to Workers logs,
// so production-only failures (Atlas, WebGL, tile sources) are visible. Signed-in users only; small payloads.
const zReport = z.object({ path: z.string().max(300), kind: z.enum(["error", "unhandledrejection", "map"]).default("error"), message: z.string().max(1000), stack: z.string().max(4000).default("") });

export async function POST(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const parsed = zReport.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid report" }, { status: 400 });
  const r = parsed.data;
  console.error(`[client-error] ${r.kind} ${r.path}: ${r.message}`);
  await appDb().insert(clientErrors).values({ email: user.email, path: r.path, kind: r.kind, message: r.message, stack: r.stack, userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300) });
  return Response.json({ ok: true });
}
