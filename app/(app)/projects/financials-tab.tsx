import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { finChanges, finModels } from "@/db/schema";
import { FINANCEABILITY, FIN_CASE_TYPES } from "@/db/finance";
import { appDb, isOwner, type Scope } from "@/lib/db/scoped";
import { TEMPLATES } from "@/lib/finance/analysis";
import { withBase } from "@/lib/base-path";
import { approveModelAction, createModelAction, importSiteQuantitiesAction, newVersionAction, setFinanceabilityAction } from "../finance-actions";
import FinanceWorkspace from "./finance-workspace";
import styles from "./finance.module.css";

const FIN_LABEL: Record<(typeof FINANCEABILITY)[number], string> = { screening: "Screening", economic_not_bankable: "Economic but not bankable", structurable: "Structurable", lender_review: "Lender review", financeable_subject_to_conditions: "Financeable subject to conditions", financial_close: "Financial close" };

/** Financials (underwriting extension): versioned project-finance cases with assumptions, outputs and audit trail. */
export default async function FinancialsTab({ project, scope, modelId }: { project: { id: string; mandateId: string; currency: string | null }; scope: Scope; modelId?: string }) {
  const models = await appDb().select().from(finModels).where(eq(finModels.projectId, project.id)).orderBy(desc(finModels.version));
  const m = models.find(x => x.id === modelId) ?? models[0];
  const owner = isOwner(scope, project.mandateId);
  const changes = m ? await appDb().select().from(finChanges).where(eq(finChanges.modelId, m.id)).orderBy(asc(finChanges.at)).limit(300) : [];

  return (
    <div className={styles.page}>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Financial cases</span>{m && <span className={ui.chip}>{FIN_LABEL[m.financeability]}</span>}</p>
        {models.length > 0 && <div className={styles.cases}>{models.map(x => <Link key={x.id} className={`${ui.tab} ${x.id === m?.id ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=financials&model=${x.id}`}>V{x.version} {x.name} · {x.caseType}{x.status === "locked" ? " 🔒" : ""}</Link>)}</div>}
        <details open={!models.length}><summary className={ui.sub}>New model from a template</summary>
          <form action={createModelAction} className={styles.inlineForm}>
            <input type="hidden" name="projectId" value={project.id} />
            <select name="template" defaultValue="utility_solar" aria-label="Template">{Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="name" placeholder="Model name" aria-label="Model name" />
            <button className={ui.miniBtn} type="submit">Create</button>
          </form>
          <p className={ui.sub}>Templates provide structure only. Every value starts as a PLACEHOLDER; nothing is filled with market data.</p>
        </details>
      </section>

      {m && <>
        <FinanceWorkspace key={`${m.id}:${m.updatedAt}`} modelId={m.id} name={`V${m.version} ${m.name}`} status={m.status} readOnly={m.status === "locked" || m.status === "approved" || m.status === "superseded"} initial={m.definition} currency={project.currency ?? "USD"}
          versions={models.map(x => ({ id: x.id, name: x.name, version: x.version, status: x.status, caseType: x.caseType, definition: x.definition, parentId: x.parentId }))} />

        <section className={r.panel}>
          <p className={r.panelTitle}>Case governance</p>
          <div className={styles.govGrid}>
            <form action={newVersionAction} className={styles.inlineForm}>
              <input type="hidden" name="modelId" value={m.id} />
              <input name="name" placeholder="New version name (e.g. Lender case)" aria-label="New version name" required />
              <select name="caseType" defaultValue={m.caseType} aria-label="Case type">{FIN_CASE_TYPES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
              <button className={ui.miniBtn} type="submit">New version</button>
            </form>
            {m.status !== "locked" && <form action={importSiteQuantitiesAction} className={styles.inlineForm}>
              <input type="hidden" name="modelId" value={m.id} />
              <button className={ui.miniBtn} type="submit">Import site quantities from ATLAS</button>
              <span className={ui.sub}>Road, transmission and pipeline lengths and restoration areas from saved workbench features.</span>
            </form>}
            {owner && m.status !== "locked" && <form action={approveModelAction} className={styles.inlineForm}>
              <input type="hidden" name="modelId" value={m.id} />
              <input name="reviewer" placeholder="Reviewed by (name, firm)" aria-label="Reviewer" required />
              <button className={ui.miniBtn} type="submit">Approve and lock</button>
            </form>}
            <form action={setFinanceabilityAction} className={styles.inlineForm}>
              <input type="hidden" name="modelId" value={m.id} />
              <select name="financeability" defaultValue={m.financeability} aria-label="Financeability">{FINANCEABILITY.map(f => <option key={f} value={f}>{FIN_LABEL[f]}</option>)}</select>
              <input name="note" defaultValue={m.notes} placeholder="Basis: who assessed it, against which lender terms" aria-label="Basis" />
              <button className={ui.miniBtn} type="submit">Record status</button>
            </form>
          </div>
          <p className={ui.sub}>Financeability is set by a person with its basis; the OS never designates it. Approved cases are locked; changes need a new version. Prepared by {m.preparedBy ?? "—"}{m.reviewedBy ? ` · reviewed by ${m.reviewedBy}` : ""}{m.approvedBy ? ` · approved by ${m.approvedBy} ${m.approvedAt?.slice(0, 10)}` : ""}.</p>
          <p className={ui.sub}><a href={withBase(`/api/finance/export?model=${m.id}`)} download>Export workbook (XLSX)</a></p>
          <details><summary className={ui.sub}>Change log ({changes.length})</summary>
            <table className={ui.table}><thead><tr><th>When</th><th>Who</th><th>Input</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>
              {changes.map(c => <tr key={c.id}><td>{c.at.slice(0, 16).replace("T", " ")}</td><td>{c.actor}</td><td>{c.path}</td><td>{c.fromValue}</td><td>{c.toValue}</td><td>{c.reason}</td></tr>)}
            </tbody></table>
          </details>
        </section>
      </>}
    </div>
  );
}
