import { and, eq } from "drizzle-orm";
import { finModels, projects } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { audit } from "@/lib/audit";
import { modelWorkbook } from "@/lib/finance/xlsx";

// Guarded: financial model workbook (values with provenance). Downloads are audited.
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("model") ?? "";
  const [m] = await appDb().select({ m: finModels, project: projects.name }).from(finModels).innerJoin(projects, eq(projects.id, finModels.projectId))
    .where(and(eq(finModels.id, id), mandateCondition(user.scope, finModels.mandateId)));
  if (!m) return Response.json({ error: "Not found" }, { status: 404 });
  const title = `${m.project} — V${m.m.version} ${m.m.name}`;
  const bytes = modelWorkbook(title, { version: m.m.version, caseType: m.m.caseType, status: m.m.status, preparedBy: m.m.preparedBy, approvedBy: m.m.approvedBy }, m.m.definition);
  await audit(appDb(), { actor: user.email, action: "fin_model_export", entity: "fin_models", entityId: id });
  const name = title.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);
  return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" } });
}
