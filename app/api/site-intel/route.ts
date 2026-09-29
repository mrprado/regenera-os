import { and, eq } from "drizzle-orm";
import { projects } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { startRun } from "@/lib/site-intel/engine";

// Guarded: POST { projectId } starts a site-intelligence run and returns its id. Stages then run one per step call.
export async function POST(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { projectId?: string };
  const [p] = await appDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, String(body.projectId ?? "")), mandateCondition(user.scope, projects.mandateId)));
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const r = await startRun(appDb(), p.id, user.email);
    return Response.json({ id: r.id, stages: r.stages, status: r.status });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
