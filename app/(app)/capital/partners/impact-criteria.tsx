// Impact criteria, investor status ladder and integrity fit with screened projects (phase 23). Owner-only: capital
// criteria and relationship status are private and never reach Ask, MCP or search.
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalProfiles, policyDecisions, projects } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { capitalFit, INVESTOR_STATUS } from "@/lib/integrity/capital-fit";
import { DECISION_STATE_LABEL } from "@/lib/integrity/policy";
import { saveImpactCriteriaAction } from "../../integrity-actions";
import styles from "../../projects/projects.module.css";

const FIT_LABEL = { no: "Not a fit", unknown: "Unknown", possible: "Possible fit", conditional: "Conditional" } as const;

export default async function ImpactCriteria({ profile }: { profile: typeof capitalProfiles.$inferSelect }) {
  const c = profile.impactCriteria ?? {};
  const rows = await appDb().select({ d: policyDecisions, name: projects.name, technology: projects.technology, description: projects.description }).from(policyDecisions)
    .innerJoin(projects, eq(projects.id, policyDecisions.projectId)).where(and(eq(policyDecisions.mandateId, profile.mandateId), eq(policyDecisions.current, true))).limit(40);
  const fits = rows.map(x => ({ ...x, fit: capitalFit(c, x.d, `${x.name} ${x.technology ?? ""} ${x.description}`) })).sort((a, b) => ["possible", "conditional", "unknown", "no"].indexOf(a.fit.fit) - ["possible", "conditional", "unknown", "no"].indexOf(b.fit.fit));
  const steps = Object.keys(INVESTOR_STATUS) as (keyof typeof INVESTOR_STATUS)[];
  const at = profile.investorStatus ? steps.indexOf(profile.investorStatus) : -1;
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Impact criteria &amp; status</p>
      <p className={ui.sub}>{steps.map((s, i) => <span key={s} style={{ fontWeight: i === at ? 600 : undefined, color: i <= at ? "var(--text)" : "var(--text-muted)" }}>{i ? " → " : ""}{INVESTOR_STATUS[s]}</span>)}</p>
      <p className={ui.sub}>Thematic similarity is not commitment: move up the ladder only on what the investor has stated or approved.</p>
      <form action={saveImpactCriteriaAction} className={styles.stack}>
        <input type="hidden" name="id" value={profile.id} />
        <label>Status<select name="investorStatus" defaultValue={profile.investorStatus ?? ""}><option value="">Not set</option>{steps.map(s => <option key={s} value={s}>{INVESTOR_STATUS[s]}</option>)}</select></label>
        <label>Environmental objectives (comma-separated)<input name="environmental" defaultValue={(c.environmental ?? []).join(", ")} /></label>
        <label>Exclusions (comma-separated words matched on project text)<input name="exclusions" defaultValue={(c.exclusions ?? []).join(", ")} /></label>
        <label>Safeguard standard (e.g. IFC Performance Standards)<input name="safeguardStandard" defaultValue={c.safeguardStandard ?? ""} /></label>
        <label>Impact reporting expectation<input name="impactReporting" defaultValue={c.impactReporting ?? ""} /></label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="catalytic" defaultChecked={!!c.catalytic} /> Catalytic / concessional capital</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="technicalAssistance" defaultChecked={!!c.technicalAssistance} /> Offers technical assistance</label>
        <button className="btn" type="submit">Save criteria</button>
      </form>
      <p className={ui.sub} style={{ marginTop: 10 }}><b>Fit with screened projects in this workspace</b></p>
      {fits.length === 0 ? <p className={r.empty}>No screened projects yet.</p> : (
        <table className={ui.table}><tbody>{fits.map(x => (
          <tr key={x.d.id}><td><Link href={`/projects/${x.d.projectId}?tab=capital#integrity`}>{x.name}</Link><span className={ui.sub}>{DECISION_STATE_LABEL[x.d.state]}</span></td><td>{FIT_LABEL[x.fit.fit]}</td><td className={ui.wrap}><span className={ui.sub}>{x.fit.notes.join("; ")}</span></td></tr>
        ))}</tbody></table>
      )}
    </section>
  );
}
