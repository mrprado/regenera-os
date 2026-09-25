// Project brief PDF (signed-in users; scoped). ?id=<projectId>
import { and, eq } from "drizzle-orm";
import { projects } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { safeFileName } from "@/lib/contracts/export";
import { contractPdf } from "@/lib/contracts/pdf";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { projectBriefMarkdown } from "@/lib/projects/brief";

export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const [p] = await appDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), mandateCondition(user.scope, projects.mandateId)));
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const brief = await projectBriefMarkdown(appDb(), id, today);
  if (!brief) return Response.json({ error: "Not found" }, { status: 404 });
  const pdf = await contractPdf(brief.md, { kicker: "Project brief · confidential", shortTitle: brief.title, status: "Project brief", date: today });
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${safeFileName(`${brief.title} brief`)}.pdf"`, "cache-control": "private, no-store" },
  });
}
