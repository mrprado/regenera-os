import Link from "next/link";
import { and, asc, desc, eq, isNull, like, ne, sql } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import FilterForm from "@/components/filter-form";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { documents, organizations, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { CONFIDENTIALITY, DOCUMENT_CATEGORIES, DOCUMENT_STATUSES } from "@/lib/contracts/catalog";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { addDocumentAction, documentVersionAction } from "../register-actions";
import styles from "../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/documents");
  const sp = await searchParams;
  const db = appDb();
  const [rows, projectRows, orgs] = await Promise.all([
    db.select({ d: documents, project: projects.name, org: organizations.name }).from(documents)
      .leftJoin(projects, eq(projects.id, documents.projectId)).leftJoin(organizations, eq(organizations.id, documents.counterpartyOrgId))
      .where(and(mandateCondition(user.scope, documents.mandateId),
        sp.superseded ? undefined : ne(documents.status, "superseded"),
        sp.category ? eq(documents.category, sp.category as never) : undefined,
        sp.project ? eq(documents.projectId, sp.project) : undefined,
        sp.q ? like(sql`lower(${documents.title})`, `%${sp.q.toLowerCase()}%`) : undefined))
      .orderBy(desc(documents.updatedAt)).limit(400),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Documents" count={rows.length} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>A registry, not a copy: each entry points to where the document lives (Drive, data room). New versions supersede old ones; nothing is overwritten. File uploads arrive once R2 storage is enabled.</p>
      <div className={ui.workspace}>
        <div>
          <FilterForm action="/documents" className={ui.filters}>
            <p className={ui.filtersTitle}>Filters</p>
            <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} /></div>
            <div className={ui.field}><label htmlFor="category">Category</label>
              <select id="category" name="category" defaultValue={sp.category ?? ""}><option value="">Any</option>{Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className={ui.field}><label htmlFor="project">Project</label>
              <select id="project" name="project" defaultValue={sp.project ?? ""}><option value="">Any</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className={ui.field}><label htmlFor="superseded">Versions</label>
              <select id="superseded" name="superseded" defaultValue={sp.superseded ?? ""}><option value="">Current only</option><option value="1">Include superseded</option></select></div>
            <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/documents">Clear</Link></div>
          </FilterForm>
          <section className={r.panel} style={{ marginTop: 14 }}>
            <p className={r.panelTitle}>Register a document</p>
            <form action={addDocumentAction} className={styles.stack}>
              <input type="hidden" name="back" value="/documents" />
              <label>Title<input name="title" required minLength={2} /></label>
              <label>Category<select name="category" required>{Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Project<select name="projectId" defaultValue=""><option value="">None</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>Counterparty<select name="counterpartyOrgId" defaultValue=""><option value="">None</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label>Version<input name="version" defaultValue="1" /></label>
              <label>Status<select name="status" defaultValue="draft">{Object.entries(DOCUMENT_STATUSES).filter(([k]) => k !== "superseded").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Confidentiality<select name="confidentiality" defaultValue="confidential">{Object.entries(CONFIDENTIALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Effective<input name="effectiveDate" type="date" /></label>
              <label>Expires<input name="expiryDate" type="date" /></label>
              <label>Link<input name="url" placeholder="https://…" /></label>
              <button className="btn btn--primary" type="submit">Register</button>
            </form>
          </section>
        </div>
        <div className={ui.tableWrap}>
          {rows.length === 0 ? <p className={r.empty} style={{ padding: 14 }}>No documents registered.</p> : (
            <table className={ui.table}>
              <thead><tr><th>Document</th><th>Category</th><th>Version</th><th>Status</th><th>Project / counterparty</th><th>Expires</th><th>New version</th></tr></thead>
              <tbody>{rows.map(({ d, project, org }) => (
                <tr key={d.id}>
                  <td>{d.url ? <a className={ui.primary} href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : <span className={ui.primary}>{d.title}</span>}<span className={ui.sub}>{CONFIDENTIALITY[d.confidentiality]} · {d.owner ?? ""}</span></td>
                  <td>{DOCUMENT_CATEGORIES[d.category]}</td>
                  <td>{d.version}</td>
                  <td>{DOCUMENT_STATUSES[d.status]}</td>
                  <td>{project ?? "—"}<span className={ui.sub}>{org ?? ""}</span></td>
                  <td style={{ color: d.expiryDate && d.expiryDate < today ? "#b0432f" : undefined }}>{d.expiryDate ?? "—"}</td>
                  <td>{d.status !== "superseded" && (
                    <form action={documentVersionAction} className={styles.inline}>
                      <input type="hidden" name="id" value={d.id} />
                      <input name="version" required placeholder="v" aria-label="New version" style={{ width: 46 }} />
                      <input name="url" placeholder="Link" aria-label="Link" style={{ width: 100 }} />
                      <button className={ui.miniBtn} type="submit">Add</button>
                    </form>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
