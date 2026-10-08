import { and, eq, inArray } from "drizzle-orm";
import { deals, organizations, projectParties, triggers } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { entityImage, normalizeSite } from "@/lib/map/entity-image";

// Guarded: the picture for an Atlas record. The URL always comes from the record (organization website, signal source,
// project sponsor / operator / developer website, deal organization), never from the request.
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind"), id = q.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const db = appDb();
  let site: string | null = null, via = "";
  if (kind === "org") {
    const [o] = await db.select({ website: organizations.website, domain: organizations.domain }).from(organizations).where(and(eq(organizations.id, id), mandateCondition(user.scope, organizations.mandateId)));
    site = normalizeSite(o?.website ?? o?.domain); via = "organization website";
  } else if (kind === "deal") {
    const [d] = await db.select({ website: organizations.website, domain: organizations.domain }).from(deals).innerJoin(organizations, eq(organizations.id, deals.orgId)).where(and(eq(deals.id, id), mandateCondition(user.scope, deals.mandateId)));
    site = normalizeSite(d?.website ?? d?.domain); via = "counterpart organization website";
  } else if (kind === "project") {
    const ps = await db.select({ role: projectParties.role, website: organizations.website, domain: organizations.domain }).from(projectParties).innerJoin(organizations, eq(organizations.id, projectParties.orgId))
      .where(and(eq(projectParties.projectId, id), inArray(projectParties.role, ["sponsor", "operator", "developer"]), mandateCondition(user.scope, projectParties.mandateId)));
    const p = ps.find(x => x.website || x.domain);
    site = normalizeSite(p?.website ?? p?.domain); via = p ? `${p.role} website` : "";
  } else if (kind === "trigger") {
    const [t] = await db.select({ url: triggers.sourceUrl }).from(triggers).where(and(eq(triggers.id, id), mandateCondition(user.scope, triggers.mandateId)));
    site = normalizeSite(t?.url); via = "source article";
  } else return Response.json({ error: "Unknown kind" }, { status: 400 });
  if (!site) return Response.json({ none: true, reason: "No website recorded for this record" }, { headers: { "cache-control": "private, max-age=300" } });
  try {
    return Response.json({ ...(await entityImage(db, site)), via }, { headers: { "cache-control": "private, max-age=3600" } });
  } catch (e) { return Response.json({ none: true, reason: (e as Error).message.slice(0, 120) }, { status: 200 }); }
}
