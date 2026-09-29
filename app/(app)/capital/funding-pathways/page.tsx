import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { Route } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { fundingPathways, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { PATHWAY_SOURCES, PATHWAY_STATUSES } from "@/lib/capital/structure-vocab";
import { PathwayCard } from "../../projects/pathways-tab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funding pathways" };

const OPEN = ["identified", "screening", "eligible", "preparing", "submitted", "in_diligence"];

export default async function FundingPathwaysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capital/funding-pathways");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";
  const rows = await appDb().select({ p: fundingPathways, projectName: projects.name }).from(fundingPathways).innerJoin(projects, eq(projects.id, fundingPathways.projectId))
    .where(and(mandateCondition(user.scope, fundingPathways.mandateId), view === "open" ? sql`${fundingPathways.status} in ${OPEN}` : undefined, sp.source && sp.source in PATHWAY_SOURCES ? eq(fundingPathways.sourceType, sp.source as never) : undefined))
    .orderBy(sql`${fundingPathways.deadline} is null`, asc(fundingPathways.deadline), asc(projects.name));
  const back = `/capital/funding-pathways${view === "all" ? "?view=all" : ""}`;
  const byStatus = rows.reduce<Record<string, number>>((m, x) => ({ ...m, [x.p.status]: (m[x.p.status] ?? 0) + 1 }), {});
  return (
    <>
      <PageHeader title="Funding pathways" count={rows.length} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>A pathway is a route from a project to one source of capital. Eligibility is recorded separately from fit and is only &quot;confirmed&quot; with its source. Add pathways from a project&apos;s Funding pathways tab.</p>
      <nav className={ui.tabs} aria-label="Pathway views">
        <Link className={`${ui.tab} ${view === "open" ? ui.tabActive : ""}`} href="/capital/funding-pathways">Open</Link>
        <Link className={`${ui.tab} ${view === "all" ? ui.tabActive : ""}`} href="/capital/funding-pathways?view=all">All</Link>
        <Link className={ui.tab} href="/capital">Capital partners</Link>
        <Link className={ui.tab} href="/capital/structures">Capital structures</Link>
      </nav>
      {rows.length > 0 && <p className={ui.sub}>{Object.entries(byStatus).map(([k, n]) => `${PATHWAY_STATUSES[k as keyof typeof PATHWAY_STATUSES]} ${n}`).join(" · ")}</p>}
      {rows.length === 0 ? <EmptyState icon={Route} title="No funding pathways" body="Open a project and use its Funding pathways tab to add routes to grants, DFIs, ECAs, green bonds and other sources." /> : (
        <div className={r.grid} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
          {rows.map(x => <PathwayCard key={x.p.id} p={x.p} back={back} projectName={x.projectName} />)}
        </div>
      )}
    </>
  );
}
