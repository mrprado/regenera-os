// Contract register and obligation register as CSV (signed-in users; mandate-scoped). ?type=contracts|obligations
import { and, asc, eq } from "drizzle-orm";
import { contractObligations, contracts, projects } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { LIFECYCLE, typeLabel } from "@/lib/contracts/catalog";
import { kindLabel } from "@/lib/contracts/labels";
import { toCsv } from "@/lib/contracts/register";
import { appDb, mandateCondition } from "@/lib/db/scoped";

export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const type = new URL(request.url).searchParams.get("type") === "obligations" ? "obligations" : "contracts";
  const db = appDb();
  let csv: string;
  if (type === "contracts") {
    const rows = await db.select({ c: contracts, project: projects.name }).from(contracts).leftJoin(projects, eq(projects.id, contracts.projectId))
      .where(mandateCondition(user.scope, contracts.mandateId)).orderBy(asc(contracts.title));
    csv = toCsv(["Title", "Type", "Category", "Lifecycle", "Project", "Governing law", "Forum", "Executed", "Effective", "Expires", "Value", "Currency", "Locked", "Review required"],
      rows.map(({ c, project }) => [c.title, c.kind === "registered" ? typeLabel(c.category, c.contractType) : kindLabel(c), c.category ?? "regenera_commercial", LIFECYCLE[c.lifecycle], project ?? "", c.governingLaw ?? c.terms.governingLaw, c.forum ?? "", c.executionDate ?? c.signedAt ?? "", c.effectiveDate ?? "", c.endDate ?? "", c.value ?? "", c.terms.currency, c.lockedAt ? "yes" : "no", c.reviewRequired ? "yes" : "no"]));
  } else {
    const rows = await db.select({ o: contractObligations, title: contracts.title }).from(contractObligations).innerJoin(contracts, eq(contracts.id, contractObligations.contractId))
      .where(and(mandateCondition(user.scope, contractObligations.mandateId))).orderBy(asc(contractObligations.dueDate));
    csv = toCsv(["Due", "Obligation", "Category", "Responsible party", "Owner", "Recurrence", "Evidence required", "Source clause", "Risk if missed", "Status", "Completed", "Completion evidence", "Contract"],
      rows.map(({ o, title }) => [o.dueDate ?? "", o.obligation, o.category, o.responsibleParty, o.owner ?? "", o.recurrence, o.evidenceRequired, o.sourceClause, o.riskIfMissed, o.status, o.completedAt?.slice(0, 10) ?? "", o.completionEvidence, title]));
  }
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="regenera-${type}-register.csv"`, "cache-control": "private, no-store" } });
}
