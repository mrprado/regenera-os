import Link from "next/link";
import { and, inArray, isNotNull, or } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalProfiles, mandates } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { ROUTING } from "@/lib/capital/providers";
import { PROGRAMMES } from "@/lib/capital/programmes";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { importProgrammesAction, setRoutingAction } from "../../casework-actions";
import { startProjectScanAction } from "../../project-scan-actions";
import { projects } from "@/db/schema";
import { PARTNER_TYPES } from "@/lib/scan/project-scan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital providers" };

const Opts = ({ o }: { o: Record<string, string> }) => <>{Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>;

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capital");
  const sp = await searchParams;
  const db = appDb();
  const ids = user.scope.mandateIds;
  const [rows, ws, projs] = await Promise.all([
    db.select().from(capitalProfiles).where(and(mandateCondition(user.scope, capitalProfiles.mandateId), or(isNotNull(capitalProfiles.programmeKey), isNotNull(capitalProfiles.lane)))).orderBy(capitalProfiles.name).limit(400),
    ids.length ? db.select({ id: mandates.id, name: mandates.name }).from(mandates).where(inArray(mandates.id, ids)) : Promise.resolve([]),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(mandateCondition(user.scope, projects.mandateId)).orderBy(projects.name).limit(500),
  ]);
  const stageOrder = Object.keys(ROUTING.routingStage);
  const lane = sp.lane && sp.lane in ROUTING.lane ? sp.lane : null;
  const shown = rows.filter(x => !lane || x.lane === lane).sort((a, b) => stageOrder.indexOf(b.routingStage ?? "new") - stageOrder.indexOf(a.routingStage ?? "new") || a.name.localeCompare(b.name));
  return <>
    <PageHeader title="Capital providers" count={rows.length} />
    <Notice text={sp.notice} />
    <p className={ui.notice}>Institutional capital routed by lane. Tag every provider with lane, operating or development preference, ticket band and routing stage (new → engaged → fit-check booked → qualified → terms / diligence → closed). No untagged leads; progress is measured by terms and diligence requests, not interest. Outreach stays in the approval queue.</p>
    <nav className={ui.tabs}><Link className={`${ui.tab} ${!lane ? ui.tabActive : ""}`} href="/capital/providers">All</Link>{Object.entries(ROUTING.lane).map(([k, v]) => <Link key={k} className={`${ui.tab} ${lane === k ? ui.tabActive : ""}`} href={`/capital/providers?lane=${k}`}>{v}</Link>)}</nav>
    <div className={r.grid}>
      <section className={r.panel}>
        {shown.length === 0 ? <p className={r.empty}>No tagged providers yet. Import the public programme catalogue ({PROGRAMMES.length} institutions) on the right.</p> :
          <table className={ui.table}><thead><tr><th>Provider</th><th>Routing</th></tr></thead><tbody>
            {shown.map(x => <tr key={x.id} id={`p-${x.id}`}><td><b>{x.name}</b><div className={ui.sub}>{x.notes.slice(0, 220)}</div>{x.orgId && <Link className={ui.sub} href={`/companies/${x.orgId}`}>Organization</Link>}</td>
              <td><form action={setRoutingAction} style={{ display: "grid", gap: 4, minWidth: 220 }}><input type="hidden" name="id" value={x.id} />
                <select name="lane" defaultValue={x.lane ?? ""} aria-label="Lane"><option value="">Lane…</option><Opts o={ROUTING.lane} /></select>
                <select name="preference" defaultValue={x.preference ?? "unknown"} aria-label="Preference"><Opts o={ROUTING.preference} /></select>
                <select name="ticketBand" defaultValue={x.ticketBand ?? "unknown"} aria-label="Ticket band"><Opts o={ROUTING.ticketBand} /></select>
                <select name="routingStage" defaultValue={x.routingStage ?? "new"} aria-label="Routing stage"><Opts o={ROUTING.routingStage} /></select>
                <button className={ui.miniBtn} type="submit">Save</button></form></td></tr>)}
          </tbody></table>}
      </section>
      <aside><section className={r.panel}><p className={r.panelTitle}>Scan for partners for a project</p>
        <p className={ui.sub}>Builds a scan from the project (country or region, technology, size, stage). You review scope and cost before it runs; nobody is contacted.</p>
        <form action={startProjectScanAction} className={r.form}>
          <label>Project<select name="projectId" required>{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Looking for<select name="type">{Object.entries(PARTNER_TYPES).map(([k, t]) => <option key={k} value={k}>{t.group === "capital" ? "Capital: " : "Delivery: "}{t.label}</option>)}</select></label>
          <button className="btn" type="submit">Prepare scan</button></form>
        <p className={ui.sub}>General capital scans (not tied to a project): <Link href="/scans?preset=dfis">DFIs</Link> · <Link href="/scans?preset=lenders">lenders</Link> · <Link href="/scans?preset=infra_pe">infrastructure PE</Link> · <Link href="/scans?preset=real_asset_funds">real-asset funds</Link>.</p>
      </section>
      <section className={r.panel}><p className={r.panelTitle}>Import public programmes</p>
        <p className={ui.sub}>Adds the {PROGRAMMES.length} catalogued institutions (DFIs, MDBs, funds, guarantors, IPP acquirers) as organizations and capital profiles. Re-importing refreshes them; nothing is contacted.</p>
        <form action={importProgrammesAction} className={r.form}><label>Workspace<select name="mandateId">{ws.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><button className="btn" type="submit">Import</button></form>
      </section></aside>
    </div>
  </>;
}
