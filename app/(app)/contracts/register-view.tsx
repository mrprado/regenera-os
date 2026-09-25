import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contracts, organizations, projects } from "@/db/schema";
import { withBase } from "@/lib/base-path";
import { CONTRACT_CATEGORIES, LIFECYCLE, typeLabel } from "@/lib/contracts/catalog";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { registerContractAction } from "../register-actions";
import styles from "../projects/projects.module.css";

/** Project and third-party agreements: recorded, not drafted. */
export default async function RegisterView({ scope, sp }: { scope: Scope; sp: Record<string, string | undefined> }) {
  const db = appDb();
  const [rows, projectRows, orgs] = await Promise.all([
    db.select({ c: contracts, project: projects.name }).from(contracts).leftJoin(projects, eq(projects.id, contracts.projectId))
      .where(and(mandateCondition(scope, contracts.mandateId), eq(contracts.kind, "registered"), sp.category ? eq(contracts.category, sp.category) : undefined)).orderBy(desc(contracts.updatedAt)).limit(300),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className={r.grid}>
      <div>
        <p className={ui.sub} style={{ marginTop: 0 }}>Land, development, PPAs and offtake, interconnection, EPC and supply, O&amp;M, financing, equity, bonds, community and insurance agreements. Record key terms and obligations with their source clause; the executed document stays where it lives (Drive, data room). <a href={withBase("/api/contracts/register?type=contracts")}>Contract register (CSV)</a></p>
        {rows.length === 0 ? <p className={r.empty}>No agreements registered yet.</p> : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Agreement</th><th>Lifecycle</th><th>Project</th><th>Governing law</th><th>Effective / ends</th><th>Value</th></tr></thead>
              <tbody>{rows.map(({ c, project }) => (
                <tr key={c.id}>
                  <td><Link className={ui.primary} href={`/contracts/${c.id}`}>{c.title}</Link><span className={ui.sub}>{typeLabel(c.category, c.contractType)}{c.reviewRequired ? " · review required" : ""}</span></td>
                  <td>{LIFECYCLE[c.lifecycle]}{c.lockedAt ? <span className={ui.sub}>Executed, locked</span> : null}</td>
                  <td>{project ?? "—"}</td>
                  <td>{c.governingLaw ?? "—"}</td>
                  <td>{c.effectiveDate ?? "—"}<span className={ui.sub} style={{ color: c.endDate && c.endDate < today ? "#b0432f" : undefined }}>{c.endDate ?? ""}</span></td>
                  <td>{compactMoney(c.value, c.terms.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Register an agreement</p>
          <form action={registerContractAction} className={styles.stack}>
            <label>Type<select name="type" required defaultValue="">
              <option value="" disabled>Choose</option>
              {Object.entries(CONTRACT_CATEGORIES).map(([ck, cat]) => (
                <optgroup key={ck} label={cat.label}>{Object.entries(cat.types).map(([tk, label]) => <option key={tk} value={`${ck}:${tk}`}>{label}</option>)}</optgroup>
              ))}
            </select></label>
            <label>Title<input name="title" placeholder="e.g. PPA with CFE, 20 years" /></label>
            <label>Project<select name="projectId" defaultValue=""><option value="">None</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Counterparty<select name="counterpartyOrgId" defaultValue=""><option value="">Not set</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label>Lifecycle<select name="lifecycle" defaultValue="draft">{Object.entries(LIFECYCLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Governing law<input name="governingLaw" /></label>
            <label>Dispute forum<input name="forum" placeholder="e.g. ICC arbitration, Mexico City" /></label>
            <label>Execution date<input name="executionDate" type="date" /></label>
            <label>Effective date<input name="effectiveDate" type="date" /></label>
            <label>Expires<input name="endDate" type="date" /></label>
            <label>Renewal terms<input name="renewalTerms" /></label>
            <label>Value<input name="value" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue="USD" /></label>
            <label>Executed document (link)<input name="documentUrl" placeholder="https://drive.google.com/…" /></label>
            <label>Summary<textarea name="summary" rows={3} /></label>
            <button className="btn btn--primary" type="submit">Register</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
