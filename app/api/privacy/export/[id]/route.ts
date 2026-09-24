import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { exportPerson } from "@/lib/privacy";

// Access request (GDPR art. 15 and equivalents): owners download everything held about one person as JSON.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOsApiUser();
  if (!user || !isOwner(user.scope)) return Response.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  const data = await exportPerson(appDb(), user.scope.ownerOf, id, user.email);
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  await audit(appDb(), { actor: user.email, action: "privacy_export", entity: "contacts", entityId: id });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="regenera-os-person-${id.slice(0, 8)}.json"`, "cache-control": "no-store" },
  });
}
