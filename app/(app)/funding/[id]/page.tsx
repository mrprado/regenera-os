import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { auditLog, fundingApplications, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal, mandateCondition } from "@/lib/db/scoped";
import { amount, daysLabel, daysLeft, ROUTE_LABEL, SOURCE_LABEL } from "@/lib/funding/labels";
import { getOpportunity } from "@/lib/funding/queries";
import { applicantCandidates } from "@/lib/funding/pipeline";
import { bidReviewsFor, prospectsFor, readinessFor } from "@/lib/funding/origination-queries";
import { blankReadiness, contingentWarning, deliveryEconomics, executiveStrip, kindOf, readinessSummary } from "@/lib/funding/origination";
import {
  APPLICANT_ELIGIBILITY, APPLICATION_STATES, BID_DECISIONS, CALENDAR_KINDS, DRAFT_BASIS, FEE_BASES, FUNDING_KINDS, PROSPECT_STAGES, RATE_GUIDANCE, READINESS_DIMENSIONS, READINESS_STATES, TEAM_ROLES,
} from "@/lib/funding/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { SECTORS } from "@/lib/vocab";
import { bidAction, decideFundingAction, draftProposalAction, findApplicantsAction, offerSupportAction } from "../../funding-actions";
import {
  addExternalProspectAction, addFundingDateAction, addProspectAction, buildProfileAction, createApplicationAction, decideBidAction, draftOutreachAction, logTouchAction, opportunityToPathwayAction,
  proposeDiagnosticAction, prospectStageAction, prospectUpdateAction, researchBriefAction, reviewProfileAction, saveBidReviewAction, saveFundingDetailsAction, saveFundingReadinessAction,
} from "../../funding-origination-actions";
import f from "../funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funding opportunity" };

const TABS = [["overview", "Overview"], ["eligibility", "Eligibility"], ["profile", "Applicant profile"], ["applicants", "Applicants"], ["consortium", "Consortium"], ["application", "Application"], ["documents", "Documents"], ["activity", "Activity"]] as const;
type Tab = (typeof TABS)[number][0];

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/funding");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getOpportunity(user.scope, id);
  if (!data) notFound();
  const { o, matches, deal } = data;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "overview";
  const today = new Date().toISOString().slice(0, 10);
  const d = daysLeft(o.deadline);
  const k = kindOf(o);
  const [prospects, apps, readiness, reviews] = await Promise.all([
    prospectsFor(user.scope, o.id),
    appDb().select({ id: fundingApplications.id, name: fundingApplications.name, state: fundingApplications.state, owner: fundingApplications.owner }).from(fundingApplications).where(and(eq(fundingApplications.opportunityId, o.id), mandateCondition(user.scope, fundingApplications.mandateId))),
    readinessFor(user.scope, o.id), bidReviewsFor(user.scope, o.id),
  ]);
  const projectList = await appDb().select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(projects.name).limit(300);
  const strip = executiveStrip(o, { today, prospects: prospects.map(p => p.p), applicantAssigned: prospects.some(p => ["diagnostic_won", "engagement"].includes(p.p.stage)) || apps.length > 0, consortiumNeeded: o.read?.consortium ?? ((o.details.requiredPartners ?? []).length ? true : null), consortiumGaps: null, alignment: o.route === "signal" ? "Signal only" : o.route ? "Potential" : undefined });
  const back = `/funding/${o.id}?tab=${tab}`;
  const internal = isInternal(user.scope);

  return (
    <>
      <PageHeader title={o.title} actions={<><a className="btn" href={o.url} target="_blank" rel="noreferrer">Open the call</a><Link className="btn" href="/funding">All funding</Link></>} />
      <p className={f.kicker}>{[o.funder ?? "Funder not stated", FUNDING_KINDS[k.kind].label + (k.derived ? " (derived)" : ""), o.status, o.programme].filter(Boolean).join("  ·  ")}</p>
      <Notice text={sp.notice} />
      <dl className={f.strip}>
        <div><dt>Deadline</dt><dd className={d !== null && d <= 21 ? f.warn : undefined}>{o.deadline ?? "Rolling / not stated"}{d !== null ? ` · ${daysLabel(d)}` : ""}</dd></div>
        <div><dt>Funding</dt><dd>{amount(o.amountMin, o.amountMax, o.currency)}</dd></div>
        <div><dt>Geography</dt><dd>{(o.countries ?? []).slice(0, 3).join(", ") || "Not stated"}</dd></div>
        {strip.map(s => <div key={s.label}><dt>{s.label}</dt><dd><span className={f.tone} data-tone={s.tone} aria-hidden />{s.value}</dd></div>)}
      </dl>
      <div className={ui.rowActions} style={{ marginBottom: 12 }}>
        <form action={findApplicantsAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">Find applicants</button></form>
        <form action={draftProposalAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">{o.read?.proposal ? "Redraft proposal sections" : "Draft proposal sections"}</button></form>
        {!o.dealId && <form action={bidAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">Bid</button></form>}
        {o.decision !== "watching" && !o.dealId && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="watching" /><input type="hidden" name="back" value={back} /><button className="btn" type="submit">Watch</button></form>}
        {o.decision !== "dismissed" && !o.dealId && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="dismissed" /><input type="hidden" name="back" value="/funding" /><button className="btn" type="submit">Dismiss</button></form>}
      </div>
      <nav className={ui.tabs} aria-label="Opportunity sections">
        {TABS.map(([key, label]) => <Link key={key} className={`${ui.tab} ${tab === key ? ui.tabActive : ""}`} href={`/funding/${o.id}${key === "overview" ? "" : `?tab=${key}`}`}>{label}{key === "applicants" && prospects.length ? ` (${prospects.length})` : ""}</Link>)}
      </nav>

      <div className={f.layout}>
        <div>
          {tab === "overview" && <>
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Reading</span><span className={ui.sub}>{o.readAt ? `Claude read ${o.readAt.slice(0, 10)}. AI interpretation, not authoritative on eligibility.` : "Not read by Claude yet"}</span></p>
              {o.read?.summary ? <p className={ui.read}>{o.read.summary}</p> : <p className={r.empty}>No reading yet. The call text below is the source.</p>}
              {o.read?.why && <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>{o.read.why}</p>}
              {o.read?.caveats?.length ? <ul style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>{o.read.caveats.map(c => <li key={c}>{c}</li>)}</ul> : null}
              {o.fit != null && <p className={ui.sub}>Discovery signal: {o.fit}{o.readAt ? " (from the read)" : " keyword hits"}. It sorted the list; it is not a fit or eligibility measure.</p>}
            </section>
            <section className={r.panel}>
              <p className={r.panelTitle}>Program</p>
              <dl className={r.kv}>
                <dt>Program size</dt><dd>{o.programSize ? compactMoney(o.programSize, o.currency ?? "USD") : "Not stated"}</dd>
                <dt>Expected award</dt><dd>{o.expectedAward ? compactMoney(o.expectedAward, o.currency ?? "USD") : "Not stated"}{o.numberAwards ? ` · ${o.numberAwards} awards` : ""}</dd>
                <dt>Match / cost share</dt><dd>{o.matchRequirement ?? (o.cofinancingPct != null ? `${o.cofinancingPct}%` : "Not stated")}</dd>
                <dt>Reimbursement</dt><dd>{o.reimbursement ?? "Not stated"}</dd>
                <dt>Award period</dt><dd>{o.awardPeriod ?? "Not stated"}</dd>
                <dt>Priorities</dt><dd>{o.details.objectives?.priorities?.join("; ") || "Not recorded"}</dd>
                <dt>Scoring</dt><dd>{o.details.objectives?.scoring?.join("; ") || "Not recorded"}</dd>
                <dt>Outcomes / KPIs</dt><dd>{[...(o.details.objectives?.outcomes ?? []), ...(o.details.objectives?.kpis ?? [])].join("; ") || "Not recorded"}</dd>
              </dl>
              <p className={ui.sub}>Structured fields are edited on Eligibility. Anything not recorded stays &quot;Not stated&quot;.</p>
            </section>
            <Proposal o={o} />
            {o.description && (
              <section className={r.panel}>
                <p className={r.panelTitle}><span>Call text (original source)</span><span className={ui.sub}>{SOURCE_LABEL[o.source]}{o.retrievedAt ? ` · retrieved ${o.retrievedAt.slice(0, 10)}` : ` · first seen ${o.createdAt.slice(0, 10)}`}</span></p>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>{o.description}</p>
              </section>
            )}
          </>}

          {tab === "eligibility" && <>
            <Readiness o={o} readiness={readiness} prospects={prospects} />
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Call data</span><span className={ui.sub}>{o.verifiedBy ? `Verified by ${o.verifiedBy} on ${o.verifiedAt?.slice(0, 10)}` : "Not verified against the call documents"}</span></p>
              <form action={saveFundingDetailsAction} className={f.grid3}>
                <input type="hidden" name="id" value={o.id} />
                <label>Funding type<select name="kind" defaultValue={o.kind ?? ""}><option value="">Derived: {FUNDING_KINDS[k.kind].label}</option>{Object.entries(FUNDING_KINDS).map(([kk, v]) => <option key={kk} value={kk}>{v.label}</option>)}</select></label>
                <label>Opportunity ID<input name="opportunityCode" defaultValue={o.opportunityCode ?? o.externalId} /></label>
                <label>Award period<input name="awardPeriod" defaultValue={o.awardPeriod ?? ""} /></label>
                <label>Program size<input name="programSize" defaultValue={o.programSize ?? ""} inputMode="decimal" /></label>
                <label>Expected award<input name="expectedAward" defaultValue={o.expectedAward ?? ""} inputMode="decimal" /></label>
                <label>Number of awards<input name="numberAwards" defaultValue={o.numberAwards ?? ""} inputMode="numeric" /></label>
                <label>Match / cost share<input name="matchRequirement" defaultValue={o.matchRequirement ?? ""} /></label>
                <label>Reimbursement structure<input name="reimbursement" defaultValue={o.reimbursement ?? ""} /></label>
                <label className={f.inline}><input type="checkbox" name="rolling" defaultChecked={o.rolling} /> Rolling deadline</label>
                <label className={f.full}>Eligible organization types<input name="orgTypes" defaultValue={(o.details.eligibility?.orgTypes ?? o.applicantTypes ?? []).join(", ")} /></label>
                <label>Project maturity<input name="maturity" defaultValue={o.details.eligibility?.maturity ?? ""} /></label>
                <label>Registrations required<input name="registrations" defaultValue={(o.details.eligibility?.registrations ?? []).join(", ")} placeholder="SAM, UEI, EU PIC…" /></label>
                <label>Certifications<input name="certifications" defaultValue={(o.details.eligibility?.certifications ?? []).join(", ")} /></label>
                <label className={f.full}>Eligibility notes (quote the call)<textarea name="eligibilityNotes" defaultValue={o.details.eligibility?.notes ?? ""} /></label>
                <label>Eligible costs<input name="eligibleCosts" defaultValue={o.eligibleCosts ?? ""} /></label>
                <label>Prohibited costs<input name="prohibitedCosts" defaultValue={o.prohibitedCosts ?? ""} /></label>
                <label>Required partners<input name="requiredPartners" defaultValue={(o.details.requiredPartners ?? []).join(", ")} placeholder="university, utility…" /></label>
                <label>Priorities<input name="priorities" defaultValue={(o.details.objectives?.priorities ?? []).join(", ")} /></label>
                <label>Scoring criteria<input name="scoring" defaultValue={(o.details.objectives?.scoring ?? []).join("; ")} /></label>
                <label>Required outcomes<input name="outcomes" defaultValue={(o.details.objectives?.outcomes ?? []).join(", ")} /></label>
                <label>KPIs<input name="kpis" defaultValue={(o.details.objectives?.kpis ?? []).join(", ")} /></label>
                <label>Target population<input name="targetPopulation" defaultValue={o.details.objectives?.targetPopulation ?? ""} /></label>
                <label>Submission format<input name="format" defaultValue={o.details.application?.format ?? ""} /></label>
                <label>Page limits<input name="pageLimits" defaultValue={o.details.application?.pageLimits ?? ""} /></label>
                <label>Required forms<input name="forms" defaultValue={(o.details.application?.forms ?? []).join(", ")} /></label>
                <label>Attachments<input name="attachments" defaultValue={(o.details.application?.attachments ?? []).join(", ")} /></label>
                <label>Letters<input name="letters" defaultValue={(o.details.application?.letters ?? []).join(", ")} /></label>
                <label>Compliance items<input name="compliance" defaultValue={(o.details.application?.compliance ?? []).join(", ")} /></label>
                <label>Owner<input name="owner" defaultValue={o.owner ?? ""} /></label>
                <label>Next action<input name="nextAction" defaultValue={o.nextAction ?? ""} /></label>
                <label>Next action date<input type="date" name="nextActionDate" defaultValue={o.nextActionDate ?? ""} /></label>
                <label>Associated project<select name="projectId" defaultValue={o.projectId ?? ""}><option value="">None</option>{projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>Territory<input name="territory" defaultValue={o.territory ?? ""} /></label>
                <label className={f.inline}><input type="checkbox" name="verify" /> I checked these fields against the call documents</label>
                <div className={f.full}><button className="btn btn--primary" type="submit">Save call data</button></div>
              </form>
            </section>
          </>}

          {tab === "profile" && <Profile o={o} />}
          {tab === "applicants" && <Applicants o={o} prospects={prospects} matches={matches} back={back} />}

          {tab === "consortium" && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Consortium</p>
              <p className={ui.sub} style={{ marginTop: 0 }}>Required partners from the call: {(o.details.requiredPartners ?? o.applicantProfile?.requiredPartners ?? []).join(", ") || (o.read?.consortium ? "the read indicates a consortium; record the roles on Eligibility" : "none recorded")}.</p>
              {apps.length === 0 ? <p className={r.empty}>The consortium is built inside an application workspace (lead applicant, partners, technical, community, research, private and capital partners). Open one from Application.</p>
                : <ul>{apps.map(a => <li key={a.id}><Link href={`/funding/applications/${a.id}?tab=consortium`}>{a.name}</Link> · {APPLICATION_STATES[a.state as keyof typeof APPLICATION_STATES]}</li>)}</ul>}
            </section>
          )}

          {tab === "application" && <Application o={o} reviews={reviews} prospects={prospects} apps={apps} projectList={projectList} internal={internal} />}

          {tab === "documents" && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Documents</p>
              <dl className={r.kv}>
                <dt>Call</dt><dd><a href={o.url} target="_blank" rel="noreferrer">{o.url}</a></dd>
                <dt>Required forms</dt><dd>{o.details.application?.forms?.join(", ") || "Not recorded"}</dd>
                <dt>Attachments</dt><dd>{o.details.application?.attachments?.join(", ") || "Not recorded"}</dd>
                <dt>Letters</dt><dd>{o.details.application?.letters?.join(", ") || "Not recorded"}</dd>
                <dt>Partner documents</dt><dd>{o.details.application?.partnerDocs?.join(", ") || "Not recorded"}</dd>
              </dl>
              <p className={ui.sub}>Working files live in <Link href="/documents">Documents</Link>; each application tracks its attachments and compliance items.</p>
            </section>
          )}

          {tab === "activity" && <Activity ids={[o.id, ...prospects.map(p => p.p.id), ...apps.map(a => a.id), ...reviews.map(b => b.id)]} />}
        </div>

        <aside className={f.aside}>
          <h3>Regenera route</h3><p>{o.route ? ROUTE_LABEL[o.route] : "Not assessed"}</p>
          <h3>Status</h3><p>{({ new: "New", watching: "Watching", bidding: "Bidding", matched: "Applicants found", dismissed: "Dismissed" } as Record<string, string>)[o.decision]}{o.dismissReason ? ` · ${o.dismissReason}` : ""}</p>
          <h3>Client fit</h3><p>{prospects.length ? `${prospects.length} applicant prospect(s); ${prospects.filter(p => p.p.eligibility === "confirmed").length} confirmed eligible` : "No applicant considered yet"}</p>
          <h3>Project fit</h3>
          <p>{o.projectId ? <Link href={`/projects/${o.projectId}?tab=pathways`}>{projectList.find(p => p.id === o.projectId)?.name ?? "Project"}</Link> : "No project linked"}</p>
          <form action={opportunityToPathwayAction} className={f.inline} style={{ marginTop: 6 }}>
            <input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="back" value={back} />
            <select name="projectId" aria-label="Project" required defaultValue={o.projectId ?? ""}><option value="" disabled>Project…</option>{projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button className={ui.miniBtn} type="submit">Add as funding pathway</button>
          </form>
          <h3>Owner</h3><p>{o.owner ?? "Unassigned"}</p>
          <h3>Next action</h3><p>{o.nextAction ? `${o.nextAction}${o.nextActionDate ? ` · ${o.nextActionDate}` : ""}` : deal?.nextAction ?? "None set"}</p>
          <h3>Source</h3><p>{SOURCE_LABEL[o.source]} · ID {o.opportunityCode ?? o.externalId}<br /><a href={o.url} target="_blank" rel="noreferrer">Original call</a></p>
          <h3>Verification</h3><p>{o.verifiedBy ? `Verified by ${o.verifiedBy}, ${o.verifiedAt?.slice(0, 10)}` : "Parsed fields not verified"}{o.extractionConfidence ? ` · extraction ${o.extractionConfidence}` : ""}</p>
          <h3>Sectors</h3><p>{(o.sectors ?? []).map(s => SECTORS[s as keyof typeof SECTORS] ?? s).join(", ") || "—"}</p>
          <h3>Add a date</h3>
          <form action={addFundingDateAction} className={f.form}>
            <input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="back" value={back} />
            <select name="kind" aria-label="Kind">{Object.entries(CALENDAR_KINDS).map(([kk, v]) => <option key={kk} value={kk}>{v.label}{v.internal ? " (internal)" : ""}</option>)}</select>
            <input type="date" name="date" required aria-label="Date" /><input name="label" placeholder="Note" aria-label="Note" />
            <button className={ui.miniBtn} type="submit">Add to calendar</button>
          </form>
        </aside>
      </div>
    </>
  );
}

type O = NonNullable<Awaited<ReturnType<typeof getOpportunity>>>["o"];
type Pros = Awaited<ReturnType<typeof prospectsFor>>;

function Proposal({ o }: { o: O }) {
  const p = o.read?.proposal;
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Proposal draft</p>
      {!p ? <p className={r.empty}>No draft yet. Claude writes first-pass sections from the call text, the applicant and project records and approved bid library blocks. It never invents history, outcomes, metrics, capacity or partners, and nothing is ever submitted for you.</p> : (
        <>
          <p className={ui.sub} style={{ marginTop: 0 }}>Drafted {p.draftedAt.slice(0, 16).replace("T", " ")} UTC. Edit before use. [TO CONFIRM] marks gaps.</p>
          {p.styleFlags.length > 0 && <p className={ui.notice}>Flags: {p.styleFlags.join(" ")}</p>}
          {p.sections.map(s => { const b = s.basis ?? "draft"; return <div key={s.heading} style={{ marginBottom: 12 }}><span className={f.basis} data-b={b}>{DRAFT_BASIS[b as keyof typeof DRAFT_BASIS] ?? b}</span><b>{s.heading}</b><p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, margin: "4px 0 0" }}>{s.body}</p></div>; })}
          {p.gaps.length > 0 && <><b>Missing evidence / to confirm</b><ul style={{ fontSize: 13, paddingLeft: 18 }}>{p.gaps.map(g => <li key={g}>{g}</li>)}</ul></>}
        </>
      )}
    </section>
  );
}

function Readiness({ o, readiness, prospects }: { o: O; readiness: Awaited<ReturnType<typeof readinessFor>>; prospects: Pros }) {
  const rows = readiness.length ? readiness : [{ id: "new", prospectId: null as string | null, cells: blankReadiness() as Record<string, { status: string; note: string; source: string }>, assessedBy: null as string | null, updatedAt: "" }];
  return (
    <>
      {rows.map(rd => {
        const s = readinessSummary(rd.cells);
        const who = rd.prospectId ? prospects.find(p => p.p.id === rd.prospectId)?.orgName : null;
        return (
          <section key={rd.id} className={r.panel}>
            <p className={r.panelTitle}><span>Funding readiness{who ? ` · ${who}` : ""}</span><span className={f.state} data-s={s.headline}>{READINESS_STATES[s.headline]}</span></p>
            <p className={ui.sub} style={{ marginTop: 0 }}>{s.assessed} of {s.total} dimensions assessed{s.holding.length ? ` · held back by ${s.holding.map(h => h).join(", ")}` : ""}{s.unsourced.length ? ` · ${s.unsourced.length} marked ready without a source` : ""}{rd.assessedBy ? ` · ${rd.assessedBy} ${rd.updatedAt.slice(0, 10)}` : ""}. Categorical only: no percentage.</p>
            <form action={saveFundingReadinessAction}>
              <input type="hidden" name="opportunityId" value={o.id} />
              {rd.prospectId && <input type="hidden" name="prospectId" value={rd.prospectId} />}
              <table className={ui.table}><thead><tr><th>Dimension</th><th>State</th><th>Note</th><th>Source</th></tr></thead><tbody>
                {Object.entries(READINESS_DIMENSIONS).map(([dim, q]) => { const c = rd.cells[dim] ?? { status: "unknown", note: "", source: "" }; return (
                  <tr key={dim}><td className={ui.wrap}><b style={{ textTransform: "capitalize" }}>{dim}</b><span className={ui.sub}>{q}</span></td>
                    <td><select name={`${dim}_status`} defaultValue={c.status} aria-label={`${dim} state`}>{Object.entries(READINESS_STATES).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select></td>
                    <td><input name={`${dim}_note`} defaultValue={c.note} aria-label={`${dim} note`} style={{ width: "100%" }} /></td>
                    <td><input name={`${dim}_source`} defaultValue={c.source} aria-label={`${dim} source`} placeholder="call §, document" /></td></tr>); })}
              </tbody></table>
              <button className="btn btn--primary" type="submit" style={{ marginTop: 8 }}>Save readiness</button>
            </form>
          </section>
        );
      })}
      {prospects.filter(p => !readiness.some(x => x.prospectId === p.p.id)).length > 0 && (
        <p className={ui.sub}>Assess readiness per applicant: {prospects.filter(p => !readiness.some(x => x.prospectId === p.p.id)).map(p => (
          <form key={p.p.id} action={saveFundingReadinessAction} style={{ display: "inline" }}><input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="prospectId" value={p.p.id} /><button className={ui.miniBtn} type="submit">{p.orgName}</button></form>
        ))}</p>
      )}
    </>
  );
}

function Profile({ o }: { o: O }) {
  const p = o.applicantProfile;
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Ideal applicant profile</span>{p && <span className={ui.sub}>{p.basis === "call_text" ? "From the call text" : "Inferred from the call metadata"} · {p.generatedAt.slice(0, 10)}{p.reviewedBy ? ` · reviewed by ${p.reviewedBy}` : " · not reviewed"}</span>}</p>
      {!p ? <p className={r.empty}>Build the profile to drive applicant prospecting: entity classes, capabilities, partners, evidence, match capacity and decision-maker titles.</p> : (
        <dl className={r.kv}>
          <dt>Eligible entity classes</dt><dd>{p.entityClasses.join(", ") || "Not stated"}</dd>
          <dt>Geography</dt><dd>{p.geography}</dd>
          <dt>Sector</dt><dd>{p.sectors.map(s => SECTORS[s as keyof typeof SECTORS] ?? s).join(", ") || "—"}</dd>
          <dt>Capabilities</dt><dd>{p.capabilities.join("; ")}</dd>
          <dt>Likely project type</dt><dd>{p.projectTypes.join(", ") || "Not stated"}</dd>
          <dt>Minimum capacity</dt><dd>{p.minCapacity}</dd>
          <dt>Project maturity</dt><dd>{p.maturity}</dd>
          <dt>Required partners</dt><dd>{p.requiredPartners.join(", ") || "None recorded"}</dd>
          <dt>Evidence required</dt><dd>{p.evidence.join(", ") || "Not recorded"}</dd>
          <dt>Match capacity</dt><dd>{p.matchCapacity}</dd>
          <dt>Compliance</dt><dd>{p.compliance.join(", ") || "Not recorded"}</dd>
          <dt>Decision-maker titles</dt><dd>{p.decisionMakerTitles.join(", ") || "Not inferred"}</dd>
        </dl>
      )}
      <div className={ui.rowActions} style={{ marginTop: 10 }}>
        <form action={buildProfileAction}><input type="hidden" name="id" value={o.id} /><button className="btn btn--primary" type="submit">{p ? "Rebuild profile" : "Build ideal applicant profile"}</button></form>
        {p && !p.reviewedBy && <form action={reviewProfileAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">Mark reviewed against the call</button></form>}
        {p && <Link className="btn" href={`/funding/${o.id}?tab=applicants`}>Find applicants with this profile</Link>}
      </div>
    </section>
  );
}

async function Applicants({ o, prospects, matches, back }: { o: O; prospects: Pros; matches: NonNullable<Awaited<ReturnType<typeof getOpportunity>>>["matches"]; back: string }) {
  const cands = (await applicantCandidates(appDb(), o.id, 40)).filter(c => !c.alreadyProspect);
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Applicant prospects ({prospects.length})</span><Link href="/funding?tab=applicants">All prospects</Link></p>
        {prospects.length === 0 ? <p className={r.empty}>None yet. Add from the CRM candidates below or research an external organization.</p> : prospects.map(({ p, orgName, dm, dmTitle }) => (
          <div key={p.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <div className={f.inline} style={{ justifyContent: "space-between" }}>
              <span><Link className={ui.primary} href={`/companies/${p.orgId}`}>{orgName}</Link> <span className={f.state} data-s={p.eligibility}>{APPLICANT_ELIGIBILITY[p.eligibility as keyof typeof APPLICANT_ELIGIBILITY]?.label}</span> <span className={ui.sub}>{PROSPECT_STAGES[p.stage as keyof typeof PROSPECT_STAGES]} · {p.origin === "external" ? "external" : "CRM"}{dm ? ` · ${dm}${dmTitle ? ` (${dmTitle})` : ""}` : " · no decision-maker"}</span></span>
              <span className={ui.rowActions}>{p.engagementId && <Link className={ui.miniBtn} href={`/commercial/engagements/${p.engagementId}`}>Client opportunity</Link>}</span>
            </div>
            {p.rationale && <p className={ui.sub}>Why: {p.rationale}</p>}
            {p.eligibilityBasis && <p className={ui.sub}>Eligibility basis: {p.eligibilityBasis}</p>}
            {p.missing.length > 0 && <p className={ui.sub}>Missing: {p.missing.join(", ")}</p>}
            <div className={ui.rowActions} style={{ marginTop: 6 }}>
              <form action={researchBriefAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Research brief</button></form>
              <form action={draftOutreachAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Draft outreach</button></form>
              <form action={logTouchAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="outreach" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Log outreach</button></form>
              <form action={logTouchAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="follow_up" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Set follow-up</button></form>
              <form action={logTouchAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="discovery" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Schedule discovery</button></form>
              {["qualified", "discovery", "responded"].includes(p.stage) && <form action={proposeDiagnosticAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Propose diagnostic</button></form>}
              <form action={prospectStageAction} className={f.inline}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                <select name="stage" defaultValue={p.stage} aria-label="Stage">{Object.entries(PROSPECT_STAGES).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select>
                <input name="lostReason" placeholder="If lost: why" aria-label="Lost reason" /><button className={ui.miniBtn} type="submit">Move</button></form>
            </div>
            <details style={{ marginTop: 6 }}><summary className={ui.sub}>Eligibility and decision-maker</summary>
              <form action={prospectUpdateAction} className={f.grid3} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                <label>Eligibility<select name="eligibility" defaultValue={p.eligibility}>{Object.entries(APPLICANT_ELIGIBILITY).map(([kk, v]) => <option key={kk} value={kk}>{v.label}</option>)}</select></label>
                <label className={f.full}>Basis (required for Confirmed: call clause or funder answer)<input name="eligibilityBasis" defaultValue={p.eligibilityBasis} /></label>
                <label>Follow-up<input type="date" name="followUpDate" defaultValue={p.followUpDate ?? ""} /></label>
                <div><button className={ui.miniBtn} type="submit">Save</button></div>
              </form>
            </details>
            {p.researchBrief && <details><summary className={ui.sub}>Research brief</summary><pre className={f.brief}>{p.researchBrief}</pre></details>}
          </div>
        ))}
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Candidates in the CRM ({cands.length})</span><span className={ui.sub}>{o.applicantProfile ? "Matched to the ideal applicant profile" : "Matched to the call metadata; build the profile for a better match"}</span></p>
        {cands.length === 0 ? <p className={r.empty}>No organization in the CRM matches the entity type, geography or sector. Research external prospects below.</p> : (
          <table className={ui.table}>
            <thead><tr><th>Organization</th><th>Type · geography · sector</th><th>Relationship</th><th>Last interaction</th><th>Decision-maker</th><th>Missing</th><th /></tr></thead>
            <tbody>{cands.map(c => (
              <tr key={c.org.id}>
                <td className={ui.wrap}><Link className={ui.primary} href={`/companies/${c.org.id}`}>{c.org.name}</Link><span className={ui.sub}>{c.rationale}</span></td>
                <td className={ui.sub}>{c.match.classMatch} · {c.match.geo} · {c.match.sector}</td>
                <td>{c.relationship}{c.owner && <span className={ui.sub}>{c.owner}</span>}</td>
                <td>{c.lastInteraction?.slice(0, 10) ?? "—"}</td>
                <td>{c.decisionMaker ? `${c.decisionMaker.name}${c.decisionMaker.title ? ` (${c.decisionMaker.title})` : ""}` : "—"}</td>
                <td className={ui.sub}>{c.missing.join(", ") || "—"}</td>
                <td><form action={addProspectAction}>
                  <input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="orgId" value={c.org.id} /><input type="hidden" name="eligibility" value={c.match.eligibility} />
                  <input type="hidden" name="rationale" value={c.rationale} /><input type="hidden" name="missing" value={c.missing.join(", ")} /><input type="hidden" name="back" value={back} />
                  {c.decisionMaker && <input type="hidden" name="decisionMakerId" value={c.decisionMaker.id} />}
                  <button className={ui.miniBtn} type="submit">Add as prospect</button>
                </form></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className={ui.sub}>Eligibility shown is Likely or Uncertain until someone confirms it with a basis. The OS never claims eligibility.</p>
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}>Research an external prospect</p>
        <p className={ui.sub} style={{ marginTop: 0 }}>From lawful public sources (funder award lists, registries, association directories, the organization&apos;s own site). LinkedIn is never scraped. The organization is matched against the CRM first, so nothing is duplicated.</p>
        <form action={addExternalProspectAction} className={f.grid3}>
          <input type="hidden" name="opportunityId" value={o.id} />
          <label>Organization<input name="name" required /></label>
          <label>Website<input name="website" type="url" placeholder="https://" /></label>
          <label>Country<input name="country" /></label>
          <label>Eligibility<select name="eligibility" defaultValue="uncertain">{Object.entries(APPLICANT_ELIGIBILITY).map(([kk, v]) => <option key={kk} value={kk}>{v.label}</option>)}</select></label>
          <label>Eligibility basis<input name="eligibilityBasis" /></label>
          <label>Source<input name="source" placeholder="e.g. EPA prior awardees list" /></label>
          <label className={f.full}>Source URL<input name="sourceUrl" type="url" /></label>
          <label className={f.full}>Rationale<input name="rationale" /></label>
          <div><button className="btn" type="submit">Add prospect</button></div>
        </form>
      </section>

      {matches.length > 0 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Earlier CRM matches (Find applicants)</p>
          <table className={ui.table}><tbody>{matches.map(m => (
            <tr key={m.m.id}>
              <td><Link className={ui.primary} href={`/companies/${m.m.orgId}`}>{m.orgName}</Link><span className={ui.sub}>{m.m.reason}</span></td>
              <td><div className={ui.rowActions}>
                {!prospects.some(p => p.p.orgId === m.m.orgId) && <form action={addProspectAction}><input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="orgId" value={m.m.orgId} /><input type="hidden" name="rationale" value={m.m.reason} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Add as prospect</button></form>}
                {m.m.status === "contacted" ? <span className={ui.chip}>draft queued</span> : m.contactId ? <form action={offerSupportAction}><input type="hidden" name="matchId" value={m.m.id} /><button className={ui.miniBtn} type="submit">Offer application support</button></form> : <span className={ui.sub}>No contact with email</span>}
              </div></td>
            </tr>
          ))}</tbody></table>
        </section>
      )}
    </>
  );
}

function Application({ o, reviews, prospects, apps, projectList, internal }: { o: O; reviews: Awaited<ReturnType<typeof bidReviewsFor>>; prospects: Pros; apps: { id: string; name: string; state: string; owner: string | null }[]; projectList: { id: string; name: string }[]; internal: boolean }) {
  const decided = reviews.find(b => b.decision === "bid" || b.decision === "bid_conditions");
  const k = kindOf(o).kind;
  const draft = reviews.find(b => !b.decision);
  const lines = draft?.costLines.length ? draft.costLines : [{ role: "analyst", hours: 20, rate: 0 }, { role: "proposal_manager", hours: 10, rate: 0 }, { role: "lead", hours: 5, rate: 0 }, { role: "sme", hours: 4, rate: 0 }];
  return (
    <>
      {apps.length > 0 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Application workspaces</p>
          <table className={ui.table}><tbody>{apps.map(a => <tr key={a.id}><td><Link className={ui.primary} href={`/funding/applications/${a.id}`}>{a.name}</Link></td><td>{APPLICATION_STATES[a.state as keyof typeof APPLICATION_STATES]}</td><td>{a.owner ?? "—"}</td></tr>)}</tbody></table>
        </section>
      )}
      {reviews.filter(b => b.decision).map(b => {
        const e = deliveryEconomics({ fee: b.fee, lines: b.costLines, otherCost: Math.max(0, b.deliveryCost - b.costLines.reduce((a, l) => a + l.hours * l.rate, 0)) });
        return (
          <section key={b.id} className={r.panel}>
            <p className={r.panelTitle}><span>Bid / no-bid · {BID_DECISIONS[b.decision as keyof typeof BID_DECISIONS]}</span><span className={ui.sub}>{b.decidedBy} · {b.decidedAt?.slice(0, 10)}</span></p>
            {internal && <div className={f.econ}><div><b>{compactMoney(b.fee, b.currency)}</b><span>Fee ({FEE_BASES[b.feeBasis as keyof typeof FEE_BASES] ?? b.feeBasis})</span></div><div><b>{compactMoney(e.cost, b.currency)}</b><span>Direct cost</span></div><div><b>{compactMoney(e.grossProfit, b.currency)}</b><span>Gross profit</span></div><div><b>{e.grossMarginPct ?? "—"}%</b><span>Gross margin</span></div><div><b>{e.hours}</b><span>Hours</span></div></div>}
            {b.conditions && <p><b>Conditions:</b> {b.conditions}</p>}
            {b.risks && <p className={ui.sub}>Risks: {b.risks}</p>}
          </section>
        );
      })}
      {draft && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Decision pending</span>{draft.seniorApprovalRequired && <span className={ui.sub}>{draft.approvedBy ? `Senior approval: ${draft.approvedBy}` : "Needs senior approval before Bid"}</span>}</p>
          <div className={ui.rowActions}>
            {draft.seniorApprovalRequired && !draft.approvedBy && <form action={decideBidAction}><input type="hidden" name="id" value={draft.id} /><input type="hidden" name="senior" value="1" /><button className="btn" type="submit">Record senior approval</button></form>}
            <form action={decideBidAction} className={f.inline}><input type="hidden" name="id" value={draft.id} />
              <select name="decision" aria-label="Decision">{Object.entries(BID_DECISIONS).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select>
              <input name="conditions" placeholder="Conditions (required for Bid with conditions)" aria-label="Conditions" style={{ minWidth: 260 }} /><button className="btn btn--primary" type="submit">Decide</button></form>
          </div>
        </section>
      )}
      {internal && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>{draft ? "Edit the bid / no-bid review" : "Bid / no-bid review"}</span><span className={ui.sub}>Economics are explicit before effort is committed. Low-margin strategic work is allowed; invisible economics are not.</span></p>
          <form action={saveBidReviewAction} className={f.grid3}>
            <input type="hidden" name="opportunityId" value={o.id} />{draft && <input type="hidden" name="id" value={draft.id} />}
            <label>Applicant<select name="prospectId" defaultValue={draft?.prospectId ?? ""}><option value="">Regenera bids itself</option>{prospects.map(p => <option key={p.p.id} value={p.p.id}>{p.orgName}</option>)}</select></label>
            <label>Eligibility<select name="eligibility" defaultValue={draft?.eligibility ?? "uncertain"}>{Object.entries(APPLICANT_ELIGIBILITY).map(([kk, v]) => <option key={kk} value={kk}>{v.label}</option>)}</select></label>
            <label>Readiness<input name="readinessSummary" defaultValue={draft?.readinessSummary ?? ""} placeholder="e.g. Incomplete: consortium" /></label>
            <label className={f.full}>Strategic fit<input name="strategicFit" defaultValue={draft?.strategicFit ?? ""} /></label>
            <label>Fee<input name="fee" inputMode="decimal" defaultValue={draft?.fee ?? ""} /></label>
            <label>Fee basis<select name="feeBasis" defaultValue={draft?.feeBasis ?? "fixed"}>{Object.entries(FEE_BASES).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select></label>
            <label>Other direct cost (data, software, travel)<input name="otherCost" inputMode="decimal" defaultValue="" /></label>
            {contingentWarning(draft?.feeBasis, k) && <p className={`${f.full} ${f.warn}`}>{contingentWarning(draft?.feeBasis, k)}</p>}
            <p className={`${f.full} ${ui.sub}`}>Delivery cost lines (hours × each person&apos;s cost rate; planning guidance per hour: {Object.entries(RATE_GUIDANCE).map(([kk, v]) => `${TEAM_ROLES[kk as keyof typeof TEAM_ROLES]} ${v[0]}–${v[1]}`).join(", ")}; set real rates in Capacity).</p>
            {[0, 1, 2, 3, 4, 5, 6].map(i => { const l = lines[i]; return (
              <div key={i} className={`${f.full} ${f.inline}`}>
                <select name={`role_${i}`} defaultValue={l?.role ?? ""} aria-label="Role"><option value="">—</option>{Object.entries(TEAM_ROLES).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select>
                <input name={`person_${i}`} placeholder="Person (optional)" defaultValue={(l as { person?: string })?.person ?? ""} aria-label="Person" />
                <input name={`hours_${i}`} placeholder="Hours" inputMode="decimal" defaultValue={l?.hours ?? ""} aria-label="Hours" style={{ width: 80 }} />
                <input name={`rate_${i}`} placeholder="Cost / hr" inputMode="decimal" defaultValue={l?.rate || ""} aria-label="Rate" style={{ width: 90 }} />
              </div>); })}
            <label>Specialists needed<input name="specialists" defaultValue={draft?.specialists.join(", ") ?? ""} /></label>
            <label>Relationship value<input name="relationshipValue" defaultValue={draft?.relationshipValue ?? ""} /></label>
            <label>Cross-sell potential<input name="crossSell" defaultValue={draft?.crossSell ?? ""} /></label>
            <label className={f.full}>Risks<input name="risks" defaultValue={draft?.risks ?? ""} /></label>
            <label className={f.full}>Opportunity cost (what this displaces)<input name="opportunityCost" defaultValue={draft?.opportunityCost ?? ""} /></label>
            <div><button className="btn btn--primary" type="submit">Save review</button></div>
          </form>
        </section>
      )}
      <section className={r.panel}>
        <p className={r.panelTitle}>Open an application workspace</p>
        {!decided ? <p className={r.empty}>Run the bid / no-bid review first. The workspace opens once someone decides Bid.</p> : (
          <form action={createApplicationAction} className={f.grid3}>
            <input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="bidReviewId" value={decided.id} />
            <label>Lead applicant<select name="leadOrgId" defaultValue={prospects.find(p => p.p.id === decided.prospectId)?.p.orgId ?? ""}><option value="">Regenera</option>{prospects.map(p => <option key={p.p.id} value={p.p.orgId}>{p.orgName}</option>)}</select></label>
            <label>Project<select name="projectId" defaultValue={o.projectId ?? ""}><option value="">None</option>{projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Engagement<select name="engagementId" defaultValue={prospects.find(p => p.p.id === decided.prospectId)?.p.engagementId ?? ""}><option value="">None</option>{prospects.filter(p => p.p.engagementId).map(p => <option key={p.p.id} value={p.p.engagementId!}>{p.orgName}</option>)}</select></label>
            <label>Delivery owner<input name="owner" placeholder="email" /></label>
            <div><button className="btn btn--primary" type="submit">Open workspace</button></div>
          </form>
        )}
      </section>
    </>
  );
}

async function Activity({ ids }: { ids: string[] }) {
  const rows = await appDb().select().from(auditLog).where(inArray(auditLog.entityId, ids.slice(0, 90))).orderBy(desc(auditLog.createdAt)).limit(80);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Activity</p>
      {rows.length === 0 ? <p className={r.empty}>No recorded activity yet.</p> : (
        <ul className={r.timeline}>{rows.map(a => <li key={a.id}><span className={r.when}>{a.createdAt.slice(0, 16).replace("T", " ")}</span><span>{a.action.replace(/_/g, " ")} · {a.actor}</span></li>)}</ul>
      )}
    </section>
  );
}
