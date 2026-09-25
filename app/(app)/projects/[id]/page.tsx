import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { kindLabel, lifecycleLabel } from "@/lib/contracts/labels";
import { compactMoney, stageLabel } from "@/lib/projects/labels";
import { fundingForProject, getProject, projectPickers } from "@/lib/projects/queries";
import {
  ASSET_CLASSES, CAPITAL_STATUSES, CONSTRAINT_CATEGORIES, CONSTRAINT_STATUSES, INSTRUMENTS, PARTY_ROLES, PROJECT_STAGES,
  PROJECT_STATUSES, READINESS_DIMENSIONS, READINESS_STATUSES, REGENERA_ROLES, SEVERITIES,
} from "@/lib/projects/vocab";
import { DEAL_STAGES, SECTORS, TERRITORIAL_SYSTEMS } from "@/lib/vocab";
import {
  addConstraintAction, addPartyAction, addProjectTaskAction, addRequirementAction, addTrancheAction, constraintStatusAction,
  linkToProjectAction, removePartyAction, setReadinessAction, setStageAction, updateProjectAction, updateRequirementAction,
} from "../../project-actions";
import { createOpportunityAction } from "../../capital-actions";
import { GATE_STATES } from "@/lib/capital/vocab";
import styles from "../projects.module.css";
import RegulatoryTab from "../regulatory-tab";
import PlaceTab from "../place-tab";
import RiskTab from "../risk-tab";
import PlanTab from "../plan-tab";
import EngineeringTab from "../engineering-tab";
import EconomicsTab from "../economics-tab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project" };

const TABS = [["overview", "Overview"], ["place", "Place"], ["readiness", "Readiness"], ["plan", "Plan"], ["constraints", "Constraints"], ["engineering", "Engineering"], ["risk", "Risk & E&S"], ["capital", "Capital"], ["economics", "Economics"], ["regulatory", "Regulatory"], ["partners", "Partners"], ["contracts", "Contracts"], ["funding", "Funding"], ["activity", "Activity"]] as const;

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/projects");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getProject(user.scope, id);
  if (!data) notFound();
  const { p } = data;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const today = new Date().toISOString().slice(0, 10);
  const openCons = data.constraints.filter(c => c.status === "open" || c.status === "in_progress");
  const blockedDims = data.readiness.filter(x => x.status === "blocked");
  const knownDims = data.readiness.filter(x => x.status !== "unknown").length;
  const sponsor = data.parties.find(x => x.party.role === "sponsor");
  const developer = data.parties.find(x => x.party.role === "developer");
  const needs = tab === "partners" || tab === "contracts" ? await projectPickers(user.scope) : null;
  const funding = tab === "funding" ? await fundingForProject(user.scope, p) : [];

  return (
    <>
      <PageHeader title={p.name} actions={<><a className="btn btn--primary" href={withBase(`/api/projects/brief?id=${p.id}`)} download>Project brief (PDF)</a><Link className="btn" href="/projects">All projects</Link></>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6, marginBottom: 12 }}>
        <span className={ui.chip}>{stageLabel(p.stage)}</span> {PROJECT_STATUSES[p.status]}
        {p.assetClass ? ` · ${ASSET_CLASSES[p.assetClass]}` : ""}{p.capacity ? ` · ${p.capacity} ${p.capacityUnit ?? ""}` : ""}
        {[p.municipality, p.subdivision, p.country].filter(Boolean).length ? ` · ${[p.municipality, p.subdivision, p.country].filter(Boolean).join(", ")}` : " · Location not set"}
        {p.regeneraRole ? ` · Regenera: ${REGENERA_ROLES[p.regeneraRole]}` : ""}
      </p>
      <nav className={ui.tabs} aria-label="Project sections">
        {TABS.map(([k, label]) => (
          <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/projects/${p.id}${k === "overview" ? "" : `?tab=${k}`}`}>
            {label}{k === "constraints" && openCons.length ? ` (${openCons.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className={r.grid}>
          <div>
            <section className={r.panel}>
              <p className={r.panelTitle}>What needs attention</p>
              {blockedDims.length === 0 && openCons.length === 0 && knownDims === 0 ? (
                <p className={r.empty}>Nothing recorded yet. Start with Readiness: every dimension is Unknown until someone records evidence.</p>
              ) : (
                <ul className={r.timeline}>
                  {blockedDims.map(b => <li key={b.id}><span className={r.when} style={{ color: "#b0432f" }}>Blocked</span><span>{READINESS_DIMENSIONS[b.dimension]}{b.evidence ? `: ${b.evidence}` : ""}</span></li>)}
                  {openCons.slice(0, 8).map(c => (
                    <li key={c.id}><span className={r.when} style={{ color: c.severity === "critical" || c.severity === "high" ? "#b0432f" : undefined }}>{SEVERITIES[c.severity]}</span>
                      <span>{CONSTRAINT_CATEGORIES[c.category]}: {c.description}{c.owner ? ` · ${c.owner}` : ""}{c.deadline ? ` · due ${c.deadline}${c.deadline < today ? " (overdue)" : ""}` : ""}</span></li>
                  ))}
                  <li><span className={r.when}>Readiness</span><span>{knownDims} of 14 dimensions have a recorded status</span></li>
                </ul>
              )}
            </section>
            <section className={r.panel}>
              <p className={r.panelTitle}>Capital</p>
              {data.capital.byCurrency.length === 0 ? <p className={r.empty}>No capital requirements yet. Break the capital need into requirements (pre-development, development, equity, senior debt …) on the Capital tab.</p> : (
                <dl className={r.kv}>{data.capital.byCurrency.map(c => (
                  <div key={c.currency} style={{ display: "contents" }}>
                    <dt>Target ({c.currency})</dt><dd>{compactMoney(c.target, c.currency)} · secured {compactMoney(c.secured, c.currency)}
                      <div className={styles.bar}><i style={{ width: `${c.target ? Math.min(100, Math.round((c.secured / c.target) * 100)) : 0}%` }} /></div></dd>
                    <dt>Needed in 180 days</dt><dd>{compactMoney(c.neededNow, c.currency)}</dd>
                  </div>
                ))}</dl>
              )}
            </section>
            <section className={r.panel}>
              <p className={r.panelTitle}>Identity and place</p>
              <form action={updateProjectAction}>
                <input type="hidden" name="id" value={p.id} />
                <div className={styles.grid2}>
                  <label className={styles.wide}>Name<input name="name" defaultValue={p.name} /></label>
                  <label className={styles.wide}>Description<textarea name="description" defaultValue={p.description} rows={3} /></label>
                  <label>Asset class<select name="assetClass" defaultValue={p.assetClass ?? ""}><option value="">Not set</option>{Object.entries(ASSET_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Sector<select name="sector" defaultValue={p.sector ?? ""}><option value="">Not set</option>{Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Subsector<input name="subsector" defaultValue={p.subsector ?? ""} /></label>
                  <label>Technology<input name="technology" defaultValue={p.technology ?? ""} /></label>
                  <label>Capacity<input name="capacity" inputMode="decimal" defaultValue={p.capacity ?? ""} /></label>
                  <label>Unit<input name="capacityUnit" defaultValue={p.capacityUnit ?? ""} placeholder="MW, MWh, m³/day, t/yr, ha" /></label>
                  <label>CAPEX<input name="capex" inputMode="decimal" defaultValue={p.capex ?? ""} /></label>
                  <label>Currency<input name="currency" defaultValue={p.currency ?? ""} placeholder="USD" /></label>
                  <label>Status<select name="status" defaultValue={p.status}>{Object.entries(PROJECT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Regenera role<select name="regeneraRole" defaultValue={p.regeneraRole ?? ""}><option value="">Not set</option>{Object.entries(REGENERA_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Country<input name="country" defaultValue={p.country ?? ""} /></label>
                  <label>State / province<input name="subdivision" defaultValue={p.subdivision ?? ""} /></label>
                  <label>Municipality<input name="municipality" defaultValue={p.municipality ?? ""} /></label>
                  <label>Origination source<input name="originationSource" defaultValue={p.originationSource ?? ""} /></label>
                  <label>Latitude<input name="lat" inputMode="decimal" defaultValue={p.lat ?? ""} /></label>
                  <label>Longitude<input name="lng" inputMode="decimal" defaultValue={p.lng ?? ""} /></label>
                  <label className={styles.wide}>Boundary (GeoJSON polygon, optional)<textarea name="geometry" defaultValue={p.geometry ?? ""} rows={2} placeholder='{"type":"Polygon","coordinates":[...]}' /></label>
                </div>
                <button className="btn btn--primary" type="submit" style={{ marginTop: 10 }}>Save</button>
              </form>
            </section>
          </div>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>At a glance</p>
              <dl className={r.kv}>
                <dt>Stage</dt><dd>{stageLabel(p.stage)} since {p.stageChangedAt.slice(0, 10)}</dd>
                <dt>Sponsor</dt><dd>{sponsor ? (sponsor.party.orgId ? <Link href={`/companies/${sponsor.party.orgId}`}>{sponsor.orgName}</Link> : sponsor.contactName) : "Unknown"}</dd>
                <dt>Developer</dt><dd>{developer ? developer.orgName ?? developer.contactName : "Unknown"}</dd>
                <dt>CAPEX</dt><dd>{compactMoney(p.capex, p.currency ?? "USD")}</dd>
                <dt>Opportunities</dt><dd>{data.deals.length ? data.deals.map(d => d.name).join(", ") : "None linked"}</dd>
                <dt>Systems</dt><dd>{p.systems.length ? p.systems.map(s => TERRITORIAL_SYSTEMS[s as keyof typeof TERRITORIAL_SYSTEMS] ?? s).join(", ") : "Not assessed"}</dd>
                <dt>Owner</dt><dd>{p.ownerEmail ?? "—"}</dd>
              </dl>
            </section>
            <section className={r.panel}>
              <p className={r.panelTitle}>Move stage</p>
              <form action={setStageAction} className={styles.stack}>
                <input type="hidden" name="id" value={p.id} />
                <select name="stage" defaultValue={p.stage} aria-label="Stage">{Object.entries(PROJECT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="reason" placeholder="Why (kept in the history)" aria-label="Reason" />
                <button className="btn" type="submit">Set stage</button>
              </form>
              <ul className={r.timeline} style={{ marginTop: 10 }}>{data.history.slice(0, 6).map(h => (
                <li key={h.id}><span className={r.when}>{h.at.slice(0, 10)}</span><span>{h.fromStage ? `${stageLabel(h.fromStage)} → ` : ""}{stageLabel(h.toStage)}{h.reason ? ` · ${h.reason}` : ""}</span></li>
              ))}</ul>
            </section>
            <section className={r.panel}>
              <p className={r.panelTitle}>Add an action</p>
              <form action={addProjectTaskAction} className={styles.stack}>
                <input type="hidden" name="id" value={p.id} />
                <input name="title" required placeholder="Next action" aria-label="Action" />
                <input name="dueAt" type="date" aria-label="Due" />
                <button className="btn" type="submit">Add to Tasks</button>
              </form>
              {data.tasks.filter(t => t.status !== "done").length > 0 && (
                <ul className={r.timeline} style={{ marginTop: 10 }}>{data.tasks.filter(t => t.status !== "done").map(t => <li key={t.id}><span className={r.when}>{t.dueAt?.slice(0, 10)}</span><span>{t.title}</span></li>)}</ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {tab === "readiness" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Readiness by dimension</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Status comes with evidence. Unknown stays Unknown until someone records what is known; there is no overall score.</p>
          <div className={styles.readiness}>
            {(Object.keys(READINESS_DIMENSIONS) as (keyof typeof READINESS_DIMENSIONS)[]).map(dim => {
              const row = data.readiness.find(x => x.dimension === dim);
              const status = row?.status ?? "unknown";
              return (
                <div key={dim} className={styles.dim}>
                  <b><span>{READINESS_DIMENSIONS[dim]}</span><span className={styles[`s_${status}`]}>{READINESS_STATUSES[status]}</span></b>
                  <form action={setReadinessAction}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="dimension" value={dim} />
                    <select name="status" defaultValue={status} aria-label={`${READINESS_DIMENSIONS[dim]} status`}>{Object.entries(READINESS_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="evidence" defaultValue={row?.evidence ?? ""} placeholder="Evidence (document, source, date)" aria-label="Evidence" />
                    <input name="owner" defaultValue={row?.owner ?? ""} placeholder="Owner" aria-label="Owner" />
                    <button className={ui.miniBtn} type="submit">Save</button>
                  </form>
                  {row?.updatedBy && <span className={ui.sub}>{row.updatedAt.slice(0, 10)} · {row.updatedBy}</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "constraints" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Constraints</p>
            {data.constraints.length === 0 ? <p className={r.empty}>No constraints recorded. Each one gets an owner, a resolution action and a deadline; high and critical ones appear on Today.</p> : (
              <table className={ui.table}><tbody>{data.constraints.map(c => (
                <tr key={c.id}>
                  <td><b>{CONSTRAINT_CATEGORIES[c.category]}</b> · <span style={{ color: c.severity === "critical" || c.severity === "high" ? "#b0432f" : undefined }}>{SEVERITIES[c.severity]}</span>
                    <span style={{ display: "block" }}>{c.description}</span>
                    <span className={ui.sub}>{[c.resolutionAction && `Resolution: ${c.resolutionAction}`, c.owner && `Owner: ${c.owner}`, c.deadline && `Due ${c.deadline}${c.deadline < today && c.status !== "resolved" ? " (overdue)" : ""}`, c.evidence && `Evidence: ${c.evidence}`].filter(Boolean).join(" · ")}</span></td>
                  <td>
                    <form action={constraintStatusAction} className={styles.inline}>
                      <input type="hidden" name="constraintId" value={c.id} />
                      <select name="status" defaultValue={c.status} aria-label="Status">{Object.entries(CONSTRAINT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <button className={ui.miniBtn} type="submit">Set</button>
                    </form>
                  </td>
                </tr>
              ))}</tbody></table>
            )}
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Add a constraint</p>
              <form action={addConstraintAction} className={styles.stack}>
                <input type="hidden" name="id" value={p.id} />
                <label>Category<select name="category" required>{Object.entries(CONSTRAINT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Description<textarea name="description" required minLength={3} rows={3} /></label>
                <label>Severity<select name="severity" defaultValue="medium">{Object.entries(SEVERITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Evidence<input name="evidence" /></label>
                <label>Owner<input name="owner" /></label>
                <label>Resolution action<input name="resolutionAction" /></label>
                <label>Deadline<input name="deadline" type="date" /></label>
                <button className="btn btn--primary" type="submit">Add</button>
              </form>
            </section>
          </aside>
        </div>
      )}

      {tab === "capital" && (
        <div className={r.grid}>
          <div>
            {data.capital.requirements.length === 0 ? <section className={r.panel}><p className={r.empty}>No capital requirements yet. Do not record the project as &quot;seeking $X&quot;: add one requirement per purpose and instrument (pre-development, development, sponsor equity, senior debt, mezzanine, catalytic …).</p></section> : data.capital.requirements.map(req => {
              const tr = data.capital.tranches.filter(t => t.requirementId === req.id);
              return (
                <section key={req.id} className={r.panel}>
                  <p className={r.panelTitle}><span>{req.purpose} · {INSTRUMENTS[req.instrument]}</span><span className={ui.chip}>{CAPITAL_STATUSES[req.status]}</span></p>
                  <dl className={r.kv}>
                    <dt>Target</dt><dd>{compactMoney(req.target, req.currency)}{req.minimum || req.maximum ? ` (range ${compactMoney(req.minimum, req.currency)} – ${compactMoney(req.maximum, req.currency)})` : ""} · secured {compactMoney(req.secured, req.currency)}</dd>
                    <dt>Stage / close</dt><dd>{req.stage ? PROJECT_STAGES[req.stage] : "—"} · {req.targetClose ?? "no target close"}</dd>
                    {req.useOfFunds && <><dt>Use of funds</dt><dd>{req.useOfFunds}</dd></>}
                    {(req.economics || req.term || req.seniority || req.security) && <><dt>Terms</dt><dd>{[req.economics, req.term, req.seniority, req.security].filter(Boolean).join(" · ")}</dd></>}
                    <dt>Regulatory</dt><dd>{req.regulatoryStatus}</dd>
                  </dl>
                  {data.capitalOpportunities.filter(co => co.requirementId === req.id).map(co => (
                    <p key={co.id} className={ui.sub}>Capital opportunity: <Link href={`/capital/opportunities/${co.id}`}>{co.title}</Link> · gate {GATE_STATES[co.gateState].toLowerCase()}</p>
                  ))}
                  <form action={createOpportunityAction} style={{ display: "inline-block", marginTop: 6 }}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="requirementId" value={req.id} /><button className={ui.miniBtn} type="submit">Offer to investors</button></form>
                  <form action={updateRequirementAction} className={styles.inline} style={{ marginTop: 8 }}>
                    <input type="hidden" name="requirementId" value={req.id} />
                    <select name="status" defaultValue={req.status} aria-label="Status">{Object.entries(CAPITAL_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="secured" defaultValue={req.secured} inputMode="decimal" aria-label="Secured" placeholder="Secured" style={{ width: 110 }} />
                    <input name="targetClose" type="date" defaultValue={req.targetClose ?? ""} aria-label="Target close" />
                    <button className={ui.miniBtn} type="submit">Update</button>
                  </form>
                  <p className={ui.sub}><b>Tranches</b></p>
                  {tr.length === 0 ? <p className={r.empty}>No tranches. A requirement can be offered in several tranches (for example by investor type or ticket).</p> : (
                    <table className={ui.table}><tbody>{tr.map(t => (
                      <tr key={t.id}><td>{t.name}<span className={ui.sub}>{INSTRUMENTS[t.instrument]}{t.targetInvestorType ? ` · for ${t.targetInvestorType}` : ""}{t.eligibility ? ` · eligibility: ${t.eligibility}` : ""}</span></td>
                        <td className={ui.num}>{compactMoney(t.target, t.currency)}<span className={ui.sub}>{t.minParticipation || t.maxParticipation ? `${compactMoney(t.minParticipation, t.currency)}–${compactMoney(t.maxParticipation, t.currency)} per investor` : ""}</span></td>
                        <td>{CAPITAL_STATUSES[t.status]}</td>
                        <td><form action={createOpportunityAction}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="trancheId" value={t.id} /><button className={ui.miniBtn} type="submit">Offer</button></form></td></tr>
                    ))}</tbody></table>
                  )}
                  <details style={{ marginTop: 8 }}><summary className={ui.sub}>Add a tranche</summary>
                    <form action={addTrancheAction} className={styles.grid2} style={{ marginTop: 8 }}>
                      <input type="hidden" name="requirementId" value={req.id} />
                      <label>Name<input name="name" required placeholder="e.g. Development tranche A" /></label>
                      <label>Instrument<select name="instrument" defaultValue={req.instrument}>{Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label>Target<input name="target" inputMode="decimal" /></label>
                      <label>Target investor type<input name="targetInvestorType" placeholder="e.g. family offices, DFIs" /></label>
                      <label>Min per investor<input name="minParticipation" inputMode="decimal" /></label>
                      <label>Max per investor<input name="maxParticipation" inputMode="decimal" /></label>
                      <label>Economics<input name="economics" /></label>
                      <label>Seniority<input name="seniority" /></label>
                      <label className={styles.wide}>Eligibility<input name="eligibility" placeholder="Who may participate (jurisdiction, investor classification)" /></label>
                      <button className="btn" type="submit">Add tranche</button>
                    </form>
                  </details>
                </section>
              );
            })}
          </div>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Add a capital requirement</p>
              <form action={addRequirementAction} className={styles.stack}>
                <input type="hidden" name="id" value={p.id} />
                <label>Purpose<input name="purpose" required placeholder="e.g. Pre-development, Senior debt" /></label>
                <label>Instrument<select name="instrument" required>{Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Stage<select name="stage" defaultValue=""><option value="">Not set</option>{Object.entries(PROJECT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Target<input name="target" inputMode="decimal" /></label>
                <label>Minimum<input name="minimum" inputMode="decimal" /></label>
                <label>Maximum<input name="maximum" inputMode="decimal" /></label>
                <label>Currency<input name="currency" defaultValue={p.currency ?? "USD"} /></label>
                <label>Target close<input name="targetClose" type="date" /></label>
                <label>Use of funds<textarea name="useOfFunds" rows={2} /></label>
                <label>Economics<input name="economics" /></label>
                <label>Term<input name="term" /></label>
                <label>Seniority<input name="seniority" /></label>
                <label>Security<input name="security" /></label>
                <button className="btn btn--primary" type="submit">Add requirement</button>
              </form>
            </section>
          </aside>
        </div>
      )}

      {tab === "regulatory" && <RegulatoryTab projectId={p.id} scope={user.scope} />}
      {tab === "place" && <PlaceTab project={p} />}
      {tab === "risk" && <RiskTab projectId={p.id} currency={p.currency ?? "USD"} />}
      {tab === "plan" && <PlanTab projectId={p.id} />}
      {tab === "engineering" && <EngineeringTab project={p} />}
      {tab === "economics" && <EconomicsTab project={p} caseId={sp.case} />}

      {tab === "partners" && needs && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Parties</p>
            {data.parties.length === 0 ? <p className={r.empty}>No parties yet. Record the sponsor, developer, ProjectCo, landowner, offtaker, EPC, lenders and counsel as they become known.</p> : (
              <table className={ui.table}><tbody>{data.parties.map(x => (
                <tr key={x.party.id}>
                  <td><b>{PARTY_ROLES[x.party.role]}</b><span className={ui.sub}>{x.party.confirmed === "confirmed" ? "Confirmed" : "Proposed"}{x.party.note ? ` · ${x.party.note}` : ""}</span></td>
                  <td>{x.party.orgId ? <Link href={`/companies/${x.party.orgId}`}>{x.orgName}</Link> : null}{x.party.contactId ? <><br /><Link href={`/people/${x.party.contactId}`}>{x.contactName}</Link></> : null}</td>
                  <td><form action={removePartyAction}><input type="hidden" name="partyId" value={x.party.id} /><button className={ui.miniBtn} type="submit">Remove</button></form></td>
                </tr>
              ))}</tbody></table>
            )}
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Add a party</p>
              <form action={addPartyAction} className={styles.stack}>
                <input type="hidden" name="id" value={p.id} />
                <label>Role<select name="role" required>{Object.entries(PARTY_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Organization<select name="orgId" defaultValue=""><option value="">None</option>{needs.orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <label>Person<select name="contactId" defaultValue=""><option value="">None</option>{needs.people.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <label>Note<input name="note" /></label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="confirmed" /> Confirmed</label>
                <button className="btn btn--primary" type="submit">Add</button>
              </form>
              <p className={ui.sub}>Missing someone? Add them in <Link href="/companies/new">Companies</Link> or <Link href="/people/new">People</Link> first.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "contracts" && needs && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Contracts and opportunities</p>
            {data.contracts.length === 0 && data.deals.length === 0 ? <p className={r.empty}>Nothing linked yet.</p> : (
              <table className={ui.table}><tbody>
                {data.deals.map(d => <tr key={d.id}><td>Opportunity: <Link href="/deals?view=table">{d.name}</Link></td><td>{DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES]}</td></tr>)}
                {data.contracts.map(c => <tr key={c.id}><td><Link href={`/contracts/${c.id}`}>{c.title}</Link><span className={ui.sub}>{kindLabel(c)}</span></td><td>{lifecycleLabel(c.lifecycle)}</td></tr>)}
              </tbody></table>
            )}
            <p className={ui.sub}><Link href="/contracts?tab=register">Register an agreement</Link> (land, PPA, interconnection, EPC, financing …) and choose this project; its obligations then appear on Today. <Link href={`/documents?project=${p.id}`}>Project documents</Link></p>
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Link an opportunity</p>
              <form action={linkToProjectAction} className={styles.stack}>
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="deal" />
                <select name="targetId" required defaultValue="" aria-label="Opportunity"><option value="" disabled>Choose</option>{needs.openDeals.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                <button className="btn" type="submit">Link</button>
              </form>
            </section>
          </aside>
        </div>
      )}

      {tab === "funding" && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Open funding that may fit</span><Link href="/funding">Funding</Link></p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Matched by sector and country (or calls open to any country). Eligibility still needs reading: open each call.</p>
          {funding.length === 0 ? <p className={r.empty}>No open calls match this project&apos;s sector and country yet{!p.sector || !p.country ? " (set sector and country on the Overview tab)" : ""}.</p> : (
            <table className={ui.table}><tbody>{funding.map(f => (
              <tr key={f.id}><td><Link href={`/funding/${f.id}`}>{f.title}</Link><span className={ui.sub}>{f.funder ?? ""}</span></td><td>{f.deadline ?? "Rolling"}</td><td className={ui.num}>{f.fit ?? "—"}</td></tr>
            ))}</tbody></table>
          )}
        </section>
      )}

      {tab === "activity" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Activity</p>
          {data.activities.length === 0 && data.history.length === 0 ? <p className={r.empty}>No activity yet.</p> : (
            <ul className={r.timeline}>
              {data.history.map(h => <li key={h.id}><span className={r.when}>{h.at.slice(0, 10)}</span><span>Stage {h.fromStage ? `${stageLabel(h.fromStage)} → ` : ""}{stageLabel(h.toStage)}{h.reason ? ` · ${h.reason}` : ""}{h.actor ? ` · ${h.actor}` : ""}</span></li>)}
              {data.activities.map(a => <li key={a.id}><span className={r.when}>{a.occurredAt.slice(0, 10)}</span><span>{a.detail}</span></li>)}
              {data.triggers.map(t => <li key={t.id}><span className={r.when}>{t.eventDate ?? ""}</span><span>Signal: <Link href={`/triggers/${t.id}`}>{t.summary}</Link></span></li>)}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
