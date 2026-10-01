import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { auditLog, capitalStructures, fundingPathways, organizations, orgRegistrations, teamMembers, timeEntries } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { amount, daysLabel, daysLeft } from "@/lib/funding/labels";
import { applicationGaps } from "@/lib/funding/pipeline";
import { loadApplication } from "@/lib/funding/origination-queries";
import { deliveryEconomics, evidenceFlags, plannedVsActual } from "@/lib/funding/origination";
import {
  APPLICANT_ELIGIBILITY, APPLICATION_ORDER, APPLICATION_STATES, APPLICATION_TABS, CONSORTIUM_ROLES, CONSORTIUM_STATUSES, DRAFT_BASIS, EVIDENCE_FLAGS, EXPANSION_KINDS, REGISTRATIONS, TASK_STATUSES, TEAM_ROLES,
} from "@/lib/funding/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { draftProposalAction } from "../../../funding-actions";
import {
  addExpansionAction, addMemberAction, advanceApplicationAction, applicationTaskAction, markUnsuccessfulAction, memberStatusAction, pathwayToStackAction, recordAwardAction, saveApplicationAction,
  saveAllocationAction, setRegistrationAction,
} from "../../../funding-origination-actions";
import f from "../../funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Application" };
type Tab = keyof typeof APPLICATION_TABS;

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/funding");
  const { id } = await params;
  const sp = await searchParams;
  const d = await loadApplication(user.scope, id);
  if (!d) notFound();
  const { a, o } = d;
  const tab: Tab = sp.tab && sp.tab in APPLICATION_TABS ? (sp.tab as Tab) : "overview";
  const internal = isInternal(user.scope);
  const today = new Date().toISOString().slice(0, 10);
  const left = daysLeft(o.deadline);
  const gaps = await applicationGaps(appDb(), id);
  const idx = APPLICATION_ORDER.indexOf(a.state as never);
  const next = idx >= 0 && idx < APPLICATION_ORDER.length - 1 ? APPLICATION_ORDER[idx + 1] : null;
  const hoursBudget = d.tasks.reduce((s, t) => s + t.hoursBudget, 0), hoursActual = d.tasks.reduce((s, t) => s + t.hoursActual, 0);
  const late = d.tasks.filter(t => t.status !== "done" && t.due && t.due < today);
  const blockers = d.tasks.filter(t => t.status === "blocked");
  const flags = evidenceFlags({ deadlineDays: left, eligibilityConfirmed: d.members.some(m => m.m.role === "lead" && m.m.eligibility === "confirmed"), missingEvidence: a.narrative.filter(n => n.basis === "missing").length + a.scoring.filter(s => !s.evidence).length, consortiumGaps: gaps.filter(g => g.status === "missing").length, matchGap: !!(o.matchRequirement || o.cofinancingPct) && !a.matchAmount, registrationGaps: a.compliance.filter(c => c.status !== "done").length });
  return (
    <>
      <PageHeader title={a.name} actions={<><Link className="btn" href={`/funding/${o.id}`}>Opportunity</Link><Link className="btn" href="/funding?tab=bids">All bids</Link></>} />
      <p className={f.kicker}>{[o.funder, APPLICATION_STATES[a.state as keyof typeof APPLICATION_STATES], d.lead ? `Lead: ${d.lead.name}` : "Lead: Regenera", d.project?.name].filter(Boolean).join("  ·  ")}</p>
      <Notice text={sp.notice} />
      <dl className={f.strip}>
        <div><dt>Deadline</dt><dd className={left !== null && left <= 14 ? f.warn : undefined}>{o.deadline ?? "Not stated"}{left !== null ? ` · ${daysLabel(left)}` : ""}</dd></div>
        <div><dt>Internal deadline</dt><dd>{a.internalDeadline ?? "—"}</dd></div>
        <div><dt>Requested</dt><dd>{a.requestedAmount ? compactMoney(a.requestedAmount, a.currency) : amount(o.amountMin, o.amountMax, o.currency)}</dd></div>
        <div><dt>Delivery owner</dt><dd>{a.owner ?? "Unassigned"}</dd></div>
        <div><dt>Hours plan / actual</dt><dd>{Math.round(hoursBudget)} / {Math.round(hoursActual)}</dd></div>
        <div><dt>Workplan</dt><dd className={late.length || blockers.length ? f.warn : undefined}>{d.tasks.filter(t => t.status === "done").length}/{d.tasks.length} done{late.length ? ` · ${late.length} late` : ""}{blockers.length ? ` · ${blockers.length} blocked` : ""}</dd></div>
      </dl>
      <p className={ui.sub} style={{ marginTop: -8 }}>{flags.length ? flags.map(fl => EVIDENCE_FLAGS[fl as keyof typeof EVIDENCE_FLAGS]).join(" · ") : "No evidence flags"}. No probability of award is computed.</p>
      <nav className={ui.tabs} aria-label="Application sections">
        {Object.entries(APPLICATION_TABS).map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/funding/applications/${id}${k === "overview" ? "" : `?tab=${k}`}`}>{v}</Link>)}
      </nav>

      {tab === "overview" && <Overview d={d} internal={internal} next={next} />}
      {tab === "eligibility" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Eligibility</p>
          <dl className={r.kv}>
            <dt>Eligible types</dt><dd>{(o.details.eligibility?.orgTypes ?? o.applicantTypes ?? []).join(", ") || "Not stated"}</dd>
            <dt>Geography</dt><dd>{(o.countries ?? []).join(", ") || "Not stated"}</dd>
            <dt>Notes from the call</dt><dd>{o.details.eligibility?.notes ?? "Not recorded"}</dd>
            <dt>Lead applicant</dt><dd>{d.members.find(m => m.m.role === "lead") ? `${d.members.find(m => m.m.role === "lead")!.m.name} · ${APPLICANT_ELIGIBILITY[d.members.find(m => m.m.role === "lead")!.m.eligibility as keyof typeof APPLICANT_ELIGIBILITY]?.label}` : "Not set"}</dd>
          </dl>
          <p className={ui.sub}>Eligibility is confirmed against the call or the funder, never by the OS. Record readiness per applicant on the <Link href={`/funding/${o.id}?tab=eligibility`}>opportunity</Link>.</p>
        </section>
      )}
      {tab === "scoring" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Scoring criteria</p>
          <form action={saveApplicationAction}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="tab" value="scoring" />
            {a.scoring.length === 0 ? <p className={r.empty}>No criteria recorded. Add them from the call below (or on the opportunity&apos;s Eligibility tab).</p> : (
              <table className={ui.table}><thead><tr><th>Criterion</th><th>Weight</th><th>Our response</th><th>Evidence</th></tr></thead><tbody>
                {a.scoring.map((s, i) => <tr key={i}><td className={ui.wrap}>{s.criterion}</td><td>{s.weight || "—"}</td><td><textarea name={`score_${i}`} defaultValue={s.response} aria-label="Response" style={{ width: "100%", minHeight: 50 }} /></td><td><input name={`scoreEv_${i}`} defaultValue={s.evidence} aria-label="Evidence" placeholder="document, metric, source" /></td></tr>)}
              </tbody></table>
            )}
            <div className={f.inline} style={{ marginTop: 8 }}><input name="criterionNew" placeholder="Add a criterion from the call" aria-label="New criterion" style={{ minWidth: 320 }} /><input name="weightNew" placeholder="Weight" aria-label="Weight" style={{ width: 90 }} /><button className="btn btn--primary" type="submit">Save</button></div>
          </form>
        </section>
      )}
      {tab === "applicant" && <Applicant d={d} />}
      {tab === "consortium" && <Consortium d={d} gaps={gaps} />}
      {tab === "workplan" && <Workplan d={d} today={today} />}
      {tab === "narrative" && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Narrative</span><form action={draftProposalAction}><input type="hidden" name="id" value={o.id} /><button className={ui.miniBtn} type="submit">{a.narrative.length ? "Redraft from records" : "Draft from records"}</button></form></p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Drafts rest on the call text, the lead applicant and project records and approved bid library blocks. Each section is labelled; missing evidence is never filled in.</p>
          {(a.narrative.length ? a.narrative : o.read?.proposal?.sections ?? []).map((s, i) => { const b = s.basis ?? "draft"; return <div key={i} style={{ marginBottom: 12 }}><span className={f.basis} data-b={b}>{DRAFT_BASIS[b as keyof typeof DRAFT_BASIS] ?? b}</span><b>{s.heading}</b><p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, margin: "4px 0 0" }}>{s.body}</p></div>; })}
          {!a.narrative.length && !o.read?.proposal && <p className={r.empty}>No draft yet.</p>}
          {o.read?.proposal?.gaps.length ? <><b>Missing evidence / to confirm</b><ul>{o.read.proposal.gaps.map(g => <li key={g}>{g}</li>)}</ul></> : null}
        </section>
      )}
      {tab === "budget" && <Budget d={d} internal={internal} />}
      {tab === "evidence" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Evidence</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>What each criterion rests on. Required outcomes / KPIs from the call: {[...(o.details.objectives?.outcomes ?? []), ...(o.details.objectives?.kpis ?? [])].join("; ") || "not recorded"}.</p>
          <table className={ui.table}><tbody>{a.scoring.map((s, i) => <tr key={i}><td>{s.criterion}</td><td className={s.evidence ? undefined : f.warn}>{s.evidence || "Missing evidence"}</td></tr>)}</tbody></table>
          {d.project && <p className={ui.sub}>Project evidence (studies, readiness, documents) is on <Link href={`/projects/${d.project.id}?tab=readiness`}>{d.project.name}</Link>. For formal analysis use the <Link href="/workbench">Analyst workbench</Link>.</p>}
        </section>
      )}
      {tab === "attachments" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Attachments and letters</p>
          <dl className={r.kv}><dt>Attachments</dt><dd>{o.details.application?.attachments?.join(", ") || "Not recorded"}</dd><dt>Forms</dt><dd>{o.details.application?.forms?.join(", ") || "Not recorded"}</dd><dt>Letters</dt><dd>{o.details.application?.letters?.join(", ") || "Not recorded"}</dd></dl>
          <p className={ui.sub}>Partner documents by member:</p>
          <ul>{d.members.map(m => <li key={m.m.id}>{m.m.name}: {m.m.documents.join(", ") || "none listed"} · {CONSORTIUM_STATUSES[m.m.status as keyof typeof CONSORTIUM_STATUSES]}</li>)}</ul>
        </section>
      )}
      {tab === "compliance" && <Compliance d={d} />}
      {tab === "reviews" && <Reviews d={d} next={next} />}
      {tab === "submission" && <Submission d={d} internal={internal} />}
      {tab === "activity" && <Activity ids={[id, ...d.members.map(m => m.m.id), ...(d.award ? [d.award.id] : [])]} />}
    </>
  );
}

type D = NonNullable<Awaited<ReturnType<typeof loadApplication>>>;

async function Overview({ d, internal, next }: { d: D; internal: boolean; next: string | null }) {
  const { a } = d;
  const people = internal ? await appDb().select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.mandateId, a.mandateId)) : [];
  const teamOf = (role: string) => a.team.find(t => t.role === role)?.person ?? "";
  return (
    <div className={r.grid}>
      <section className={r.panel}>
        <p className={r.panelTitle}>Team and ownership</p>
        <form action={saveApplicationAction} className={f.grid2}>
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="tab" value="overview" />
          <label>Delivery owner<input name="owner" defaultValue={a.owner ?? ""} /></label>
          <label>Internal deadline<input type="date" name="internalDeadline" defaultValue={a.internalDeadline ?? ""} /></label>
          <label>Requested amount<input name="requestedAmount" inputMode="decimal" defaultValue={a.requestedAmount ?? ""} /></label>
          <label>Match / co-finance secured<input name="matchAmount" inputMode="decimal" defaultValue={a.matchAmount ?? ""} /></label>
          {(["lead", "funding_lead", "proposal_manager", "analyst", "sme", "financial_modeler"] as const).map(role => (
            <label key={role}>{TEAM_ROLES[role]}<input name={`team_${role}`} defaultValue={teamOf(role)} list="people" /></label>
          ))}
          <datalist id="people">{people.map(p => <option key={p.id} value={p.email ?? p.name}>{p.name}</option>)}</datalist>
          <div className={f.full}><button className="btn btn--primary" type="submit">Save</button></div>
        </form>
        {a.team.find(t => t.role === "lead") && !a.team.find(t => t.role === "proposal_manager") && <p className={f.warn} style={{ fontSize: 12.5 }}>No proposal manager assigned: coordination (deadlines, attachments, compliance) falls to the lead. Delegate it where staff exists.</p>}
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Where it stands</p>
        <dl className={r.kv}>
          <dt>Review state</dt><dd>{APPLICATION_STATES[a.state as keyof typeof APPLICATION_STATES]}{next ? ` → next: ${APPLICATION_STATES[next as keyof typeof APPLICATION_STATES]}` : ""}</dd>
          <dt>Engagement</dt><dd>{d.eng ? <Link href={`/commercial/engagements/${d.eng.id}`}>{d.eng.name}</Link> : "None linked"}</dd>
          <dt>Project</dt><dd>{d.project ? <Link href={`/projects/${d.project.id}`}>{d.project.name}</Link> : "None linked"}</dd>
          <dt>Bid / no-bid</dt><dd>{d.review ? `${d.review.decision ?? "pending"} · ${d.review.decidedBy ?? ""}` : "No review linked"}</dd>
          <dt>Blockers</dt><dd>{d.tasks.filter(t => t.status === "blocked").map(t => t.title).join(", ") || "None"}</dd>
        </dl>
      </section>
    </div>
  );
}

async function Applicant({ d }: { d: D }) {
  const lead = d.lead;
  const regs = lead ? await appDb().select().from(orgRegistrations).where(eq(orgRegistrations.orgId, lead.id)) : [];
  const required = d.o.details.eligibility?.registrations ?? [];
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Applicant {lead ? `· ${lead.name}` : ""}</span>{lead && <Link href={`/companies/${lead.id}`}>Organization</Link>}</p>
      {!lead ? <p className={r.empty}>Regenera is the applicant. Set a lead applicant when creating the workspace for client-led bids.</p> : <>
        <p className={ui.sub} style={{ marginTop: 0 }}>Registrations and compliance. Not every call needs the same ones{required.length ? `; this call lists: ${required.join(", ")}` : ""}.</p>
        <table className={ui.table}><thead><tr><th>Registration</th><th>Status</th><th>Reference</th><th>Expires</th><th /></tr></thead><tbody>
          {Object.entries(REGISTRATIONS).map(([k, label]) => { const x = regs.find(g => g.kind === k); return (
            <tr key={k}><td>{label}{required.some(q => q.toLowerCase().includes(k) || label.toLowerCase().includes(q.toLowerCase())) && <span className={ui.sub}>required by the call</span>}</td>
              <td colSpan={4}><form action={setRegistrationAction} className={f.inline}>
                <input type="hidden" name="orgId" value={lead.id} /><input type="hidden" name="kind" value={k} /><input type="hidden" name="back" value={`/funding/applications/${d.a.id}?tab=applicant`} />
                <select name="status" defaultValue={x?.status ?? "unknown"} aria-label="Status">{["unknown", "missing", "in_progress", "active", "expired"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
                <input name="reference" defaultValue={x?.reference ?? ""} placeholder="Reference (no secrets)" aria-label="Reference" /><input type="date" name="expires" defaultValue={x?.expires ?? ""} aria-label="Expires" />
                <button className={ui.miniBtn} type="submit">Save</button></form></td></tr>); })}
        </tbody></table>
      </>}
    </section>
  );
}

async function Consortium({ d, gaps }: { d: D; gaps: Awaited<ReturnType<typeof applicationGaps>> }) {
  const orgs = await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.mandateId, d.a.mandateId), isNull(organizations.archivedAt))).orderBy(organizations.name).limit(1000);
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}>Consortium gaps</p>
        <table className={ui.table}><thead><tr><th>Required</th><th>Current</th><th>Status</th><th /></tr></thead><tbody>
          {gaps.map(g => <tr key={g.requirement}><td>{g.requirement}</td><td>{g.member ?? "—"}</td><td><span className={f.state} data-s={g.status === "confirmed" ? "confirmed" : g.status === "missing" ? "blocked" : "incomplete"}>{g.status.replace("_", " ")}</span></td>
            <td>{g.status === "missing" && <span className={ui.rowActions}><Link className={ui.miniBtn} href={`/network?q=${encodeURIComponent(g.requirement)}`}>Find partner</Link><Link className={ui.miniBtn} href={`/companies?q=${encodeURIComponent(g.requirement)}`}>Search organizations</Link></span>}</td></tr>)}
        </tbody></table>
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Members ({d.members.length})</p>
        {d.members.length > 0 && <table className={ui.table}><thead><tr><th>Organization</th><th>Role</th><th>Eligibility</th><th>Capability · contribution</th><th className={ui.num}>Budget</th><th>Documents</th><th>Contact · owner</th><th>Status</th></tr></thead><tbody>
          {d.members.map(({ m, contact }) => <tr key={m.id}><td>{m.orgId ? <Link href={`/companies/${m.orgId}`}>{m.name}</Link> : m.name}</td><td>{CONSORTIUM_ROLES[m.role as keyof typeof CONSORTIUM_ROLES]}</td><td>{APPLICANT_ELIGIBILITY[m.eligibility as keyof typeof APPLICANT_ELIGIBILITY]?.label}</td>
            <td className={ui.wrap}>{[m.capability, m.contribution].filter(Boolean).join(" · ") || "—"}</td><td className={ui.num}>{m.budget ? compactMoney(m.budget, d.a.currency) : "—"}</td><td className={ui.sub}>{m.documents.join(", ") || "—"}</td><td className={ui.sub}>{[contact, m.owner].filter(Boolean).join(" · ") || "—"}</td>
            <td><form action={memberStatusAction} className={f.inline}><input type="hidden" name="id" value={m.id} /><select name="status" defaultValue={m.status} aria-label="Status">{Object.entries(CONSORTIUM_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form></td></tr>)}
        </tbody></table>}
        <form action={addMemberAction} className={f.grid3} style={{ marginTop: 10 }}>
          <input type="hidden" name="applicationId" value={d.a.id} />
          <label>From the CRM<select name="orgId" defaultValue=""><option value="">— or type a name →</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Name (if not in the CRM)<input name="name" /></label>
          <label>Role<select name="role">{Object.entries(CONSORTIUM_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Capability<input name="capability" /></label><label>Contribution<input name="contribution" /></label><label>Budget<input name="budget" inputMode="decimal" /></label>
          <label>Documents required<input name="documents" placeholder="letter of commitment, CV…" /></label><label>Relationship owner<input name="owner" /></label>
          <label>Eligibility<select name="eligibility" defaultValue="uncertain">{Object.entries(APPLICANT_ELIGIBILITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <div><button className="btn btn--primary" type="submit">Add member</button></div>
        </form>
      </section>
    </>
  );
}

async function Workplan({ d, today }: { d: D; today: string }) {
  const title = new Map(d.tasks.map(t => [t.id, t.title]));
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Workplan</span><span className={ui.sub}>Planned back from the deadline; dependencies shown. Founder work: origination, relationships, structuring and senior review. Delegate chasing, formatting, routine research and deadline administration.</span></p>
      <table className={ui.table}>
        <thead><tr><th>Item</th><th>Role</th><th>Owner · reviewer</th><th>Due</th><th>Depends on</th><th className={ui.num}>Hours plan / actual</th><th>Status</th></tr></thead>
        <tbody>{d.tasks.map(t => (
          <tr key={t.id}>
            <td className={ui.wrap}>{t.title}<span className={ui.sub}>{APPLICATION_TABS[t.tab as keyof typeof APPLICATION_TABS]}</span></td>
            <td>{TEAM_ROLES[t.role as keyof typeof TEAM_ROLES] ?? "—"}</td>
            <td colSpan={5}>
              <form action={applicationTaskAction} className={f.inline}>
                <input type="hidden" name="id" value={t.id} />
                <input name="owner" defaultValue={t.owner ?? ""} placeholder="Owner" aria-label="Owner" style={{ width: 150 }} />
                <input name="reviewer" defaultValue={t.reviewer ?? ""} placeholder="Reviewer" aria-label="Reviewer" style={{ width: 130 }} />
                <input type="date" name="due" defaultValue={t.due ?? ""} aria-label="Due" className={t.due && t.due < today && t.status !== "done" ? f.warn : undefined} />
                <span className={ui.sub} style={{ minWidth: 120 }}>{t.dependsOn ? title.get(t.dependsOn) : "—"}</span>
                <input name="hoursBudget" defaultValue={t.hoursBudget} aria-label="Hours budgeted" style={{ width: 56 }} />
                <input name="hoursActual" defaultValue={t.hoursActual} aria-label="Hours actual" style={{ width: 56 }} />
                <select name="status" defaultValue={t.status} aria-label="Status">{Object.entries(TASK_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <button className={ui.miniBtn} type="submit">Save</button>
              </form>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

async function Budget({ d, internal }: { d: D; internal: boolean }) {
  const { a } = d;
  const req = a.budgetLines.reduce((s, l) => s + (l.match ? 0 : l.amount), 0), match = a.budgetLines.reduce((s, l) => s + (l.match ? l.amount : 0), 0);
  const members = internal ? await appDb().select().from(teamMembers).where(eq(teamMembers.mandateId, a.mandateId)) : [];
  const time = internal && d.eng ? await appDb().select().from(timeEntries).where(eq(timeEntries.engagementId, d.eng.id)) : [];
  const rates = new Map(members.filter(m => m.costRate != null).flatMap(m => [[(m.email ?? m.name).toLowerCase(), m.costRate!], [m.name.toLowerCase(), m.costRate!]] as [string, number][]));
  const budget = d.tasks.map(t => ({ role: t.role ?? "other", hours: t.hoursBudget, rate: members.find(m => m.role === t.role)?.costRate ?? 0 }));
  const actualLines = d.tasks.filter(t => t.hoursActual > 0).map(t => ({ person: t.owner ?? t.role ?? "unassigned", hours: t.hoursActual }));
  const fee = d.eng ? d.eng.fee + d.eng.monthlyFee * d.eng.months : 0;
  const pva = plannedVsActual({ fee, budget, time: time.length ? time.map(t => ({ person: t.person, hours: t.hours })) : actualLines, rates, otherCost: 0 });
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}>Application budget (what is requested from the funder)</p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Requested {compactMoney(a.requestedAmount ?? req, a.currency)} · match / co-finance {compactMoney(a.matchAmount ?? match, a.currency)}{d.o.matchRequirement ? ` · call requires ${d.o.matchRequirement}` : d.o.cofinancingPct ? ` · call requires ${d.o.cofinancingPct}%` : ""}. Budget lines are prepared with the applicant; the budget workplan item holds the working file.</p>
      </section>
      {internal && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Regenera delivery economics (internal)</span>{d.eng && <Link href={`/commercial/engagements/${d.eng.id}`}>Engagement</Link>}</p>
          {!d.eng ? <p className={r.empty}>Link an engagement to see fee, cost and margin.</p> : <>
            <div className={f.econ}>
              <div><b>{compactMoney(fee, d.eng.currency)}</b><span>Client fee</span></div>
              <div><b>{pva.planned.hours}</b><span>Budgeted hours</span></div><div><b>{pva.actual.hours}</b><span>Actual hours</span></div>
              <div><b>{compactMoney(pva.planned.cost, d.eng.currency)}</b><span>Planned cost</span></div><div><b>{compactMoney(pva.actual.cost, d.eng.currency)}</b><span>Actual cost</span></div>
              <div><b>{compactMoney(pva.actual.grossProfit, d.eng.currency)}</b><span>Gross profit</span></div><div><b>{pva.actual.grossMarginPct ?? "—"}%</b><span>Gross margin</span></div>
              <div><b>{pva.actual.effectiveRate ? compactMoney(pva.actual.effectiveRate, d.eng.currency) : "—"}</b><span>Effective rate / hr</span></div>
            </div>
            {pva.unratedPeople.length > 0 && <p className={f.warn} style={{ fontSize: 12.5 }}>No cost rate for {pva.unratedPeople.join(", ")}: their hours count at 0. Set rates in <Link href="/capacity?tab=team">Capacity</Link>.</p>}
            {budget.some(b => !b.rate) && <p className={ui.sub}>Planned cost uses each role&apos;s first team member rate; roles without a rate count at 0.</p>}
            <table className={ui.table}><thead><tr><th>Cost by role (planned)</th><th className={ui.num}>Cost</th></tr></thead><tbody>{deliveryEconomics({ fee, lines: budget }).byRole.map(x => <tr key={x.role}><td>{TEAM_ROLES[x.role as keyof typeof TEAM_ROLES] ?? x.role}</td><td className={ui.num}>{compactMoney(x.cost, d.eng!.currency)}</td></tr>)}</tbody></table>
          </>}
        </section>
      )}
      {internal && <AllocationForm d={d} />}
    </>
  );
}

async function AllocationForm({ d }: { d: D }) {
  const members = await appDb().select({ id: teamMembers.id, name: teamMembers.name, role: teamMembers.role }).from(teamMembers).where(and(eq(teamMembers.mandateId, d.a.mandateId), eq(teamMembers.active, true)));
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Allocate team capacity</span><Link href="/capacity">Capacity</Link></p>
      {members.length === 0 ? <p className={r.empty}>No team members yet. Add people and cost rates in <Link href="/capacity?tab=team">Capacity</Link>.</p> : (
        <form action={saveAllocationAction} className={f.inline}>
          <input type="hidden" name="applicationId" value={d.a.id} /><input type="hidden" name="kind" value="client" /><input type="hidden" name="back" value={`/funding/applications/${d.a.id}?tab=budget`} />
          {d.eng && <input type="hidden" name="engagementId" value={d.eng.id} />}
          <select name="memberId" aria-label="Person">{members.map(m => <option key={m.id} value={m.id}>{m.name} · {TEAM_ROLES[m.role as keyof typeof TEAM_ROLES]}</option>)}</select>
          <input type="date" name="week" required aria-label="Week" /><input name="hours" placeholder="Hours / week" aria-label="Hours per week" style={{ width: 100 }} /><input name="weeks" placeholder="Weeks" aria-label="Weeks" style={{ width: 70 }} />
          <button className={ui.miniBtn} type="submit">Allocate</button>
        </form>
      )}
    </section>
  );
}

function Compliance({ d }: { d: D }) {
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Compliance checklist</p>
      <form action={saveApplicationAction}>
        <input type="hidden" name="id" value={d.a.id} /><input type="hidden" name="tab" value="compliance" />
        {d.a.compliance.length === 0 ? <p className={r.empty}>No compliance items recorded from the call.</p> : (
          <table className={ui.table}><tbody>{d.a.compliance.map((c, i) => <tr key={i}><td>{c.item}</td><td><select name={`comp_${i}`} defaultValue={c.status} aria-label="Status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="na">Not applicable</option></select></td></tr>)}</tbody></table>
        )}
        <div className={f.inline} style={{ marginTop: 8 }}><input name="complianceNew" placeholder="Add an item (form, registration, certification…)" aria-label="New item" style={{ minWidth: 320 }} /><button className="btn btn--primary" type="submit">Save</button></div>
      </form>
    </section>
  );
}

function Reviews({ d, next }: { d: D; next: string | null }) {
  const { a } = d;
  const terminal = ["submitted", "awarded", "unsuccessful", "withdrawn"].includes(a.state);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}><span>Review</span><span className={ui.sub}>{APPLICATION_ORDER.map(s => APPLICATION_STATES[s]).join(" → ")}</span></p>
      <ul className={r.timeline}>{a.reviewLog.map((l, i) => <li key={i}><span className={r.when}>{l.at.slice(0, 16).replace("T", " ")}</span><span>{APPLICATION_STATES[l.state as keyof typeof APPLICATION_STATES]} · {l.by}{l.note ? ` · ${l.note}` : ""}</span></li>)}</ul>
      {!terminal && next && next !== "submitted" && (
        <form action={advanceApplicationAction} className={f.inline} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={next} />
          <input name="note" placeholder="Review note" aria-label="Note" style={{ minWidth: 300 }} />
          <button className="btn btn--primary" type="submit">Move to {APPLICATION_STATES[next as keyof typeof APPLICATION_STATES]}</button>
        </form>
      )}
      {next === "approved" && <p className={ui.sub}>Approval for submission is a person&apos;s decision and needs the workplan finished (except the submission itself). AI cannot approve or submit.</p>}
      {!terminal && a.state !== "first_draft" && <form action={advanceApplicationAction} style={{ marginTop: 8 }}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="first_draft" /><input type="hidden" name="note" value="Sent back for redrafting" /><button className={ui.miniBtn} type="submit">Send back to first draft</button></form>}
    </section>
  );
}

async function Submission({ d, internal }: { d: D; internal: boolean }) {
  const { a } = d;
  const [pathway] = d.award?.pathwayId ? await appDb().select().from(fundingPathways).where(eq(fundingPathways.id, d.award.pathwayId)) : [];
  const structures = pathway ? await appDb().select({ id: capitalStructures.id, name: capitalStructures.name }).from(capitalStructures).where(eq(capitalStructures.projectId, pathway.projectId)) : [];
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}>Submission record</p>
        {a.state === "approved" ? (
          <>
            <p className={ui.sub} style={{ marginTop: 0 }}>Approved by {a.approvedBy} on {a.approvedAt?.slice(0, 10)}. Submit on the funder&apos;s portal yourself (or the applicant does), then record it here. The OS never submits externally.</p>
            <form action={advanceApplicationAction} className={f.grid3}>
              <input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="submitted" />
              <label>Portal<input name="portal" required /></label><label>Confirmation ID<input name="confirmationId" required /></label><label>Submitted at<input name="at" placeholder="YYYY-MM-DD HH:MM" /></label>
              <label>Final version (file / link)<input name="finalVersion" /></label><label>Acknowledgment<input name="acknowledgment" /></label><label>Expected award date<input type="date" name="expectedAwardDate" /></label>
              <div><button className="btn btn--primary" type="submit">Record submission</button></div>
            </form>
          </>
        ) : a.submission.at ? (
          <dl className={r.kv}>
            <dt>Submitted</dt><dd>{a.submission.at?.slice(0, 16).replace("T", " ")} by {a.submission.submittedBy}</dd><dt>Portal</dt><dd>{a.submission.portal || "—"}</dd><dt>Confirmation</dt><dd>{a.submission.confirmationId || "—"}</dd>
            <dt>Final version</dt><dd>{a.submission.finalVersion || "—"}</dd><dt>Acknowledgment</dt><dd>{a.submission.acknowledgment || "—"}</dd><dt>Expected award</dt><dd>{a.submission.expectedAwardDate || "—"}</dd>
          </dl>
        ) : <p className={r.empty}>Not yet approved for submission.</p>}
      </section>
      {a.state === "submitted" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Outcome</p>
          <form action={recordAwardAction} className={f.grid3}>
            <input type="hidden" name="id" value={a.id} />
            <label>Award amount<input name="amount" required inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={a.currency} maxLength={3} /></label><label>Agreement reference<input name="agreementRef" /></label>
            <label>Period start<input type="date" name="periodStart" /></label><label>Period end<input type="date" name="periodEnd" /></label><label>Co-finance<input name="cofinance" /></label>
            <label className={f.full}>Reporting schedule (one per line: YYYY-MM-DD label)<textarea name="reporting" /></label>
            <label className={f.full}>Milestones (one per line: YYYY-MM-DD label)<textarea name="milestones" /></label>
            <label className={f.full}>Conditions<textarea name="conditions" /></label>
            <label className={f.inline}><input type="checkbox" name="postAward" defaultChecked={!!a.leadOrgId} /> Open a post-award program engagement</label>
            <label>Post-award fee / month<input name="monthlyFee" inputMode="decimal" /></label>
            <div><button className="btn btn--primary" type="submit">Record award</button></div>
          </form>
          <div className={ui.rowActions} style={{ marginTop: 10 }}>
            <form action={markUnsuccessfulAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="unsuccessful" /><button className="btn" type="submit">Not awarded</button></form>
          </div>
        </section>
      )}
      {d.award && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Award · {compactMoney(d.award.amount, d.award.currency)}</span>{d.award.postAwardEngagementId && <Link href={`/commercial/engagements/${d.award.postAwardEngagementId}`}>Post-award engagement</Link>}</p>
          <dl className={r.kv}>
            <dt>Agreement</dt><dd>{d.award.agreementRef || "—"}</dd><dt>Period</dt><dd>{d.award.periodStart ?? "?"} → {d.award.periodEnd ?? "?"}</dd>
            <dt>Reporting</dt><dd>{d.award.reporting.map(x => `${x.due ?? "?"} ${x.label}`).join("; ") || "—"}</dd><dt>Milestones</dt><dd>{d.award.milestones.map(x => `${x.due ?? "?"} ${x.label}`).join("; ") || "—"}</dd>
            <dt>Conditions</dt><dd>{d.award.conditions || "—"}</dd>
          </dl>
          {pathway && (
            <>
              <p className={ui.sub}>Capital stack: the award is an approved funding pathway on the project ({compactMoney(pathway.amount ?? 0, pathway.currency)}). {pathway.structureLayerId ? "It is in a capital structure (counted once)." : "Add it to a structure:"}</p>
              {!pathway.structureLayerId && (structures.length ? (
                <form action={pathwayToStackAction} className={f.inline}><input type="hidden" name="pathwayId" value={pathway.id} /><select name="structureId" aria-label="Structure">{structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className={ui.miniBtn} type="submit">Add to capital structure</button></form>
              ) : <p className={ui.sub}>No capital structure on the project yet. <Link href={`/projects/${pathway.projectId}?tab=stack`}>Create one</Link>.</p>)}
            </>
          )}
          {internal && d.lead && (
            <details style={{ marginTop: 10 }}><summary className={ui.primary}>Record an expansion need for {d.lead.name}</summary>
              <form action={addExpansionAction} className={f.grid3} style={{ marginTop: 8 }}>
                <input type="hidden" name="orgId" value={d.lead.id} /><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="back" value={`/funding/applications/${a.id}?tab=submission`} />
                <label>Need<select name="kind">{Object.entries(EXPANSION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Estimated value<input name="estimatedValue" inputMode="decimal" /></label>
                <label className={f.full}>Why it is relevant (evidence, not a pitch)<input name="relevance" required minLength={12} /></label>
                <div><button className={ui.miniBtn} type="submit">Record</button></div>
              </form>
            </details>
          )}
        </section>
      )}
    </>
  );
}

async function Activity({ ids }: { ids: string[] }) {
  const rows = await appDb().select().from(auditLog).where(inArray(auditLog.entityId, ids.slice(0, 90))).orderBy(desc(auditLog.createdAt)).limit(80);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Activity</p>
      {rows.length === 0 ? <p className={r.empty}>No recorded activity.</p> : <ul className={r.timeline}>{rows.map(a => <li key={a.id}><span className={r.when}>{a.createdAt.slice(0, 16).replace("T", " ")}</span><span>{a.action.replace(/_/g, " ")} · {a.actor}</span></li>)}</ul>}
    </section>
  );
}
