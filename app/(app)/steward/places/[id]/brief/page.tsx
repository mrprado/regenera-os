import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { careActions, carePlans, communities, fundingAllocations, knowledgeRecords, projects, stewardPlaceLinks, stewardPlaces, stewardshipBudgets } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { localDate } from "@/lib/command/desk";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { canSeeKnowledge, currentAssessments, indicatorsFor, summariseBudget } from "@/lib/steward/engine";
import { ASSESSMENT_DIMENSIONS, ASSESSMENT_STATUS, CARE_ACTION_STATUS, GEOMETRY_ACCURACY, KNOWLEDGE_KINDS, OUTCOME_DIMENSIONS, PLACE_LINK_RELATIONS } from "@/lib/steward/vocab";
import s from "../../../steward.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Steward brief" };
const fmt = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("en-US")}`;

/**
 * Steward brief (Workflow G): built only from this place's records, each line with its source, date and reviewer.
 * No AI is used. Knowledge appears only as far as the reader may see it, never its protected content.
 */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOsUser(`/steward/places/${id}/brief`);
  const db = appDb();
  const [place] = await db.select().from(stewardPlaces).where(and(eq(stewardPlaces.id, id), mandateCondition(user.scope, stewardPlaces.mandateId)));
  if (!place) notFound();
  const owner = isOwner(user.scope, place.mandateId);
  const today = localDate(new Date());
  const [links, plans, budgets, allocations, assessments, indicators, knowledge] = await Promise.all([
    db.select().from(stewardPlaceLinks).where(eq(stewardPlaceLinks.placeId, id)),
    db.select().from(carePlans).where(eq(carePlans.placeId, id)).orderBy(asc(carePlans.title)),
    db.select().from(stewardshipBudgets).where(eq(stewardshipBudgets.placeId, id)),
    db.select().from(fundingAllocations).where(eq(fundingAllocations.mandateId, place.mandateId)),
    currentAssessments(db, id), indicatorsFor(db, id),
    db.select().from(knowledgeRecords).where(and(eq(knowledgeRecords.placeId, id), isNull(knowledgeRecords.deletedAt))),
  ]);
  const actions = plans.length ? await db.select().from(careActions).where(and(eq(careActions.mandateId, place.mandateId))).orderBy(asc(careActions.dueDate)) : [];
  const projIds = links.filter(l => l.entityType === "project").map(l => l.entityId), commIds = links.filter(l => l.entityType === "community").map(l => l.entityId);
  const [projs, comms] = await Promise.all([
    projIds.length ? db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId))) : Promise.resolve([]),
    commIds.length ? db.select({ id: communities.id, name: communities.name, preferredName: communities.preferredName, representationVerified: communities.representationVerified }).from(communities).where(mandateCondition(user.scope, communities.mandateId)) : Promise.resolve([]),
  ]);
  const planActions = (planId: string) => actions.filter(a => a.planId === planId);
  const overdue = actions.filter(a => plans.some(p => p.id === a.planId) && a.dueDate && a.dueDate < today && a.status !== "done" && a.status !== "cancelled");
  const visibleKnowledge = knowledge.filter(k => canSeeKnowledge(user.scope, k));
  const missing = [
    place.geometryAccuracy === "project_point" || !place.geometry ? "Verified boundary" : null,
    ...assessments.filter(a => a.status === "not_assessed").map(a => `Assessment: ${ASSESSMENT_DIMENSIONS[a.dimension]}`),
    ...indicators.filter(i => !i.baseline).map(i => `Baseline for ${i.name}`),
    ...indicators.filter(i => i.latest && i.latest.reviewStatus !== "reviewed").map(i => `Review of the latest ${i.name} measurement`),
    !budgets.length ? "Stewardship budget" : null,
    !commIds.length ? "Community and rights-holder relationships (none recorded is not none existing)" : null,
  ].filter(Boolean) as string[];

  return (
    <article style={{ maxWidth: 900 }}>
      <p className={s.noPrint}><Link href={`/steward/places/${id}`}>Back to place</Link> · Print this page to save it as PDF.</p>
      <h1 style={{ margin: "0 0 4px" }}>Steward brief: {place.name}</h1>
      <p className={s.empty}>Prepared {today} by {user.email} from Regenera OS records. No AI was used; every statement below is a record with its source. Unknowns are listed as unknown.</p>

      <h2>Place</h2>
      <p>{GEOMETRY_ACCURACY[place.geometryAccuracy]}{place.areaHa != null ? `, ${place.areaHa} ha (geodesic)` : place.geometry ? ", point only (no area)" : ", no geometry"}. {[place.region, place.country].filter(Boolean).join(", ")}. Responsible: {place.responsible ?? "not assigned"}.</p>
      <p>Projects: {projs.filter(p => projIds.includes(p.id)).map(p => p.name).join(", ") || "none linked"}.</p>
      <p>Communities and rights holders: {commIds.length ? links.filter(l => l.entityType === "community").map(l => { const c = comms.find(x => x.id === l.entityId); return c ? `${c.preferredName || c.name} (${PLACE_LINK_RELATIONS[l.relation]}${c.representationVerified ? "" : ", representation unverified"}${l.note ? `; basis: ${l.note}` : ""})` : "a community not visible to you"; }).join("; ") : "none recorded"}.</p>

      <h2>Assessment by dimension</h2>
      <ul>{assessments.map(a => <li key={a.dimension}><b>{ASSESSMENT_DIMENSIONS[a.dimension]}</b>: {ASSESSMENT_STATUS[a.status]}{a.basis ? `. ${a.basis}` : ""}{a.scope ? ` (scope: ${a.scope})` : ""}{a.evidenceRef ? ` [evidence: ${a.evidenceRef}]` : ""}{a.assessedAt ? ` (${a.assessedBy}, ${a.assessedAt.slice(0, 10)})` : ""}</li>)}</ul>

      <h2>Outcomes</h2>
      {indicators.length ? <ul>{indicators.map(i => <li key={i.id}><b>{i.name}</b> ({OUTCOME_DIMENSIONS[i.dimension]}, {i.unit}{i.method ? `, ${i.method}` : ""}): baseline {i.baseline ? `${i.baseline.value} on ${i.baseline.periodStart} [${i.baseline.evidence}; ${i.baseline.reviewStatus}]` : "not measured"}; latest {i.latest ? `${i.latest.value} on ${i.latest.periodStart} [${i.latest.evidence}; ${i.latest.reviewStatus}${i.latest.uncertainty ? `; ±${i.latest.uncertainty}` : ""}]` : "none"}; target {i.target != null ? i.target : i.targetNote || "not set"}{i.latest?.limitations ? `. Limitations: ${i.latest.limitations}` : ""}</li>)}</ul> : <p>No indicators recorded.</p>}

      <h2>Care</h2>
      {plans.length ? plans.map(p => <div key={p.id}><p><b>{p.title}</b> ({p.status}, owner {p.owner ?? "none"}, review {p.reviewDate ?? "not set"}). Objective: {p.objective || "not recorded"}. Baseline: {p.baseline || "not recorded"}.</p>
        <ul>{planActions(p.id).map(a => <li key={a.id}>{a.title}: {CARE_ACTION_STATUS[a.status]}{a.dueDate ? `, due ${a.dueDate}` : ""}{a.status === "done" ? ` [evidence: ${a.completionEvidence}]` : ""}</li>)}</ul></div>) : <p>No care plan.</p>}

      <h2>Funding</h2>
      {budgets.length ? <ul>{budgets.map(b => { const x = summariseBudget(b, allocations); return <li key={b.id}><b>{b.label}</b>: needs {fmt(x.required, x.currency)}; projected {fmt(x.byStage.projected, x.currency)}, committed {fmt(x.byStage.committed, x.currency)}, funded {fmt(x.byStage.funded, x.currency)}, paid {fmt(x.byStage.paid, x.currency)}; gap {fmt(x.gap, x.currency)}{x.otherCurrency.length ? `. Not added (other currency): ${x.otherCurrency.map(o => fmt(o.amount, o.currency)).join(", ")}` : ""}.</li>; })}</ul> : <p>No budget recorded.</p>}

      <h2>Knowledge</h2>
      {visibleKnowledge.length ? <ul>{visibleKnowledge.map(k => <li key={k.id}>{k.accessStatus === "existence_only" ? "Culturally governed knowledge exists; consultation with its custodian is required" : `${k.title} (${KNOWLEDGE_KINDS[k.recordKind as keyof typeof KNOWLEDGE_KINDS] ?? k.recordKind})`}{k.withdrawn ? ", permissions withdrawn" : ""}</li>)}</ul> : <p>No knowledge record visible to you for this place.</p>}
      {!owner && <p className={s.empty}>Some records may be restricted and are not shown or counted here.</p>}

      <h2>Unresolved</h2>
      {overdue.length ? <ul>{overdue.map(a => <li key={a.id}>Overdue: {a.title} (due {a.dueDate}, owner {a.owner ?? "none"})</li>)}</ul> : <p>No overdue care action.</p>}

      <h2>Missing evidence</h2>
      {missing.length ? <ul>{missing.map(m => <li key={m}>{m}</li>)}</ul> : <p>None listed by the OS; the scope of each assessment above still applies.</p>}
    </article>
  );
}
