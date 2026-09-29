import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { Layers } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { capitalStackLayers, capitalStructures, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { summarizeStack } from "@/lib/capital/stack";
import { REVIEW_STATUSES, STRUCTURE_STATUSES } from "@/lib/capital/structure-vocab";
import { compactMoney } from "@/lib/projects/labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital structures" };

export default async function StructuresPage() {
  const user = await requireOsUser("/capital/structures");
  const db = appDb();
  const rows = await db.select({ s: capitalStructures, projectName: projects.name }).from(capitalStructures).innerJoin(projects, eq(projects.id, capitalStructures.projectId))
    .where(mandateCondition(user.scope, capitalStructures.mandateId)).orderBy(asc(projects.name), asc(capitalStructures.createdAt));
  const layers = rows.length ? await db.select().from(capitalStackLayers).where(inArray(capitalStackLayers.structureId, rows.map(r => r.s.id))) : [];
  return (
    <>
      <PageHeader title="Capital structures" count={rows.length} />
      <p className={ui.notice}>Stack scenarios across projects. Coverage and mix are screening figures; unsourced layers are counted so assumptions stay visible. No structure is labelled compliant or bankable.</p>
      <nav className={ui.tabs} aria-label="Capital sections">
        <Link className={ui.tab} href="/capital">Capital partners</Link>
        <Link className={`${ui.tab} ${ui.tabActive}`} href="/capital/structures">Capital structures</Link>
        <Link className={ui.tab} href="/capital/funding-pathways">Funding pathways</Link>
      </nav>
      {rows.length === 0 ? <EmptyState icon={Layers} title="No capital structures" body="Open a project and use its Capital stack tab to build the first scenario from its capital requirements." /> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Project</th><th>Scenario</th><th>Status</th><th>Total cost</th><th>Funded</th><th>Coverage</th><th>Debt / equity</th><th>Weighted rate</th><th>Committed</th><th>Unsourced</th><th>Review</th></tr></thead>
            <tbody>{rows.map(({ s, projectName }) => {
              const ls = layers.filter(l => l.structureId === s.id);
              const sum = summarizeStack({ currency: s.currency, totalCost: s.totalCost, layers: ls });
              return (
                <tr key={s.id}>
                  <td className={ui.primary}><Link href={`/projects/${s.projectId}`}>{projectName}</Link></td>
                  <td><Link href={`/projects/${s.projectId}?tab=stack&structure=${s.id}`}>{s.name}</Link></td>
                  <td>{STRUCTURE_STATUSES[s.status]}</td>
                  <td className={ui.num}>{compactMoney(s.totalCost, s.currency)}</td>
                  <td className={ui.num}>{compactMoney(sum.funded, s.currency)}</td>
                  <td className={ui.num}>{sum.coveragePct != null ? `${sum.coveragePct}%` : "—"}</td>
                  <td className={ui.num}>{sum.debtPct != null ? `${sum.debtPct}% / ${sum.equityPct}%` : "—"}</td>
                  <td className={ui.num}>{sum.weightedRatePct != null ? `${sum.weightedRatePct}%` : "—"}</td>
                  <td className={ui.num}>{sum.committedPct != null ? `${sum.committedPct}%` : "—"}</td>
                  <td className={ui.num}>{ls.filter(l => l.assumptionStatus === "assumption").length}/{ls.length}</td>
                  <td>{REVIEW_STATUSES[s.reviewStatus]}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
