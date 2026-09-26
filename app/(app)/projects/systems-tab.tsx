import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalRequirements, interventions, organizations, placeFacts, risks, systemAssessments } from "@/db/schema";
import type { OsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { INSTRUMENTS, RISK_CATEGORIES } from "@/lib/projects/vocab";
import { CAPACITY_LABELS, FRAMEWORKS, IMPLICATIONS, INTERVENTION_STATUSES, INTERVENTION_TYPES, SYSTEM_CATEGORIES } from "@/lib/systems/vocab";
import { addInterventionAction, interventionCapitalAction, interventionStatusAction, reviewAssessmentAction, saveAssessmentAction } from "../systems-actions";
import styles from "./projects.module.css";

const PLACE_FOR: Record<string, string[]> = { water: ["water"], biodiversity: ["ecology"], climate: ["climate"], land: ["land"], community: ["human"], local_economy: ["human"], resilience: ["climate"], system_capacity: ["infrastructure"] };

/** Systems (master build instruction §20–21): capacity → risk → intervention → capital, category by category. */
export default async function SystemsTab({ project, scope, category }: { project: { id: string; currency: string | null }; scope: OsUser["scope"]; category?: string }) {
  const db = appDb();
  const [assessments, ints, facts, riskRows, orgs, reqs] = await Promise.all([
    db.select().from(systemAssessments).where(eq(systemAssessments.projectId, project.id)),
    db.select().from(interventions).where(eq(interventions.projectId, project.id)).orderBy(asc(interventions.status)),
    db.select({ dimension: placeFacts.dimension, label: placeFacts.label, value: placeFacts.value, source: placeFacts.integrationKey }).from(placeFacts).where(eq(placeFacts.projectId, project.id)),
    db.select({ id: risks.id, category: risks.category, description: risks.description }).from(risks).where(eq(risks.projectId, project.id)),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000),
    db.select({ id: capitalRequirements.id, purpose: capitalRequirements.purpose, status: capitalRequirements.status }).from(capitalRequirements).where(eq(capitalRequirements.projectId, project.id)),
  ]);
  const cat = (category && category in SYSTEM_CATEGORIES ? category : "water") as keyof typeof SYSTEM_CATEGORIES;
  const a = assessments.find(x => x.category === cat);
  const context = facts.filter(f => (PLACE_FOR[cat] ?? []).includes(f.dimension));
  const funded = ints.filter(i => i.costEstimate !== null);

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>System capacity by category</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Baseline → dependencies → impacts → thresholds → risks → interventions → future state, translated into asset, permitting and capital consequences. No composite score.</p>
          <div className={styles.readiness}>{(Object.keys(SYSTEM_CATEGORIES) as (keyof typeof SYSTEM_CATEGORIES)[]).map(k => {
            const x = assessments.find(y => y.category === k);
            return <Link key={k} href={`/projects/${project.id}?tab=systems&cat=${k}`} className={styles.dim} style={{ color: "inherit", borderColor: k === cat ? "var(--heading)" : undefined }}>
              <b><span>{SYSTEM_CATEGORIES[k]}</span><span className={x?.capacity === "constrained" || x?.capacity === "exceeded" ? styles.s_blocked : styles.s_unknown}>{x ? CAPACITY_LABELS[x.capacity] : "Not assessed"}</span></b>
              <span className={ui.sub}>{x ? `${x.status === "reviewed" ? `Reviewed by ${x.reviewer}` : "Draft"} · ${ints.filter(i => i.assessmentId === x.id).length} interventions` : "—"}</span>
            </Link>;
          })}</div>
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}><span>{SYSTEM_CATEGORIES[cat]}</span>{a && <span className={ui.chip}>{a.status === "reviewed" ? `Reviewed · ${a.reviewer}` : "Draft"}</span>}</p>
          {context.length > 0 && <p className={ui.sub} style={{ marginTop: 0 }}>Place context: {context.slice(0, 6).map(f => `${f.label} ${f.value} (${f.source})`).join(" · ")}</p>}
          <form action={saveAssessmentAction} className={styles.grid2}>
            <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="category" value={cat} />
            {([["baseline", "Baseline"], ["dependencies", "Dependencies (what the project relies on)"], ["impacts", "Impacts (what the project changes)"], ["thresholds", "Thresholds"], ["risks", "Risks"], ["opportunities", "Opportunities"], ["futureState", "Future state"]] as const).map(([k, l]) => (
              <label key={k} className={k === "baseline" || k === "futureState" ? styles.wide : undefined}>{l}<textarea name={k} rows={2} defaultValue={a?.[k] ?? ""} /></label>
            ))}
            <label>Capacity<select name="capacity" defaultValue={a?.capacity ?? "unknown"}>{Object.entries(CAPACITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Sources (required to mark reviewed)<input name="sources" defaultValue={a?.sources ?? ""} /></label>
            <p className={`${ui.sub} ${styles.wide}`} style={{ margin: "4px 0 0" }}><b>What it means for the asset and its capital</b></p>
            {(Object.keys(IMPLICATIONS) as (keyof typeof IMPLICATIONS)[]).map(k => <label key={k}>{IMPLICATIONS[k]}<input name={`imp_${k}`} defaultValue={a?.implications[k] ?? ""} /></label>)}
            <div className={`${styles.checks} ${styles.wide}`}>{Object.entries(FRAMEWORKS).map(([k, v]) => <label key={k}><input type="checkbox" name="frameworks" value={k} defaultChecked={a?.frameworks.includes(k)} />{v}</label>)}<span className={ui.sub}>(reference mapping, not certification)</span></div>
            <button className="btn btn--primary" type="submit">Save</button>
          </form>
          {a && a.status !== "reviewed" && <form action={reviewAssessmentAction} className={styles.inline} style={{ marginTop: 8 }}><input type="hidden" name="assessmentId" value={a.id} /><input name="reviewer" placeholder="Reviewer (name, role)" aria-label="Reviewer" /><button className={ui.miniBtn} type="submit">Mark reviewed</button></form>}
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Interventions</p>
          {funded.length > 0 && <p className={ui.sub} style={{ marginTop: 0 }}>Estimated cost of interventions: {[...new Set(funded.map(i => i.currency))].map(c => compactMoney(funded.filter(i => i.currency === c).reduce((s, i) => s + (i.costEstimate ?? 0), 0), c)).join(" + ")}</p>}
          {ints.length === 0 ? <p className={r.empty}>No interventions. Each one links a system issue to a cost, an outcome, the risk it reduces, a funding pathway and a partner.</p> : (
            <table className={ui.table}><tbody>{ints.map(i => {
              const req = reqs.find(x => x.id === i.capitalRequirementId);
              return (
                <tr key={i.id}>
                  <td><b>{i.systemIssue}</b> · {INTERVENTION_TYPES[i.implementationType]} <span className={ui.chip}>{INTERVENTION_STATUSES[i.status]}</span>
                    {i.description && <span style={{ display: "block", fontSize: 13 }}>{i.description}</span>}
                    <span className={ui.sub} style={{ display: "block" }}>{[i.costEstimate !== null && `${compactMoney(i.costEstimate, i.currency)}${i.costBasis ? ` (${i.costBasis})` : " (basis not recorded)"}`, i.expectedOutcome && `outcome: ${i.expectedOutcome}`, i.riskReduction && `reduces: ${i.riskReduction}`,
                      i.riskId && `risk: ${riskRows.find(x => x.id === i.riskId)?.description ?? ""}`, i.financialRelevance && `financial: ${i.financialRelevance}`, i.fundingPathway && `funding: ${i.fundingPathway}`,
                      i.partnerOrgId && `partner: ${orgs.find(o => o.id === i.partnerOrgId)?.name ?? ""}`, req && `capital: ${req.purpose} (${req.status})`, i.evidence && `evidence: ${i.evidence}`].filter(Boolean).join(" · ")}</span></td>
                  <td>
                    <form action={interventionStatusAction} className={styles.inline}><input type="hidden" name="interventionId" value={i.id} /><select name="status" defaultValue={i.status} aria-label="Status">{Object.entries(INTERVENTION_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form>
                    {!i.capitalRequirementId && <form action={interventionCapitalAction} className={styles.inline} style={{ marginTop: 4 }}><input type="hidden" name="interventionId" value={i.id} /><select name="instrument" defaultValue="nature_finance" aria-label="Instrument">{Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Create capital need</button></form>}
                  </td>
                </tr>
              );
            })}</tbody></table>
          )}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add an intervention</p>
          <form action={addInterventionAction} className={styles.stack}>
            <input type="hidden" name="projectId" value={project.id} />
            {a && <input type="hidden" name="assessmentId" value={a.id} />}
            <label>System issue<input name="systemIssue" required minLength={3} placeholder={`e.g. ${cat === "water" ? "Aquifer drawdown in dry season" : "Habitat fragmentation"}`} /></label>
            <label>Type<select name="implementationType">{Object.entries(INTERVENTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Description<textarea name="description" rows={2} /></label>
            <label>Cost estimate<input name="costEstimate" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} /></label>
            <label>Cost basis<input name="costBasis" placeholder="Quote, benchmark, study" /></label>
            <label>Expected outcome<input name="expectedOutcome" /></label>
            <label>Risk reduction<input name="riskReduction" /></label>
            <label>Linked risk<select name="riskId" defaultValue=""><option value="">None</option>{riskRows.map(x => <option key={x.id} value={x.id}>{RISK_CATEGORIES[x.category]}: {x.description.slice(0, 60)}</option>)}</select></label>
            <label>Financial relevance<input name="financialRelevance" placeholder="e.g. lowers OPEX, protects yield, unlocks green bond" /></label>
            <label>Funding pathway<input name="fundingPathway" placeholder="e.g. watershed fund, PES, blended grant" /></label>
            <label>Implementation partner<select name="partnerOrgId" defaultValue=""><option value="">None</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label>Evidence<input name="evidence" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
