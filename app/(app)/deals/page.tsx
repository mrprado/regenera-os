import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { SquareKanban } from "lucide-react";
import { Notice, withParams } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { deals, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { DEAL_STAGES, ENGAGEMENT_PATHS } from "@/lib/vocab";
import { importTrackerAction, moveDeal, setForecastAction } from "./actions";
import Kanban, { type KanbanDeal } from "./kanban";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deals" };

const BOARD = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion"] as const;
const CLOSED = ["completed", "churned", "lost", "nurture"] as const;

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/deals");
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "board";
  const rows = await appDb().select({
    id: deals.id, name: deals.name, stage: deals.stage, orgId: deals.orgId, orgName: organizations.name, engagement: deals.engagement, path: deals.path,
    value: deals.valueEstimate, monthly: deals.monthlyValue, probability: deals.probability, expectedClose: deals.expectedClose, nextAction: deals.nextAction, nextActionDate: deals.nextActionDate, source: deals.source, updatedAt: deals.updatedAt, feeType: deals.feeType,
  }).from(deals).leftJoin(organizations, eq(organizations.id, deals.orgId))
    .where(and(mandateCondition(user.scope, deals.mandateId), isNull(deals.archivedAt), sp.path ? eq(deals.path, sp.path as never) : undefined))
    .orderBy(asc(deals.nextActionDate), asc(deals.name));
  const today = new Date().toISOString().slice(0, 10);
  const kanban: KanbanDeal[] = rows.map(r => ({ ...r, overdue: !!r.nextActionDate && r.nextActionDate < today }));
  const open = rows.filter(r => !(CLOSED as readonly string[]).includes(r.stage));
  const back = withParams("/deals", sp, { notice: undefined });

  return (
    <>
      <PageHeader title="Deals" count={open.length} actions={
        <>
          {isOwner(user.scope) && <form action={importTrackerAction}><button className="btn" type="submit">Import regenera.bio tracker</button></form>}
        </>
      } />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Deal views">
        <Link className={`${ui.tab} ${view === "board" ? ui.tabActive : ""}`} href={withParams("/deals", sp, { view: undefined, notice: undefined })}>Board</Link>
        <Link className={`${ui.tab} ${view === "table" ? ui.tabActive : ""}`} href={withParams("/deals", sp, { view: "table", notice: undefined })}>Table</Link>
        {ENGAGEMENT_PATHS.filter(p => p !== "partner_network").map(p => (
          <Link key={p} className={`${ui.tab} ${sp.path === p ? ui.tabActive : ""}`} href={withParams("/deals", sp, { path: sp.path === p ? undefined : p, notice: undefined })}>{p === "capital_mandate" ? "Capital mandates" : "Project diagnostics"}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={SquareKanban} title="No deals yet" body="Deals arrive from regenera.bio inquiries and Partner Network referrals, from the tracker import, and from pursued triggers." />
      ) : view === "board" ? (
        <Kanban columns={[...BOARD].map(k => ({ key: k, label: DEAL_STAGES[k] }))} deals={kanban.filter(d => (BOARD as readonly string[]).includes(d.stage))} action={moveDeal} back={back} />
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Deal</th><th>Organization</th><th>Stage</th><th>Engagement</th><th>Fee</th><th>Next action</th><th>Forecast (value, monthly, %, close)</th></tr></thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id}>
                  <td className={ui.primary}>{d.name}</td>
                  <td>{d.orgId ? <Link href={`/companies/${d.orgId}`}>{d.orgName}</Link> : "—"}</td>
                  <td><span className={ui.chip}>{DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES]}</span></td>
                  <td>{d.engagement.replace(/_/g, " ")}</td>
                  <td>{d.feeType.replace(/_/g, " ")}</td>
                  <td>{d.nextAction ? <>{d.nextAction}<span className={ui.sub}>{d.nextActionDate}</span></> : <span className={ui.chipMuted}>None</span>}</td>
                  <td>
                    <form action={setForecastAction} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={withParams("/deals", sp, { view: "table", notice: undefined })} />
                      <input name="value" defaultValue={d.value ?? ""} placeholder="Value" aria-label="Deal value" inputMode="decimal" style={{ width: 80, height: 26, border: "1px solid var(--line)", borderRadius: 6, padding: "0 6px", fontSize: 12 }} />
                      <input name="monthly" defaultValue={d.monthly ?? ""} placeholder="Monthly" aria-label="Monthly retainer" inputMode="decimal" style={{ width: 70, height: 26, border: "1px solid var(--line)", borderRadius: 6, padding: "0 6px", fontSize: 12 }} />
                      <input name="probability" defaultValue={d.probability ?? ""} placeholder="%" aria-label="Probability override" inputMode="numeric" style={{ width: 44, height: 26, border: "1px solid var(--line)", borderRadius: 6, padding: "0 6px", fontSize: 12 }} />
                      <input name="expectedClose" type="date" defaultValue={d.expectedClose ?? ""} aria-label="Expected close" style={{ height: 26, border: "1px solid var(--line)", borderRadius: 6, padding: "0 4px", fontSize: 12 }} />
                      <button className={ui.miniBtn} type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
