import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contractObligations, contracts, projects } from "@/db/schema";
import { withBase } from "@/lib/base-path";
import { OBLIGATION_CATEGORIES, OBLIGATION_STATUSES, RECURRENCE } from "@/lib/contracts/catalog";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";

/** Every obligation across contracts: who owes what, by when, and what happens if it is missed. */
export default async function ObligationsView({ scope, sp }: { scope: Scope; sp: Record<string, string | undefined> }) {
  const status = sp.status === "all" ? undefined : ["open", "in_progress"] as ("open" | "in_progress")[];
  const rows = await appDb().select({ o: contractObligations, title: contracts.title, project: projects.name }).from(contractObligations)
    .innerJoin(contracts, eq(contracts.id, contractObligations.contractId)).leftJoin(projects, eq(projects.id, contractObligations.projectId))
    .where(and(mandateCondition(scope, contractObligations.mandateId), status ? inArray(contractObligations.status, status) : undefined))
    .orderBy(asc(contractObligations.dueDate)).limit(500);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <p className={ui.sub} style={{ marginTop: 0 }}>
        {sp.status === "all" ? <Link href="/contracts?tab=obligations">Open only</Link> : <Link href="/contracts?tab=obligations&status=all">Include completed</Link>}
        {" · "}<a href={withBase("/api/contracts/register?type=obligations")}>Obligation register (CSV)</a>
      </p>
      {rows.length === 0 ? <p className={r.empty}>No obligations recorded. Add them on each contract, with the clause each comes from.</p> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Due</th><th>Obligation</th><th>Responsible</th><th>Contract</th><th>Evidence required</th><th>Status</th></tr></thead>
            <tbody>{rows.map(({ o, title, project }) => (
              <tr key={o.id}>
                <td style={{ color: o.dueDate && o.dueDate < today && (o.status === "open" || o.status === "in_progress") ? "#b0432f" : undefined, whiteSpace: "nowrap" }}>{o.dueDate ?? "No date"}<span className={ui.sub}>{RECURRENCE[o.recurrence]}</span></td>
                <td>{o.obligation}<span className={ui.sub}>{OBLIGATION_CATEGORIES[o.category]}{o.sourceClause ? ` · ${o.sourceClause}` : ""}{o.riskIfMissed ? ` · if missed: ${o.riskIfMissed}` : ""}</span></td>
                <td>{o.responsibleParty}<span className={ui.sub}>{o.owner ?? ""}</span></td>
                <td><Link href={`/contracts/${o.contractId}`}>{title}</Link><span className={ui.sub}>{project ?? ""}</span></td>
                <td>{o.evidenceRequired || "—"}</td>
                <td>{OBLIGATION_STATUSES[o.status]}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
