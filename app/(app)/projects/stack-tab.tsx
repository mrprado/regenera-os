import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { appDb, isOwner, type Scope } from "@/lib/db/scoped";
import { structuresForProject, summarizeStack, type LayerInput } from "@/lib/capital/stack";
import { REVIEW_STATUSES, STRUCTURE_STATUSES } from "@/lib/capital/structure-vocab";
import { compactMoney } from "@/lib/projects/labels";
import { createStructureAction, deleteStructureAction, duplicateStructureAction, reviewStructureAction } from "../structure-actions";
import StackBuilder from "./stack-builder";
import styles from "./stack.module.css";

/** Capital stack (§11): scenarios per project, the interactive builder and a side-by-side comparison. */
export default async function StackTab({ project, scope, structureId }: { project: { id: string; mandateId: string; name: string }; scope: Scope; structureId?: string }) {
  const structures = await structuresForProject(appDb(), project.id);
  const toInput = (l: (typeof structures)[number]["layers"][number]): LayerInput => ({
    id: l.id, layer: l.layer, provider: l.provider, providerOrgId: l.providerOrgId, requirementId: l.requirementId, currency: l.currency, amount: l.amount, pricing: l.pricing,
    ratePct: l.ratePct, tenorYears: l.tenorYears, amortization: l.amortization, security: l.security, status: l.status, conditions: l.conditions, source: l.source, assumptionStatus: l.assumptionStatus,
  });
  const selected = structures.find(s => s.id === structureId) ?? structures.find(s => s.status === "preferred") ?? structures[0];
  const summaries = structures.map(s => ({ s, sum: summarizeStack({ currency: s.currency, totalCost: s.totalCost, layers: s.layers.map(toInput) }) }));
  const owner = isOwner(scope, project.mandateId);

  if (!selected) return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Capital stack</p>
      <p className={r.empty}>No capital structure yet. A structure is a scenario: how the project&apos;s total cost is covered by debt, mezzanine, equity, grants and credit support. The first scenario starts from the project&apos;s capital requirements, each marked as an assumption until sourced.</p>
      <form action={createStructureAction} className={styles.add}>
        <input type="hidden" name="projectId" value={project.id} />
        <input name="name" defaultValue="Base structure" aria-label="Scenario name" />
        <button className="btn btn--primary" type="submit">Create scenario</button>
      </form>
    </section>
  );

  return (
    <div className={styles.builder}>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Scenarios</span><span className={ui.chip}>{REVIEW_STATUSES[selected.reviewStatus]}</span></p>
        <div className={styles.scenarios}>
          {structures.map(s => <Link key={s.id} className={`${ui.tab} ${s.id === selected.id ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=stack&structure=${s.id}`}>{s.name}{s.status === "preferred" ? " ★" : ""}</Link>)}
          <form action={duplicateStructureAction} className={styles.add}>
            <input type="hidden" name="structureId" value={selected.id} />
            <input name="name" placeholder="New scenario name" aria-label="New scenario name" required />
            <button className={ui.miniBtn} type="submit">Copy as new scenario</button>
          </form>
        </div>
        {selected.reviewNote && <p className={ui.sub}>Review: {selected.reviewNote}</p>}
      </section>

      <section className={r.panel}>
        <StackBuilder key={`${selected.id}:${selected.updatedAt}`} structure={{ id: selected.id, name: selected.name, currency: selected.currency, totalCost: selected.totalCost, costSource: selected.costSource, status: selected.status, notes: selected.notes, layers: selected.layers.map(toInput) }} />
      </section>

      {summaries.length > 1 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Compare scenarios</p>
          <div className={ui.tableWrap}>
            <table className={styles.compare}>
              <thead><tr><th>Scenario</th><th>Status</th><th>Funded</th><th>Coverage</th><th>Debt / equity</th><th>Weighted rate</th><th>Committed</th><th>Unsourced layers</th></tr></thead>
              <tbody>{summaries.map(({ s, sum }) => (
                <tr key={s.id}>
                  <td><Link href={`/projects/${project.id}?tab=stack&structure=${s.id}`}>{s.name}</Link></td>
                  <td>{STRUCTURE_STATUSES[s.status]}</td>
                  <td>{compactMoney(sum.funded, s.currency)}</td>
                  <td>{sum.coveragePct != null ? `${sum.coveragePct}%` : "—"}</td>
                  <td>{sum.debtPct != null ? `${sum.debtPct}% / ${sum.equityPct}%` : "—"}</td>
                  <td>{sum.weightedRatePct != null ? `${sum.weightedRatePct}%` : "—"}</td>
                  <td>{sum.committedPct != null ? `${sum.committedPct}%` : "—"}</td>
                  <td>{s.layers.filter(l => l.assumptionStatus === "assumption").length} of {s.layers.length}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className={r.panel}>
        <p className={r.panelTitle}>Review and housekeeping</p>
        <p className={ui.sub}>The OS never labels a structure legally compliant or bankable. An owner records who reviewed it and the scope; saving any change resets the review. Returns and debt sizing live in <Link href={`/projects/${project.id}?tab=economics`}>Economics</Link>.</p>
        {owner && (
          <form action={reviewStructureAction} className={styles.add} style={{ marginTop: 8 }}>
            <input type="hidden" name="structureId" value={selected.id} />
            <select name="reviewStatus" defaultValue={selected.reviewStatus} aria-label="Review status">{Object.entries(REVIEW_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="reviewNote" defaultValue={selected.reviewNote} placeholder="Reviewer, firm, scope and date" aria-label="Review note" style={{ flex: 1 }} />
            <button className={ui.miniBtn} type="submit">Record</button>
          </form>
        )}
        <form action={deleteStructureAction} style={{ marginTop: 8 }}>
          <input type="hidden" name="structureId" value={selected.id} />
          <button className={ui.miniBtn} type="submit">Delete this scenario</button>
        </form>
      </section>
    </div>
  );
}
