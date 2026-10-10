import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { careActions, carePlans, knowledgeRecords, stewardPlaces, stewardshipBudgets } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { ACTIVITIES } from "@/lib/community/vocab";
import { localDate } from "@/lib/command/desk";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { canSeeKnowledge, canStartAction } from "@/lib/steward/engine";
import { CARE_ACTION_STATUS, CARE_PLAN_STATUS } from "@/lib/steward/vocab";
import { addCareActionAction, setActionStatusAction } from "../../actions";
import s from "../../steward.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Care plan" };

/** A care plan: baseline, objective and actions with owners, dates, seasons, dependencies, permissions and evidence. */
export default async function CarePlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/steward/care/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [plan] = await db.select().from(carePlans).where(and(eq(carePlans.id, id), mandateCondition(user.scope, carePlans.mandateId)));
  if (!plan) notFound();
  const [[place], actions, budgets, knowledge] = await Promise.all([
    db.select().from(stewardPlaces).where(eq(stewardPlaces.id, plan.placeId)),
    db.select().from(careActions).where(eq(careActions.planId, id)).orderBy(asc(careActions.dueDate)),
    db.select().from(stewardshipBudgets).where(eq(stewardshipBudgets.placeId, plan.placeId)),
    db.select().from(knowledgeRecords).where(and(eq(knowledgeRecords.mandateId, plan.mandateId), isNull(knowledgeRecords.deletedAt))),
  ]);
  const visibleKnowledge = knowledge.filter(k => canSeeKnowledge(user.scope, k));
  const checks = new Map(await Promise.all(actions.filter(a => a.status === "planned" || a.status === "blocked").map(async a => [a.id, await canStartAction(db, a.id)] as const)));
  const today = localDate(new Date());
  return (
    <>
      <PageHeader title={plan.title} actions={<Link className="btn" href={`/steward/places/${plan.placeId}`}>Place: {place?.name}</Link>} />
      <Notice text={sp.notice} />
      <div className={s.grid}>
        <div><b>Status</b><p>{CARE_PLAN_STATUS[plan.status]}</p></div>
        <div><b>Owner</b><p>{plan.owner ?? "Not assigned"}</p></div>
        <div><b>Review</b><p>{plan.reviewDate ?? "No review date"}</p></div>
        <div><b>Revision</b><p>{plan.revision}</p></div>
      </div>
      <div className={s.cards} style={{ marginTop: 16 }}>
        <section className={s.card}><h2>Objective</h2><p className={s.empty}>{plan.objective || "Not recorded."}</p></section>
        <section className={s.card}><h2>Baseline</h2><p className={s.empty}>{plan.baseline || "Not recorded: the starting condition is unknown."}</p></section>
        <section className={s.card}><h2>Monitoring and permissions</h2><p className={s.empty}>{plan.monitoringProtocol || "No monitoring protocol."}</p><p className={s.empty}>{plan.permissionsNote || "No permission note."}</p></section>
      </div>
      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>Actions<span>{actions.filter(a => a.status === "done").length}/{actions.length} done</span></h2>
        {actions.length === 0 ? <p className={s.empty}>No actions yet.</p> : (
          <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Action</th><th>When</th><th>Status</th><th>Update</th></tr></thead><tbody>
            {actions.map(a => {
              const c = checks.get(a.id), dep = actions.find(x => x.id === a.dependsOn);
              const overdue = a.dueDate && a.dueDate < today && a.status !== "done" && a.status !== "cancelled";
              return <tr key={a.id}>
                <td>{a.title}<span className={ui.sub}>{a.owner ?? "no owner"}{a.monitoringMethod ? ` · monitoring: ${a.monitoringMethod}` : ""}{dep ? ` · after "${dep.title}"` : ""}{a.requiresActivity ? ` · needs permission: ${ACTIVITIES[a.requiresActivity as keyof typeof ACTIVITIES]}` : ""}</span>
                  {c && !c.ok && <span className={ui.sub} style={{ color: "var(--critical)" }}>Cannot start: {c.reasons.join(" ")}</span>}
                  {a.status === "done" && <span className={ui.sub}>Evidence: {a.completionEvidence} · {a.completedBy} · {a.completedAt?.slice(0, 10)}</span>}</td>
                <td>{a.dueDate ?? "—"}<span className={ui.sub}>{a.season}</span>{overdue && <span className={s.state} data-s="overdue">Overdue</span>}</td>
                <td><span className={s.state} data-s={a.status}>{CARE_ACTION_STATUS[a.status]}</span></td>
                <td>{a.status !== "done" && a.status !== "cancelled" && <form action={setActionStatusAction} className={s.form} style={{ marginTop: 0 }}><input type="hidden" name="actionId" value={a.id} />
                  <label>Set<select name="status" defaultValue={a.status === "planned" ? "in_progress" : "done"}>{Object.entries(CARE_ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Evidence (needed for Done)<input name="evidence" /></label><div><button className="btn" type="submit">Update</button></div></form>}</td>
              </tr>;
            })}
          </tbody></table></div>
        )}
        <form action={addCareActionAction} className={s.form}><input type="hidden" name="planId" value={id} />
          <label>Action<input name="title" required /></label><label>Owner<input name="owner" type="email" /></label><label>Due<input name="dueDate" type="date" /></label>
          <label>Season<input name="season" placeholder="e.g. before the rains" /></label>
          <label>After<select name="dependsOn" defaultValue=""><option value="">No dependency</option>{actions.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
          <label>Budget<select name="budgetId" defaultValue=""><option value="">None</option>{budgets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
          <label>Needs knowledge<select name="requiresKnowledgeId" defaultValue=""><option value="">None</option>{visibleKnowledge.map(k => <option key={k.id} value={k.id}>{k.accessStatus === "existence_only" ? "Governed knowledge record" : k.title}</option>)}</select></label>
          <label>For activity<select name="requiresActivity" defaultValue=""><option value="">None</option>{Object.entries(ACTIVITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={s.wide}>Monitoring method<input name="monitoringMethod" /></label>
          <div><button className="btn btn--primary" type="submit">Add action</button></div></form>
      </section>
    </>
  );
}
