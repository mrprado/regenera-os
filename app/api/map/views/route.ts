import { and, desc, eq } from "drizzle-orm";
import { atlasViews } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";

// Guarded: named ATLAS views. GET lists, POST { name, view } saves, DELETE ?id= removes (creator only).
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const rows = await appDb().select({ id: atlasViews.id, name: atlasViews.name, view: atlasViews.view, createdBy: atlasViews.createdBy }).from(atlasViews).where(mandateCondition(user.scope, atlasViews.mandateId)).orderBy(desc(atlasViews.createdAt)).limit(100);
  return Response.json({ views: rows }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { name?: string; view?: string };
  const name = String(b.name ?? "").trim().slice(0, 80), view = String(b.view ?? "").replace(/^#/, "").slice(0, 2000);
  if (!name || !/^c=/.test(view)) return Response.json({ error: "Name and a map view are required" }, { status: 400 });
  const [row] = await appDb().insert(atlasViews).values({ mandateId: user.scope.mandateIds[0], name, view, createdBy: user.email }).returning();
  await audit(appDb(), { actor: user.email, action: "atlas.view_save", entity: "atlas_view", entityId: row.id, after: { name } });
  return Response.json({ id: row.id, name, view });
}

export async function DELETE(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  await appDb().delete(atlasViews).where(and(eq(atlasViews.id, id), eq(atlasViews.createdBy, user.email), mandateCondition(user.scope, atlasViews.mandateId)));
  return Response.json({ ok: true });
}
