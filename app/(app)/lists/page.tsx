import Link from "next/link";
import { ListChecks } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { listLists } from "@/lib/crm/queries";
import { Notice } from "@/components/crm-bits";
import { activeSequencesForPicker } from "@/lib/outreach/queries";
import { createList, deleteList } from "../crm-actions";
import { enrollListAction } from "../outreach-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lists" };

export default async function ListsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/lists");
  const sp = await searchParams;
  const [all, seqs] = await Promise.all([listLists(user.scope), activeSequencesForPicker(user.scope)]);
  return (
    <>
      <PageHeader title="Lists" count={all.length} />
      <Notice text={sp.notice} />
      <form action={createList} className={r.form} style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 18, maxWidth: 640 }}>
        <label style={{ flex: 1 }}>New list<input name="name" required placeholder="e.g. LatAm family offices, Q4" /></label>
        <label>Of<select name="kind" style={{ height: 36, borderRadius: 10, border: "1px solid var(--line)", padding: "0 10px" }}><option value="people">People</option><option value="companies">Companies</option></select></label>
        <button className="btn btn--primary" type="submit">Create</button>
      </form>
      {all.length === 0 ? (
        <EmptyState icon={ListChecks} title="No lists yet" body="Create a list here, or select rows in People or Companies and choose Add to list. People lists can be enrolled in a sequence in one step." />
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>List</th><th>Of</th><th className={ui.num}>Members</th><th>Created</th><th>Sequence</th><th /></tr></thead>
            <tbody>
              {all.map(l => (
                <tr key={l.id}>
                  <td><Link className={ui.primary} href={`/${l.kind}?list=${l.id}`}>{l.name}</Link></td>
                  <td>{l.kind}</td>
                  <td className={ui.num}>{l.count}</td>
                  <td>{l.createdAt.slice(0, 10)}</td>
                  <td>{l.kind === "people" && l.count > 0 ? (
                    <form action={enrollListAction} className={ui.rowActions}>
                      <input type="hidden" name="listId" value={l.id} />
                      <select name="sequenceId" aria-label={`Sequence for ${l.name}`} defaultValue="" style={{ height: 26, borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, padding: "0 8px" }}>
                        <option value="">Sequence…</option>{seqs.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                      </select>
                      <button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Enroll all</button>
                    </form>
                  ) : null}</td>
                  <td><form action={deleteList}><input type="hidden" name="id" value={l.id} /><button className={ui.miniBtn} type="submit">Delete</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
