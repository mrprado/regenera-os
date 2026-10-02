import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { analysisRequests } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { IC_STATUSES, REQUEST_STATUSES } from "@/lib/workbench/vocab";

/** Project 360: the analyses behind this project's decisions (the caller has already scoped the project). */
export default async function AnalysesPanel({ projectId }: { projectId: string }) {
  const rows = await appDb().select().from(analysisRequests).where(eq(analysisRequests.projectId, projectId)).orderBy(desc(analysisRequests.updatedAt)).limit(12);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Analyses and decisions</span><Link href={`/workbench?project=${projectId}`}>New analysis</Link></p>
      {rows.length === 0 ? <p className={r.empty}>No analyses yet. Open one to take a question from issue tree and evidence to a reviewed decision.</p> : (
        <table className={ui.table}><tbody>{rows.map(a => <tr key={a.id}>
          <td className={ui.primary}><Link href={`/workbench/${a.id}`}>{a.question}</Link>{a.conclusion && <span className={ui.sub}>{a.conclusion}</span>}</td>
          <td className={ui.sub}>{REQUEST_STATUSES[a.status]}{a.icStatus !== "none" ? ` · IC ${IC_STATUSES[a.icStatus].toLowerCase()}` : ""}</td>
        </tr>)}</tbody></table>)}
    </section>
  );
}
