import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { docRequests, mandates, organizations, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { openCount, REQUEST_TEMPLATES, requestProgress } from "@/lib/documents/requests";
import { createRequestAction } from "../../casework-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document requests" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/documents/requests");
  const sp = await searchParams;
  const db = appDb();
  const ids = user.scope.mandateIds;
  const [rows, ws, orgs, projs] = await Promise.all([
    db.select().from(docRequests).where(mandateCondition(user.scope, docRequests.mandateId)).orderBy(desc(docRequests.createdAt)).limit(100),
    ids.length ? db.select({ id: mandates.id, name: mandates.name }).from(mandates).where(inArray(mandates.id, ids)) : Promise.resolve([]),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(mandateCondition(user.scope, organizations.mandateId)).orderBy(organizations.name).limit(800),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(mandateCondition(user.scope, projects.mandateId)).orderBy(projects.name).limit(500),
  ]);
  const prog = await requestProgress(db, rows.map(x => x.id));
  const name = (list: { id: string; name: string }[], id: string | null) => (id ? list.find(x => x.id === id)?.name ?? "—" : "—");
  return <>
    <PageHeader title="Document requests" count={rows.filter(x => x.status === "open").length || undefined} />
    <Notice text={sp.notice} />
    <p className={ui.notice}>What was asked of each counterparty, what arrived, and what is held under NDA. Most case studies stall on documents: this is the list to chase.</p>
    <div className={r.grid}>
      <section className={r.panel}>
        {rows.length === 0 ? <p className={r.empty}>No requests yet.</p> :
          <table className={ui.table}><thead><tr><th>Request</th><th>Counterparty · project</th><th>Open items</th><th>Received</th><th>Due</th><th>Status</th></tr></thead><tbody>
            {rows.map(x => { const p = prog.get(x.id); return <tr key={x.id}><td><Link href={`/documents/requests/${x.id}`}><b>{x.title}</b></Link></td><td className={ui.sub}>{name(orgs, x.orgId)} · {name(projs, x.projectId)}</td>
              <td className={ui.num}>{openCount(p)}</td><td className={ui.num}>{(p?.received ?? 0)}</td><td>{x.dueDate ?? "—"}</td><td>{x.status}</td></tr>; })}
          </tbody></table>}
      </section>
      <aside><section className={r.panel}><p className={r.panelTitle}>New request</p>
        <form action={createRequestAction} className={r.form}>
          <label>Workspace<select name="mandateId">{ws.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>Template<select name="template">{Object.entries(REQUEST_TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></label>
          <label>Title<input name="title" placeholder="e.g. RA-ESG data room: Keetmanshoop" /></label>
          <label>Counterparty<select name="orgId" defaultValue={sp.org ?? ""}><option value="">—</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Project<select name="projectId" defaultValue={sp.project ?? ""}><option value="">—</option>{projs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Due<input type="date" name="dueDate" /></label>
          <button className="btn" type="submit">Create</button>
        </form></section></aside>
    </div>
  </>;
}
