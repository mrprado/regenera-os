import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { projects, tenants, workMandates, workstreams, type engagements } from "@/db/schema";
import { categoryOf } from "@/lib/commercial/metrics";
import { ENGAGEMENT_TYPES, ENTRY_POINTS, REVENUE_CATEGORIES, WORK_MANDATE_STATUSES, WORKSTREAM_KINDS, WORKSTREAM_STATUSES } from "@/lib/commercial/vocab";
import { appDb, mandateCondition, type UserScope } from "@/lib/db/scoped";
import { CLIENT_MODULES, MODULES } from "@/lib/tenancy/vocab";
import { addWorkMandateAction, addWorkstreamAction, saveDiscoveryAction, saveLifecycleAction, workMandateStatusAction, workstreamStatusAction } from "../../../engagement-chain-actions";
import s from "./lifecycle.module.css";

type Engagement = typeof engagements.$inferSelect;
const DISCOVERY: [string, string][] = [["problem", "Problem"], ["decision", "Decision they must make"], ["objective", "Objective"], ["assets", "Assets / projects involved"], ["team", "Team and decision makers"], ["currentSystems", "Current systems"], ["painPoints", "Pain points"], ["dataAvailability", "Data availability"], ["capitalSituation", "Capital situation"], ["deadline", "Deadline"], ["budget", "Budget"], ["buyingAuthority", "Buying authority"], ["urgency", "Urgency"], ["likelyScope", "Likely scope"], ["nextAction", "Next paid step"]];

/** Client → engagement → mandate → workstream (→ deliverables, below) on one engagement. */
export default async function Lifecycle({ e, scope }: { e: Engagement; scope: UserScope }) {
  const db = appDb();
  const [mands, streams, projs, ts] = await Promise.all([
    db.select().from(workMandates).where(eq(workMandates.engagementId, e.id)).orderBy(asc(workMandates.createdAt)),
    db.select().from(workstreams).where(eq(workstreams.engagementId, e.id)).orderBy(asc(workstreams.createdAt)),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
    db.select({ id: tenants.id, name: tenants.displayName }).from(tenants).where(eq(tenants.kind, "client")).orderBy(asc(tenants.displayName)),
  ]);
  const cat = categoryOf(e);
  const pName = new Map(projs.map(p => [p.id, p.name]));
  const d = e.discovery;
  return (
    <div id="lifecycle" className={s.wrap}>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Client lifecycle</span><span>{REVENUE_CATEGORIES[cat.category].label}{cat.inferred ? " (inferred: confirm)" : ""}</span></p>
        <form action={saveLifecycleAction} className={`${r.form} ${s.cols}`}>
          <input type="hidden" name="id" value={e.id} />
          <label>Engagement type<select name="engagementType" defaultValue={e.engagementType ?? ""}><option value="">—</option>{Object.entries(ENGAGEMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Revenue category<select name="revenueCategory" defaultValue={e.revenueCategory ?? ""}><option value="">Infer from type / billing</option>{Object.entries(REVENUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}{v.recurring ? " · recurring" : ""}</option>)}</select></label>
          <label>Entry point<select name="entryPoint" defaultValue={e.entryPoint ?? ""}><option value="">—</option>{Object.entries(ENTRY_POINTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Client organization (OS account)<select name="tenantId" defaultValue={e.tenantId ?? ""}><option value="">Not an OS client</option>{ts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Renewal date<input type="date" name="renewalDate" defaultValue={e.renewalDate ?? ""} /></label>
          <label>Reporting cadence<input name="reportingCadence" defaultValue={e.reportingCadence} placeholder="Biweekly working session; monthly steering" /></label>
          <label>SLA<input name="sla" defaultValue={e.sla} placeholder="Priority support, 4 h response" /></label>
          <label className={s.wide}>Success criteria<textarea name="successCriteria" rows={2} defaultValue={e.successCriteria} /></label>
          <fieldset className={`${s.checks} ${s.wide}`}><legend>OS modules included</legend>{CLIENT_MODULES.map(m => <label key={m}><input type="checkbox" name="includedModules" value={m} defaultChecked={e.includedModules.includes(m)} />{MODULES[m]}</label>)}</fieldset>
          <div className={s.wide}><button className="btn btn--primary" type="submit">Save lifecycle</button></div>
        </form>
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Discovery record</span><span>{d.recordedAt ? `recorded ${d.recordedAt.slice(0, 10)} by ${d.recordedBy}` : "not recorded"}</span></p>
        <details open={!d.recordedAt}>
          <summary className={ui.sub}>Qualification: problem, decision, budget, authority, urgency and the next paid step. Discovery itself is unpaid: keep it short.</summary>
          <form action={saveDiscoveryAction} className={`${r.form} ${s.cols}`}>
            <input type="hidden" name="id" value={e.id} />
            {DISCOVERY.map(([k, label]) => <label key={k}>{label}<textarea name={k} rows={2} defaultValue={(d as Record<string, string | undefined>)[k] ?? ""} /></label>)}
            <label>Estimated value<input name="estimatedValue" inputMode="decimal" defaultValue={d.estimatedValue ?? ""} /></label>
            <div className={s.wide}><button className="btn" type="submit">Save discovery</button></div>
          </form>
        </details>
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Mandates</span><span>defined scopes of work under this engagement</span></p>
        {mands.length === 0 ? <p className={r.empty}>No mandates yet. One engagement can hold several; one mandate can cover several projects.</p> : (
          <table className={ui.table}><thead><tr><th>Mandate</th><th>Projects</th><th>Term</th><th>Fees</th><th>Status</th></tr></thead><tbody>
            {mands.map(m => <tr key={m.id}>
              <td className={ui.primary}>{m.name}<span className={ui.sub}>{m.objective}</span>{m.exclusions && <span className={ui.sub}>Excludes: {m.exclusions}</span>}</td>
              <td className={ui.sub}>{m.projectIds.map(p => <Link key={p} href={`/projects/${p}`} style={{ display: "block" }}>{pName.get(p) ?? "Project"}</Link>)}{m.geography && <span>{m.geography}</span>}</td>
              <td className={ui.sub}>{m.startDate ?? "—"} → {m.expiryDate ?? "—"}{m.renewal ? ` · ${m.renewal}` : ""}</td>
              <td className={ui.sub}>{m.feeStructure || "—"}{m.successFee ? ` · success fee: ${m.successFee}` : ""}</td>
              <td><form action={workMandateStatusAction} className={s.inline}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="mandateRowId" value={m.id} /><select name="status" defaultValue={m.status} aria-label="Mandate status">{Object.entries(WORK_MANDATE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form></td>
            </tr>)}
          </tbody></table>)}
        <details>
          <summary className={ui.sub}>Add a mandate</summary>
          <form action={addWorkMandateAction} className={`${r.form} ${s.cols}`}>
            <input type="hidden" name="id" value={e.id} />
            <label>Name<input name="name" required placeholder="Southern California renewable development mandate" /></label>
            <label>Objective<input name="objective" /></label>
            <label>Geography<input name="geography" /></label><label>Asset type<input name="assetType" /></label>
            <label>Capital requirement<input name="capitalRequirement" placeholder="USD 50–250M institutional equity" /></label>
            <label>Owner<input name="owner" type="email" /></label>
            <label>Start<input type="date" name="startDate" /></label><label>Expiry<input type="date" name="expiryDate" /></label>
            <label>Fee structure<input name="feeStructure" /></label><label>Success fee (terms; counsel reviews legality)<input name="successFee" /></label>
            <label className={s.wide}>Scope<textarea name="scope" rows={2} /></label>
            <label>Responsibilities<textarea name="responsibilities" rows={2} /></label><label>Exclusions<textarea name="exclusions" rows={2} /></label>
            <label>Reporting<input name="reporting" /></label>
            <fieldset className={`${s.checks} ${s.wide}`}><legend>Projects</legend>{projs.map(p => <label key={p.id}><input type="checkbox" name="projectIds" value={p.id} />{p.name}</label>)}</fieldset>
            <div className={s.wide}><button className="btn" type="submit">Add mandate</button></div>
          </form>
        </details>
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Workstreams</span></p>
        {streams.length === 0 ? <p className={r.empty}>No workstreams. Split the work by domain (land, development, energy, finance, capital, community) with a lead each.</p> : (
          <table className={ui.table}><thead><tr><th>Workstream</th><th>Mandate</th><th>Lead</th><th>Due</th><th>Status</th></tr></thead><tbody>
            {streams.map(w => <tr key={w.id}><td className={ui.primary}>{w.name}<span className={ui.sub}>{WORKSTREAM_KINDS[w.kind]}{w.description ? ` · ${w.description}` : ""}</span></td><td className={ui.sub}>{mands.find(m => m.id === w.workMandateId)?.name ?? "—"}</td><td className={ui.sub}>{w.lead ?? "—"}</td><td className={ui.sub}>{w.due ?? "—"}</td>
              <td><form action={workstreamStatusAction} className={s.inline}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="workstreamId" value={w.id} /><select name="status" defaultValue={w.status} aria-label="Workstream status">{Object.entries(WORKSTREAM_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form></td></tr>)}
          </tbody></table>)}
        <form action={addWorkstreamAction} className={s.inline}>
          <input type="hidden" name="id" value={e.id} />
          <input name="name" placeholder="Workstream" required aria-label="Workstream name" />
          <select name="kind" aria-label="Kind">{Object.entries(WORKSTREAM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="workMandateId" aria-label="Mandate"><option value="">No mandate</option>{mands.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <input name="lead" placeholder="Lead" aria-label="Lead" /><input type="date" name="due" aria-label="Due" />
          <button className={ui.miniBtn} type="submit">Add</button>
        </form>
      </section>
    </div>
  );
}
