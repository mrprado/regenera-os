import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { SquareKanban } from "lucide-react";
import { Notice, withParams } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { deals, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { DEAL_STAGES, ENGAGEMENT_PATHS, ENGAGEMENTS } from "@/lib/vocab";
import { createOpportunityAction } from "../flow-actions";
import { ATTRIBUTION_CHANNELS } from "@/db/schema";
import { importTrackerAction, moveDeal, setForecastAction } from "./actions";
import Kanban, { type KanbanDeal } from "./kanban";
import { createContractAction } from "../contract-actions";
import { createProjectFromDealAction } from "../project-actions";
import { CONTRACT_STATUS_LABEL } from "@/lib/contracts/labels";
import { contractsByDeal } from "@/lib/contracts/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunities" };

const BOARD = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion"] as const;
const CLOSED = ["completed", "churned", "lost", "nurture"] as const;

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/deals");
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "board";
  const rows = await appDb().select({
    id: deals.id, name: deals.name, stage: deals.stage, orgId: deals.orgId, orgName: organizations.name, engagement: deals.engagement, path: deals.path,
    value: deals.valueEstimate, monthly: deals.monthlyValue, probability: deals.probability, expectedClose: deals.expectedClose, nextAction: deals.nextAction, nextActionDate: deals.nextActionDate, source: deals.source, updatedAt: deals.updatedAt, feeType: deals.feeType, projectId: deals.projectId,
  }).from(deals).leftJoin(organizations, eq(organizations.id, deals.orgId))
    .where(and(mandateCondition(user.scope, deals.mandateId), isNull(deals.archivedAt), sp.path ? eq(deals.path, sp.path as never) : undefined, sp.stage && sp.stage in DEAL_STAGES ? eq(deals.stage, sp.stage as never) : undefined))
    .orderBy(asc(deals.nextActionDate), asc(deals.name));
  const today = new Date().toISOString().slice(0, 10);
  const kanban: KanbanDeal[] = rows.map(r => ({ ...r, overdue: !!r.nextActionDate && r.nextActionDate < today }));
  const open = rows.filter(r => !(CLOSED as readonly string[]).includes(r.stage));
  const back = withParams("/deals", sp, { notice: undefined });
  const orgOptions = sp.new ? await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt), eq(organizations.testRecord, false))).orderBy(asc(organizations.name)).limit(1000) : [];
  const dealContracts = view === "table" ? await contractsByDeal(user.scope, rows.map(r => r.id)) : new Map<string, { id: string; status: string }>();

  return (
    <>
      <PageHeader title="Opportunities" count={open.length} actions={
        <>
          <Link className="btn btn--primary" href="/deals?new=1">Add opportunity</Link>
          {isOwner(user.scope) && <form action={importTrackerAction}><button className="btn" type="submit">Import regenera.bio tracker</button></form>}
        </>
      } />
      <Notice text={sp.notice} />
      {sp.new && (
        <section className={ui.notice} aria-labelledby="new-opp-h" style={{ background: "transparent" }}>
          <h2 id="new-opp-h" style={{ margin: "0 0 4px", fontSize: 15 }}>New opportunity</h2>
          <p className={ui.sub} style={{ marginTop: 0 }}>A potential paid engagement for Regenera. Record where it came from (original source) and the next action; qualification evidence is recorded on the opportunity as you learn it.</p>
          <form action={createOpportunityAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: 13 }}>
            <label style={{ display: "grid", gap: 3 }}>Name<input name="name" required minLength={3} placeholder="EMC Renewables: origination pilot" /></label>
            <label style={{ display: "grid", gap: 3 }}>Organization<select name="orgId" defaultValue={sp.org ?? ""}><option value="">Not linked yet</option>{orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label style={{ display: "grid", gap: 3 }}>Path<select name="path" defaultValue="project_diagnostic">{ENGAGEMENT_PATHS.map(p => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}</select></label>
            <label style={{ display: "grid", gap: 3 }}>Engagement<select name="engagement" defaultValue="diagnostic">{Object.entries(ENGAGEMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ display: "grid", gap: 3 }}>Estimated Regenera fee (USD)<input name="value" inputMode="decimal" placeholder="Leave blank if unknown" /></label>
            <label style={{ display: "grid", gap: 3 }}>Expected close<input name="expectedClose" type="date" /></label>
            <label style={{ display: "grid", gap: 3 }}>Next action<input name="nextAction" required minLength={3} /></label>
            <label style={{ display: "grid", gap: 3 }}>Next action date<input name="nextActionDate" type="date" required /></label>
            <label style={{ display: "grid", gap: 3 }}>Original source<select name="channel" defaultValue="manual">{Object.entries(ATTRIBUTION_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ display: "grid", gap: 3 }}>Campaign or preset<input name="campaign" placeholder="e.g. Mexico solar EPC firms" /></label>
            <label style={{ display: "grid", gap: 3, gridColumn: "1 / -1" }}>Source note (introducer, event…)<input name="sourceNote" /></label>
            <div style={{ display: "flex", gap: 8 }}><button className="btn btn--primary" type="submit">Create opportunity</button><Link className="btn" href="/deals">Cancel</Link></div>
          </form>
        </section>
      )}
      {sp.stage && sp.stage in DEAL_STAGES && <p className={ui.notice}>Showing {DEAL_STAGES[sp.stage as keyof typeof DEAL_STAGES]} only. <Link href={withParams("/deals", sp, { stage: undefined, notice: undefined })}>Show all stages</Link></p>}
      <nav className={ui.tabs} aria-label="Opportunity views">
        <Link className={`${ui.tab} ${view === "board" ? ui.tabActive : ""}`} href={withParams("/deals", sp, { view: undefined, notice: undefined })}>Board</Link>
        <Link className={`${ui.tab} ${view === "table" ? ui.tabActive : ""}`} href={withParams("/deals", sp, { view: "table", notice: undefined })}>Table</Link>
        {ENGAGEMENT_PATHS.filter(p => p !== "partner_network").map(p => (
          <Link key={p} className={`${ui.tab} ${sp.path === p ? ui.tabActive : ""}`} href={withParams("/deals", sp, { path: sp.path === p ? undefined : p, notice: undefined })}>{p === "capital_mandate" ? "Capital mandates" : "Project diagnostics"}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={SquareKanban} title="No opportunities yet" body="Opportunities arrive from regenera.bio inquiries and Partner Network referrals, from the tracker import, and from pursued triggers." />
      ) : view === "board" ? (
        <Kanban columns={[...BOARD].map(k => ({ key: k, label: DEAL_STAGES[k] }))} deals={kanban.filter(d => (BOARD as readonly string[]).includes(d.stage))} action={moveDeal} back={back} />
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Deal</th><th>Organization</th><th>Stage</th><th>Engagement</th><th>Fee</th><th>Project</th><th>Contract</th><th>Next action</th><th>Forecast (value, monthly, %, close)</th></tr></thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id}>
                  <td className={ui.primary}><Link href={`/deals/${d.id}`}>{d.name}</Link></td>
                  <td>{d.orgId ? <Link href={`/companies/${d.orgId}`}>{d.orgName}</Link> : "—"}</td>
                  <td><span className={ui.chip}>{DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES]}</span></td>
                  <td>{d.engagement.replace(/_/g, " ")}</td>
                  <td>{d.feeType.replace(/_/g, " ")}</td>
                  <td>{d.projectId
                    ? <Link href={`/projects/${d.projectId}`}>Open project</Link>
                    : <form action={createProjectFromDealAction}><input type="hidden" name="dealId" value={d.id} /><button className={ui.miniBtn} type="submit">Create project</button></form>}</td>
                  <td>{dealContracts.get(d.id)
                    ? <Link href={`/contracts/${dealContracts.get(d.id)!.id}`}>{CONTRACT_STATUS_LABEL[dealContracts.get(d.id)!.status as keyof typeof CONTRACT_STATUS_LABEL]}</Link>
                    : <form action={createContractAction}><input type="hidden" name="kind" value="engagement_letter" /><input type="hidden" name="source" value={`deal:${d.id}`} /><button className={ui.miniBtn} type="submit">Draft</button></form>}</td>
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
