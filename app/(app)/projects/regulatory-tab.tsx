import { asc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { permits, projectJurisdictions, requirements } from "@/db/schema";
import { appDb, type UserScope } from "@/lib/db/scoped";
import { JURISDICTION_ROLES, PERMIT_STATUSES, REGULATION_DOMAINS, REQUIREMENT_STATUSES, SOURCE_TIERS, STANDARD_CHECKLISTS, TRACKS } from "@/lib/regulatory/vocab";
import { ReviewsPanel } from "../regulatory/reviews-panel";
import { addJurisdictionAction, addPermitAction, addRequirementAction, removeJurisdictionAction, requirementStatusAction, seedChecklistAction, updatePermitAction } from "../regulatory-actions";
import styles from "./projects.module.css";

/** Regulatory tab: jurisdiction matrix, host-country requirements vs lender standards, permits, reviews. */
export default async function RegulatoryTab({ projectId, scope }: { projectId: string; scope: UserScope }) {
  const db = appDb();
  const [juris, reqs, permitRows] = await Promise.all([
    db.select().from(projectJurisdictions).where(eq(projectJurisdictions.projectId, projectId)).orderBy(asc(projectJurisdictions.role)),
    db.select().from(requirements).where(eq(requirements.projectId, projectId)).orderBy(asc(requirements.track), asc(requirements.domain)),
    db.select().from(permits).where(eq(permits.projectId, projectId)).orderBy(asc(permits.expiresAt)),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const back = `/projects/${projectId}?tab=regulatory`;
  const reqTable = (track: keyof typeof TRACKS) => {
    const rows = reqs.filter(x => x.track === track);
    return rows.length === 0 ? <p className={r.empty}>{track === "host_law" ? "No host-country requirements recorded yet." : "No lender or investor standards recorded. Seed a checklist below if a lender or investor applies one."}</p> : (
      <table className={ui.table}><tbody>{rows.map(q => (
        <tr key={q.id}>
          <td><b>{REGULATION_DOMAINS[q.domain]}</b>{q.jurisdiction ? ` · ${q.jurisdiction}` : ""}<span style={{ display: "block" }}>{q.title}</span>
            <span className={ui.sub}>{[q.authority && `Authority: ${q.authority}`, q.source && `Source: ${q.source}`, q.sourceTier && `Tier ${q.sourceTier}`, q.reviewer && `Reviewed by ${q.reviewer} ${q.reviewedAt?.slice(0, 10) ?? ""}`, q.evidence && `Evidence: ${q.evidence}`, q.nextVerification && `Verify by ${q.nextVerification}`].filter(Boolean).join(" · ")}</span></td>
          <td>
            <form action={requirementStatusAction} className={styles.stack} style={{ minWidth: 190 }}>
              <input type="hidden" name="id" value={q.id} />
              <select name="status" defaultValue={q.status} aria-label="Status">{Object.entries(REQUIREMENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input name="evidence" placeholder="Evidence" aria-label="Evidence" />
              <input name="reviewer" placeholder="Reviewer" aria-label="Reviewer" />
              <input name="nextVerification" type="date" defaultValue={q.nextVerification ?? ""} aria-label="Next verification" style={{ color: q.nextVerification && q.nextVerification <= today ? "#b0432f" : undefined }} />
              <button className={ui.miniBtn} type="submit">Update</button>
            </form>
          </td>
        </tr>
      ))}</tbody></table>
    );
  };

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Jurisdiction matrix</p>
          {juris.length === 0 ? <p className={r.empty}>Which jurisdictions apply: project site, ProjectCo, sponsor, Regenera entity, investors, lenders, issuer, EPC, equipment origin, offtaker.</p> : (
            <table className={ui.table}><tbody>{(Object.keys(JURISDICTION_ROLES) as (keyof typeof JURISDICTION_ROLES)[]).filter(role => juris.some(j => j.role === role)).map(role => (
              <tr key={role}><td>{JURISDICTION_ROLES[role]}</td><td>{juris.filter(j => j.role === role).map(j => (
                <form key={j.id} action={removeJurisdictionAction} style={{ display: "inline-flex", gap: 4, marginRight: 10 }}><input type="hidden" name="id" value={j.id} /><b>{j.jurisdiction}</b>{j.note ? <span className={ui.sub}>{j.note}</span> : null}<button className={ui.miniBtn} type="submit" aria-label={`Remove ${j.jurisdiction}`}>×</button></form>
              ))}</td></tr>
            ))}</tbody></table>
          )}
          <form action={addJurisdictionAction} className={styles.inline} style={{ marginTop: 8 }}>
            <input type="hidden" name="projectId" value={projectId} />
            <select name="role" aria-label="Role">{Object.entries(JURISDICTION_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="jurisdiction" required placeholder="MX or MX-YUC" aria-label="Jurisdiction" style={{ width: 110 }} />
            <input name="note" placeholder="Note" aria-label="Note" />
            <button className={ui.miniBtn} type="submit">Add</button>
          </form>
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Permission to build: host-country law</p>
          {reqTable("host_law")}
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Lender and investor standards</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Separate from permission to build: a project can hold every permit and still fail lender diligence.</p>
          {reqTable("lender_standard")}
          <div className={ui.rowActions} style={{ marginTop: 8 }}>
            {Object.entries(STANDARD_CHECKLISTS).map(([k, v]) => (
              <form key={k} action={seedChecklistAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="checklist" value={k} /><button className={ui.miniBtn} type="submit">Add {v.label}</button></form>
            ))}
          </div>
        </section>

        <section className={r.panel}>
          <p className={r.panelTitle}>Permits</p>
          {permitRows.length === 0 ? <p className={r.empty}>No permits recorded. Each permit knows its authority, reference, conditions and expiry.</p> : (
            <table className={ui.table}><tbody>{permitRows.map(p => (
              <tr key={p.id}>
                <td><b>{p.name}</b><span className={ui.sub}>{[p.authority, p.jurisdiction, p.reference && `Ref ${p.reference}`, p.conditions && `Conditions: ${p.conditions}`, p.owner].filter(Boolean).join(" · ")}</span></td>
                <td style={{ whiteSpace: "nowrap", color: p.expiresAt && p.expiresAt < today ? "#b0432f" : undefined }}>{p.expiresAt ? `Expires ${p.expiresAt}` : "No expiry"}<span className={ui.sub}>{p.approvedAt ? `Approved ${p.approvedAt}` : ""}</span></td>
                <td>
                  <form action={updatePermitAction} className={styles.inline}>
                    <input type="hidden" name="id" value={p.id} />
                    <select name="status" defaultValue={p.status} aria-label="Status">{Object.entries(PERMIT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="approvedAt" type="date" defaultValue={p.approvedAt ?? ""} aria-label="Approved on" />
                    <input name="expiresAt" type="date" defaultValue={p.expiresAt ?? ""} aria-label="Expires" />
                    <button className={ui.miniBtn} type="submit">Update</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a requirement</p>
          <form action={addRequirementAction} className={styles.stack}>
            <input type="hidden" name="projectId" value={projectId} />
            <label>Track<select name="track" defaultValue="host_law">{Object.entries(TRACKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Domain<select name="domain" required>{Object.entries(REGULATION_DOMAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Requirement<input name="title" required placeholder="e.g. Environmental impact authorization (MIA)" /></label>
            <label>Jurisdiction<input name="jurisdiction" placeholder="MX, MX-YUC" /></label>
            <label>Authority<input name="authority" placeholder="e.g. SEMARNAT" /></label>
            <label>Status<select name="status" defaultValue="unknown">{Object.entries(REQUIREMENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Source (rule, link)<input name="source" /></label>
            <label>Source tier<select name="sourceTier" defaultValue=""><option value="">Not set</option>{Object.entries(SOURCE_TIERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Owner<input name="owner" /></label>
            <label>Next verification<input name="nextVerification" type="date" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a permit</p>
          <form action={addPermitAction} className={styles.stack}>
            <input type="hidden" name="projectId" value={projectId} />
            <label>Permit<input name="name" required placeholder="e.g. Generation permit" /></label>
            <label>Authority<input name="authority" placeholder="e.g. CRE" /></label>
            <label>Jurisdiction<input name="jurisdiction" /></label>
            <label>Reference<input name="reference" /></label>
            <label>Status<select name="status" defaultValue="not_started">{Object.entries(PERMIT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Approved on<input name="approvedAt" type="date" /></label>
            <label>Expires<input name="expiresAt" type="date" /></label>
            <label>Conditions<input name="conditions" /></label>
            <label>Owner<input name="owner" /></label>
            <button className="btn" type="submit">Add permit</button>
          </form>
        </section>
        <ReviewsPanel subjectType="project" subjectId={projectId} back={back} scope={scope} topics={["permitting", "land_title", "environmental", "tax", "other"]} />
      </aside>
    </div>
  );
}
