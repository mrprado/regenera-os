import { and, asc, isNull } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { interventions, projects, systemAssessments } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { CAPACITY_LABELS, INTERVENTION_STATUSES, INTERVENTION_TYPES, SYSTEM_CATEGORIES } from "@/lib/systems/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Systems" };

/** Portfolio view of system capacity and interventions (§20–21): where places are constrained, what would fix it, what it costs, who could fund it. */
export default async function SystemsPage() {
  const user = await requireOsUser("/systems");
  const db = appDb();
  const [ps, as, ints] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
    db.select().from(systemAssessments).where(mandateCondition(user.scope, systemAssessments.mandateId)),
    db.select().from(interventions).where(mandateCondition(user.scope, interventions.mandateId)),
  ]);
  const cats = Object.keys(SYSTEM_CATEGORIES) as (keyof typeof SYSTEM_CATEGORIES)[];
  const name = (id: string) => ps.find(p => p.id === id)?.name ?? "Project";
  return (
    <>
      <PageHeader title="Systems" />
      <p className={ui.sub} style={{ marginTop: -4 }}>Capacity → risk → intervention → capital across the portfolio. A category is only shown as constrained when someone assessed it; blank means not assessed.</p>
      <section className={r.panel}>
        <p className={r.panelTitle}>Capacity by project</p>
        {ps.length === 0 ? <p className={r.empty}>No projects.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className={ui.table}>
              <thead><tr><th>Project</th>{cats.map(c => <th key={c} style={{ fontSize: 11 }}>{SYSTEM_CATEGORIES[c]}</th>)}</tr></thead>
              <tbody>{ps.map(p => <tr key={p.id}><td><Link href={`/projects/${p.id}?tab=systems`}>{p.name}</Link></td>{cats.map(c => {
                const a = as.find(x => x.projectId === p.id && x.category === c);
                return <td key={c} style={{ fontSize: 12, color: a?.capacity === "constrained" || a?.capacity === "exceeded" ? "#b0432f" : a ? undefined : "var(--text-muted)" }}>{a ? `${CAPACITY_LABELS[a.capacity]}${a.status === "reviewed" ? " ✓" : ""}` : "—"}</td>;
              })}</tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Interventions</p>
        {ints.length === 0 ? <p className={r.empty}>No interventions yet. Add them from a project&apos;s Systems tab.</p> : (
          <table className={ui.table}><tbody>{ints.map(i => (
            <tr key={i.id}><td><b>{i.systemIssue}</b> · <Link href={`/projects/${i.projectId}?tab=systems`}>{name(i.projectId)}</Link><span className={ui.sub} style={{ display: "block" }}>{[INTERVENTION_TYPES[i.implementationType], i.fundingPathway && `funding: ${i.fundingPathway}`, i.capitalRequirementId && "linked to a capital requirement"].filter(Boolean).join(" · ")}</span></td>
              <td className={ui.num}>{compactMoney(i.costEstimate, i.currency)}</td><td>{INTERVENTION_STATUSES[i.status]}</td></tr>
          ))}</tbody></table>
        )}
      </section>
    </>
  );
}
