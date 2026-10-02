import Link from "next/link";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { accountConnections, authFailures, authSessions, loginEvents, mcpTokens, orgUnits, osInvites, portalGrants, portalUsers, teams, tenantMembers, tenantModules, tenants } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { appDb } from "@/lib/db/scoped";
import { canAdminTenant, canSetEntitlements, pickTenant } from "@/lib/tenancy/access";
import { seatUsage, tenantWorkspaces } from "@/lib/tenancy/engine";
import {
  CLIENT_MODULES, LANGUAGES, MODULES, ONBOARDING_STEPS, ORG_INVITE_FLASH, ORG_TYPES, OS_USER_TYPES, PERSONAS, PLANS, SUPPORT_TIERS, TEAM_KINDS, TENANT_STATUSES,
  UNIT_KINDS, UNIT_SYSTEMS, USER_TYPES,
} from "@/lib/tenancy/vocab";
import {
  addOrgUnitAction, applyPlanAction, createSandboxAction, deactivateOrgMemberAction, deleteTeamAction, inviteOrgUserAction, onboardingItemAction, reactivateOrgMemberAction,
  removeOrgUnitAction, requestModuleAction, revokeMemberTokenAction, revokeOrgInviteAction, saveAccountTermsAction, saveOrgProfileAction, saveTeamAction, setModuleAction, updateOrgMemberAction,
} from "../org-actions";
import s from "./org.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization" };

const TABS = [["profile", "Profile"], ["structure", "Structure"], ["users", "Users"], ["teams", "Teams"], ["modules", "Modules & plan"], ["security", "Security"], ["api", "API access"], ["data", "Data & sandbox"], ["onboarding", "Onboarding"]] as const;
type Unit = typeof orgUnits.$inferSelect;

function Tree({ units, parent, tenantId, admin }: { units: Unit[]; parent: string | null; tenantId: string; admin: boolean }) {
  const kids = units.filter(u => u.parentId === parent);
  if (!kids.length) return null;
  return (
    <ul className={s.tree}>
      {kids.map(u => (
        <li key={u.id}>
          <span className={s.node}><b>{u.name}</b> <span className={ui.chip}>{UNIT_KINDS[u.kind]}</span>{u.jurisdiction && <span className={ui.sub}> · {u.jurisdiction}</span>}{u.ownershipPct && <span className={ui.sub}> · {u.ownershipPct}% owned</span>}
            {admin && <form action={removeOrgUnitAction} className={s.inline}><input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="unitId" value={u.id} /><button className={ui.miniBtn} type="submit">Remove</button></form>}
          </span>
          <Tree units={units} parent={u.id} tenantId={tenantId} admin={admin} />
        </li>
      ))}
    </ul>
  );
}

export default async function OrgPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/org");
  const sp = await searchParams;
  const db = appDb();
  const tenantId = pickTenant(user.scope, sp.tenant);
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return <><PageHeader title="Organization" /><p className={r.empty}>No organization is set up for this account yet.</p></>;
  const admin = canAdminTenant(user.scope, t.id);
  const owner = canSetEntitlements(user.scope);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "profile";
  const [ws, members, units, teamRows, mods, invites, seats] = await Promise.all([
    tenantWorkspaces(db, t.id), db.select().from(tenantMembers).where(eq(tenantMembers.tenantId, t.id)).orderBy(tenantMembers.email),
    db.select().from(orgUnits).where(eq(orgUnits.tenantId, t.id)), db.select().from(teams).where(eq(teams.tenantId, t.id)).orderBy(teams.name),
    db.select().from(tenantModules).where(eq(tenantModules.tenantId, t.id)),
    db.select().from(osInvites).where(and(eq(osInvites.tenantId, t.id), isNull(osInvites.usedAt), isNull(osInvites.revokedAt), gt(osInvites.expiresAt, new Date().toISOString()))).orderBy(desc(osInvites.createdAt)),
    seatUsage(db, t.id),
  ]);
  const emails = members.map(m => m.email);
  const modOn = new Map(mods.map(m => [m.module, m]));
  const flash = (await cookies()).get(ORG_INVITE_FLASH)?.value;
  const teamName = new Map(teamRows.map(x => [x.id, x.name]));
  const hidden = <input type="hidden" name="tenantId" value={t.id} />;
  const userTypes = OS_USER_TYPES.filter(u => (t.kind === "regenera" ? u === "regenera_internal" || u === "read_only" : u !== "regenera_internal"));

  // Security and API data only for the tabs that need them.
  const sec = tab === "security" && emails.length ? await Promise.all([
    db.select().from(loginEvents).where(inArray(loginEvents.email, emails)).orderBy(desc(loginEvents.at)).limit(60),
    db.select({ email: authSessions.email, n: sql<number>`count(*)` }).from(authSessions).where(and(inArray(authSessions.email, emails), gt(authSessions.expiresAt, new Date().toISOString()))).groupBy(authSessions.email),
    db.select({ email: authFailures.email, n: sql<number>`count(*)` }).from(authFailures).where(and(inArray(authFailures.email, emails), gt(authFailures.at, new Date(new Date().getTime() - 86_400_000).toISOString()))).groupBy(authFailures.email),
    ws.length ? db.select({ email: portalUsers.email, kind: portalUsers.kind, status: portalUsers.status, last: portalUsers.lastLoginAt, grants: sql<number>`(select count(*) from ${portalGrants} g where g.portal_user_id = ${portalUsers.id} and g.revoked_at is null)` }).from(portalUsers).where(inArray(portalUsers.mandateId, ws.map(w => w.id))) : Promise.resolve([]),
    ws.length ? db.select().from(accountConnections).where(inArray(accountConnections.mandateId, ws.map(w => w.id))) : Promise.resolve([]),
  ]) : null;
  const tokens = (tab === "api" || tab === "security") && emails.length ? await db.select().from(mcpTokens).where(and(inArray(mcpTokens.userEmail, emails), eq(mcpTokens.kind, "personal"))).orderBy(desc(mcpTokens.createdAt)) : [];

  return (
    <>
      <PageHeader title={t.displayName} actions={<span className={ui.sub}>{ORG_TYPES[t.orgType]} · {TENANT_STATUSES[t.status]} · {PLANS[t.plan].label}{t.kind === "client" ? ` · ${SUPPORT_TIERS[t.supportTier]} support` : ""}</span>} />
      <Notice text={sp.notice} />
      {!admin && <p className={ui.sub}>You can view your organization. Changes are made by your organization&apos;s administrators.</p>}
      <nav className={ui.tabs} aria-label="Organization sections">
        {TABS.map(([k, label]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/org?tenant=${t.id}${k === "profile" ? "" : `&tab=${k}`}`}>{label}</Link>)}
      </nav>

      {tab === "profile" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Identity, units and reporting</p>
          <form action={saveOrgProfileAction} className={`${r.form} ${s.cols}`}>{hidden}
            <label>Display name<input name="displayName" defaultValue={t.displayName} disabled={!admin} /></label>
            <label>Legal name<input name="legalName" defaultValue={t.legalName} disabled={!admin} /></label>
            {t.kind === "client" && <label>Organization type<select name="orgType" defaultValue={t.orgType} disabled={!admin}>{Object.entries(ORG_TYPES).filter(([k]) => k !== "regenera").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
            <label>Jurisdiction<input name="jurisdiction" defaultValue={t.jurisdiction} disabled={!admin} /></label>
            <label>Headquarters<input name="headquarters" defaultValue={t.headquarters} disabled={!admin} /></label>
            <label>Website<input name="website" type="url" defaultValue={t.website} disabled={!admin} /></label>
            <label>Base currency<input name="baseCurrency" defaultValue={t.baseCurrency} maxLength={3} disabled={!admin} /></label>
            <label>Units<select name="units" defaultValue={t.units} disabled={!admin}>{Object.entries(UNIT_SYSTEMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Timezone<input name="timezone" defaultValue={t.timezone} placeholder="America/Los_Angeles" disabled={!admin} /></label>
            <label>Date format<select name="dateFormat" defaultValue={t.dateFormat} disabled={!admin}>{["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].map(f => <option key={f}>{f}</option>)}</select></label>
            <fieldset className={s.checks}><legend>Languages</legend>{Object.entries(LANGUAGES).map(([k, v]) => <label key={k}><input type="checkbox" name="languages" value={k} defaultChecked={t.languages.includes(k)} disabled={!admin} />{v}</label>)}</fieldset>
            <label className={s.wide}>Reporting preferences<textarea name="reportingPrefs" rows={2} defaultValue={t.reportingPrefs} placeholder="Quarterly portfolio review to IC; monthly project status to the executive team" disabled={!admin} /></label>
            <p className={`${r.panelTitle} ${s.wide}`}>Branding (reports and portal)</p>
            <label>Logo URL<input name="logoUrl" type="url" defaultValue={t.branding.logoUrl ?? ""} disabled={!admin} /></label>
            <label>Accent colour<input name="accent" defaultValue={t.branding.accent ?? ""} placeholder="#161816" disabled={!admin} /></label>
            <label className={s.wide}>Report footer<input name="reportFooter" defaultValue={t.branding.reportFooter ?? ""} placeholder="Confidential — prepared for …" disabled={!admin} /></label>
            {admin && <div className={s.wide}><button className="btn btn--primary" type="submit">Save profile</button></div>}
          </form>
          <p className={ui.sub}>Custom domains and white-label portals are an enterprise option arranged with Regenera; they are not self-service.</p>
        </section>
      )}

      {tab === "structure" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Organization structure</p>
            <div className={s.root}><b>{t.legalName}</b> <span className={ui.chip}>{ORG_TYPES[t.orgType]}</span></div>
            {units.length ? <Tree units={units} parent={null} tenantId={t.id} admin={admin} /> : <p className={r.empty}>No subsidiaries, funds, SPVs or business units recorded.</p>}
            <p className={ui.sub}>Workspaces holding this organization&apos;s data: {ws.map(w => `${w.name}${w.sandbox ? " (sandbox)" : ""}`).join(", ") || "none"}.</p>
          </section>
          {admin && <aside><section className={r.panel}><p className={r.panelTitle}>Add entity</p>
            <form action={addOrgUnitAction} className={r.form}>{hidden}
              <label>Name<input name="name" required placeholder="Alpha Infrastructure Fund I" /></label>
              <label>Kind<select name="kind">{Object.entries(UNIT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Parent<select name="parentId"><option value="">{t.displayName} (top)</option>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label>Jurisdiction<input name="jurisdiction" /></label>
              <label>Ownership %<input name="ownershipPct" inputMode="decimal" /></label>
              <label>Notes<textarea name="notes" rows={2} /></label>
              <button className="btn btn--primary" type="submit">Add</button>
            </form></section></aside>}
        </div>
      )}

      {tab === "users" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Members <span>{seats.purchased ? `${seats.used} / ${seats.purchased} seats` : `${seats.used} members`}</span></p>
            {flash && <p className={ui.notice}>Invitation for <b>{flash.split("|")[0]}</b>: <code className={s.code}>{flash.split("|")[1]}</code> — prefix with this site&apos;s address (…/os{flash.split("|")[1]}). Shown for five minutes.</p>}
            <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Member</th><th>Type</th><th>Persona</th><th>Teams</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>
              {members.map(m => (
                <tr key={m.id}>
                  <td className={ui.primary}>{m.name || m.email}<span className={ui.sub}>{m.email}</span>
                    {admin && m.email !== user.email && (
                      <details className={s.edit}><summary>Edit</summary>
                        <form action={updateOrgMemberAction} className={r.form}>{hidden}<input type="hidden" name="email" value={m.email} />
                          <label>Type<select name="userType" defaultValue={m.userType}>{userTypes.map(u => <option key={u} value={u}>{USER_TYPES[u].label}</option>)}</select></label>
                          <label>Persona<select name="persona" defaultValue={m.persona}>{Object.entries(PERSONAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                          {teamRows.length > 0 && <fieldset className={s.checks}><legend>Teams</legend>{teamRows.map(x => <label key={x.id}><input type="checkbox" name="teams" value={x.id} defaultChecked={m.teams.includes(x.id)} />{x.name}</label>)}</fieldset>}
                          {t.kind === "client" && <fieldset className={s.checks}><legend>Modules this member may open (within the plan)</legend>{CLIENT_MODULES.filter(k => modOn.get(k)?.enabled).map(k => <label key={k}><input type="checkbox" name="modules" value={k} defaultChecked={!m.moduleDeny.includes(k)} />{MODULES[k]}</label>)}</fieldset>}
                          <button className="btn" type="submit">Save</button>
                        </form>
                        <form action={m.status === "deactivated" ? reactivateOrgMemberAction : deactivateOrgMemberAction}>{hidden}<input type="hidden" name="email" value={m.email} /><button className={ui.miniBtn} type="submit">{m.status === "deactivated" ? "Reactivate" : "Deactivate"}</button></form>
                      </details>)}
                  </td>
                  <td>{USER_TYPES[m.userType].label}</td><td>{PERSONAS[m.persona]}</td>
                  <td className={ui.sub}>{m.teams.map(x => teamName.get(x)).filter(Boolean).join(", ") || "—"}</td>
                  <td><span className={`${ui.chip} ${m.status === "deactivated" ? ui.chipEmber : m.status === "invited" ? ui.chipPollen : ""}`}>{m.status}</span></td>
                  <td className={ui.sub}>{m.lastLoginAt?.slice(0, 16).replace("T", " ") ?? "never"}</td>
                </tr>))}
            </tbody></table></div>
            {invites.length > 0 && <><p className={r.panelTitle} style={{ marginTop: 16 }}>Open invitations</p><table className={ui.table}><tbody>{invites.map(i => <tr key={i.id}><td>{i.email}</td><td>{USER_TYPES[i.userType].label}</td><td className={ui.sub}>expires {i.expiresAt.slice(0, 10)}</td><td>{admin && <form action={revokeOrgInviteAction}>{hidden}<input type="hidden" name="inviteId" value={i.id} /><button className={ui.miniBtn} type="submit">Withdraw</button></form>}</td></tr>)}</tbody></table></>}
            <p className={ui.sub}>External collaborators, investors, brokers and technical partners use the portal (their own sign-in, explicit grants per project, data room or document), never this workspace: <Link href="/portals?tab=users">manage portal users</Link>.</p>
          </section>
          {admin && <aside><section className={r.panel}><p className={r.panelTitle}>Invite a member</p>
            <form action={inviteOrgUserAction} className={r.form}>{hidden}
              <label>Email<input name="email" type="email" required /></label>
              <label>Name<input name="name" /></label>
              <label>Type<select name="userType" defaultValue={userTypes.includes("client_user") ? "client_user" : userTypes[0]}>{userTypes.map(u => <option key={u} value={u}>{USER_TYPES[u].label}</option>)}</select></label>
              <label>Persona<select name="persona">{Object.entries(PERSONAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <fieldset className={s.checks}><legend>Workspaces</legend>{ws.map(w => <label key={w.id}><input type="checkbox" name="workspaceIds" value={w.id} defaultChecked={!w.sandbox} />{w.name}</label>)}</fieldset>
              {teamRows.length > 0 && <fieldset className={s.checks}><legend>Teams</legend>{teamRows.map(x => <label key={x.id}><input type="checkbox" name="teams" value={x.id} />{x.name}</label>)}</fieldset>}
              <button className="btn btn--primary" type="submit">Create invitation link</button>
            </form>
            <p className={ui.sub}>Nothing is emailed. The link is single-use, expires in 7 days and sets the member&apos;s own password (stored only as a PBKDF2 hash).</p>
          </section></aside>}
        </div>
      )}

      {tab === "teams" && (
        <div className={r.grid}>
          <section className={r.panel}><p className={r.panelTitle}>Teams</p>
            {teamRows.length === 0 ? <p className={r.empty}>No teams yet.</p> : <table className={ui.table}><thead><tr><th>Team</th><th>Kind</th><th>Members</th><th /></tr></thead><tbody>
              {teamRows.map(x => <tr key={x.id}><td className={ui.primary}>{x.name}<span className={ui.sub}>{x.description}</span></td><td>{TEAM_KINDS[x.kind]}</td><td className={ui.sub}>{members.filter(m => m.teams.includes(x.id)).map(m => m.name || m.email).join(", ") || "—"}</td>
                <td>{admin && <form action={deleteTeamAction}>{hidden}<input type="hidden" name="teamId" value={x.id} /><button className={ui.miniBtn} type="submit">Remove</button></form>}</td></tr>)}
            </tbody></table>}
          </section>
          {admin && <aside><section className={r.panel}><p className={r.panelTitle}>New team</p>
            <form action={saveTeamAction} className={r.form}>{hidden}
              <label>Kind<select name="kind">{Object.entries(TEAM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Name<input name="name" required placeholder="Investment Committee" /></label>
              <label>Description<input name="description" /></label>
              <button className="btn btn--primary" type="submit">Create</button>
            </form></section></aside>}
        </div>
      )}

      {tab === "modules" && (
        <div className={r.grid}>
          <section className={r.panel}><p className={r.panelTitle}>Module entitlements</p>
            {t.kind === "regenera" ? <p className={ui.sub}>Regenera staff have every module.</p> : <table className={ui.table}><thead><tr><th>Module</th><th>Status</th><th>Source</th><th>Expires</th>{owner ? <th /> : <th />}</tr></thead><tbody>
              {CLIENT_MODULES.map(k => { const m = modOn.get(k); const on = Boolean(m?.enabled); return (
                <tr key={k}><td className={ui.primary}>{MODULES[k]}</td><td><span className={`${ui.chip} ${on ? "" : ui.chipMuted}`}>{on ? "Included" : "Not included"}</span></td><td className={ui.sub}>{m?.source ?? "—"}</td><td className={ui.sub}>{m?.expiresAt ?? "—"}</td>
                  <td>{owner ? <form action={setModuleAction} className={s.inline}>{hidden}<input type="hidden" name="module" value={k} /><label><input type="checkbox" name="enabled" defaultChecked={on} /> on</label><select name="source" defaultValue={m?.source ?? "contract"}><option>contract</option><option>plan</option><option>trial</option><option>beta</option></select><input name="expiresAt" type="date" defaultValue={m?.expiresAt ?? ""} /><button className={ui.miniBtn} type="submit">Set</button></form>
                    : !on && admin ? (t.requestedModules.includes(k) ? <span className={ui.sub}>Requested</span> : <form action={requestModuleAction}>{hidden}<input type="hidden" name="module" value={k} /><button className={ui.miniBtn} type="submit">Request</button></form>) : null}</td></tr>); })}
            </tbody></table>}
            <p className={ui.sub}>Entitlements are contract terms: your Regenera account owner changes them. Administrators can narrow what each member opens (Users → Edit). The navigation shows only modules a member may open, and the server refuses the rest.</p>
          </section>
          {owner && t.kind === "client" && <aside>
            <section className={r.panel}><p className={r.panelTitle}>Apply plan template</p>
              <form action={applyPlanAction} className={r.form}>{hidden}<select name="plan" defaultValue={t.plan}>{Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select><button className="btn" type="submit">Apply</button></form></section>
            <section className={r.panel}><p className={r.panelTitle}>Account terms (Regenera)</p>
              <form action={saveAccountTermsAction} className={r.form}>{hidden}
                <label>Status<select name="status" defaultValue={t.status}>{Object.entries(TENANT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Support tier<select name="supportTier" defaultValue={t.supportTier}>{Object.entries(SUPPORT_TIERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <div className={r.formRow}><label>Seats<input name="seatsPurchased" inputMode="numeric" defaultValue={t.seatsPurchased} /></label><label>External seats<input name="externalSeats" inputMode="numeric" defaultValue={t.externalSeats} /></label></div>
                <div className={r.formRow}><label>Storage GB<input name="storageGb" inputMode="numeric" defaultValue={t.storageGb} /></label><label>API calls / day<input name="apiDailyLimit" inputMode="numeric" defaultValue={t.apiDailyLimit} /></label></div>
                <div className={r.formRow}><label>Client since<input name="clientSince" type="date" defaultValue={t.clientSince ?? ""} /></label><label>Renewal<input name="renewalDate" type="date" defaultValue={t.renewalDate ?? ""} /></label></div>
                <label>Termination date<input name="terminationDate" type="date" defaultValue={t.terminationDate ?? ""} /></label>
                <label>Renewal likelihood (your judgement, with reason)<input name="renewalLikelihood" defaultValue={t.renewalLikelihood ?? ""} /></label>
                <label>Account owner<input name="accountOwner" type="email" defaultValue={t.accountOwner ?? ""} /></label>
                <button className="btn btn--primary" type="submit">Save terms</button>
              </form></section>
          </aside>}
        </div>
      )}

      {tab === "security" && sec && (
        <>
          <section className={r.panel}><p className={r.panelTitle}>Members</p>
            <table className={ui.table}><thead><tr><th>Member</th><th>Status</th><th>MFA</th><th>Active sessions</th><th>Failed sign-ins (24h)</th><th>API tokens</th></tr></thead><tbody>
              {members.map(m => { const fails = sec[2].find(x => x.email === m.email)?.n ?? 0; return <tr key={m.id}><td>{m.email}</td><td>{m.status}</td><td className={ui.sub}>Not enrolled — MFA arrives with SSO (Google Workspace / Entra ID / OIDC), prepared, not connected</td><td className={ui.num}>{sec[1].find(x => x.email === m.email)?.n ?? 0}</td><td className={ui.num} style={fails >= 5 ? { color: "#b0432f", fontWeight: 700 } : undefined}>{fails}</td><td className={ui.num}>{tokens.filter(x => x.userEmail === m.email && !x.revokedAt).length}</td></tr>; })}
            </tbody></table>
            {sec[2].some(x => x.n >= 5) && <p className={ui.notice}>Suspicious: five or more failed sign-ins in 24 hours for {sec[2].filter(x => x.n >= 5).map(x => x.email).join(", ")}.</p>}
          </section>
          <div className={r.grid}>
            <section className={r.panel}><p className={r.panelTitle}>Sign-in history</p>
              {sec[0].length === 0 ? <p className={r.empty}>No sign-ins recorded yet.</p> : <table className={ui.table}><tbody>{sec[0].map(e => <tr key={e.id}><td className={ui.sub}>{e.at.slice(0, 16).replace("T", " ")}</td><td>{e.email}</td><td>{e.ok ? "Signed in" : <b style={{ color: "#b0432f" }}>Failed</b>}</td><td className={ui.sub}>{e.method} · {e.ip}</td></tr>)}</tbody></table>}
            </section>
            <aside>
              <section className={r.panel}><p className={r.panelTitle}>External access</p>
                {sec[3].length === 0 ? <p className={r.empty}>No portal users.</p> : <table className={ui.table}><tbody>{sec[3].map(p => <tr key={p.email}><td>{p.email}<span className={ui.sub}>{p.kind} · {p.status}</span></td><td className={ui.num}>{p.grants} grants</td></tr>)}</tbody></table>}</section>
              <section className={r.panel}><p className={r.panelTitle}>Integrations</p>
                {sec[4].length === 0 ? <p className={r.empty}>None recorded.</p> : <table className={ui.table}><tbody>{sec[4].map(c => <tr key={c.id}><td>{c.provider}<span className={ui.sub}>{c.category}</span></td><td>{c.status}</td></tr>)}</tbody></table>}</section>
            </aside>
          </div>
        </>
      )}

      {tab === "api" && (
        <section className={r.panel}><p className={r.panelTitle}>API access</p>
          {t.kind === "client" && !modOn.get("api")?.enabled ? <p className={r.empty}>API access is not part of this organization&apos;s plan.</p> : <>
            <p className={ui.sub}>Members create personal tokens for the Regenera MCP / API at <Link href="/connect/mcp">Connect</Link>. Tokens carry their owner&apos;s workspace grants and never more; they end when the member is deactivated. {t.apiDailyLimit ? `Daily limit: ${t.apiDailyLimit} calls.` : ""}</p>
            {tokens.length === 0 ? <p className={r.empty}>No tokens.</p> : <table className={ui.table}><thead><tr><th>Owner</th><th>Label</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>
              {tokens.map(x => <tr key={x.id}><td>{x.userEmail}</td><td>{x.label || "—"}</td><td className={ui.sub}>{x.createdAt.slice(0, 10)}</td><td className={ui.sub}>{x.lastUsedAt?.slice(0, 10) ?? "never"}</td><td>{x.revokedAt ? "revoked" : "active"}</td>
                <td>{admin && !x.revokedAt && <form action={revokeMemberTokenAction}>{hidden}<input type="hidden" name="tokenId" value={x.id} /><button className={ui.miniBtn} type="submit">Revoke</button></form>}</td></tr>)}
            </tbody></table>}
          </>}
        </section>
      )}

      {tab === "data" && (
        <div className={r.grid}>
          <section className={r.panel}><p className={r.panelTitle}>Your data</p>
            <p>Client data belongs to the client. Administrators can export everything held in this organization&apos;s workspaces at any time: projects, contacts, organizations, deals, documents metadata, assumptions, scenarios, tasks, risks, decisions, GIS features and financial models, as CSV files in one ZIP.</p>
            {admin ? <a className="btn btn--primary" href={withBase(`/api/org/export?tenant=${t.id}`)}>Download export (ZIP)</a> : <p className={ui.sub}>Ask an administrator to export.</p>}
            <p className={ui.sub}>Provenance classes on records: client data (yours), Regenera data (created or licensed by Regenera), third-party data (licence terms apply; exported as references, not redistributed), derived data (calculated from the above).</p>
          </section>
          <aside><section className={r.panel}><p className={r.panelTitle}>Sandbox</p>
            <p className={ui.sub}>A sandbox workspace lets your team test imports, scenarios, workflows and assumptions without touching production records. Everything in it is labelled SANDBOX.</p>
            {ws.filter(w => w.sandbox).map(w => <p key={w.id}>{w.name}</p>)}
            {admin && <form action={createSandboxAction}>{hidden}<button className="btn" type="submit">Create sandbox workspace</button></form>}
          </section></aside>
        </div>
      )}

      {tab === "onboarding" && (
        <section className={r.panel}><p className={r.panelTitle}>Onboarding <span>{Object.values(t.onboarding).reduce((a, x) => a + x.done.length, 0)} / {Object.values(ONBOARDING_STEPS).reduce((a, x) => a + x.items.length, 0)} done</span></p>
          <ol className={s.steps}>
            {(Object.keys(ONBOARDING_STEPS) as (keyof typeof ONBOARDING_STEPS)[]).map(k => { const st = t.onboarding[k]; const step = ONBOARDING_STEPS[k]; const full = (st?.done.length ?? 0) === step.items.length; return (
              <li key={k} className={full ? s.done : ""}><b>{step.label}</b>
                <div className={s.items}>{step.items.map(it => { const on = st?.done.includes(it); return admin
                  ? <form key={it} action={onboardingItemAction}>{hidden}<input type="hidden" name="step" value={k} /><input type="hidden" name="item" value={it} /><button type="submit" className={`${s.item} ${on ? s.itemOn : ""}`} aria-pressed={on}>{on ? "✓ " : ""}{it}</button></form>
                  : <span key={it} className={`${s.item} ${on ? s.itemOn : ""}`}>{on ? "✓ " : ""}{it}</span>; })}</div>
              </li>); })}
          </ol>
          <p className={ui.sub}>Facts: {members.filter(m => m.status === "active").length} active members, {mods.filter(m => m.enabled).length} modules, {units.length} entities, {teamRows.length} teams. The organization turns Active when every step is ticked.</p>
        </section>
      )}
    </>
  );
}
