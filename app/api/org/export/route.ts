import { eq } from "drizzle-orm";
import { tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { canAdminTenant } from "@/lib/tenancy/access";
import { tenantWorkspaces } from "@/lib/tenancy/engine";
import { exportWorkspaces } from "@/lib/tenancy/export";

// Guarded: an organization administrator downloads all of their organization's data (only workspaces they belong to).
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const tenantId = new URL(request.url).searchParams.get("tenant") ?? "";
  if (!canAdminTenant(user.scope, tenantId)) return Response.json({ error: "Administrators only" }, { status: 403 });
  const [t] = await appDb().select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return Response.json({ error: "Not found" }, { status: 404 });
  const member = new Set(user.scope.memberOf ?? user.scope.mandateIds);
  const ws = (await tenantWorkspaces(appDb(), tenantId)).map(w => w.id).filter(w => member.has(w));
  const at = new Date().toISOString();
  const zip = await exportWorkspaces(appDb(), ws, user.scope.ownerOfAll ?? user.scope.ownerOf, { tenant: t.legalName, actor: user.email, at });
  await audit(appDb(), { actor: user.email, action: "tenant_export", entity: "tenants", entityId: tenantId, after: { workspaces: ws, bytes: zip.length } });
  const slug = t.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="regenera-os-${slug}-${at.slice(0, 10)}.zip"`, "cache-control": "no-store" } });
}
