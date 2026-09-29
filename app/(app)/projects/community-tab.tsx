// Community / rights workspace for one project: communities and authorities, rights, knowledge governance, consent and
// engagement, economic participation (structures, scenarios through the project model, governance rights), the three
// separate ledgers and funds, and commitments and grievances. Restricted knowledge content is never rendered here.
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import {
  capitalProfiles, communityEngagements, communityFunds, communityGovernanceRights, communityLedger, finModels, knowledgeHolders, knowledgePermissions, knowledgeUses,
} from "@/db/schema";
import type { projects } from "@/db/schema";
import type { StructureTerms } from "@/db/community";
import { withBase } from "@/lib/base-path";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { checkPermission, communityFit, communityGates, consentLabel, isExistenceOnly, ledgerTotals, misclassified, missingDisclosures, projectCommunityState, publicView, scenarioComparison } from "@/lib/community/engine";
import {
  ACCESS_STATUS, ACTIVITIES, AI_ACTIVITIES, AUTHORITY_POWERS, AUTHORITY_TYPES, COMMITMENT_STATUS, COMMITMENT_TYPES, COMMUNITY_GATES, COMMUNITY_TYPES, CONSENT_GRANTED, CONSENT_STATUS, CONSENT_TYPES,
  DISCLOSURES, ENGAGEMENT_FORMATS, GOVERNANCE_RIGHT_TYPES, GOVERNANCE_STATUS, GRIEVANCE_STATUS, KNOWLEDGE_CATEGORIES, LEDGER_ENTRY_STATUS, LEDGERS, LEGAL_NOTE, MATERIALITY,
  PARTICIPATION_TYPES, PERMISSION_STATUS, RIGHT_STATUS, RIGHT_TYPES, STAKE_FUNDING, STRUCTURE_STATUS, type ConsentStatus,
} from "@/lib/community/vocab";
import { compactMoney } from "@/lib/projects/labels";
import {
  addAuthorityAction, addCommitmentAction, addCommunityAction, addConsentAction, addEngagementAction, addFundAction, addGovernanceRightAction, addGrievanceAction, addHolderAction,
  addKnowledgeAction, addLedgerAction, addRightAction, addStructureAction, commitmentStatusAction, consentStatusAction, grievanceStatusAction, resolveRightAction, setPermissionAction,
  structureStatusAction, verifyCommunityAction, withdrawKnowledgeAction,
} from "../community-actions";
import s from "./natural.module.css";

type Project = typeof projects.$inferSelect;
type Scope = Parameters<typeof mandateCondition>[0];
type State = Awaited<ReturnType<typeof projectCommunityState>>;
const SECTIONS = [["overview", "Overview"], ["communities", "Communities & authority"], ["rights", "Rights"], ["knowledge", "Knowledge governance"], ["consent", "Consent / FPIC & engagement"], ["participation", "Economic participation"], ["ledgers", "Ledgers & funds"], ["commitments", "Commitments & grievances"]] as const;
const P = ({ projectId }: { projectId: string }) => <input type="hidden" name="projectId" value={projectId} />;
const Opts = ({ o }: { o: Record<string, string> }) => <>{Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>;
const tone = (ok: boolean) => ({ color: ok ? "#2f7d4f" : "#b0432f" });

export default async function CommunityTab({ project, scope, sec, sp }: { project: Project; scope: Scope; sec?: string; sp: Record<string, string | undefined> }) {
  const section = SECTIONS.some(([k]) => k === sec) ? sec! : "overview";
  const st = await projectCommunityState(appDb(), project.id);
  return <>
    <p className={ui.sub} style={{ margin: "4px 0 8px" }}>Rights before benefits. Compensation is not benefit sharing. Consultation is not consent. Knowledge access is governed, not assumed.</p>
    <nav className={ui.tabs} aria-label="Community sections">{SECTIONS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${section === k ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=community&sec=${k}`}>{l}</Link>)}</nav>
    {section === "overview" && <Overview project={project} st={st} />}
    {section === "communities" && <Communities project={project} st={st} />}
    {section === "rights" && <Rights project={project} st={st} />}
    {section === "knowledge" && <Knowledge project={project} st={st} />}
    {section === "consent" && <Consent project={project} st={st} />}
    {section === "participation" && <Participation project={project} scope={scope} st={st} modelId={sp.model} inflation={Number(sp.infl ?? 3)} discount={Number(sp.disc ?? 8)} />}
    {section === "ledgers" && <Ledgers project={project} st={st} />}
    {section === "commitments" && <Commitments project={project} st={st} />}
    <p className={ui.sub} style={{ marginTop: 16 }}>{LEGAL_NOTE}</p>
  </>;
}

function Overview({ project, st }: { project: Project; st: State }) {
  const g = communityGates(st);
  const fpic = st.consents.filter(c => c.consentType === "fpic");
  const cName = (id: string | null) => st.communities.find(c => c.id === id)?.name ?? "—";
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Community overview</p>
      {st.communities.length === 0 ? <p className={r.empty}>No communities recorded for this project. Start with <Link href={`/projects/${project.id}?tab=community&sec=communities`}>Communities & authority</Link>.</p> :
        <table className={ui.table}><thead><tr><th>Community</th><th>Type</th><th>Representation</th><th>Authority</th><th>Rights (open material)</th><th>FPIC</th><th>Structures</th><th>Knowledge</th></tr></thead><tbody>
          {st.communities.map(c => { const fp = fpic.filter(x => x.communityId === c.id); const openR = st.rights.filter(x => x.communityId === c.id && x.resolution === "open" && (x.materiality === "high" || x.materiality === "critical")).length; return <tr key={c.id}>
            <td className={ui.primary}>{c.name}{c.isDemo ? <span className={ui.chip}> DEMO</span> : null}</td><td>{COMMUNITY_TYPES[c.communityType]}</td>
            <td style={tone(c.representationVerified)}>{c.representationVerified ? "Verified" : "Not verified"}</td><td style={tone(c.authorityVerified)}>{c.authorityVerified ? "Verified" : "Not verified"}</td>
            <td style={openR ? tone(false) : undefined}>{st.rights.filter(x => x.communityId === c.id).length} ({openR})</td>
            <td>{fp.length ? fp.map(x => consentLabel(x.status as ConsentStatus)).join(", ") : "Not started"}</td>
            <td>{st.structures.filter(x => x.communityId === c.id).length}</td><td>{st.knowledge.filter(x => x.communityId === c.id).length}</td></tr>; })}
        </tbody></table>}
      <p className={r.panelTitle} style={{ marginTop: 14 }}>Community-governance gates</p>
      <p className={ui.sub}>Checked from the records; never passed by hand.</p>
      <table className={ui.table}><tbody>{COMMUNITY_GATES.map(gt => <tr key={gt.stage}><td className={ui.primary}>{gt.stage}</td><td>{gt.checks.map(c => <div key={c.key} style={tone(g[c.key])}>{g[c.key] ? "✓" : "○"} {c.label}</div>)}</td></tr>)}</tbody></table>
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Open items</p>
      <ul className={s.items} style={{ listStyle: "none", padding: 0 }}>
        {st.rights.filter(x => x.resolution === "open" && x.materiality !== "low").map(x => <li key={x.id}>Right · {RIGHT_TYPES[x.rightType]} ({MATERIALITY[x.materiality]}) · {cName(x.communityId)}</li>)}
        {st.consents.filter(c => c.consentRequired && !CONSENT_GRANTED.includes(c.status as ConsentStatus)).map(c => <li key={c.id}>Consent · {CONSENT_TYPES[c.consentType]} · {CONSENT_STATUS[c.status]}</li>)}
        {st.commitments.filter(c => c.dueDate && c.dueDate < new Date().toISOString().slice(0, 10) && c.status !== "fulfilled").map(c => <li key={c.id} style={tone(false)}>Overdue commitment · {c.description.slice(0, 60)}</li>)}
        {st.grievances.filter(x => !["resolved", "closed"].includes(x.status)).map(x => <li key={x.id}>Grievance · {GRIEVANCE_STATUS[x.status]}</li>)}
      </ul>
      <p className={ui.sub}>Portfolio view: <Link href="/community">Community & knowledge governance</Link>.</p>
    </section></aside>
  </div>;
}

function Communities({ project, st }: { project: Project; st: State }) {
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Communities</p>
      {st.communities.length === 0 ? <p className={r.empty}>No communities yet.</p> : st.communities.map(c => <article key={c.id} className={s.card}>
        <header><b>{c.name}</b>{c.preferredName ? <span className={ui.sub}> ({c.preferredName})</span> : null} <span className={ui.chip}>{COMMUNITY_TYPES[c.communityType]}</span>{c.isDemo ? <span className={ui.chip}>DEMO</span> : null}</header>
        <dl className={s.kv}><dt>People / nation / group</dt><dd>{c.peopleNationGroup || "—"}</dd><dt>Territory · jurisdiction</dt><dd>{[c.territoryName, c.jurisdiction, c.country].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Representative body · customary authority</dt><dd>{c.representativeBody || "—"} · {c.customaryAuthority || "—"}</dd><dt>Legal entity · tenure</dt><dd>{c.legalEntityName || "—"} · {c.tenureType || "—"}</dd>
          <dt>Rights status</dt><dd>customary {RIGHT_STATUS[c.customaryRightsStatus]} · statutory {RIGHT_STATUS[c.statutoryRightsStatus]} · resource {RIGHT_STATUS[c.resourceRightsStatus]} · cultural {RIGHT_STATUS[c.culturalRightsStatus]}</dd>
          <dt>Verified</dt><dd>representation <b style={tone(c.representationVerified)}>{c.representationVerified ? "yes" : "no"}</b> · authority <b style={tone(c.authorityVerified)}>{c.authorityVerified ? "yes" : "no"}</b>{c.verificationSource ? ` · ${c.verificationSource}` : ""}</dd>
          <dt>Known disputes</dt><dd>{c.knownDisputes || "—"}</dd></dl>
        <p className={r.panelTitle}>Authorities</p>
        {st.authorities.filter(a => a.communityId === c.id).length === 0 ? <p className={r.empty}>No authorities recorded. Knowledge permissions and consent need one.</p> :
          <table className={ui.table}><thead><tr><th>Authority</th><th>Type</th><th>Powers</th><th>Scope · not authorised</th><th>Status</th></tr></thead><tbody>
            {st.authorities.filter(a => a.communityId === c.id).map(a => <tr key={a.id}><td className={ui.primary}>{a.name}</td><td>{AUTHORITY_TYPES[a.authorityType]}</td><td className={ui.sub}>{a.powers.map(p => AUTHORITY_POWERS[p as keyof typeof AUTHORITY_POWERS] ?? p).join(", ") || "none"}{a.knowledgeCategories.length ? ` · governs ${a.knowledgeCategories.join(", ")}` : ""}</td><td className={ui.sub}>{a.scope}{a.subjectsNotAuthorized ? ` · not: ${a.subjectsNotAuthorized}` : ""}</td><td style={tone(a.verificationStatus === "verified")}>{a.verificationStatus}{a.termEnd ? ` · to ${a.termEnd}` : ""}</td></tr>)}
          </tbody></table>}
        <details><summary className={ui.sub}>Add authority</summary>
          <form action={addAuthorityAction} className={s.inline}><P projectId={project.id} /><input type="hidden" name="communityId" value={c.id} />
            <label>Name<input name="name" required /></label><label>Type<select name="authorityType"><Opts o={AUTHORITY_TYPES} /></select></label>
            <label>Individual / body<select name="individualOrBody"><option value="body">Body</option><option value="individual">Individual</option></select></label><label>Term ends<input name="termEnd" type="date" /></label>
            <label className={s.wide}>Scope<input name="scope" /></label><label className={s.wide}>Not authorised to decide<input name="subjectsNotAuthorized" /></label>
            <fieldset className={s.wide}><legend className={ui.sub}>Recorded powers</legend>{Object.entries(AUTHORITY_POWERS).map(([k, v]) => <label key={k} className={s.check}><input type="checkbox" name="powers" value={k} />{v}</label>)}</fieldset>
            <fieldset className={s.wide}><legend className={ui.sub}>Knowledge categories governed (blank = all)</legend><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{Object.entries(KNOWLEDGE_CATEGORIES).map(([k, v]) => <label key={k} className={s.check}><input type="checkbox" name="knowledgeCategories" value={k} />{v}</label>)}</div></fieldset>
            <label>Verification<select name="verificationStatus"><option value="unverified">Unverified</option><option value="verified">Verified</option></select></label><label className={s.wide}>Basis / documentation<input name="documentation" placeholder="Assembly act, statute, recognised customary process" /></label>
            <button className={ui.miniBtn} type="submit">Add authority</button></form></details>
        <details><summary className={ui.sub}>Record verification</summary>
          <form action={verifyCommunityAction} className={s.inline}><P projectId={project.id} /><input type="hidden" name="communityId" value={c.id} />
            <label className={s.check}><input type="checkbox" name="representationVerified" defaultChecked={c.representationVerified} /> Representation verified</label><label className={s.check}><input type="checkbox" name="authorityVerified" defaultChecked={c.authorityVerified} /> Authority verified</label>
            <label>Customary rights<select name="customaryRightsStatus" defaultValue={c.customaryRightsStatus}><Opts o={RIGHT_STATUS} /></select></label><label>Statutory rights<select name="statutoryRightsStatus" defaultValue={c.statutoryRightsStatus}><Opts o={RIGHT_STATUS} /></select></label>
            <label className={s.wide}>How verified (source)<input name="verificationSource" required defaultValue={c.verificationSource} /></label><button className={ui.miniBtn} type="submit">Save</button></form></details>
      </article>)}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add community</p>
      <form action={addCommunityAction} className={r.form}><P projectId={project.id} />
        <label>Name<input name="name" required /></label><label>Preferred name<input name="preferredName" /></label><label>People / nation / group<input name="peopleNationGroup" /></label>
        <label>Type<select name="communityType"><Opts o={COMMUNITY_TYPES} /></select></label><label>Country<input name="country" defaultValue={project.country ?? ""} /></label><label>Jurisdiction<input name="jurisdiction" /></label>
        <label>Territory<input name="territoryName" /></label><label>Primary language<input name="languagePrimary" /></label><label>Representative body<input name="representativeBody" /></label><label>Customary authority<input name="customaryAuthority" /></label>
        <label>Legal entity<input name="legalEntityName" /></label><label>Tenure type<input name="tenureType" placeholder="Ejido, communal, customary, freehold…" /></label><label>Known disputes<textarea name="knownDisputes" rows={2} /></label>
        <button className="btn" type="submit">Add</button></form>
      <p className={ui.sub}>Names starting with “DEMO” are labelled as sample data.</p></section></aside>
  </div>;
}

function Rights({ project, st }: { project: Project; st: State }) {
  const cName = (id: string) => st.communities.find(c => c.id === id)?.name ?? "—";
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}>Rights register</p>
      {st.rights.length === 0 ? <p className={r.empty}>No rights recorded.</p> : <table className={ui.table}><thead><tr><th>Right</th><th>Community</th><th>Basis</th><th>Status</th><th>Materiality</th><th>Requires</th><th>Resolution</th></tr></thead><tbody>
        {st.rights.map(x => <tr key={x.id}><td className={ui.primary}>{RIGHT_TYPES[x.rightType]}<span className={ui.sub}>{x.description}</span></td><td>{cName(x.communityId)}</td><td className={ui.sub}>{[x.legalBasis && `legal: ${x.legalBasis}`, x.customaryBasis && `customary: ${x.customaryBasis}`, x.sourceDocument].filter(Boolean).join(" · ") || "—"}</td>
          <td>{RIGHT_STATUS[x.status]}</td><td style={x.materiality === "high" || x.materiality === "critical" ? tone(false) : undefined}>{MATERIALITY[x.materiality]}</td>
          <td className={ui.sub}>{[x.consentRequired && "consent", x.compensationRequired && "compensation", x.mitigationRequired && "mitigation", x.negotiationRequired && "negotiation"].filter(Boolean).join(", ") || "—"}</td>
          <td><form action={resolveRightAction} className={s.mini}><P projectId={project.id} /><input type="hidden" name="rightId" value={x.id} /><select name="resolution" defaultValue={x.resolution} aria-label="Resolution"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="disclosed">Disclosed</option></select><input name="notes" defaultValue={x.notes} placeholder="how / where" aria-label="Notes" /><button className={ui.miniBtn} type="submit">Save</button></form></td></tr>)}
      </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add right</p>
      {st.communities.length === 0 ? <p className={r.empty}>Add a community first.</p> : <form action={addRightAction} className={r.form}><P projectId={project.id} />
        <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Right<select name="rightType"><Opts o={RIGHT_TYPES} /></select></label><label>Description<textarea name="description" rows={2} /></label>
        <label>Legal basis<input name="legalBasis" /></label><label>Customary basis<input name="customaryBasis" /></label><label>Geographic scope (generalised)<input name="geographicScope" /></label><label>Source document<input name="sourceDocument" /></label>
        <label>Status<select name="status" defaultValue="asserted"><Opts o={RIGHT_STATUS} /></select></label><label>Materiality<select name="materiality" defaultValue="unknown"><Opts o={MATERIALITY} /></select></label>
        {(["consentRequired", "compensationRequired", "mitigationRequired", "negotiationRequired"] as const).map(k => <label key={k} className={s.check}><input type="checkbox" name={k} /> {k.replace("Required", "")} required</label>)}
        <button className="btn" type="submit">Add</button></form>}
    </section></aside>
  </div>;
}

async function Knowledge({ project, st }: { project: Project; st: State }) {
  const ids = st.knowledge.map(k => k.id);
  const [perms, uses, holders] = await Promise.all([
    ids.length ? appDb().select().from(knowledgePermissions).where(inArray(knowledgePermissions.recordId, ids)) : [],
    ids.length ? appDb().select().from(knowledgeUses).where(inArray(knowledgeUses.recordId, ids)).orderBy(desc(knowledgeUses.usedAt)) : [],
    st.communities.length ? appDb().select().from(knowledgeHolders).where(and(inArray(knowledgeHolders.communityId, st.communities.map(c => c.id)), isNull(knowledgeHolders.deletedAt))) : [],
  ]);
  const contentAllowed = new Map<string, boolean>();
  for (const k of st.knowledge) contentAllowed.set(k.id, (await checkPermission(appDb(), k.id, "internal_research")).allowed);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Knowledge records</p>
      <p className={ui.sub}>No knowledge without governance. The OS holds governance metadata; protected content stays with its custodians. AI use starts prohibited; every permission needs a verified authority holding the relevant power (the person who shared knowledge is not that authority). Records are excluded from Ask the OS, the MCP server and global search.</p>
      {st.knowledge.length === 0 ? <p className={r.empty}>No knowledge records.</p> : st.knowledge.map(k => {
        const v = publicView(k), ps = perms.filter(p => p.recordId === k.id), us = uses.filter(u => u.recordId === k.id), existence = isExistenceOnly(k);
        return <article key={k.id} className={s.card}>
          <header><b>{v.title}</b> <span className={ui.chip}>{KNOWLEDGE_CATEGORIES[k.category]}</span> <span className={ui.chip}>{ACCESS_STATUS[k.accessStatus]}</span> <span className={ui.chip}>{GOVERNANCE_STATUS[k.governanceStatus]}</span>{k.withdrawn ? <span className={ui.chip} style={tone(false)}>WITHDRAWN</span> : null}</header>
          <p className={ui.sub}>{v.description || "—"}{!existence && k.protectedContentRef ? (contentAllowed.get(k.id) ? ` · Protected content held at: ${k.protectedContentRef}` : " · Protected content pointer recorded (not shown: no internal-research permission)") : ""}{v.location ? ` · area: ${v.location}` : ""}</p>
          {!existence && <table className={ui.table}><thead><tr><th>Activity</th><th>Status</th><th>Conditions · expiry · evidence</th></tr></thead><tbody>
            {ps.sort((a, b) => a.activity.localeCompare(b.activity)).map(p => <tr key={p.id}><td>{ACTIVITIES[p.activity]}{AI_ACTIVITIES.includes(p.activity) ? " (AI)" : ""}</td><td style={tone(p.status === "allowed" || p.status === "allowed_with_conditions")}>{PERMISSION_STATUS[p.status]}</td><td className={ui.sub}>{[p.conditions, p.expiryDate && `expires ${p.expiryDate}`, p.evidence].filter(Boolean).join(" · ") || "—"}</td></tr>)}
          </tbody></table>}
          {us.length > 0 && <p className={ui.sub}>Used in: {us.map(u => `${u.outputType} ${u.outputRef} (${u.status})`).join("; ")}</p>}
          {!existence && !k.withdrawn && <details><summary className={ui.sub}>Record a permission decision</summary>
            <form action={setPermissionAction} className={s.inline}><P projectId={project.id} /><input type="hidden" name="recordId" value={k.id} />
              <label>Activity<select name="activity"><Opts o={ACTIVITIES} /></select></label><label>Decision<select name="status"><option value="allowed">Allowed</option><option value="allowed_with_conditions">Allowed with conditions</option><option value="prohibited">Prohibited</option><option value="pending">Pending</option></select></label>
              <label>Approving authority<select name="authorityId" defaultValue=""><option value="">—</option>{st.authorities.filter(a => a.communityId === k.communityId).map(a => <option key={a.id} value={a.id}>{a.name} ({a.verificationStatus})</option>)}</select></label><label>Expires<input name="expiryDate" type="date" /></label>
              <label className={s.wide}>Conditions<input name="conditions" /></label><label className={s.wide}>Evidence of authorisation<input name="evidence" /></label><button className={ui.miniBtn} type="submit">Record</button></form></details>}
          {!k.withdrawn && <details><summary className={ui.sub}>Withdraw</summary>
            <form action={withdrawKnowledgeAction} className={s.inline}><P projectId={project.id} /><input type="hidden" name="recordId" value={k.id} />
              <label>Scope<select name="activity" defaultValue=""><option value="">Whole record</option><Opts o={ACTIVITIES} /></select></label><label className={s.wide}>Instruction (who, when, how received)<input name="reason" required /></label><button className={ui.miniBtn} type="submit">Withdraw and flag uses</button></form></details>}
        </article>; })}
    </section>
    <aside>
      <section className={r.panel}><p className={r.panelTitle}>Add knowledge record</p>
        {st.communities.length === 0 ? <p className={r.empty}>Add a community first.</p> : <form action={addKnowledgeAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Title (non-sensitive)<input name="title" required /></label><label>Category<select name="category"><Opts o={KNOWLEDGE_CATEGORIES} /></select></label>
          <label>Access status<select name="accessStatus" defaultValue="restricted"><Opts o={ACCESS_STATUS} /></select></label>
          <p className={ui.sub}>Sacred, secret, ceremonial, non-digitisable and existence-only records keep minimal metadata only: description, content pointer and location are discarded.</p>
          <label>Governance status<select name="governanceStatus" defaultValue="unknown"><Opts o={GOVERNANCE_STATUS} /></select></label>
          <label>Public description (what anyone who can see the record may read)<textarea name="descriptionPublic" rows={2} /></label>
          <label>Protected content held at (pointer only)<input name="protectedContentRef" placeholder="Custodian archive reference" /></label>
          <label>Holder<select name="holderId" defaultValue=""><option value="">—</option>{holders.map(h => <option key={h.id} value={h.id}>{h.anonymousPublicly ? h.preferredIdentifier || "Anonymous holder" : h.name}</option>)}</select></label>
          <label>Spatial sensitivity<select name="spatialSensitivity" defaultValue="hide"><option value="hide">Hide location</option><option value="generalise">Generalised area only</option><option value="none">Not sensitive</option></select></label><label>Generalised area<input name="generalizedArea" /></label>
          <label>Collection method<input name="collectionMethod" /></label><label>Collection date<input name="collectionDate" type="date" /></label><label>Original language<input name="originalLanguage" /></label>
          <button className="btn" type="submit">Add</button></form>}
      </section>
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>Add knowledge holder</p>
        <form action={addHolderAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Name<input name="name" required /></label><label>Preferred identifier<input name="preferredIdentifier" /></label>
          <label className={s.check}><input type="checkbox" name="namedPublicly" /> May be named publicly</label><label>Role<input name="role" /></label><label>Relationship to knowledge<input name="relationshipToKnowledge" /></label><label>Attribution preference<input name="attributionPreference" /></label>
          <button className="btn" type="submit">Add</button></form></section>}
    </aside>
  </div>;
}

async function Consent({ project, st }: { project: Project; st: State }) {
  const engagements = await appDb().select().from(communityEngagements).where(and(eq(communityEngagements.projectId, project.id), isNull(communityEngagements.deletedAt))).orderBy(desc(communityEngagements.date));
  const cName = (id: string) => st.communities.find(c => c.id === id)?.name ?? "—";
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Consent records</p>
      <p className={ui.sub}>Consent is an ongoing state. Only a verified authority with the recorded power can give it, with evidence and a date; missing disclosures are flagged on the record.</p>
      {st.consents.length === 0 ? <p className={r.empty}>No consent records.</p> : st.consents.map(c => { const miss = missingDisclosures(c.disclosures as Record<string, boolean>); const granted = CONSENT_GRANTED.includes(c.status as ConsentStatus); return <article key={c.id} className={s.card}>
        <header><b>{CONSENT_TYPES[c.consentType]}</b> · {cName(c.communityId)} <span className={ui.chip} style={tone(granted)}>{CONSENT_STATUS[c.status]}</span>{!c.consentRequired ? <span className={ui.chip}>not required</span> : null}</header>
        <dl className={s.kv}><dt>Scope</dt><dd>{c.scope || "—"}</dd><dt>Authority</dt><dd>{st.authorities.find(a => a.id === c.authorityId)?.name ?? "not set"}</dd><dt>Evidence · date · expiry</dt><dd>{c.evidence || "—"} · {c.consentDate ?? "—"} · {c.expiryDate ?? "—"}</dd>
          <dt>Conditions</dt><dd>{c.conditions || "—"}</dd><dt>Language · interpreter · method</dt><dd>{[c.languageUsed, c.interpreter, c.method].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Not disclosed</dt><dd style={miss.length ? tone(false) : undefined}>{miss.length ? miss.map(k => DISCLOSURES[k as keyof typeof DISCLOSURES]).join(", ") : "All disclosures recorded"}</dd>
          <dt>Withdrawal · re-consent triggers</dt><dd>{c.withdrawalMechanism || "—"} · {c.reconsentTriggers || "—"}</dd></dl>
        {c.history.length > 0 && <p className={ui.sub}>History: {c.history.map(h => `${h.at.slice(0, 10)} ${h.from}→${h.to} (${h.by})${h.note ? `: ${h.note}` : ""}`).join(" · ")}</p>}
        <form action={consentStatusAction} className={s.inline}><P projectId={project.id} /><input type="hidden" name="consentId" value={c.id} />
          <label>Status<select name="status" defaultValue={c.status}><Opts o={CONSENT_STATUS} /></select></label><label>Date<input name="date" type="date" /></label><label>Expiry<input name="expiryDate" type="date" /></label>
          <label className={s.wide}>Evidence<input name="evidence" placeholder="Signed act, minutes, recording reference" /></label><label className={s.wide}>Conditions<input name="conditions" /></label><label className={s.wide}>Note<input name="note" /></label><button className={ui.miniBtn} type="submit">Record</button></form>
      </article>; })}
      <p className={r.panelTitle} style={{ marginTop: 14 }}>Engagement timeline</p>
      {engagements.length === 0 ? <p className={r.empty}>No engagements recorded.</p> : <ul className={s.items} style={{ listStyle: "none", padding: 0 }}>{engagements.map(e => <li key={e.id} className={s.card}>
        <header><b>{e.date}</b> {ENGAGEMENT_FORMATS[e.format]} · {cName(e.communityId)}{e.location ? ` · ${e.location}` : ""}</header>
        <span className={ui.sub}>{[e.participants && `Participants: ${e.participants}`, e.interpreter && `Interpreter: ${e.interpreter}`].filter(Boolean).join(" · ")}</span>
        {e.topics && <span>Topics: {e.topics}</span>}{e.concerns && <span>Concerns: {e.concerns}</span>}{e.requests && <span>Requests: {e.requests}</span>}{e.commitmentsMade && <span>Commitments made: {e.commitmentsMade}</span>}
        {e.nextAction && <span className={ui.sub}>Next: {e.nextAction}{e.dueDate ? ` by ${e.dueDate}` : ""}{e.owner ? ` (${e.owner})` : ""}</span>}</li>)}</ul>}
    </section>
    <aside>
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>New consent record</p>
        <form action={addConsentAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Type<select name="consentType"><Opts o={CONSENT_TYPES} /></select></label>
          <label>Knowledge record (if knowledge consent)<select name="knowledgeRecordId" defaultValue=""><option value="">—</option>{st.knowledge.map(k => <option key={k.id} value={k.id}>{publicView(k).title}</option>)}</select></label>
          <label>Authority responsible<select name="authorityId" defaultValue=""><option value="">—</option>{st.authorities.map(a => <option key={a.id} value={a.id}>{a.name} ({a.verificationStatus})</option>)}</select></label>
          <label>Scope<textarea name="scope" rows={2} /></label>
          <fieldset><legend className={ui.sub}>Disclosed to the community</legend>{Object.entries(DISCLOSURES).map(([k, v]) => <label key={k} className={s.check}><input type="checkbox" name={`d_${k}`} /> {v}</label>)}</fieldset>
          <label>Language<input name="languageUsed" /></label><label>Interpreter<input name="interpreter" /></label><label>Method<input name="method" placeholder="Assembly decision, customary process…" /></label>
          <label>Withdrawal mechanism<input name="withdrawalMechanism" /></label><label>Re-consent triggers<input name="reconsentTriggers" placeholder="Design change, new partner, new use" /></label><label>Review date<input name="reviewDate" type="date" /></label>
          <label className={s.check}><input type="checkbox" name="notRequired" /> Consent not required (record why in scope)</label>
          <button className="btn" type="submit">Create</button></form></section>}
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>Record engagement</p>
        <form action={addEngagementAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Date<input name="date" type="date" required /></label><label>Format<select name="format"><Opts o={ENGAGEMENT_FORMATS} /></select></label><label>Location<input name="location" /></label>
          <label>Participants<input name="participants" /></label><label>Facilitator<input name="facilitator" /></label><label>Interpreter<input name="interpreter" /></label>
          <label>Topics<textarea name="topics" rows={2} /></label><label>Concerns<textarea name="concerns" rows={2} /></label><label>Requests<textarea name="requests" rows={2} /></label><label>Commitments made<textarea name="commitmentsMade" rows={2} /></label>
          <label>Next action<input name="nextAction" /></label><label>Due<input name="dueDate" type="date" /></label>
          <button className="btn" type="submit">Record</button></form></section>}
    </aside>
  </div>;
}

async function Participation({ project, scope, st, modelId, inflation, discount }: { project: Project; scope: Scope; st: State; modelId?: string; inflation: number; discount: number }) {
  const models = await appDb().select({ id: finModels.id, name: finModels.name, version: finModels.version }).from(finModels).where(eq(finModels.projectId, project.id)).orderBy(desc(finModels.updatedAt));
  const profiles = (await appDb().select({ id: capitalProfiles.id, name: capitalProfiles.name, a: capitalProfiles.communityAlignment }).from(capitalProfiles).where(and(mandateCondition(scope, capitalProfiles.mandateId), isNull(capitalProfiles.archivedAt)))).filter(x => x.a.preference !== "unknown" || x.a.flags.length || x.a.supported.length);
  const gov = await appDb().select().from(communityGovernanceRights).where(and(eq(communityGovernanceRights.projectId, project.id), isNull(communityGovernanceRights.deletedAt)));
  const mid = modelId && models.some(m => m.id === modelId) ? modelId : models[0]?.id;
  const cmp = mid && st.structures.length ? await scenarioComparison(appDb(), project.id, mid, { inflationPct: inflation, discountPct: discount }).catch(() => null) : null;
  const cur = project.currency ?? "USD";
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${x.toFixed(1)}%`);
  const max = cmp ? Math.max(1, ...cmp.scenarios.flatMap(x => x.result.rows.map(r => Math.abs(r.participation)))) : 1;
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Community economic participation</p>
      <p className={ui.sub}>Negotiated participation in project value, not charity. Contractual payments run through the project model as costs before debt service; community equity takes its share of distributions; carried equity dilutes investors without a community contribution. Compensation belongs in Ledger A and is never counted here.</p>
      {st.structures.length === 0 ? <p className={r.empty}>No structures yet. Add them by scenario (e.g. A, B, C) to compare trade-offs.</p> : <table className={ui.table}><thead><tr><th>Scenario</th><th>Structure</th><th>Type</th><th>Terms</th><th>Status</th><th /></tr></thead><tbody>
        {st.structures.sort((a, b) => a.scenario.localeCompare(b.scenario)).map(x => { const t = x.terms as StructureTerms; return <tr key={x.id}><td>{x.scenario}</td><td className={ui.primary}>{x.name}<span className={ui.sub}>{st.communities.find(c => c.id === x.communityId)?.name}</span></td><td>{PARTICIPATION_TYPES[x.type]}</td>
          <td className={ui.sub}>{[t.equityPct && `${t.equityPct}% equity${t.stakeFunding ? ` (${STAKE_FUNDING[t.stakeFunding]})` : ""}`, t.revenueSharePct && `${t.revenueSharePct}% revenue`, t.royaltyPct && `${t.royaltyPct}% royalty`, t.leasePerYear && `lease ${compactMoney(t.leasePerYear, cur)}/yr${t.leaseEscalationPct ? ` +${t.leaseEscalationPct}%` : ""}`, t.stewardshipPerYear && `stewardship ${compactMoney(t.stewardshipPerYear, cur)}/yr`, t.fundPctOfRevenue && `${t.fundPctOfRevenue}% to fund`, t.fixedPerYear && `${compactMoney(t.fixedPerYear, cur)}/yr`, x.inflationIndexed && "indexed"].filter(Boolean).join(" · ") || "—"}</td>
          <td><span className={ui.chip}>{STRUCTURE_STATUS[x.status]}</span></td>
          <td><form action={structureStatusAction} className={s.mini}><P projectId={project.id} /><input type="hidden" name="structureId" value={x.id} /><select name="status" defaultValue={x.status} aria-label="Status"><Opts o={STRUCTURE_STATUS} /></select><input name="agreement" placeholder="agreement ref" aria-label="Agreement" /><button className={ui.miniBtn} type="submit">Save</button></form></td></tr>; })}
      </tbody></table>}

      <p className={r.panelTitle} style={{ marginTop: 14 }}>Scenario comparison</p>
      {models.length === 0 ? <p className={r.empty}>Create a financial model on the Financials tab to model community economics.</p> : <form className={s.inline} action={withBase(`/projects/${project.id}`)} method="get">
        <input type="hidden" name="tab" value="community" /><input type="hidden" name="sec" value="participation" />
        <label>Model<select name="model" defaultValue={mid}>{models.map(m => <option key={m.id} value={m.id}>{m.name} v{m.version}</option>)}</select></label><label>Inflation %<input name="infl" defaultValue={inflation} /></label><label>Discount %<input name="disc" defaultValue={discount} /></label><button className={ui.miniBtn} type="submit">Recalculate</button></form>}
      {cmp && <>
        <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Scenario</th><th>Project IRR</th><th>Investor IRR</th><th>Investor MOIC</th><th>Min DSCR</th><th>Community / yr (avg)</th><th>Community nominal</th><th>Community real</th><th>Community NPV @{discount}%</th><th>Community IRR</th><th>Development (Ledger C)</th><th>Governance</th></tr></thead><tbody>
          <tr><td className={ui.sub}>No community terms</td><td className={ui.num}>{pct(cmp.withoutCommunity.projectIrr)}</td><td className={ui.num}>{pct(cmp.withoutCommunity.investorIrr)}</td><td className={ui.num}>{cmp.withoutCommunity.investorMoic === null ? "—" : `${cmp.withoutCommunity.investorMoic.toFixed(2)}x`}</td><td className={ui.num}>{cmp.withoutCommunity.minDscr?.toFixed(2) ?? "—"}</td><td colSpan={7} /></tr>
          {cmp.scenarios.map(x => <tr key={x.name}><td className={ui.primary}>{x.name}</td><td className={ui.num}>{pct(x.result.projectIrr)}</td><td className={ui.num}>{pct(x.result.investorIrr)}</td><td className={ui.num}>{x.result.investorMoic === null ? "—" : `${x.result.investorMoic.toFixed(2)}x`}</td><td className={ui.num}>{x.result.minDscr?.toFixed(2) ?? "—"}</td>
            <td className={ui.num}>{compactMoney(x.result.annualAverage, cur)}</td><td className={ui.num}>{compactMoney(x.result.communityNominal, cur)}</td><td className={ui.num}>{compactMoney(x.result.communityReal, cur)}</td><td className={ui.num}>{compactMoney(x.result.communityNpv, cur)}</td><td className={ui.num}>{pct(x.result.communityIrr)}</td><td className={ui.num}>{compactMoney(x.result.developmentNominal, cur)}</td>
            <td className={ui.sub}>{gov.filter(g => g.scenario === x.name).map(g => GOVERNANCE_RIGHT_TYPES[g.rightType]).join(", ") || "—"}</td></tr>)}
        </tbody></table></div>
        <p className={ui.sub}>Model: {cmp.model.name} v{cmp.model.version}. Figures are modelled outputs from the model&apos;s assumptions, not commitments. No structure is recommended: compare the trade-offs.</p>
        {cmp.scenarios.map(x => <div key={x.name} style={{ margin: "8px 0" }}><span className={ui.sub}>{x.name}: community cash by year (nominal)</span>
          <svg viewBox={`0 0 ${x.result.rows.length * 14} 60`} style={{ width: "100%", height: 60, display: "block" }} role="img" aria-label={`Community cash by year, scenario ${x.name}`}>
            {x.result.rows.map((row, i) => { const h = (Math.abs(row.participation) / max) * 54; return <rect key={i} x={i * 14 + 2} y={row.participation >= 0 ? 57 - h : 57} width={10} height={Math.max(0.5, h)} fill={row.participation >= 0 ? "#2f7d4f" : "#b0432f"}><title>{`Year ${row.year}: ${compactMoney(row.participation, cur)} (cumulative ${compactMoney(row.cumulative, cur)})`}</title></rect>; })}
          </svg></div>)}
      </>}
      <p className={r.panelTitle} style={{ marginTop: 14 }}>Community-aligned capital</p>
      {profiles.length === 0 ? <p className={r.empty}>No capital profiles have community alignment recorded. Add it on a <Link href="/capital">capital partner</Link> page.</p> : <table className={ui.table}><thead><tr><th>Capital partner</th><th>Fit by dimension (explained, not scored)</th></tr></thead><tbody>
        {profiles.map(pr => <tr key={pr.id}><td className={ui.primary}><Link href={`/capital/partners/${pr.id}`}>{pr.name}</Link><span className={ui.sub}>{pr.a.source}</span></td><td>{communityFit(pr.a, st.structures).map(d => <div key={d.dimension} className={ui.sub}><b style={d.result === "fit" ? tone(true) : d.result === "no_fit" ? tone(false) : undefined}>{d.result.replace("_", " ")}</b> · {d.dimension}: {d.why}</div>)}</td></tr>)}
      </tbody></table>}
      <p className={r.panelTitle} style={{ marginTop: 14 }}>Governance rights</p>
      {gov.length === 0 ? <p className={r.empty}>None recorded.</p> : <table className={ui.table}><thead><tr><th>Scenario</th><th>Right</th><th>Document</th><th>Scope · trigger</th><th>Approval</th></tr></thead><tbody>{gov.map(g => <tr key={g.id}><td>{g.scenario}</td><td>{GOVERNANCE_RIGHT_TYPES[g.rightType]}</td><td>{g.governingDocument || "—"}</td><td className={ui.sub}>{[g.scope, g.trigger].filter(Boolean).join(" · ")}</td><td>{g.approvalRequired ? `Required${g.votingThreshold ? ` (${g.votingThreshold})` : ""}` : "—"}</td></tr>)}</tbody></table>}
    </section>
    <aside>
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>Add participation structure</p>
        <form action={addStructureAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Scenario<input name="scenario" defaultValue="A" /></label><label>Name<input name="name" /></label><label>Type<select name="type"><Opts o={PARTICIPATION_TYPES} /></select></label>
          <label>Equity %<input name="equityPct" inputMode="decimal" /></label><label>Stake funding<select name="stakeFunding" defaultValue=""><option value="">—</option><Opts o={STAKE_FUNDING} /></select></label>
          <label>Revenue share %<input name="revenueSharePct" inputMode="decimal" /></label><label>Royalty %<input name="royaltyPct" inputMode="decimal" /></label>
          <label>Lease per year<input name="leasePerYear" inputMode="decimal" /></label><label>Lease escalation %<input name="leaseEscalationPct" inputMode="decimal" /></label>
          <label>Stewardship per year<input name="stewardshipPerYear" inputMode="decimal" /></label><label>Fund % of revenue<input name="fundPctOfRevenue" inputMode="decimal" /></label><label>Fixed per year<input name="fixedPerYear" inputMode="decimal" /></label>
          <label className={s.check}><input type="checkbox" name="inflationIndexed" /> Inflation-indexed</label>
          <label>Status<select name="status" defaultValue="concept"><Opts o={STRUCTURE_STATUS} /></select></label><label>Legal structure<input name="legalStructure" /></label><label>Rationale<textarea name="rationale" rows={2} /></label>
          <label>Transferability<input name="transferability" /></label><label>Change of control<input name="changeOfControl" /></label>
          <button className="btn" type="submit">Add</button></form></section>}
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>Add governance right</p>
        <form action={addGovernanceRightAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Scenario<input name="scenario" defaultValue="A" /></label><label>Right<select name="rightType"><Opts o={GOVERNANCE_RIGHT_TYPES} /></select></label>
          <label>Governing document<input name="governingDocument" /></label><label>Scope<input name="scope" /></label><label>Trigger<input name="trigger" /></label>
          <label className={s.check}><input type="checkbox" name="approvalRequired" /> Approval required</label><label>Voting threshold<input name="votingThreshold" /></label>
          <button className="btn" type="submit">Add</button></form></section>}
    </aside>
  </div>;
}

async function Ledgers({ project, st }: { project: Project; st: State }) {
  const [entries, funds] = await Promise.all([
    appDb().select().from(communityLedger).where(and(eq(communityLedger.projectId, project.id), isNull(communityLedger.deletedAt))).orderBy(asc(communityLedger.date)),
    appDb().select().from(communityFunds).where(and(eq(communityFunds.projectId, project.id), isNull(communityFunds.deletedAt))),
  ]);
  const tot = ledgerTotals(entries), bad = misclassified(entries), cur = project.currency ?? "USD";
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Three separate ledgers</p>
      <p className={ui.sub}>Never summed into one “community contribution” figure.</p>
      {bad.length > 0 && <p className={ui.warn}>{bad.length} entr{bad.length === 1 ? "y looks" : "ies look"} like compensation recorded outside Ledger A: {bad.map(b => b.category).join(", ")}. Compensation is not benefit sharing.</p>}
      <div className={s.cols3}>{(Object.keys(LEDGERS) as (keyof typeof LEDGERS)[]).map(k => <div key={k} className={s.card}><b>{LEDGERS[k].label}</b><span className={ui.sub}>{LEDGERS[k].help}</span>
        <span>Paid {compactMoney(tot[k].paid, cur)} · scheduled {compactMoney(tot[k].scheduled, cur)} · projected {compactMoney(tot[k].projected, cur)}{tot[k].overdue ? <b style={tone(false)}> · overdue {compactMoney(tot[k].overdue, cur)}</b> : null}</span>
        <table className={ui.table}><tbody>{entries.filter(e => e.ledger === k).map(e => <tr key={e.id}><td>{e.date}</td><td>{e.category}<span className={ui.sub}>{e.description}</span></td><td className={ui.num}>{compactMoney(e.amount, e.currency)}</td><td>{LEDGER_ENTRY_STATUS[e.status]}</td></tr>)}</tbody></table></div>)}</div>
      <p className={r.panelTitle} style={{ marginTop: 14 }}>Community funds</p>
      {funds.length === 0 ? <p className={r.empty}>No funds recorded.</p> : funds.map(f => <article key={f.id} className={s.card}><header><b>{f.name}</b> <span className={ui.sub}>{f.legalVehicle} · governed by {f.governanceBody || "—"}</span></header>
        <span className={ui.sub}>Beneficiaries: {f.beneficiaries || "—"} · trustee {f.trustee || "—"} · audit {f.auditRequirement || "—"} · balance {f.balance === null ? "—" : compactMoney(f.balance, f.currency)}</span>
        <span>Allocation (community-defined): {f.allocationPolicy.map(a => `${a.category} ${a.pct}%`).join(" · ") || "—"}</span></article>)}
    </section>
    <aside>
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>Ledger entry</p>
        <form action={addLedgerAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Ledger<select name="ledger">{Object.entries(LEDGERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Structure<select name="structureId" defaultValue=""><option value="">—</option>{st.structures.map(x => <option key={x.id} value={x.id}>{x.scenario} · {x.name}</option>)}</select></label>
          <label>Category<input name="category" required placeholder="Lease payment, crop compensation, school…" /></label><label>Description<input name="description" /></label>
          <label>Amount<input name="amount" required inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={cur} maxLength={3} /></label><label>Date<input name="date" type="date" required /></label>
          <label>Status<select name="status" defaultValue="scheduled"><Opts o={LEDGER_ENTRY_STATUS} /></select></label><label>Evidence<input name="evidence" /></label>
          <button className="btn" type="submit">Record</button></form></section>}
      {st.communities.length > 0 && <section className={r.panel}><p className={r.panelTitle}>Community fund</p>
        <form action={addFundAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId">{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Name<input name="name" required /></label><label>Legal vehicle<input name="legalVehicle" /></label><label>Governance body<input name="governanceBody" /></label><label>Beneficiaries<input name="beneficiaries" /></label>
          <label>Allocation policy <span className={ui.sub}>category: %, as the community defines</span><textarea name="allocation" rows={2} placeholder="Current priorities: 40, Future generations: 30, Emergency reserve: 10" /></label>
          <label>Spending policy<input name="spendingPolicy" /></label><label>Reserve policy<input name="reservePolicy" /></label><label>Trustee<input name="trustee" /></label><label>Audit<input name="auditRequirement" /></label><label>Balance<input name="balance" inputMode="decimal" /></label>
          <button className="btn" type="submit">Add</button></form></section>}
    </aside>
  </div>;
}

function Commitments({ project, st }: { project: Project; st: State }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className={r.grid}>
    <section className={r.panel}>
      <p className={r.panelTitle}>Commitments register</p>
      {st.commitments.length === 0 ? <p className={r.empty}>No commitments recorded.</p> : <table className={ui.table}><thead><tr><th>Commitment</th><th>Type</th><th>Owner · beneficiary</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead><tbody>
        {st.commitments.map(c => { const over = c.dueDate && c.dueDate < today && c.status !== "fulfilled" && c.status !== "terminated"; return <tr key={c.id}><td className={ui.primary}>{c.description}<span className={ui.sub}>{c.source}</span></td><td>{COMMITMENT_TYPES[c.type]}{c.recurrence !== "none" ? ` · ${c.recurrence}` : ""}</td><td className={ui.sub}>{c.owner ?? "no owner"} · {c.beneficiary || "—"}</td><td style={over ? tone(false) : undefined}>{c.dueDate ?? "—"}</td><td className={ui.num}>{c.amount ? compactMoney(c.amount, c.currency) : "—"}</td>
          <td><form action={commitmentStatusAction} className={s.mini}><P projectId={project.id} /><input type="hidden" name="commitmentId" value={c.id} /><select name="status" defaultValue={c.status} aria-label="Status"><Opts o={COMMITMENT_STATUS} /></select><input name="evidence" placeholder="evidence" defaultValue={c.evidence} aria-label="Evidence" /><button className={ui.miniBtn} type="submit">Save</button></form></td></tr>; })}
      </tbody></table>}
      <p className={r.panelTitle} style={{ marginTop: 14 }}>Grievances (confidential)</p>
      {st.grievances.length === 0 ? <p className={r.empty}>No grievances recorded.</p> : <table className={ui.table}><thead><tr><th>Received</th><th>Summary</th><th>Status · response</th></tr></thead><tbody>
        {st.grievances.map(g => <tr key={g.id}><td>{g.received}<span className={ui.sub}>{g.channel}</span></td><td>{g.summary}</td><td><form action={grievanceStatusAction} className={s.mini}><P projectId={project.id} /><input type="hidden" name="grievanceId" value={g.id} /><select name="status" defaultValue={g.status} aria-label="Status"><Opts o={GRIEVANCE_STATUS} /></select><input name="response" defaultValue={g.response} placeholder="response" aria-label="Response" /><button className={ui.miniBtn} type="submit">Save</button></form></td></tr>)}
      </tbody></table>}
    </section>
    <aside>
      <section className={r.panel}><p className={r.panelTitle}>Add commitment</p>
        <form action={addCommitmentAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId" defaultValue=""><option value="">—</option>{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Type<select name="type"><Opts o={COMMITMENT_TYPES} /></select></label><label>Description<textarea name="description" rows={2} required /></label><label>Source (agreement, engagement)<input name="source" /></label>
          <label>Owner<input name="owner" /></label><label>Beneficiary<input name="beneficiary" /></label><label>Start<input name="startDate" type="date" /></label><label>Due<input name="dueDate" type="date" /></label>
          <label>Recurrence<select name="recurrence"><option value="none">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
          <label>Amount<input name="amount" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} maxLength={3} /></label><label className={s.check}><input type="checkbox" name="indexed" /> Indexed</label>
          <label>Status<select name="status" defaultValue="proposed"><Opts o={COMMITMENT_STATUS} /></select></label><label className={s.check}><input type="checkbox" name="verificationRequired" /> Needs verification</label>
          <button className="btn" type="submit">Add</button></form></section>
      <section className={r.panel}><p className={r.panelTitle}>Record grievance</p>
        <form action={addGrievanceAction} className={r.form}><P projectId={project.id} />
          <label>Community<select name="communityId" defaultValue=""><option value="">—</option>{st.communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Received<input name="received" type="date" required /></label><label>Channel<input name="channel" /></label><label>Summary<textarea name="summary" rows={3} required /></label><label>Category<input name="category" /></label>
          <button className="btn" type="submit">Record</button></form></section>
    </aside>
  </div>;
}
