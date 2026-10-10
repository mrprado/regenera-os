import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { carePlans, communities, fundingAllocations, knowledgeRecords, projects, stewardPlaceGeometries, stewardPlaceLinks, stewardPlaces, stewardshipBudgets } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { canSeeKnowledge, currentAssessments, indicatorsFor, summariseBudget, visibleGeometry } from "@/lib/steward/engine";
import {
  ASSESSMENT_DIMENSIONS, ASSESSMENT_STATUS, CARE_PLAN_STATUS, FUNDING_STAGES, GEOMETRY_ACCURACY, KNOWLEDGE_KINDS, MEASUREMENT_KIND, OUTCOME_DIMENSIONS, PLACE_LINK_RELATIONS, PLACE_STATUS,
} from "@/lib/steward/vocab";
import { addAllocationAction, addIndicatorAction, addMeasurementAction, createBudgetAction, createCarePlanAction, linkPlaceAction, setAssessmentAction, setGeometryAction } from "../../actions";
import s from "../../steward.module.css";
import SourcesPanel from "./sources-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Place" };
const fmt = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("en-US")}`;

/** A Steward place: its boundary, who and what it connects to, its assessment, care, budget, outcomes and gaps. */
export default async function PlacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/steward/places/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [place] = await db.select().from(stewardPlaces).where(and(eq(stewardPlaces.id, id), mandateCondition(user.scope, stewardPlaces.mandateId)));
  if (!place) notFound();
  const owner = isOwner(user.scope, place.mandateId);
  const [links, versions, plans, budgets, allocations, assessments, indicators, knowledge, projs, comms] = await Promise.all([
    db.select().from(stewardPlaceLinks).where(eq(stewardPlaceLinks.placeId, id)),
    db.select().from(stewardPlaceGeometries).where(eq(stewardPlaceGeometries.placeId, id)).orderBy(desc(stewardPlaceGeometries.recordedAt)),
    db.select().from(carePlans).where(eq(carePlans.placeId, id)).orderBy(asc(carePlans.title)),
    db.select().from(stewardshipBudgets).where(eq(stewardshipBudgets.placeId, id)).orderBy(asc(stewardshipBudgets.label)),
    db.select().from(fundingAllocations).where(eq(fundingAllocations.mandateId, place.mandateId)),
    currentAssessments(db, id),
    indicatorsFor(db, id),
    db.select().from(knowledgeRecords).where(and(eq(knowledgeRecords.placeId, id), isNull(knowledgeRecords.deletedAt))),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)).limit(400),
    db.select({ id: communities.id, name: communities.name, preferredName: communities.preferredName }).from(communities).where(and(mandateCondition(user.scope, communities.mandateId), isNull(communities.deletedAt))),
  ]);
  const linkedProjects = projs.filter(p => links.some(l => l.entityType === "project" && l.entityId === p.id));
  const linkedCommunities = links.filter(l => l.entityType === "community").map(l => ({ l, c: comms.find(c => c.id === l.entityId) }));
  const sums = budgets.map(b => ({ b, s: summariseBudget(b, allocations) }));
  const visibleKnowledge = knowledge.filter(k => canSeeKnowledge(user.scope, k));
  const geometry = visibleGeometry(place, owner);

  // Gaps: what is missing, stated plainly. Missing never means fine.
  const gaps = [
    !place.geometry ? "No geometry recorded." : place.geometryAccuracy === "project_point" ? "Only a project point: area, overlap and habitat conclusions need a verified boundary." : null,
    !linkedCommunities.length ? "No community or rights-holder relationship recorded (not the same as none existing)." : null,
    !plans.length ? "No care plan." : null,
    !budgets.length ? "No stewardship budget." : null,
    !indicators.some(i => i.baseline) ? "No baseline measurement: current conditions are unknown." : null,
    ...assessments.filter(a => a.status === "not_assessed").length ? [`${assessments.filter(a => a.status === "not_assessed").length} of ${assessments.length} assessment dimensions not assessed.`] : [],
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader title={place.name} actions={<><Link className="btn" href={`/steward/places/${id}/brief`}>Steward brief</Link><Link className="btn" href="/steward?tab=places">All places</Link></>} />
      <Notice text={sp.notice} />
      <div className={s.grid}>
        <div><b>Status</b><p><span className={s.state} data-s={place.status}>{PLACE_STATUS[place.status]}</span></p></div>
        <div><b>Boundary</b><p>{GEOMETRY_ACCURACY[place.geometryAccuracy]}{place.areaHa != null ? ` · ${place.areaHa.toLocaleString("en-US")} ha (geodesic)` : geometry ? " · point, no area" : ""}{place.sensitive && !owner ? " · generalised for you" : ""}</p></div>
        <div><b>Responsible</b><p>{place.responsible ?? "Not assigned"}</p></div>
        <div><b>Location</b><p>{[place.region, place.country].filter(Boolean).join(", ") || "Not recorded"}</p></div>
      </div>

      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>Gaps to close<span>{gaps.length}</span></h2>
        {gaps.length ? <ul>{gaps.map(g => <li key={g}>{g}</li>)}</ul> : <p className={s.empty}>No structural gap recorded. Individual assessments below state their own scope.</p>}
      </section>

      <div className={s.cards} style={{ marginTop: 16 }}>
        <section className={s.card}>
          <h2>Projects<span>{linkedProjects.length}</span></h2>
          {linkedProjects.length ? <ul>{linkedProjects.map(p => <li key={p.id}><Link href={`/projects/${p.id}`}>{p.name}</Link><span>{links.filter(l => l.entityId === p.id).map(l => PLACE_LINK_RELATIONS[l.relation]).join(", ")}</span></li>)}</ul> : <p className={s.empty}>No project linked.</p>}
          <form action={linkPlaceAction} className={s.form}><input type="hidden" name="placeId" value={id} /><input type="hidden" name="entityType" value="project" /><input type="hidden" name="relation" value="project_site" />
            <label>Link a project<select name="entityId">{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div><button className="btn" type="submit">Link</button></div></form>
        </section>
        <section className={s.card}>
          <h2>Communities and rights holders<span>{linkedCommunities.length}</span></h2>
          {linkedCommunities.length ? <ul>{linkedCommunities.map(({ l, c }) => <li key={l.id}>{c ? c.preferredName || c.name : "Community not visible"}<span>{PLACE_LINK_RELATIONS[l.relation]}{l.note ? ` · ${l.note}` : ""}</span></li>)}</ul> : <p className={s.empty}>None recorded. Absence here is not evidence that no one holds rights or lives here.</p>}
          {comms.length > 0 && <form action={linkPlaceAction} className={s.form}><input type="hidden" name="placeId" value={id} /><input type="hidden" name="entityType" value="community" />
            <label>Community<select name="entityId">{comms.map(c => <option key={c.id} value={c.id}>{c.preferredName || c.name}</option>)}</select></label>
            <label>Relationship<select name="relation" defaultValue="rights_holder">{Object.entries(PLACE_LINK_RELATIONS).filter(([k]) => k !== "project_site").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className={s.wide}>Basis<input name="note" placeholder="Source of this relationship (agreement, survey, community statement)" /></label><div><button className="btn" type="submit">Link</button></div></form>}
        </section>
      </div>

      <section className={s.card} id="assessment" style={{ marginTop: 16 }}>
        <h2>Stewardship assessment<span>{assessments.filter(a => a.status !== "not_assessed").length}/{assessments.length} assessed</span></h2>
        <p className={s.empty}>Each dimension has its own status and basis. Passing selected checks does not make a project regenerative, and &quot;verified within stated scope&quot; is not an approval.</p>
        <div className={s.grid}>{assessments.map(a => <div key={a.dimension}><b>{ASSESSMENT_DIMENSIONS[a.dimension]}</b><p><span className={s.state} data-s={a.status}>{ASSESSMENT_STATUS[a.status]}</span></p>{a.basis && <p>{a.basis}{a.scope ? ` (scope: ${a.scope})` : ""}</p>}{a.assessedAt && <p>{a.assessedBy} · {a.assessedAt.slice(0, 10)}</p>}</div>)}</div>
        <form action={setAssessmentAction} className={s.form}><input type="hidden" name="placeId" value={id} />
          <label>Dimension<select name="dimension">{Object.entries(ASSESSMENT_DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Status<select name="status" defaultValue="evidence_gathering">{Object.entries(ASSESSMENT_STATUS).filter(([k]) => k !== "not_assessed").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={s.wide}>Basis (what was looked at and found)<input name="basis" required /></label>
          <label>Evidence reference<input name="evidenceRef" /></label>
          <label>Scope (required for verified)<input name="scope" /></label>
          <div><button className="btn" type="submit">Record assessment</button></div></form>
      </section>

      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>Care plans<span>{plans.length}</span></h2>
        {plans.length ? <ul>{plans.map(p => <li key={p.id}><Link href={`/steward/care/${p.id}`}>{p.title}</Link><span>{CARE_PLAN_STATUS[p.status]} · {p.owner ?? "no owner"}{p.reviewDate ? ` · review ${p.reviewDate}` : ""}</span></li>)}</ul> : <p className={s.empty}>No care plan.</p>}
        <form action={createCarePlanAction} className={s.form}><input type="hidden" name="placeId" value={id} />
          <label>Title<input name="title" required /></label><label>Owner<input name="owner" type="email" /></label><label>Review date<input name="reviewDate" type="date" /></label>
          <label className={s.wide}>Objective<input name="objective" /></label><div><button className="btn" type="submit">Create care plan</button></div></form>
      </section>

      <section className={s.card} id="budgets" style={{ marginTop: 16 }}>
        <h2>Stewardship budget<span>{budgets.length}</span></h2>
        <p className={s.empty}>Projected, committed, funded and paid are kept apart. Money in another currency is listed, never added without a dated conversion.</p>
        {sums.map(({ b, s: x }) => <div key={b.id} className={s.note}>
          <b>{b.label}</b> ({b.periodStart ?? "?"} to {b.periodEnd ?? "?"}) · <span className={s.money}>needs {fmt(x.required, x.currency)} · projected {fmt(x.byStage.projected, x.currency)} · committed {fmt(x.byStage.committed, x.currency)} · funded {fmt(x.byStage.funded, x.currency)} · paid {fmt(x.byStage.paid, x.currency)} · gap {fmt(x.gap, x.currency)}</span>
          {x.otherCurrency.length > 0 && <div className={ui.sub}>Not added (other currency): {x.otherCurrency.map(o => `${o.stage} ${fmt(o.amount, o.currency)}`).join(", ")}</div>}
          <form action={addAllocationAction} className={s.form}><input type="hidden" name="budgetId" value={b.id} />
            <label>Source<input name="source" required /></label><label>Stage<select name="stage">{Object.entries(FUNDING_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Amount<input name="amount" inputMode="decimal" required /></label><label>Currency<input name="currency" defaultValue={b.currency} maxLength={3} /></label><label>Date<input name="date" type="date" /></label>
            <label className={s.wide}>Evidence (required beyond projected)<input name="evidence" /></label><div><button className="btn" type="submit">Add funding</button></div></form>
        </div>)}
        <form action={createBudgetAction} className={s.form}><input type="hidden" name="placeId" value={id} />
          <label>Budget<input name="label" required placeholder="e.g. Year 1 restoration and monitoring" /></label><label>Required<input name="required" inputMode="decimal" required /></label>
          <label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label><label>From<input name="periodStart" type="date" /></label><label>To<input name="periodEnd" type="date" /></label>
          <label>Care plan<select name="planId" defaultValue=""><option value="">None</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          <div><button className="btn" type="submit">Add budget</button></div></form>
      </section>

      <section className={s.card} id="outcomes" style={{ marginTop: 16 }}>
        <h2>Outcomes<span>{indicators.length} indicators</span></h2>
        {indicators.map(i => <div key={i.id} className={s.note}>
          <b>{i.name}</b> · {OUTCOME_DIMENSIONS[i.dimension]} · {i.unit}{i.method ? ` · ${i.method}` : ""}<br />
          Baseline: {i.baseline ? `${i.baseline.value} ${i.unit} (${i.baseline.periodStart}, ${i.baseline.reviewStatus})` : "not measured"} · Latest: {i.latest ? `${i.latest.value} ${i.unit} (${i.latest.periodStart}, ${i.latest.reviewStatus})` : "none"} · Target: {i.target != null ? `${i.target} ${i.unit}` : i.targetNote || "not set"}
          <form action={addMeasurementAction} className={s.form}><input type="hidden" name="indicatorId" value={i.id} />
            <label>Kind<select name="kind" defaultValue={i.baseline ? "measurement" : "baseline"}>{Object.entries(MEASUREMENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Value ({i.unit})<input name="value" inputMode="decimal" required /></label><label>Observed on / from<input name="periodStart" type="date" required /></label><label>To<input name="periodEnd" type="date" /></label>
            <label>Uncertainty<input name="uncertainty" /></label><label className={s.wide}>Evidence (source, document, field record)<input name="evidence" required /></label>
            <label className={s.wide}>Limitations<input name="limitations" /></label><div><button className="btn" type="submit">Record</button></div></form>
        </div>)}
        <form action={addIndicatorAction} className={s.form}><input type="hidden" name="placeId" value={id} />
          <label>Dimension<select name="dimension">{Object.entries(OUTCOME_DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Indicator<input name="name" required /></label><label>Unit<input name="unit" required /></label><label>Method<input name="method" /></label>
          <label>Target<input name="target" inputMode="decimal" /></label><label>Frequency<input name="frequency" /></label><div><button className="btn" type="submit">Add indicator</button></div></form>
      </section>

      <SourcesPanel placeId={id} owner={owner} />

      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>Knowledge for this place<span>{visibleKnowledge.length}</span></h2>
        {visibleKnowledge.length ? <ul>{visibleKnowledge.map(k => <li key={k.id}><Link href={`/steward/knowledge/${k.id}`}>{k.accessStatus === "existence_only" ? "Culturally governed knowledge exists" : k.title}</Link><span>{KNOWLEDGE_KINDS[k.recordKind as keyof typeof KNOWLEDGE_KINDS] ?? k.recordKind}</span></li>)}</ul> : <p className={s.empty}>None you can see.</p>}
      </section>

      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>Boundary history<span>{versions.length}</span></h2>
        {versions.length ? <ul>{versions.map(v => <li key={v.id}>{GEOMETRY_ACCURACY[v.accuracy]}{v.areaHa != null ? ` · ${v.areaHa} ha` : ""}<span>{v.source || "source not stated"} · {v.recordedBy} · {v.recordedAt.slice(0, 10)}</span></li>)}</ul> : <p className={s.empty}>No boundary recorded.</p>}
        <form action={setGeometryAction} className={s.form}><input type="hidden" name="placeId" value={id} />
          <label>Accuracy<select name="accuracy">{Object.entries(GEOMETRY_ACCURACY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Source<input name="source" required /></label>
          <label className={s.wide}>GeoJSON (WGS84)<textarea name="geometry" required /></label><div><button className="btn" type="submit">Save new boundary</button></div></form>
      </section>
    </>
  );
}
