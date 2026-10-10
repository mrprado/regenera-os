import ui from "@/components/ui.module.css";
import { appDb } from "@/lib/db/scoped";
import { FINDING_DIMENSIONS, findingsFor } from "@/lib/steward/findings";
import { createFindingAction, findingStatusAction } from "../lifecycle-actions";
import s from "../steward/steward.module.css";

/** Steward findings for a project (phase 29E): each material concern with evidence, implication, action, owner and review. */
export default async function FindingsPanel({ projectId, placeIds }: { projectId: string; placeIds: string[] }) {
  const list = await findingsFor(appDb(), projectId, placeIds);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={s.card} id="findings" style={{ marginBottom: 14 }}>
      <h2>Stewardship findings<span>{list.filter(f => f.status !== "resolved").length} open</span></h2>
      <p className={s.empty}>Turn a concern into a decision: what it means for the project, what must happen, who owns it and when it is reviewed. Unknown certainty stays unknown.</p>
      {list.length > 0 && <ul>{list.map(f => (
        <li key={f.id} style={{ marginBottom: 8 }}>
          <b>{FINDING_DIMENSIONS[f.dimension as keyof typeof FINDING_DIMENSIONS] ?? f.dimension}: {f.subject}</b> · {f.status}{f.materiality === "minor" ? " · minor" : ""}
          <span className={ui.sub}>Implication: {f.implication} · Action: {f.requiredAction} · Owner: {f.owner ?? "not set"}{f.reviewDate ? <span style={{ color: f.reviewDate < today && f.status !== "resolved" ? "var(--critical)" : undefined }}> · review {f.reviewDate}</span> : ""} · uncertainty {f.uncertainty}</span>
          <span className={ui.sub}>Evidence: {f.evidence}{f.affectedParties ? ` · affects ${f.affectedParties}` : ""}{f.resolutionEvidence ? ` · resolved: ${f.resolutionEvidence}` : ""}</span>
          {f.status !== "resolved" && <details><summary className={ui.sub} style={{ cursor: "pointer" }}>Update</summary>
            <form action={findingStatusAction} className={s.form}><input type="hidden" name="findingId" value={f.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="status" value="resolved" /><label>Resolution evidence<input name="evidence" required /></label><div><button className="btn" type="submit">Resolve</button></div></form>
            {f.status === "open" && <form action={findingStatusAction} className={s.form}><input type="hidden" name="findingId" value={f.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="status" value="monitoring" /><label>Next review<input type="date" name="reviewDate" defaultValue={f.reviewDate ?? ""} required /></label><div><button className="btn" type="submit">Move to monitoring</button></div></form>}
          </details>}
        </li>
      ))}</ul>}
      <details><summary className={ui.sub} style={{ cursor: "pointer" }}>Record a finding</summary>
        <form action={createFindingAction} className={s.form}>
          <input type="hidden" name="projectId" value={projectId} />
          {placeIds[0] && <input type="hidden" name="placeId" value={placeIds[0]} />}
          <label>Dimension<select name="dimension">{Object.entries(FINDING_DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Subject<input name="subject" required /></label>
          <label>Geographic scope<input name="scope" /></label>
          <label className={s.wide}>Evidence<textarea name="evidence" required /></label>
          <label>Affected parties<input name="affectedParties" /></label>
          <label>Uncertainty<select name="uncertainty" defaultValue="unknown"><option value="unknown">Unknown</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
          <label className={s.wide}>What it means for the project<textarea name="implication" required /></label>
          <label>Required action<input name="requiredAction" required /></label>
          <label>Owner<input name="owner" /></label><label>Review date<input type="date" name="reviewDate" /></label>
          <label><span><input type="checkbox" name="minor" /> Minor (owner and review date optional)</span></label>
          <div><button className="btn btn--primary" type="submit">Record finding</button></div>
        </form>
      </details>
    </section>
  );
}
