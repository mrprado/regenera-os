import Link from "next/link";
import { and, eq, inArray, isNull } from "drizzle-orm";
import ui from "@/components/ui.module.css";
import { careActions, carePlans, communities, consentRecords, fundingAllocations, stewardshipBudgets } from "@/db/schema";
import { CONSENT_STATUS } from "@/lib/community/vocab";
import { appDb, type Scope } from "@/lib/db/scoped";
import { currentAssessments, indicatorsFor, placesForProject, summariseBudget } from "@/lib/steward/engine";
import { ASSESSMENT_DIMENSIONS, ASSESSMENT_STATUS, GEOMETRY_ACCURACY } from "@/lib/steward/vocab";
import { createPlaceAction } from "../steward/actions";
import s from "../steward/steward.module.css";

const fmt = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("en-US")}`;

/**
 * A project's Steward view (phase 28D): the places it belongs to, community and consent context, care, costs and outcomes,
 * with gaps stated. Funding a project does not imply consent or ecological clearance, and nothing here values credits.
 */
export default async function StewardTab({ project, scope }: { project: { id: string; name: string; mandateId: string }; scope: Scope }) {
  const db = appDb();
  const places = (await placesForProject(db, project.id)).map(x => x.place);
  const [comms, consents] = await Promise.all([
    db.select().from(communities).where(and(eq(communities.projectId, project.id), isNull(communities.deletedAt))),
    db.select().from(consentRecords).where(eq(consentRecords.projectId, project.id)),
  ]);
  if (!places.length) return (
    <section className={s.card}>
      <h2>No Steward place for this project</h2>
      <p className={s.lede}>Steward keeps the long-term care of the place: who holds rights there, governed knowledge, the care plan, its budget and the outcomes measured. Create the place from this project: its recorded boundary is used, or its point is kept as a point (no area conclusions).</p>
      <form action={createPlaceAction}><input type="hidden" name="projectId" value={project.id} /><button className="btn btn--primary" type="submit">Create place from this project</button></form>
      <p className={s.empty} style={{ marginTop: 10 }}>Communities recorded for this project: {comms.length}. Consent processes: {consents.length ? consents.map(c => CONSENT_STATUS[c.status as keyof typeof CONSENT_STATUS]).join(", ") : "none recorded"}.</p>
    </section>
  );
  const ids = places.map(p => p.id);
  const [plans, budgets, allocations] = await Promise.all([
    db.select().from(carePlans).where(inArray(carePlans.placeId, ids)),
    db.select().from(stewardshipBudgets).where(inArray(stewardshipBudgets.placeId, ids)),
    db.select().from(fundingAllocations).where(eq(fundingAllocations.mandateId, project.mandateId)),
  ]);
  const actions = plans.length ? await db.select().from(careActions).where(inArray(careActions.planId, plans.map(p => p.id))) : [];
  void scope;
  return (
    <>
      <p className={s.note}>Funding or capital readiness never implies consent or ecological clearance. Each place below states its own evidence and gaps.</p>
      {await Promise.all(places.map(async place => {
        const [assess, inds] = await Promise.all([currentAssessments(db, place.id), indicatorsFor(db, place.id)]);
        const myPlans = plans.filter(p => p.placeId === place.id), myBudgets = budgets.filter(b => b.placeId === place.id);
        const sums = myBudgets.map(b => summariseBudget(b, allocations));
        const open = actions.filter(a => myPlans.some(p => p.id === a.planId) && a.status !== "done" && a.status !== "cancelled");
        const notAssessed = assess.filter(a => a.status === "not_assessed").length;
        const flagged = assess.filter(a => a.status === "action_required" || a.status === "condition_identified");
        return (
          <section key={place.id} className={s.card} style={{ marginBottom: 14 }}>
            <h2><Link href={`/steward/places/${place.id}`}>{place.name}</Link><span>{GEOMETRY_ACCURACY[place.geometryAccuracy]}</span></h2>
            <div className={s.grid}>
              <div><b>Assessment</b><p>{assess.length - notAssessed}/{assess.length} dimensions assessed</p>{flagged.map(a => <p key={a.dimension}>{ASSESSMENT_DIMENSIONS[a.dimension]}: {ASSESSMENT_STATUS[a.status]}</p>)}</div>
              <div><b>Care</b><p>{myPlans.length} plan{myPlans.length === 1 ? "" : "s"} · {open.length} open action{open.length === 1 ? "" : "s"}</p></div>
              <div><b>Stewardship costs</b>{sums.length ? sums.map(x => <p key={x.budgetId}>Needs {fmt(x.required, x.currency)} · secured {fmt(x.secured, x.currency)} · gap {fmt(x.gap, x.currency)}</p>) : <p>No budget: long-term care is unfunded until one is recorded.</p>}</div>
              <div><b>Outcomes</b><p>{inds.length} indicator{inds.length === 1 ? "" : "s"} · {inds.filter(i => i.baseline).length} with a baseline</p></div>
              <div><b>Community and consent</b><p>{comms.length} communit{comms.length === 1 ? "y" : "ies"} recorded · {consents.length ? consents.map(c => CONSENT_STATUS[c.status as keyof typeof CONSENT_STATUS]).join(", ") : "no consent process recorded"}</p></div>
            </div>
            <p className={ui.sub} style={{ marginTop: 8 }}><Link href={`/steward/places/${place.id}`}>Open place</Link> · <Link href={`/steward/places/${place.id}/brief`}>Steward brief</Link> · <Link href={`/projects/${project.id}?tab=community`}>Community tab</Link></p>
          </section>
        );
      }))}
    </>
  );
}

/** Capital readiness view of stewardship (phase 28D): costs and evidence gaps, never a clearance. */
export async function StewardReadiness({ projectId, mandateId }: { projectId: string; mandateId: string }) {
  const db = appDb();
  const places = (await placesForProject(db, projectId)).map(x => x.place);
  const [consents, budgets, allocations, plans] = await Promise.all([
    db.select({ status: consentRecords.status }).from(consentRecords).where(eq(consentRecords.projectId, projectId)),
    places.length ? db.select().from(stewardshipBudgets).where(inArray(stewardshipBudgets.placeId, places.map(p => p.id))) : Promise.resolve([]),
    db.select().from(fundingAllocations).where(eq(fundingAllocations.mandateId, mandateId)),
    places.length ? db.select({ id: carePlans.id }).from(carePlans).where(inArray(carePlans.placeId, places.map(p => p.id))) : Promise.resolve([]),
  ]);
  const gaps = [
    !places.length ? "No Steward place: long-term care, rights holders and outcomes are not recorded." : null,
    places.length && !plans.length ? "No care plan." : null,
    places.length && !budgets.length ? "No stewardship budget: operating care costs are unknown." : null,
    !consents.length ? "No consent process recorded (not the same as consent not being needed)." : null,
    places.some(p => p.geometryAccuracy === "project_point" || !p.geometry) ? "No verified boundary for at least one place." : null,
  ].filter(Boolean) as string[];
  const sums = budgets.map(b => summariseBudget(b, allocations));
  return (
    <section className={s.card} style={{ margin: "0 0 16px" }}>
      <h2>Stewardship readiness<span>{gaps.length} gap{gaps.length === 1 ? "" : "s"}</span></h2>
      <p className={s.empty}>Long-term care costs and evidence gaps investors will ask about. Funding does not imply consent or ecological clearance; nothing here values ecosystem services or credits.</p>
      {sums.map(x => <p key={x.budgetId} className={s.note}>Stewardship budget: needs {fmt(x.required, x.currency)}, secured {fmt(x.secured, x.currency)}, gap {fmt(x.gap, x.currency)}.</p>)}
      {gaps.length ? <ul>{gaps.map(g => <li key={g}>{g}</li>)}</ul> : null}
      <p className={ui.sub}><Link href={`/projects/${projectId}?tab=steward`}>Open the Steward tab</Link></p>
    </section>
  );
}
