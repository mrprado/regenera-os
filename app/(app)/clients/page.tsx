import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { organizations, tenants } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { canSetEntitlements } from "@/lib/tenancy/access";
import { accountHealth } from "@/lib/tenancy/health";
import { ORG_TYPES, PLANS, SUPPORT_TIERS, TENANT_STATUSES } from "@/lib/tenancy/vocab";
import { createClientAction } from "../clients-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client accounts" };

// Regenera internal: every client organization with plain health facts (no composite score).
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/clients");
  const sp = await searchParams;
  const db = appDb();
  const ts = await db.select().from(tenants).where(eq(tenants.kind, "client")).orderBy(asc(tenants.displayName));
  const health = await accountHealth(db, ts);
  const owner = canSetEntitlements(user.scope);
  const orgs = owner ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(mandateCondition(user.scope, organizations.mandateId)).orderBy(asc(organizations.name)).limit(500) : [];
  return (
    <>
      <PageHeader title="Client accounts" count={ts.length} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>Organizations using Regenera OS or engaged by Regenera. Each has its own workspaces; their users see only their own data. Health shows counts with their definitions: active users = distinct members who signed in within 30 days.</p>
      <div className={r.grid}>
        <section className={r.panel}>
          {ts.length === 0 ? <p className={r.empty}>No client organizations yet.</p> : <div className={ui.tableWrap}><table className={ui.table}>
            <thead><tr><th>Client</th><th>Status</th><th>Plan</th><th className={ui.num}>Members</th><th className={ui.num}>Active 30d</th><th className={ui.num}>Sign-ins 30d / prior</th><th className={ui.num}>Open deliverables</th><th>Renewal</th><th>Attention</th></tr></thead>
            <tbody>{ts.map(t => { const h = health.get(t.id)!; return (
              <tr key={t.id}>
                <td className={ui.primary}><Link href={`/clients/${t.id}`}>{t.displayName}</Link><span className={ui.sub}>{ORG_TYPES[t.orgType]}{t.jurisdiction ? ` · ${t.jurisdiction}` : ""} · {SUPPORT_TIERS[t.supportTier]}</span></td>
                <td>{TENANT_STATUSES[t.status]}</td><td>{PLANS[t.plan].label}</td>
                <td className={ui.num}>{h.activeMembers}{h.seats ? ` / ${h.seats}` : ""}</td><td className={ui.num}>{h.activeUsers30}</td><td className={ui.num}>{h.logins30} / {h.loginsPrev30}</td>
                <td className={ui.num}>{h.deliverablesOpen}{h.deliverablesOverdue ? ` (${h.deliverablesOverdue} late)` : ""}</td>
                <td className={ui.sub}>{t.renewalDate ?? "—"}</td>
                <td className={ui.sub}>{h.flags.join(" · ") || "—"}</td>
              </tr>); })}</tbody>
          </table></div>}
        </section>
        {owner && <aside><section className={r.panel}><p className={r.panelTitle}>New client organization</p>
          <form action={createClientAction} className={r.form}>
            <label>Legal name<input name="legalName" required /></label>
            <label>Display name<input name="displayName" /></label>
            <label>Type<select name="orgType">{Object.entries(ORG_TYPES).filter(([k]) => k !== "regenera").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Jurisdiction<input name="jurisdiction" /></label>
            <label>Plan<select name="plan" defaultValue="custom">{Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label>Base currency<input name="baseCurrency" defaultValue="USD" maxLength={3} /></label>
            <label>Stage<select name="status" defaultValue="onboarding"><option value="prospect">Prospect (no access yet)</option><option value="onboarding">Onboarding</option></select></label>
            <label>CRM organization<select name="crmOrgId"><option value="">—</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <button className="btn btn--primary" type="submit">Create</button>
          </form>
          <p className={ui.sub}>Creates the organization, its first workspace and the plan&apos;s module entitlements. Nothing is sent to anyone.</p>
        </section></aside>}
      </div>
    </>
  );
}
