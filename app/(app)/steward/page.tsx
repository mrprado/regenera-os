import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { careActions, carePlans, communities, communityAuthorities, consentRecords, knowledgeRecords, projects, stewardIndicators, stewardMeasurements, stewardPlaceLinks, stewardPlaces } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { localDate } from "@/lib/command/desk";
import { ACCESS_STATUS, COMMUNITY_TYPES, CONSENT_STATUS, KNOWLEDGE_CATEGORIES } from "@/lib/community/vocab";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { canSeeKnowledge, stewardOverview } from "@/lib/steward/engine";
import { placeSourceStates } from "@/lib/steward/sources/pipeline";
import { DATA_STATES } from "@/lib/steward/vocab";
import { CARE_PLAN_STATUS, GEOMETRY_ACCURACY, KNOWLEDGE_KINDS, KNOWLEDGE_TRADITIONS, OUTCOME_DIMENSIONS, PLACE_STATUS } from "@/lib/steward/vocab";
import { createCarePlanAction, createKnowledgeAction, createPlaceAction } from "./actions";
import s from "./steward.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Steward" };

const TABS = [["overview", "Overview"], ["places", "Places"], ["knowledge", "Knowledge"], ["community", "Community"], ["care", "Care"], ["outcomes", "Outcomes"]] as const;
type Tab = (typeof TABS)[number][0];
const fmt = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("en-US")}`;

/** Steward (phase 28A): the ongoing care of places and relationships, from persisted records only. */
export default async function StewardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/steward");
  const sp = await searchParams;
  const tab = (TABS.some(([k]) => k === sp.tab) ? sp.tab : "overview") as Tab;
  return (
    <>
      <PageHeader title="Steward" />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Steward views">{TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} aria-current={tab === k ? "page" : undefined} href={k === "overview" ? "/steward" : `/steward?tab=${k}`}>{l}</Link>)}</nav>
      {tab === "overview" && <Overview scope={user.scope} />}
      {tab === "places" && <Places scope={user.scope} />}
      {tab === "knowledge" && <Knowledge scope={user.scope} />}
      {tab === "community" && <Community scope={user.scope} />}
      {tab === "care" && <Care scope={user.scope} />}
      {tab === "outcomes" && <Outcomes scope={user.scope} />}
    </>
  );
}

type Scope = Awaited<ReturnType<typeof requireOsUser>>["scope"];

function Card({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return <section className={s.card}><h2>{title}<span>{count}</span></h2>{count ? <ul>{children}</ul> : <p className={s.empty}>{empty}</p>}</section>;
}

async function Overview({ scope }: { scope: Scope }) {
  const today = localDate(new Date());
  const o = await stewardOverview(appDb(), scope, today);
  // Data coverage: for each place, enabled automated sources that were never queried, failed, or are stale.
  const coverage = (await Promise.all(o.places.slice(0, 40).map(async p => ({ p, states: (await placeSourceStates(appDb(), p.id)).filter(x => x.source.enabled && x.source.accessMethod === "api" && ["not_queried", "failed", "stale", "insufficient"].includes(x.state)) })))).filter(x => x.states.length);
  if (!o.places.length) return (
    <section className={s.card}>
      <h2>Start with a place</h2>
      <p className={s.lede}>Steward tracks the places Regenera is responsible for: who holds rights there, what knowledge may be used and how, the care plan, its budget and the outcomes measured. Nothing here is generated; every item is a record someone entered or a source returned.</p>
      <Link className="btn btn--primary" href="/steward?tab=places">Create the first place</Link>
    </section>
  );
  return (
    <>
      <p className={s.lede}>What needs attention across your places, from actual records. Counts only include what you are allowed to see.</p>
      <div className={s.cards}>
        <Card title="Overdue care actions" count={o.overdueActions.length} empty="No care action is overdue.">
          {o.overdueActions.map(x => <li key={x.a.id}><Link href={`/steward/care/${x.a.planId}`}>{x.a.title}</Link><span>{x.plan} · due {x.a.dueDate} · {x.a.owner ?? "no owner"}</span></li>)}
        </Card>
        <Card title="Care in the next 30 days" count={o.upcomingActions.length} empty="Nothing scheduled in the next 30 days.">
          {o.upcomingActions.map(x => <li key={x.a.id}><Link href={`/steward/care/${x.a.planId}`}>{x.a.title}</Link><span>{x.plan} · {x.a.dueDate}{x.a.season ? ` · ${x.a.season}` : ""}</span></li>)}
        </Card>
        <Card title="Commitments due" count={o.commitments.length + o.obligations.length} empty="No commitment or obligation due in the next 30 days.">
          {o.commitments.map(c => <li key={c.id}><Link href={`/projects/${c.projectId}?tab=community&sec=commitments`}>{c.description.slice(0, 90)}</Link><span>Community commitment · due {c.dueDate} · {c.owner ?? "no owner"}</span></li>)}
          {o.obligations.map(b => <li key={b.id}><Link href={`/projects/${b.projectId}?tab=capital#integrity`}>{b.title}</Link><span>Stewardship obligation · {b.status} · due {b.dueAt?.slice(0, 10)}</span></li>)}
        </Card>
        <Card title="Consent and permission reviews" count={o.consentReviews.length + o.knowledgeReviews.length} empty="No consent or knowledge permission review due in the next 30 days.">
          {o.consentReviews.map(c => <li key={c.id}><Link href={`/projects/${c.projectId}?tab=community&sec=consent`}>Consent review: {CONSENT_STATUS[c.status as keyof typeof CONSENT_STATUS]}</Link><span>Review {c.reviewDate}</span></li>)}
          {o.knowledgeReviews.map(k => <li key={k.id}><Link href={`/steward/knowledge/${k.id}`}>Knowledge permission review</Link><span>Review {k.reviewDate}</span></li>)}
        </Card>
        <Card title="Places needing a baseline" count={o.needsBaseline.length} empty="Every place has at least one baseline measurement.">
          {o.needsBaseline.map(p => <li key={p.id}><Link href={`/steward/places/${p.id}#outcomes`}>{p.name}</Link><span>No baseline recorded: conditions are unknown, not assumed fine.</span></li>)}
        </Card>
        <Card title="Stewardship budget gaps" count={o.budgetGaps.length} empty="No budget with a funding gap.">
          {o.budgetGaps.map(({ b, s: sum }) => <li key={b.id}><Link href={`/steward/places/${b.placeId}#budgets`}>{b.label}</Link><span className={s.money}>Needs {fmt(sum.required, sum.currency)} · secured {fmt(sum.secured, sum.currency)} · gap {fmt(sum.gap, sum.currency)}</span></li>)}
        </Card>
        <Card title="Data coverage and freshness" count={coverage.length} empty="Every place has a current result from each enabled source.">
          {coverage.map(({ p, states }) => <li key={p.id}><Link href={`/steward/places/${p.id}#sources`}>{p.name}</Link><span>{states.map(x => `${x.source.name}: ${DATA_STATES[x.state].toLowerCase()}`).join(" · ")}</span></li>)}
        </Card>
        {o.canSeeGrievances && (
          <Card title="Unresolved grievances" count={o.grievances.length} empty="No unresolved grievance.">
            {o.grievances.map(g => <li key={g.id}><Link href={`/projects/${g.projectId}?tab=community&sec=grievances`}>{g.category || "Grievance"}</Link><span>Received {g.received} · {g.status}</span></li>)}
          </Card>
        )}
      </div>
    </>
  );
}

async function Places({ scope }: { scope: Scope }) {
  const db = appDb();
  const [places, projs, links] = await Promise.all([
    db.select().from(stewardPlaces).where(mandateCondition(scope, stewardPlaces.mandateId)).orderBy(asc(stewardPlaces.name)),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)).limit(400),
    db.select().from(stewardPlaceLinks).where(mandateCondition(scope, stewardPlaceLinks.mandateId)),
  ]);
  return (
    <>
      {places.length === 0 ? <p className={s.lede}>No places yet. A place can come from a project (its recorded boundary, or its point labelled as a point) or from a boundary you paste.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Place</th><th>Boundary</th><th>Status</th><th>Linked</th></tr></thead>
          <tbody>{places.map(p => <tr key={p.id}>
            <td><Link href={`/steward/places/${p.id}`}>{p.name}</Link><span className={ui.sub}>{[p.region, p.country].filter(Boolean).join(", ")}</span></td>
            <td>{GEOMETRY_ACCURACY[p.geometryAccuracy]}<span className={ui.sub}>{p.areaHa != null ? `${p.areaHa.toLocaleString("en-US")} ha (geodesic)` : p.geometry ? "Point: no area" : "No geometry"}</span></td>
            <td><span className={s.state} data-s={p.status}>{PLACE_STATUS[p.status]}</span></td>
            <td>{links.filter(l => l.placeId === p.id && l.entityType === "project").length} projects · {links.filter(l => l.placeId === p.id && l.entityType === "community").length} communities</td>
          </tr>)}</tbody>
        </table></div>
      )}
      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>New place</h2>
        <form action={createPlaceAction} className={s.form}>
          <label>From a project<select name="projectId" defaultValue=""><option value="">None (enter below)</option>{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Name<input name="name" placeholder="Not needed when created from a project" /></label>
          <label>Country<input name="country" /></label>
          <label>Responsible person<input name="responsible" type="email" placeholder="email" /></label>
          <label>Boundary accuracy<select name="accuracy" defaultValue="unknown">{Object.entries(GEOMETRY_ACCURACY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Boundary source<input name="geometrySource" placeholder="Survey, plan, digitised from imagery…" /></label>
          <label className={`${s.wide}`}>Boundary (GeoJSON Point, Polygon or MultiPolygon in WGS84, optional)<textarea name="geometry" placeholder='{"type":"Polygon","coordinates":[[[-89.6,20.9],…]]}' /></label>
          <label className={`${s.check} ${s.wide}`}><input type="checkbox" name="sensitive" /> Sensitive location: show only a generalised point to non-owners</label>
          <label className={s.wide}>Description<input name="description" /></label>
          <div><button className="btn btn--primary" type="submit">Create place</button></div>
        </form>
        <p className={s.note}>A project point is kept as a point: area-based conclusions need a verified boundary. Areas are geodesic (on the ellipsoid), never from degrees.</p>
      </section>
    </>
  );
}

async function Knowledge({ scope }: { scope: Scope }) {
  const db = appDb();
  const [rows, comms, places] = await Promise.all([
    db.select().from(knowledgeRecords).where(and(mandateCondition(scope, knowledgeRecords.mandateId), isNull(knowledgeRecords.deletedAt))).orderBy(desc(knowledgeRecords.createdAt)).limit(300),
    db.select({ id: communities.id, name: communities.name }).from(communities).where(and(mandateCondition(scope, communities.mandateId), isNull(communities.deletedAt))).orderBy(asc(communities.name)),
    db.select({ id: stewardPlaces.id, name: stewardPlaces.name }).from(stewardPlaces).where(mandateCondition(scope, stewardPlaces.mandateId)).orderBy(asc(stewardPlaces.name)),
  ]);
  const visible = rows.filter(r => canSeeKnowledge(scope, r));
  return (
    <>
      <p className={s.lede}>Knowledge shared through authorised relationships, published references, field observations and interpretations, kept apart by kind. Use follows recorded permissions per activity; AI use, publication and model training are prohibited unless a custodian has allowed them. You see only records you are allowed to know exist.</p>
      {visible.length === 0 ? <p className={s.empty}>No knowledge records you can see.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Record</th><th>Kind</th><th>Access</th><th>Review</th></tr></thead>
          <tbody>{visible.map(r => {
            const existence = r.accessStatus === "existence_only";
            return <tr key={r.id}>
              <td><Link href={`/steward/knowledge/${r.id}`}>{existence ? "Culturally governed knowledge exists" : r.title}</Link><span className={ui.sub}>{KNOWLEDGE_CATEGORIES[r.category as keyof typeof KNOWLEDGE_CATEGORIES]}</span></td>
              <td>{KNOWLEDGE_KINDS[r.recordKind as keyof typeof KNOWLEDGE_KINDS] ?? r.recordKind}<span className={ui.sub}>{KNOWLEDGE_TRADITIONS[r.tradition as keyof typeof KNOWLEDGE_TRADITIONS] ?? ""}</span></td>
              <td>{ACCESS_STATUS[r.accessStatus as keyof typeof ACCESS_STATUS]}{r.withdrawn ? <span className={ui.sub}>Withdrawn</span> : null}</td>
              <td>{r.reviewDate ?? "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      )}
      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>New knowledge record</h2>
        <form action={createKnowledgeAction} className={s.form}>
          <label>Title<input name="title" required /></label>
          <label>Kind<select name="recordKind" defaultValue="community_held">{Object.entries(KNOWLEDGE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Tradition<select name="tradition" defaultValue="indigenous_local">{Object.entries(KNOWLEDGE_TRADITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Category<select name="category" defaultValue="ecological">{Object.entries(KNOWLEDGE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Community (required for community-held)<select name="communityId" defaultValue=""><option value="">None</option>{comms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Place<select name="placeId" defaultValue=""><option value="">None</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Access<select name="accessStatus" defaultValue="restricted">{Object.entries(ACCESS_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Individual contributor<input name="contributor" /></label>
          <label>Original language<input name="originalLanguage" /></label>
          <label>Review date<input name="reviewDate" type="date" /></label>
          <label className={s.wide}>Evidence of authority to share (who decided, how, when)<input name="authorityEvidence" /></label>
          <label className={s.wide}>Permitted purpose<input name="permittedPurpose" placeholder="e.g. restoration planning for this place only" /></label>
          <label className={s.wide}>Permitted users (emails, optional)<input name="permittedUsers" /></label>
          <label>Compensation<input name="compensation" /></label>
          <label>Benefit sharing<input name="benefitSharing" /></label>
          <label className={s.wide}>Translation provenance<input name="translationProvenance" /></label>
          <label className={s.wide}>Description others may see (leave blank for existence-only)<input name="descriptionPublic" /></label>
          <label className={`${s.check} ${s.wide}`}><input type="checkbox" name="existenceOnly" /> Existence only: record that consultation with the custodian is required, without storing the knowledge</label>
          <div><button className="btn btn--primary" type="submit">Create record</button></div>
        </form>
      </section>
    </>
  );
}

async function Community({ scope }: { scope: Scope }) {
  const db = appDb();
  const rows = await db.select().from(communities).where(and(mandateCondition(scope, communities.mandateId), isNull(communities.deletedAt))).orderBy(asc(communities.name));
  const ids = rows.map(r => r.id);
  const [auths, consents] = ids.length ? await Promise.all([
    db.select({ communityId: communityAuthorities.communityId, n: communityAuthorities.id }).from(communityAuthorities).where(inArray(communityAuthorities.communityId, ids)),
    db.select({ communityId: consentRecords.communityId, status: consentRecords.status }).from(consentRecords).where(inArray(consentRecords.communityId, ids)),
  ]) : [[], []];
  return (
    <>
      <p className={s.lede}>Communities as institutions with their own governance, not contacts. Representation and authority stay unverified until verified with evidence; a job title or a database entry never grants authority to consent. Community bodies are never put into outreach.</p>
      {rows.length === 0 ? <p className={s.empty}>No communities recorded. Communities are recorded on a project&apos;s Community tab, where their authorities, rights, consent and commitments are managed.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Community</th><th>Representation</th><th>Governance bodies</th><th>Consent</th></tr></thead>
          <tbody>{rows.map(c => <tr key={c.id}>
            <td>{c.projectId ? <Link href={`/projects/${c.projectId}?tab=community&sec=communities`}>{c.preferredName || c.name}</Link> : c.preferredName || c.name}<span className={ui.sub}>{COMMUNITY_TYPES[c.communityType as keyof typeof COMMUNITY_TYPES]}{c.languagePrimary ? ` · ${c.languagePrimary}` : ""}</span></td>
            <td>{c.representativeBody || "Not recorded"}<span className={ui.sub}>{c.representationVerified ? "Verified" : "Unverified"} · authority {c.authorityVerified ? "verified" : "unverified"}</span></td>
            <td>{auths.filter(a => a.communityId === c.id).length}</td>
            <td>{consents.filter(x => x.communityId === c.id).map(x => CONSENT_STATUS[x.status as keyof typeof CONSENT_STATUS]).join(", ") || "No consent process recorded"}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

async function Care({ scope }: { scope: Scope }) {
  const db = appDb();
  const [plans, places, actions] = await Promise.all([
    db.select({ p: carePlans, place: stewardPlaces.name }).from(carePlans).innerJoin(stewardPlaces, eq(stewardPlaces.id, carePlans.placeId)).where(mandateCondition(scope, carePlans.mandateId)).orderBy(asc(carePlans.status), asc(carePlans.title)),
    db.select({ id: stewardPlaces.id, name: stewardPlaces.name }).from(stewardPlaces).where(mandateCondition(scope, stewardPlaces.mandateId)).orderBy(asc(stewardPlaces.name)),
    db.select({ planId: careActions.planId, status: careActions.status, dueDate: careActions.dueDate }).from(careActions).where(mandateCondition(scope, careActions.mandateId)),
  ]);
  const today = localDate(new Date());
  return (
    <>
      {plans.length === 0 ? <p className={s.lede}>No care plans yet. A plan sets the baseline and objectives for a place, then actions with owners, dates, seasons, dependencies, permissions, budget, monitoring and completion evidence.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Plan</th><th>Status</th><th>Actions</th><th>Review</th></tr></thead>
          <tbody>{plans.map(({ p, place }) => {
            const mine = actions.filter(a => a.planId === p.id), open = mine.filter(a => a.status !== "done" && a.status !== "cancelled");
            const overdue = open.filter(a => a.dueDate && a.dueDate < today).length;
            return <tr key={p.id}>
              <td><Link href={`/steward/care/${p.id}`}>{p.title}</Link><span className={ui.sub}>{place} · {p.owner ?? "no owner"}</span></td>
              <td><span className={s.state} data-s={p.status}>{CARE_PLAN_STATUS[p.status]}</span></td>
              <td>{mine.length - open.length}/{mine.length} done{overdue ? <span className={s.state} data-s="overdue" style={{ marginLeft: 6 }}>{overdue} overdue</span> : null}</td>
              <td>{p.reviewDate ?? "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      )}
      {places.length > 0 ? (
        <section className={s.card} style={{ marginTop: 16 }}>
          <h2>New care plan</h2>
          <form action={createCarePlanAction} className={s.form}>
            <label>Place<select name="placeId" required>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Title<input name="title" required /></label>
            <label>Owner<input name="owner" type="email" /></label>
            <label>Start<input name="startDate" type="date" /></label>
            <label>Review<input name="reviewDate" type="date" /></label>
            <label className={s.wide}>Objective<input name="objective" /></label>
            <label className={s.wide}>Baseline (what is known now, with sources)<input name="baseline" /></label>
            <label className={s.wide}>Monitoring protocol<input name="monitoringProtocol" /></label>
            <label className={s.wide}>Permissions needed<input name="permissionsNote" placeholder="Consent, knowledge permissions, access agreements" /></label>
            <div><button className="btn btn--primary" type="submit">Create plan</button></div>
          </form>
        </section>
      ) : <p className={s.empty}>Create a place first: every care plan belongs to a place.</p>}
    </>
  );
}

async function Outcomes({ scope }: { scope: Scope }) {
  const db = appDb();
  const inds = await db.select({ i: stewardIndicators, place: stewardPlaces.name }).from(stewardIndicators).innerJoin(stewardPlaces, eq(stewardPlaces.id, stewardIndicators.placeId)).where(mandateCondition(scope, stewardIndicators.mandateId)).orderBy(asc(stewardIndicators.dimension), asc(stewardIndicators.name));
  const ms = inds.length ? await db.select().from(stewardMeasurements).where(inArray(stewardMeasurements.indicatorId, inds.map(x => x.i.id))).orderBy(asc(stewardMeasurements.periodStart)) : [];
  return (
    <>
      <p className={s.lede}>Ecological, community, cultural, operational and financial outcomes, each in its own unit and never combined into a score. Baselines and measurements carry their method, period, uncertainty, evidence and reviewer.</p>
      {inds.length === 0 ? <p className={s.empty}>No indicators yet. Add them on a place.</p> : (Object.keys(OUTCOME_DIMENSIONS) as (keyof typeof OUTCOME_DIMENSIONS)[]).map(d => {
        const rows = inds.filter(x => x.i.dimension === d);
        if (!rows.length) return null;
        return <section key={d} className={s.card} style={{ marginBottom: 12 }}><h2>{OUTCOME_DIMENSIONS[d]}<span>{rows.length}</span></h2>
          <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Indicator</th><th>Baseline</th><th>Latest</th><th>Target</th></tr></thead><tbody>
            {rows.map(({ i, place }) => {
              const mine = ms.filter(m => m.indicatorId === i.id), base = mine.find(m => m.kind === "baseline"), last = [...mine].reverse().find(m => m.kind === "measurement");
              return <tr key={i.id}><td><Link href={`/steward/places/${i.placeId}#outcomes`}>{i.name}</Link><span className={ui.sub}>{place} · {i.unit}{i.method ? ` · ${i.method}` : ""}</span></td>
                <td>{base ? `${base.value} ${i.unit}` : <span className={s.state} data-s="not_assessed">Not measured</span>}<span className={ui.sub}>{base?.periodStart ?? ""}</span></td>
                <td>{last ? `${last.value} ${i.unit}` : "—"}<span className={ui.sub}>{last ? `${last.periodStart} · ${last.reviewStatus}` : ""}</span></td>
                <td>{i.target != null ? `${i.target} ${i.unit}` : i.targetNote || "—"}</td></tr>;
            })}
          </tbody></table></div></section>;
      })}
    </>
  );
}

