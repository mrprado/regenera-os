import { env } from "cloudflare:workers";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { imports } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { detectMapping, IMPORT_FIELDS, type ImportField } from "@/lib/import/csv";
import { importKey, r2Store, type StoredImport } from "@/lib/import/process";
import { confirmImport, uploadImport } from "../../import-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import CSV" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/people/import");
  const sp = await searchParams;
  const db = appDb();
  const recent = await db.select().from(imports).where(mandateCondition(user.scope, imports.mandateId)).orderBy(desc(imports.createdAt)).limit(10);
  const current = sp.id ? (await db.select().from(imports).where(and(eq(imports.id, sp.id), mandateCondition(user.scope, imports.mandateId))))[0] : undefined;
  let stored: StoredImport | null = null;
  if (current?.status === "pending" && env.BUCKET) {
    const raw = await r2Store(env.BUCKET).get(importKey(current.id));
    stored = raw ? (JSON.parse(raw) as StoredImport) : null;
  }
  const detected = stored ? detectMapping(stored.headers) : {};

  return (
    <>
      <PageHeader title="Import CSV" actions={<Link className="btn" href="/people">Back to People</Link>} />
      <Notice text={sp.notice} />
      {!current && (
        <form action={uploadImport} className={`${r.panel} ${r.form}`} style={{ maxWidth: 680 }}>
          <label>CSV file: an Apollo export, a Sales Navigator export, or any spreadsheet saved as CSV (up to 5 MB)
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <p className={r.why}>Columns are detected automatically and you confirm the mapping before anything is saved. Rows are deduplicated by email, LinkedIn URL, and name at the same organization. Companies get free identity enrichment and a map location.</p>
          <button className="btn btn--primary" type="submit">Upload and preview</button>
        </form>
      )}

      {current && current.status === "pending" && stored && (
        <form action={confirmImport} className={r.panel}>
          <input type="hidden" name="id" value={current.id} />
          <p className={r.panelTitle}><span>{current.filename} · {current.totalRows} rows</span><span>Confirm the column mapping</span></p>
          <div className={ui.stats} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {(Object.entries(IMPORT_FIELDS) as [ImportField, string][]).map(([field, label]) => (
              <label key={field} className={ui.field}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
                <select name={`map_${field}`} defaultValue={detected[field] !== undefined ? String(detected[field]) : ""} style={{ height: 32, borderRadius: 8, border: "1px solid var(--line)", padding: "0 8px" }}>
                  <option value="">Not in file</option>
                  {stored!.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className={ui.tableWrap} style={{ marginBottom: 12 }}>
            <table className={ui.table}>
              <thead><tr>{stored.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{stored.rows.slice(0, 10).map((row, i) => <tr key={i}>{stored!.headers.map((_, j) => <td key={j}>{row[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <button className="btn btn--primary" type="submit">Import {current.totalRows} rows</button>
        </form>
      )}

      {current && current.status !== "pending" && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>{current.filename}</span><span>{current.status}</span></p>
          <dl className={r.kv}>
            <dt>Processed</dt><dd>{current.processedRows} of {current.totalRows}</dd>
            <dt>New</dt><dd>{current.created}</dd>
            <dt>Updated (merged)</dt><dd>{current.updated}</dd>
            <dt>Flagged</dt><dd>{current.flagged}</dd>
            {current.error && <><dt>Error</dt><dd>{current.error}</dd></>}
          </dl>
          <p className={r.why}>Imports run in the background, 200 rows per job tick. Refresh to update.</p>
          <Link className="btn" href="/people?sort=recent">View people</Link>
        </section>
      )}

      {recent.length > 0 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Recent imports</p>
          <table className={ui.table}><tbody>
            {recent.map(i => <tr key={i.id}><td><Link href={`/people/import?id=${i.id}`}>{i.filename}</Link></td><td>{i.status}</td><td className={ui.num}>{i.processedRows}/{i.totalRows}</td><td>{i.createdAt.slice(0, 10)}</td></tr>)}
          </tbody></table>
        </section>
      )}
    </>
  );
}
