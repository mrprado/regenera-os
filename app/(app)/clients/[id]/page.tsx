import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { engagements, projects, tenantModules, tenants } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { ENGAGEMENT_STATUSES } from "@/lib/commercial/vocab";
import { appDb } from "@/lib/db/scoped";
import { canSetEntitlements } from "@/lib/tenancy/access";
import { tenantWorkspaces } from "@/lib/tenancy/engine";
import { accountHealth } from "@/lib/tenancy/health";
import { MODULES, OFFBOARDING_STEPS, ONBOARDING_STEPS, ORG_TYPES, PLANS, SUPPORT_TIERS, TENANT_STATUSES } from "@/lib/tenancy/vocab";
import { offboardingStepAction } from "../../clients-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client account" };
const money = (n: number, cur = "USD") => `${cur} ${Math.round(n).toLocaleString("en-US")}`;

// Regenera internal account view: engagements, deliverables, usage, modules, projects, onboarding and offboarding.
export default async function ClientAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/clients/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t || t.kind !== "client") notFound();
  const [ws, mods, health] = await Promise.all([tenantWorkspaces(db, t.id), db.select().from(tenantModules).where(eq(tenantModules.tenantId, t.id)), accountHealth(db, [t])]);
  const h = health.get(t.id)!;
  const [engs, projs] = await Promise.all([
    t.crmOrgId ? db.select().from(engagements).where(eq(engagements.orgId, t.crmOrgId)) : Promise.resolve([]),
    ws.length ? db.select({ id: projects.id, name: projects.name, stage: projects.stage, mandateId: projects.mandateId }).from(projects).where(inArray(projects.mandateId, ws.map(w => w.id))) : Promise.resolve([]),
  ]);
  const owner = canSetEntitlements(user.scope);
  const onboardDone = Object.values(t.onboarding).reduce((a, x) => a + x.done.length, 0);
  const onboardAll = Object.values(ONBOARDING_STEPS).reduce((a, x) => a + x.items.length, 0);
  const member = new Set(user.scope.memberOf ?? user.scope.mandateIds);
  const showOff = sp.tab === "offboarding" || t.status === "offboarding" || t.status === "offboarded" || Boolean(t.terminationDate);
  return (
    <>
      <PageHeader title={t.displayName} actions={<><Link className="btn" href={`/org?tenant=${t.id}`}>Organization console</Link><Link className="btn" href="/clients">All clients</Link></>} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>{t.legalName} · {ORG_TYPES[t.orgType]} · {TENANT_STATUSES[t.status]} · {PLANS[t.plan].label} · {SUPPORT_TIERS[t.supportTier]} support · account owner {t.accountOwner ?? "—"} · client since {t.clientSince ?? "—"}</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}><p className={r.panelTitle}>Engagements {t.crmOrgId ? null : <span>link a CRM organization to see engagements</span>}</p>
            {engs.length === 0 ? <p className={r.empty}>No engagements recorded.</p> : <table className={ui.table}><thead><tr><th>Engagement</th><th>Status</th><th className={ui.num}>Fee</th><th className={ui.num}>Monthly</th><th>Deliverables</th></tr></thead><tbody>
              {engs.map(e => <tr key={e.id}><td className={ui.primary}><Link href={`/commercial/engagements/${e.id}`}>{e.name}</Link><span className={ui.sub}>{e.startDate ?? ""}{e.endDate ? ` → ${e.endDate}` : ""}</span></td><td>{ENGAGEMENT_STATUSES[e.status]}</td><td className={ui.num}>{money(e.fee, e.currency)}</td><td className={ui.num}>{e.monthlyFee ? money(e.monthlyFee, e.currency) : "—"}</td>
                <td className={ui.sub}>{e.deliverables.filter(d => d.status === "delivered" || d.status === "accepted").length} / {e.deliverables.length} delivered</td></tr>)}
            </tbody></table>}
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Projects in their workspaces</p>
            {projs.length === 0 ? <p className={r.empty}>No projects yet.</p> : <table className={ui.table}><tbody>{projs.map(p => <tr key={p.id}><td>{member.has(p.mandateId) ? <Link href={`/projects/${p.id}`}>{p.name}</Link> : p.name}</td><td className={ui.sub}>{p.stage}</td></tr>)}</tbody></table>}
            {!ws.some(w => member.has(w.id)) && <p className={ui.sub}>You are not a member of this client&apos;s workspaces, so their records stay closed to you; names are shown for account management.</p>}
          </section>
          {showOff ? (
            <section className={r.panel}><p className={r.panelTitle}>Offboarding {t.terminationDate ? <span>termination {t.terminationDate}</span> : null}</p>
              <p className={ui.sub}>Freeze sets the account to Offboarding (no new access). Deactivate ends every member&apos;s access, sessions and API tokens. Revoke integrations marks their connections disconnected. Archive sets Offboarded. Data is never deleted automatically: retention and deletion follow the configured policy and are recorded here.</p>
              <table className={ui.table}><tbody>{(Object.keys(OFFBOARDING_STEPS) as (keyof typeof OFFBOARDING_STEPS)[]).map(k => { const st = t.offboarding[k]; return (
                <tr key={k}><td>{st?.completedAt ? "✓ " : ""}{OFFBOARDING_STEPS[k]}{st?.note ? <span className={ui.sub}>{st.note}</span> : null}</td><td className={ui.sub}>{st?.completedAt?.slice(0, 10) ?? ""}</td>
                  <td>{k === "export" && <a className={ui.miniBtn} href={withBase(`/api/org/export?tenant=${t.id}`)}>Export</a>}
                    {owner && !st?.completedAt && <form action={offboardingStepAction} style={{ display: "inline-flex", gap: 6 }}><input type="hidden" name="tenantId" value={t.id} /><input type="hidden" name="step" value={k} /><input name="note" placeholder="Note" aria-label="Note" style={{ fontSize: 12 }} /><button className={ui.miniBtn} type="submit">Record</button></form>}</td></tr>); })}</tbody></table>
            </section>
          ) : <p><Link href={`/clients/${t.id}?tab=offboarding`}>Start offboarding…</Link></p>}
        </div>
        <aside>
          <section className={r.panel}><p className={r.panelTitle}>Usage & health</p>
            <dl className={r.kv}><dt>Active members</dt><dd>{h.activeMembers}{h.seats ? ` of ${h.seats} seats` : ""}</dd><dt>Signed in (30 days)</dt><dd>{h.activeUsers30} people, {h.logins30} sign-ins (prior 30: {h.loginsPrev30})</dd><dt>Active engagements</dt><dd>{h.engagementsActive}</dd><dt>Open deliverables</dt><dd>{h.deliverablesOpen} ({h.deliverablesOverdue} overdue)</dd><dt>Renewal</dt><dd>{t.renewalDate ?? "—"}{h.renewalInDays !== null ? ` (${h.renewalInDays} days)` : ""}</dd><dt>Likelihood</dt><dd>{t.renewalLikelihood ?? "Not entered"}</dd><dt>Onboarding</dt><dd>{onboardDone} / {onboardAll}</dd></dl>
            {h.flags.length > 0 && <p className={ui.notice}>{h.flags.join(" · ")}</p>}
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Modules</p>
            <p className={ui.sub}>{mods.filter(m => m.enabled).map(m => MODULES[m.module]).join(", ") || "None"}</p>
            {t.requestedModules.length > 0 && <p className={ui.sub}>Requested: {t.requestedModules.map(m => MODULES[m as keyof typeof MODULES] ?? m).join(", ")}</p>}
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Workspaces</p>{ws.map(w => <p key={w.id} className={ui.sub}>{w.name}{w.sandbox ? " · SANDBOX" : ""}</p>)}</section>
        </aside>
      </div>
    </>
  );
}
