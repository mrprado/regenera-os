import { and, eq } from "drizzle-orm";
import { siteIntelRuns } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { runNextStage } from "@/lib/site-intel/engine";

async function scoped(id: string) {
  const user = await getOsApiUser();
  if (!user) return { error: Response.json({ error: "Not authorized" }, { status: 401 }) };
  const [r] = await appDb().select().from(siteIntelRuns).where(and(eq(siteIntelRuns.id, id), mandateCondition(user.scope, siteIntelRuns.mandateId)));
  if (!r) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  return { run: r };
}

// Guarded: GET returns the run's current stage states; POST executes the next queued stage and returns the new state.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await scoped((await params).id);
  if (s.error) return s.error;
  return Response.json({ id: s.run.id, status: s.run.status, stages: s.run.stages }, { headers: { "cache-control": "no-store" } });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await scoped((await params).id);
  if (s.error) return s.error;
  if (s.run.stages.some(x => x.status === "running")) return Response.json({ id: s.run.id, status: s.run.status, stages: s.run.stages, busy: true });
  const r = await runNextStage(appDb(), s.run.id);
  return Response.json({ id: r.id, status: r.status, stages: r.stages }, { headers: { "cache-control": "no-store" } });
}
