import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { REQUEST_ITEM_STATES } from "@/db/casework";
import { docRequests, documents, organizations, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { openCount, requestItems, requestProgress } from "@/lib/documents/requests";
import { closeRequestAction, setRequestItemAction } from "../../../casework-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document request" };

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/documents/requests");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [req] = await db.select().from(docRequests).where(and(eq(docRequests.id, id), mandateCondition(user.scope, docRequests.mandateId)));
  if (!req) notFound();
  const [items, docs, org, proj, prog] = await Promise.all([
    requestItems(db, req.id),
    db.select({ id: documents.id, title: documents.title }).from(documents).where(eq(documents.mandateId, req.mandateId)).limit(500),
    req.orgId ? db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, req.orgId)) : Promise.resolve([]),
    req.projectId ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, req.projectId)) : Promise.resolve([]),
    requestProgress(db, [req.id]),
  ]);
  const p = prog.get(req.id);
  const sections = [...new Set(items.map(i => i.section))];
  return <>
    <PageHeader title={req.title} />
    <Notice text={sp.notice} />
    <p className={ui.sub}><Link href="/documents/requests">Document requests</Link> · {org[0]?.name ?? "no counterparty"} · {proj[0]?.name ?? "no project"} · {openCount(p)} open, {p?.received ?? 0} received · {req.status}{req.dueDate ? ` · due ${req.dueDate}` : ""}</p>
    <section className={r.panel}>
      {sections.map(s => <div key={s} style={{ marginBottom: 18 }}><p className={r.panelTitle}>{s}</p>
        <table className={ui.table}><tbody>{items.filter(i => i.section === s).map(i => <tr key={i.id} id={`i-${i.id}`}><td style={{ width: "40%" }}>{i.item}</td>
          <td><form action={setRequestItemAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="requestId" value={req.id} />
            <select name="status" defaultValue={i.status}>{Object.entries(REQUEST_ITEM_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="documentId" defaultValue={i.documentId ?? ""}><option value="">No document linked</option>{docs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
            <input name="note" defaultValue={i.note} placeholder="Note" /><button className={ui.miniBtn} type="submit">Save</button></form>
            {i.updatedBy && <span className={ui.sub}>{i.updatedBy} · {i.updatedAt.slice(0, 10)}</span>}</td></tr>)}</tbody></table></div>)}
      <form action={closeRequestAction}><input type="hidden" name="id" value={req.id} />{req.status === "closed" && <input type="hidden" name="reopen" value="1" />}<button className={ui.miniBtn} type="submit">{req.status === "closed" ? "Reopen" : "Close request"}</button></form>
    </section>
  </>;
}
