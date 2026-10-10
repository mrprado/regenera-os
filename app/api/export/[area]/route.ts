import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { EXPORT_AREAS, exportArea, type ExportArea } from "@/lib/lifecycle/export";

// Owner export (phase 29E): one area of the workspaces this person owns, as a JSON download. Audited.
export async function GET(_request: Request, { params }: { params: Promise<{ area: string }> }) {
  // A signed-in owner only: the read-only visitor session (no password) never downloads data.
  const user = await getOsApiUser({ write: true });
  if (!user || user.visitor || !isOwner(user.scope) || user.scope.kind !== "user") return Response.json({ error: "Owner only" }, { status: 403 });
  const { area } = await params;
  if (!(area in EXPORT_AREAS)) return Response.json({ error: "Unknown export" }, { status: 404 });
  const data = await exportArea(appDb(), user.scope.ownerOf, area as ExportArea);
  await audit(appDb(), { actor: user.email, action: "owner_export", entity: area, after: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), area, workspaces: user.scope.ownerOf, tables: data }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="regenera-os-${area}-${day}.json"`, "cache-control": "no-store" },
  });
}
