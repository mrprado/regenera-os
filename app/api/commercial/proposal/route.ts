import { and, eq, inArray } from "drizzle-orm";
import { engagements, organizations, projects, services } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { audit } from "@/lib/audit";
import { proposalMarkdown } from "@/lib/commercial/engine";
import { contractPdf } from "@/lib/contracts/pdf";

// Guarded: proposal PDF generated from the engagement record (fees, schedule, deliverables, specialists). Audited.
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("engagement") ?? "";
  const [e] = await appDb().select().from(engagements).where(and(eq(engagements.id, id), mandateCondition(user.scope, engagements.mandateId)));
  if (!e) return Response.json({ error: "Not found" }, { status: 404 });
  const [org] = e.orgId ? await appDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, e.orgId)) : [];
  const [project] = e.projectId ? await appDb().select({ name: projects.name }).from(projects).where(eq(projects.id, e.projectId)) : [];
  const svc = e.workstreams.length ? await appDb().select().from(services).where(and(eq(services.mandateId, e.mandateId), inArray(services.key, e.workstreams))) : [];
  const md = proposalMarkdown(e, org?.name ?? "[CLIENT TO CONFIRM]", project?.name ?? null, svc);
  const pdf = await contractPdf(md, { kicker: "PROPOSAL", shortTitle: e.name.slice(0, 60), status: e.status, date: new Date().toISOString().slice(0, 10), code: `ENG-${e.id.slice(0, 8)}` });
  await audit(appDb(), { actor: user.email, action: "proposal_pdf", entity: "engagements", entityId: e.id });
  return new Response(pdf as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="Proposal-${e.name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60)}.pdf"`, "cache-control": "no-store" } });
}
